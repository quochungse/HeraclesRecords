// Runs under Electron because this repo's Node is built without Amaro and
// cannot strip types; the module graph has extensionless imports, so the
// resolver hook comes along too.
import assert from "node:assert/strict";

import {
  TRAINING_LOAD_RESIDUAL_KEY,
  buildTrainingLoadBars,
  trainingLoadBarLegend,
  trainingLoadBarsHaveLoad,
  trainingLoadCalendarWindow
} from "../src/training/trainingLoadBars.ts";
import { SPORT_COLOR_CATEGORIES } from "../src/training/sportColors.ts";

const TODAY = new Date(2026, 8, 9); // 2026-09-09, local time.

/** Local-midnight epoch seconds, the shape COROS activity startTime arrives in. */
function startOfDaySeconds(year, month, day, hour = 7) {
  return Math.floor(new Date(year, month - 1, day, hour).getTime() / 1000);
}

function activity(id, sportType, day, trainingLoad, extra = {}) {
  return {
    activityId: id,
    sportType,
    startTime: startOfDaySeconds(2026, 9, day, extra.hour ?? 7),
    trainingLoad,
    ...extra
  };
}

// --- the window is calendar days, not the day list COROS happens to return ---
{
  const keys = trainingLoadCalendarWindow(7, TODAY);
  assert.equal(keys.length, 7, "seven days requested, seven columns drawn");
  assert.equal(keys[0], "20260903", "oldest day first");
  assert.equal(keys[6], "20260909", "newest day last");

  // COROS skips days it has nothing to say about. A bar chart driven straight
  // off that list would space a rest day as though it never happened.
  const gappy = [
    { date: "20260907", label: "09/07", trainingLoad: 90 },
    { date: "20260909", label: "09/09", trainingLoad: 40 }
  ];
  const bars = buildTrainingLoadBars({
    points: gappy,
    activities: [],
    days: 4,
    today: TODAY
  });
  assert.deepEqual(
    bars.map((bar) => bar.date),
    ["20260906", "20260907", "20260908", "20260909"],
    "every calendar day gets a column, load or not"
  );
  assert.deepEqual(
    bars.map((bar) => bar.total),
    [0, 90, 0, 40],
    "the days COROS omitted read as zero rather than collapsing the axis"
  );
  assert.deepEqual(
    bars.map((bar) => bar.label),
    ["09/06", "09/07", "09/08", "09/09"],
    "axis ticks stay MM/DD, narrow enough for thirty of them"
  );
}

// --- one block per activity, in start order, colored by its own sport ---
{
  const bars = buildTrainingLoadBars({
    points: [{ date: "20260909", label: "09/09", trainingLoad: 100 }],
    activities: [
      activity("evening-run", 100, 9, 40, { name: "Evening Run", hour: 18 }),
      activity("morning-gym", 402, 9, 60, { name: "Morning Lift", hour: 6 })
    ],
    days: 1,
    today: TODAY
  });

  const [bar] = bars;
  assert.equal(bar.total, 100, "column height is the day's load");
  assert.deepEqual(
    bar.blocks.map((block) => block.key),
    ["morning-gym", "evening-run"],
    "blocks stack bottom-up in the order the sessions happened"
  );
  assert.deepEqual(
    bar.blocks.map((block) => block.category),
    ["strength", "run"],
    "each block carries the sport category that colors it"
  );
  assert.deepEqual(
    bar.blocks.map((block) => block.value),
    [60, 40],
    "block heights are the sessions' own load, not a share of the total"
  );
  assert.deepEqual(
    bar.blocks.map((block) => block.label),
    ["Morning Lift", "Evening Run"],
    "the activity name labels its block"
  );
}

// --- two sessions of the same sport stay two blocks ---
{
  const [bar] = buildTrainingLoadBars({
    points: [{ date: "20260909", label: "09/09", trainingLoad: 70 }],
    activities: [
      activity("run-am", 100, 9, 30, { hour: 6 }),
      activity("run-pm", 100, 9, 40, { hour: 17 })
    ],
    days: 1,
    today: TODAY
  });

  assert.equal(bar.blocks.length, 2, "a double day is two blocks, not one");
  assert.deepEqual(
    bar.blocks.map((block) => block.category),
    ["run", "run"],
    "they share a color; the gap between them is what separates them"
  );
}

// --- COROS's daily figure sets the height; the shortfall becomes one block ---
{
  const [bar] = buildTrainingLoadBars({
    points: [{ date: "20260909", label: "09/09", trainingLoad: 120 }],
    activities: [
      activity("run", 100, 9, 70, { hour: 7 }),
      // Synced without a load — it can only show up inside the residual.
      activity("swim", 300, 9, undefined, { hour: 12 })
    ],
    days: 1,
    today: TODAY
  });

  assert.equal(bar.total, 120, "the tile's number and the column agree");
  assert.equal(bar.blocks.length, 2, "run plus one residual block");
  const residual = bar.blocks[1];
  assert.equal(residual.key, TRAINING_LOAD_RESIDUAL_KEY);
  assert.equal(residual.category, null, "the residual stands for no sport");
  assert.equal(residual.value, 50, "residual is daily load minus what is attributed");
}

// --- activities winning over a short daily figure is never clipped ---
{
  const [bar] = buildTrainingLoadBars({
    points: [{ date: "20260909", label: "09/09", trainingLoad: 30 }],
    activities: [activity("run", 100, 9, 80, { hour: 7 })],
    days: 1,
    today: TODAY
  });

  assert.equal(bar.total, 80, "a session that happened is not cut to fit");
  assert.equal(bar.blocks.length, 1, "and no negative residual is invented");
}

// --- days with nothing draw an empty column, and history decides the notice ---
{
  const bars = buildTrainingLoadBars({
    points: [],
    activities: [],
    days: 3,
    today: TODAY
  });
  assert.deepEqual(bars.map((bar) => bar.blocks.length), [0, 0, 0]);
  assert.equal(
    trainingLoadBarsHaveLoad(bars),
    false,
    "nothing anywhere is what the empty notice is for"
  );

  const quietWeek = buildTrainingLoadBars({
    points: [{ date: "20260901", label: "09/01", trainingLoad: 60 }],
    activities: [activity("run", 100, 1, 60)],
    days: 14,
    today: TODAY
  });
  assert.equal(
    trainingLoadBarsHaveLoad(quietWeek),
    true,
    "load anywhere in the window means the chart still draws"
  );
}

// --- sub-threshold load is not drawn as a block nobody can see ---
{
  const [bar] = buildTrainingLoadBars({
    points: [{ date: "20260909", label: "09/09", trainingLoad: 0.2 }],
    activities: [activity("blip", 100, 9, 0.2, { hour: 7 })],
    days: 1,
    today: TODAY
  });
  assert.equal(bar.blocks.length, 0, "0.2 rounds to nothing on screen");
  assert.equal(bar.total, 0.2, "but the column keeps the honest total");
}

// --- the legend lists only what the window actually contains ---
{
  const bars = buildTrainingLoadBars({
    points: [
      { date: "20260908", label: "09/08", trainingLoad: 50 },
      { date: "20260909", label: "09/09", trainingLoad: 90 }
    ],
    activities: [
      activity("bike", 200, 8, 50, { hour: 7 }),
      activity("gym", 402, 9, 60, { hour: 7 })
    ],
    days: 2,
    today: TODAY
  });

  const legend = trainingLoadBarLegend(bars, SPORT_COLOR_CATEGORIES);
  assert.deepEqual(
    legend.map((entry) => entry.key),
    ["strength", "bike", TRAINING_LOAD_RESIDUAL_KEY],
    "present sports in the settings order, residual last"
  );
  assert.equal(
    legend.filter((entry) => entry.key === "run").length,
    0,
    "a sport nobody did this window is not offered a swatch"
  );
}

console.log("training load bars: all assertions passed");
