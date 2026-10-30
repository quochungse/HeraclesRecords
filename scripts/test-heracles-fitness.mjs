// COROS's fitness figures with strength read in Heracles Training Load
// (electron/heraclesFitness.ts). Held here:
//
//  1. **The additions are COROS's own arithmetic** — Load Impact a 7-day and
//     Base Fitness a 42-day exponential average, the week's range Base Fitness
//     on the Sunday before × 7 — run on what Heracles adds each day.
//  2. **Adding them to COROS's figures is the same as running COROS's formulas
//     on the Heracles daily load**: the averages are linear, which is the
//     whole reason no COROS history has to be rebuilt.
//  3. **A strength session still loading flags the figures as low** for as
//     long as it can weigh on Base Fitness.
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const modUrl = pathToFileURL(path.join(repoRoot, "electron", "heraclesFitness.ts"));
const { heraclesDeltaSeries, fitnessInLoadSource, weekRangeInLoadSource } = await import(`${modUrl.href}?c=${Date.now()}`);

const close = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: ${actual} ≠ ${expected}`);
const dayKey = (date) =>
  `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
const daysFrom = (start, count) =>
  Array.from({ length: count }, (_, index) => {
    const date = new Date(start);
    date.setDate(date.getDate() + index);
    return dayKey(date);
  });

// --- 1. One session, Wednesday 21 October, 100 over COROS's figure ---
{
  const series = heraclesDeltaSeries(new Map([["20261021", { surplus: 100, pending: 0 }]]), "20261027");
  close(series.get("20261021").ati, 100 / 7, "Load Impact takes a seventh");
  close(series.get("20261021").cti, 100 / 42, "Base Fitness a forty-second");
  close(series.get("20261022").ati, (100 / 7) * (6 / 7), "and both decay with nothing added");
  assert.equal(series.get("20261021").load, 100);
  assert.equal(series.get("20261025").range, 0, "the week it happened in keeps its range");
  const sunday = series.get("20261025").cti;
  close(sunday, (100 / 42) * (41 / 42) ** 4, "Base Fitness's addition on Sunday");
  close(series.get("20261026").range, sunday * 7, "Monday's range: Sunday's Base Fitness × 7");
  close(series.get("20261027").range, sunday * 7, "the same all week");
  assert.equal(series.has("20261020"), false, "nothing before the first session");
}

// --- 2. COROS's figures plus the additions = COROS's formulas on Heracles's load ---
{
  const days = daysFrom(new Date(2026, 4, 1), 180);
  const coros = days.map((_, index) => 40 + ((index * 37) % 90));
  const surplus = days.map((_, index) => (index % 3 === 0 ? 60 + (index % 50) : 0));
  const ewma = (loads, span) => {
    let value = 0;
    return loads.map((load) => (value += (load - value) / span));
  };
  const corosAti = ewma(coros, 7);
  const corosCti = ewma(coros, 42);
  const heraclesAti = ewma(coros.map((load, index) => load + surplus[index]), 7);
  const heraclesCti = ewma(coros.map((load, index) => load + surplus[index]), 42);
  const series = heraclesDeltaSeries(
    new Map(days.flatMap((day, index) => (surplus[index] ? [[day, { surplus: surplus[index], pending: 0 }]] : []))),
    days.at(-1)
  );
  const dayList = days.map((happenDay, index) => ({
    happenDay,
    trainingLoad: coros[index],
    ati: corosAti[index],
    cti: corosCti[index],
    trainingLoadRatio: corosAti[index] / corosCti[index],
    heracles: series.get(happenDay)
  }));
  const read = fitnessInLoadSource(dayList, "heracles", { withLoad: true });
  for (const index of [0, 41, 90, 179]) {
    close(read[index].ati, heraclesAti[index], `Load Impact, day ${index}`);
    close(read[index].cti, heraclesCti[index], `Base Fitness, day ${index}`);
    close(read[index].trainingLoadRatio, heraclesAti[index] / heraclesCti[index], `Intensity Trend, day ${index}`);
    close(read[index].trainingLoad, coros[index] + surplus[index], `the day's load, day ${index}`);
    assert.equal(read[index].coros.ati, corosAti[index], "COROS's own kept");
  }
  assert.equal(fitnessInLoadSource(dayList, "coros"), dayList, "COROS chosen: the list as given");
  assert.equal(
    fitnessInLoadSource(dayList, "heracles")[90].trainingLoad,
    coros[90],
    "the day's load is left to the screens unless asked for"
  );
}

// --- 3. A session still loading ---
{
  const series = heraclesDeltaSeries(
    new Map([
      ["20260601", { surplus: 0, pending: 1 }],
      ["20261020", { surplus: 50, pending: 0 }]
    ]),
    "20261020"
  );
  assert.equal(series.get("20260601").partial, true);
  assert.equal(series.get("20261004").partial, true, "125 days later it still weighs");
  assert.equal(series.get("20261005").partial, undefined, "126 days later it no longer does");
}

// --- The week's range, from COROS's weekList row ---
{
  const week = { firstDayOfWeek: "20261026", recomendTlMin: 763, recomendTlMax: 991.9, heraclesRange: 70 };
  assert.deepEqual(weekRangeInLoadSource(week, "heracles"), { min: 833, max: 991.9 + 91, corosMin: 763, corosMax: 991.9 });
  assert.deepEqual(weekRangeInLoadSource(week, "coros"), { min: 763, max: 991.9, corosMin: 763, corosMax: 991.9 });
  assert.deepEqual(weekRangeInLoadSource({ recomendTlMin: 763, recomendTlMax: 991.9 }, "heracles"), {
    min: 763,
    max: 991.9,
    corosMin: 763,
    corosMax: 991.9
  });
}

console.log("heracles fitness: ok");
