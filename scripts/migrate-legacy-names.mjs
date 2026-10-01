// One-off: moves what an install stored under the names used before 1.0 to the
// app's own names. Run it once on each machine, with the app closed, before the
// first launch of a 1.0 build:
//
//   npm run migrate:legacy-names              (add -- --dry-run to only report)
//   HERACLES_USER_DATA=/path npm run migrate:legacy-names
//
// The app carries no migration of its own: a 1.0 build opens
// heraclesrecords.sqlite and nothing else, so a machine that starts one first
// gets an empty database. That empty database is set aside here (unless it has
// been signed in to, which this script refuses to decide about).
//
// What moves:
//   - the database, coroslink.sqlite -> heraclesrecords.sqlite, its WAL folded
//     in first so one complete file moves;
//   - the YouTube, YouTube Music and Apple Music sign-ins,
//     Partitions/coroslink-* -> Partitions/heraclesrecords-*;
//   - localStorage keys coroslink.* / coroslink-* -> heraclesrecords.*, in both
//     renderer origins (file:// for `npm start` and packaged builds,
//     http://127.0.0.1:5173 for `npm run dev`). The two place-name caches are
//     dropped instead: they are rebuilt from the geocoder on demand.
//
// Before anything changes, the database (as a VACUUM INTO snapshot) and the
// Local Storage folder are copied to <userData>/pre-rename-backup-<time>/. The
// partitions are only renamed, which renaming back undoes.
//
// Sync needs nothing: the old localStorage names are no longer classified, so
// they neither go out nor come in, and the app publishes the new names on its
// next pass.

import { app, BrowserWindow, session } from "electron";
import Database from "better-sqlite3";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const LEGACY = "coroslink";
const CURRENT = "heraclesrecords";
const DATABASE_LEGACY = `${LEGACY}.sqlite`;
const DATABASE_CURRENT = `${CURRENT}.sqlite`;
const PARTITIONS = ["youtube", "ytmusic", "apple"];
const DROPPED_KEYS = [
  `${LEGACY}.activity-globe.geo-cache.v1`,
  `${LEGACY}.activity-globe.place-labels.v1`
];
const DEV_ORIGIN_PORT = 5173;

const dryRun = process.argv.includes("--dry-run");
const packageJson = JSON.parse(
  fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")
);
app.setName(packageJson.name);
const userData =
  process.env.HERACLES_USER_DATA ?? path.join(app.getPath("appData"), packageJson.name);
app.setPath("userData", userData);
app.disableHardwareAcceleration();
app.on("window-all-closed", () => {});

const log = (line) => console.log(`[migrate] ${line}`);

function fail(message) {
  console.error(`[migrate] ${message}`);
  app.exit(1);
}

function moveFile(from, to) {
  if (fs.existsSync(from)) fs.renameSync(from, to);
}

function signedIn(databasePath) {
  try {
    const db = new Database(databasePath, { readonly: true, fileMustExist: true });
    try {
      return Boolean(
        db.prepare("SELECT 1 FROM app_settings WHERE key = 'trainingHub.userId'").get()
      );
    } finally {
      db.close();
    }
  } catch {
    return false;
  }
}

// Asked before anything is written, the backup folder included.
function refuseDatabaseConflict() {
  const legacy = path.join(userData, DATABASE_LEGACY);
  const current = path.join(userData, DATABASE_CURRENT);
  if (fs.existsSync(legacy) && fs.existsSync(current) && signedIn(current)) {
    throw new Error(
      `both ${DATABASE_LEGACY} and ${DATABASE_CURRENT} exist, and ${DATABASE_CURRENT} has been signed in to COROS. ` +
        `Decide which one to keep by hand; nothing was changed.`
    );
  }
}

function moveDatabase(backupDir) {
  const legacy = path.join(userData, DATABASE_LEGACY);
  const current = path.join(userData, DATABASE_CURRENT);
  if (!fs.existsSync(legacy)) {
    log(`database: no ${DATABASE_LEGACY}, nothing to move`);
    return;
  }
  if (dryRun) {
    log(`database: would move ${DATABASE_LEGACY} to ${DATABASE_CURRENT}` +
      (fs.existsSync(current) ? ` (setting aside the unused ${DATABASE_CURRENT})` : ""));
    return;
  }
  if (fs.existsSync(current)) {
    for (const suffix of ["", "-wal", "-shm"]) {
      moveFile(`${current}${suffix}`, path.join(backupDir, `unused-${DATABASE_CURRENT}${suffix}`));
    }
    log(`database: set the unused ${DATABASE_CURRENT} aside in the backup folder`);
  }

  const db = new Database(legacy, { fileMustExist: true });
  try {
    const snapshot = path.join(backupDir, DATABASE_LEGACY).replaceAll("'", "''");
    db.exec(`VACUUM INTO '${snapshot}'`);
    db.pragma("wal_checkpoint(TRUNCATE)");
  } finally {
    db.close();
  }
  // Sidecars first and the database last, so the database's own rename is
  // what completes the move.
  for (const suffix of ["-wal", "-shm"]) {
    moveFile(`${legacy}${suffix}`, `${current}${suffix}`);
  }
  fs.renameSync(legacy, current);
  log(`database: ${DATABASE_LEGACY} -> ${DATABASE_CURRENT}`);
}

function movePartitions(backupDir) {
  const root = path.join(userData, "Partitions");
  for (const name of PARTITIONS) {
    const legacy = path.join(root, `${LEGACY}-${name}`);
    const current = path.join(root, `${CURRENT}-${name}`);
    if (!fs.existsSync(legacy)) continue;
    if (dryRun) {
      log(`partition: would move ${LEGACY}-${name} to ${CURRENT}-${name}`);
      continue;
    }
    if (fs.existsSync(current)) {
      moveFile(current, path.join(backupDir, `unused-partition-${CURRENT}-${name}`));
    }
    fs.renameSync(legacy, current);
    log(`partition: ${LEGACY}-${name} -> ${CURRENT}-${name}`);
  }
}

// Runs inside the page, so it is passed as source and must stand alone.
function renameKeys(legacy, current, droppedKeys, dryRun) {
  const keys = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key && (key.startsWith(`${legacy}.`) || key.startsWith(`${legacy}-`))) keys.push(key);
  }
  const result = { found: keys.length, moved: 0, dropped: 0, alreadyPresent: 0 };
  for (const key of keys) {
    if (droppedKeys.includes(key)) {
      result.dropped += 1;
      if (!dryRun) localStorage.removeItem(key);
      continue;
    }
    const next = current + key.slice(legacy.length);
    if (localStorage.getItem(next) === null) {
      result.moved += 1;
      if (!dryRun) localStorage.setItem(next, localStorage.getItem(key));
    } else {
      result.alreadyPresent += 1;
    }
    if (!dryRun) localStorage.removeItem(key);
  }
  return result;
}

async function moveStorageKeys(label, load) {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true }
  });
  try {
    await load(win);
    const result = await win.webContents.executeJavaScript(
      `(${renameKeys.toString()})(${JSON.stringify(LEGACY)}, ${JSON.stringify(CURRENT)}, ${JSON.stringify(DROPPED_KEYS)}, ${dryRun})`
    );
    log(
      `localStorage ${label}: ${result.found} old keys — ` +
        `${result.moved} ${dryRun ? "to move" : "moved"}, ` +
        `${result.dropped} cache ${dryRun ? "to drop" : "dropped"}, ` +
        `${result.alreadyPresent} already under the new name`
    );
  } finally {
    win.destroy();
  }
}

async function moveAllStorageKeys() {
  const blank = path.join(os.tmpdir(), `heraclesrecords-migrate-${process.pid}.html`);
  fs.writeFileSync(blank, "<!doctype html><title>migrate</title>");
  try {
    await moveStorageKeys("file://", (win) => win.loadFile(blank));
  } finally {
    fs.rmSync(blank, { force: true });
  }

  const server = http.createServer((_, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end("<!doctype html><title>migrate</title>");
  });
  await new Promise((resolve, reject) => {
    server.once("error", () =>
      reject(new Error(`port ${DEV_ORIGIN_PORT} is in use — stop \`npm run dev\` and run this again`))
    );
    server.listen(DEV_ORIGIN_PORT, "127.0.0.1", resolve);
  });
  try {
    await moveStorageKeys(`http://127.0.0.1:${DEV_ORIGIN_PORT}`, (win) =>
      win.loadURL(`http://127.0.0.1:${DEV_ORIGIN_PORT}/`)
    );
  } finally {
    server.close();
  }
  session.defaultSession.flushStorageData();
}

// Everything up to the localStorage step runs before `ready`, so the Local
// Storage folder is copied before Chromium has opened it.
function prepare() {
  if (!fs.existsSync(userData)) {
    log(`no app data at ${userData}, nothing to do`);
    return false;
  }
  if (!app.requestSingleInstanceLock()) {
    throw new Error("Heracles Records is running on this data folder. Close it and run this again.");
  }
  log(`${dryRun ? "dry run on" : "migrating"} ${userData}`);
  refuseDatabaseConflict();
  let backupDir;
  if (!dryRun) {
    backupDir = path.join(
      userData,
      `pre-rename-backup-${new Date().toISOString().replace(/[:.]/g, "-")}`
    );
    fs.mkdirSync(backupDir);
    const localStorageDir = path.join(userData, "Local Storage");
    if (fs.existsSync(localStorageDir)) {
      fs.cpSync(localStorageDir, path.join(backupDir, "Local Storage"), { recursive: true });
    }
    log(`backup folder: ${backupDir}`);
  }
  moveDatabase(backupDir);
  movePartitions(backupDir);
  return true;
}

let proceed = false;
try {
  proceed = prepare();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

if (proceed) {
  app
    .whenReady()
    .then(moveAllStorageKeys)
    .then(() => {
      log(dryRun ? "dry run finished; nothing was changed" : "done");
      // A moment for the storage flush before the process goes.
      setTimeout(() => app.quit(), 500);
    })
    .catch((error) => fail(error instanceof Error ? error.message : String(error)));
} else {
  app.whenReady().then(() => app.quit());
}
