// The latest published release, read once per build from GitHub through the
// same module the README is written from (scripts/lib/release-data.mjs).
//
// A production build that cannot read it fails, so a site with no download
// links is never deployed. The dev server carries on without it (null), so the
// site can be worked on offline.

import { fetchLatestRelease } from "../../scripts/lib/release-data.mjs";

let pending;

export function latestRelease() {
  pending ??= fetchLatestRelease().catch((error) => {
    if (import.meta.env.DEV) {
      console.warn(`[site] no release data: ${error.message}`);
      return null;
    }
    throw error;
  });
  return pending;
}

export function formatReleaseDate(iso) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}
