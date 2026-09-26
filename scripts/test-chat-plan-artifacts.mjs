// A coach's creation as a chain of versions in `chat_plan_drafts`
// (docs/coach-plan-canvas.md, P1.1). What the suite holds down:
//
//   * A new draft is version 1 of its own creation, written by the coach.
//   * The card handed to the transcript carries no `source` — the steps of a
//     45-session plan are ~50k characters per version — while the row's
//     `preview_json` keeps them, because a build from before versions saves a
//     plan to COROS from that preview and would write every session empty.
//   * Opening a conversation no longer puts the steps back into its cards,
//     or the next save writes them into the transcript anyway.
//   * The draft's document still has every step, for a plan and a workout.
//   * A row from before versions reads as its own version 1.
//   * Versions group by creation; the newest is the highest number, and two
//     machines that each made the next one offline keep both.
//
// Usage:
//   npm run test:chat-plan-artifacts
//
// Runs under Electron for the better-sqlite3 ABI, with strip-types for the
// renderer's `creationVersions.ts`.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distUrl = (file) =>
  `${pathToFileURL(path.join(repoRoot, "dist-electron", file)).href}?cacheBust=${Date.now()}`;

const database = await import(distUrl("database.js"));
const tools = await import(distUrl("chatWorkoutTools.js"));
const history = await import(distUrl("chatHistoryStore.js"));
const versions = await import(
  pathToFileURL(path.join(repoRoot, "src/chat/creationVersions.ts")).href
);

database.initializeDatabase(fs.mkdtempSync(path.join(os.tmpdir(), "chat-plan-artifacts-")));

const cases = [];
const test = (name, run) => cases.push([name, run]);

const run = (name, seconds, extra = {}) => ({
  key: name.toLowerCase().replaceAll(" ", "-"),
  name,
  sport: "run",
  steps: [{ kind: "training", target_type: "time", target_duration_seconds: seconds, intensity: { type: "none" } }],
  ...extra
});

async function draft(tool, args) {
  let preview;
  const response = JSON.parse(
    await tools.handleChatWorkoutTool(tool, args, {
      allowUpcomingWorkouts: false,
      onPlanDraft: (drafted) => {
        preview = drafted;
      }
    })
  );
  assert.equal(response.ok, true, JSON.stringify(response));
  return preview;
}

const plan = await draft("draft_training_plan", {
  name: "Base block",
  description: "Two easy weeks.",
  workouts: [
    run("Easy Tuesday", 1800, { week: 1, day: "tue" }),
    run("Long Sunday", 5400, { week: 2, day: "sun" })
  ]
});
const workout = await draft("draft_workout", {
  workout: run("Recovery run", 2100),
  calendar_date: "20991002"
});

test("a new draft is version 1 of its own creation, by the coach", () => {
  const row = database.getChatPlanDraft(plan.draftId);
  assert.equal(row.artifactId, plan.draftId);
  assert.equal(row.version, 1);
  assert.equal(row.author, "coach");
  assert.equal(row.parentDraftId, undefined);
});

test("the transcript's card is light; the row's preview is not", () => {
  for (const preview of [plan, workout]) {
    assert.equal(preview.entries.length > 0, true);
    for (const entry of preview.entries) {
      assert.equal("source" in entry, false, `${preview.name}: the card carries no steps`);
    }
    const stored = JSON.parse(database.getChatPlanDraft(preview.draftId).previewJson);
    for (const entry of stored.entries) {
      assert.equal(entry.source?.steps?.length, 1, `${preview.name}: an older build saves from these`);
    }
  }
});

test("the document has every step, for a plan and for a workout", () => {
  const document = tools.planDraftDocument(plan.draftId);
  assert.deepEqual(
    document.entries.map((entry) => [entry.weekIndex, entry.dayIndex, entry.workout.steps.length]),
    [[0, 1, 1], [1, 6, 1]]
  );
  const single = tools.planDraftDocument(workout.draftId);
  assert.equal(single.entries.length, 1);
  assert.equal(single.entries[0].workout.steps[0].target_duration_seconds, 2100);
});

test("an edit hands back a light card and keeps the steps in the row", () => {
  const edited = tools.saveWorkoutDraftEdit(workout.draftId, run("Recovery run", 2400), "metric");
  assert.equal("source" in edited.entries[0], false);
  const stored = JSON.parse(database.getChatPlanDraft(workout.draftId).previewJson);
  assert.equal(stored.entries[0].source.steps[0].target_duration_seconds, 2400);
});

test("opening a conversation restores a card's kind but not its steps", () => {
  const card = { kind: "planDraft", draft: { ...workout, artifactType: undefined } };
  const [opened] = history.restoreChatPlanDraftSources(
    history.parseChatTranscriptJson(JSON.stringify([card])),
    (draftId) => database.getChatPlanDraft(draftId)?.previewJson,
    { sources: false }
  );
  assert.equal(opened.draft.artifactType, "workout");
  assert.equal("source" in opened.draft.entries[0], false);
  // The default still restores both, for whoever calls it that way.
  const [restored] = history.restoreChatPlanDraftSources(
    history.parseChatTranscriptJson(JSON.stringify([card])),
    (draftId) => database.getChatPlanDraft(draftId)?.previewJson
  );
  assert.equal(restored.draft.entries[0].source.steps.length, 1);
});

test("a row from before versions is its own version 1", () => {
  const row = database.getChatPlanDraft(plan.draftId);
  database.saveChatPlanDraft({
    draftId: "legacy-1",
    planJson: row.planJson,
    previewJson: JSON.stringify({ ...JSON.parse(row.previewJson), draftId: "legacy-1" }),
    createdAt: 1
  });
  const listed = tools.planArtifacts(["legacy-1"]);
  assert.deepEqual(
    listed.map(({ draftId, artifactId, version, author }) => ({ draftId, artifactId, version, author })),
    [{ draftId: "legacy-1", artifactId: "legacy-1", version: 1, author: "coach" }]
  );
  assert.equal(tools.planDraftDocument("legacy-1").entries.length, 2, "and its plan opens");
});

test("versions group by creation, and the newest is the one with buttons", () => {
  const row = database.getChatPlanDraft(plan.draftId);
  database.saveChatPlanDraft({
    ...row,
    draftId: "plan-v2",
    createdAt: row.createdAt + 10,
    artifactId: plan.draftId,
    version: 2,
    parentDraftId: plan.draftId,
    author: "athlete"
  });
  const listed = tools.planArtifacts([plan.draftId, workout.draftId]);
  assert.deepEqual(
    listed.filter((item) => item.artifactId === plan.draftId).map((item) => [item.draftId, item.version]),
    [[plan.draftId, 1], ["plan-v2", 2]],
    "asked by one version, every version of its creation comes back, oldest first"
  );
  assert.equal(listed.filter((item) => item.artifactId === workout.draftId).length, 1);

  const index = versions.creationVersions(listed);
  assert.equal(versions.isLatestVersion(index, plan.draftId), false);
  assert.equal(versions.isLatestVersion(index, "plan-v2"), true);
  assert.equal(versions.isLatestVersion(index, workout.draftId), true);
  assert.equal(versions.isLatestVersion(index, "never-listed"), true, "a card not yet known counts as newest");
  assert.equal(versions.supersededLine(index.get(plan.draftId)), "v1 · replaced by v2 from you");
});

test("two versions of one number, made apart, are both kept", () => {
  const row = database.getChatPlanDraft("plan-v2");
  database.saveChatPlanDraft({ ...row, draftId: "plan-v2-elsewhere", createdAt: row.createdAt + 5, author: "coach" });
  const listed = tools.planArtifacts(["plan-v2"]);
  assert.equal(listed.length, 3);
  const index = versions.creationVersions(listed);
  assert.equal(versions.isLatestVersion(index, "plan-v2-elsewhere"), true, "the later written counts");
  assert.equal(versions.isLatestVersion(index, "plan-v2"), false);
  assert.equal(index.get("plan-v2").siblings.length, 3, "and neither is lost");
  assert.equal(versions.supersededLine(index.get("plan-v2")), "v2 · replaced by a later v2 from Coach");
});

test("a card's steps come back from its document by key", () => {
  const document = tools.planDraftDocument(plan.draftId);
  const full = versions.withDocumentSources(plan, document);
  assert.deepEqual(
    full.entries.map((entry) => entry.source?.steps?.[0]?.target_duration_seconds),
    [1800, 5400]
  );
  assert.equal(versions.withDocumentSources(plan, undefined), plan, "nothing to add, nothing changed");
});

let failed = 0;
for (const [name, body] of cases) {
  try {
    await body();
    console.log(`ok - ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`not ok - ${name}\n${error.stack}`);
  }
}
if (failed) {
  console.error(`${failed} of ${cases.length} failed`);
  process.exit(1);
}
console.log(`chat plan artifact tests passed (${cases.length})`);
process.exit(0);
