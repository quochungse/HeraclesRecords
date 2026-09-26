// A plan brief (docs/coach-plan-canvas.md, P2.1). What the suite holds down:
//
//   * A brief is the generator's request: an untouched brief is the untouched
//     form, and a brief read into the form and saved back is the same brief,
//     so editing one field does not quietly rewrite the others.
//   * Coach's prefill takes what it can and says what it could not: a start
//     day moves to its Monday, a malformed date is named in `not_taken`
//     rather than failing the brief, and each field Coach filled is marked
//     from chat or from data.
//   * A brief is stored on its artifact row, filled in further by its id,
//     refused once it has become a plan, and an athlete's edit drops the mark
//     on every field it changed.
//   * The transcript holds only the anchor, which survives a save and the
//     renderer's round trip.
//   * Coach's index lists a brief until it has a version.
//   * Deleting the conversation deletes its briefs.
//
// Usage:
//   npm run test:plan-brief
//
// Runs under Electron for the better-sqlite3 ABI, with strip-types and the
// resolver hook for the renderer's `planBriefModel.ts`.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distUrl = (file) =>
  `${pathToFileURL(path.join(repoRoot, "dist-electron", file)).href}?cacheBust=${Date.now()}`;

const database = await import(distUrl("database.js"));
const brief = await import(distUrl("planBrief.js"));
const briefs = await import(distUrl("chatPlanBriefs.js"));
const history = await import(distUrl("chatHistoryStore.js"));
const chat = await import(distUrl("chatService.js"));
const compaction = await import(distUrl("chatContextCompaction.js"));
const model = await import(pathToFileURL(path.join(repoRoot, "src/chat/planBriefModel.ts")).href);
const generator = await import(pathToFileURL(path.join(repoRoot, "src/training-library/planGeneratorModel.ts")).href);
const chatTypes = await import(pathToFileURL(path.join(repoRoot, "src/chat/chatTypes.ts")).href);

database.initializeDatabase(fs.mkdtempSync(path.join(os.tmpdir(), "plan-brief-")));

const cases = [];
const test = (name, run) => cases.push([name, run]);

// A Monday well ahead of any clock this runs under.
const MONDAY = "2031-03-03";
const TODAY = new Date(2031, 1, 26, 9);

test("an untouched brief is the untouched form", () => {
  assert.deepEqual(model.briefFromForm(generator.DEFAULT_GENERATOR_FORM, MONDAY), brief.defaultPlanBriefRequest(MONDAY));
});

test("a brief read into the form and saved back is the same brief", () => {
  const briefsToKeep = [
    brief.defaultPlanBriefRequest(MONDAY),
    {
      goalKind: "race",
      goal: "Hanoi Half",
      race: { date: "2031-05-18", distance: "Half" },
      sports: ["run", "strength"],
      difficulty: "intermediate",
      startDate: "2031-03-10",
      week: {
        mode: "days",
        days: [
          { kind: "rest" },
          { kind: "train", minutes: 45 },
          { kind: "flex", minutes: 60 },
          { kind: "rest" },
          { kind: "train", minutes: 60 },
          { kind: "long" },
          { kind: "rest" }
        ]
      },
      constraints: "Left knee: no downhill repeats."
    },
    {
      goalKind: "base",
      goal: "",
      sports: ["bike"],
      difficulty: "advanced",
      startDate: MONDAY,
      weeks: 6,
      week: { mode: "coach", hours: { min: 5, max: 8 }, sessionsPerWeek: 4, blockedDayIndexes: [0, 4] }
    }
  ];
  for (const request of briefsToKeep) {
    assert.deepEqual(model.briefFromForm(model.formFromBrief(request, MONDAY), MONDAY), request);
  }
});

test("a brief set out for a week since begun starts at the earliest Monday", () => {
  const form = model.formFromBrief({ ...brief.defaultPlanBriefRequest("2031-02-03") }, MONDAY);
  assert.equal(form.startOffset, 0);
});

test("Coach's prefill: filled fields are marked, a start day moves to its Monday", () => {
  const parsed = brief.briefFromPrefill(
    {
      goal_kind: "race",
      goal: "Hanoi Half",
      race_date: "2031-05-18",
      race_distance: "Half",
      start_date: "2031-03-12",
      level: "custom",
      sports: ["run", "swimming-with-dolphins"],
      from_data: ["level"]
    },
    brief.defaultPlanBriefRequest(MONDAY)
  );
  assert.deepEqual(parsed.dropped, []);
  assert.equal(parsed.request.startDate, "2031-03-10", "Wednesday the 12th starts the week of Monday the 10th");
  assert.deepEqual(parsed.request.race, { date: "2031-05-18", distance: "Half" });
  assert.deepEqual(parsed.request.sports, ["run"], "a sport the app cannot plan is left out");
  assert.deepEqual(parsed.origins, { goal: "chat", dates: "chat", level: "data", sports: "chat" });
});

test("Coach's prefill: what cannot be taken is named, and the rest still lands", () => {
  const parsed = brief.briefFromPrefill(
    { goal_kind: "race", race_date: "next spring", days: [{ kind: "train" }], level: "elite", constraints: "Travel in April" },
    brief.defaultPlanBriefRequest(MONDAY)
  );
  assert.equal(parsed.dropped.length, 3);
  assert.match(parsed.dropped.join(" | "), /race_date "next spring"/);
  assert.match(parsed.dropped.join(" | "), /days/);
  assert.match(parsed.dropped.join(" | "), /level "elite"/);
  assert.equal(parsed.request.constraints, "Travel in April");
  assert.deepEqual(parsed.origins, { constraints: "chat" }, "a field that was not taken is not marked");
});

test("Coach's prefill: a week of hours instead of days", () => {
  const parsed = brief.briefFromPrefill(
    { goal_kind: "base", hours_per_week: { min: 6, max: 9 }, sessions_per_week: 5, blocked_days: [6, 0, 6, 9], weeks: 10 },
    brief.defaultPlanBriefRequest(MONDAY)
  );
  assert.deepEqual(parsed.request.week, {
    mode: "coach",
    hours: { min: 6, max: 9 },
    sessionsPerWeek: 5,
    blockedDayIndexes: [0, 6]
  });
  assert.equal(parsed.request.race, undefined, "a base plan has no race");
  assert.equal(parsed.request.weeks, 10);
});

test("an edit's changed fields", () => {
  const before = brief.defaultPlanBriefRequest(MONDAY);
  assert.deepEqual(brief.briefChangedFields(before, before), []);
  assert.deepEqual(
    brief.briefChangedFields(before, { ...before, sports: ["run", "bike"], difficulty: "beginner" }),
    ["sports", "level"]
  );
  assert.deepEqual(brief.briefChangedFields(before, { ...before, sports: [...before.sports].reverse() }), []);
});

test("the tool writes a brief, and fills in the same one by its id", () => {
  const seen = [];
  const first = JSON.parse(
    briefs.handleRequestPlanBrief({ goal_kind: "race", goal: "Hanoi Half" }, "s-brief", (value) => seen.push(value), TODAY)
  );
  assert.equal(first.ok, true);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].artifactId, first.brief_id);
  assert.equal(seen[0].sessionId, "s-brief");
  assert.ok(first.still_open.includes("Pick race day."), "what is still missing goes back to Coach");
  assert.match(first.next, /Stop here/);

  const second = JSON.parse(
    briefs.handleRequestPlanBrief(
      { brief_id: first.brief_id, race_date: "2031-05-18", race_distance: "Half", from_data: ["goal"] },
      "s-brief",
      (value) => seen.push(value),
      TODAY
    )
  );
  assert.equal(second.brief_id, first.brief_id, "the same brief, filled in");
  assert.deepEqual(second.still_open, []);
  const stored = briefs.planBriefOf(first.brief_id);
  assert.equal(stored.request.goal, "Hanoi Half", "what it held is kept");
  assert.deepEqual(stored.request.race, { date: "2031-05-18", distance: "Half" });
  assert.equal(stored.origins.goal, "data");
  const row = database.getChatPlanArtifactRow(first.brief_id);
  assert.equal(row.raceDay, "2031-05-18");
  assert.equal(row.startMonday, stored.request.startDate);

  const unknown = JSON.parse(briefs.handleRequestPlanBrief({ brief_id: "nope" }, "s-brief", undefined, TODAY));
  assert.equal(unknown.ok, false);
});

test("an athlete's edit drops the mark on what it changed", () => {
  const made = JSON.parse(
    briefs.handleRequestPlanBrief(
      { goal_kind: "base", sports: ["run"], level: "intermediate", from_data: ["level"] },
      "s-edit",
      undefined,
      TODAY
    )
  );
  const before = briefs.planBriefOf(made.brief_id);
  assert.deepEqual(before.origins, { goal: "chat", sports: "chat", level: "data" });
  const after = briefs.updatePlanBrief(made.brief_id, { ...before.request, difficulty: "beginner" });
  assert.equal(after.request.difficulty, "beginner");
  assert.deepEqual(after.origins, { goal: "chat", sports: "chat" });
  assert.throws(() => briefs.updatePlanBrief("gone", before.request), /no longer/);
});

test("a brief that has become a plan is changed through the plan", () => {
  const made = JSON.parse(briefs.handleRequestPlanBrief({ goal_kind: "base" }, "s-plan", undefined, TODAY));
  database.saveChatPlanDraft({
    draftId: "brief-plan-v1",
    planJson: JSON.stringify({ name: "Base", entries: [] }),
    previewJson: JSON.stringify({ draftId: "brief-plan-v1", artifactType: "plan", name: "Base", summary: "", entries: [], conflicts: [], warnings: [] }),
    createdAt: Date.now(),
    artifactId: made.brief_id,
    version: 1,
    author: "coach"
  });
  const refused = JSON.parse(briefs.handleRequestPlanBrief({ brief_id: made.brief_id, weeks: 4 }, "s-plan", undefined, TODAY));
  assert.equal(refused.ok, false);
  assert.match(refused.error, /revise_training_plan/);
  assert.throws(() => briefs.updatePlanBrief(made.brief_id, briefs.planBriefOf(made.brief_id).request), /become a plan/);
});

test("the transcript holds only the anchor, through a save and the renderer", () => {
  const session = history.createChatSession("claude-code");
  const entries = [
    { kind: "message", role: "user", content: "Plan me a half" },
    { kind: "planBrief", artifactId: "a-1" }
  ];
  history.saveChatSession(session.id, entries);
  const read = history.getChatSession(session.id);
  assert.equal(read[1].kind, "planBrief");
  assert.equal(read[1].artifactId, "a-1");
  const back = chatTypes.toPersistedEntries(chatTypes.fromPersistedEntries(read));
  assert.equal(back[1].kind, "planBrief");
  assert.equal(back[1].artifactId, "a-1");
  assert.equal(history.parseChatTranscriptJson(JSON.stringify([{ kind: "planBrief" }])).length, 0, "no id, no anchor");
});

test("Coach's index lists a brief until it has a version", () => {
  const request = brief.defaultPlanBriefRequest(MONDAY);
  const withBrief = [
    { kind: "message", role: "user", content: "hi" },
    { kind: "planBrief", artifactId: "b-1" }
  ];
  const index = compaction.creationIndex(withBrief, [], [
    { artifactId: "b-1", request, origins: {}, createdAt: "", updatedAt: "" }
  ]);
  assert.match(index, /- Brief · brief_id b-1 · race on a day not yet picked, from 2031-03-03/);
  assert.match(index, /request_plan_brief and its brief_id/);
  assert.equal(compaction.creationIndex(withBrief, [], []), null, "an unread brief is not guessed at");
});

test("deleting the conversation deletes its briefs", () => {
  const session = history.createChatSession("claude-code");
  const made = JSON.parse(briefs.handleRequestPlanBrief({ goal_kind: "base" }, session.id, undefined, TODAY));
  history.saveChatSession(session.id, [
    { kind: "message", role: "user", content: "a base block" },
    { kind: "planBrief", artifactId: made.brief_id }
  ]);
  assert.ok(database.getChatPlanArtifactRow(made.brief_id));
  chat.deleteChatSessionById(session.id);
  assert.equal(database.getChatPlanArtifactRow(made.brief_id), undefined);
});

test("the card's rows are the generator's, marked with where Coach took them", () => {
  const parsed = brief.briefFromPrefill(
    { goal_kind: "race", goal: "Hanoi Half", race_date: "2031-05-18", level: "custom", from_data: ["level"] },
    brief.defaultPlanBriefRequest(MONDAY)
  );
  const rows = model.briefRows(parsed, MONDAY);
  assert.deepEqual(
    rows.map((row) => [row.label, row.origin ?? null]),
    [["Goal", "chat"], ["Length", null], ["Dates", null], ["Week", null], ["Sports", null], ["Level", "data"]]
  );
  assert.equal(model.briefTitle(parsed.request), "Hanoi Half");
  assert.deepEqual(model.briefOpenProblems(parsed.request, undefined, TODAY), []);
  assert.deepEqual(
    model.briefOpenProblems(parsed.request, { activities: false, sleep: true, zones: true }, TODAY),
    ["Coach can't judge your level without your recent activities — share them, or pick a level."],
    "\"From my data\" needs the conversation's activities"
  );
});

let failed = 0;
for (const [name, run] of cases) {
  try {
    await run();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  ✗ ${name}`);
    console.error(error);
  }
}
if (failed) {
  console.error(`${failed} of ${cases.length} failed`);
  process.exit(1);
}
console.log(`plan brief tests passed (${cases.length})`);
process.exit(0);
