// Rewrites the README's download badges and table from the latest published
// GitHub release (scripts/lib/release-data.mjs). release.yml runs it once the
// release is published, because the installer sizes exist only then, and
// commits the result to main.
//
//   node scripts/update-readme-release.mjs           write README.md
//   node scripts/update-readme-release.mjs --check   exit 1 if README.md is stale

import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchLatestRelease, updateReadme } from "./lib/release-data.mjs";

const readmePath = join(dirname(fileURLToPath(import.meta.url)), "..", "README.md");
const check = process.argv.includes("--check");

const release = await fetchLatestRelease();
const before = readFileSync(readmePath, "utf8");
const after = updateReadme(before, release);

if (after === before) {
  console.log(`README.md already states ${release.tag}.`);
} else if (check) {
  console.error(`README.md does not state ${release.tag}: run node scripts/update-readme-release.mjs`);
  process.exitCode = 1;
} else {
  writeFileSync(readmePath, after);
  console.log(`README.md now states ${release.tag}.`);
}

// For release.yml's commit message.
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `tag=${release.tag}\n`);
}
