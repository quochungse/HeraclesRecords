// Backup and restore: one file, and what reading it back does to this machine.
//
// A backup is not sync. There is no vault here, no list of copies, no notion of
// which one is current — those belonged to the model where a backup lived
// inside the sync folder, and every claim about them went with it. What is left
// is the pair of questions this feature actually has to answer:
//
//   * What may be in the file? User data, and no credential by any route.
//   * What happens to the data already here? Replace or merge, and the person
//     is only asked when there is something to lose.
//
// Runs under Electron for the SQLite ABI. The database is real; the file is a
// real file in a temp directory.
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
const {
  applyBackup,
  collectBackup,
  isBackupDocument,
  previewRestore
} = await load("backup/backupDocument.js");
const {
  BackupFormatError,
  BACKUP_EXTENSION,
  defaultBackupFileName,
  inspectBackupFile,
  readBackupFile,
  restoreBackupFile,
  writeBackupFile
} = await load("backup/backupService.js");
const { isSealed } = await load("sync/syncObfuscation.js");
const { fingerprintOwner } = await load("dataOwner.js");
const { hasSyncableData, syncableTables } = await load(
  "sync/syncableStore.js"
);

const tempRoots = [];
function tempDir(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `heracles-${label}-`));
  tempRoots.push(dir);
  return dir;
}

database.initializeDatabase(tempDir("db"));
const db = database.requireDatabase();
const files = tempDir("files");

/** Rows that exist only to be backed up. */
function seedDatabase() {
  for (const table of [
    "chat_sessions",
    "training_activities",
    "downloads",
    "training_collections",
    "generated_routes"
  ]) {
    db.prepare(`DELETE FROM ${table}`).run();
  }
  db.prepare("DELETE FROM app_settings").run();

  db.prepare(
    "INSERT INTO chat_sessions (id, provider, title, messages_json, created_at, updated_at) " +
      "VALUES (?, ?, ?, ?, ?, ?)"
  ).run(
    "s1",
    "claude-code",
    "Marathon block",
    '[{"role":"user","content":"how did I sleep"}]',
    "2026-09-01T00:00:00Z",
    "2026-09-01T00:00:00Z"
  );

  db.prepare(
    "INSERT INTO training_collections (id, name, description, color, created_at, updated_at) " +
      "VALUES (?, ?, ?, ?, ?, ?)"
  ).run("c1", "Base building", null, null, "2026-08-01", "2026-08-01");

  // derived — must never be copied
  db.prepare(
    "INSERT INTO training_activities (activity_id, sport_type, synced_at) VALUES (?, ?, ?)"
  ).run("act-1", 100, "2026-09-01T00:00:00Z");

  // device — absolute paths belonging to this machine only
  db.prepare(
    "INSERT INTO downloads (id, url, title, file_path, size_bytes, created_at) " +
      "VALUES (?, ?, ?, ?, ?, ?)"
  ).run("d1", "https://x", "A track", "/home/me/Music/a.mp3", 1, "2026-09-01");

  // Signed in: a backup belongs to an account, and both directions refuse
  // without one. `userId` is `device` tier, so it is never in the file — what
  // travels is its fingerprint.
  database.setSetting("trainingHub.userId", "coros-user-1");

  database.setSetting("chat.provider", "claude-code"); // preference
  database.setSetting("chat.customInstructions", "Be terse."); // personal
  // Credentials, both kinds: stored in the clear, and sealed by the keychain.
  // Both are `device`, so neither may appear in a backup.
  database.setSetting("spotify.clientId", "spotify-id-123");
  database.setSetting("hevy.apiKey", "k:sealed-to-this-machine");
  database.setSetting("chat.claudeCode.executablePath", "/usr/local/bin/claude");
}

// ===========================================================================
// What the file is allowed to contain
// ===========================================================================

seedDatabase();

{
  const { document, rowCount } = collectBackup({
    deviceId: "device-under-test",
    owner: fingerprintOwner("coros-user-1"),
    localStorage: {
      "coros-theme": "paper", // preference — carried
      "coroslink.sidebarCollapsed": "true" // device — not
    }
  });

  assert.deepEqual(
    Object.keys(document.tables).sort(),
    syncableTables(),
    "every syncable table is present, empty ones included"
  );
  assert.equal(document.tables.chat_sessions.length, 1);
  assert.equal(
    document.tables.training_activities,
    undefined,
    "a derived table is not in the file at all"
  );
  assert.equal(document.tables.downloads, undefined, "nor a device one");
  // Two of the person's own, plus the built-in MCP server every install has.
  assert.equal(rowCount, 3, "one conversation, one collection, one built-in");

  assert.equal(document.settings["chat.provider"], "claude-code");
  assert.equal(document.settings["chat.customInstructions"], "Be terse.");
  for (const credential of [
    "spotify.clientId",
    "hevy.apiKey",
    "chat.claudeCode.executablePath"
  ]) {
    assert.equal(
      credential in document.settings,
      false,
      `${credential} must never be written to a backup`
    );
  }

  assert.deepEqual(
    Object.keys(document.localStorage),
    ["coros-theme"],
    "only the localStorage keys policy allows"
  );

  // The serialised form carries nothing a credential could travel in.
  const serialised = JSON.stringify(document);
  assert.equal(
    /spotify-id-123|k:sealed-to-this-machine/.test(serialised),
    false,
    "no credential value appears anywhere in the payload"
  );
  assert.equal(
    /portableSecrets|includesSecrets/.test(serialised),
    false,
    "and no field one could be reintroduced through"
  );
  assert.equal(
    serialised.includes("coros-user-1"),
    false,
    "the COROS user id itself does not travel — only its fingerprint"
  );
  assert.equal(
    document.owner,
    fingerprintOwner("coros-user-1"),
    "which is what identifies the account"
  );
}
console.log("ok  the file carries user data and nothing else");

// ===========================================================================
// Writing and reading a file
// ===========================================================================

const backupPath = path.join(files, `backup.${BACKUP_EXTENSION}`);

{
  assert.match(
    defaultBackupFileName(new Date("2026-09-08T11:00:00Z")),
    /^heracles-records-backup-2026-09-08\.hrbackup$/,
    "the suggested name sorts by date and does not promise text"
  );

  const written = await writeBackupFile(backupPath, {
    deviceId: "device-under-test",
    localStorage: { "coros-theme": "paper" }
  });

  assert.equal(written.path, backupPath);
  assert.equal(written.rowCount, 3);
  assert.ok(written.bytes > 0);
  assert.deepEqual(
    (await fsp.readdir(files)).sort(),
    [`backup.${BACKUP_EXTENSION}`],
    "the temporary file it writes through is gone afterwards"
  );

  // Sealed on disk. Not encryption — the key ships in the build — but a folder
  // preview, a search index or a glance at the bytes shows nothing.
  const bytes = await fsp.readFile(backupPath);
  assert.ok(isSealed(bytes), "the file on disk is an envelope");
  assert.equal(
    bytes.includes(Buffer.from("Marathon block", "utf8")),
    false,
    "a conversation title does not appear in the bytes"
  );
  assert.equal(
    bytes.includes(Buffer.from("chat_sessions", "utf8")),
    false,
    "nor does a table name"
  );

  const reread = await readBackupFile(backupPath);
  assert.ok(isBackupDocument(reread), "and it opens back into a backup");
  assert.equal(reread.deviceId, "device-under-test");
}
console.log("ok  a backup is sealed on disk and opens back");

{
  const notJson = path.join(files, "notes.hrbackup");
  await fsp.writeFile(notJson, "this is not json", "utf8");
  await assert.rejects(
    () => readBackupFile(notJson),
    (error) => error instanceof BackupFormatError,
    "a file that is not JSON is refused as a format problem"
  );

  const wrongShape = path.join(files, "other.hrbackup");
  await fsp.writeFile(wrongShape, JSON.stringify({ hello: "world" }), "utf8");
  await assert.rejects(
    () => readBackupFile(wrongShape),
    (error) => error instanceof BackupFormatError,
    "so is JSON that is not a backup"
  );

  await assert.rejects(
    () => readBackupFile(path.join(files, "missing.hrbackup")),
    (error) => !(error instanceof BackupFormatError),
    "a missing file is an I/O problem, not a format one"
  );

  // An envelope that will not open — truncated in transit, or edited. Refused
  // as a format problem rather than surfacing a crypto error.
  const damaged = path.join(files, "damaged.hrbackup");
  const intact = await fsp.readFile(backupPath);
  await fsp.writeFile(damaged, intact.subarray(0, intact.length - 8));
  await assert.rejects(
    () => readBackupFile(damaged),
    (error) => error instanceof BackupFormatError,
    "a truncated envelope is refused clearly"
  );
}
console.log("ok  a file that is not a backup is refused clearly");

// ===========================================================================
// Restoring onto an empty machine
// ===========================================================================

{
  for (const table of syncableTables()) db.prepare(`DELETE FROM ${table}`).run();
  db.prepare("DELETE FROM app_settings").run();
  // Still the same account — the sign-in is what makes a restore possible at
  // all, and clearing every setting above took it with everything else.
  database.setSetting("trainingHub.userId", "coros-user-1");
  assert.equal(hasSyncableData(), false, "the machine is empty to begin with");

  // ...and it stays empty with the row every fresh install writes for itself.
  db.prepare(
    "INSERT INTO mcp_servers (id,name,url,transport,auth_type,scope,enabled,builtin,sort_order) " +
      "VALUES (?,?,?,?,?,?,?,1,0)"
  ).run("coros", "COROS", "https://example.invalid", "http", "none", null, 1);
  assert.equal(
    hasSyncableData(),
    false,
    "a built-in MCP server is not something a person made"
  );

  const candidate = await inspectBackupFile(backupPath);
  assert.equal(candidate.ownership, "mine", "the file is this account's");
  assert.equal(
    candidate.machineHasData,
    false,
    "nothing to lose, so nothing to ask"
  );

  const result = await restoreBackupFile(backupPath, "replace");
  assert.equal(result.rowsWritten, 3);
  assert.equal(result.rowsRemoved, 0);
  assert.equal(
    database.getSetting("chat.customInstructions"),
    "Be terse.",
    "the personal setting is back"
  );
  assert.deepEqual(result.localStorage, { "coros-theme": "paper" });
  assert.equal(hasSyncableData(), true);
}
console.log("ok  an empty machine restores without being asked anything");

// ===========================================================================
// A machine that already has data: replace against merge
// ===========================================================================

{
  // This machine's own history, alongside one record the backup also has.
  db.prepare(
    "INSERT INTO chat_sessions (id, provider, title, messages_json, created_at, updated_at) " +
      "VALUES (?, ?, ?, ?, ?, ?)"
  ).run("local-1", "claude-code", "Mine", "[]", "2026-09-05", "2026-09-05");
  db.prepare("UPDATE chat_sessions SET title = ? WHERE id = ?").run(
    "Edited here",
    "s1"
  );
  database.setSetting("chat.customInstructions", "Edited here too.");
  database.setSetting("hevy.apiKey", "still-signed-in");

  const candidate = await inspectBackupFile(backupPath);
  assert.equal(candidate.machineHasData, true, "now there is something to lose");

  // The two previews say different things, which is the whole point of asking.
  assert.equal(
    candidate.merge.rowsRemoved,
    0,
    "merge never reports a removal"
  );
  assert.deepEqual(candidate.merge.settingsRemoved, []);
  assert.ok(
    candidate.replace.rowsRemoved > 0,
    "replace reports the record this machine would lose"
  );
  assert.ok(
    candidate.replace.rowsWriting > candidate.merge.rowsWriting,
    "replace rewrites records merge would leave alone"
  );
}
console.log("ok  the two previews describe genuinely different outcomes");

{
  // --- Merge: additive, and it never overwrites -----------------------------
  const result = await restoreBackupFile(backupPath, "merge");
  assert.equal(result.mode, "merge");
  assert.equal(result.rowsRemoved, 0, "merge removes nothing");
  assert.equal(result.settingsRemoved, 0);

  assert.equal(
    db.prepare("SELECT title FROM chat_sessions WHERE id = ?").get("s1").title,
    "Edited here",
    "a record present on both sides keeps the copy already here"
  );
  assert.ok(
    db.prepare("SELECT id FROM chat_sessions WHERE id = ?").get("local-1"),
    "and this machine's own record survives"
  );
  assert.equal(
    database.getSetting("chat.customInstructions"),
    "Edited here too.",
    "a setting already here is not overwritten either"
  );
  assert.equal(
    database.getSetting("hevy.apiKey"),
    "still-signed-in",
    "and the sign-in is untouched"
  );
}
console.log("ok  merge adds what is missing and overwrites nothing");

{
  // --- Replace: the backup decides in full ---------------------------------
  const result = await restoreBackupFile(backupPath, "replace");
  assert.equal(result.mode, "replace");

  assert.equal(
    db.prepare("SELECT title FROM chat_sessions WHERE id = ?").get("s1").title,
    "Marathon block",
    "the backup's copy wins"
  );
  assert.equal(
    db.prepare("SELECT id FROM chat_sessions WHERE id = ?").get("local-1"),
    undefined,
    "and a record the backup does not have is gone"
  );
  assert.ok(result.rowsRemoved > 0, "which the result reports");
  assert.equal(
    database.getSetting("chat.customInstructions"),
    "Be terse.",
    "the backup's setting wins too"
  );
  assert.equal(
    database.getSetting("hevy.apiKey"),
    "still-signed-in",
    "but a credential is in no tier the backup covers, so it stands"
  );
}
console.log("ok  replace makes this machine match the backup, sign-ins aside");

// ===========================================================================
// Whose data it is
//
// A backup belongs to the COROS account that made it. Restoring one account's
// records into another mixes two people together and cannot be undone — the
// tables carry no owner to sort them by afterwards — so it is refused rather
// than warned about. The override exists for the one case a fingerprint cannot
// tell from a mix-up: this person's own other account.
// ===========================================================================

{
  const otherPath = path.join(files, `other-account.${BACKUP_EXTENSION}`);
  const { document: foreign } = collectBackup({
    deviceId: "someone-elses-laptop",
    owner: fingerprintOwner("coros-user-2"),
    localStorage: {}
  });
  await fsp.writeFile(
    otherPath,
    (await load("sync/syncObfuscation.js")).seal(
      Buffer.from(JSON.stringify(foreign), "utf8"),
      "heracles-records/backup/v1"
    )
  );

  const candidate = await inspectBackupFile(otherPath);
  assert.equal(candidate.ownership, "other", "the file is flagged as foreign");

  await assert.rejects(
    () => restoreBackupFile(otherPath, "merge"),
    (error) => error.code === "wrong-owner",
    "and restoring it is refused, not merely flagged"
  );

  // Refused at the service, not only in the dialog: this is the last point
  // before the write and it is reachable from IPC.
  await assert.rejects(
    () => restoreBackupFile(otherPath, "replace"),
    (error) => error.code === "wrong-owner",
    "in either mode"
  );

  const result = await restoreBackupFile(otherPath, "merge", {
    allowOtherOwner: true
  });
  assert.equal(
    result.mode,
    "merge",
    "the deliberate override goes through"
  );
}
console.log("ok  another account's backup is refused, and overridable on purpose");

{
  // Nobody signed in. Both directions refuse rather than write a file nothing
  // can be checked against, or read one into an account that does not exist.
  const signedIn = database.getSetting("trainingHub.userId");
  database.deleteSettings(["trainingHub.userId"]);

  await assert.rejects(
    () =>
      writeBackupFile(path.join(files, `nobody.${BACKUP_EXTENSION}`), {
        deviceId: "device-under-test",
        localStorage: {}
      }),
    (error) => error.code === "signed-out",
    "saving a backup needs an account"
  );
  await assert.rejects(
    () => inspectBackupFile(backupPath),
    (error) => error.code === "signed-out",
    "and so does opening one"
  );
  await assert.rejects(
    () => restoreBackupFile(backupPath, "replace"),
    (error) => error.code === "signed-out",
    "including the write itself"
  );

  database.setSetting("trainingHub.userId", signedIn);
}
console.log("ok  with nobody signed in, both directions refuse");

// ===========================================================================
// Files from earlier builds: plain JSON, and one that carried credentials
//
// Sealing was added after both. `readBackupFile` opens what arrives sealed and
// passes anything else through, the same asymmetry `ObfuscatedProvider` has, so
// a backup someone saved months ago still restores.
// ===========================================================================

{
  const legacyPath = path.join(files, "legacy.json");
  const legacy = {
    version: 1,
    id: "0123456789abcdef",
    createdAt: "2026-06-01T00:00:00.000Z",
    deviceId: "an-older-machine",
    tables: { chat_sessions: [] },
    settings: {
      "chat.provider": "anthropic",
      "hevy.apiKey": "leaked-from-another-machine",
      "spotify.refreshToken": "also-leaked"
    },
    localStorage: {},
    // Fields this build does not read, and must not start reading.
    includesSecrets: true,
    portableSecrets: { "chat.anthropic.apiKey": "sk-ant-nope" }
  };
  await fsp.writeFile(legacyPath, JSON.stringify(legacy), "utf8");

  const asRead = await readBackupFile(legacyPath);
  assert.equal(
    asRead.deviceId,
    "an-older-machine",
    "a plain-JSON backup from before sealing still opens"
  );

  assert.equal(
    (await inspectBackupFile(legacyPath)).ownership,
    "unknown",
    "a file with no owner is unknown, not foreign — refusing every older " +
      "backup would be a data-loss decision taken on the user's behalf"
  );

  const preview = previewRestore(asRead, "replace");
  assert.ok(
    preview.refused.includes("setting:hevy.apiKey"),
    "a credential in an old backup is refused, not written"
  );
  assert.ok(preview.refused.includes("setting:spotify.refreshToken"));

  await restoreBackupFile(legacyPath, "replace");
  assert.equal(
    database.getSetting("hevy.apiKey"),
    "still-signed-in",
    "this machine's own sign-in is untouched by an old backup"
  );
  assert.equal(
    database.getSetting("chat.anthropic.apiKey"),
    undefined,
    "and portableSecrets is not read at all"
  );
  assert.equal(
    database.getSetting("chat.provider"),
    "anthropic",
    "while its user data restores normally"
  );
}
console.log("ok  an old backup restores its data and none of its credentials");

// ===========================================================================
// A backup from a build with a column this one does not have
// ===========================================================================

{
  const futurePath = path.join(files, "future.json");
  await fsp.writeFile(
    futurePath,
    JSON.stringify({
      version: 1,
      id: "fedcba9876543210",
      createdAt: "2026-12-01T00:00:00.000Z",
      deviceId: "a-newer-machine",
      tables: {
        training_collections: [
          {
            id: "c-future",
            name: "From the future",
            description: null,
            color: null,
            created_at: "2026-12-01",
            updated_at: "2026-12-01",
            // A column this schema has never heard of.
            mood_rating: 9
          }
        ]
      },
      settings: {},
      localStorage: {}
    }),
    "utf8"
  );

  const result = await restoreBackupFile(futurePath, "merge");
  assert.equal(result.rowsWritten, 1, "the row lands");
  assert.equal(
    db.prepare("SELECT name FROM training_collections WHERE id = ?").get(
      "c-future"
    ).name,
    "From the future",
    "with the columns this schema does have"
  );
}
console.log("ok  an unknown column is dropped rather than failing the restore");

for (const dir of tempRoots) {
  await fsp.rm(dir, { recursive: true, force: true });
}
console.log("\nbackup/restore tests passed");
