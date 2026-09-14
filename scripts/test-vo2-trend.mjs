// Runs through Electron rather than plain `node` only because this machine's
// Node is a distro build without Amaro, so `--experimental-strip-types` is
// unavailable there. Nothing here touches SQLite or a window.
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const modUrl = pathToFileURL(path.join(repoRoot, "src", "training", "vo2Trend.ts"));
const {
  buildVo2Trend,
  formatHappenDayNumeric,
  formatPlateauDuration,
  formatTrendSpan,
  happenDayToUtcMs
} = await import(`${modUrl.href}?cacheBust=${Date.now()}`);

// The real series probed off COROS on 2026-09-14: 28 readings, sparse (only
// days with a run), holding three levels.
const REAL = [
  ["20260709", 45], ["20260711", 45], ["20260713", 45], ["20260715", 45],
  ["20260718", 45], ["20260721", 45], ["20260723", 45],
  ["20260725", 46], ["20260728", 46], ["20260730", 46], ["20260801", 46],
  ["20260804", 46], ["20260806", 46], ["20260808", 46], ["20260811", 46],
  ["20260813", 47], ["20260815", 47], ["20260818", 47], ["20260820", 47],
  ["20260822", 47], ["20260825", 47], ["20260827", 47], ["20260829", 47],
  ["20260901", 47], ["20260903", 47], ["20260905", 47], ["20260908", 47],
  ["20260912", 47]
].map(([happenDay, value]) => ({ happenDay, value }));

// 1. Repeated readings extend a plateau instead of starting one: 28 readings,
//    three levels.
{
  const trend = buildVo2Trend(REAL, "20260914");
  assert.equal(trend.plateaus.length, 3);
  assert.deepEqual(
    trend.plateaus.map((p) => p.value),
    [45, 46, 47]
  );
  assert.equal(trend.first, 45);
  assert.equal(trend.latest, 47);
  assert.equal(trend.delta, 2);
  assert.equal(trend.lastStep, 1);
}

// 2. A level holds up to the day BEFORE the reading that changed it, and the
//    newest one is carried forward to the reference day. Off-by-one here is the
//    difference between "19 days at 46" and a plateau that silently overlaps
//    its successor.
{
  const trend = buildVo2Trend(REAL, "20260914");
  const [low, mid, high] = trend.plateaus;

  assert.equal(low.startDay, "20260709");
  assert.equal(low.endDay, "20260724", "45 ends the day before the first 46");
  assert.equal(low.days, 16);

  assert.equal(mid.startDay, "20260725");
  assert.equal(mid.endDay, "20260812");
  assert.equal(mid.days, 19);

  assert.equal(high.startDay, "20260813");
  assert.equal(high.endDay, "20260914", "current level carries to today");
  assert.equal(high.days, 33);

  assert.equal(trend.daysAtCurrent, 33);
  assert.equal(trend.spanDays, 16 + 19 + 33);
  assert.equal(trend.endDay, "20260914");
}

// 3. Shares are what the bar's widths are, so they must sum to exactly the bar.
{
  const trend = buildVo2Trend(REAL, "20260914");
  const total = trend.plateaus.reduce((sum, p) => sum + p.share, 0);
  assert.ok(Math.abs(total - 1) < 1e-9, `shares summed to ${total}`);
  assert.ok(trend.plateaus.every((p) => p.share > 0));
}

// 4. Unsorted input, duplicate days and junk values must not reorder or
//    fabricate plateaus -- the dayList is merged from two sources and arrives
//    in no guaranteed order.
{
  const trend = buildVo2Trend(
    [
      { happenDay: "20260813", value: 47 },
      { happenDay: "20260709", value: 45 },
      { happenDay: "not-a-day", value: 46 },
      { happenDay: "20260230", value: 44 },
      { happenDay: "20260725", value: 46 },
      { happenDay: "20260711", value: 0 },
      { happenDay: "20260715", value: Number.NaN }
    ],
    "20260914"
  );
  assert.deepEqual(
    trend.plateaus.map((p) => p.value),
    [45, 46, 47],
    "impossible dates and non-positive values are dropped, not ordered in"
  );
}

// 5. A dip back to an earlier value is a new plateau, not a merge with the
//    first one -- VO2max does go down.
{
  const trend = buildVo2Trend(
    [
      { happenDay: "20260701", value: 46 },
      { happenDay: "20260715", value: 47 },
      { happenDay: "20260801", value: 46 }
    ],
    "20260810"
  );
  assert.deepEqual(
    trend.plateaus.map((p) => p.value),
    [46, 47, 46]
  );
  assert.equal(trend.delta, 0, "ends where it started");
  assert.equal(trend.lastStep, -1);
}

// 6. One reading is a trend of one plateau with no step, and a single day still
//    has width. `lastStep` must be absent rather than 0, or the footer would
//    claim a change that never happened.
{
  const trend = buildVo2Trend([{ happenDay: "20260914", value: 47 }], "20260914");
  assert.equal(trend.plateaus.length, 1);
  assert.equal(trend.plateaus[0].days, 1);
  assert.equal(trend.plateaus[0].share, 1);
  assert.equal(trend.delta, 0);
  assert.equal(trend.lastStep, undefined);
  assert.equal(trend.spanDays, 1);
}

// 7. Nothing to draw reports nothing, rather than an empty bar.
{
  assert.equal(buildVo2Trend([], "20260914"), null);
  assert.equal(buildVo2Trend([{ happenDay: "x", value: 47 }], "20260914"), null);
}

// 8. A reference day behind the last reading is clamped up. A skewed clock must
//    not produce a negative span, which would make every share negative and
//    collapse the bar.
{
  const trend = buildVo2Trend(REAL, "20260101");
  assert.equal(trend.endDay, "20260912", "clamped to the last reading");
  assert.ok(trend.spanDays > 0);
  assert.ok(trend.plateaus.every((p) => p.days >= 1));
}

// 9. Days are counted as calendar days in UTC. Parsed locally, a span crossing
//    a DST boundary comes out one short.
{
  const before = happenDayToUtcMs("20261024");
  const after = happenDayToUtcMs("20261027");
  assert.equal((after - before) / 86_400_000, 3, "DST must not eat a day");

  const trend = buildVo2Trend(
    [
      { happenDay: "20261024", value: 45 },
      { happenDay: "20261027", value: 46 }
    ],
    "20261027"
  );
  assert.equal(trend.plateaus[0].days, 3);
}

// 10. Captions stay short enough to sit under a segment: days while that reads,
//     weeks past two months.
{
  assert.equal(formatPlateauDuration(1), "1d");
  assert.equal(formatPlateauDuration(33), "33d");
  assert.equal(formatPlateauDuration(55), "55d");
  assert.equal(formatPlateauDuration(56), "8w");
  assert.equal(formatPlateauDuration(365), "52w");

  assert.equal(formatTrendSpan(30), "30 days");
  assert.equal(formatTrendSpan(59), "59 days");
  assert.equal(formatTrendSpan(68), "2 months");
  assert.equal(formatTrendSpan(365), "12 months");
  assert.equal(formatTrendSpan(900), "2 years");
}

// 11. The hover tooltip pairs two dates with a dash between them, so the order
//     has to be fixed rather than locale-chosen -- under en-US an Intl format
//     would answer 08/13/26 and the reader could not tell which half moved.
{
  assert.equal(formatHappenDayNumeric("20260813"), "13/08/26");
  assert.equal(formatHappenDayNumeric("20260914"), "14/09/26");
  assert.equal(formatHappenDayNumeric("20260101"), "01/01/26");
  assert.equal(formatHappenDayNumeric("20991231"), "31/12/99");
  assert.equal(formatHappenDayNumeric("nope"), "nope", "junk passes through");

  const trend = buildVo2Trend(REAL, "20260914");
  const current = trend.plateaus.at(-1);
  assert.equal(
    `VO2 Max ${current.value} · ${formatHappenDayNumeric(current.startDay)} - ${formatHappenDayNumeric(current.endDay)}`,
    "VO2 Max 47 · 13/08/26 - 14/09/26"
  );
}

console.log("vo2 trend OK");
