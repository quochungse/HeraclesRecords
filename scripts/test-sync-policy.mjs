import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(repoRoot, file), "utf8");

const policySource = read("electron/sync/syncPolicy.ts");
const databaseSource = read("electron/database.ts");

const electronDir = path.join(repoRoot, "electron");
// Recursive: electron/ has subdirectories (sync/, routing/), and a settings key
// declared in one of them must be classified like any other. Reading only the
// top level silently exempted them.
function collectTypeScript(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return collectTypeScript(full);
    return entry.name.endsWith(".ts") ? [full] : [];
  });
}

// The registry itself is excluded: it names every key by definition, so
// scraping it as evidence that a key is *in use* would be circular and would
// let a deleted key keep justifying its own policy entry forever.
const REGISTRY_FILE = path.join(electronDir, "sync", "syncPolicy.ts");

const electronSources = collectTypeScript(electronDir)
  .filter((file) => file !== REGISTRY_FILE)
  .map((file) => fs.readFileSync(file, "utf8"));

// ---------------------------------------------------------------------------
// Tables
//
// A table is declared once, in database.ts. Anything the schema creates must be
// classified, and the registry must not name a table that no longer exists.
// ---------------------------------------------------------------------------

const declaredTables = new Set(
  [...databaseSource.matchAll(/CREATE TABLE IF NOT EXISTS\s+([a-zA-Z_]+)/g)].map(
    (match) => match[1]
  )
);

assert.ok(
  declaredTables.size > 15,
  `table scrape found only ${declaredTables.size}; the regex has drifted`
);

// Read one exported object literal out of the registry. Bounded by the literal
// itself rather than by the next declaration, so reordering the file is safe.
function objectLiteral(name) {
  const start = policySource.indexOf(`export const ${name}`);
  assert.notEqual(start, -1, `syncPolicy.ts has no ${name}`);
  const open = policySource.indexOf("{", start);
  const end = policySource.indexOf("\n};", open);
  assert.notEqual(end, -1, `${name} is not a closed object literal`);
  return policySource.slice(open, end);
}

const tablePolicyBlock = objectLiteral("TABLE_POLICY");
const classifiedTables = new Set(
  [...tablePolicyBlock.matchAll(/^\s{2}([a-z_]+):\s*"/gm)].map((m) => m[1])
);

assert.deepEqual(
  [...declaredTables].filter((table) => !classifiedTables.has(table)).sort(),
  [],
  "database.ts creates a table that syncPolicy.ts does not classify"
);
assert.deepEqual(
  [...classifiedTables].filter((table) => !declaredTables.has(table)).sort(),
  [],
  "syncPolicy.ts classifies a table that database.ts does not create"
);

// ---------------------------------------------------------------------------
// Settings keys
//
// Keys are declared in several shapes: `const SETTINGS = {...}` objects,
// CHAT_SETTINGS_KEYS, standalone `const FOO_SETTING = "..."`, and plain object
// literals inside helpers such as keysFor(). Rather than chase every shape, the
// scrape takes *all* dotted string literals in electron/ and requires each one
// to be either classified or listed as a known non-key below. That way a new
// settings key cannot slip through by being declared in a novel way.
// ---------------------------------------------------------------------------

const DOTTED_LITERAL = /"([a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)+)"/g;

// Dotted literals in electron/ that are not settings keys. Each entry is a
// deliberate exclusion; add to it only after confirming the string never
// reaches getSetting/setSetting.
const NOT_SETTINGS_KEYS = new Set([
  // Field names inside COROS API payloads.
  "activity.name",
  "activity.sport",
  "base.map",
  "evoLab.dayDetailList",
  "evoLab.dayList",
  "evoLab.sportStatistic",
  "evoLab.sportStatistics",
  "evoLab.weekList",
  "week.range",
  // Streaming protocol event names.
  "response.completed",
  "response.created",
  // Watchface template internals.
  "rule.name",
  "p.xxxx"
]);

// Filenames and hostnames share the dotted shape but are never settings keys.
const FILE_EXTENSION = /\.(?:exe|txt|json|png|ico|icns|dat|zip|sqlite|js|jpg|jpeg|svg|css|html|mjs|cjs|ts|node|gpx|tcx|fit|mp3|m4a|webm|db|log|pem|key|crt)$/;
const HOSTNAME = /\.(?:com|net|org|io|ai|dev|app|co|me|tv|be|cn|eu|us)$/;

const candidateKeys = new Set();
for (const source of electronSources) {
  for (const match of source.matchAll(DOTTED_LITERAL)) {
    const value = match[1];
    if (FILE_EXTENSION.test(value)) continue;
    if (HOSTNAME.test(value)) continue;
    if (NOT_SETTINGS_KEYS.has(value)) continue;
    candidateKeys.add(value);
  }
}

assert.ok(
  candidateKeys.size > 50,
  `settings scrape found only ${candidateKeys.size} keys; the regex has drifted`
);

// Every scraped key must resolve to a tier. Mirrors policyForSetting() without
// importing the TypeScript module, which this environment cannot execute.
const settingPolicyBlock = objectLiteral("SETTING_POLICY");
const classifiedSettings = new Set(
  [...settingPolicyBlock.matchAll(/^\s{2}"([^"]+)":\s*"/gm)].map((m) => m[1])
);

const dynamicPatterns = [
  /^mcp\.[^.]+\.(?:tokens|clientInfo|bearer)$/,
  /^mcp\.[^.]+\.resourceUrl$/
];

const resolves = (key) =>
  classifiedSettings.has(key) ||
  dynamicPatterns.some((pattern) => pattern.test(key));

assert.deepEqual(
  [...candidateKeys].filter((key) => !resolves(key)).sort(),
  [],
  "a settings key in electron/ is not classified in syncPolicy.ts " +
    "(classify it, or add it to NOT_SETTINGS_KEYS if it is not a settings key)"
);

// And the registry must not carry entries for keys nothing declares any more.
assert.deepEqual(
  [...classifiedSettings].filter((key) => !candidateKeys.has(key)).sort(),
  [],
  "syncPolicy.ts classifies a settings key that no longer appears in electron/"
);

// ---------------------------------------------------------------------------
// Renderer localStorage
//
// The third place the app keeps state. Keys are almost always referenced
// through a module-level constant, so the scrape resolves the identifier back
// to its literal rather than only catching inline strings.
// ---------------------------------------------------------------------------

const srcDir = path.join(repoRoot, "src");

function collectSourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

const rendererSources = collectSourceFiles(srcDir).map((file) => ({
  file,
  text: fs.readFileSync(file, "utf8")
}));

// `const NAME = "value";` or `const NAME =\n  "value";`
function constantValue(text, identifier) {
  const match = text.match(
    new RegExp(`const\\s+${identifier}\\s*(?::[^=]+)?=\\s*"([^"]+)"`)
  );
  return match?.[1];
}

const storageKeys = new Set();

for (const { text } of rendererSources) {
  // Direct localStorage access, by literal or by identifier.
  for (const match of text.matchAll(
    /localStorage\.(?:getItem|setItem|removeItem)\(\s*(?:"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))/g
  )) {
    const [, literal, identifier] = match;
    if (literal) {
      storageKeys.add(literal);
      continue;
    }
    const resolved = constantValue(text, identifier);
    if (resolved) storageKeys.add(resolved);
  }

  // The selection-preference family, stored under a shared prefix.
  for (const match of text.matchAll(
    /defineSelectionPreference[^(]*\(\s*\{\s*key:\s*"([^"]+)"/g
  )) {
    storageKeys.add(`coroslink.selection.v1.${match[1]}`);
  }
}

assert.ok(
  storageKeys.size > 25,
  `localStorage scrape found only ${storageKeys.size} keys; the regex has drifted`
);

const localStorageBlock = objectLiteral("LOCAL_STORAGE_POLICY");
const classifiedStorage = new Set(
  [...localStorageBlock.matchAll(/^\s{2}"([^"]+)":\s*"/gm)].map((m) => m[1])
);
const dynamicStoragePatterns = [/^coroslink\.selection\.v1\..+$/];

const storageResolves = (key) =>
  classifiedStorage.has(key) ||
  dynamicStoragePatterns.some((pattern) => pattern.test(key));

assert.deepEqual(
  [...storageKeys].filter((key) => !storageResolves(key)).sort(),
  [],
  "a localStorage key in src/ is not classified in syncPolicy.ts"
);

assert.deepEqual(
  [...classifiedStorage].filter((key) => !storageKeys.has(key)).sort(),
  [],
  "syncPolicy.ts classifies a localStorage key that src/ no longer writes"
);

// ---------------------------------------------------------------------------
// Safety properties of the classification itself
// ---------------------------------------------------------------------------

// Sync carries user data only. There is no tier that ships a credential, and
// there is no opt-in that adds one back — this is the assertion that says so,
// because the way that decision gets quietly reversed is a new tier with a
// checkbox behind it rather than an edit to any one key.
assert.ok(
  !/\|\s*"secret"/.test(policySource),
  "syncPolicy.ts declares a `secret` tier again; credentials must stay `device`"
);
assert.ok(
  !/:\s*"secret"/.test(policySource),
  "syncPolicy.ts files a key as `secret`; credentials must stay `device`"
);
assert.ok(
  !/includeSecrets/.test(policySource),
  "syncPolicy.ts gates on an includeSecrets flag again"
);

// app_settings must never be syncable as a table; its rows carry every secret.
assert.match(
  tablePolicyBlock,
  /app_settings:\s*"perKey"/,
  "app_settings must stay perKey so it is never copied wholesale"
);

// Anything that reads like a credential must be filed `device`, the tier that
// never leaves the machine down any path. This is the check that catches a
// careless "preference" on a new API key — and, since sync carries user data
// only, there is no longer a second tier that would let one travel.
const CREDENTIAL_TIERS = new Set(["device"]);
const CREDENTIAL_SHAPED = /(apikey|secret|token|credential|password|refreshtoken)/i;

// Keys that read like credentials but are not. Keep this list tiny and justify
// every entry — it is the one place the check above can be silenced.
const CREDENTIAL_SHAPED_EXEMPT = new Set([
  // A count of LLM tokens per month, not an authentication token.
  "coachAutomation.monthlyTokenBudget"
]);

const misfiled = [...classifiedSettings].filter((key) => {
  if (CREDENTIAL_SHAPED_EXEMPT.has(key)) return false;
  if (!CREDENTIAL_SHAPED.test(key)) return false;
  const tier = settingPolicyBlock.match(
    new RegExp(`"${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}":\\s*"([a-z]+)"`)
  )?.[1];
  return !CREDENTIAL_TIERS.has(tier);
});
assert.deepEqual(
  misfiled,
  [],
  "a credential-shaped settings key is not filed `device`"
);

// A key sealed to this machine's keychain is by definition a credential, so it
// must sit in the `device` tier. If one were filed `preference` it would be
// uploaded — as ciphertext no other machine can open, which is worse than not
// uploading it at all: every `Boolean(getSetting(...))` check would then report
// a connected account that cannot make a request.
const deviceEncryptedBlock = policySource.slice(
  policySource.indexOf("export const DEVICE_ENCRYPTED_SETTINGS"),
  policySource.indexOf("const DEVICE_ENCRYPTED_PATTERNS")
);
const deviceEncrypted = [
  ...deviceEncryptedBlock.matchAll(/^\s{2}"([^"]+)"/gm)
].map((m) => m[1]);

assert.ok(
  deviceEncrypted.length > 5,
  `device-encrypted scrape found only ${deviceEncrypted.length}; regex drifted`
);
assert.deepEqual(
  deviceEncrypted.filter((key) => !classifiedSettings.has(key)).sort(),
  [],
  "a device-encrypted key is not classified at all"
);
assert.deepEqual(
  deviceEncrypted
    .filter((key) => {
      const tier = settingPolicyBlock.match(
        new RegExp(
          `"${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}":\\s*"([a-z]+)"`
        )
      )?.[1];
      return !CREDENTIAL_TIERS.has(tier);
    })
    .sort(),
  [],
  "a device-encrypted key must be in the `device` tier"
);

// ---------------------------------------------------------------------------
// Every syncable table must actually be hooked
//
// Classifying a table `personal` only declares intent. Unless some write site
// calls the bridge, edits to it never reach the oplog — and nothing else would
// notice: the app works, the suites pass, and the table simply stops syncing.
// This is the check that turns "declared syncable" into "actually syncs".
// ---------------------------------------------------------------------------

const hookedTables = new Set(
  [
    ...electronSources
      .join("\n")
      .matchAll(
        /notify(?:SyncedRow|SyncedDelete|RowChanged|RowDeleted)\(\s*"([a-z_]+)"/g
      )
  ].map((match) => match[1])
);

const syncableTables = [...classifiedTables].filter((table) => {
  const tier = tablePolicyBlock.match(
    new RegExp(`\\b${table}:\\s*"([a-zA-Z]+)"`)
  )?.[1];
  return tier === "personal" || tier === "preference";
});

assert.ok(
  syncableTables.length > 5,
  `syncable-table scrape found only ${syncableTables.length}; the regex drifted`
);
assert.deepEqual(
  syncableTables.filter((table) => !hookedTables.has(table)).sort(),
  [],
  "a table is classified syncable but no write site tells the sync bridge " +
    "about it — edits to it would silently never sync"
);

console.log(
  `sync policy OK — ${declaredTables.size} tables ` +
    `(${syncableTables.length} syncable, all hooked), ` +
    `${candidateKeys.size} settings keys, ` +
    `${storageKeys.size} localStorage keys classified`
);
