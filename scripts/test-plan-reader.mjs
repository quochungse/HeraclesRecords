/**
 * A plan read week by week, and what each session says.
 *
 * The five things this holds down, each of which is a way the reader could
 * be confidently wrong:
 *
 * 1. An empty week is still a week. Dropping it renumbers every week after
 *    it, so "Week 9" in the reader would not be week 9 of the plan.
 * 2. A session's figures come from `planEntryMetrics`, which the library row
 *    totals. Two implementations of that arithmetic disagree in front of the
 *    athlete — one number on the row, a different set inside it.
 * 3. Only a plan on the calendar reports a session's outcome, keyed as COROS
 *    keys the calendar entry (`instance:idInPlan`) — the same join
 *    `planCompliance` makes. A plan that is not on the calendar has a running
 *    copy that is a plan of its own.
 * 4. A session with no status is not "upcoming". The question does not apply
 *    to a plan that is not on the calendar, and a screen full of "Ahead"
 *    badges on one is an answer to a question nobody asked.
 * 5. Only a plan on the calendar has dates, counted from the Monday COROS
 *    counts its days from.
 * 6. A week's stage is COROS's own, read by label.
 * 8. A duration is stated only when it is the whole session. The figure is a
 *    sum of timed steps, so a run written in distances with a timed jog
 *    between strides summed to nine minutes and a 31 km week to "0.1 hours".
 * 9. The session view steps through the plan in the order the reader drew
 *    it, counts steps the way its own hero does, and reports what the
 *    matched activity actually did.
 *
 * Runs through Electron only so `--experimental-strip-types` is available on
 * a Node built without Amaro; it touches no SQLite and no window. The
 * resolver hook is needed because `planReaderModel.ts` imports
 * `trainingPlanDomain` without an extension — and this file imports it by
 * the same path, so both get the one module and the shared-arithmetic
 * assertion is comparing one implementation against itself.
 */
import assert from "node:assert/strict";
import {
  formatPlannedDuration,
  planSessions,
  stageForWeek,
  readPlan,
  ridgeMeasure,
  statusLabel,
  statusTone,
  weekRidgeSegments
} from "../src/training-library/planReaderModel.ts";
import { summarizeTrainingPlan } from "../electron/trainingPlanDomain.ts";

let seq = 0;

function entry(overrides = {}) {
  seq += 1;
  const title = overrides.title ?? `Session ${seq}`;
  return {
    id: `entry-${seq}`,
    weekIndex: 0,
    dayIndex: 0,
    sortOrder: seq,
    title,
    workout: { key: `w-${seq}`, name: title, sport: "run" },
    ...overrides
  };
}

function plan(overrides = {}) {
  return {
    id: "coros:plan-1",
    remoteId: "plan-1",
    name: "Marathon block",
    description: "",
    sportMix: ["run"],
    weekCount: 2,
    weekStages: [],
    entries: [],
    calendar: "unscheduled",
    tags: [],
    favorite: false,
    archived: false,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

/** A plan on the calendar: COROS's instance, week 1 on Monday 2 Mar. */
const running = (overrides = {}) =>
  plan({ calendar: "running", startDate: "2026-03-02", ...overrides });

function match(idInPlan, status, overrides = {}) {
  return {
    id: `match-${idInPlan}`,
    schedulePlanId: "plan-1",
    scheduleIdInPlan: idInPlan,
    happenDay: "2026-03-02",
    status,
    manual: false,
    updatedAt: "2026-03-03T00:00:00.000Z",
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// 1. Every declared week is a week, empty or not
// ---------------------------------------------------------------------------
{
  const reading = readPlan(
    plan({ weekCount: 4, entries: [entry({ weekIndex: 3, title: "Long run" })] })
  );

  assert.equal(reading.weeks.length, 4, "the plan declares four weeks, so four are read");
  assert.deepEqual(
    reading.weeks.map((week) => week.weekIndex),
    [0, 1, 2, 3],
    "week indexes stay the plan's own — dropping the three empty ones would " +
      "move the long run into week 1"
  );
  assert.equal(reading.weeks[3].days[0].entries[0].title, "Long run");
  assert.equal(
    reading.weeks[0].days.length,
    7,
    "a week has seven days whether or not anything is planned in them"
  );
  assert.equal(readPlan(plan({ weekCount: 0 })).weeks.length, 0);
}

// ---------------------------------------------------------------------------
// 2. A session's figures are the ones the library row totals
// ---------------------------------------------------------------------------
{
  const steps = [
    { target_duration_seconds: 600, target_load: 20 },
    { target_duration_seconds: 1800, target_distance_meters: 6000, target_load: 70 }
  ];
  const structured = entry({
    title: "Tempo",
    workout: { key: "w1", name: "Tempo", sport: "run", steps }
  });
  /* COROS often serves a planned load and no step structure, and a
     hand-built session the reverse — so the fallback is per figure. */
  const declared = entry({
    weekIndex: 1,
    title: "Easy",
    plannedDurationSeconds: 2700,
    plannedTrainingLoad: 45,
    workout: { key: "w2", name: "Easy", sport: "run" }
  });

  const document = plan({ entries: [structured, declared] });
  const reading = readPlan(document);
  const facts = reading.weeks[0].days[0].entries[0];

  assert.equal(facts.durationSeconds, 2400, "the steps' own duration");
  assert.equal(facts.trainingLoad, 90);
  assert.equal(facts.distanceMeters, 6000);
  assert.equal(facts.stepCount, 2);
  assert.equal(facts.sport, "run");

  const fallback = reading.weeks[1].days[0].entries[0];
  assert.equal(fallback.durationSeconds, 2700, "no steps, so the declared duration stands");
  assert.equal(fallback.trainingLoad, 45);
  assert.equal(fallback.stepCount, 0);

  // The row's figure is the sum of the reader's, because both read one function.
  const summary = summarizeTrainingPlan(document);
  const readerLoad = reading.weeks
    .flatMap((week) => week.days.flatMap((day) => day.entries))
    .reduce((total, item) => total + item.trainingLoad, 0);
  assert.equal(
    Math.round(summary.trainingLoad),
    Math.round(readerLoad),
    "the plan row's load and the sessions inside it have to add up, or the " +
      "screen contradicts the row that opened it"
  );
}

// ---------------------------------------------------------------------------
// 2b. A session always has a title
// ---------------------------------------------------------------------------
{
  assert.equal(
    readPlan(plan({ weekCount: 1, entries: [entry({ title: "", workout: { key: "w", name: "Steady" } })] }))
      .weeks[0].days[0].entries[0].title,
    "Steady",
    "an untitled session falls back to its workout"
  );
  assert.equal(
    readPlan(plan({ weekCount: 1, entries: [entry({ title: " ", workout: { key: "w", name: "  " } })] }))
      .weeks[0].days[0].entries[0].title,
    "Untitled session",
    "a blank name is not a title"
  );
}

// ---------------------------------------------------------------------------
// 3. Only a plan on the calendar reports an outcome, keyed as COROS keys it
// ---------------------------------------------------------------------------
{
  const kept = entry({ title: "Kept", idInPlan: "1", happenDay: "20260302" });
  const other = entry({ title: "Other", dayIndex: 1, idInPlan: "2", happenDay: "20260303" });
  const matches = [
    match("1", "completed"),
    // Another plan's session 2: every plan numbers its sessions from 1.
    match("2", "missed", { schedulePlanId: "another-plan" })
  ];
  const reading = readPlan(running({ weekCount: 1, entries: [kept, other] }), matches);

  assert.equal(reading.weeks[0].days[0].entries[0].status, "completed");
  assert.equal(reading.weeks[0].days[0].entries[0].scheduledDate, "20260302", "the day COROS put it on");
  assert.equal(
    reading.weeks[0].days[1].entries[0].status,
    undefined,
    "another plan's session with the same idInPlan is not this one's"
  );
  assert.equal(reading.tracked, true);

  const template = readPlan(plan({ weekCount: 1, entries: [kept] }), matches);
  assert.equal(
    template.weeks[0].days[0].entries[0].status,
    undefined,
    "a plan not on the calendar reports nothing, even where a match names its id"
  );
  assert.equal(template.weeks[0].days[0].entries[0].scheduledDate, undefined);
  assert.equal(template.tracked, false);

  const finished = readPlan(running({ calendar: "finished", weekCount: 1, entries: [kept] }), matches);
  assert.equal(finished.weeks[0].days[0].entries[0].status, "completed", "a finished run still says how it went");
}

// ---------------------------------------------------------------------------
// 4. No status is not "upcoming"
// ---------------------------------------------------------------------------
{
  const reading = readPlan(plan({ weekCount: 1, entries: [entry({ title: "Not on the calendar", idInPlan: "1" })] }));
  const facts = reading.weeks[0].days[0].entries[0];

  assert.equal(facts.status, undefined);
  assert.equal(facts.scheduledDate, undefined);
  assert.equal(reading.tracked, false);
  assert.equal(statusLabel(undefined), null, "nothing to say, so no badge is drawn");
  assert.equal(statusTone(undefined), null);

  assert.equal(statusLabel("completed"), "Done");
  assert.equal(statusTone("completed"), "done");
  assert.equal(statusTone("partial"), "done", "trained, if not as written");
  assert.equal(statusTone("missed"), "missed");
  assert.equal(
    statusTone("upcoming"),
    "quiet",
    "a session that has not happened is not a success; drawing it like a kept " +
      "one makes a plan look complete before it has started"
  );
  assert.equal(statusTone("skipped"), "quiet");
  assert.equal(statusTone("rescheduled"), "quiet");
  assert.equal(statusLabel("rescheduled"), "Moved");

  /*
   * On the calendar, and the matcher has not run yet — the state every plan
   * is in between being scheduled and the next snapshot. The honest answer is
   * still nothing: "Ahead" would be this screen inventing a status.
   */
  const awaiting = readPlan(running({ weekCount: 1, entries: [entry({ title: "Just scheduled", idInPlan: "9", happenDay: "20260302" })] }), []);
  assert.equal(awaiting.weeks[0].days[0].entries[0].status, undefined, "no match yet, no status");
  assert.equal(awaiting.weeks[0].days[0].entries[0].scheduledDate, "20260302", "though the day is known");
  assert.equal(awaiting.tracked, false, "`tracked` follows the matcher, not the calendar");
}

// ---------------------------------------------------------------------------
// 5. Only a plan on the calendar has dates
// ---------------------------------------------------------------------------
{
  const unscheduled = readPlan(plan({ weekCount: 2, entries: [] }));
  assert.deepEqual(
    unscheduled.weeks[0].days.map((day) => day.label),
    ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    "a plan not on the calendar has nothing to say but the day of the week"
  );
  assert.equal(unscheduled.weeks[0].days[0].date, undefined);

  // 2026-03-02 is a Monday.
  const dated = readPlan(running({ weekCount: 2, entries: [] }));
  assert.equal(dated.weeks[0].days[0].date, "2026-03-02");
  assert.equal(dated.weeks[0].days[6].date, "2026-03-08");
  assert.equal(dated.weeks[1].days[0].date, "2026-03-09", "week two starts seven days on");
  assert.ok(dated.weeks[0].days[0].label.startsWith("Mon "), `a dated day carries its date: ${dated.weeks[0].days[0].label}`);

  assert.equal(
    readPlan(running({ weekCount: 1, startDate: "not-a-date" })).weeks[0].days[0].date,
    undefined,
    "a start date that is not a date dates nothing"
  );
}

// ---------------------------------------------------------------------------
// 6. A week's stage is COROS's own
// ---------------------------------------------------------------------------
{
  const staged = plan({
    weekCount: 4,
    weekStages: [
      { weekIndex: 0, stage: 2 },
      { weekIndex: 1, stage: 2 },
      { weekIndex: 3, stage: 5 }
    ]
  });
  assert.deepEqual(stageForWeek(staged, 0), { label: "Base", slug: "base" });
  assert.equal(stageForWeek(staged, 2), undefined, "a week with no stage set is Not Set, and says nothing");
  assert.deepEqual(
    readPlan(staged).weeks.map((week) => week.stage ?? null),
    ["Base", "Base", null, "Race"]
  );
  assert.deepEqual(
    readPlan(staged).weeks.map((week) => week.stageSlug ?? null),
    ["base", "base", null, "race"],
    "the slug is what the stylesheet colours a stage by"
  );
}

// ---------------------------------------------------------------------------
// 7. Duration reads as a person would say it
// ---------------------------------------------------------------------------
{
  assert.equal(formatPlannedDuration(0), null, "nothing planned, nothing drawn");
  assert.equal(formatPlannedDuration(2880), "48m");
  assert.equal(formatPlannedDuration(4320), "1:12");
  assert.equal(formatPlannedDuration(3600), "1:00", "not `1:0`");
  assert.equal(formatPlannedDuration(3540), "59m");
}

// ---------------------------------------------------------------------------
// 8. A duration is only stated when it is the whole session
// ---------------------------------------------------------------------------
{
  const strides = entry({
    workout: {
      key: "strides",
      name: "Easy + strides",
      sport: "run",
      steps: [
        { kind: "warmup", target_type: "distance", target_distance_meters: 7000 },
        {
          repeat: 5,
          steps: [
            { kind: "training", target_type: "distance", target_distance_meters: 100 },
            { kind: "rest", target_type: "time", target_duration_seconds: 90 }
          ]
        }
      ]
    }
  });
  const intervals = entry({
    dayIndex: 2,
    workout: {
      key: "intervals",
      name: "Intervals",
      sport: "run",
      steps: [
        { kind: "warmup", target_type: "time", target_duration_seconds: 600 },
        {
          repeat: 4,
          steps: [
            { kind: "training", target_type: "time", target_duration_seconds: 240 },
            { kind: "rest", target_type: "time", target_duration_seconds: 120 }
          ]
        }
      ]
    }
  });
  const planned = entry({
    weekIndex: 1,
    plannedDurationSeconds: 3600,
    workout: { key: "long", name: "Long", sport: "run" }
  });

  const reading = readPlan(plan({ entries: [strides, intervals, planned] }));
  const [first, second] = reading.weeks[0].days.flatMap((day) => day.entries);
  assert.equal(first.durationSeconds, 450, "the timed jogs still sum as before");
  assert.equal(
    first.durationComplete,
    false,
    "but a session with a distance-only step does not know how long it is"
  );
  assert.equal(second.durationComplete, true, "every step timed, repeats included");
  assert.equal(
    reading.weeks[1].days[0].entries[0].durationComplete,
    true,
    "a session with no steps is timed by its planned duration"
  );
  assert.equal(reading.weeks[0].timed, false, "one untimed session makes the week's hours unknown");
  assert.equal(reading.weeks[1].timed, true);
  assert.equal(reading.timed, false, "and so the plan's");

  assert.equal(first.stepCount, 3, "warm-up, stride, jog: a repeat's children once, the group not at all");
  assert.equal(second.stepCount, 3);

  const empty = readPlan(plan());
  assert.equal(empty.timed, false, "a plan with nothing in it has no hours to state");
}

// ---------------------------------------------------------------------------
// 9. Sessions in reading order, and what the matched activity did
// ---------------------------------------------------------------------------
{
  const late = entry({ weekIndex: 0, dayIndex: 5, title: "Sat", idInPlan: "1" });
  const early = entry({ weekIndex: 0, dayIndex: 1, title: "Tue", idInPlan: "2", happenDay: "20260303" });
  const next = entry({ weekIndex: 1, dayIndex: 0, title: "Next Mon", idInPlan: "3" });

  const scheduled = running({
    stage: undefined,
    weekStages: [{ weekIndex: 1, stage: 3 }],
    entries: [late, next, early]
  });
  const reading = readPlan(scheduled, [
    match("2", "completed", {
      activityId: "act-1",
      happenDay: "20260303",
      completedDurationSeconds: 2700,
      completedDistanceMeters: 8100,
      completedTrainingLoad: 0
    })
  ]);
  const sessions = planSessions(reading);
  assert.deepEqual(sessions.map((session) => session.entry.title), ["Tue", "Sat", "Next Mon"], "day order within a week");
  assert.deepEqual(sessions.map((session) => session.weekIndex), [0, 0, 1]);
  assert.equal(sessions[2].stage, "Build", "a session carries its week's stage");
  assert.ok(sessions[0].dayLabel.startsWith("Tue "), "a dated plan names the date");

  assert.deepEqual(
    sessions[0].entry.outcome,
    { activityId: "act-1", happenDay: "20260303", durationSeconds: 2700, distanceMeters: 8100 },
    "the recorded figures, and not a zero load the matcher had nothing for"
  );
  assert.equal(sessions[1].entry.outcome, undefined, "no match, no outcome");

  const unmatched = readPlan(scheduled, [match("2", "missed")]);
  assert.equal(planSessions(unmatched)[0].entry.outcome, undefined, "a missed session has no activity to report");
}

// ---------------------------------------------------------------------------
// The ridge measures what every week of training states, split by sport
// ---------------------------------------------------------------------------
{
  const timed = (id, weekIndex, sport, seconds, load) => ({
    id,
    weekIndex,
    dayIndex: 0,
    sortOrder: 0,
    title: id,
    workout: {
      key: id,
      name: id,
      sport,
      save_to_library: false,
      steps: [{ kind: "training", target_type: "time", target_duration_seconds: seconds, intensity: { type: "none" }, ...(load ? { target_load: load } : {}) }]
    }
  });
  const ridgePlan = (entries, weekCount = 3) => plan({ id: "ridge", name: "Ridge", sportMix: [], weekCount, entries });

  // Week 1 priced, week 2 not: load would draw one bar over two weeks of training.
  const mixed = readPlan(ridgePlan([timed("a", 0, "run", 3600, 80), timed("b", 1, "run", 1800)]));
  assert.equal(
    ridgeMeasure(mixed.weeks),
    "hours",
    "a week of sessions COROS priced at nothing must not draw as an empty bar under Weekly load"
  );

  const priced = readPlan(ridgePlan([timed("a", 0, "run", 3600, 80), timed("b", 1, "bike", 1800, 40)]));
  assert.equal(ridgeMeasure(priced.weeks), "load", "load where every week of training has some; the empty week does not count");

  const untimed = readPlan(
    ridgePlan([
      timed("a", 0, "run", 3600),
      { id: "c", weekIndex: 1, dayIndex: 0, sortOrder: 0, title: "c", workout: { key: "c", name: "c", sport: "swim", save_to_library: false, distance_km: 1.5 } }
    ])
  );
  assert.equal(ridgeMeasure(untimed.weeks), "sessions", "neither load nor time in every week: count the sessions");
  assert.equal(ridgeMeasure(readPlan(ridgePlan([])).weeks), "sessions");

  const split = readPlan(
    ridgePlan([timed("s", 0, "strength", 1800), timed("r1", 0, "run", 3600), timed("r2", 0, "run", 1800)], 1)
  );
  assert.deepEqual(
    weekRidgeSegments(split.weeks[0], "hours"),
    [
      { sport: "run", value: 1.5 },
      { sport: "strength", value: 0.5 }
    ],
    "a bar is split by sport, in the fixed sport order rather than the order sessions were written"
  );
  assert.deepEqual(
    weekRidgeSegments(split.weeks[0], "sessions").map((segment) => segment.value),
    [2, 1]
  );
}

console.log(
  "plan reader OK — empty weeks kept, figures shared with the row, outcomes only " +
    "on the calendar and keyed as COROS keys them, no status is not `upcoming`, " +
    "dates only on the calendar, stages by label, durations only when whole, " +
    "sessions in reading order, the ridge measures what every week states"
);
