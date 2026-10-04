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
assert.ok(englishKeys.length > 150, `only ${englishKeys.length} English keys; the loader has drifted`);
for (const locale of LOCALES) {
  const keys = Object.keys(dictionaries[locale]).sort();
  assert.deepEqual(
    keys.filter((key) => !(key in en)),
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

for (const locale of LOCALES) {
  for (const key of englishKeys) {
    const message = dictionaries[locale][key];
    assert.equal(typeof message, "string", `${locale} ${key} is not a string`);
    assert.ok(message.trim().length > 0, `${locale} ${key} is empty`);
    assert.deepEqual(
      placeholders(message),
      placeholders(en[key]),
      `${locale} ${key}: placeholders differ from English ("${message}")`
    );
    assert.deepEqual(
      tags(message),
      tags(en[key]),
      `${locale} ${key}: tags differ from English ("${message}")`
    );
    // A tag that opens must close, in order, never nested: renderRich draws
    // nothing else.
    assert.doesNotMatch(
      message.replace(/<([a-z]+)>[^<]*<\/\1>/g, ""),
      /<\/?[a-z]+>/,
      `${locale} ${key}: an unbalanced or nested tag ("${message}")`
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
    for (const category of categories) {
      // A form English does not have, the language falls back to `_other` for;
      // only `other` and a form English itself states have keys to check.
      if (category !== "other" && !(`${base}_${category}` in en)) continue;
      assert.ok(
        `${base}_${category}` in dictionaries[locale],
        `${locale} has no ${base}_${category}`
      );
    }
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

await core.switchLocaleForTest("en");

// --- 6. Translated files stay translated ----------------------------------------
//
// The files a phase has gone through. Text written straight into one of them
// is English on every language's screen, and nothing else would notice.
// Add a file here when its screen is translated (docs/i18n-plan.md).

const TRANSLATED_FILES = [
  "src/components/AppSidebar.tsx",
  "src/components/AppUpdateControls.tsx",
  "src/navigation/primaryNav.ts",
  "src/settings/BackupPanel.tsx",
  "src/settings/BackupRestoreModal.tsx",
  "src/settings/ReportIssueDialog.tsx",
  "src/settings/SettingsView.tsx",
  "src/settings/SyncPanel.tsx",
  "src/training/components/CorosConnectionRow.tsx",
];

// Words that are the same in every language: names, not text.
const UNTRANSLATED_ON_PURPOSE = new Set(["Heracles Records"]);

const strip = (source) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

for (const file of TRANSLATED_FILES) {
  const source = strip(fs.readFileSync(path.join(repoRoot, file), "utf8"));
  const found = [];

  // Text between tags: `>Sign in<`, or a line of JSX text on its own.
  // Not after `=` or `-`: `=> Promise<void>` is a type, not text.
  for (const match of source.matchAll(/(?<![=-])>\s*([^<>{}]*[A-Za-z]{2,}[^<>{}]*?)\s*</g)) {
    const text = match[1].trim();
    if (text && !UNTRANSLATED_ON_PURPOSE.has(text) && !/^[\w.-]+=/.test(text) && !/[;=()]/.test(text)) {
      found.push(text);
    }
  }
  // A visible attribute or option written as a literal.
  for (const match of source.matchAll(
    /\b(title|label|detail|placeholder|aria-label|description)(?:=|:\s*)"([^"]*[A-Za-z][^"]*)"/g
  )) {
    if (!UNTRANSLATED_ON_PURPOSE.has(match[2])) found.push(`${match[1]}="${match[2]}"`);
  }

  assert.deepEqual(found, [], `${file} has text that is not translated`);
}

console.log(
  `i18n: ${englishKeys.length} keys in ${LOCALES.length} languages, ` +
    `${pluralBases.length} plurals, ${TRANSLATED_FILES.length} files held translated`
);
