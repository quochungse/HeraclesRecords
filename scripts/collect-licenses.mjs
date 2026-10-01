// Writes dist/licenses/: the app's own license, the third-party notices, and
// the license text of every npm package and font that ships in the build.
//
// Runs after `vite build` (which empties dist/), as the last step of
// `npm run build:renderer`. electron-builder installs the folder as
// `resources/licenses` (see `extraResources` in package.json), which is how the
// licenses travel with every copy of the app.
//
// Which packages ship is read from package-lock.json: every entry not marked
// `dev`, present on disk. electron-builder packs exactly the production
// dependency tree, and every library the renderer bundles is a production
// dependency here, so the one list covers both processes.

import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const outDir = path.join(repoRoot, "dist", "licenses");
const LICENSE_FILE = /^(licen[cs]e|copying|notice)([-.].*)?$/i;

fs.mkdirSync(outDir, { recursive: true });
fs.copyFileSync(path.join(repoRoot, "LICENSE"), path.join(outDir, "LICENSE.txt"));
fs.copyFileSync(
  path.join(repoRoot, "THIRD_PARTY_NOTICES.md"),
  path.join(outDir, "THIRD_PARTY_NOTICES.md")
);

const rule = "=".repeat(78);
const sections = [];

// --- Fonts -------------------------------------------------------------------

const fontLicenses = path.join(repoRoot, "src", "assets", "fonts", "licenses");
for (const file of fs.readdirSync(fontLicenses).sort()) {
  const family = file.replace(/-OFL\.txt$/, "").replace(/([a-z])([A-Z0-9])/g, "$1 $2");
  sections.push(
    `${rule}\n${family} (font) — SIL Open Font License 1.1\n${rule}\n\n` +
      fs.readFileSync(path.join(fontLicenses, file), "utf8").trim()
  );
}

// --- npm packages ------------------------------------------------------------

const lock = JSON.parse(fs.readFileSync(path.join(repoRoot, "package-lock.json"), "utf8"));
const seen = new Set();
const packages = [];

for (const [location, entry] of Object.entries(lock.packages ?? {})) {
  if (!location || entry.dev) continue;
  const dir = path.join(repoRoot, location);
  const manifestPath = path.join(dir, "package.json");
  if (!fs.existsSync(manifestPath)) continue; // an optional dependency for another platform
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const id = `${manifest.name}@${manifest.version}`;
  if (seen.has(id)) continue;
  seen.add(id);

  const license =
    typeof manifest.license === "string"
      ? manifest.license
      : manifest.license?.type ??
        (Array.isArray(manifest.licenses)
          ? manifest.licenses.map((item) => item.type ?? item).join(" OR ")
          : "UNKNOWN");
  const texts = fs
    .readdirSync(dir)
    .filter((file) => LICENSE_FILE.test(file))
    .sort()
    .map((file) => fs.readFileSync(path.join(dir, file), "utf8").trim())
    .filter(Boolean);

  packages.push({ id, license, texts });
}

packages.sort((a, b) => a.id.localeCompare(b.id));
for (const { id, license, texts } of packages) {
  sections.push(
    `${rule}\n${id} — ${license}\n${rule}\n\n` +
      (texts.length > 0
        ? texts.join("\n\n")
        : `(The package ships no license file; its package.json declares ${license}.)`)
  );
}

const header = [
  "Heracles Records — third-party licenses",
  "",
  "The license texts of the fonts and npm packages that ship inside this build,",
  "generated from package-lock.json at build time. The programs bundled beside the",
  "app (FFmpeg, yt-dlp, the Python runtime) carry their own license files; see",
  "THIRD_PARTY_NOTICES.md in this folder for those and for artwork and data.",
  ""
].join("\n");

fs.writeFileSync(
  path.join(outDir, "THIRD_PARTY_LICENSES.txt"),
  `${header}\n${sections.join("\n\n\n")}\n`
);
console.log(`licenses: ${packages.length} packages and ${fs.readdirSync(fontLicenses).length} fonts written to dist/licenses`);
