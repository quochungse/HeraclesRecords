// npm run check:i18n-release
//
// A release ships every language finished, or does not ship. Run by
// release.yml's preflight job before any installer is built, and by
// `npm run release:prepare` before it prints the commands to tag.
//
// It refuses when:
//   - scripts/lib/i18n-pending.json still lists a file (a screen not yet
//     translated), or the scanner finds English anywhere in the renderer;
//   - any language is missing a key English has, or a plural form its own
//     rules use.
//
// test:i18n checks what each message says; this checks that nothing is left.

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { scanRenderer } from "./lib/i18n-coverage.mjs";

const root = path.resolve(import.meta.dirname, "..");
const problems = [];

const pending = JSON.parse(fs.readFileSync(path.join(root, "scripts", "lib", "i18n-pending.json"), "utf8"));
if (pending.length > 0) {
  problems.push(`${pending.length} files are not translated yet (scripts/lib/i18n-pending.json)`);
}
const report = scanRenderer(root);
for (const { file, hits } of report) {
  problems.push(`${file}: ${hits.length} English strings, first at line ${hits[0].line} ("${hits[0].text}")`);
}

const i18n = (relative) => pathToFileURL(path.join(root, "src", "i18n", relative)).href;
const { LOCALES, resolveIntlLocale } = await import(i18n("locales.ts"));
const en = (await import(i18n("messages/en/index.ts"))).default;
const pluralBases = [...new Set(Object.keys(en).filter((k) => k.endsWith("_other")).map((k) => k.slice(0, -6)))];

for (const locale of LOCALES) {
  if (locale === "en") continue;
  let dictionary;
  try {
    dictionary = (await import(i18n(`messages/${locale}/index.ts`))).default;
  } catch (error) {
    problems.push(`${locale}: does not load (${error.message})`);
    continue;
  }
  const missing = Object.keys(en).filter((key) => !(key in dictionary));
  if (missing.length > 0) {
    problems.push(`${locale}: ${missing.length} messages missing, e.g. ${missing.slice(0, 3).join(", ")}`);
  }
  const rules = new Intl.PluralRules(resolveIntlLocale(locale));
  const categories = new Set(Array.from({ length: 1001 }, (_, n) => rules.select(n)));
  for (const base of pluralBases) {
    for (const category of categories) {
      if (!(`${base}_${category}` in dictionary)) problems.push(`${locale}: no ${base}_${category}`);
    }
  }
}

if (problems.length > 0) {
  console.error("Not every language is ready, so this cannot be released:\n");
  for (const problem of problems.slice(0, 40)) console.error(`  - ${problem}`);
  if (problems.length > 40) console.error(`  … and ${problems.length - 40} more`);
  console.error("\nnpm run i18n:coverage lists what is left; docs/i18n-plan.md says how to finish it.");
  process.exit(1);
}
console.log(`i18n release check: ${LOCALES.length} languages complete, nothing left in English.`);
