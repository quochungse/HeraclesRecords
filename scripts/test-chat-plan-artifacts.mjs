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
//   * Coach revises by operations (P1.2): only the newest version, all of the
//     operations or none, through the checks a new draft passes; a workout
//     takes only a new workout and a name; a saved creation is refused for
//     now; and removing a creation removes every version of it.
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

test("an edit is the next version, by the athlete; a light card, the steps in the row", () => {
  const written = tools.saveWorkoutDraftEdit(workout.draftId, run("Recovery run", 2400), "metric");
  assert.equal(written.kind, "written");
  const edited = written.preview;
  assert.equal("source" in edited.entries[0], false);
  const row = database.getChatPlanDraft(edited.draftId);
  assert.equal(row.version, 2);
  assert.equal(row.author, "athlete");
  assert.equal(row.parentDraftId, workout.draftId);
  assert.ok(edited.editedAt);
  const stored = JSON.parse(row.previewJson);
  assert.equal(stored.entries[0].source.steps[0].target_duration_seconds, 2400);
  assert.deepEqual(written.changes, ["Changed Recovery run"]);
});

test("an edit begun on a version since replaced asks, and writes only when told (P1.5)", () => {
  // The editor was opened on version 1; version 2 is the athlete's edit above.
  const stale = tools.saveWorkoutDraftEdit(workout.draftId, run("Recovery run", 1200), "metric");
  assert.equal(stale.kind, "conflict");
  assert.equal(stale.newest.version, 2);
  assert.equal(stale.newest.author, "athlete");
  assert.equal(tools.planArtifacts([workout.draftId]).length, 2, "nothing written");
  const replaced = tools.saveWorkoutDraftEdit(workout.draftId, run("Recovery run", 1200), "metric", true);
  assert.equal(replaced.kind, "written");
  assert.deepEqual([replaced.fromVersion, replaced.toVersion], [2, 3], "written on top of the newest");
  assert.equal(database.getChatPlanDraft(replaced.preview.draftId).parentDraftId, stale.newest.draftId);
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
  // The workout has the athlete's two edits from above.
  assert.equal(listed.filter((item) => item.artifactId === workout.draftId).length, 3);

  const index = versions.creationVersions(listed);
  assert.equal(versions.isLatestVersion(index, plan.draftId), false);
  assert.equal(versions.isLatestVersion(index, "plan-v2"), true);
  assert.equal(versions.isLatestVersion(index, workout.draftId), false, "its first version is replaced");
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

// --- Coach revises what it made (P1.2) ---------------------------------------

async function revise(args) {
  const cards = [];
  const response = JSON.parse(
    await tools.handleChatWorkoutTool("revise_training_plan", args, {
      allowUpcomingWorkouts: false,
      onPlanDraft: (card) => cards.push(card)
    })
  );
  return { response, card: cards[0] };
}

const block = await draft("draft_training_plan", {
  name: "Build block",
  week_stages: [{ week: 1, stage: "base" }],
  workouts: [
    run("Easy Monday", 1800, { week: 1, day: "mon" }),
    run("Tempo Thursday", 2700, { week: 1, day: "thu" }),
    run("Long Saturday", 5400, { week: 2, day: "sat" })
  ]
});

test("a revision is the next version of the same creation, and changes only what it lists", async () => {
  const { response, card } = await revise({
    draft_id: block.draftId,
    summary: "Long run moved to Sunday, tempo made shorter",
    ops: [
      { op: "move_session", key: "long-saturday", week: 2, day: "sun" },
      { op: "replace_session", key: "tempo-thursday", workout: run("Short tempo", 2100) },
      { op: "add_session", week: 2, day: "tue", workout: run("Easy Tuesday", 1800) },
      { op: "remove_session", key: "easy-monday" },
      { op: "set_week_stage", week: 2, stage: "build" },
      { op: "rename", name: "Build block, shorter" }
    ]
  });
  assert.equal(response.ok, true, JSON.stringify(response));
  assert.equal(response.version, 2);
  assert.equal(card.draftId, response.draft_id, "the card is the new version");
  assert.equal(card.entries.some((entry) => "source" in entry), false, "and it is light");

  const row = database.getChatPlanDraft(response.draft_id);
  assert.equal(row.artifactId, block.draftId);
  assert.equal(row.version, 2);
  assert.equal(row.parentDraftId, block.draftId);
  assert.equal(row.author, "coach");
  assert.equal(row.changeSummary, "Long run moved to Sunday, tempo made shorter");

  const document = tools.planDraftDocument(response.draft_id);
  assert.equal(document.name, "Build block, shorter");
  const byKey = new Map(document.entries.map((entry) => [entry.workout.key, entry]));
  assert.deepEqual([...byKey.keys()].sort(), ["easy-tuesday", "long-saturday", "tempo-thursday"]);
  assert.deepEqual([byKey.get("long-saturday").weekIndex, byKey.get("long-saturday").dayIndex], [1, 6]);
  assert.equal(byKey.get("tempo-thursday").workout.name, "Short tempo", "a replaced session keeps its key");
  assert.equal(byKey.get("tempo-thursday").workout.steps[0].target_duration_seconds, 2100);
  assert.deepEqual([byKey.get("tempo-thursday").weekIndex, byKey.get("tempo-thursday").dayIndex], [0, 3], "and its place");
  assert.deepEqual(document.weekStages, [{ weekIndex: 0, stage: 2 }, { weekIndex: 1, stage: 3 }]);

  const original = tools.planDraftDocument(block.draftId);
  assert.equal(original.entries.length, 3, "version 1 is left as it was");
  assert.equal(original.name, "Build block");

  const listed = tools.planArtifacts([block.draftId]);
  assert.deepEqual(listed.map((item) => item.version), [1, 2]);
  assert.equal(listed[1].changeSummary, "Long run moved to Sunday, tempo made shorter");
});

test("only the newest version may be revised, and a refusal names it", async () => {
  const { response, card } = await revise({
    draft_id: block.draftId,
    summary: "Rename",
    ops: [{ op: "rename", name: "Stale" }]
  });
  assert.equal(response.ok, false);
  assert.equal(response.error_code, "not_latest_version");
  assert.equal(response.latest.version, 2);
  assert.ok(response.latest.sessions.some((line) => line.startsWith("long-saturday · week 2 sun")));
  assert.equal(card, undefined, "no card");
  assert.equal(tools.planArtifacts([block.draftId]).length, 2, "and no version");
});

test("an operation that cannot apply refuses the whole revision", async () => {
  const [, latest] = tools.planArtifacts([block.draftId]);
  const { response } = await revise({
    draft_id: latest.draftId,
    summary: "Two changes",
    ops: [
      { op: "rename", name: "Would be fine" },
      { op: "move_session", key: "no-such-session", week: 1, day: "mon" },
      { op: "add_session", week: 3, workout: run("Dayless", 600) },
      { op: "shuffle" }
    ]
  });
  assert.equal(response.ok, false);
  assert.equal(response.error_code, "revision_not_applied");
  assert.equal(response.errors.length, 3, response.errors.join(" | "));
  assert.match(response.errors[0], /no session with key "no-such-session"/);
  assert.match(response.errors[1], /needs week \(1–52\) and day/);
  assert.match(response.errors[2], /unknown op "shuffle"/);
  assert.equal(tools.planArtifacts([block.draftId]).length, 2);
  assert.equal(tools.planDraftDocument(latest.draftId).name, "Build block, shorter");
});

test("a revised plan is checked like a new one", async () => {
  const [, latest] = tools.planArtifacts([block.draftId]);
  const { response } = await revise({
    draft_id: latest.draftId,
    summary: "Broken tempo",
    ops: [
      {
        op: "replace_session",
        key: "tempo-thursday",
        workout: { name: "Broken tempo", sport: "run", steps: [{ kind: "training", target_type: "time" }] }
      }
    ]
  });
  assert.equal(response.ok, false);
  assert.equal(response.error_code, undefined, "refused by the validator, not by the operations");
  assert.ok(response.errors.length > 0, JSON.stringify(response));
  assert.equal(tools.planArtifacts([block.draftId]).length, 2);

  const mixed = await revise({
    draft_id: latest.draftId,
    summary: "Mixed placement",
    ops: [{ op: "move_session", key: "long-saturday", schedule_date: "20991004" }]
  });
  assert.equal(mixed.response.ok, false);
  assert.match(mixed.response.errors[0], /placed by week and day, not by date/);
});

test("a dated plan is moved by week and day from the Monday of its first session", async () => {
  // Wednesday 30 September 2099 and Friday 2 October: week 1 starts Monday 28 September.
  const dated = await draft("draft_training_plan", {
    name: "This week",
    workouts: [
      run("Easy Wednesday", 1800, { schedule_date: "20990930" }),
      run("Strides Friday", 1500, { schedule_date: "20991002" })
    ]
  });
  const { response } = await revise({
    draft_id: dated.draftId,
    summary: "Strides to Sunday of next week",
    ops: [{ op: "move_session", key: "strides-friday", week: 2, day: "sun" }]
  });
  assert.equal(response.ok, true, JSON.stringify(response));
  const plan = JSON.parse(database.getChatPlanDraft(response.draft_id).planJson);
  assert.deepEqual(
    plan.workouts.map((workout) => [workout.key, workout.schedule_date]),
    [["easy-wednesday", "20990930"], ["strides-friday", "20991011"]]
  );
});

test("a workout takes a whole new workout and keeps its day", async () => {
  const single = await draft("draft_workout", {
    workout: run("Hill repeats", 2400),
    calendar_date: "20991003"
  });
  const moved = await revise({
    draft_id: single.draftId,
    summary: "Move it",
    ops: [{ op: "move_session", key: "hill-repeats", schedule_date: "20991004" }]
  });
  assert.equal(moved.response.ok, false);
  assert.match(moved.response.errors[0], /only replace_session and rename/);

  const { response, card } = await revise({
    draft_id: single.draftId,
    summary: "Shorter hills",
    ops: [{ op: "replace_session", workout: run("Short hills", 1800) }]
  });
  assert.equal(response.ok, true, JSON.stringify(response));
  assert.equal(card.artifactType, "workout");
  assert.equal(card.entries[0].scheduleDate, "2099-10-03", "the day the coach suggested stays");
  const document = tools.planDraftDocument(response.draft_id);
  assert.equal(document.entries[0].workout.key, "hill-repeats");
  assert.equal(document.entries[0].workout.steps[0].target_duration_seconds, 1800);
});

test("a rewrite through draft_training_plan's revises is a version too", async () => {
  const [, latest] = tools.planArtifacts([block.draftId]);
  let card;
  const response = JSON.parse(
    await tools.handleChatWorkoutTool(
      "draft_training_plan",
      {
        name: "Build block, rewritten",
        revises: latest.draftId,
        workouts: [run("Only run", 3000, { week: 1, day: "wed" })]
      },
      { allowUpcomingWorkouts: false, onPlanDraft: (drafted) => { card = drafted; } }
    )
  );
  assert.equal(response.ok, true, JSON.stringify(response));
  assert.equal(response.version, 3);
  assert.equal(database.getChatPlanDraft(card.draftId).artifactId, block.draftId);
  assert.equal(database.getChatPlanDraft(card.draftId).changeSummary, "Rewritten by Coach.");
});

test("a saved plan is revised into a new version, which is not saved (P1.6)", async () => {
  const saved = await draft("draft_training_plan", {
    name: "Saved block",
    workouts: [run("One run", 1800, { week: 1, day: "mon" })]
  });
  database.markChatPlanDraftUploaded(saved.draftId, Date.now());
  const { response } = await revise({
    draft_id: saved.draftId,
    summary: "Rename",
    ops: [{ op: "rename", name: "Renamed" }]
  });
  assert.equal(response.ok, true, JSON.stringify(response));
  assert.equal(database.getChatPlanDraft(response.draft_id).uploadedAt, undefined);
  assert.ok(database.getChatPlanDraft(saved.draftId).uploadedAt, "the saved version stays saved");
});

test("get_plan_draft reads the newest version, whichever id it is given (P1.3)", async () => {
  const read = async (args) =>
    JSON.parse(await tools.handleChatWorkoutTool("get_plan_draft", args, { allowUpcomingWorkouts: false }));
  const newest = await read({ draft_id: block.draftId });
  assert.equal(newest.ok, true, JSON.stringify(newest));
  assert.equal(newest.version, 3, "asked by version 1's id, it answers with the newest");
  assert.equal(newest.newest, undefined);
  assert.equal(newest.made_by, "you");
  assert.equal(newest.change, "Rewritten by Coach.");
  assert.deepEqual(newest.sessions.map((line) => line.split(" — ")[0]), ["only-run · week 1 wed · run · Only run"]);
  assert.equal(newest.workouts, undefined, "whole workouts only when asked");

  const older = await read({ draft_id: block.draftId, version: 2, sessions: ["tempo-thursday"] });
  assert.equal(older.version, 2);
  assert.deepEqual(older.newest.version, 3, "an older version says which is newest");
  assert.deepEqual(older.week_stages, [{ week: 1, stage: "base" }, { week: 2, stage: "build" }]);
  assert.equal(older.workouts.length, 1);
  assert.equal(older.workouts[0].steps[0].target_duration_seconds, 2100, "a named session comes whole");

  const missing = await read({ draft_id: block.draftId, version: 9 });
  assert.equal(missing.error_code, "version_not_found");
  assert.equal((await read({ draft_id: "nope" })).error_code, "draft_not_found");
});

test("planDiff states each change once, in reading order (P1.4)", async () => {
  const { planDiff, changeCount } = await import(distUrl("planDiff.js"));
  const [first, second] = tools.planArtifacts([block.draftId]);
  const changes = planDiff(tools.planDraftDocument(first.draftId), tools.planDraftDocument(second.draftId));
  assert.deepEqual(
    changes.map((change) => change.text),
    [
      'Renamed to "Build block, shorter"',
      "Tempo Thursday is now Short tempo",
      "Added Easy Tuesday (week 2 Tue)",
      "Moved Long Saturday: week 2 Sat → week 2 Sun",
      "Removed Easy Monday (week 1 Mon)",
      "Week 2: Not Set → Build"
    ]
  );
  assert.equal(changeCount(changes), "6 changes");
  const same = tools.planDraftDocument(first.draftId);
  assert.deepEqual(planDiff(same, structuredClone(same)), [], "a copy is no change");
});

test("restoring an older version makes a new one with its content (P1.4)", () => {
  const [first, second] = tools.planArtifacts([block.draftId]);
  const restored = tools.restorePlanDraftVersion(first.draftId, "metric");
  assert.equal(restored.toVersion, 4);
  assert.equal(restored.fromVersion, 3);
  assert.equal("source" in restored.preview.entries[0], false, "a light card");
  const row = database.getChatPlanDraft(restored.preview.draftId);
  assert.equal(row.author, "athlete");
  assert.equal(row.parentDraftId, tools.planArtifacts([block.draftId])[2].draftId);
  assert.equal(row.changeSummary, "Restored version 1");
  assert.equal(tools.planDraftDocument(restored.preview.draftId).name, "Build block");
  assert.ok(restored.changes.includes('Renamed to "Build block"'), restored.changes.join(" | "));
  assert.throws(() => tools.restorePlanDraftVersion(restored.preview.draftId), /already the newest/);
  assert.ok(second);
});

test("a Coach plan's conversation is found from any of its versions (P1.7)", () => {
  const ids = tools.planArtifacts([block.draftId]).map((item) => item.draftId);
  const session = history.createChatSession("claude-code");
  history.saveChatSession(session.id, [
    { kind: "message", role: "user", content: "Write me a block" },
    { kind: "planDraft", draft: { ...block, entries: [] } }
  ]);
  assert.equal(tools.chatSessionForDraft(block.draftId), session.id, "by the draft its card carries");
  assert.equal(tools.chatSessionForDraft(ids.at(-1)), session.id, "and by a later version's, the one a saved plan names");
  assert.equal(tools.chatSessionForDraft("nowhere"), undefined);
});

test("removing a creation lets every version go", () => {
  const ids = tools.planArtifacts([block.draftId]).map((item) => item.draftId);
  assert.equal(ids.length, 4);
  tools.discardPlanDraft(ids[ids.length - 1]);
  for (const id of ids) {
    assert.equal(database.getChatPlanDraft(id), undefined, `${id} is gone`);
  }
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
