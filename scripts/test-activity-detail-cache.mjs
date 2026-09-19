// Caching an activity detail on disk, and the ~130 bytes kept in SQLite.
//
// Three things are worth holding down here, and none of them fails loudly on
// its own:
//
//  1. **The fingerprint.** COROS's activity list carries no version field of
//     any kind — probed on the live API — so a cached detail is validated
//     against a hash of the list row's own figures. Drop a field from that hash
//     and an edited run serves its pre-edit payload forever; add one the app
//     derives locally (`sportName`) and every activity re-fetches at every
//     launch. Neither shows up as an error.
//  2. **One path to the payload.** The run screen, the calendar, the coach's
//     tools and the two backfills all read details; the moment one of them
//     talks to COROS directly it is both uncached and unvalidated.
//  3. **The cap.** A directory with no ceiling is a bug that takes a month to
//     appear and arrives as a full disk.
//
// Under Electron because better-sqlite3 is built for its ABI.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distUrl = (file) =>
  `${pathToFileURL(path.join(repoRoot, "dist-electron", file)).href}?cacheBust=${Date.now()}`;

const tempDirs = [];
const makeTemp = (prefix) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
};
// Set once the database module has been imported, so the handle can be let go
// before the tree it lives in is removed: Windows will not unlink an open file,
// and the suite used to pass every assertion and then die on an EPERM naming a
// temp path. Declared ahead of the handler and guarded, because this also runs
// when an assertion threw before anything was ever opened.
let releaseDatabase;

// On every exit, so a failing assertion does not leave the trees behind.
process.on("exit", () => {
  try {
    releaseDatabase?.();
  } catch {
    // Nothing open, or already closed.
  }
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const tempRoot = makeTemp("heracles-detail-cache-");

const database = await import(distUrl("database.js"));
const cache = await import(distUrl("activityDetailCache.js"));
const metrics = await import(distUrl("activityMetrics.js"));
const service = await import(distUrl("trainingHubService.js"));

database.initializeDatabase(tempRoot);
releaseDatabase = database.closeDatabase;
database.setSetting("trainingHub.userId", "athlete-1");
cache.initializeActivityDetailCache(tempRoot);

// ---------------------------------------------------------------------------
// 1. The fingerprint
// ---------------------------------------------------------------------------

const run = {
  activityId: "480288744474181734",
  name: "Easy 12 km @ HR 135-156",
  sportType: 100,
  sportName: "Run",
  startTime: 1789209830,
  endTime: 1789214979,
  duration: 5149,
  elapsedDuration: 5149,
  distance: 12216.94,
  avgHr: 162,
  maxHr: 178,
  calories: 1060,
  trainingLoad: 280,
  elevationGain: 4
};

const base = cache.activityDetailFingerprint(run);
assert.match(base, /^[0-9a-f]{16}$/);
assert.equal(
  cache.activityDetailFingerprint({ ...run }),
  base,
  "the same activity must hash the same, or nothing is ever a cache hit"
);

// Renaming a run rewrites the payload's own summary, so it has to invalidate.
assert.notEqual(
  cache.activityDetailFingerprint({ ...run, name: "Long run" }),
  base,
  "a renamed run must not keep serving the old name"
);
for (const [field, value] of [
  ["distance", 12200],
  ["duration", 5200],
  ["trainingLoad", 281],
  ["avgHr", 163],
  ["sportType", 101],
  ["endTime", 1789214980]
]) {
  assert.notEqual(
    cache.activityDetailFingerprint({ ...run, [field]: value }),
    base,
    `a change to ${field} must invalidate the cached detail`
  );
}

// `sportName` is filled in locally from a lookup table, so it differs between a
// fresh list and a stored row with nothing having changed at COROS.
assert.equal(
  cache.activityDetailFingerprint({ ...run, sportName: "Trail Run" }),
  base,
  "sportName is this app's own label and must not invalidate anything"
);
// Reading the row back out of SQLite must produce the same hash as the list
// object it was written from — otherwise every launch re-fetches every detail.
database.upsertTrainingActivities([run]);
assert.equal(
  cache.activityDetailFingerprint(database.getStoredTrainingActivity(run.activityId)),
  base,
  "a stored row and its list object must agree, float columns included"
);

// ---------------------------------------------------------------------------
// 2. The file
// ---------------------------------------------------------------------------

const payload = {
  lastUploadTime: 1789215000,
  summary: { distance: 1221694, workoutTime: 514900 },
  frequencyList: Array.from({ length: 400 }, (_, index) => ({
    time: index * 12,
    heart: 150,
    speed: 420
  }))
};

assert.equal(
  cache.readCachedActivityDetail(run.activityId, base),
  null,
  "nothing cached yet"
);

cache.writeCachedActivityDetail(run.activityId, base, payload);
const readBack = cache.readCachedActivityDetail(run.activityId, base);
assert.deepEqual(readBack, payload, "the payload comes back as it went in");

const file = path.join(
  tempRoot,
  "activity-details",
  ...fs.readdirSync(path.join(tempRoot, "activity-details")),
  `${run.activityId}.json.br`
);
assert.ok(fs.existsSync(file), "the detail is one file, named for the activity");
const onDisk = fs.readFileSync(file);
assert.ok(
  onDisk.length < Buffer.byteLength(JSON.stringify(payload)) / 2,
  "the payload is compressed at rest, not written as JSON"
);
const envelope = JSON.parse(zlib.brotliDecompressSync(onDisk).toString("utf8"));
assert.equal(envelope.fingerprint, base, "the file carries its own fingerprint");
assert.equal(envelope.v, 1);

// The whole point: a stale file is a miss, and it does not linger.
const renamed = cache.activityDetailFingerprint({ ...run, name: "Long run" });
assert.equal(
  cache.readCachedActivityDetail(run.activityId, renamed),
  null,
  "a fingerprint that no longer matches is a miss"
);
assert.ok(!fs.existsSync(file), "and the stale file is dropped rather than kept");

// Another account must not read this one's runs.
cache.writeCachedActivityDetail(run.activityId, base, payload);
database.setSetting("trainingHub.userId", "athlete-2");
assert.equal(
  cache.readCachedActivityDetail(run.activityId, base),
  null,
  "a different COROS account gets its own directory"
);
database.setSetting("trainingHub.userId", "athlete-1");
assert.deepEqual(
  cache.readCachedActivityDetail(run.activityId, base),
  payload,
  "and signing back in finds the first account's files again"
);

// An id that is not an id builds no path.
cache.writeCachedActivityDetail("../../escape", base, payload);
assert.equal(cache.readCachedActivityDetail("../../escape", base), null);
assert.ok(
  !fs.existsSync(path.join(tempRoot, "escape.json.br")),
  "an activity id is never pasted into a path unchecked"
);

// ---------------------------------------------------------------------------
// 3. The summary
// ---------------------------------------------------------------------------

// A run that drifts: the second half holds the same pace at a higher heart
// rate, which is what decoupling is measuring. The halves are taken after a
// ten-minute warm-up, so over this 59.5-minute run they meet at 34.75 minutes.
const drifting = Array.from({ length: 120 }, (_, index) => ({
  time: index * 30,
  heart: index < 70 ? 150 : 165,
  speed: 420
}));

const detailPayload = {
  summary: { totalTime: 357000, distance: 1000000 },
  frequencyList: drifting,
  pauseList: [],
  zoneList: [
    {
      type: 126,
      zoneItemList: [
        { zoneIndex: 0, second: 120, leftScope: 133 },
        { zoneIndex: 1, second: 900, leftScope: 133, rightScope: 154 },
        { zoneIndex: 2, second: 1800, leftScope: 154, rightScope: 168 },
        { zoneIndex: 3, second: 600, leftScope: 168, rightScope: 173 },
        { zoneIndex: 4, second: 120, leftScope: 173, rightScope: 183 },
        { zoneIndex: 5, second: 0, leftScope: 183, rightScope: 404 }
      ]
    }
  ]
};

const parsed = service.parseActivityDetail(detailPayload);
const summary = metrics.summarizeActivityDetail({
  activityId: run.activityId,
  fingerprint: base,
  detail: parsed,
  raw: { ...detailPayload, lastUploadTime: 1789215000 },
  now: 1789300000000
});

assert.deepEqual(
  summary.zoneSeconds,
  [120, 900, 1800, 600, 120, 0],
  "COROS's own six buckets, indexed by its own zoneIndex"
);
assert.ok(
  summary.decouplingPercent > 8 && summary.decouplingPercent < 12,
  `a 10% heart-rate rise at constant pace is ~9-10% drift, got ${summary.decouplingPercent}`
);
assert.equal(summary.lastUploadTime, 1789215000);
assert.equal(summary.summaryVersion, metrics.ACTIVITY_SUMMARY_VERSION);

// A detail COROS scored no zones for stores none rather than six zeroes, which
// would read on screen as a run spent entirely below zone 1.
assert.equal(
  metrics.summarizeActivityDetail({
    activityId: "x",
    fingerprint: base,
    detail: service.parseActivityDetail({
      summary: { totalTime: 357000 },
      frequencyList: drifting
    })
  }).zoneSeconds,
  undefined,
  "no zone channel at all means no zone seconds"
);
// And a bucket list that is there but scores nothing — six zeroes is not a run
// spent below zone 1, it is a run nobody scored, and the panel must not read it
// as the first.
assert.equal(
  metrics.hrZoneSeconds({
    hrZones: [0, 1, 2, 3, 4, 5].map((index) => ({ index, seconds: 0 }))
  }),
  undefined,
  "an all-zero split is no split"
);
assert.deepEqual(
  metrics.hrZoneSeconds({
    hrZones: [
      { index: 1, seconds: 60 },
      // Out of range, and a negative: neither may land in the array.
      { index: 9, seconds: 60 },
      { index: 2, seconds: -5 }
    ]
  }),
  [0, 60, 0, 0, 0, 0],
  "buckets are placed by COROS's own index, and only the six that exist"
);

database.upsertActivityDetailSummary(summary);
const [stored] = database.getActivityDetailSummaries([run.activityId]);
assert.deepEqual(stored, summary, "the row round-trips field for field");

// The service only hands back summaries that still describe the activity.
assert.deepEqual(
  service.readActivityDetailSummaries([run.activityId]),
  [summary],
  "a summary whose fingerprint matches the stored activity is served"
);

database.upsertActivityDetailSummary({ ...summary, fingerprint: renamed });
assert.deepEqual(
  service.readActivityDetailSummaries([run.activityId]),
  [],
  "a summary computed before an edit is withheld, not shown as current"
);

database.upsertActivityDetailSummary({
  ...summary,
  summaryVersion: metrics.ACTIVITY_SUMMARY_VERSION - 1
});
assert.deepEqual(
  service.readActivityDetailSummaries([run.activityId]),
  [],
  "figures from an older summariser are recomputed rather than read"
);
database.upsertActivityDetailSummary(summary);

// ---------------------------------------------------------------------------
// 3b. A cached open asks COROS for nothing
//
// The payload coming off disk is only half of it: an activity with no GPS in
// its payload — every strength session and treadmill run — falls back to
// fetching a GPX file, two requests that would then be the *only* network calls
// left on the path. Reopened offline, the run would sit through both timing out
// to arrive exactly where it started.
// ---------------------------------------------------------------------------

// A session with a token, pointed at a port nothing answers on, so any request
// this path makes is both counted and harmless.
database.setSetting("trainingHub.accessToken", "test-token");
database.setSetting("trainingHub.regionId", "1");
database.setSetting("trainingHub.baseUrl", "http://127.0.0.1:1");

const indoor = {
  ...run,
  activityId: "run-indoor",
  name: "Treadmill 8 km",
  sportType: 101
};
database.upsertTrainingActivities([indoor]);
cache.writeCachedActivityDetail(
  indoor.activityId,
  cache.activityDetailFingerprint(indoor),
  { summary: { totalTime: 357000, distance: 800000 }, frequencyList: drifting }
);

let fetches = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (...args) => {
  fetches += 1;
  throw new Error("offline");
};

const first = await service.getTrainingHubActivityDetail(
  indoor.activityId,
  indoor.sportType,
  indoor
);
assert.ok(first.laps !== undefined, "the cached payload still parses");
const afterFirst = fetches;
assert.ok(
  afterFirst > 0,
  "the first open still asks whether COROS has a GPX track for it"
);

const second = await service.getTrainingHubActivityDetail(
  indoor.activityId,
  indoor.sportType,
  indoor
);
assert.equal(second.laps !== undefined, true);
assert.equal(
  fetches,
  afterFirst,
  "reopening it asks COROS for nothing at all — payload cached, track known absent"
);

// --- The mirror decides the fingerprint, not the caller's copy -------------
//
// A renderer still holding the list from before a correction landed passes a
// row that disagrees with the mirror. Hashing that copy wrote the file under a
// fingerprint nothing else computes; the next sweep saw a mismatch and deleted
// a file it could not refill. Here the stale copy must still find the file.
const staleCopy = { ...indoor, name: "Treadmill 8 km (before the rename)" };
const fetchesBefore = fetches;
const fromStaleCopy = await service
  .getTrainingHubActivityDetail(indoor.activityId, indoor.sportType, staleCopy)
  .catch((error) =>
    assert.fail(
      `a stale list row missed the cache and went to the network: ${error.message}`
    )
  );
assert.ok(fromStaleCopy.laps !== undefined);
assert.equal(
  fetches,
  fetchesBefore,
  "a caller holding an out-of-date list row is still served the cached file"
);
assert.ok(
  cache.readCachedActivityDetail(
    indoor.activityId,
    cache.activityDetailFingerprint(indoor)
  ),
  "and the file is still there for everything that hashes the mirror"
);

// --- An answer with nothing in it is never kept ----------------------------
//
// COROS answers some requests it cannot serve with `data: {}`, which parses as
// success. Cached, that is permanent: the file serves an empty detail until the
// activity is edited, and a summary built from it carries the current
// fingerprint, so it reads as a run nobody scored and is never looked at again.
const hollow = { ...run, activityId: "run-hollow", name: "COROS had nothing" };
database.upsertTrainingActivities([hollow]);
globalThis.fetch = async () =>
  new Response(JSON.stringify({ result: "0000", data: {} }), { status: 200 });

await service.getTrainingHubActivityDetail(hollow.activityId, hollow.sportType, hollow);
assert.equal(
  cache.readCachedActivityDetail(
    hollow.activityId,
    cache.activityDetailFingerprint(hollow)
  ),
  null,
  "an empty payload is not written to disk"
);
assert.deepEqual(
  database.getActivityDetailSummaries([hollow.activityId]),
  [],
  "and no summary is built from it"
);

// --- The sweep's brakes count attempts -------------------------------------
//
// Counting successes let a pass that kept failing quietly run the whole list at
// full speed: the limit never reached, the pause between fetches never taken.
// Ten activities whose cached payloads are unusable, a limit of two.
globalThis.fetch = async () => {
  fetches += 1;
  throw new Error("offline");
};
const unusable = Array.from({ length: 10 }, (_, index) => ({
  ...run,
  activityId: `run-unusable-${index}`,
  name: `Unusable ${index}`
}));
database.upsertTrainingActivities(unusable);
for (const activity of unusable) {
  cache.writeCachedActivityDetail(
    activity.activityId,
    cache.activityDetailFingerprint(activity),
    { nothing: "here" }
  );
}

const sweepStarted = Date.now();
const pass = await service.syncActivityDetailSummaries(
  unusable.map((activity) => activity.activityId),
  2
);
assert.equal(pass.computed, 0);
assert.equal(pass.failed, 2, "two attempts, both failures — and no more than two");
assert.equal(pass.remaining, 8, "the rest wait for the next pass");
assert.deepEqual(pass.summaries, []);
assert.ok(
  Date.now() - sweepStarted >= 350,
  "and the pause between the two attempts was still taken"
);

// A pass that does compute hands its summaries back, so the screen can merge
// them instead of re-reading the whole list.
const summable = { ...run, activityId: "run-summable", name: "Scored" };
database.upsertTrainingActivities([summable]);
cache.writeCachedActivityDetail(
  summable.activityId,
  cache.activityDetailFingerprint(summable),
  detailPayload
);
const scoredPass = await service.syncActivityDetailSummaries([summable.activityId], 2);
assert.equal(scoredPass.computed, 1);
assert.deepEqual(
  scoredPass.summaries.map((summary) => summary.activityId),
  [summable.activityId]
);

globalThis.fetch = realFetch;
database.deleteSettings(["trainingHub.accessToken", "trainingHub.baseUrl"]);

// --- A file that cannot be read is removed, not left --------------------------
//
// Only the path that opens a run overwrites; the sweeps would re-read and
// re-throw on a broken file forever while it went on counting against the cap.
const brokenFingerprint = cache.activityDetailFingerprint(summable);
const brokenFile = path.join(
  tempRoot,
  "activity-details",
  ...fs.readdirSync(path.join(tempRoot, "activity-details")).filter((dir) =>
    fs.existsSync(path.join(tempRoot, "activity-details", dir, `${summable.activityId}.json.br`))
  ),
  `${summable.activityId}.json.br`
);
const intact = fs.readFileSync(brokenFile);
fs.writeFileSync(brokenFile, intact.subarray(0, Math.floor(intact.length / 2)));
assert.equal(cache.readCachedActivityDetail(summable.activityId, brokenFingerprint), null);
assert.ok(!fs.existsSync(brokenFile), "a truncated file is deleted on read");

fs.writeFileSync(
  brokenFile,
  zlib.brotliCompressSync(
    Buffer.from(JSON.stringify({ v: 99, fingerprint: brokenFingerprint, payload: {} }))
  )
);
assert.equal(cache.readCachedActivityDetail(summable.activityId, brokenFingerprint), null);
assert.ok(!fs.existsSync(brokenFile), "so is one written by an envelope version this build does not know");

fs.writeFileSync(
  brokenFile,
  zlib.brotliCompressSync(
    Buffer.from(JSON.stringify({ v: 1, fingerprint: brokenFingerprint, payload: "text" }))
  )
);
assert.equal(
  cache.readCachedActivityDetail(summable.activityId, brokenFingerprint),
  null,
  "a payload that is not an object is never handed back as one"
);

// ---------------------------------------------------------------------------
// 4. The cap
// ---------------------------------------------------------------------------

const capRoot = makeTemp("heracles-detail-cap-");
database.setSetting("trainingHub.userId", "athlete-1");
// Written under a cap nothing reaches, then swept under one they all exceed —
// so what is measured is the sweep, not whether a write happened to cross it.
cache.initializeActivityDetailCache(capRoot, { maxBytes: 10_000_000 });

// Incompressible bodies, so each file's size is predictable.
const filler = (seed) => ({
  blob: Array.from({ length: 900 }, (_, index) => (seed * 7919 + index * 31) % 1000)
});

const kept = [];
for (let index = 0; index < 12; index += 1) {
  const activity = {
    ...run,
    activityId: `run-${index}`,
    name: `Run ${index}`,
    startTime: run.startTime + index
  };
  database.upsertTrainingActivities([activity]);
  kept.push(activity);
  cache.writeCachedActivityDetail(
    activity.activityId,
    cache.activityDetailFingerprint(activity),
    filler(index)
  );
}

const capDir = path.join(
  capRoot,
  "activity-details",
  ...fs.readdirSync(path.join(capRoot, "activity-details"))
);
// Last use one minute apart, oldest first, so the order is the files' own and
// not whatever resolution the filesystem stamps writes at.
kept.forEach((activity, index) => {
  const at = new Date(Date.now() - (12 - index) * 60_000);
  fs.utimesSync(path.join(capDir, `${activity.activityId}.json.br`), at, at);
});

const uncapped = cache.activityDetailCacheStats();
assert.equal(uncapped.files, 12);
const cap = Math.floor(uncapped.bytes / 2);
cache.initializeActivityDetailCache(capRoot, { maxBytes: cap });
const sweep = cache.sweepActivityDetailCache();

const capped = cache.activityDetailCacheStats();
assert.ok(sweep.removed >= 6, `half the directory over the cap, ${sweep.removed} removed`);
assert.ok(
  capped.bytes <= cap * 0.9,
  `a sweep goes under the cap with room to spare, holds ${capped.bytes} of ${cap}`
);
assert.ok(capped.files > 0, "and does not empty the whole directory");
for (const [index, activity] of kept.entries()) {
  const present = fs.existsSync(path.join(capDir, `${activity.activityId}.json.br`));
  if (index < sweep.removed) {
    assert.equal(present, false, `${activity.activityId} was among the oldest and goes`);
  } else {
    assert.equal(present, true, `${activity.activityId} was used more recently and stays`);
  }
}

// An orphan — a run deleted at COROS, or one belonging to an account that has
// signed out — goes before anything still in the list, however recent it is.
const orphanRoot = makeTemp("heracles-detail-orphan-");
cache.initializeActivityDetailCache(orphanRoot, { maxBytes: 10_000_000 });

const known = { ...run, activityId: "run-known", name: "Still in the list" };
const orphan = { ...run, activityId: "run-gone", name: "Deleted at COROS" };
database.upsertTrainingActivities([known]);
cache.writeCachedActivityDetail(
  known.activityId,
  cache.activityDetailFingerprint(known),
  filler(1)
);
cache.writeCachedActivityDetail(
  orphan.activityId,
  cache.activityDetailFingerprint(orphan),
  filler(2)
);

const accountDir = path.join(
  orphanRoot,
  "activity-details",
  ...fs.readdirSync(path.join(orphanRoot, "activity-details"))
);
const knownFile = path.join(accountDir, `${known.activityId}.json.br`);
const orphanFile = path.join(accountDir, `${orphan.activityId}.json.br`);
assert.ok(fs.existsSync(knownFile) && fs.existsSync(orphanFile));

// Age says take the known run first; belonging to nothing says take the orphan.
const ancient = new Date(Date.now() - 86_400_000);
fs.utimesSync(knownFile, ancient, ancient);

const both = fs.statSync(knownFile).size + fs.statSync(orphanFile).size;
cache.initializeActivityDetailCache(orphanRoot, { maxBytes: both - 1 });
const swept = cache.sweepActivityDetailCache();
assert.equal(swept.removed, 1, "one file was over the cap, so one file goes");
assert.ok(
  !fs.existsSync(orphanFile),
  "a file whose run is in no list is collected first"
);
assert.ok(
  fs.existsSync(knownFile),
  "even though it is the older of the two — a run still in the list is kept"
);

// A write that died half way leaves a temp file behind. Nothing can read it and
// nothing counts it, so it would otherwise sit in the directory for the life of
// the install — and enough of them would fill a disk the cap thinks is empty.
const staleTemp = path.join(accountDir, "run-dead.json.br.999.tmp");
const liveTemp = path.join(accountDir, "run-writing.json.br.1000.tmp");
fs.writeFileSync(staleTemp, "half a payload");
fs.writeFileSync(liveTemp, "half a payload");
const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
fs.utimesSync(staleTemp, twoHoursAgo, twoHoursAgo);
cache.activityDetailCacheStats();
assert.ok(!fs.existsSync(staleTemp), "an abandoned write is collected");
assert.ok(
  fs.existsSync(liveTemp),
  "but one young enough to still be in progress is left alone"
);
fs.rmSync(liveTemp, { force: true });

// ---------------------------------------------------------------------------
// 5. One path to the payload
// ---------------------------------------------------------------------------

const serviceSource = fs.readFileSync(
  path.join(repoRoot, "electron/trainingHubService.ts"),
  "utf8"
);

assert.equal(
  serviceSource.split('"/activity/detail/query"').length - 1,
  1,
  "every detail read goes through loadActivityDetailRaw; a second call site " +
    "would be both uncached and unvalidated"
);
assert.equal(
  serviceSource.split("loadActivityDetailRaw(").length - 1,
  6,
  "the definition plus five callers: the detail handler, the raw-payload " +
    "handler behind the development build's JSON modal, the summary sweep, " +
    "the feel backfill and the strength sync"
);
assert.equal(
  serviceSource.split("persist: false").length - 1,
  3,
  "the three sweeps fetch without writing files; only opening a run earns one"
);
assert.equal(
  serviceSource.split("fresh: true").length - 1,
  1,
  "exactly one reader skips the file — the feel backfill, whose field is the " +
    "one thing a fingerprint cannot see change"
);
assert.match(
  serviceSource,
  /persist: false,\s*fresh: true\s*\}\);\s*cacheFeelTypeFromDetail/,
  "and that reader is the feel backfill"
);

const mainSource = fs.readFileSync(path.join(repoRoot, "electron/main.ts"), "utf8");
assert.match(
  mainSource,
  /initializeActivityDetailCache\(app\.getPath\(\"userData\"\)\);[\s\S]{0,400}sweepActivityDetailCache\(\)/,
  "the cache is swept once at start-up — otherwise only a write reclaims anything"
);

const metricsSource = fs.readFileSync(
  path.join(repoRoot, "electron/activityMetrics.ts"),
  "utf8"
);
assert.ok(
  !/from "node:/.test(metricsSource),
  "activityMetrics is imported by the renderer and must stay free of node built-ins"
);
const runMetricsSource = fs.readFileSync(
  path.join(repoRoot, "src/running/runMetrics.ts"),
  "utf8"
);
assert.match(
  runMetricsSource,
  /export \{[^}]*paceHrDecoupling[^}]*\} from "\.\.\/\.\.\/electron\/activityMetrics"/s,
  "the renderer re-exports the shared maths rather than keeping a second copy"
);


console.log("activity detail cache: OK");
