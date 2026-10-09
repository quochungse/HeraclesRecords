// Which format of the vault this build can read and write.
//
// The vault says which format it is in through two numbers in `vault/id.json`
// (see docs/sync-v2.md §3):
//
//   * `dataVersion` — the newest format written to it;
//   * `dataVersionCompat` — the oldest format that can still read and write
//     safely alongside what is there.
//
// This build writes `DATA_VERSION` and promises that a build of
// `DATA_VERSION_COMPAT` or later can work beside it. They are format numbers,
// not the app's version: the app is released often and the format rarely
// changes.
//
// When the format changes:
//   * an additive change — something an older build skips without harm, and
//     overwrites without losing — raises `DATA_VERSION` and leaves
//     `DATA_VERSION_COMPAT` alone;
//   * anything else raises both, to the same number.
//
// Node-free, so the renderer can word the verdict with the same rule.

import type { DataFormatVerdict } from "./syncTypes";

export type { DataFormatVerdict };

export const DATA_VERSION = 1;
export const DATA_VERSION_COMPAT = 1;

export interface DataFormat {
  readonly dataVersion: number;
  readonly dataVersionCompat: number;
}

export const BUILD_DATA_FORMAT: DataFormat = {
  dataVersion: DATA_VERSION,
  dataVersionCompat: DATA_VERSION_COMPAT
};

const positiveInteger = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : null;

/**
 * The format a vault's identity declares. A vault from before the numbers
 * existed is format 1, as every vault then was. A compat above the version is
 * read as the version: nothing can be required that was never written.
 */
export function vaultDataFormat(identity: unknown): DataFormat {
  const record =
    identity && typeof identity === "object"
      ? (identity as Record<string, unknown>)
      : {};
  const dataVersion = positiveInteger(record.dataVersion) ?? 1;
  const compat = positiveInteger(record.dataVersionCompat) ?? 1;
  return { dataVersion, dataVersionCompat: Math.min(compat, dataVersion) };
}

export function dataFormatVerdict(
  vault: DataFormat,
  build: DataFormat = BUILD_DATA_FORMAT
): DataFormatVerdict {
  if (build.dataVersion > vault.dataVersion) return "ahead";
  if (build.dataVersion === vault.dataVersion) return "current";
  return build.dataVersion >= vault.dataVersionCompat ? "behind" : "outdated";
}
