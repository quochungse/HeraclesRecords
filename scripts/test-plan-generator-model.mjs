// The AI plan generator's renderer-side arithmetic, outside the component so a
// test can reach it: the form and the request it becomes
// (planGeneratorModel.ts), and which AI writes the plan
// (planGeneratorRuntime.ts).
//
// What this holds down:
//
// - **The form sends what the athlete said, and nothing it did not.** A goal
//   that is not a race sends a length only when one was set; a week left to
//   Coach sends only the answers that are not "Not sure"; a rest day and a
//   Free day send no minutes.
// - **A day starts at its kind's time** — an hour, two for the long day — and
//   a day's time reads as it is chosen: "45 min", "1 h 30", "Free".
// - **The summary counts a week as the draft tool does** — the same band.
// - **An untouched AI panel sends nothing.** The run is then exactly Coach's,
//   and a request never carries a copy of settings that could go stale.
// - **A model is sent only when it names one.** `streamChat` reads `""` as a
//   model id on the Messages API, so the providers' "Default model" / "Auto"
//   must travel as no model at all.
// - **Effort only reaches the two Claude providers**, as everywhere else.
// - **"Keep this for Coach chat too" writes what Coach's own pickers write**,
//   provider by provider, and nothing else.
// - **A run's trail says what the stream said, and only that** (runTrail.ts):
//   a line per read, repeats counted, a heading of Claude's thinking summary
//   as a line once it is complete — bold inside a sentence is not one — and a
//   second hand-over to the check said as the first coming back.
//
// Launched through Electron with strip-types: the module graph is renderer
// `.ts` with extensionless imports, and this machine's Node has no Amaro.
//
// Run: npm run test:plan-generator-model
import assert from "node:assert/strict";

const runtime = await import("../src/training-library/planGeneratorRuntime.ts");
const model = await import("../src/training-library/planGeneratorModel.ts");
const trail = await import("../src/training-library/runTrail.ts");

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

const settings = {
  provider: "claude-code",
  chatgpt: { model: undefined },
  anthropic: { model: "claude-opus-5", effort: "medium", hasApiKey: true },
  claudeCode: { model: "opus", effort: "high", defaultModel: "claude-opus-5" },
  openRouter: { model: "openrouter/auto", hasApiKey: false },
  local: { model: "" },
  compactContext: {}
};

await test("the panel starts at what Coach would run", () => {
  assert.deepEqual(runtime.runtimeFromSettings(settings), { provider: "claude-code", model: "opus", effort: "high" });
  assert.deepEqual(runtime.runtimeFromSettings(settings, "claude-api"), { provider: "claude-api", model: "claude-opus-5", effort: "medium" });
  assert.deepEqual(runtime.runtimeFromSettings(settings, "chatgpt"), { provider: "chatgpt", model: "", effort: "high" });
});

await test("an untouched panel sends nothing; a change sends only itself", () => {
  const coach = runtime.runtimeFromSettings(settings);
  assert.equal(runtime.requestRuntime(coach, settings), undefined);
  assert.deepEqual(runtime.requestRuntime({ ...coach, effort: "max" }, settings), { effort: "max" });
  assert.deepEqual(runtime.requestRuntime({ ...coach, model: "sonnet" }, settings), { model: "sonnet" });
  assert.deepEqual(
    runtime.requestRuntime(runtime.runtimeFromSettings(settings, "claude-api"), settings),
    { provider: "claude-api" },
    "another provider at its own settings sends only the provider"
  );
});

await test("a default model travels as no model, and effort only to Claude", () => {
  assert.deepEqual(runtime.requestRuntime({ provider: "claude-code", model: "", effort: "high" }, settings), undefined,
    "Claude Code's Default model is not a model id");
  assert.deepEqual(runtime.requestRuntime({ provider: "chatgpt", model: "", effort: "max" }, settings), { provider: "chatgpt" },
    "ChatGPT's Auto is no model, and ChatGPT takes no effort");
  assert.deepEqual(runtime.requestRuntime({ provider: "local", model: "llama", effort: "low" }, settings), { provider: "local" },
    "a local model is chosen in Coach settings, not here");
});

await test("keeping it for Coach writes what Coach's pickers write", () => {
  const api = runtime.settingsWithRuntime(settings, { provider: "claude-api", model: "claude-sonnet-5", effort: "low" });
  assert.equal(api.provider, "claude-api");
  assert.deepEqual(api.anthropic, { model: "claude-sonnet-5", effort: "low", hasApiKey: true });
  assert.equal(api.claudeCode, settings.claudeCode, "another provider's settings are left alone");
  const code = runtime.settingsWithRuntime(settings, { provider: "claude-code", model: "", effort: "max" });
  assert.deepEqual(code.claudeCode, { model: undefined, effort: "max", defaultModel: "claude-opus-5" });
  assert.equal(runtime.settingsWithRuntime(settings, { provider: "openrouter", model: "", effort: "high" }).openRouter.model, "openrouter/auto");
  assert.equal(runtime.settingsWithRuntime(settings, { provider: "chatgpt", model: "gpt-5.5", effort: "high" }).chatgpt.model, "gpt-5.5");
  assert.equal(settings.provider, "claude-code", "the settings handed in are not changed");
});

await test("the card names the model and, for Claude, the effort", () => {
  const options = runtime.runtimeModelOptions("claude-code", settings, null);
  assert.equal(options[0].label, "Default (Opus 5)", "the default is named once Claude Code has said which it is");
  assert.equal(runtime.runtimeSummary({ provider: "claude-code", model: "opus", effort: "high" }, options), "Opus · High effort");
  assert.equal(runtime.runtimeSummary({ provider: "claude-code", model: "", effort: "xhigh" }, options), "Default (Opus 5) · Extra high effort");
  assert.equal(
    runtime.runtimeSummary({ provider: "chatgpt", model: "", effort: "high" }, runtime.runtimeModelOptions("chatgpt", settings, null)),
    "Auto"
  );
  const listed = runtime.runtimeModelOptions("claude-code", settings, { availableModels: [{ value: "x", label: "Opus 5.1" }] });
  assert.deepEqual(listed, [{ value: "x", label: "Opus 5.1" }], "the account's own list wins over the static one");
  assert.deepEqual(runtime.runtimeModelOptions("local", settings, null), []);
});

const MONDAY = "2026-08-03";
const form = (patch = {}) => ({ ...model.DEFAULT_GENERATOR_FORM, ...patch });

await test("a race sends its day and distance, and no length of its own", () => {
  const request = model.requestFromForm(form({ raceDate: "2026-09-26", raceDistance: "Half", weeks: 12, lengthMode: "set" }), MONDAY);
  assert.equal(request.goalKind, "race");
  assert.deepEqual(request.race, { date: "2026-09-26", distance: "Half" });
  assert.equal(request.weeks, undefined, "race day decides the length");
  assert.equal(request.startDate, MONDAY);
  assert.equal(request.difficulty, "custom", "Coach judges the level unless told");
  assert.deepEqual(model.requestFromForm(form({ raceDate: "2026-09-26" }), MONDAY).race, { date: "2026-09-26" }, "the race's name can say the distance");
});

await test("a goal that is not a race sends a length only when one was set", () => {
  assert.equal(model.requestFromForm(form({ goalKind: "base" }), MONDAY).weeks, undefined);
  assert.equal(model.requestFromForm(form({ goalKind: "base", lengthMode: "set", weeks: 10 }), MONDAY).weeks, 10);
  const other = model.requestFromForm(form({ goalKind: "other", goal: "  Ski fitness  ", startOffset: 2 }), MONDAY);
  assert.equal(other.goal, "Ski fitness");
  assert.equal(other.race, undefined);
  assert.equal(other.startDate, "2026-08-17");
});

await test("a usual week sends its days, a rest day without minutes", () => {
  const request = model.requestFromForm(form(), MONDAY);
  assert.equal(request.week.mode, "days");
  assert.deepEqual(request.week.days[0], { kind: "rest" }, "a rest day sends no minutes");
  assert.deepEqual(request.week.days[5], { kind: "long", minutes: 120 });
  const free = model.requestFromForm(form({ days: model.DEFAULT_GENERATOR_FORM.days.map((day, index) => (index === 1 ? { kind: "train", minutes: null } : day)) }), MONDAY);
  assert.deepEqual(free.week.days[1], { kind: "train" }, "a Free day sends no minutes: it has no limit");
  assert.equal(request.constraints, undefined, "an empty box sends nothing");
});

await test("a week left to Coach sends only what the athlete was sure of", () => {
  assert.deepEqual(model.requestFromForm(form({ weekMode: "coach" }), MONDAY).week, { mode: "coach", blockedDayIndexes: [] });
  assert.deepEqual(
    model.requestFromForm(form({ weekMode: "coach", hoursChoice: "12+", sessionsChoice: "5", blockedDays: [4, 1] }), MONDAY).week,
    { mode: "coach", hours: { min: 12 }, sessionsPerWeek: 5, blockedDayIndexes: [1, 4] }
  );
});

await test("only a source switched off travels", () => {
  assert.equal(model.requestFromForm(form(), MONDAY).sources, undefined, "absent means everything");
  assert.deepEqual(
    model.requestFromForm(form({ sources: { activities: true, sleep: false, zones: true } }), MONDAY).sources,
    { activities: true, sleep: false, zones: true }
  );
});

await test("a day cycles Rest, Train, Long day, Coach picks, each starting at its own time", () => {
  let day = { kind: "rest", minutes: 45 };
  const kinds = [];
  for (let step = 0; step < 4; step += 1) {
    day = model.cycleDay(day);
    kinds.push([day.kind, day.minutes]);
  }
  assert.deepEqual(kinds, [["train", 60], ["long", 120], ["flex", 60], ["rest", 60]], "an hour, two for the long day, an hour for Coach's");
  assert.deepEqual(model.cycleDay({ kind: "rest", minutes: null }), { kind: "train", minutes: 60 }, "a Free day cycled round starts again at an hour");
});

await test("a day's time reads as it is chosen, and Free is always offered", () => {
  assert.deepEqual([45, 60, 90, 135, null].map(model.dayTimeLabel), ["45 min", "1 h", "1 h 30", "2 h 15", "Free"]);
  const options = model.dayTimeOptions(60);
  assert.equal(options.at(-1).value, "free", "Free, last");
  assert.ok(options.some((option) => option.value === "60"));
  assert.ok(model.dayTimeOptions(135).some((option) => option.value === "135"), "a time outside the list stays offered");
});

await test("the week reads back as the band the draft tool checks", () => {
  assert.deepEqual(model.weekSummary(form()), { sessions: "5", time: "6 h", longDay: "Saturday" });
  const flex = form({ days: model.DEFAULT_GENERATOR_FORM.days.map((day, index) => (index === 0 ? { kind: "flex", minutes: 30 } : day)) });
  assert.deepEqual(model.weekSummary(flex), { sessions: "5–6", time: "up to 6.5 h", longDay: "Saturday" });
  const free = form({ days: model.DEFAULT_GENERATOR_FORM.days.map((day, index) => (index === 0 ? { kind: "flex", minutes: null } : day)) });
  assert.equal(model.weekSummary(free).time, "No limit", "a Free day leaves the week without a most");
  assert.deepEqual(model.weekSummary(form({ weekMode: "coach", hoursChoice: "5-8" })), { sessions: "Coach decides", time: "5–8 h", longDay: "Coach decides" });
});

await test("the dates read as one sentence, whatever decides the length", () => {
  const race = model.requestFromForm(form({ raceDate: "2026-09-26", raceDistance: "Half" }), MONDAY);
  assert.match(model.spanSentence(race), /^8 weeks from .+, ending on race day, /);
  assert.match(model.spanSentence(model.requestFromForm(form(), MONDAY)), /Pick race day/);
  assert.match(model.spanSentence(model.requestFromForm(form({ goalKind: "base" }), MONDAY)), /Coach chooses how many weeks/);
  const snapshot = model.planSnapshot(form({ raceDate: "2026-09-26", raceDistance: "Half" }), race);
  assert.deepEqual(snapshot.map((row) => row.label), ["Goal", "Length", "Dates", "Week", "Sports", "Level"]);
  assert.equal(snapshot[0].value, "Half");
  assert.equal(snapshot[1].value, "8 weeks");
  assert.equal(snapshot[5].value, "From my data");
});

await test("a run's trail is what the stream said, a line each", () => {
  let notes = trail.noteSnapshot(trail.EMPTY_NOTES);
  notes = trail.noteRead(notes, "list_recent_activities");
  notes = trail.noteRead(notes, "get_activity_detail");
  notes = trail.noteRead(notes, "get_activity_detail");
  notes = trail.noteRead(notes, "coros__querySleepData");
  assert.deepEqual(
    notes.trail.map((item) => [item.done, item.count]),
    [["Read your training snapshot", 1], ["Read your recent activities", 1], ["Looked at a session in detail", 2], ["Read COROS", 1]],
    "three sessions looked at is one line, counted"
  );
  notes = trail.noteHandOver(notes, "outline", 1);
  notes = trail.noteHandOver(notes, "outline", 2);
  assert.deepEqual(notes.trail.slice(-3).map((item) => [item.kind, item.done]), [
    ["read", "Handed the outline to the check"],
    ["check", "The check sent it back"],
    ["read", "Fixed the outline"]
  ]);
  assert.equal(trail.notePassed(notes).trail.at(-1).kind, "passed");
});

await test("a heading of the thinking becomes a line once it is whole", () => {
  let notes = trail.noteText(trail.EMPTY_NOTES, "**Weighing the recent vol");
  assert.equal(notes.trail.length, 0, "not while it is still arriving");
  notes = trail.noteText(notes, "ume**\n\nAbout 30 km a week, with a **long** run of 14 km.");
  assert.deepEqual(notes.trail.map((item) => item.done), ["Weighing the recent volume"], "bold inside a sentence is emphasis, not a heading");
  notes = trail.noteText(notes, "\n\n**Planning the build:**\nThree weeks up, one down");
  assert.deepEqual(notes.trail.map((item) => item.done), ["Weighing the recent volume", "Planning the build"]);
  assert.equal(trail.thoughtTail(notes.notes), "Three weeks up, one down", "the words shown are the ones after the last heading");
  notes = trail.noteText(notes, "Let me write it.", "text");
  assert.match(notes.notes, /one down\n\nLet me write it\.$/, "text after thinking starts a new paragraph");
  const long = trail.thoughtTail(`**Title**\n${"word ".repeat(100)}end`, 40);
  assert.ok(long.startsWith("…") && long.endsWith("end") && long.length <= 41, "a long thought shows its last words");
  assert.equal(trail.thoughtTail(""), "");
});

console.log(`plan generator model OK — ${passed} checks`);
