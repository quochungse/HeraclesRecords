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
// Under Electron because better-sqlite3 is built for its ABI, and with the
// type-stripping resolver because the source guard reads `.ts` files.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distUrl = (file) =>
  `${pathToFileURL(path.join(repoRoot, "dist-electron", file)).href}?cacheBust=${Date.now()}`;

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "heracles-detail-cache-"));

const database = await import(distUrl("database.js"));
const cache = await import(distUrl("activityDetailCache.js"));
const metrics = await import(distUrl("activityMetrics.js"));
const service = await import(distUrl("trainingHubService.js"));

database.initializeDatabase(tempRoot);
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
  activeDuration: 5149,
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
// rate, which is what decoupling is measuring.
const drifting = Array.from({ length: 120 }, (_, index) => ({
  time: index * 30,
  heart: index < 60 ? 150 : 165,
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
// 4. The cap
// ---------------------------------------------------------------------------

const capRoot = fs.mkdtempSync(path.join(os.tmpdir(), "heracles-detail-cap-"));
database.setSetting("trainingHub.userId", "athlete-1");
cache.initializeActivityDetailCache(capRoot, { maxBytes: 40_000 });

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

const capped = cache.activityDetailCacheStats();
assert.ok(
  capped.bytes <= 40_000,
  `the directory stays under its cap, holds ${capped.bytes} bytes`
);
assert.ok(capped.files > 0, "and a sweep does not empty the whole directory");
assert.ok(
  cache.readCachedActivityDetail(
    "run-11",
    cache.activityDetailFingerprint(kept[11])
  ),
  "the most recently written detail survives the sweep"
);

// An orphan — a run deleted at COROS, or one belonging to an account that has
// signed out — goes before anything still in the list, however recent it is.
const orphanRoot = fs.mkdtempSync(path.join(os.tmpdir(), "heracles-detail-orphan-"));
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
  5,
  "the definition plus four callers: the detail handler, the summary sweep, " +
    "the feel backfill and the strength sync"
);
assert.equal(
  serviceSource.split("persist: false").length - 1,
  3,
  "the three sweeps fetch without writing files; only opening a run earns one"
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

fs.rmSync(tempRoot, { recursive: true, force: true });
fs.rmSync(capRoot, { recursive: true, force: true });
fs.rmSync(orphanRoot, { recursive: true, force: true });

console.log("activity detail cache: OK");
