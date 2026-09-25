/**
 * COROS's own string table, for the text it sends as keys.
 *
 * A plan saved from COROS's official catalogue does not carry its words. The
 * plan detail answers `name: "P10035"`, `overview: "P10103"`, a session named
 * `P10281` described as `P11058`, a step named `T1120` — localization keys,
 * which the Training Hub web app resolves in the browser against a string
 * table it loads from its CDN before anything else. Probed 2026-09-23:
 * `P10035` is "Beginner Sprint Distance Triathlon Plan", `P10281` is
 * "30 min z2 ride", `T1120` is "Warm Up", 7,326 keys in all. Without the
 * table the reader showed a plan named P10035 made of sessions named P10281.
 *
 * The table is the same file the web app loads — `static.coros.com`, no
 * account, no token, nothing that could touch a session. It is fetched once,
 * kept beside the database, and refreshed weekly; a launch that cannot reach
 * it reads the copy on disk, and one with neither shows the keys, which is
 * what it did before this existed. `corosText` never waits: callers that want
 * the words `await loadCorosLocale()` first, and everything else reads
 * whatever has already arrived.
 *
 * Only a whole value that *is* a key is replaced. COROS keys are a short
 * upper-case prefix and digits (`P10035`, `T1120`, `TD1030`); a workout the
 * athlete named "P1 tempo" is left alone, and so is a key the table does not
 * hold — rewriting it as something else would be inventing a name.
 */
import fs from "node:fs";
import path from "node:path";

const LOCALE_URL =
  "https://static.coros.com/locale/coros-traininghub-v2/en-US.prod.js";
const REFRESH_MS = 7 * 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15_000;
const KEY_PATTERN = /^[A-Z]{1,3}\d{3,6}$/;

interface StoredLocale {
  fetchedAt: string;
  strings: Record<string, string>;
}

let cacheFile: string | null = null;
let strings: Map<string, string> | null = null;
let loading: Promise<void> | null = null;

/** Where the table lives. Called once at start-up; suites use a temp dir. */
export function initializeCorosLocale(userDataPath: string): void {
  cacheFile = path.join(userDataPath, "coros-locale", "en-US.json");
  strings = null;
  loading = null;
}

/**
 * The table's body. The file is a script — `window.en_US={…}` — whose object
 * is strict JSON, so the braces are cut out and parsed rather than evaluated.
 */
export function parseCorosLocaleScript(source: string): Record<string, string> {
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("COROS locale file has no table");
  const parsed = JSON.parse(source.slice(start, end + 1)) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("COROS locale table is not an object");
  }
  const table: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value === "string" && value.trim()) table[key] = unescapeLiteral(value.trim());
  }
  return table;
}

/**
 * The table is written for vue-i18n, where `@` and braces are syntax, so a
 * literal one is spelled `{'@'}` — 77 strings do it, "3×10 {'@'} tempo" among
 * them. The app shows text rather than compiling messages, so it takes the
 * literal out.
 */
function unescapeLiteral(value: string): string {
  return value.replace(/\{'([^']*)'\}/g, "$1");
}

function readStored(): StoredLocale | null {
  if (!cacheFile) return null;
  try {
    const stored = JSON.parse(fs.readFileSync(cacheFile, "utf8")) as StoredLocale;
    return stored && typeof stored.strings === "object" ? stored : null;
  } catch {
    return null;
  }
}

async function fetchTable(): Promise<Record<string, string>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(LOCALE_URL, { signal: controller.signal });
    if (!response.ok) throw new Error(`COROS locale answered ${response.status}`);
    return parseCorosLocaleScript(await response.text());
  } finally {
    clearTimeout(timer);
  }
}

/** Replaces the table in memory — for suites, and for the loader below. */
export function useCorosLocaleTable(table: Record<string, string> | null): void {
  strings = table ? new Map(Object.entries(table)) : null;
}

/**
 * Makes the table available, from disk or from COROS. Never throws: a plan
 * with its keys showing is still a plan, so a failure here must not become a
 * failure to load the library.
 */
export function loadCorosLocale(): Promise<void> {
  if (loading) return loading;
  loading = (async () => {
    const stored = readStored();
    if (stored) useCorosLocaleTable(stored.strings);
    const fresh =
      stored && Date.now() - Date.parse(stored.fetchedAt) < REFRESH_MS;
    if (fresh) return;
    try {
      const table = await fetchTable();
      useCorosLocaleTable(table);
      if (cacheFile) {
        fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
        const record: StoredLocale = { fetchedAt: new Date().toISOString(), strings: table };
        fs.writeFileSync(`${cacheFile}.tmp`, JSON.stringify(record));
        fs.renameSync(`${cacheFile}.tmp`, cacheFile);
      }
    } catch {
      /* The copy on disk, or the keys themselves. Let a later load try again. */
      loading = null;
    }
  })();
  return loading;
}

/** The words for a COROS key, or the value unchanged. */
export function corosText(value: string): string;
export function corosText(value: string | undefined): string | undefined;
export function corosText(value: string | undefined): string | undefined {
  if (!value || !strings) return value;
  const trimmed = value.trim();
  if (!KEY_PATTERN.test(trimmed)) return value;
  return strings.get(trimmed) ?? value;
}
