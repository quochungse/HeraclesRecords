// LocalFolderProvider: the shared StorageProvider contract, plus the things
// only a real directory can be asked about.
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  bytes,
  runStorageProviderContract
} from "./lib/storage-provider-contract.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const bust = `?cacheBust=${Date.now()}`;
const load = (file) =>
  import(
    `${pathToFileURL(path.join(repoRoot, "dist-electron", "sync", file)).href}${bust}`
  );

const { LocalFolderProvider } = await load("localFolderProvider.js");
const {
  StorageConflictError,
  StoragePathError,
  TEMP_PREFIX,
  normalizeStoragePath,
  isUnderPrefix
} = await load("storageProvider.js");

const roots = [];
function freshRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "heracles-sync-"));
  roots.push(root);
  return root;
}

// --- The contract every backend owes ----------------------------------------

const checks = await runStorageProviderContract({
  label: "local folder",
  newStore: async () => {
    const root = freshRoot();
    return { open: () => new LocalFolderProvider({ root }) };
  },
  errors: { StorageConflictError, StoragePathError }
});

// --- Path validation, in detail ---------------------------------------------
//
// The contract checks that a provider refuses a traversal. These check the
// validator itself, which is the security boundary the providers lean on.

for (const bad of [
  "../escape",
  "oplog/../../escape",
  "/absolute",
  "back\\slash",
  "",
  "double//slash",
  "trailing/",
  "./here",
  "oplog/./x",
  `${TEMP_PREFIX}sneaky`,
  `oplog/${TEMP_PREFIX}sneaky`
]) {
  assert.throws(
    () => normalizeStoragePath(bad),
    (error) => {
      assert.ok(
        error instanceof StoragePathError,
        `${JSON.stringify(bad)} should raise StoragePathError`
      );
      return true;
    },
    `${JSON.stringify(bad)} must be rejected`
  );
}

for (const good of ["a", "oplog/device-1/00001.jsonl", "snapshot/2026.json"]) {
  assert.equal(normalizeStoragePath(good), good, `${good} must be accepted`);
}

assert.equal(isUnderPrefix("oplog/a", "oplog"), true);
assert.equal(isUnderPrefix("oplog", "oplog"), true);
assert.equal(
  isUnderPrefix("oplog-archive/a", "oplog"),
  false,
  "prefixes match whole segments, not string starts"
);
assert.equal(isUnderPrefix("anything", undefined), true);

// --- Things only a directory can be asked -----------------------------------

{
  const root = freshRoot();
  const provider = new LocalFolderProvider({ root });

  // A traversal must not reach the disk, not merely be reported as an error.
  await assert.rejects(
    provider.put("../outside.txt", bytes("nope")),
    (error) => error instanceof StoragePathError
  );
  assert.equal(
    fs.existsSync(path.join(path.dirname(root), "outside.txt")),
    false,
    "nothing may be written beside the root"
  );

  await provider.put("oplog/a/1.jsonl", bytes("a1"));

  // A crashed write leaves a temp file behind; it must stay invisible.
  fs.writeFileSync(path.join(root, "oplog", `${TEMP_PREFIX}halfwritten`), "garbage");
  assert.equal(
    (await provider.list()).length,
    1,
    "an interrupted write must not appear in the listing"
  );
  assert.equal(
    await provider.get("oplog/a/1.jsonl") !== null,
    true,
    "and must not disturb the objects around it"
  );

}

// Deleting the last object in a directory prunes it, so listing stays cheap.
// Its own store: a leftover temp file in the directory would legitimately keep
// it alive, which is what the block above deliberately creates.
{
  const root = freshRoot();
  const provider = new LocalFolderProvider({ root });
  await provider.put("oplog/a/1.jsonl", bytes("a1"));

  await provider.delete("oplog/a/1.jsonl");
  assert.equal(
    fs.existsSync(path.join(root, "oplog")),
    false,
    "emptied directories are pruned"
  );
  assert.equal(fs.existsSync(root), true, "but the root itself survives");
}

// A cursor this provider cannot read means "resynchronise", never a crash.
{
  const provider = new LocalFolderProvider({ root: freshRoot() });
  await provider.put("a.txt", bytes("1"));
  const recovered = await provider.pollChanges("not-a-valid-cursor");
  assert.deepEqual(
    recovered.changes.map((change) => change.path),
    ["a.txt"],
    "an unreadable cursor replays everything currently stored"
  );
}

await Promise.all(
  roots.map((root) => fsp.rm(root, { recursive: true, force: true }))
);

console.log(
  `sync storage OK — ${checks} contract checks on the local folder, ` +
    "path traversal blocked, single lease winner, temp files hidden"
);
