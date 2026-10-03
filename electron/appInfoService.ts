import { app } from "electron";
import type { AppInfo } from "./types";

// Settings used to list the database and the data folder here, with their sizes
// and an "Open in Folder" button, on a Storage page of its own. It was removed
// on 2026-10-03 as nothing an athlete needs — and it walked the whole userData
// tree for a size every time Settings opened.
export async function getAppInfo(): Promise<AppInfo> {
  return {
    version: app.getVersion(),
    userDataPath: app.getPath("userData")
  };
}
