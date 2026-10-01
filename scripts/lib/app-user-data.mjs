// Where the app keeps its data, for the scripts that read or write it with the
// app closed (the live-API probes, the Coach sample).
//
// Electron names userData after package.json's top-level `name` — not
// `build.productName`, which it never reads; see CLAUDE.md, which records the
// one time a script guessed otherwise. `HERACLES_USER_DATA` overrides it.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");

/** The database's file name inside userData (`DATABASE_FILE_NAME` in electron/database.ts). */
export const DATABASE_FILE_NAME = "heraclesrecords.sqlite";

export function userDataDir() {
  if (process.env.HERACLES_USER_DATA) return process.env.HERACLES_USER_DATA;
  const { name } = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  if (process.platform === "darwin") return path.join(os.homedir(), "Library/Application Support", name);
  if (process.platform === "win32") return path.join(process.env.APPDATA ?? "", name);
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"), name);
}

export function appDatabasePath() {
  return path.join(userDataDir(), DATABASE_FILE_NAME);
}
