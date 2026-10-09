// npm run test:i18n
//
// What the type checker cannot see about the translations (src/i18n).
//
// `npm run build` already fails on a key missing from a language or one it
// invented: each language's namespace is typed against English's. What it
// cannot see is what the strings say — a translation that dropped `{count}`
// or renamed `<b>` typechecks and then prints a hole on screen. So this holds:
//
//   1. every language has exactly English's keys, at runtime too;
//   2. every message keeps English's placeholders and tags, and nothing else;
//   3. every plural has each form the language's own rules ask for;
//   4. every language has a flag, a native name and an Intl locale that works;
//   5. the runtime: lookup, fallback, plurals, interpolation and digits;
//   6. the files already translated stay translated — no English string
//      written straight into their JSX or their labels.
//
// Runs through Electron's Node (strip-types needs Amaro, which Electron ships;
// see CLAUDE.md), so it behaves the same on a distro Node.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const i18nDir = path.join(repoRoot, "src", "i18n");
const load = (relative) =>
  import(`${pathToFileURL(path.join(i18nDir, relative)).href}?cacheBust=${Date.now()}`);

const { LOCALES, LOCALE_DETAILS, resolveIntlLocale } = await load("locales.ts");
const core = await load("core.ts");
const en = (await load("messages/en/index.ts")).default;

const dictionaries = {};
for (const locale of LOCALES) {
  dictionaries[locale] = (await load(`messages/${locale}/index.ts`)).default;
}

const placeholders = (message) => [...message.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const tags = (message) => [...message.matchAll(/<\/?([a-z]+)>/g)].map((m) => m[0]).sort();

// --- 1. Keys --------------------------------------------------------------------

const englishKeys = Object.keys(en).sort();
const isExtraPluralForm = (key) =>
  /_(zero|two|few|many)$/.test(key) && `${key.replace(/_[a-z]+$/, "")}_other` in en;
assert.ok(englishKeys.length > 150, `only ${englishKeys.length} English keys; the loader has drifted`);
for (const locale of LOCALES) {
  const keys = Object.keys(dictionaries[locale]).sort();
  assert.deepEqual(
    keys.filter((key) => !(key in en) && !isExtraPluralForm(key)),
    [],
    `${locale} has keys English does not`
  );
  assert.deepEqual(
    englishKeys.filter((key) => !(key in dictionaries[locale])),
    [],
    `${locale} is missing keys`
  );
}

// --- 2. Placeholders and tags -----------------------------------------------------

const formOf = (locale, key) =>
  Object.keys(dictionaries[locale]).filter(
    (other) => other === key || (isExtraPluralForm(other) && other.replace(/_[a-z]+$/, "_other") === key)
  );

for (const locale of LOCALES) {
  for (const key of englishKeys.flatMap((english) => formOf(locale, english).map((own) => [english, own]))) {
    const [englishKey, ownKey] = key;
    const message = dictionaries[locale][ownKey];
    assert.equal(typeof message, "string", `${locale} ${ownKey} is not a string`);
    assert.ok(message.trim().length > 0, `${locale} ${ownKey} is empty`);
    assert.deepEqual(
      placeholders(message),
      placeholders(en[englishKey]),
      `${locale} ${ownKey}: placeholders differ from English ("${message}")`
    );
    assert.deepEqual(
      tags(message),
      tags(en[englishKey]),
      `${locale} ${ownKey}: tags differ from English ("${message}")`
    );
    // A tag that opens must close, in order, never nested: renderRich draws
    // nothing else.
    assert.doesNotMatch(
      message.replace(/<([a-z]+)>[^<]*<\/\1>/g, ""),
      /<\/?[a-z]+>/,
      `${locale} ${ownKey}: an unbalanced or nested tag ("${message}")`
    );
  }
}

// --- 3. Plurals -----------------------------------------------------------------

const pluralBases = [
  ...new Set(englishKeys.filter((key) => /_(zero|one|two|few|many|other)$/.test(key)).map((key) => key.replace(/_[a-z]+$/, "")))
];
assert.ok(pluralBases.length > 0, "no plural messages found");
for (const base of pluralBases) {
  assert.ok(`${base}_other` in en, `${base} has no _other form in English`);
}
for (const locale of LOCALES) {
  const rules = new Intl.PluralRules(resolveIntlLocale(locale));
  const categories = new Set();
  for (let count = 0; count <= 1000; count += 1) categories.add(rules.select(count));
  for (const base of pluralBases) {
    // Every form the language's own rules produce for a whole number: Russian
    // needs `_few` and `_many`, which English never states.
    for (const category of categories) {
      assert.ok(
        `${base}_${category}` in dictionaries[locale],
        `${locale} has no ${base}_${category}`
      );
    }
    assert.ok(`${base}_other` in dictionaries[locale], `${locale} has no ${base}_other`);
  }
}

// --- 4. Every language can be offered ----------------------------------------------

for (const locale of LOCALES) {
  const detail = LOCALE_DETAILS[locale];
  assert.ok(detail.nativeName && detail.englishName, `${locale} has no names`);
  assert.doesNotThrow(() => new Intl.DateTimeFormat(detail.defaultIntl), `${locale}'s Intl locale`);
}
const flagSource = fs.readFileSync(path.join(i18nDir, "LanguageFlag.tsx"), "utf8");
for (const [, file] of flagSource.matchAll(/from "\.\.\/assets\/flags\/([a-z]+\.svg)"/g)) {
  assert.ok(fs.existsSync(path.join(repoRoot, "src", "assets", "flags", file)), `missing flag ${file}`);
}
const flagKeys = [...flagSource.matchAll(/^\s{2}([a-z]{2})(?::|,)/gm)].map((m) => m[1]).sort();
assert.deepEqual(flagKeys, [...LOCALES].sort(), "LanguageFlag has a flag for every language");
assert.ok(
  fs.existsSync(path.join(repoRoot, "src", "assets", "flags", "LICENSE-flag-icons.txt")),
  "the flags' MIT license ships beside them"
);

// The system's own regional variant wins; a Traditional Chinese system does not
// date a Simplified screen.
assert.equal(resolveIntlLocale("en", ["en-AU", "vi-VN"]), "en-AU");
assert.equal(resolveIntlLocale("en", ["vi-VN"]), "en-US");
assert.equal(resolveIntlLocale("de", ["de-CH"]), "de-CH");
assert.equal(resolveIntlLocale("zh", ["zh-TW"]), "zh-CN");
assert.equal(resolveIntlLocale("zh", ["zh-SG"]), "zh-SG");
assert.equal(resolveIntlLocale("vi", ["en-US"]), "vi-VN");

// --- 5. The runtime -------------------------------------------------------------

assert.equal(core.getLocale(), "en", "the app opens in English");
assert.equal(core.t("nav.settings"), "Settings");
assert.equal(core.plural("report.count", 1), "1 error recorded in the last 7 days.");
assert.equal(core.plural("report.count", 3), "3 errors recorded in the last 7 days.");
assert.equal(core.t("settings.mcp.connected", { connected: 2, total: 3 }), "2 of 3 connected.");
// An unknown placeholder is left showing rather than printing "undefined".
assert.equal(core.interpolate("{a} and {b}", { a: 1 }), "1 and {b}");
assert.equal(core.t("no.such.key"), "no.such.key");

await core.switchLocaleForTest("vi");
assert.equal(core.getLocale(), "vi");
assert.equal(core.t("nav.settings"), "Cài đặt");
// Vietnamese has one form; one and many read the same sentence.
assert.equal(core.plural("report.count", 1), "Có 1 lỗi trong 7 ngày qua.");
assert.equal(core.english("nav.settings"), "Settings", "english() ignores the language on screen");

await core.switchLocaleForTest("de");
// Digits in the language's own grouping.
assert.equal(core.plural("sync.changes.waiting", 1234), "1.234 Änderungen warten auf den Versand.");
assert.equal(core.plural("sync.changes.waiting", 1), "1 Änderung wartet auf den Versand.");

await core.switchLocaleForTest("fr");
// French reads 0 as singular.
assert.equal(core.plural("report.count", 0), "0 erreur enregistrée ces 7 derniers jours.");

await core.switchLocaleForTest("ru");
// Russian counts 1, 2–4 and 5+ apart, and 21 is singular again.
assert.equal(core.plural("sync.changes.waiting", 1), "1 изменение ждёт отправки.");
assert.equal(core.plural("sync.changes.waiting", 3), "3 изменения ждут отправки.");
assert.equal(core.plural("sync.changes.waiting", 5), "5 изменений ждут отправки.");
assert.equal(core.plural("sync.changes.waiting", 21), "21 изменение ждёт отправки.");

await core.switchLocaleForTest("en");

// --- 5b. The labours say in English what the website says ---------------------
//
// src/records/labours.ts stays English because the website imports it; the app
// names a labour through records.labour.* (src/records/labourWords.ts). The two
// must agree, or the app and the site describe different stages.

{
  const { LABOURS } = await import(pathToFileURL(path.join(repoRoot, "src", "records", "labours.ts")).href);
  for (const labour of LABOURS) {
    for (const field of ["name", "short", "category", "myth"]) {
      assert.equal(en[`records.labour.${labour.id}.${field}`], labour[field], `records.labour.${labour.id}.${field}`);
    }
    labour.stages.forEach((stage, index) => {
      assert.equal(en[`records.labour.${labour.id}.stage${index + 1}`], stage, `records.labour.${labour.id}.stage${index + 1}`);
    });
  }
}

// --- 6. Translated files stay translated ----------------------------------------
//
// A ratchet over the whole renderer (scripts/lib/i18n-coverage.mjs). Every file
// with English still written into it is listed in i18n-pending.json; a file
// not listed must stay clean, and a listed file that has become clean must
// leave the list. check-i18n-release refuses a release while the list holds
// anything.

const { scanRenderer } = await import(
  pathToFileURL(path.join(repoRoot, "scripts", "lib", "i18n-coverage.mjs")).href
);
const pending = new Set(
  JSON.parse(fs.readFileSync(path.join(repoRoot, "scripts", "lib", "i18n-pending.json"), "utf8"))
);
const report = scanRenderer(repoRoot);
const dirty = new Map(report.map(({ file, hits }) => [file, hits]));

const regressions = report.filter(({ file }) => !pending.has(file));
assert.deepEqual(
  regressions.map(({ file, hits }) => `${file}: ${hits.slice(0, 5).map((hit) => `${hit.line} "${hit.text}"`).join(", ")}`),
  [],
  "English written into a translated file (translate it, or mark a line that is not text with i18n-ignore)"
);
assert.deepEqual(
  [...pending].filter((file) => !dirty.has(file)).sort(),
  [],
  "files translated since: take them out of scripts/lib/i18n-pending.json"
);

const remaining = report.reduce((sum, { hits }) => sum + hits.length, 0);
console.log(
  `i18n: ${englishKeys.length} keys in ${LOCALES.length} languages, ` +
    `${pluralBases.length} plurals; ${pending.size} files (${remaining} strings) still to translate`
);
