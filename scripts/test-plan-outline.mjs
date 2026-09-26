// A brief's outline and its sessions in the conversation
// (docs/coach-plan-canvas.md, P2.2–P2.3). What the suite holds down:
//
//   * "Draw the outline" is a turn of the conversation: the brief is its
//     request, the outline tool is checked inside the turn, and an accepted
//     outline is written to the brief's artifact and announced as a
//     `planOutline` anchor. It runs here under HERACLES_SIMULATE_PLAN_AI, so
//     the real tool, check and store run with a script in the model's place.
//   * A redraw is the outline's next version; a turn that has its outline
//     accepted twice rewrites its own version rather than counting two.
//   * A step that cannot run — no brief, a brief still missing what an
//     outline needs, a brief that became a plan — rejects before anything is
//     streamed, which is what the renderer undoes a failed send on.
//   * The athlete's adjustment asks no model: the outline tool's own checks
//     refuse what breaks the brief, and a save is the next version, by them.
//   * The transcript holds only the anchor, which survives a save and the
//     renderer's round trip; the card is drawn at an artifact's latest anchor.
//   * Coach's index says what outline a brief has, and who made it.
//   * "Write the sessions" is a turn too, bound to the outline: the check
//     hands a draft that breaks it back inside the turn, and the one it
//     accepts is written to `chat_plan_drafts` as version 1 of the brief's
//     artifact, dated from the brief's first Monday. From then on the brief
//     and its outline are changed through the plan, and the sessions are not
//     written twice.
//   * A step's wire is its prompt and the six messages before it, never the
//     whole conversation or its summary (P2.4).
//
// Usage:
//   npm run test:plan-outline
//
// Runs under Electron for the better-sqlite3 ABI, with strip-types and the
// resolver hook for the renderer's `planOutlineModel.ts`.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

process.env.HERACLES_SIMULATE_PLAN_AI = "1";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distUrl = (file) =>
  `${pathToFileURL(path.join(repoRoot, "dist-electron", file)).href}?cacheBust=${Date.now()}`;

const database = await import(distUrl("database.js"));
const brief = await import(distUrl("planBrief.js"));
const briefs = await import(distUrl("chatPlanBriefs.js"));
const history = await import(distUrl("chatHistoryStore.js"));
const chat = await import(distUrl("chatService.js"));
const compaction = await import(distUrl("chatContextCompaction.js"));
const generation = await import(distUrl("trainingPlanGeneration.js"));
const model = await import(pathToFileURL(path.join(repoRoot, "src/chat/planOutlineModel.ts")).href);
const chatTypes = await import(pathToFileURL(path.join(repoRoot, "src/chat/chatTypes.ts")).href);
const stepRun = await import(pathToFileURL(path.join(repoRoot, "src/chat/stepRun.ts")).href);
const runTrail = await import(pathToFileURL(path.join(repoRoot, "src/training-library/runTrail.ts")).href);

database.initializeDatabase(fs.mkdtempSync(path.join(os.tmpdir(), "plan-outline-")));

const cases = [];
const test = (name, run) => cases.push([name, run]);

// A Monday well ahead of any clock this runs under.
const MONDAY = "2031-03-03";
const TODAY = new Date(2031, 1, 26, 9);

/**
 * A brief an outline can be drawn from: a six-week base block on the form's
 * usual week. On the real clock, because the turn checks the brief against
 * today as the generator does, and a plan must start within a year.
 */
function readyBrief(sessionId) {
  const made = JSON.parse(
    briefs.handleRequestPlanBrief(
      { goal_kind: "base", weeks: 6, sports: ["run"], level: "intermediate", start_date: generation.firstPlanMonday(new Date()) },
      sessionId,
      undefined,
      new Date()
    )
  );
  assert.deepEqual(made.still_open, [], "the fixture brief is complete");
  return made.brief_id;
}

/** A sink that keeps what a turn streams, as the window would receive it. */
function recordingSink() {
  const events = [];
  return { events, sink: { emit: (channel, payload) => events.push({ channel, payload }) } };
}

const outlinesOf = (events) =>
  events.filter((event) => event.channel === "chat:streamInfo" && event.payload.kind === "planOutline");

test("Draw the outline: a turn that writes the outline to the brief and anchors it", async () => {
  const session = history.createChatSession("claude-code");
  const artifactId = readyBrief(session.id);
  const { events, sink } = recordingSink();
  await chat.streamConversationTurn(
    sink,
    "req-outline-1",
    [{ role: "user", content: "Draw the outline" }],
    "metric",
    session.id,
    { step: "outline", artifactId }
  );
  const done = events.find((event) => event.channel === "chat:streamDone");
  assert.ok(done, "the turn finished");
  assert.equal(done.payload.finishReason, "stop");
  const announced = outlinesOf(events);
  assert.equal(announced.length, 1);
  assert.equal(announced[0].payload.brief.artifactId, artifactId);
  const stored = briefs.planBriefOf(artifactId);
  assert.equal(stored.outline.version, 1);
  assert.equal(stored.outline.author, "coach");
  assert.equal(stored.outline.outline.weeks.length, 6, "the brief's length");
  assert.deepEqual(model.outlineProblems(stored.outline.outline, stored), [], "the accepted outline fits its brief");
  assert.ok(
    events.some((event) => event.channel === "chat:streamInfo" && event.payload.tool === "propose_plan_outline"),
    "the outline tool was called inside the turn"
  );
});

test("a redraw is the next version, and the note reaches the turn", async () => {
  const session = history.createChatSession("claude-code");
  const artifactId = readyBrief(session.id);
  const turn = (requestId, note) =>
    chat.streamConversationTurn(
      recordingSink().sink,
      requestId,
      [{ role: "user", content: model.outlineStepText(note) }],
      "metric",
      session.id,
      { step: "outline", artifactId, ...(note ? { note } : {}) }
    );
  await turn("req-redraw-1");
  await turn("req-redraw-2", "a lighter week 5");
  const stored = briefs.planBriefOf(artifactId);
  assert.equal(stored.outline.version, 2);
  assert.match(stored.outline.outline.summary, /a lighter week 5/, "the simulated turn saw the revision's note");
});

test("an outline accepted twice in one turn keeps one version", () => {
  const artifactId = readyBrief("s-twice");
  assert.equal(briefs.planBriefOf(artifactId).outline, undefined, "no outline yet");
  const first = briefs.savePlanOutline(artifactId, sampleOutline(6), "coach");
  const again = briefs.savePlanOutline(artifactId, sampleOutline(6, 4), "coach", first.outline.version);
  assert.equal(again.outline.version, 1, "the same turn rewrote its own version");
  assert.equal(again.outline.outline.weeks[0].hours, 4);
  const next = briefs.savePlanOutline(artifactId, sampleOutline(6), "coach");
  assert.equal(next.outline.version, 2);
});

test("a step that cannot run rejects before anything streams", async () => {
  const { events, sink } = recordingSink();
  await assert.rejects(
    chat.streamConversationTurn(sink, "req-none", [{ role: "user", content: "Draw the outline" }], "metric", "s", {
      step: "outline",
      artifactId: "no-such-brief"
    }),
    /no longer in this conversation/
  );
  const open = JSON.parse(briefs.handleRequestPlanBrief({ goal_kind: "race" }, "s-open", undefined, TODAY));
  await assert.rejects(
    chat.streamConversationTurn(sink, "req-open", [{ role: "user", content: "Draw the outline" }], "metric", "s-open", {
      step: "outline",
      artifactId: open.brief_id
    }),
    /race day/i
  );
  assert.equal(events.length, 0, "nothing reached the window");
});

test("a brief that has become a plan has no outline to draw or adjust", async () => {
  const artifactId = readyBrief("s-plan");
  briefs.savePlanOutline(artifactId, sampleOutline(6), "coach");
  database.saveChatPlanDraft({
    draftId: "outline-plan-v1",
    planJson: JSON.stringify({ name: "Base", entries: [] }),
    previewJson: JSON.stringify({ draftId: "outline-plan-v1", artifactType: "plan", name: "Base", summary: "", entries: [], conflicts: [], warnings: [] }),
    createdAt: Date.now(),
    artifactId,
    version: 1,
    author: "coach"
  });
  await assert.rejects(
    chat.streamConversationTurn(recordingSink().sink, "req-plan", [], "metric", "s-plan", { step: "outline", artifactId }),
    /become a plan/
  );
  assert.throws(() => briefs.updatePlanOutline(artifactId, sampleOutline(6)), /become a plan/);
});

test("the athlete's adjustment: checked as the tool checks, saved as their version", () => {
  const artifactId = readyBrief("s-adjust");
  assert.throws(() => briefs.updatePlanOutline(artifactId, sampleOutline(6)), /no outline yet/);
  briefs.savePlanOutline(artifactId, sampleOutline(6), "coach");
  const current = briefs.planBriefOf(artifactId);

  const tooShort = { ...current.outline.outline, weeks: current.outline.outline.weeks.slice(0, 5) };
  assert.throws(() => briefs.updatePlanOutline(artifactId, tooShort), /5 weeks; the plan runs 6 weeks/);
  const crowded = model.withOutlineWeek(current.outline.outline, 2, { sessions: 9 });
  assert.deepEqual(
    model.outlineProblems(crowded, current),
    ["Week 3 has 9 sessions; the athlete's week holds exactly 5."],
    "the screen says what the save would refuse"
  );
  assert.throws(() => briefs.updatePlanOutline(artifactId, crowded), /Week 3 has 9 sessions/);
  assert.throws(() => briefs.updatePlanOutline(artifactId, { weeks: "all of them" }), /could not be read/);

  const lighter = model.withOutlineWeek(current.outline.outline, 3, { stage: 2, lighter: true, hours: 3.25 });
  assert.equal(lighter.weeks[3].hours, 3.3, "hours keep one decimal, as the tool keeps them");
  const saved = briefs.updatePlanOutline(artifactId, lighter);
  assert.equal(saved.outline.version, 2);
  assert.equal(saved.outline.author, "athlete");
  assert.equal(saved.outline.outline.weeks[3].lighter, true);
  assert.equal(saved.request.goalKind, "base", "the brief is untouched");
});

test("editing figures: what is not a figure leaves the week as it was", () => {
  const outline = sampleOutline(3);
  assert.deepEqual(model.withOutlineWeek(outline, 1, { hours: Number.NaN, sessions: -1 }), outline);
  assert.equal(model.outlineChanged(outline, model.withOutlineWeek(outline, 1, { hours: Number.NaN })), false);
  assert.equal(model.outlineChanged(outline, model.withOutlineWeek(outline, 1, { lighter: true })), true);
});

test("the card's figures", () => {
  const outline = sampleOutline(4);
  outline.weeks[1].hours = 6;
  outline.weeks[3] = { ...outline.weeks[3], stage: 3, sessions: 4 };
  assert.equal(model.outlineSpan(outline), "4 weeks · 5–6 h a week · 4–5 sessions");
  assert.deepEqual(model.outlineStageBands(outline), [
    { stage: 2, start: 0, span: 3 },
    { stage: 3, start: 3, span: 1 }
  ]);
  assert.equal(model.outlineStepText(), "Draw the outline");
  assert.equal(model.outlineStepText("  fewer long runs "), "Redraw the outline: fewer long runs");
});

test("the transcript holds only the anchor, through a save and the renderer", () => {
  const session = history.createChatSession("claude-code");
  const entries = [
    { kind: "planBrief", artifactId: "a-1" },
    { kind: "message", role: "user", content: "Draw the outline" },
    { kind: "planOutline", artifactId: "a-1", outlineVersion: 1 },
    { kind: "message", role: "user", content: "Redraw the outline: shorter" },
    { kind: "planOutline", artifactId: "a-1", outlineVersion: 2 }
  ];
  history.saveChatSession(session.id, entries);
  const read = history.getChatSession(session.id);
  assert.deepEqual(
    read.filter((entry) => entry.kind === "planOutline").map((entry) => [entry.artifactId, entry.outlineVersion]),
    [["a-1", 1], ["a-1", 2]]
  );
  const back = chatTypes.toPersistedEntries(chatTypes.fromPersistedEntries(read));
  assert.deepEqual(
    back.filter((entry) => entry.kind === "planOutline").map((entry) => [entry.artifactId, entry.outlineVersion]),
    [["a-1", 1], ["a-1", 2]]
  );
  assert.equal(
    history.parseChatTranscriptJson(JSON.stringify([{ kind: "planOutline", artifactId: "a-1" }])).length,
    0,
    "no version, no anchor"
  );
  assert.deepEqual([...model.latestOutlineAnchors(back)], [["a-1", 4]], "the card is drawn at the latest anchor");
});

test("Coach's index says what outline a brief has, and who made it", () => {
  const request = brief.defaultPlanBriefRequest(MONDAY);
  const entries = [{ kind: "planBrief", artifactId: "b-1" }];
  const withOutline = (author, version) =>
    compaction.creationIndex(entries, [], [
      {
        artifactId: "b-1",
        request,
        origins: {},
        outline: { outline: sampleOutline(6), version, author, updatedAt: "" },
        createdAt: "",
        updatedAt: ""
      }
    ]);
  assert.match(withOutline("coach", 1), /· outline v1: 6 weeks, 5 h a week$/);
  assert.match(withOutline("athlete", 3), /· outline v3: 6 weeks, 5 h a week, adjusted by the athlete$/);
});

// ---------------------------------------------------------------------------
// P2.3: the sessions, written to the outline as the brief's first version
// ---------------------------------------------------------------------------

/** A brief with an outline Coach drew, as the card shows it before Write the sessions. */
async function outlinedBrief(sessionId) {
  const artifactId = readyBrief(sessionId);
  await chat.streamConversationTurn(
    recordingSink().sink,
    `req-outline-${artifactId}`,
    [{ role: "user", content: "Draw the outline" }],
    "metric",
    sessionId,
    { step: "outline", artifactId }
  );
  assert.ok(briefs.planBriefOf(artifactId).outline, "the fixture has its outline");
  return artifactId;
}

test("Write the sessions: the plan is the brief's first version, checked against the outline", async () => {
  const session = history.createChatSession("claude-code");
  const artifactId = await outlinedBrief(session.id);
  const { events, sink } = recordingSink();
  await chat.streamConversationTurn(
    sink,
    "req-sessions-1",
    [{ role: "user", content: "Write the sessions" }],
    "metric",
    session.id,
    { step: "sessions", artifactId }
  );
  assert.equal(events.find((event) => event.channel === "chat:streamDone")?.payload.finishReason, "stop");
  const handOvers = events.filter(
    (event) => event.channel === "chat:streamInfo" && event.payload.tool === "draft_training_plan"
  );
  assert.ok(handOvers.length >= 2, "the simulated first draft is a session short, and the check sent it back");
  const cards = events.filter((event) => event.channel === "chat:streamInfo" && event.payload.kind === "planDraft");
  assert.equal(cards.length, 1, "one card, for the draft the check accepted");

  const versions = database.listChatPlanDraftVersions(artifactId);
  assert.equal(versions.length, 1, "written to chat_plan_drafts, not held in memory");
  assert.equal(versions[0].version, 1);
  assert.equal(versions[0].author, "coach");
  assert.equal(versions[0].draftId, cards[0].payload.draft.draftId);
  const plan = JSON.parse(versions[0].planJson);
  const outline = briefs.planBriefOf(artifactId).outline.outline;
  assert.equal(plan.weekStages?.length ?? outline.weeks.length, outline.weeks.length, "a stage a week, the outline's");
  const monday = briefs.planBriefOf(artifactId).request.startDate.replace(/-/g, "");
  assert.ok(plan.workouts.length >= outline.weeks.length, "sessions in every week");
  assert.ok(
    plan.workouts.every((workout) => workout.schedule_date >= monday),
    "dated from the brief's first Monday, so the canvas and the calendar read real days"
  );

  const index = compaction.creationIndex(
    [{ kind: "planBrief", artifactId }, { kind: "planDraft", draft: cards[0].payload.draft }],
    chat.listPlanArtifactVersions([cards[0].payload.draft.draftId]),
    [briefs.planBriefOf(artifactId)]
  );
  assert.match(index, /- Plan "/, "Coach's index lists the plan");
  assert.doesNotMatch(index, /- Brief ·/, "and no longer the brief it came from");
});

test("the sessions wait for an outline, and a written plan is changed through the plan", async () => {
  const session = history.createChatSession("claude-code");
  const bare = readyBrief(session.id);
  const send = (requestId, step, artifactId) =>
    chat.streamConversationTurn(recordingSink().sink, requestId, [{ role: "user", content: "go" }], "metric", session.id, {
      step,
      artifactId
    });
  await assert.rejects(send("req-no-outline", "sessions", bare), /Draw the outline first/);

  const artifactId = await outlinedBrief(session.id);
  await send("req-sessions-once", "sessions", artifactId);
  await assert.rejects(send("req-sessions-twice", "sessions", artifactId), /become a plan/);
  await assert.rejects(send("req-redraw-after", "outline", artifactId), /become a plan/);
  assert.equal(database.listChatPlanDraftVersions(artifactId).length, 1);
});

test("an outline that no longer fits its brief is fixed before the sessions are written", async () => {
  const session = history.createChatSession("claude-code");
  const artifactId = await outlinedBrief(session.id);
  const current = briefs.planBriefOf(artifactId);
  briefs.updatePlanBrief(artifactId, { ...current.request, weeks: 8 });
  await assert.rejects(
    chat.streamConversationTurn(recordingSink().sink, "req-stale", [], "metric", session.id, { step: "sessions", artifactId }),
    /no longer fits the brief: The outline has 6 weeks; the plan runs 8 weeks/
  );
});

test("the step's trail: reads, the hand-over, the check sent back, the check passed", () => {
  let run = { requestId: "r", step: "sessions", notes: runTrail.EMPTY_NOTES, attempts: 0 };
  run = stepRun.stepRunEvent(run, { kind: "snapshot" });
  run = stepRun.stepRunEvent(run, { kind: "call", tool: "get_training_zones" });
  run = stepRun.stepRunEvent(run, { kind: "thinking", delta: "**Weighing the long run**\nLonger each week." });
  run = stepRun.stepRunEvent(run, { kind: "call", tool: "draft_training_plan" });
  run = stepRun.stepRunEvent(run, { kind: "call", tool: "draft_training_plan" });
  run = stepRun.stepRunEvent(run, { kind: "passed" });
  assert.equal(run.attempts, 2);
  assert.deepEqual(run.notes.trail.map((item) => item.done), [
    "Read your training snapshot",
    "Read your training zones",
    "Weighing the long run",
    "Handed the sessions to the check",
    "The check sent it back",
    "Fixed the sessions",
    "Every week passed the check"
  ]);
  const outline = stepRun.stepRunEvent(
    { requestId: "r", step: "outline", notes: runTrail.EMPTY_NOTES, attempts: 0 },
    { kind: "call", tool: "propose_plan_outline" }
  );
  assert.equal(outline.notes.trail[0].done, "Handed the outline to the check", "each step hands over its own tool");
});

test("a step's wire: the last six messages and the step's prompt, no summary, no index (P2.4)", () => {
  const history = [
    compaction.summaryContextMessage("Long ago the athlete ran a marathon."),
    ...Array.from({ length: 10 }, (_, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      content: `message ${index + 1}`
    })),
    { role: "user", content: "Draw the outline\n\n[What you have made in this conversation…]" }
  ];
  const wire = compaction.pipelineWire(history, "OUTLINE PROMPT");
  assert.deepEqual(
    wire.map((message) => message.content),
    ["message 5", "message 6", "message 7", "message 8", "message 9", "message 10", "OUTLINE PROMPT"],
    "a fixed tail, whatever the conversation's length"
  );
  assert.equal(wire[0].role, "user");
  const odd = compaction.pipelineWire(history.slice(0, -2).concat([history.at(-1)]), "P");
  assert.equal(odd[0].role, "user", "a tail that would open on Coach's answer starts at the next question");
  assert.ok(odd.length <= compaction.PIPELINE_RECENT_MESSAGES + 1);
  assert.deepEqual(
    compaction.pipelineWire([compaction.summaryContextMessage("x"), { role: "user", content: "go" }], "P"),
    [{ role: "user", content: "P" }],
    "the summary a compacted conversation opens with is not carried"
  );
});

/** An outline of `weeks` base weeks, five sessions and `hours` a week, with no key sessions. */
function sampleOutline(weeks, hours = 5) {
  return {
    summary: "Base.",
    basis: "Read nothing.",
    weeks: Array.from({ length: weeks }, () => ({
      stage: 2,
      lighter: false,
      hours,
      sessions: 5,
      focus: "Aerobic base.",
      keySessions: []
    }))
  };
}

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
console.log(`plan outline tests passed (${cases.length})`);
process.exit(0);
