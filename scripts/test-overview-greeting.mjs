import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const moduleUrl = pathToFileURL(
  path.join(repoRoot, "src", "overviewGreeting.ts")
);

const {
  buildOverviewGreetingCandidates,
  greetingSlotIndex,
  selectOverviewGreeting,
  selectOverviewGreetingLine,
  ROTATION_POOL_SIZE
} = await import(`${moduleUrl.href}?cacheBust=${Date.now()}`);

const NOW = new Date(2026, 8, 3, 9, 0, 0); // Thu 2026-09-03, 09:00 local
const FALLBACK = "Connect your COROS watch to get started";

function dayKey(offsetDays = 0) {
  const date = new Date(NOW);
  date.setDate(date.getDate() + offsetDays);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}${month}${day}`;
}

function startTime(offsetDays = 0) {
  const date = new Date(NOW);
  date.setDate(date.getDate() + offsetDays);
  date.setHours(7, 0, 0, 0);
  return Math.floor(date.getTime() / 1000);
}

function context(overrides = {}) {
  return {
    now: NOW,
    watchConnected: false,
    trainingConnected: true,
    ...overrides
  };
}

function ids(ctx) {
  return buildOverviewGreetingCandidates(ctx).map((line) => line.id);
}

// --- Nothing to say falls back to the caller's fixed copy -------------------

assert.equal(
  selectOverviewGreeting(
    context({ trainingConnected: true, watchConnected: false }),
    FALLBACK
  ),
  FALLBACK,
  "no signals at all keeps the original subtitle"
);

assert.equal(
  selectOverviewGreetingLine(context({ trainingConnected: true })),
  null,
  "no signals produces no line"
);

// --- Today's plan ----------------------------------------------------------

const easyToday = context({
  upcomingWorkouts: [{ happenDay: dayKey(0), name: "Easy Run", volume: "8 km" }]
});
assert.equal(
  selectOverviewGreeting(easyToday, FALLBACK),
  "An easy run today. Keep it conversational.",
  "an easy session today is named as such"
);

const intervalsToday = context({
  upcomingWorkouts: [{ happenDay: dayKey(0), name: "6x800m Intervals" }]
});
assert.equal(
  selectOverviewGreeting(intervalsToday, FALLBACK),
  "Intervals today. Warm up properly before the hard reps."
);

const namedToday = context({
  upcomingWorkouts: [{ happenDay: dayKey(0), name: "Swim Technique" }]
});
assert.equal(
  selectOverviewGreeting(namedToday, FALLBACK),
  "Swim Technique is on the plan today.",
  "an uncategorised workout falls back to its name"
);

const twoToday = context({
  upcomingWorkouts: [
    { happenDay: dayKey(0), name: "Easy Run" },
    { happenDay: dayKey(0), name: "Strength" }
  ]
});
assert.equal(
  selectOverviewGreeting(twoToday, FALLBACK),
  "2 sessions on the plan today."
);

const restDay = context({
  upcomingWorkouts: [{ happenDay: dayKey(1), name: "Long Run" }]
});
assert.equal(
  selectOverviewGreeting(restDay, FALLBACK),
  "Rest day today. Next up: Long Run tomorrow.",
  "a workout one day out reads as tomorrow"
);

assert.deepEqual(
  ids(context({ upcomingWorkouts: [{ happenDay: dayKey(-2), name: "Old" }] })),
  [],
  "workouts in the past are ignored"
);

// --- Sleep -----------------------------------------------------------------

const poorSleep = context({
  sleep: { records: [], mcpConnected: true, latest: { happenDay: dayKey(0), score: 48 } },
  upcomingWorkouts: [{ happenDay: dayKey(0), name: "Easy Run" }]
});
assert.equal(
  selectOverviewGreeting(poorSleep, FALLBACK),
  "Last night's sleep scored 48. Looks rough — keep today easy.",
  "a bad night outranks today's plan"
);

const shortSleep = context({
  sleep: {
    records: [],
    mcpConnected: true,
    latest: { happenDay: dayKey(0), totalMinutes: 312 }
  }
});
assert.equal(
  selectOverviewGreeting(shortSleep, FALLBACK),
  "Only 5h 12m of sleep last night. Go gentle today."
);

const napOnly = context({
  sleep: {
    records: [{ happenDay: dayKey(0), kind: "nap", totalMinutes: 40 }],
    mcpConnected: true,
    latest: { happenDay: dayKey(0), kind: "nap", totalMinutes: 40 }
  }
});
assert.deepEqual(ids(napOnly), [], "naps are not last night");

const partialNight = context({
  sleep: {
    records: [],
    mcpConnected: true,
    latest: { happenDay: dayKey(0), completeness: "partial", score: 41 }
  }
});
assert.deepEqual(
  ids(partialNight),
  [],
  "a part-recorded night draws no conclusions"
);

const staleSleep = context({
  sleep: { records: [], mcpConnected: true, latest: { happenDay: dayKey(-3), score: 41 } }
});
assert.deepEqual(ids(staleSleep), [], "sleep from days ago is dropped");

// COROS stamps a night with the morning it ended, so yesterday's key is the
// night before last — a watch that has not synced since yesterday morning must
// not put words about "last night" on the dashboard.
const nightBeforeLast = context({
  sleep: { records: [], mcpConnected: true, latest: { happenDay: dayKey(-1), score: 41 } }
});
assert.deepEqual(ids(nightBeforeLast), [], "the night before last is dropped");

// --- Recovery and resting heart rate ---------------------------------------

assert.equal(
  selectOverviewGreeting(context({ summary: { recoveryPct: 31 } }), FALLBACK),
  "Recovery is at 31%. Rest is training too."
);

assert.equal(
  selectOverviewGreeting(context({ summary: { recoveryPct: 94 } }), FALLBACK),
  "94% recovered. Your body is ready for a hard one."
);

assert.equal(
  selectOverviewGreeting(context({ summary: { recoveryPct: 76 } }), FALLBACK),
  "You're 76% recovered and good to go."
);

assert.equal(
  selectOverviewGreeting(
    context({
      summary: { recoveryPct: 76, rhrDelta: 6 },
      upcomingWorkouts: [{ happenDay: dayKey(0), name: "Tempo" }]
    }),
    FALLBACK
  ),
  "Resting heart rate is 6 bpm above your week's average. Worth an easy day.",
  "an elevated resting HR outranks the plan"
);

// --- Activities ------------------------------------------------------------

const loggedToday = context({
  activities: [
    { activityId: "1", sportType: 100, sportName: "Run", startTime: startTime(0), distance: 8420 }
  ],
  upcomingWorkouts: [{ happenDay: dayKey(0), name: "Easy Run" }]
});
assert.equal(
  selectOverviewGreeting(loggedToday, FALLBACK),
  "Today's run is logged — 8.42 km in the bank.",
  "work already done outranks the plan for it"
);

const loggedTodayImperial = selectOverviewGreeting(
  { ...loggedToday, unitSystem: "imperial" },
  FALLBACK
);
assert.match(loggedTodayImperial, /mi in the bank\.$/, "distance follows the unit system");

const longGap = context({
  activities: [
    { activityId: "1", sportType: 100, sportName: "Run", startTime: startTime(-6) }
  ]
});
assert.equal(
  selectOverviewGreeting(longGap, FALLBACK),
  "It's been 6 days since your last session. Ready when you are."
);

const streak = context({
  activities: [-3, -2, -1, 0].map((offset) => ({
    activityId: `a${offset}`,
    sportType: 100,
    sportName: "Run",
    startTime: startTime(offset)
  }))
});
assert.ok(
  ids(streak).includes("streak"),
  "four consecutive active days make a streak"
);
assert.equal(
  buildOverviewGreetingCandidates(streak).find((line) => line.id === "streak").text,
  "4 days in a row. Nice streak."
);

const streakThroughRestDay = context({
  activities: [-3, -2, -1].map((offset) => ({
    activityId: `a${offset}`,
    sportType: 100,
    sportName: "Run",
    startTime: startTime(offset)
  }))
});
assert.ok(
  ids(streakThroughRestDay).includes("streak"),
  "a streak ending yesterday still counts"
);

// --- Setup and media -------------------------------------------------------

assert.equal(
  selectOverviewGreeting(context({ trainingConnected: false }), FALLBACK),
  "Sign in to COROS to see your training at a glance."
);

assert.equal(
  selectOverviewGreeting(
    context({ watchConnected: true, downloadCount: 12 }),
    FALLBACK
  ),
  "12 tracks in your library, ready for the watch."
);

assert.equal(
  selectOverviewGreeting(
    context({ watchConnected: true, downloadCount: 1 }),
    FALLBACK
  ),
  "1 track in your library, ready for the watch."
);

assert.equal(
  selectOverviewGreeting(context({ watchConnected: true }), FALLBACK),
  "Watch connected. Grab some music for your next run."
);

// --- Ordering, urgency and rotation ----------------------------------------

const many = context({
  summary: { recoveryPct: 76, weekLoadTotal: 318, steps: 12480 },
  sleep: {
    records: [],
    mcpConnected: true,
    latest: { happenDay: dayKey(0), totalMinutes: 465 }
  },
  watchConnected: true,
  downloadCount: 4
});

const ranked = buildOverviewGreetingCandidates(many);
for (let index = 1; index < ranked.length; index += 1) {
  assert.ok(
    ranked[index - 1].priority >= ranked[index].priority,
    "candidates come back most important first"
  );
}

// A relevant line must not lose its slot to a far less useful one.
for (const [label, ctx] of [
  ["rest day", context({ watchConnected: true, upcomingWorkouts: [{ happenDay: dayKey(1), name: "Long Run" }] })],
  ["strong recovery", context({ watchConnected: true, summary: { recoveryPct: 94 } })],
  [
    "long layoff",
    context({
      watchConnected: true,
      activities: [{ activityId: "1", sportType: 100, sportName: "Run", startTime: startTime(-6) }]
    })
  ]
]) {
  for (const hour of [9, 14, 20]) {
    const now = new Date(NOW);
    now.setHours(hour, 0, 0, 0);
    assert.notEqual(
      selectOverviewGreetingLine({ ...ctx, now }).id,
      "watch-ready",
      `${label} is never rotated out for the media prompt`
    );
  }
}

const rotated = new Set();
for (let slot = 0; slot < 6; slot += 1) {
  const now = new Date(NOW);
  now.setDate(now.getDate() + Math.floor(slot / 3));
  now.setHours([9, 14, 20][slot % 3], 0, 0, 0);
  rotated.add(selectOverviewGreeting({ ...many, now }, FALLBACK));
}
assert.equal(
  rotated.size,
  ROTATION_POOL_SIZE,
  "non-urgent copy takes turns across the day instead of freezing"
);

const urgent = { ...many, summary: { ...many.summary, recoveryPct: 22 } };
const urgentTexts = new Set();
for (let slot = 0; slot < 3; slot += 1) {
  const now = new Date(NOW);
  now.setHours([9, 14, 20][slot], 0, 0, 0);
  urgentTexts.add(selectOverviewGreeting({ ...urgent, now }, FALLBACK));
}
assert.deepEqual(
  [...urgentTexts],
  ["Recovery is at 22%. Rest is training too."],
  "an urgent line is never rotated away"
);

// --- Slot index ------------------------------------------------------------

const morning = new Date(2026, 8, 3, 9, 0, 0);
const afternoon = new Date(2026, 8, 3, 14, 0, 0);
const evening = new Date(2026, 8, 3, 20, 0, 0);
const nextMorning = new Date(2026, 8, 4, 9, 0, 0);

assert.equal(greetingSlotIndex(afternoon) - greetingSlotIndex(morning), 1);
assert.equal(greetingSlotIndex(evening) - greetingSlotIndex(afternoon), 1);
assert.equal(greetingSlotIndex(nextMorning) - greetingSlotIndex(evening), 1);

console.log("overview greeting tests passed");
