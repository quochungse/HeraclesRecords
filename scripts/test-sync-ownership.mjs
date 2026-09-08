// Whose vault this is.
//
// Sync merges two machines' records into one log, and the tables carry no owner
// column — so if two COROS accounts ever share a vault, nothing can separate
// them again afterwards. That makes ownership a precondition rather than a
// warning, and the states below are the whole of how it is enforced:
//
//   * signed-out  — nobody to attribute records to. Checked before the
//                   destination, and before one has even been chosen.
//   * unclaimed   — an empty vault, or one from before ownership existed. The
//                   first signed-in machine to prepare it takes it.
//   * mine        — ordinary running.
//   * wrong-owner — left completely alone until the person says what it is.
//
// Runs under Electron for the SQLite ABI: `claimVault` clears the seed flag
// through the real settings store, which is half of what makes a claim safe.
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const bust = `?cacheBust=${Date.now()}`;
const load = (file) =>
  import(
    `${pathToFileURL(path.join(repoRoot, "dist-electron", file)).href}${bust}`
  );

const database = await load("database.js");
const { LocalFolderProvider } = await load("sync/localFolderProvider.js");
const { SyncService, SYNC_SETTINGS } = await load("sync/syncService.js");
const { fingerprintOwner } = await load("dataOwner.js");
const { seal } = await load("sync/syncObfuscation.js");

const tempRoots = [];
const tempDir = (label) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `heracles-${label}-`));
  tempRoots.push(dir);
  return dir;
};

database.initializeDatabase(tempDir("db"));
const vault = tempDir("vault");

const ALICE = fingerprintOwner("coros-alice");
const BOB = fingerprintOwner("coros-bob");

/** A machine, with its own idea of who is signed in. Settings are shared,
 *  which is realistic for the two-accounts-one-computer case and harmless for
 *  the rest: nothing here reads a setting the other machine writes except the
 *  seed flag, which is exactly what the claim test is about. */
function makeMachine(owner, { folder = vault } = {}) {
  const state = { owner };
  const service = new SyncService({
    getSetting: database.getSetting,
    setSetting: database.setSetting,
    makeProvider: (target) => new LocalFolderProvider({ root: target.folder }),
    deviceId: () => "device-under-test",
    owner: () => state.owner,
    now: () => new Date("2026-09-08T12:00:00.000Z")
  });
  if (folder) service.setFolder(folder);
  return { service, state };
}

// ---------------------------------------------------------------------------
// Nobody signed in
// ---------------------------------------------------------------------------

{
  const { service } = makeMachine(null);
  assert.equal(await service.prepare(), "signed-out");

  const status = await service.status();
  assert.equal(status.state, "signed-out");
  assert.equal(status.signedIn, false);
  assert.equal(status.ownership, null);
  assert.equal(
    service.isReady,
    false,
    "and no loop may start — `isReady` is the precondition main.ts gates on"
  );

  // Reported ahead of the destination even when there is no destination
  // either: choosing a folder first would be work the app then refuses to use.
  const unconfigured = makeMachine(null, { folder: null });
  unconfigured.service.setFolder("");
  assert.equal(await unconfigured.service.prepare(), "signed-out");
}
console.log("ok  with nobody signed in, sync refuses before anything else");

// ---------------------------------------------------------------------------
// An empty vault is claimed by the first signed-in machine
// ---------------------------------------------------------------------------

let vaultIdBefore;

{
  const { service } = makeMachine(ALICE);
  assert.equal(await service.prepare(), "ready");

  const status = await service.status();
  assert.equal(status.state, "ready");
  assert.equal(status.ownership, "mine");
  assert.equal(status.signedIn, true);

  vaultIdBefore = await service.vaultId();
  assert.match(vaultIdBefore, /^[0-9a-f]{16}$/);

  // Repeating it changes nothing: prepare runs on every launch.
  assert.equal(await service.prepare(), "ready");
  assert.equal(await service.vaultId(), vaultIdBefore, "the id is stable");
}
console.log("ok  the first signed-in machine claims an empty vault");

// ---------------------------------------------------------------------------
// A second account finds it taken
// ---------------------------------------------------------------------------

{
  const { service } = makeMachine(BOB);
  assert.equal(await service.prepare(), "wrong-owner");

  const status = await service.status();
  assert.equal(status.state, "wrong-owner");
  assert.equal(status.ownership, "other");

  // Alice is unaffected — nothing about Bob looking at it changed the vault.
  const alice = makeMachine(ALICE);
  assert.equal(await alice.service.prepare(), "ready");
}
console.log("ok  a second account is refused, and changes nothing by looking");

// ---------------------------------------------------------------------------
// Claiming it deliberately
// ---------------------------------------------------------------------------

{
  const { service } = makeMachine(BOB);
  database.setSetting(SYNC_SETTINGS.seededVaultId, vaultIdBefore);
  assert.equal(
    service.hasSeeded(vaultIdBefore),
    true,
    "fixture: this machine believes it has already published into this vault"
  );

  await service.claimVault();

  assert.equal(await service.prepare(), "ready");
  assert.equal((await service.status()).ownership, "mine");
  assert.equal(
    await service.vaultId(),
    vaultIdBefore,
    "the vault keeps its id — only the owner changed"
  );

  // The half that stops a claim being a quiet data loss. Same vault id, so
  // without clearing this the machine would consider itself seeded and the
  // account that just took the vault would have none of its data in it.
  assert.equal(
    service.hasSeeded(vaultIdBefore),
    false,
    "claiming clears the seed flag, so the whole state is republished"
  );

  // And now Alice is the one locked out.
  const alice = makeMachine(ALICE);
  assert.equal(await alice.service.prepare(), "wrong-owner");
}
console.log("ok  claiming transfers the vault and forces a republish");

// ---------------------------------------------------------------------------
// A vault written before ownership existed
// ---------------------------------------------------------------------------

{
  const older = tempDir("vault-legacy");
  const identityPath = path.join(older, "vault", "id.json");
  await fsp.mkdir(path.dirname(identityPath), { recursive: true });
  // No `owner` field at all — and sealed, because everything in a vault is.
  await fsp.writeFile(
    identityPath,
    seal(
      Buffer.from(
        JSON.stringify({
          version: 1,
          id: "abcdef0123456789",
          createdAt: "2026-01-01T00:00:00.000Z"
        }),
        "utf8"
      ),
      "vault/id.json"
    )
  );

  const { service } = makeMachine(ALICE, { folder: older });
  assert.equal(
    (await service.status()).ownership,
    "unclaimed",
    "an ownerless vault reads as unclaimed, not as someone else's"
  );
  assert.equal(
    (await service.status()).state,
    "ready",
    "and nothing about the destination is wrong, so it reports ready"
  );

  assert.equal(await service.prepare(), "ready");
  assert.equal(
    (await service.status()).ownership,
    "mine",
    "preparing it claims it"
  );
  assert.equal(
    await service.vaultId(),
    "abcdef0123456789",
    "keeping the id it already had, so a machine that had seeded it still has"
  );
}
console.log("ok  a vault from before ownership is adopted, not rejected");

for (const dir of tempRoots) {
  await fsp.rm(dir, { recursive: true, force: true });
}
console.log("\nsync ownership tests passed");
