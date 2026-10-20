// A session's time in zones, as the run, ride, hike and Strength pages draw it
// (src/training/zoneTime.ts), and the two zone facts the parser reads for it.
//
// Launched through Electron rather than plain node because the renderer module
// is TypeScript and a distro Node built without Amaro cannot strip it.
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const bust = `?cacheBust=${Date.now()}`;
const { heartRateZoneFamily, heartRateZoneTime, paceZoneTime } = await import(
  pathToFileURL(path.join(root, "src/training/zoneTime.ts")).href + bust
);
const { parseActivityDetail, parseActivityHrZoneType } = await import(
  pathToFileURL(path.join(root, "dist-electron/trainingHubService.js")).href + bust
);

// A tempo run's own zoneList, verbatim from a cached payload: heart rate on a
// heart-rate-reserve account, and the seven pace buckets COROS keeps.
const payload = {
  summary: { sportType: 100, totalTime: 384700 },
  zoneList: [
    {
      type: 126,
      zoneType: 0,
      zoneItemList: [
        { zoneIndex: 0, leftScope: 133, rightScope: 154, second: 85, percent: 2 },
        { zoneIndex: 1, leftScope: 133, rightScope: 154, second: 832, percent: 22 },
        { zoneIndex: 2, leftScope: 155, rightScope: 168, second: 2335, percent: 61 },
        { zoneIndex: 3, leftScope: 169, rightScope: 173, second: 570, percent: 15 },
        { zoneIndex: 4, leftScope: 174, rightScope: 183, second: 25, percent: 1 },
        { zoneIndex: 5, leftScope: 183, rightScope: 404, second: 0, percent: 0 }
      ]
    },
    {
      type: 130,
      zoneType: 0,
      zoneItemList: [
        { zoneIndex: 0, leftScope: 465000, rightScope: 393000, second: 40 },
        { zoneIndex: 1, leftScope: 465000, rightScope: 393000, second: 1690 },
        { zoneIndex: 2, leftScope: 393000, rightScope: 352000, second: 724 },
        { zoneIndex: 3, leftScope: 352000, rightScope: 323000, second: 1261 },
        { zoneIndex: 4, leftScope: 323000, rightScope: 317000, second: 40 },
        { zoneIndex: 5, leftScope: 317000, rightScope: 285000, second: 92 },
        { zoneIndex: 6, leftScope: 285000, rightScope: 162000, second: 0 }
      ]
    },
    {
      type: 173,
      zoneType: 1,
      zoneItemList: [
        { zoneIndex: 0, leftScope: 465000, rightScope: 393000, second: 10 },
        { zoneIndex: 1, leftScope: 465000, rightScope: 393000, second: 20 }
      ]
    }
  ]
};
const detail = parseActivityDetail(payload);

// --- The model the zones are named by -----------------------------------------

// COROS wrote 0 on this run, as it does on some runs of an account on one model.
assert.equal(detail.hrZoneType, undefined);
assert.equal(heartRateZoneFamily(detail.hrZoneType, "restingHr"), "restingHr", "0 falls back to the account");
assert.equal(heartRateZoneFamily(1, "restingHr"), "maxHr", "the activity's own model wins when it states one");
assert.equal(heartRateZoneFamily(undefined, undefined), undefined);
assert.equal(parseActivityHrZoneType({ zoneList: [{ type: 126, zoneType: 2 }] }), 2);

// --- Heart rate ---------------------------------------------------------------

{
  const rows = heartRateZoneTime(detail.hrZones, "restingHr");
  assert.deepEqual(
    rows.map((row) => row.label),
    ["Recovery", "Aerobic Endurance", "Aerobic Power", "Threshold", "Anaerobic Endurance", "Anaerobic Power"]
  );
  // Every zone is listed, the ones above the threshold included — 25 s of
  // Anaerobic Endurance is there, and the zone never reached reads 0.
  assert.deepEqual(rows.map((row) => row.seconds), [85, 832, 2335, 570, 25, 0]);
  assert.equal(rows.reduce((sum, row) => sum + row.share, 0).toFixed(6), "1.000000");
  assert.deepEqual([rows[0].easyEdge, rows[0].hardEdge], [undefined, 133], "the first zone is everything under");
  assert.deepEqual([rows[2].easyEdge, rows[2].hardEdge], [155, 168]);
  assert.deepEqual([rows[5].easyEdge, rows[5].hardEdge], [183, undefined], "the sentinel ceiling is no bound");

  const maxHr = heartRateZoneTime(detail.hrZones, "maxHr");
  assert.equal(maxHr[2].label, "Fat Burn", "Max HR names its bands its own way");
  const unknown = heartRateZoneTime(detail.hrZones, undefined);
  assert.equal(unknown[0].label, undefined, "no model, no name: the panel numbers it");
  assert.deepEqual(heartRateZoneTime([{ index: 0, seconds: 0 }], "restingHr"), [], "nothing scored, no panel");
}

// --- Pace ---------------------------------------------------------------------

{
  const rows = paceZoneTime(detail.paceZones);
  // Seven buckets, six zones: COROS stores Threshold split at 100% of threshold speed.
  assert.equal(rows.length, 6);
  assert.deepEqual(
    rows.map((row) => row.label),
    ["Recovery", "Aerobic Endurance", "Aerobic Power", "Threshold", "Anaerobic Endurance", "Anaerobic Power"]
  );
  assert.deepEqual(rows.map((row) => row.seconds), [40, 1690, 724, 1301, 92, 0]);
  assert.deepEqual([rows[0].easyEdge, rows[0].hardEdge], [undefined, 465], "Recovery is everything slower");
  assert.deepEqual([rows[1].easyEdge, rows[1].hardEdge], [465, 393]);
  assert.deepEqual([rows[3].easyEdge, rows[3].hardEdge], [352, 317], "the two halves of Threshold, as one band");
  assert.deepEqual([rows[5].easyEdge, rows[5].hardEdge], [285, undefined], "the fastest zone is open");

  // Grade-adjusted pace is read from its own list.
  assert.deepEqual(detail.adjustedPaceZones.map((bucket) => bucket.seconds), [10, 20]);
  // Any other length is drawn bucket for bucket, by number.
  const odd = paceZoneTime(detail.adjustedPaceZones);
  assert.equal(odd.length, 2);
  assert.equal(odd[0].label, undefined);
}

console.log("zone time tests passed");
