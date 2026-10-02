import { app, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import { DATABASE_FILE_NAME } from "./database";
import type { AppInfo, AppStorageLocation } from "./types";

interface StorageLocationSpec {
  id: string;
  label: string;
  description: string;
  kind: "directory" | "file";
  resolvePath: () => string;
}

// The renderer only ever passes a location id back, so folder access stays
// limited to this fixed allowlist.
const STORAGE_LOCATION_SPECS: StorageLocationSpec[] = [
  {
    id: "database",
    label: "Database",
    description:
      "SQLite database holding your training records, plans and coach sessions.",
    kind: "file",
    resolvePath: () => path.join(app.getPath("userData"), DATABASE_FILE_NAME)
  },
  {
    id: "user-data",
    label: "App data folder",
    description:
      "Everything Heracles Records stores on this computer, including settings and credentials.",
    kind: "directory",
    resolvePath: () => app.getPath("userData")
  }
];

async function directorySizeBytes(target: string): Promise<number> {
  const entries = await fs.promises.readdir(target, { withFileTypes: true });
  let total = 0;

  for (const entry of entries) {
    const entryPath = path.join(target, entry.name);
    try {
      if (entry.isDirectory()) {
        total += await directorySizeBytes(entryPath);
      } else if (entry.isFile()) {
        total += (await fs.promises.stat(entryPath)).size;
      }
    } catch {
      // Files can disappear mid-scan; skip them.
    }
  }

  return total;
}

async function describeStorageLocation(
  spec: StorageLocationSpec
): Promise<AppStorageLocation> {
  const target = spec.resolvePath();
  let exists = false;
  let sizeBytes: number | null = null;

  try {
    const stats = await fs.promises.stat(target);
    exists = true;
    sizeBytes =
      spec.kind === "directory" ? await directorySizeBytes(target) : stats.size;
  } catch {
    // Missing locations are reported with exists=false.
  }

  return {
    id: spec.id,
    label: spec.label,
    description: spec.description,
    path: target,
    kind: spec.kind,
    exists,
    sizeBytes
  };
}

export async function getAppInfo(): Promise<AppInfo> {
  const storageLocations = await Promise.all(
    STORAGE_LOCATION_SPECS.map(describeStorageLocation)
  );

  return {
    version: app.getVersion(),
    userDataPath: app.getPath("userData"),
    storageLocations
  };
}

export async function openAppStorageLocation(id: string): Promise<void> {
  const spec = STORAGE_LOCATION_SPECS.find((entry) => entry.id === id);
  if (!spec) {
    throw new Error(`Unknown storage location: ${id}`);
  }

  const target = spec.resolvePath();

  if (spec.kind === "file") {
    if (!fs.existsSync(target)) {
      throw new Error("That file has not been created yet.");
    }
    shell.showItemInFolder(target);
    return;
  }

  await fs.promises.mkdir(target, { recursive: true });
  const failure = await shell.openPath(target);
  if (failure) {
    throw new Error(failure);
  }
}
