// Finds English written straight into the renderer: text the athlete would
// read in English whatever language they picked. Shared by test:i18n (which
// holds the files already translated) and check-i18n-release (which holds all
// of them, before a release).
//
// It looks for three shapes:
//   JSX text            <span>Sign in</span>
//   a visible prop      title="Close"  label: "Running"  placeholder="Search"
//   a sentence literal  "Could not load app info."  `Saved ${n} records`
//
// A sentence literal is a string with two words or more that starts with a
// capital letter or ends with sentence punctuation. What looks like one and is
// not text — a log line, a selector, a COROS field, a test id — is passed over
// by the patterns below, or marked on its line with `i18n-ignore` and the
// reason.

import fs from "node:fs";
import path from "node:path";

export const SKIPPED_PATHS = [
  /[\\/]src[\\/]i18n[\\/]messages[\\/]/,
  // Development builds only: the developer toolbar and the sample presets it
  // switches between. A packaged build never draws them.
  /[\\/]src[\\/]components[\\/]DeveloperToolbar\.tsx$/,
  /[\\/]src[\\/]records[\\/]sampleRecords\.ts$/,
  /[\\/]src[\\/]vite-env\.d\.ts$/,
  /[\\/]src[\\/]heraclesrecords-api\.ts$/,
  /\.d\.ts$/,
];

// Words that are the same in every language: names, not text.
export const NAMES = new Set([
  "Heracles Records",
  "COROS",
  "Google Drive",
  "Hevy",
  "Strava",
  "GitHub",
  "OpenRouter",
  "ChatGPT",
  "Claude",
  "Claude Code",
  "Ollama",
  "LM Studio",
  "MCP",
]);

function stripComments(source) {
  // Block comments, JSX comments and line comments, keeping line numbers.
  const blank = (match) => match.replace(/[^\n]/g, " ");
  return source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, blank)
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:"'`\\])\/\/.*$/gm, (match, lead) => lead + " ".repeat(match.length - lead.length));
}

const lineOf = (source, index) => source.slice(0, index).split("\n").length;

/** A literal that reads as a sentence or a label someone would read. */
// A unit symbol is the same in every language (km, bpm, W, GB).
const UNITS = /^(px|em|rem|%|ms|s|min|h|B|KB|MB|GB|km|mi|m|ft|yd|kg|lb|bpm|rpm|spm|W|kJ|kcal|cal|°C|°F|m\/h|km\/h|mph|ft\/h|\/km|\/mi|x|×)$/;

function looksLikeText(value) {
  // What is left once the values and the names are taken out.
  let bare = value.replace(/\$\{[^}]*\}/g, " ");
  for (const name of NAMES) bare = bare.split(name).join(" ");
  bare = bare.replace(/[\s·:,/()–—-]+/g, " ").trim();
  if (!/[A-Za-z]{2,}/.test(bare) || bare.split(" ").every((word) => UNITS.test(word) || !/[A-Za-z]{2,}/.test(word))) {
    return false;
  }
  if (/^\((max|min|prefers|hover|pointer|orientation)[\w-]*:/.test(value.trim())) return false; // a media query
  const text = value.replace(/\$\{[^}]*\}/g, "X").trim();
  if (text.length < 3) return false;
  if (NAMES.has(text)) return false;
  if (!/[A-Za-z]{2,}/.test(text)) return false;
  // Code, not prose.
  if (/^[a-z][\w.-]*$/.test(text)) return false; // an id or a key
  if (/^[\w-]+(\.[\w-]+)+$/.test(text)) return false; // dotted key
  if (/[{};<>=]|=>|\|\||&&/.test(text)) return false;
  if (/^(https?:|mailto:|data:|file:|#|\.|\/|\[|@|--|\^)/.test(text)) return false;
  if (/^[\w-]+:\s*[\w#(-]/.test(text) && !/\s{1}\w+\s\w+/.test(text.split(":")[1] ?? "")) return false; // css-ish
  if (/^(M|L|C|Q|H|V|Z)[\d\s.,-]/.test(text)) return false; // svg path
  if (/^[A-Z_][A-Z0-9_]+$/.test(text)) return false; // CONSTANT
  if (/^[a-z-]+(\s[a-z-]+)+$/.test(text) && !/\s(the|a|an|of|to|in|on|for|and|or|is|are|was|not|no|with|from|by|this|that|your|you)\s/.test(` ${text} `)) {
    return false; // a run of class names
  }
  const words = text.split(/\s+/).filter((word) => /[A-Za-z]/.test(word));
  if (words.length >= 2) return /^[A-Z¿¡"“‘(]/.test(text) || /[.!?…:]$/.test(text) || /\s(the|a|of|to|your|you|is|not|no)\s/.test(` ${text} `);
  // One word: only as a capitalised label (Running, Close, Save).
  return /^[A-Z][a-z]+(['’][a-z]+)?[.…!?]?$/.test(text);
}

const PROP = /\b(title|label|detail|placeholder|aria-label|aria-description|alt|description|emptyLabel|helper|hint|caption|heading|tooltip|summary|message)(=|:\s*)"([^"\n]*)"/g;
const JSX_TEXT = /(?<![=-])>([^<>{}]*[A-Za-z]{2,}[^<>{}]*)</g;
const LITERAL = /(["'`])((?:\\.|(?!\1)[^\\\n])*)\1/g;

const IGNORED_LINE = /i18n-ignore|console\.(log|warn|error|info|debug)|import\s|from\s+["']|require\(|querySelector|className|data-[\w-]+=|new RegExp|\.test\(|\.match\(|localStorage|addEventListener|dispatchEvent|matchMedia|setAttribute|getPropertyValue|setProperty|style=|\bkey=|typeof |case "|=== "|!== "|\.startsWith\(|\.endsWith\(|\.includes\(|\.replace\(|invoke\(|ipcRenderer|defineSelectionPreference|type:\s*"|kind:\s*"|status:\s*"|mode:\s*"|tone:\s*"|variant:\s*"|role="|id="|htmlFor=|name="|href=|src=|rel="|target="|lang=|fill="|stroke|viewBox|transform|d="|font-|grid-template|cubic-bezier|@keyframes/;

/** Every untranslated string in one file, as { line, text }. */
export function scanSource(source) {
  const clean = stripComments(source);
  const lines = clean.split("\n");
  const original = source.split("\n");
  const found = new Map();
  const add = (index, text) => {
    const line = lineOf(clean, index);
    if (/i18n-ignore/.test(original[line - 1] ?? "") || /i18n-ignore/.test(original[line - 2] ?? "")) return;
    const key = `${line}:${text}`;
    if (!found.has(key)) found.set(key, { line, text });
  };

  for (const match of clean.matchAll(JSX_TEXT)) {
    const text = match[1].replace(/\s+/g, " ").trim();
    if (!text || NAMES.has(text)) continue;
    if (/[;=()[\]]|=>|\b(const|return|function|if|else)\b/.test(text)) continue;
    if (!/[A-Za-z]{2,}/.test(text)) continue;
    add(match.index, text);
  }

  for (const match of clean.matchAll(PROP)) {
    const value = match[3];
    if (NAMES.has(value) || !/[A-Za-z]{2,}/.test(value)) continue;
    if (/^[a-z][\w.-]*$/.test(value)) continue;
    add(match.index, `${match[1]}="${value}"`);
  }

  for (const match of clean.matchAll(LITERAL)) {
    const line = lines[lineOf(clean, match.index) - 1] ?? "";
    if (IGNORED_LINE.test(line)) continue;
    // A prop already reported above.
    if (/\b(title|label|detail|placeholder|aria-label|alt|description)(=|:\s*)$/.test(clean.slice(Math.max(0, match.index - 20), match.index))) continue;
    // `t("key")`, `plural("key")` and friends.
    if (/\b(t|plural|rich|richPlural|english|tn)\(\s*$/.test(clean.slice(Math.max(0, match.index - 14), match.index))) continue;
    if (looksLikeText(match[2])) add(match.index, match[2]);
  }

  return [...found.values()].sort((a, b) => a.line - b.line);
}

export function rendererFiles(root) {
  const srcDir = path.join(root, "src");
  const walk = (dir) =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return walk(full);
      return /\.tsx?$/.test(entry.name) ? [full] : [];
    });
  return walk(srcDir).filter((file) => !SKIPPED_PATHS.some((pattern) => pattern.test(file)));
}

/** { file (repo-relative, forward slashes), hits } for every file with something left. */
export function scanRenderer(root) {
  return rendererFiles(root)
    .map((file) => ({
      file: path.relative(root, file).split(path.sep).join("/"),
      hits: scanSource(fs.readFileSync(file, "utf8")),
    }))
    .filter((entry) => entry.hits.length > 0);
}

// Run directly: a report, worst file first.  node scripts/lib/i18n-coverage.mjs [filter]
if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, "/").replace(/^\//, "")}` || process.argv[1]?.endsWith("i18n-coverage.mjs")) {
  const root = path.resolve(import.meta.dirname, "..", "..");
  const filter = process.argv[2];
  const verbose = process.argv.includes("-v");
  const report = scanRenderer(root).filter((entry) => !filter || filter.startsWith("-") || entry.file.includes(filter));
  report.sort((a, b) => b.hits.length - a.hits.length);
  let total = 0;
  for (const { file, hits } of report) {
    total += hits.length;
    console.log(`${String(hits.length).padStart(4)}  ${file}`);
    if (verbose) for (const hit of hits) console.log(`        ${hit.line}: ${hit.text}`);
  }
  console.log(`${total} strings in ${report.length} files`);
}
