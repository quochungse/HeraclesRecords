// The AI plan generator's rules (electron/trainingPlanGeneration.ts) and the
// one place they bite during a run: the draft tool, which refuses a draft that
// breaks the request and hands the reasons back to the model.
//
// What this holds down, each once wrong:
//
// - **A generated plan starts on a Monday and counts Monday-to-Sunday weeks**,
//   as COROS, `week_stages` and the plan editor do. A mid-week start was
//   counted in seven-day blocks from that day.
// - **A draft that departs from the request is refused inside the turn**, so
//   the model fixes it. The checks used to run after the turn ended, and one
//   week one session short threw the whole plan away.
// - **A generation's drafts are never written to `chat_plan_drafts`.** That
//   table is `personal` tier and a draft there lives as long as its card; a
//   generation has no card, so every draft it wrote stayed and synced for good.
//   No database is opened here, so a draft that tried to persist would throw.
// - **The plan's overview is the coach's description**, not the card summary,
//   the warnings or the athlete's constraints, and the coach's week stages
//   come with it.
// - **The athlete's week is a band, not a count.** Flex days ("Coach picks")
//   may hold a session or not; a day's minutes bound what it holds; a week
//   left to Coach keeps only what the athlete was sure of. Race day is exempt
//   from the pattern — the race goes on the day it is — and a race plan ends
//   there. A length left to Coach is read off the last session, 4 to 24 weeks.
// - **The outline is its own turn, with its own tool, and binds the sessions.**
//   `propose_plan_outline` is offered to that turn alone, refuses an outline
//   that breaks the request, and the writing tools are withheld from it; the
//   sessions turn is then held to the outline's length, counts, hours and
//   stages.
// - **What the athlete did not share is withheld twice**: from every tool
//   that reads it — local, or COROS's own by what its name says — and from
//   the snapshot the turn starts from. "From my data" needs the activities.
// - **The run is read-only.** It went through `chat:send`, which offers every
//   write tool, with a line in the prompt as the only guard.
//
// Run: npm run test:training-plan-generation
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distUrl = (file) =>
  `${pathToFileURL(path.join(repoRoot, "dist-electron", file)).href}?cacheBust=${Date.now()}`;

const generation = await import(distUrl("trainingPlanGeneration.js"));
const chatWorkoutTools = await import(distUrl("chatWorkoutTools.js"));

let passed = 0;
async function test(name, run) {
  try {
    await run();
    passed += 1;
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  }
}

/* Thursday 30 July 2026, so the earliest first week is Monday 3 August. */
const THURSDAY = new Date(2026, 6, 30, 9);

/* A plan day as the draft tool takes it (yyyyMMdd): some weeks and days from a Monday. */
const dayOf = (monday, weeks, offset) => {
  const date = new Date(`${generation.addPlanWeeks(monday, weeks)}T12:00:00`);
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
};
const days = (...spec) => ({ mode: "days", days: spec.map(([kind, minutes]) => (kind === "rest" ? { kind } : { kind, minutes })) });
const REST = ["rest"];
/* Monday and Thursday, an hour each. */
const request = {
  goalKind: "other",
  goal: "Run a strong 10K",
  sports: ["run", "strength"],
  difficulty: "intermediate",
  weeks: 2,
  startDate: "2026-08-03",
  week: days(["train", 60], REST, REST, ["train", 60], REST, REST, REST)
};

const timed = (minutes) => [{ kind: "training", target_type: "time", target_duration_seconds: minutes * 60, intensity: { type: "none" } }];
const session = (key, date, sport = "run", minutes = 40) => ({
  key,
  name: key,
  sport,
  schedule_date: date,
  save_to_library: false,
  steps: timed(minutes)
});
const fitting = [
  session("w1-mon", "20260803"),
  session("w1-thu", "20260806", "run", 50),
  session("w2-mon", "20260810"),
  session("w2-thu", "20260813", "run", 30)
];

await test("the first week is a Monday: today when it is one, else the next", () => {
  assert.equal(generation.firstPlanMonday(THURSDAY), "2026-08-03");
  assert.equal(generation.firstPlanMonday(new Date(2026, 7, 3, 23)), "2026-08-03", "a Monday is its own first week");
  assert.equal(generation.firstPlanMonday(new Date(2026, 7, 2, 8)), "2026-08-03", "a Sunday's is the next day");
  assert.equal(generation.addPlanWeeks("2026-08-03", 5), "2026-09-07");
  assert.deepEqual(generation.generatedPlanSpan(request), { first: "2026-08-03", last: "2026-08-16", weeks: 2 });
});

await test("a race plan ends on race day, and race day decides its length", () => {
  const race = { ...request, goalKind: "race", weeks: undefined, race: { date: "2026-09-26", distance: "Half" } };
  assert.equal(generation.requestedPlanWeeks(race), 8, "a Saturday in week 8");
  assert.deepEqual(generation.generatedPlanSpan(race), { first: "2026-08-03", last: "2026-09-26", weeks: 8 });
  assert.equal(generation.requestedPlanWeeks({ ...race, weeks: 3 }), 8, "a count sent with a race is not what decides");
});

await test("a length left to Coach has a first day and no last", () => {
  const open = { ...request, weeks: undefined };
  assert.equal(generation.requestedPlanWeeks(open), undefined);
  assert.deepEqual(generation.generatedPlanSpan(open), { first: "2026-08-03" });
  assert.deepEqual(generation.generationRequestProblems(open, THURSDAY), []);
});

await test("a usual week is a band of sessions: training days fixed, flex days optional", () => {
  const week = days(["train", 45], ["flex", 30], REST, ["train", 45], ["flex", 30], ["long", 150], REST).days;
  assert.deepEqual(generation.weekSessionBand(week), { min: 3, max: 5 });
  assert.deepEqual(generation.weekSessionBand(week, 2), { min: 1, max: 2 }, "a race week counts to race day");
  assert.deepEqual(generation.weekMinutesBand(week), { min: 240, max: 300 });
});

await test("a request the form would send has no problems", () => {
  assert.deepEqual(generation.generationRequestProblems(request, THURSDAY), []);
  const coach = { ...request, week: { mode: "coach", blockedDayIndexes: [] } };
  assert.deepEqual(generation.generationRequestProblems(coach, THURSDAY), [], "a week left wholly to Coach asks nothing");
  const base = { ...request, goalKind: "base", goal: "" };
  assert.deepEqual(generation.generationRequestProblems(base, THURSDAY), [], "a named kind needs no words of its own");
});

await test("each problem names the field it belongs to, in the form's order", () => {
  const fields = (patch, today = THURSDAY) =>
    generation.generationRequestProblems({ ...request, ...patch }, today).map((problem) => problem.field);
  const coach = (patch) => ({ week: { mode: "coach", blockedDayIndexes: [], ...patch } });
  assert.deepEqual(fields({ goal: "  " }), ["goal"], "a goal of one's own needs describing");
  assert.deepEqual(fields({ goalKind: "kayak" }), ["goal"]);
  assert.deepEqual(fields({ goal: "x".repeat(401) }), ["goal"]);
  assert.deepEqual(fields({ goalKind: "race", goal: "" }), ["race"], "a race needs its day");
  assert.deepEqual(fields({ goalKind: "race", goal: "", race: { date: "2026-09-26" } }), ["race"], "and a name or distance");
  assert.deepEqual(fields({ goalKind: "race", race: { date: "2026-08-07" } }), ["race"], "in week 1 is too soon");
  assert.deepEqual(fields({ goalKind: "race", race: { date: "2027-02-01" } }), ["race"], "past 24 weeks is too far");
  assert.deepEqual(fields({ goalKind: "race", weeks: 99, race: { date: "2026-09-26" } }), [], "a race's count is not read");
  assert.deepEqual(fields({ sports: [] }), ["sports"]);
  assert.deepEqual(fields({ sports: ["run", "kayak"] }), ["sports"]);
  assert.deepEqual(fields({ weeks: 25 }), ["weeks"]);
  assert.deepEqual(fields({ weeks: 1.5 }), ["weeks"]);
  assert.deepEqual(fields({ week: days(REST, REST, REST, REST, REST, REST, REST) }), ["days"]);
  assert.deepEqual(fields({ week: days(["train", 60], REST) }), ["days"], "seven days or none");
  assert.deepEqual(fields({ week: days(["train", 5], REST, REST, REST, REST, REST, REST) }), ["days"]);
  assert.deepEqual(fields({ week: days(["flex", 12.5], REST, REST, REST, REST, REST, REST) }), ["days"]);
  assert.deepEqual(fields(coach({ blockedDayIndexes: [0, 1, 2, 3, 4, 5, 6] })), ["days"]);
  assert.deepEqual(fields(coach({ blockedDayIndexes: [0, 0] })), ["days"]);
  assert.deepEqual(fields(coach({ sessionsPerWeek: 0 })), ["week"]);
  assert.deepEqual(fields(coach({ sessionsPerWeek: 6, blockedDayIndexes: [0, 1] })), ["week"], "more sessions than days");
  assert.deepEqual(fields(coach({ hours: { min: 8, max: 5 } })), ["week"]);
  assert.deepEqual(fields(coach({ hours: { min: 12 } })), [], "an open top is \"or more\"");
  assert.deepEqual(fields({ week: undefined }), ["days"]);
  assert.deepEqual(fields({ constraints: "x".repeat(601) }), ["constraints"]);
  assert.deepEqual(fields({ goal: "", sports: [], week: days(REST) }), ["goal", "sports", "days"]);
  assert.deepEqual(fields({ runtime: { provider: "claude-api", effort: "max", model: "claude-sonnet-5" } }), []);
  assert.deepEqual(fields({ runtime: { provider: "gemini" } }), ["runtime"]);
  assert.deepEqual(fields({ runtime: { effort: "extreme" } }), ["runtime"]);
});

await test("the start is a Monday, not in a week already begun, and within a year", () => {
  const start = (startDate, today) =>
    generation.generationRequestProblems({ ...request, startDate }, today).map((problem) => problem.message);
  assert.match(start("2026-08-05", THURSDAY)[0], /starts on a Monday/);
  assert.match(start("2026-07-27", THURSDAY)[0], /already begun/, "this week's Monday is past on a Thursday");
  assert.match(start("2027-08-09", THURSDAY)[0], /within a year/);
  assert.deepEqual(start("2026-07-27"), [], "read back without a today, a request does not expire");
  assert.match(start("not-a-date")[0], /Pick the week/);
});

await test("a draft that fits the request has nothing wrong with it", () => {
  assert.deepEqual(generation.generatedPlanProblems(fitting, request), []);
});

await test("every way a draft departs from the request is named, for the model to fix", () => {
  const problems = generation.generatedPlanProblems(
    [
      session("early", "20260802"),
      session("tuesday", "20260804"),
      session("swim", "20260806", "swim"),
      session("long", "20260810", "run", 75),
      { ...session("undated", "20260813"), schedule_date: undefined }
    ],
    request
  );
  assert.deepEqual(problems, [
    '"early" is dated 2026-08-02, outside the plan (2026-08-03 to 2026-08-16).',
    '"tuesday" is on a Tuesday, which is a rest day.',
    '"swim" is Pool Swim, which was not asked for.',
    '"undated" has no schedule_date; every session needs one inside the plan\'s weeks.',
    "Monday 2026-08-10 holds 75 minutes; the athlete has 60 that day.",
    "Week 2 (from 2026-08-10) has 1 session; it needs exactly 2."
  ]);
});

await test("a day's sessions together fit the time that day has", () => {
  const twoOnMonday = [session("a", "20260803", "run", 40), session("b", "20260803", "strength", 30), ...fitting.slice(2)];
  assert.deepEqual(generation.generatedPlanProblems(twoOnMonday, request), [
    "Monday 2026-08-03 holds 70 minutes; the athlete has 60 that day."
  ]);
});

await test("a Free day has no limit: it is a valid request, the week has no most, and nothing is held to one", () => {
  const free = { ...request, week: days(["train"], REST, REST, ["train", 60], REST, REST, REST) };
  assert.deepEqual(generation.generationRequestProblems(free, THURSDAY), [], "a training day may come without minutes");
  assert.deepEqual(generation.weekMinutesBand(free.week.days), { min: 60, max: Number.POSITIVE_INFINITY });
  const long = [session("a", "20260803", "run", 180), ...fitting.slice(1)];
  assert.deepEqual(generation.generatedPlanProblems(long, free), [], "three hours on a Free day breaks nothing");
  const prompt = generation.trainingPlanGenerationPrompt(free);
  assert.match(prompt, /Monday: a session, no time limit\./);
  assert.match(prompt, /the most I have that day, not a time to fill/, "a day's time is stated as a ceiling");
  const outline = {
    summary: "s", basis: "b",
    weeks: [0, 1].map(() => ({ stage: 2, lighter: false, hours: 9, sessions: 2, focus: "", keySessions: [] }))
  };
  assert.deepEqual(generation.planOutlineProblems(outline, free), [], "and the outline is held to no weekly ceiling");
  const zero = { ...free, week: { mode: "days", days: free.week.days.map((day, index) => (index === 0 ? { kind: "train", minutes: 0 } : day)) } };
  assert.match(generation.generationRequestProblems(zero, THURSDAY).map((problem) => problem.message).join(" "), /whole number of minutes/, "a stated time is still checked");
});

await test("a session given as a distance is not held to the time it cannot state", () => {
  const distance = {
    ...session("long", "20260813"),
    steps: [{ kind: "training", target_type: "distance", target_distance_meters: 21_000, intensity: { type: "none" } }]
  };
  assert.deepEqual(generation.generatedPlanProblems([...fitting.slice(0, 3), distance], request), []);
});

await test("flex days widen a week's count into a band", () => {
  const flexRequest = { ...request, week: days(["train", 60], REST, ["flex", 45], ["train", 60], REST, REST, REST) };
  assert.deepEqual(generation.generatedPlanProblems(fitting, flexRequest), [], "a flex day left free is fine");
  const withFlex = [...fitting, session("w2-wed", "20260812", "run", 30)];
  assert.deepEqual(generation.generatedPlanProblems(withFlex, flexRequest), [], "and so is one used");
  assert.deepEqual(generation.generatedPlanProblems(fitting.slice(1), flexRequest), [
    "Week 1 (from 2026-08-03) has 1 session; it needs 2 to 3."
  ]);
});

await test("a race plan ends on race day, which holds the race whatever the day usually is", () => {
  /* Race on Wednesday 12 August, a rest day in the usual week: week 2 runs to it. */
  const race = { ...request, goalKind: "race", weeks: undefined, race: { date: "2026-08-12", distance: "10K" } };
  const plan = [...fitting.slice(0, 3), session("Race", "20260812", "run", 50)];
  assert.deepEqual(generation.generatedPlanProblems(plan, race), [], "race day is exempt from the rest day and its minutes");
  assert.deepEqual(generation.generatedPlanProblems([...plan, session("after", "20260813")], race), [
    '"after" is dated 2026-08-13, after race day (2026-08-12); the plan ends on race day.'
  ]);
  assert.deepEqual(generation.generatedPlanProblems([...fitting.slice(0, 2), session("Race", "20260812")], race), [], "the race week may hold only the race");
});

await test("a week left to Coach holds the count asked for, off the blocked days, under the hours", () => {
  const coach = { ...request, week: { mode: "coach", sessionsPerWeek: 2, hours: { min: 1, max: 2 }, blockedDayIndexes: [1] } };
  assert.deepEqual(generation.generatedPlanProblems(fitting, coach), []);
  assert.deepEqual(
    generation.generatedPlanProblems([session("tuesday", "20260804"), session("big", "20260806", "run", 100), ...fitting.slice(2)], coach),
    [
      '"tuesday" is on a Tuesday, a day the athlete can\'t train.',
      "Week 1 (from 2026-08-03) comes to 2.3 h; the athlete has at most 2 h a week."
    ]
  );
  const open = { ...coach, week: { mode: "coach", blockedDayIndexes: [] } };
  assert.deepEqual(generation.generatedPlanProblems(fitting.slice(0, 2), open), [
    "Week 2 (from 2026-08-10) has no sessions; every week of the plan needs at least one."
  ]);
});

await test("a length left to Coach is 4 to 24 weeks, counted from the last session", () => {
  const open = { ...request, weeks: undefined };
  assert.deepEqual(generation.generatedPlanProblems(fitting, open), [
    "The plan runs 2 weeks; when you choose the length, make it 4 to 24 weeks."
  ]);
  const four = [0, 1, 2, 3].flatMap((week) => [
    session(`w${week}-mon`, dayOf("2026-08-03", week, 0)),
    session(`w${week}-thu`, dayOf("2026-08-03", week, 3))
  ]);
  assert.deepEqual(generation.generatedPlanProblems(four, open), []);
  const preview = {
    draftId: "d4", name: "Four", summary: "", conflicts: [], warnings: [],
    entries: four.map((source) => ({ key: source.key, name: source.name, sport: "run", saveToLibrary: false, workoutType: "run", source }))
  };
  assert.equal(generation.trainingPlanFromDraftPreview(preview, open).weekCount, 4, "the plan is as long as Coach made it");
});

await test("the plan takes the coach's overview and stages, and nothing else", () => {
  const preview = {
    draftId: "d1",
    name: " 10K build ",
    summary: "4 workouts · 4 scheduled · 4 Run",
    conflicts: [],
    warnings: ["Review loads."],
    entries: fitting.map((source) => ({ key: source.key, name: source.name, sport: "run", saveToLibrary: false, workoutType: "run", source }))
  };
  const plan = generation.trainingPlanFromDraftPreview(
    preview,
    { ...request, constraints: "Left knee" },
    {
      description: "Two weeks sharpening toward a 10K.",
      weekStages: [{ weekIndex: 0, stage: 2 }, { weekIndex: 1, stage: 4 }, { weekIndex: 2, stage: 5 }, { weekIndex: 1, stage: 0 }]
    }
  );
  assert.equal(plan.name, "10K build");
  assert.equal(plan.description, "Two weeks sharpening toward a 10K.");
  assert.deepEqual(plan.weekStages, [{ weekIndex: 0, stage: 2 }, { weekIndex: 1, stage: 4 }], "a stage past the plan, or Not Set, is dropped");
  assert.equal(plan.weekCount, 2);
  assert.equal(plan.origin, "coach");
  assert.equal(plan.coach, undefined);
  assert.deepEqual(plan.entries.map((entry) => [entry.weekIndex, entry.dayIndex]), [[0, 0], [0, 3], [1, 0], [1, 3]]);
  assert.equal(plan.entries.every((entry) => entry.workout.save_to_library === false), true);
});

await test("the prompt states the request as the rules the tool checks", () => {
  const prompt = generation.trainingPlanGenerationPrompt({ ...request, constraints: "Left knee" });
  for (const phrase of [
    "Goal, in my words: Run a strong 10K",
    "Sports (use only these): Run, Strength",
    "Constraints: Left knee",
    "Exactly 2 weeks, Monday to Sunday. Week 1 starts on Monday 2026-08-03; the last week ends on Sunday 2026-08-16.",
    "- Monday: a session, up to 60 min.",
    "- Tuesday: rest — no session.",
    "every week holds exactly 2 sessions",
    "week_stages",
    "get_training_zones",
    "Do not ask me anything",
    "If it is refused, fix every problem"
  ]) {
    assert.ok(prompt.includes(phrase), `the prompt says: ${phrase}`);
  }
  const race = generation.trainingPlanGenerationPrompt({ ...request, goalKind: "race", goal: "Hanoi half", weeks: undefined, race: { date: "2026-09-26", distance: "Half" } });
  assert.match(race, /Goal: a race: Half — Hanoi half\./);
  assert.match(race, /ends on race day, Saturday 2026-09-26\. No session after it\./);
  assert.match(race, /put the race itself on race day/);
  const coach = generation.trainingPlanGenerationPrompt({
    ...request,
    goalKind: "base",
    goal: "",
    weeks: undefined,
    week: { mode: "coach", blockedDayIndexes: [2], hours: { min: 5, max: 8 } }
  });
  assert.match(coach, /Goal: Build an aerobic base/);
  assert.match(coach, /Choose the length yourself: 4 to 24 whole weeks from Monday 2026-08-03/);
  assert.match(coach, /yours to decide/);
  assert.match(coach, /Never on: Wednesday\./);
  assert.match(coach, /about 5–8 hours a week; no week over 8 hours/);
  assert.match(coach, /Choose how many sessions a week/);
  assert.doesNotMatch(coach, /In my words/, "an empty detail says nothing");
});

await test("Continue in Coach hands over a question, not the tool contract", () => {
  const handoff = generation.trainingPlanCoachHandoff({ ...request, constraints: "Left knee" });
  assert.match(handoff, /^Help me build a training plan\./);
  assert.match(handoff, /2 weeks from Monday 2026-08-03\./);
  assert.match(handoff, /My week: Monday up to 60 min; Thursday up to 60 min\./);
  assert.match(handoff, /Constraints: Left knee/);
  assert.doesNotMatch(handoff, /draft_training_plan|Do not ask/);
  const coach = generation.trainingPlanCoachHandoff({ ...request, weeks: undefined, week: { mode: "coach", sessionsPerWeek: 4, blockedDayIndexes: [] } });
  assert.match(coach, /you choose how long/);
  assert.match(coach, /You decide my week \(4 sessions a week\)\./);
});

// --- The outline ----------------------------------------------------------

const outlineArgs = (patch = {}) => ({
  summary: "Two weeks: settle in, then sharpen.",
  basis: "About 30 km a week lately, long run 14 km.",
  weeks: [
    { week: 1, stage: "base", lighter: false, hours: 1.5, sessions: 2, focus: "Settle into the routine.", key_sessions: [{ day: "Monday", name: "Easy run", sport: "run", minutes: 40 }] },
    { week: 2, stage: "build", hours: 1.3, sessions: 2, focus: "One quality session.", key_sessions: [{ day: "Thursday", name: "Tempo", sport: "run", minutes: 45 }] }
  ],
  ...patch
});

await test("the outline tool's arguments become an outline, or the reasons they are not one", () => {
  const { outline, errors } = generation.parsePlanOutline(outlineArgs());
  assert.deepEqual(errors, []);
  assert.equal(outline.basis, "About 30 km a week lately, long run 14 km.");
  assert.deepEqual(outline.weeks[0], {
    stage: 2, lighter: false, hours: 1.5, sessions: 2, focus: "Settle into the routine.",
    keySessions: [{ dayIndex: 0, name: "Easy run", sport: "run", minutes: 40 }]
  });
  const broken = generation.parsePlanOutline({
    summary: "x",
    weeks: [{ week: 3, stage: "taper", hours: 2, sessions: 2, focus: "", key_sessions: [{ name: "No day", sport: "run" }] }]
  });
  assert.equal(broken.outline, undefined);
  assert.deepEqual(broken.errors, [
    "basis is missing: say what you read of the athlete's training.",
    "Week 1 is numbered 3; number the weeks 1, 2, 3… in order.",
    "Week 1 has no stage; use one of preparation, base, build, peak, race, transition.",
    "Week 1 has a key session without a day, a name or a sport."
  ]);
});

await test("an outline is held to the request: its length, each week's count and time, each key session", () => {
  const outline = (patch) => generation.parsePlanOutline(outlineArgs(patch)).outline;
  assert.deepEqual(generation.planOutlineProblems(outline(), request), []);
  const busy = outline({
    weeks: [
      { week: 1, stage: "base", hours: 3, sessions: 3, focus: "Too much.", key_sessions: [
        { day: "Tuesday", name: "Intervals", sport: "run", minutes: 40 },
        { day: "Monday", name: "Swim", sport: "swim", minutes: 30 },
        { day: "Thursday", name: "Long run", sport: "run", minutes: 90 }
      ] },
      { week: 2, stage: "build", hours: 1, sessions: 2, focus: "Fine.", key_sessions: [] },
      { week: 3, stage: "peak", hours: 1, sessions: 2, focus: "One too many.", key_sessions: [] }
    ]
  });
  assert.deepEqual(generation.planOutlineProblems(busy, request), [
    "The outline has 3 weeks; the plan runs 2 weeks.",
    "Week 1 has 3 sessions; the athlete's week holds exactly 2.",
    "Week 1 plans 3 h; the athlete has at most 2.1 h a week.",
    "Week 1's \"Intervals\" is on Tuesday, a rest day.",
    "Week 1's \"Swim\" is Pool Swim, which was not asked for.",
    "Week 1's \"Long run\" runs 90 minutes; Thursday has 60."
  ]);
  assert.deepEqual(
    generation.planOutlineProblems(outline(), { ...request, weeks: undefined }),
    ["The outline has 2 weeks; when you choose the length, make it 4 to 24 weeks."],
    "a length left to Coach is still 4 to 24 weeks"
  );
  const race = { ...request, goalKind: "race", weeks: undefined, race: { date: "2026-08-12", distance: "10K" } };
  assert.deepEqual(generation.planOutlineProblems(outline(), race), ["Week 2 is the race week; give it the race stage."]);
});

await test("an outline asks for the shape and no sessions, and a redraw carries what to change", () => {
  const prompt = generation.trainingPlanOutlinePrompt(request);
  assert.match(prompt, /with propose_plan_outline\. Do not write any sessions yet/);
  assert.match(prompt, /- Monday: a session, up to 60 min\./, "the athlete's week is stated as the outline's rules");
  assert.doesNotMatch(prompt, /draft_training_plan/);
  const outline = generation.parsePlanOutline(outlineArgs()).outline;
  const redraw = generation.trainingPlanOutlinePrompt(request, { outline, note: "A lighter week 2, I'm travelling." });
  assert.match(redraw, /You proposed this outline before:/);
  assert.match(redraw, /- Week 1 \(from 2026-08-03\): Base, 1\.5 h, 2 sessions — Settle into the routine\. Key: Monday Easy run \(Run, 40 min\)\./);
  assert.match(redraw, /keep what my request does not touch: A lighter week 2, I'm travelling\./);
});

await test("sessions written to an accepted outline follow it: its length, counts, hours and stages", () => {
  const outline = generation.parsePlanOutline(outlineArgs()).outline;
  const open = { ...request, weeks: undefined, outline };
  assert.equal(generation.requestedPlanWeeks(open), 2, "the outline decides a length left to Coach");
  assert.deepEqual(generation.generatedPlanProblems(fitting, open), []);
  assert.deepEqual(generation.generatedPlanProblems([...fitting.slice(0, 3), session("w2-thu", "20260813", "run", 5)], open), [
    "Week 2 (from 2026-08-10) comes to 0.8 h; the outline gives it 1.3 h."
  ]);
  const three = { ...outline, weeks: [outline.weeks[0], { ...outline.weeks[1], sessions: 1 }] };
  assert.deepEqual(generation.generatedPlanProblems(fitting, { ...open, outline: three }), [
    "Week 2 (from 2026-08-10) has 2 sessions; the outline gives it 1."
  ]);
  const prompt = generation.trainingPlanGenerationPrompt(open);
  assert.match(prompt, /The outline I accepted — write the sessions to it/);
  assert.match(prompt, /What you read of my training when you drew it: About 30 km a week lately/);
  const preview = {
    draftId: "o1", name: "Outlined", summary: "", conflicts: [], warnings: [],
    entries: fitting.map((source) => ({ key: source.key, name: source.name, sport: "run", saveToLibrary: false, workoutType: "run", source }))
  };
  const plan = generation.trainingPlanFromDraftPreview(preview, open, { weekStages: [{ weekIndex: 0, stage: 6 }] });
  assert.deepEqual(plan.weekStages, [{ weekIndex: 0, stage: 2 }, { weekIndex: 1, stage: 3 }], "the accepted outline's stages, not the draft's");
  assert.equal(plan.weekCount, 2);
});

await test("the outline turn offers its tool alone and withholds every writing tool", () => {
  const source = fs.readFileSync(path.join(repoRoot, "electron", "chatService.ts"), "utf8");
  const body = source.slice(source.indexOf("export async function outlineTrainingPlan("));
  const fn = body.slice(0, body.indexOf("\n}\n") + 2);
  assert.match(fn, /toolPolicy: "read-only"/);
  assert.match(fn, /extra: \[PLAN_OUTLINE_TOOL_DEFINITION\]/);
  assert.match(fn, /\.\.\.generationReach\(request, OUTLINE_WITHHELD_TOOLS\)/);
  assert.match(fn, /finally \{\s*runTools\.delete\(requestId\);/, "a run's tools go when it ends, however it ends");
  assert.match(source, /const OUTLINE_WITHHELD_TOOLS = new Set\(\["draft_training_plan", "draft_workout"\]\)/);
  const execute = source.slice(source.indexOf("async function executeChatTool("));
  assert.ok(
    execute.indexOf("runTools.get(requestId)") < execute.indexOf("isToolAllowedUnderPolicy(name, toolPolicy)"),
    "a withheld tool is refused, and a run's own tool answered, before the policy is asked"
  );
  assert.equal((source.match(/toolsForRun\(/g) ?? []).length >= 7, true, "every provider's tool list goes through the run");
});

// --- What Coach may read -------------------------------------------------

await test("a withheld source is behind no tool, local or COROS's own", () => {
  const off = (patch) => ({ activities: true, sleep: true, zones: true, ...patch });
  const withheld = (name, sources) => generation.toolReadsWithheldSource(name, sources);
  assert.equal(withheld("get_sleep_summary", undefined), false, "nothing withheld unless the athlete said so");
  assert.equal(withheld("get_sleep_summary", off({ sleep: false })), true);
  assert.equal(withheld("coros__querySleepData", off({ sleep: false })), true);
  assert.equal(withheld("coros__querySleepHrv", off({ sleep: false })), true);
  assert.equal(withheld("get_fitness_trends", off({ sleep: false })), true, "the trends carry overnight HRV");
  assert.equal(withheld("get_fitness_trends", off({ activities: false })), true, "and the training load");
  assert.equal(withheld("list_recent_activities", off({ sleep: false })), false);
  assert.equal(withheld("get_activity_detail", off({ activities: false })), true);
  assert.equal(withheld("coros__querySportRecords", off({ activities: false })), true);
  assert.equal(withheld("coros__queryRecoveryStatus", off({ activities: false })), true);
  assert.equal(withheld("get_training_zones", off({ zones: false })), true);
  assert.equal(withheld("search_coros_exercises", off({ activities: false, sleep: false, zones: false })), false, "the exercise catalogue is nobody's data");
  assert.equal(withheld("draft_training_plan", off({ activities: false })), false);
});

await test("the prompt names only what was shared, and says what was not", () => {
  const prompt = generation.trainingPlanGenerationPrompt({ ...request, sources: { activities: true, sleep: false, zones: false } });
  assert.match(prompt, /Use my Training Coach context — recent training and personal records — and read/);
  assert.match(prompt, /I have not shared my sleep or HRV with this plan/);
  assert.match(prompt, /I have not shared my COROS thresholds or zones/);
  assert.match(prompt, /Set intensities by effort, since my zones are not shared\./);
  assert.doesNotMatch(prompt, /get_training_zones/);
  const none = generation.trainingPlanOutlinePrompt({ ...request, sources: { activities: false, sleep: false, zones: false } });
  assert.match(none, /Use only what I tell you here: I have not shared my training data with this plan\./);
  assert.match(none, /do not read my activities, fitness, records or predictions/);
  assert.doesNotMatch(generation.trainingPlanGenerationPrompt(request), /not shared/, "everything shared says nothing");
});

await test("Coach cannot judge a level from training it was not shown", () => {
  const fields = (patch) => generation.generationRequestProblems({ ...request, ...patch }, THURSDAY).map((problem) => problem.field);
  assert.deepEqual(fields({ difficulty: "custom", sources: { activities: false, sleep: true, zones: true } }), ["difficulty"]);
  assert.deepEqual(fields({ difficulty: "custom", sources: { activities: true, sleep: false, zones: false } }), []);
  assert.deepEqual(fields({ difficulty: "advanced", sources: { activities: false, sleep: false, zones: false } }), []);
});

await test("both generation turns withhold what the athlete did not share, from the tools and the snapshot", () => {
  const source = fs.readFileSync(path.join(repoRoot, "electron", "chatService.ts"), "utf8");
  assert.match(source, /allow: \(name\) => !withheldTools\.has\(name\) && !toolReadsWithheldSource\(name, sources\)/);
  assert.match(source, /runTools\.set\(requestId, \{ extra: \[\], \.\.\.generationReach\(request, SESSIONS_WITHHELD_TOOLS\) \}\)/);
  assert.match(source, /\.\.\.generationReach\(request, OUTLINE_WITHHELD_TOOLS\)/);
  assert.equal((source.match(/runTools\.get\(requestId\)\?\.context/g) ?? []).length, 5, "every provider's snapshot is built with the run's scope");
  const context = source.slice(source.indexOf("async function buildTrainingContext("));
  assert.match(context, /includeActivities = permissions\?\.recentActivities !== false && scope\?\.activities !== false/);
  assert.match(context, /includeDashboard = includeMetrics && scope\?\.activities !== false/, "records and predictions come from the history");
  assert.match(context, /scope\?\.zones === false\s*\?\s*\{ \.\.\.profile\.value, thresholds: \{ zones: profile\.value\.thresholds\.zones, ranges: \{\} \} \}/, "the threshold anchors go with the zones");
});

/* The tool checks real dates against today, so this part is dated from now. */
const liveMonday = generation.firstPlanMonday(new Date());
const day = (weeks, offset) => dayOf(liveMonday, weeks, offset);
const liveRequest = { ...request, startDate: liveMonday, sports: ["run"] };
const liveWorkouts = [
  session("w1-mon", day(0, 0)),
  session("w1-thu", day(0, 3)),
  session("w2-mon", day(1, 0)),
  session("w2-thu", day(1, 3))
];

await test("the draft tool refuses a draft that breaks the request, and keeps nothing", async () => {
  const drafts = [];
  const answer = JSON.parse(
    await chatWorkoutTools.handleChatWorkoutTool(
      "draft_training_plan",
      { name: "10K build", workouts: liveWorkouts.slice(0, 3) },
      { planRequest: liveRequest, onPlanDraft: (preview) => drafts.push(preview) }
    )
  );
  assert.equal(answer.ok, false);
  assert.equal(answer.error_code, "plan_breaks_request");
  assert.match(answer.errors.join("\n"), /Week 2 .* has 1 session; it needs exactly 2/);
  assert.match(answer.action, /call draft_training_plan again/);
  assert.equal(drafts.length, 0, "a refused draft is not announced");
});

await test("an accepted draft is held in memory for the run, never persisted", async () => {
  const drafts = [];
  const answer = JSON.parse(
    await chatWorkoutTools.handleChatWorkoutTool(
      "draft_training_plan",
      {
        name: "10K build",
        description: "Two sharp weeks.",
        week_stages: [{ week: 1, stage: "build" }, { week: 2, stage: "peak" }],
        workouts: liveWorkouts
      },
      { planRequest: liveRequest, onPlanDraft: (preview) => drafts.push(preview) }
    )
  );
  assert.equal(answer.ok, true, JSON.stringify(answer));
  assert.equal(drafts.length, 1);
  assert.equal(answer.draft_id, drafts[0].draftId);
  assert.doesNotMatch(answer.message, /plan card|upload_training_plan/, "there is no card to point the athlete at");

  const held = chatWorkoutTools.generatedPlanDraft(answer.draft_id);
  assert.equal(held.plan.description, "Two sharp weeks.");
  assert.deepEqual(held.plan.weekStages, [{ weekIndex: 0, stage: 3 }, { weekIndex: 1, stage: 4 }]);
  const plan = generation.trainingPlanFromDraftPreview(held.preview, liveRequest, {
    description: held.plan.description,
    weekStages: held.plan.weekStages
  });
  assert.equal(plan.entries.length, 4);
  assert.deepEqual(plan.weekStages, [{ weekIndex: 0, stage: 3 }, { weekIndex: 1, stage: 4 }]);

  chatWorkoutTools.forgetGeneratedPlanDrafts([answer.draft_id]);
  assert.equal(chatWorkoutTools.generatedPlanDraft(answer.draft_id), undefined);
});

await test("the generation runs read-only and lets go of its drafts", () => {
  const source = fs.readFileSync(path.join(repoRoot, "electron", "chatService.ts"), "utf8");
  const body = source.slice(source.indexOf("export async function generateTrainingPlan("));
  const fn = body.slice(0, body.indexOf("\nexport function cancelChat("));
  assert.match(fn, /toolPolicy: "read-only"/, "no write tool is offered to a generation");
  assert.match(fn, /runtime: request\.runtime/, "the AI panel's choice reaches the run, as an analysis's does");
  assert.match(fn, /finally \{[^}]*forgetGeneratedPlanDrafts\(run\.drafts\./, "its drafts go when it ends, however it ends");
  assert.match(source, /planRequest: generation\?\.request/, "the draft tool is told what the athlete asked for");
});

console.log(`training plan generation OK — ${passed} checks`);
