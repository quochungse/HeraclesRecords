// Prints the CHANGELOG.md section for a release tag, as the GitHub release's
// text. `node scripts/release-notes.mjs v1.0.0 > release-notes.md`
//
// A section is a `## [x.y.z]` heading (Keep a Changelog) and everything under
// it up to the next `## ` heading. Fails when the tag has no section: a release
// with an empty description is a step that was skipped, not a quiet default.

import fs from "node:fs";
import path from "node:path";

const tag = process.argv[2] ?? "";
const version = tag.replace(/^v/, "");
if (!/^\d+\.\d+\.\d+/.test(version)) {
  console.error(`Expected a release tag like v1.0.0, got "${tag}".`);
  process.exit(1);
}

const changelog = fs.readFileSync(
  path.resolve(import.meta.dirname, "..", "CHANGELOG.md"),
  "utf8"
);
const lines = changelog.split(/\r?\n/);
const escaped = version.replace(/[.+]/g, "\\$&");
const start = lines.findIndex((line) => new RegExp(`^## \\[?${escaped}\\]?(\\s|$)`).test(line));
if (start === -1) {
  console.error(`CHANGELOG.md has no section for ${version}.`);
  process.exit(1);
}
const end = lines.findIndex((line, index) => index > start && /^## /.test(line));
const body = lines.slice(start + 1, end === -1 ? undefined : end).join("\n").trim();
process.stdout.write(`${body}\n`);
