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
//   * outdated    — the vault's data format is past what this build may work
//                   with (`dataVersionCompat`), so it is left alone too.
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
const { seal, unseal } = await load("sync/syncObfuscation.js");
const { dataFormatVerdict, vaultDataFormat, BUILD_DATA_FORMAT } = await load(
  "sync/dataFormat.js"
);

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
 *  seed flag, which is exactly what the claim test is about.
 *
 *  The vault is Drive in the app; here a temp folder stands in for it, and
 *  `folder: null` is a machine with no Drive account connected. */
function makeMachine(owner, { folder = vault } = {}) {
  const state = { owner };
  const service = new SyncService({
    getSetting: database.getSetting,
    setSetting: database.setSetting,
    makeProvider: () => new LocalFolderProvider({ root: folder }),
    google: {
      isConnected: () => folder !== null,
      isClientConfigured: () => true
    },
    deviceId: () => "device-under-test",
    owner: () => state.owner,
    now: () => new Date("2026-09-08T12:00:00.000Z")
  });
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
  // either: connecting Drive first would be work the app then refuses to use.
  const unconfigured = makeMachine(null, { folder: null });
  assert.equal(await unconfigured.service.prepare(), "signed-out");
}
console.log("ok  with nobody signed in, sync refuses before anything else");

// Signed in, but no Drive account: the only vault there is, so nothing to do.
{
  const { service } = makeMachine(ALICE, { folder: null });
  assert.equal(await service.prepare(), "not-configured");
  const status = await service.status();
  assert.equal(status.state, "not-configured");
  assert.equal(status.googleConnected, false);
  assert.equal(service.isReady, false);
}
console.log("ok  signed in with no Drive connected, sync waits for Drive");

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


// ---------------------------------------------------------------------------
// The vault's data format (docs/sync-v2.md §3)
// ---------------------------------------------------------------------------

// The rule, as arithmetic: this build against what a vault declares.
{
  const build = { dataVersion: 2, dataVersionCompat: 1 };
  const verdict = (dataVersion, dataVersionCompat) =>
    dataFormatVerdict({ dataVersion, dataVersionCompat }, build);
  assert.equal(verdict(1, 1), "ahead", "an older vault: this build is ahead");
  assert.equal(verdict(2, 1), "current");
  assert.equal(verdict(2, 2), "current");
  assert.equal(verdict(3, 2), "behind", "newer, but this build is still allowed");
  assert.equal(verdict(3, 3), "outdated", "newer, and past what this build may touch");

  assert.deepEqual(
    vaultDataFormat({ version: 1, id: "x" }),
    { dataVersion: 1, dataVersionCompat: 1 },
    "a vault from before the numbers is format 1"
  );
  assert.deepEqual(
    vaultDataFormat({ dataVersion: 2, dataVersionCompat: 5 }),
    { dataVersion: 2, dataVersionCompat: 2 },
    "a compat above the version requires nothing that was never written"
  );
  assert.deepEqual(
    vaultDataFormat({ dataVersion: "2", dataVersionCompat: -1 }),
    { dataVersion: 1, dataVersionCompat: 1 },
    "and a value that is not a positive integer reads as absent"
  );
}
console.log("ok  the data-format rule: current, ahead, behind, outdated");

/** A vault whose identity says what `identity` says, sealed as a real one. */
async function vaultWithIdentity(label, identity) {
  const folder = tempDir(label);
  const identityPath = path.join(folder, "vault", "id.json");
  await fsp.mkdir(path.dirname(identityPath), { recursive: true });
  await fsp.writeFile(
    identityPath,
    seal(Buffer.from(JSON.stringify(identity), "utf8"), "vault/id.json")
  );
  const read = async () =>
    JSON.parse(unseal(await fsp.readFile(identityPath), "vault/id.json").toString("utf8"));
  const raw = () => fsp.readFile(identityPath);
  return { folder, read, raw };
}

const newer = BUILD_DATA_FORMAT.dataVersion + 1;

// A vault in a format this build may not touch: refused before anything is
// written — the claim included, which is the one write `prepare()` makes.
{
  const { folder, raw } = await vaultWithIdentity("vault-outdated", {
    version: 2,
    id: "0123456789abcdef",
    createdAt: "2026-10-09T00:00:00.000Z",
    owner: null,
    dataVersion: newer,
    dataVersionCompat: newer
  });
  const before = await raw();
  const { service } = makeMachine(ALICE, { folder });

  assert.equal(await service.prepare(), "outdated");
  const status = await service.status();
  assert.equal(status.state, "outdated");
  assert.equal(status.dataFormat, "outdated");
  assert.equal(await service.checkDataFormat(), "outdated");
  await assert.rejects(
    service.claimVault(),
    /newer data format/,
    "and it cannot be claimed past the format either"
  );
  assert.deepEqual(
    await raw(),
    before,
    "an unclaimed vault in a newer format is left exactly as it was"
  );
}
console.log("ok  a vault past this build's format is refused, and nothing is written");

// Newer, but still allowed: sync as usual, and keep the newer numbers — a
// claim spreads the identity, so nothing this build does not know is lost.
{
  const { folder, read } = await vaultWithIdentity("vault-behind", {
    version: 2,
    id: "fedcba9876543210",
    createdAt: "2026-10-09T00:00:00.000Z",
    owner: null,
    dataVersion: newer,
    dataVersionCompat: BUILD_DATA_FORMAT.dataVersion,
    addedByANewerBuild: { keep: true }
  });
  const { service } = makeMachine(ALICE, { folder });

  assert.equal(await service.prepare(), "ready", "an identity of version 2 is read");
  const status = await service.status();
  assert.equal(status.state, "ready");
  assert.equal(status.dataFormat, "behind", "and the panel can say an update is out");

  const written = await read();
  assert.equal(written.owner, ALICE, "the claim landed");
  assert.equal(written.dataVersion, newer, "without lowering the version");
  assert.equal(written.dataVersionCompat, BUILD_DATA_FORMAT.dataVersion);
  assert.deepEqual(written.addedByANewerBuild, { keep: true });
}
console.log("ok  a newer but compatible vault syncs, and keeps its numbers");

// A new vault declares the format it was made in.
{
  const folder = tempDir("vault-fresh");
  const { service } = makeMachine(ALICE, { folder });
  assert.equal(await service.prepare(), "ready");
  const written = JSON.parse(
    unseal(
      await fsp.readFile(path.join(folder, "vault", "id.json")),
      "vault/id.json"
    ).toString("utf8")
  );
  assert.equal(
    written.version,
    BUILD_DATA_FORMAT.dataVersion >= 2 ? 2 : 1,
    "from format 2, an identity no build from before the numbers will touch"
  );
  assert.equal(written.dataVersion, BUILD_DATA_FORMAT.dataVersion);
  assert.equal(written.dataVersionCompat, BUILD_DATA_FORMAT.dataVersionCompat);
  assert.equal((await service.status()).dataFormat, "current");
}
console.log("ok  a new vault is stamped with this build's format");

// A format-1 vault raised to this build's format once it has migrated: the
// identity's own version goes to 2 — what stops a build from before the
// numbers — and the owner and id are kept.
{
  const { folder, read } = await vaultWithIdentity("vault-raise", {
    version: 1,
    id: "1111222233334444",
    createdAt: "2026-01-01T00:00:00.000Z",
    owner: ALICE
  });
  const { service } = makeMachine(ALICE, { folder });
  assert.equal(await service.checkDataFormat(), "ahead", "a format-1 vault is behind this build");
  assert.equal(await service.prepare(), "ready", "and is still prepared, for the migration");
  await service.raiseDataFormat();
  const raised = await read();
  assert.equal(raised.version, 2);
  assert.equal(raised.dataVersion, BUILD_DATA_FORMAT.dataVersion);
  assert.equal(raised.dataVersionCompat, BUILD_DATA_FORMAT.dataVersionCompat);
  assert.equal(raised.owner, ALICE);
  assert.equal(raised.id, "1111222233334444");
  assert.equal(await service.checkDataFormat(), "current");
  await service.raiseDataFormat();
  assert.deepEqual(await read(), raised, "raising an already current vault writes nothing");
}
console.log("ok  a migrated vault is raised to this build's format, once");

// Windows will not unlink a file that is still open, so the handle has to
// go before the tree does.
database.closeDatabase();
for (const dir of tempRoots) {
  await fsp.rm(dir, { recursive: true, force: true });
}
console.log("\nsync ownership tests passed");
