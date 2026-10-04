// The latest published release, read once per build from GitHub through the
// same module the README is written from (scripts/lib/release-data.mjs).
//
// In CI a build that cannot read it fails, so a site with no download links is
// never deployed. On a developer's machine the last answer is kept in
// .astro/release-cache.json and used when GitHub will not answer: its API
// allows 60 unauthenticated requests an hour, and a few builds use them up.
// With no cache either, the dev server carries on without release data (null).

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fetchLatestRelease } from "../../scripts/lib/release-data.mjs";

// From the working directory, which is site/ for every npm script: in a build
// this module runs from a bundled chunk, so import.meta.url points elsewhere.
const cacheFile = join(process.cwd(), ".astro", "release-cache.json");

function readCache() {
  try {
    return JSON.parse(readFileSync(cacheFile, "utf8"));
  } catch {
    return null;
  }
}

let pending;

export function latestRelease() {
  pending ??= fetchLatestRelease().then(
    (release) => {
      try {
        mkdirSync(dirname(cacheFile), { recursive: true });
        writeFileSync(cacheFile, JSON.stringify(release, null, 2));
      } catch {
        // A cache that cannot be written only costs the next build a request.
      }
      return release;
    },
    (error) => {
      if (process.env.CI) throw error;
      const cached = readCache();
      if (cached) {
        console.warn(`[site] ${error.message}; using the release read earlier (${cached.tag})`);
        return cached;
      }
      if (import.meta.env.DEV) {
        console.warn(`[site] no release data: ${error.message}`);
        return null;
      }
      throw error;
    },
  );
  return pending;
}

export function formatReleaseDate(iso) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}
