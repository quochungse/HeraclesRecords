// The plan generator's simulated model (trainingPlanSimulation.ts), switched
// on by HERACLES_SIMULATE_PLAN_AI=1 so the generator can be worked on without
// an AI quota.
//
// The script stands in for the model and nothing after it: its outline and
// its plan go through the real checks and the real draft tool. So what this
// holds down is that the script is a model that gets it right —
//
// - **Its outline passes the outline check**, for every shape of request: a
//   race (on a usual day and on a rest day), a length set or left to Coach,
//   a week set day by day (with days Coach may use) or left to Coach (with
//   days blocked, a session count and an hours ceiling).
// - **Its plan passes the plan check against that outline** — each week's
//   exact count, its hours within a fifth, the days, the minutes, race day.
// - **Its first draft is one session short on purpose**, so the check's
//   hand-back can be watched, and the fix after it passes.
// - **The real draft tool takes it** and the plan it becomes has nothing a
//   COROS save would refuse.
// - **It is off unless the variable is exactly "1"**, and says it is
//   simulated in its words.
// - **`chatService` runs it in the model's place and nothing else changes**:
//   both turns stream, call the real tools, resolve with an outline and a
//   plan, and stop on `chat:cancel`.
//
// Launched through Electron as Node: `chatService` imports `electron`.
//
// Run: npm run test:training-plan-simulation
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distUrl = (file) =>
  `${pathToFileURL(path.join(repoRoot, "dist-electron", file)).href}?cacheBust=${Date.now()}`;

const generation = await import(distUrl("trainingPlanGeneration.js"));
const simulation = await import(distUrl("trainingPlanSimulation.js"));
const chatWorkoutTools = await import(distUrl("chatWorkoutTools.js"));
const domain = await import(distUrl("trainingPlanDomain.js"));
process.env.HERACLES_SIMULATE_PLAN_AI = "1";
const chatService = await import(distUrl("chatService.js"));

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

/* The draft tool checks dates against today, so the plans start next week. */
const monday = generation.firstPlanMonday(new Date());
const dayAfter = (weeks, offset) => {
  const date = new Date(`${generation.addPlanWeeks(monday, weeks)}T12:00:00`);
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const days = (...spec) => ({ mode: "days", days: spec.map(([kind, minutes]) => (kind === "rest" ? { kind } : { kind, minutes })) });
const base = { goal: "", sports: ["run"], difficulty: "intermediate", startDate: monday };
const usualWeek = days(["rest"], ["train", 45], ["rest"], ["train", 60], ["flex", 40], ["long", 100], ["rest"]);

const REQUESTS = {
  "a race on a usual day": { ...base, goalKind: "race", race: { date: dayAfter(9, 5), distance: "Half" }, week: usualWeek },
  "a race on a rest day": { ...base, goalKind: "race", race: { date: dayAfter(5, 6), distance: "10K" }, week: usualWeek },
  "a base with its length set": { ...base, goalKind: "base", weeks: 6, week: usualWeek, sports: ["run", "bike"] },
  "a length left to Coach, with strength": { ...base, goalKind: "hybrid", week: usualWeek, sports: ["run", "strength"] },
  "a week with Free days": {
    ...base, goalKind: "base", weeks: 4,
    week: { mode: "days", days: [{ kind: "rest" }, { kind: "train" }, { kind: "rest" }, { kind: "train", minutes: 60 }, { kind: "flex" }, { kind: "long" }, { kind: "rest" }] }
  },
  "a week left to Coach": { ...base, goalKind: "return", weeks: 5, week: { mode: "coach", blockedDayIndexes: [0, 4] } },
  "a week left to Coach, with a count and a ceiling": {
    ...base, goalKind: "other", goal: "Ski fitness", weeks: 7, sports: ["run", "bike", "swim"],
    week: { mode: "coach", hours: { min: 3, max: 4 }, sessionsPerWeek: 4, blockedDayIndexes: [2] }
  },
  "a race with the week left to Coach": {
    ...base, goalKind: "race", race: { date: dayAfter(7, 3), distance: "Marathon" },
    week: { mode: "coach", sessionsPerWeek: 5, blockedDayIndexes: [3] }
  }
};

const outlineFor = (request, note) => {
  const parsed = generation.parsePlanOutline(simulation.simulatedOutlineArgs(request, note));
  assert.deepEqual(parsed.errors, [], "the outline is complete");
  return parsed.outline;
};

for (const [name, request] of Object.entries(REQUESTS)) {
  await test(`${name}: the outline and the plan pass the checks`, () => {
    assert.deepEqual(generation.generationRequestProblems(request, new Date()), [], "the fixture is a valid request");
    const outline = outlineFor(request);
    assert.deepEqual(generation.planOutlineProblems(outline, request), [], "the outline fits the request");
    const accepted = { ...request, outline };
    const plan = simulation.simulatedDraftArgs(accepted);
    assert.deepEqual(generation.generatedPlanProblems(plan.workouts, accepted), [], "the plan fits the outline");
    assert.deepEqual(
      generation.generatedPlanProblems(simulation.simulatedDraftArgs(request).workouts, request),
      [],
      "and the request, without one"
    );
    const flawed = simulation.simulatedDraftArgs(accepted, { flawed: true });
    assert.match(generation.generatedPlanProblems(flawed.workouts, accepted).join(" "), /^Week 1 .* the outline gives it/, "the first draft is a session short, on purpose");
  });
}

await test("a race week holds the race on race day, and the outline gives it the race stage", () => {
  const request = REQUESTS["a race on a rest day"];
  const outline = outlineFor(request);
  assert.equal(outline.weeks.at(-1).stage, 5);
  const plan = simulation.simulatedDraftArgs({ ...request, outline });
  const race = plan.workouts.at(-1);
  assert.equal(race.schedule_date, request.race.date, "on race day, though the day is usually a rest");
  assert.match(race.name, /^Race: 10K/);
});

await test("the real draft tool takes the plan, and nothing in it would stop a COROS save", async () => {
  const request = REQUESTS["a base with its length set"];
  const accepted = { ...request, outline: outlineFor(request) };
  const drafts = [];
  const answer = JSON.parse(
    await chatWorkoutTools.handleChatWorkoutTool("draft_training_plan", simulation.simulatedDraftArgs(accepted), {
      planRequest: accepted,
      onPlanDraft: (preview) => drafts.push(preview)
    })
  );
  assert.equal(answer.ok, true, JSON.stringify(answer));
  const held = chatWorkoutTools.generatedPlanDraft(answer.draft_id);
  const plan = generation.trainingPlanFromDraftPreview(held.preview, accepted, {
    description: held.plan.description,
    weekStages: held.plan.weekStages
  });
  assert.equal(plan.weekCount, 6);
  assert.deepEqual(domain.validateTrainingPlan(plan).filter((issue) => issue.severity === "error"), []);
  assert.match(plan.name, /\(simulated\)$/, "the plan says it was simulated");
  assert.match(plan.description, /^Simulated plan — no AI wrote this/);
  chatWorkoutTools.forgetGeneratedPlanDrafts([answer.draft_id]);
});

await test("a name COROS could not place takes its first candidate, or leaves", () => {
  const request = REQUESTS["a length left to Coach, with strength"];
  const args = simulation.simulatedDraftArgs(request);
  const strength = args.workouts.find((workout) => workout.sport === "strength");
  assert.ok(strength, "a strength sport gets a day of the week");
  const fixed = simulation.withExerciseCandidates(args, [
    { workout_key: strength.key, exercise_name: "Squat", candidates: ["Back Squat", "Goblet Squat"] },
    { workout_key: strength.key, exercise_name: "Plank", candidates: [] }
  ]);
  const names = fixed.workouts.find((workout) => workout.key === strength.key).steps.map((step) => step.exercise_name).filter(Boolean);
  assert.deepEqual(names, ["Back Squat", "Push-up"]);
});

await test("a redraw's words are said to have been read, and the run says it is simulated", () => {
  const request = REQUESTS["a base with its length set"];
  assert.match(simulation.simulatedOutlineArgs(request, "a lighter week 3").summary, /a lighter week 3/);
  assert.match(simulation.simulatedOutlineArgs(request).basis, /simulated/);
  for (const kind of ["outline", "plan"]) {
    const [opening] = simulation.simulatedThinking(kind, { ...request, outline: outlineFor(request) });
    assert.match(opening, /^\*\*Simulated run — no AI is called\*\*\n/, "the first line of the thinking says so");
  }
});

await test("it is off unless the variable says exactly 1", () => {
  assert.equal(simulation.simulatePlanAi({}), false);
  assert.equal(simulation.simulatePlanAi({ HERACLES_SIMULATE_PLAN_AI: "true" }), false);
  assert.equal(simulation.simulatePlanAi({ HERACLES_SIMULATE_PLAN_AI: "1" }), true);
});

await test("chatService runs both turns on the script, through the real tools", async () => {
  const request = REQUESTS["a base with its length set"];
  const heard = [];
  const sink = { emit: (channel, payload) => heard.push({ channel, ...payload }) };
  const outline = await chatService.outlineTrainingPlan(sink, "sim-outline", request);
  assert.equal(outline.ok, true, outline.message);
  assert.equal(outline.outline.weeks.length, 6);
  assert.match(heard.filter((event) => event.kind === "thinking").map((event) => event.delta).join(""), /^\*\*Simulated run — no AI is called\*\*/, "its thinking streams, and says what it is first");
  assert.equal(heard.filter((event) => event.tool === "propose_plan_outline").length, 1);
  assert.equal(heard.at(-1).channel, "chat:streamDone");

  heard.length = 0;
  const plan = await chatService.generateTrainingPlan(sink, "sim-plan", { ...request, outline: outline.outline });
  assert.equal(plan.ok, true, plan.message);
  assert.equal(plan.plan.weekCount, 6);
  assert.equal(heard.filter((event) => event.tool === "draft_training_plan").length, 2, "the first draft is sent back and the second taken");
  assert.equal(heard.filter((event) => event.kind === "planDraft").length, 1);
  const thinking = heard.filter((event) => event.kind === "thinking").map((event) => event.delta).join("");
  assert.match(thinking, /\*\*Fixing what the check found\*\*\n\nWeek 1 /, "and it says what it fixed");
});

await test("a simulated turn stops on chat:cancel", async () => {
  const sink = { emit: () => {} };
  const running = chatService.outlineTrainingPlan(sink, "sim-cancel", REQUESTS["a week left to Coach"]);
  await new Promise((resolve) => setTimeout(resolve, 150));
  chatService.cancelChat("sim-cancel");
  assert.deepEqual(await running, { ok: false, reason: "cancelled" });
});

console.log(`training plan simulation OK — ${passed} checks`);
