// Section 3.3: threshold triggers. The four metrics' boundaries, and the
// per-binding transition state that decides whether a true condition is worth
// saying out loud.
//
// Every window here is a run of *local* calendar days, so the whole file runs
// in one fixed zone — the same reason test-coach-automation-schedule.mjs does.
process.env.TZ = "America/New_York";

import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Module = require("node:module");
const repoRoot = path.resolve(import.meta.dirname, "..");

// The scheduler reaches the runner and the store, which pull in electron and
// the better-sqlite3 native binding at require time. Every collaborator is
// injected, so the stubs only exist to get the modules loaded.
const fakeElectron = {
  BrowserWindow: Object.assign(class {}, { getAllWindows: () => [] }),
  app: { getPath: () => "/tmp", on: () => {}, whenReady: () => Promise.resolve() },
  safeStorage: { isEncryptionAvailable: () => false },
  shell: { openExternal: () => {} },
  net: { request: () => {} },
  session: { defaultSession: {} }
};
const originalLoad = Module._load;
Module._load = function patchedLoad(request, ...rest) {
  if (request === "electron") return fakeElectron;
  if (request === "better-sqlite3") return class FakeDatabase {};
  return originalLoad.call(this, request, ...rest);
};

const {
  ACUTE_WINDOW_DAYS,
  CHRONIC_WINDOW_DAYS,
  PLAN_ADHERENCE_LOOKBACK_DAYS,
  RESTING_HR_BASELINE_DAYS,
  RESTING_HR_STREAK_DAYS,
  SLEEP_TARGET_MINUTES,
  SLEEP_WINDOW_NIGHTS,
  THRESHOLD_LOOKBACK_DAYS,
  evaluateThresholdTrigger,
  fromDayKey,
  isAcuteChronicRamp,
  isPlanAdherenceBreach,
  isRestingHrDrift,
  isSleepDebt,
  toDayKey
} = require(path.join(repoRoot, "dist-electron", "coachThresholdMetrics.js"));

const { CoachAutomationScheduler, THRESHOLD_RETRY_INTERVAL_MS } = require(
  path.join(repoRoot, "dist-electron", "coachAutomationScheduler.js")
);

// ---------------------------------------------------------------------------
// The windows 3.3 names
// ---------------------------------------------------------------------------

assert.equal(ACUTE_WINDOW_DAYS, 7);
assert.equal(CHRONIC_WINDOW_DAYS, 28);
assert.equal(RESTING_HR_BASELINE_DAYS, 30);
assert.equal(RESTING_HR_STREAK_DAYS, 3);
assert.equal(SLEEP_WINDOW_NIGHTS, 7);
assert.ok(
  THRESHOLD_LOOKBACK_DAYS >= RESTING_HR_BASELINE_DAYS + RESTING_HR_STREAK_DAYS,
  "a snapshot has to reach back past the baseline *and* the streak in front of it"
);

// --- day keys ---------------------------------------------------------------
const NOW = new Date(2026, 7, 21, 9, 0, 0, 0); // 21 August 2026, 09:00 local

assert.equal(toDayKey(NOW), "20260821");
assert.deepEqual(fromDayKey("20260821"), new Date(2026, 7, 21));
assert.equal(fromDayKey("2026-08-21"), null, "a malformed key is not a date");
assert.equal(fromDayKey("nonsense"), null);

/** `daysAgo` from the fixture clock, as the "YYYYMMDD" the tables store. */
const dayKey = (daysAgo) => {
  const day = new Date(NOW);
  day.setDate(day.getDate() - daysAgo);
  return toDayKey(day);
};

/**
 * Epoch seconds, `daysAgo` and a half back. The half is what keeps each
 * activity strictly inside the windows it belongs to: the load windows are
 * measured in whole days from *now*, so a fixture placed at local noon would
 * put "seven days ago" on the wrong side of a 09:00 cut-off and quietly make a
 * flat block look like a ramp.
 */
const at = (daysAgo) =>
  Math.floor(NOW.getTime() / 1000) - Math.round((daysAgo + 0.5) * 86_400);

// ---------------------------------------------------------------------------
// acuteChronicRamp: 7-day load against the trailing 28-day average week
// ---------------------------------------------------------------------------

/**
 * A flat block plus a spike. `weekly` is spread one activity per day over the
 * 28 days, then the last 7 get `extra` on top, so the acute window is exactly
 * `weekly/4 + extra` and the chronic average week is `weekly/4 + extra/4`.
 */
function loadFixture(chronicTotal, acuteExtra) {
  const loads = [];
  for (let daysAgo = 0; daysAgo < CHRONIC_WINDOW_DAYS; daysAgo += 1) {
    loads.push({ startTime: at(daysAgo), load: chronicTotal / CHRONIC_WINDOW_DAYS });
  }
  for (let daysAgo = 0; daysAgo < ACUTE_WINDOW_DAYS; daysAgo += 1) {
    loads.push({ startTime: at(daysAgo), load: acuteExtra / ACUTE_WINDOW_DAYS });
  }
  return loads;
}

{
  // A perfectly flat block: acute is exactly the average week, ramp 0%.
  const flat = loadFixture(2800, 0);
  assert.equal(isAcuteChronicRamp(NOW, flat, 0), false, "flat is not a ramp");
  assert.equal(isAcuteChronicRamp(NOW, flat, -1), true, "and is above -1%");

  // The boundary. 3.3 says "exceeds ... by more than value %", so standing
  // exactly on the number is inside the rule, not outside it.
  const acute = 700 + 210; // the flat week plus 30% of it
  const chronicWeekly = (2800 + 210) / 4;
  const exact = ((acute / chronicWeekly) - 1) * 100;
  const ramped = loadFixture(2800, 210);
  assert.equal(
    isAcuteChronicRamp(NOW, ramped, exact),
    false,
    "exactly on the threshold does not fire — 3.3 says exceeds"
  );
  assert.equal(isAcuteChronicRamp(NOW, ramped, exact - 0.001), true, "just over does");
  assert.equal(isAcuteChronicRamp(NOW, ramped, exact + 0.001), false, "just under does not");
}

{
  // An athlete's first week back has no chronic block to be a ramp against, and
  // dividing by it would report an infinite one.
  const firstWeek = [{ startTime: at(1), load: 400 }];
  assert.equal(
    isAcuteChronicRamp(NOW, firstWeek, 10),
    true,
    "fixture sanity: one week of load *is* its own chronic block here"
  );
  assert.equal(
    isAcuteChronicRamp(NOW, [], 10),
    false,
    "with no load at all there is no ratio to take"
  );
  assert.equal(
    isAcuteChronicRamp(NOW, [{ startTime: at(40), load: 500 }], 10),
    false,
    "and load older than the chronic window is outside it, not zero-weighted"
  );
}

// ---------------------------------------------------------------------------
// restingHrDrift: N bpm over the 30-day baseline, three days running
// ---------------------------------------------------------------------------

/** A steady baseline, with the last three days optionally lifted. */
function hrFixture(baseline, streak) {
  const daily = [];
  for (
    let daysAgo = RESTING_HR_STREAK_DAYS;
    daysAgo < RESTING_HR_STREAK_DAYS + RESTING_HR_BASELINE_DAYS;
    daysAgo += 1
  ) {
    daily.push({ day: dayKey(daysAgo), restingHr: baseline });
  }
  streak.forEach((value, index) => {
    if (value !== null) {
      daily.push({ day: dayKey(RESTING_HR_STREAK_DAYS - 1 - index), restingHr: value });
    }
  });
  return daily;
}

{
  assert.equal(
    isRestingHrDrift(NOW, hrFixture(50, [55, 55, 55]), 5),
    true,
    "exactly 5 bpm above *is* 5 bpm above"
  );
  assert.equal(
    isRestingHrDrift(NOW, hrFixture(50, [54.9, 55, 55]), 5),
    false,
    "one day short of the bar breaks the streak"
  );
  assert.equal(isRestingHrDrift(NOW, hrFixture(50, [55, 55, 55]), 5.1), false);

  // The streak has to be the three days ending today. Two elevated days and a
  // recovered one is a recovery, not a drift.
  assert.equal(isRestingHrDrift(NOW, hrFixture(50, [50, 55, 55]), 5), false);

  // A missing reading breaks it rather than passing through: three consecutive
  // days is a claim about three days, and a day with no reading is not one.
  assert.equal(
    isRestingHrDrift(NOW, hrFixture(50, [55, null, 55]), 5),
    false,
    "a gap in the streak is a gap, not a pass"
  );

  assert.equal(
    isRestingHrDrift(NOW, [{ day: dayKey(0), restingHr: 90 }], 5),
    false,
    "with no baseline there is nothing to be above"
  );
}

{
  // The baseline is the 30 days *before* the streak. Averaging the elevated
  // days into it would raise the bar the longer the drift lasted, which is
  // backwards — so the same readings must fire either way round.
  const daily = hrFixture(50, [55, 55, 55]);
  const withStreakInBaseline =
    (50 * RESTING_HR_BASELINE_DAYS + 55 * 3) / (RESTING_HR_BASELINE_DAYS + 3);
  assert.ok(
    withStreakInBaseline > 50,
    "fixture sanity: including the streak would move the baseline up"
  );
  assert.equal(
    isRestingHrDrift(NOW, daily, 5),
    true,
    "the baseline excludes the streak, so 5 above 50 still counts"
  );
  assert.equal(
    55 >= withStreakInBaseline + 5,
    false,
    "and would not have, had the streak been averaged in"
  );
}

// ---------------------------------------------------------------------------
// planAdherence: an unmatched slot, N hours after the day it was due
// ---------------------------------------------------------------------------

{
  // The clock starts at the *end* of the scheduled day: a plan entry carries a
  // day and no time, so a Tuesday workout is not missed at lunchtime Tuesday.
  const yesterday = [{ day: dayKey(1), matched: false }];
  // NOW is 09:00, so yesterday's day ended 9 hours ago.
  assert.equal(isPlanAdherenceBreach(NOW, yesterday, 9), false, "exactly on the grace holds");
  assert.equal(isPlanAdherenceBreach(NOW, yesterday, 8.99), true, "just past it does not");
  assert.equal(isPlanAdherenceBreach(NOW, yesterday, 9.01), false);

  assert.equal(
    isPlanAdherenceBreach(NOW, [{ day: dayKey(0), matched: false }], 0),
    false,
    "today's workout has not run out of day yet"
  );
  assert.equal(
    isPlanAdherenceBreach(NOW, [{ day: dayKey(1), matched: true }], 1),
    false,
    "a matched slot is not a miss, however long ago"
  );
  assert.equal(isPlanAdherenceBreach(NOW, [{ day: "nonsense", matched: false }], 1), false);
}

{
  // Without a lookback this metric latches: a workout missed in March stays
  // unmatched forever, so the condition would be true forever, so the rule
  // would fire once and then never again.
  const ancient = [{ day: dayKey(PLAN_ADHERENCE_LOOKBACK_DAYS + 1), matched: false }];
  assert.equal(
    isPlanAdherenceBreach(NOW, ancient, 1),
    false,
    "an old miss ages out, so the condition can fall back and re-arm"
  );
  assert.equal(
    isPlanAdherenceBreach(
      NOW,
      [{ day: dayKey(PLAN_ADHERENCE_LOOKBACK_DAYS - 1), matched: false }],
      1
    ),
    true,
    "and one inside the window still counts"
  );
}

// ---------------------------------------------------------------------------
// sleepDebt: the rolling 7-night deficit
// ---------------------------------------------------------------------------

/** `minutes[i]` is i nights ago; null means the watch was on the charger. */
const sleepFixture = (minutes) =>
  minutes.flatMap((value, index) =>
    value === null ? [] : [{ day: dayKey(index), sleepMinutes: value }]
  );

{
  const short = SLEEP_TARGET_MINUTES - 60; // an hour down, every night
  const week = sleepFixture(Array.from({ length: SLEEP_WINDOW_NIGHTS }, () => short));
  assert.equal(isSleepDebt(NOW, week, 7), false, "exactly 7 hours down does not exceed 7");
  assert.equal(isSleepDebt(NOW, week, 6.99), true, "just under the bar does");
  assert.equal(isSleepDebt(NOW, week, 7.01), false);

  // A deficit nets out: one long night pays back a short one, because that is
  // what a rolling deficit means.
  const paidBack = sleepFixture([
    SLEEP_TARGET_MINUTES + 360,
    ...Array.from({ length: SLEEP_WINDOW_NIGHTS - 1 }, () => short)
  ]);
  assert.equal(isSleepDebt(NOW, paidBack, 1), false, "a long night pays back short ones");

  // Nights with no reading drop out of both sides. Counting a missing night
  // against the full target manufactures eight hours of debt from a watch left
  // on the charger, which is the easiest way for this rule to fire on nothing.
  const oneNight = sleepFixture([
    short,
    ...Array.from({ length: SLEEP_WINDOW_NIGHTS - 1 }, () => null)
  ]);
  assert.equal(
    isSleepDebt(NOW, oneNight, 2),
    false,
    "six missing nights are six unknowns, not six eight-hour holes"
  );
  assert.equal(isSleepDebt(NOW, [], 0), false, "and no readings at all is not a debt");

  // Older than the window is outside it.
  assert.equal(
    isSleepDebt(NOW, [{ day: dayKey(SLEEP_WINDOW_NIGHTS), sleepMinutes: 0 }], 1),
    false
  );
}

// --- the dispatcher reaches all four ---------------------------------------
{
  // Merged by day rather than concatenated: both series live on the same row,
  // and two entries for one day would leave whichever came last as the only
  // one the metric can see.
  const merged = new Map();
  for (const sample of [
    ...hrFixture(50, [70, 70, 70]),
    ...sleepFixture([60, 60, 60, 60, 60, 60, 60])
  ]) {
    merged.set(sample.day, { ...merged.get(sample.day), ...sample });
  }
  const snapshot = {
    loads: loadFixture(2800, 2800),
    daily: [...merged.values()],
    planned: [{ day: dayKey(2), matched: false }]
  };
  for (const metric of [
    "acuteChronicRamp",
    "restingHrDrift",
    "planAdherence",
    "sleepDebt"
  ]) {
    assert.equal(
      evaluateThresholdTrigger({ kind: "threshold", metric, value: 1 }, NOW, snapshot),
      true,
      `${metric} must be wired into the dispatcher`
    );
  }
  assert.equal(
    evaluateThresholdTrigger(
      { kind: "threshold", metric: "somethingElse", value: 1 },
      NOW,
      snapshot
    ),
    false,
    "a metric nobody implemented is silent, not loud"
  );
}

// ---------------------------------------------------------------------------
// The transition, per binding
// ---------------------------------------------------------------------------

const thresholdAutomation = (patch = {}) => ({
  id: "auto-1",
  name: "Ramp watch",
  playbook: "Say something about the ramp.",
  enabled: true,
  trigger: { kind: "threshold", metric: "acuteChronicRamp", value: 30 },
  conditions: { cooldownMin: 0, maxRunsPerDay: 9 },
  runtime: {},
  ...patch
});

const thresholdBinding = (patch = {}) => ({
  id: "bind-1",
  automationId: "auto-1",
  mode: "dedicated",
  sessionId: "sess-1",
  enabled: true,
  sortOrder: 0,
  createdAt: NOW.toISOString(),
  ...patch
});

/**
 * A scheduler whose only interesting input is "does the condition hold". The
 * metric maths is settled above; what is under test here is what the scheduler
 * does with the answer, and the state it keeps to decide.
 */
function harness({ automations, bindings, firing = false, outcome }) {
  const rows = new Map(bindings.map((row) => [row.id, { ...row }]));
  const state = {
    firing,
    /** The scheduler copies its deps on construction, so the clock is read
     * through the closure rather than replaced on `deps` afterwards. */
    clock: NOW,
    triggers: [],
    writes: [],
    snapshotReads: 0,
    errors: [],
    order: [],
    /**
     * What the runner answers. Two facts the first version of this fake
     * collapsed into one empty array: whether the trigger reached the runner,
     * and whether the runner *ran* it. Guard rails 1-8 belong to the runner, so
     * a crossing handed over can still come back refused — and the scheduler
     * has to treat that differently from one that was announced.
     */
    outcome: outcome ?? [{ id: "run-1", status: "success" }]
  };

  const deps = {
    now: () => state.clock,
    listAutomations: () => automations,
    listActiveBindings: (automationId) =>
      [...rows.values()].filter(
        (row) => row.automationId === automationId && row.enabled !== false
      ),
    setBindingNextRun: () => undefined,
    recordStaleSlot: (input) => ({ id: "skip-1", status: "skipped", ...input }),
    runTrigger: async (event) => {
      state.order.push("run");
      state.triggers.push(event);
      return state.outcome;
    },
    readThresholdSnapshot: () => {
      state.snapshotReads += 1;
      // Just enough load for the ramp to be *computable*: the dial below moves
      // the automation's threshold to ±Infinity rather than moving the data, so
      // a transition test cannot pass by accident because a fixture drifted
      // over a boundary. An empty snapshot would make the metric answer "no"
      // for its own reasons and the dial would do nothing.
      return { loads: [{ startTime: at(1), load: 100 }], daily: [], planned: [] };
    },
    setBindingThresholdFiring: (bindingId, value) => {
      state.order.push("write");
      state.writes.push({ bindingId, firing: value });
      const row = rows.get(bindingId);
      if (row) row.thresholdFiring = value;
    },
    onError: (error) => state.errors.push(error)
  };

  // `evaluateThresholdTrigger` is the real one, so the dial goes through the
  // trigger's own value: a threshold of -Infinity always holds, +Infinity never.
  for (const automation of automations) {
    if (automation.trigger.kind === "threshold") {
      automation.trigger.value = state.firing ? -Infinity : Infinity;
    }
  }

  return {
    rows,
    state,
    deps,
    scheduler: new CoachAutomationScheduler(deps),
    /** Re-arms the condition and rebuilds the scheduler around the same rows. */
    setFiring(value) {
      state.firing = value;
      for (const automation of automations) {
        if (automation.trigger.kind === "threshold") {
          automation.trigger.value = value ? -Infinity : Infinity;
        }
      }
    }
  };
}

// --- a binding attached today does not fire on history ---------------------
{
  // The condition has held all week. Attaching a coach this morning must record
  // where things stand and say nothing: the athlete already knows about the
  // block they just trained.
  const h = harness({
    automations: [thresholdAutomation()],
    bindings: [thresholdBinding()],
    firing: true
  });

  await h.scheduler.tick();
  assert.deepEqual(h.state.triggers, [], "the first look never runs");
  assert.deepEqual(
    h.state.writes,
    [{ bindingId: "bind-1", firing: true }],
    "it records the answer instead"
  );

  // And now it is armed: the same condition on the next tick is not a
  // transition, so it still says nothing.
  await h.scheduler.tick();
  assert.deepEqual(h.state.triggers, []);
  assert.equal(h.state.writes.length, 1, "and does not rewrite a state that has not moved");
}

// --- it fires on the transition, once --------------------------------------
{
  const h = harness({
    automations: [thresholdAutomation()],
    bindings: [thresholdBinding()],
    firing: false
  });

  await h.scheduler.tick();
  assert.deepEqual(h.state.writes, [{ bindingId: "bind-1", firing: false }]);
  assert.deepEqual(h.state.triggers, [], "seeding is not firing, whichever way it seeds");

  h.setFiring(true);
  await h.scheduler.tick();
  assert.deepEqual(h.state.triggers, [
    { automationId: "auto-1", kind: "threshold", bindingIds: ["bind-1"] }
  ]);

  // 3.3's headline: a metric hovering on its threshold must not produce a run
  // an hour. Sixty ticks later — an hour of them — it has said nothing more.
  for (let tick = 0; tick < 60; tick += 1) {
    await h.scheduler.tick();
  }
  assert.equal(h.state.triggers.length, 1, "an hour of ticks is still one run");
}

// --- the state is written before the run -----------------------------------
{
  // The same rule as 3.1's book-before-run: a run takes as long as the provider
  // does and the app may be closed mid-flight, so the worst case has to be one
  // missed announcement rather than the same one on every tick forever.
  const h = harness({
    automations: [thresholdAutomation()],
    bindings: [thresholdBinding({ thresholdFiring: false })],
    firing: true
  });

  await h.scheduler.tick();
  assert.deepEqual(h.state.order, ["write", "run"]);
}

// --- falling back is recorded, not announced -------------------------------
{
  const h = harness({
    automations: [thresholdAutomation()],
    bindings: [thresholdBinding({ thresholdFiring: true })],
    firing: false
  });

  await h.scheduler.tick();
  assert.deepEqual(h.state.triggers, [], "a metric recovering is not news");
  assert.deepEqual(h.state.writes, [{ bindingId: "bind-1", firing: false }]);

  // And the rule is re-armed by it, which is the point of recording it.
  h.setFiring(true);
  await h.scheduler.tick();
  assert.equal(h.state.triggers.length, 1, "so the next crossing fires again");
}

// --- the state survives a restart ------------------------------------------
{
  // The scheduler keeps nothing in memory: a fresh instance reads the same rows
  // and reaches the same conclusion. Anything less and every relaunch would
  // re-announce whatever was already true — and the app is relaunched daily.
  const rows = [thresholdBinding()];
  const first = harness({
    automations: [thresholdAutomation()],
    bindings: rows,
    firing: true
  });
  await first.scheduler.tick();
  assert.deepEqual(first.state.triggers, []);
  const persisted = [...first.rows.values()];
  assert.equal(persisted[0].thresholdFiring, true, "the row carries it, not the process");

  const afterRestart = harness({
    automations: [thresholdAutomation()],
    bindings: persisted,
    firing: true
  });
  await afterRestart.scheduler.tick();
  assert.deepEqual(
    afterRestart.state.triggers,
    [],
    "a relaunch into the same condition announces nothing"
  );
  assert.deepEqual(afterRestart.state.writes, [], "and rewrites nothing");
}

// --- per binding, not per automation ---------------------------------------
{
  // One conversation attached last month is armed; one attached this morning is
  // not. They legitimately disagree, which is why the state is on the binding.
  const h = harness({
    automations: [thresholdAutomation()],
    bindings: [
      thresholdBinding({ id: "old", thresholdFiring: false }),
      thresholdBinding({ id: "new" })
    ],
    firing: true
  });

  await h.scheduler.tick();
  assert.deepEqual(
    h.state.triggers,
    [{ automationId: "auto-1", kind: "threshold", bindingIds: ["old"] }],
    "the armed binding fires and the fresh one seeds"
  );
  assert.deepEqual(h.state.writes, [
    { bindingId: "old", firing: true },
    { bindingId: "new", firing: true }
  ]);

}

// --- one snapshot for the whole tick ---------------------------------------
{
  // The four metrics read the same local rows, so several threshold rules are
  // several questions about one month of activities — not one scan each.
  const h = harness({
    automations: [
      thresholdAutomation({ id: "auto-1" }),
      thresholdAutomation({ id: "auto-2", name: "Sleep watch" })
    ],
    bindings: [
      thresholdBinding({ id: "bind-1", automationId: "auto-1" }),
      thresholdBinding({ id: "bind-2", automationId: "auto-2" })
    ],
    firing: true
  });

  await h.scheduler.tick();
  assert.deepEqual(
    h.state.writes.map((write) => write.bindingId),
    ["bind-1", "bind-2"],
    "fixture sanity: both rules were evaluated"
  );
  assert.equal(h.state.snapshotReads, 1, "and they shared one read of the rows");
}

// --- a rule attached to nothing costs no read -------------------------------
{
  // The snapshot is a scan of a month of activities and thirty days of samples.
  // An automation with no bindings has nobody to tell, so paying for it would
  // be a tick's worth of work thrown away — every minute, for as long as the
  // athlete leaves the rule unattached.
  const h = harness({
    automations: [thresholdAutomation()],
    bindings: [],
    firing: true
  });

  await h.scheduler.tick();
  assert.equal(h.state.snapshotReads, 0, "nothing to tell, nothing to read");
  assert.deepEqual(h.state.triggers, []);
}

// --- a disabled automation is not evaluated at all --------------------------
{
  const h = harness({
    automations: [thresholdAutomation({ enabled: false })],
    bindings: [thresholdBinding({ thresholdFiring: false })],
    firing: true
  });

  await h.scheduler.tick();
  assert.deepEqual(h.state.triggers, []);
  assert.deepEqual(h.state.writes, [], "a switched-off rule keeps no state either");
  assert.equal(h.state.snapshotReads, 0, "and costs no read");
}

// --- a nought is not a reading, and this one is averaged --------------------
{
  // R4 step 7. `isSleepDebt` has always wanted `> 0` from its nights; this one
  // took anything finite, and it feeds a *baseline* — so one zero from a bad
  // COROS payload or a hand edit drags the average down and turns an ordinary
  // morning into three days of drift. A rule that announces a problem the
  // athlete does not have is worse than one that stays quiet.
  // The streak has to sit *between* the two baselines, or both readings agree
  // and the fixture proves nothing — the trap the trimming suite already fell
  // into once. Baseline 50 over 30 days; one zero drags it to 48.3. A streak of
  // 54 clears 48.3 + 5 and does not clear 50 + 5, so the two readings disagree
  // here and only here.
  const withZero = hrFixture(50, [54, 54, 54]);
  withZero[0] = { ...withZero[0], restingHr: 0 };
  assert.equal(
    isRestingHrDrift(NOW, withZero, 5),
    false,
    "a zero is dropped rather than averaged in"
  );

  // The same fixture with that day simply absent must agree — which is the
  // point: an unreadable value and a missing one are the same fact.
  assert.equal(
    isRestingHrDrift(NOW, withZero.slice(1), 5),
    false,
    "and a missing day reads identically"
  );

  // And the guard has not made the metric unable to fire.
  assert.equal(
    isRestingHrDrift(NOW, hrFixture(50, [56, 56, 56]), 5),
    true,
    "a real drift still fires"
  );
  // The fixture is on the right side of the line for the reason above: without
  // the guard, the same 54 would have fired.
  assert.equal(
    isRestingHrDrift(NOW, hrFixture(48.333333333333336, [54, 54, 54]), 5),
    true,
    "fixture sanity: 54 does clear a baseline dragged down by one zero"
  );
}

// ---------------------------------------------------------------------------
// A crossing the runner refused is still owed
// ---------------------------------------------------------------------------
// The state is written before the run so a crash cannot re-announce (3.3), and
// nothing wrote it back when the run never happened. Guard rails 1-8 belong to
// the runner, so a crossing handed over comes back refused on any of them — and
// the rule then recorded the announcement it never made. A metric that stays
// true, which is the only kind a threshold rule watches, never fires again.

/** The scheduler's clock starts at `NOW`; move the harness forward by `ms`. */
const advance = (h, ms) => {
  h.state.clock = new Date(NOW.getTime() + ms);
  return h.state.clock;
};

const REFUSED = [{ id: "run-1", status: "skipped", skipReason: "cooldown" }];

// --- a guard rail refusing does not spend the crossing ----------------------
{
  const h = harness({
    automations: [thresholdAutomation()],
    bindings: [thresholdBinding({ thresholdFiring: false })],
    firing: true,
    outcome: REFUSED
  });

  await h.scheduler.tick();
  assert.equal(h.state.triggers.length, 1, "the crossing was handed over");
  assert.equal(
    h.rows.get("bind-1").thresholdFiring,
    false,
    "and put back, because nothing was announced"
  );

  // Not on the very next tick, though: the refusal will not have changed in
  // sixty seconds, and one identical skip a minute is the run log section 10
  // built the pause to stop filling.
  await h.scheduler.tick();
  await h.scheduler.tick();
  assert.equal(h.state.triggers.length, 1, "and it is not re-offered every tick");

  // On its own rhythm, it is.
  advance(h, THRESHOLD_RETRY_INTERVAL_MS + 1_000);
  await h.scheduler.tick();
  assert.equal(h.state.triggers.length, 2, "the crossing is still owed, and re-offered");
}

// --- and once it lands, it is spent ----------------------------------------
{
  const h = harness({
    automations: [thresholdAutomation()],
    bindings: [thresholdBinding({ thresholdFiring: false })],
    firing: true,
    outcome: REFUSED
  });

  await h.scheduler.tick();
  h.state.outcome = [{ id: "run-2", status: "success" }];
  advance(h, THRESHOLD_RETRY_INTERVAL_MS + 1_000);
  await h.scheduler.tick();
  assert.equal(h.state.triggers.length, 2);
  assert.equal(
    h.rows.get("bind-1").thresholdFiring,
    true,
    "the coach looked, so the athlete has been told"
  );

  // Which is 3.3's headline again: an hour of ticks says nothing more.
  for (let tick = 0; tick < 60; tick += 1) {
    advance(h, THRESHOLD_RETRY_INTERVAL_MS * (tick + 2));
    await h.scheduler.tick();
  }
  assert.equal(h.state.triggers.length, 2, "a metric that stays true is still one run");
}

// --- a run that reached the provider and failed is not a refusal ------------
{
  // Section 10's backoff already owns that retry, and it holds the binding off
  // for minutes rather than seconds. Re-offering here would loop the crossing
  // against a provider that is known to be down.
  const h = harness({
    automations: [thresholdAutomation()],
    bindings: [thresholdBinding({ thresholdFiring: false })],
    firing: true,
    outcome: [{ id: "run-1", status: "failed", error: "the provider fell over" }]
  });

  await h.scheduler.tick();
  assert.equal(
    h.rows.get("bind-1").thresholdFiring,
    true,
    "the model was asked; what happened next is the backoff's business"
  );
}

// --- the pause holding the trigger at the gate is a refusal too -------------
{
  // A held trigger produces no runs and logs nothing (10), so the empty answer
  // is all the scheduler gets — and it means the crossing was never announced.
  const h = harness({
    automations: [thresholdAutomation()],
    bindings: [thresholdBinding({ thresholdFiring: false })],
    firing: true,
    outcome: []
  });

  await h.scheduler.tick();
  assert.equal(
    h.rows.get("bind-1").thresholdFiring,
    false,
    "COROS wanting a login code must not cost the athlete the crossing"
  );
}

// --- quiet hours defer a crossing, they do not swallow it -------------------
{
  // The same rule 3.1 follows for a slot. Deferred in the scheduler rather than
  // skipped in the runner, so the night writes no rows at all: a quiet window
  // is hours long, and one skip a minute through it is the log this is avoiding.
  const quiet = thresholdAutomation({
    conditions: {
      cooldownMin: 0,
      maxRunsPerDay: 9,
      quietHours: { start: "22:00", end: "07:00" }
    }
  });
  const h = harness({
    automations: [quiet],
    bindings: [thresholdBinding({ thresholdFiring: false })],
    firing: true
  });
  // 23:30 local, inside the window.
  const night = new Date(NOW);
  night.setHours(23, 30, 0, 0);
  h.state.clock = night;

  await h.scheduler.tick();
  assert.deepEqual(h.state.triggers, [], "nobody is spoken to at half past eleven");
  assert.deepEqual(h.state.writes, [], "and nothing is recorded as announced");

  // Morning: the condition still holds, so it is the identical transition.
  const morning = new Date(NOW);
  morning.setHours(7, 30, 0, 0);
  morning.setDate(morning.getDate() + 1);
  h.state.clock = morning;
  await h.scheduler.tick();
  assert.equal(h.state.triggers.length, 1, "and it is still news when the window closes");
  assert.equal(h.rows.get("bind-1").thresholdFiring, true);
}

// --- recovering is still recorded, quiet hours or not -----------------------
{
  // Falling back announces nothing, so there is nothing to defer — and it is
  // what re-arms the rule, so deferring it would be the crossing lost twice.
  const quiet = thresholdAutomation({
    conditions: {
      cooldownMin: 0,
      maxRunsPerDay: 9,
      quietHours: { start: "22:00", end: "07:00" }
    }
  });
  const h = harness({
    automations: [quiet],
    bindings: [thresholdBinding({ thresholdFiring: true })],
    firing: false
  });
  const night = new Date(NOW);
  night.setHours(23, 30, 0, 0);
  h.state.clock = night;

  await h.scheduler.tick();
  assert.deepEqual(h.state.triggers, []);
  assert.deepEqual(h.state.writes, [{ bindingId: "bind-1", firing: false }]);
}

// --- a detached binding takes its retry hold with it ------------------------
{
  // Detach deletes the row and a re-attach is a new one (2.4), so a hold keyed
  // by binding id can never be claimed again. Left alone it sits in the map for
  // the life of the process, and the process is meant to run for weeks.
  //
  // White-box on purpose, and the one kind of assertion that earns it: a hold
  // nobody can claim has no behavioural shadow to observe. There is nothing to
  // drive and nothing to watch — only the map itself says whether the entry
  // went. Everything else in this block is driven through the tick.
  const h = harness({
    automations: [thresholdAutomation()],
    bindings: [
      thresholdBinding({ thresholdFiring: false }),
      thresholdBinding({ id: "bind-2", thresholdFiring: false })
    ],
    firing: true,
    outcome: REFUSED
  });

  await h.scheduler.tick();
  assert.equal(h.state.triggers.length, 2, "both places were offered the crossing");

  h.rows.delete("bind-1");
  await h.scheduler.tick();

  // The surviving binding still holds; the detached one left nothing behind.
  assert.equal(
    h.scheduler.retryAfter.has("bind-2"),
    true,
    "the place that is still there keeps its hold"
  );
  assert.equal(
    h.scheduler.retryAfter.has("bind-1"),
    false,
    "and the one that is gone does not linger"
  );
}

// --- a re-attached binding is a new place, and starts silent ----------------
{
  // Its row is new, so `threshold_firing` is NULL — never evaluated. 3.3's seed
  // rule then does the right thing on its own: a coach attached this morning
  // must not fire on a condition that has held all week, and re-attaching is
  // attaching.
  const h = harness({
    automations: [thresholdAutomation()],
    bindings: [thresholdBinding({ thresholdFiring: true })],
    firing: true
  });

  h.rows.delete("bind-1");
  h.rows.set("bind-2", {
    id: "bind-2",
    automationId: "auto-1",
    mode: "dedicated",
    sessionId: "sess-1",
    enabled: true,
    sortOrder: 0,
    createdAt: NOW.toISOString()
  });

  await h.scheduler.tick();
  assert.deepEqual(h.state.triggers, [], "the new place says nothing on its first look");
  assert.deepEqual(
    h.state.writes,
    [{ bindingId: "bind-2", firing: true }],
    "it records where things stand instead"
  );
}

Module._load = originalLoad;
console.log("coach automation threshold tests passed");
