// A turn of a conversation — the athlete's question and everything Coach
// answered it with — deleted or asked again (chatTurnService.ts, chatTurns.ts).
//
// What is held down:
//
//   * A turn runs from the references in front of its question to the next
//     question; deleting it takes its words and charts and leaves a plan
//     event, a brief, an outline and an entry a newer build wrote.
//   * What the turn made stays (its cards with it) unless the athlete deletes
//     it too, and then only what can go: nothing saved to COROS — a proposal
//     with a line applied included — and no creation with a version in
//     another turn. A creation deleted takes the events and references that
//     name it; a card the athlete removed stays while its drafts do.
//   * Every position-held boundary moves with the entries: the summary's
//     `through` and the condensed layer's start. A summary left covering
//     nothing Coach may read is dropped; one asked to be rewritten is written
//     from the turns it now covers, and announced to sync.
//   * The window names the turn by its question's identity where it has one,
//     and otherwise by position and words: a turn found only by its words is
//     used when they are unique, refused when they are not; one whose identity
//     is gone is refused whatever its words.
//   * Asking again is the last turn only; the question keeps its identity,
//     its answer and what the answer made go.
//   * A hidden turn stays in the row and out of what Coach reads — an
//     analysis, the summariser, recall — with every position kept; asking it
//     again shows it, and deleting it or its conversation forgets it.
//   * A branch is a conversation of its own holding this one up to a turn:
//     its entries minted afresh, what Coach made left where it was made, the
//     same AI and sources, the summary when it covers nothing past the branch
//     point, and the same turns hidden.
//   * A failed turn's row is sorted by what the athlete can do about it, and
//     a recent question with no answer may still be answered elsewhere.
//
// Usage:
//   npm run test:chat-turn-actions
//
// Runs under Electron for the better-sqlite3 ABI, with type stripping for the
// renderer's `turnFailure.ts`.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distUrl = (file) =>
  `${pathToFileURL(path.join(repoRoot, "dist-electron", file)).href}?cacheBust=${Date.now()}`;

const databaseModule = await import(distUrl("database.js"));
const history = await import(distUrl("chatHistoryStore.js"));
const context = await import(distUrl("chatContextService.js"));
const turns = await import(distUrl("chatTurns.js"));
const service = await import(distUrl("chatTurnService.js"));
const hiddenModule = await import(distUrl("chatHiddenTurns.js"));
const chatService = await import(distUrl("chatService.js"));
const syncBridge = await import(distUrl("sync/syncBridge.js"));
const { HlcClock, formatHlc } = await import(distUrl("sync/hlc.js"));
const failure = await import(pathToFileURL(path.join(repoRoot, "src/chat/turnFailure.ts")).href);

databaseModule.initializeDatabase(fs.mkdtempSync(path.join(os.tmpdir(), "chat-turn-actions-")));

const cases = [];
const test = (name, run) => cases.push([name, run]);

const user = (content) => ({ kind: "message", role: "user", content });
const coach = (content) => ({ kind: "message", role: "assistant", content });
const draftCard = (draftId, name = `Plan ${draftId}`) => ({
  kind: "planDraft",
  draft: { draftId, name, summary: "", entries: [], conflicts: [], warnings: [] }
});
const changesCard = (changeSetId) => ({ kind: "scheduleChange", changeSetId });

function saveDraft(draftId, artifactId, version, uploadedAt) {
  databaseModule.saveChatPlanDraft({
    draftId,
    planJson: "{}",
    previewJson: JSON.stringify({ draftId, name: `Plan ${draftId}`, summary: "", entries: [], conflicts: [], warnings: [] }),
    createdAt: Date.UTC(2027, 0, version),
    ...(uploadedAt ? { uploadedAt } : {}),
    artifactId,
    version,
    author: "coach"
  });
}

function saveChanges(changeSetId, sessionId, lines = []) {
  const now = new Date().toISOString();
  databaseModule.saveChatScheduleChange({
    changeSetId,
    sessionId,
    summary: "Move Thursday",
    linesJson: JSON.stringify(lines),
    createdAt: now,
    updatedAt: now
  });
}

function conversation(entries) {
  const created = history.createChatSession("claude-api");
  history.saveChatSession(created.id, entries);
  return created.id;
}

const contents = (sessionId) =>
  history
    .getChatSession(sessionId)
    .map((entry) => (entry.kind === "message" ? entry.content : `${entry.kind}:${entry.draft?.draftId ?? entry.changeSetId ?? ""}`));

const noRoll = {
  rollSummary: async () => {
    throw new Error("no summary should be rewritten here");
  }
};

// --- the turns ------------------------------------------------------------------

test("a turn starts at the references in front of its question and ends at the next one", () => {
  const entries = [
    { kind: "planBrief" },
    user("Q1"),
    coach("A1"),
    { kind: "planRefs" },
    { kind: "scheduleRefs" },
    user("Q2"),
    coach("A2"),
    { kind: "planEvent" }
  ];
  assert.deepEqual(turns.turnRanges(entries), [
    { start: 1, question: 1, end: 3 },
    { start: 3, question: 5, end: 8 }
  ]);
  assert.equal(turns.turnRanges(entries)[0].start, 1, "an entry before the first question is in no turn");
  assert.deepEqual(
    turns.turnRemoval(entries, turns.turnRanges(entries)[1]),
    [3, 4, 5, 6],
    "the plan event stays"
  );
  assert.equal(turns.shiftBoundary(6, [3, 4, 5, 6]), 3);
});

test("hiding masks the words of a turn and keeps every position", () => {
  const entries = [user("Q1"), coach("A1"), { ...user("Q2"), mid: "m2" }, draftCard("x"), coach("A2")];
  const masked = turns.maskHiddenTurns(entries, new Set(["m2"]), () => turns.HIDDEN_TURN_PLACEHOLDER);
  assert.equal(masked.length, entries.length);
  assert.deepEqual(
    masked.map((entry) => entry.kind),
    ["message", "message", "opaque", "planDraft", "opaque"],
    "the card is not sent anyway, so it is left for the creation index"
  );
});

// --- deleting -------------------------------------------------------------------

function richConversation() {
  saveDraft("d-1", "art-1", 1);
  saveDraft("a-1", "art-A", 1);
  saveDraft("a-2", "art-A", 2);
  const sessionId = conversation([
    user("Q1"),
    coach("A1"),
    user("Q2"),
    draftCard("d-1"),
    draftCard("a-1"),
    coach("A2"),
    user("Q3"),
    changesCard("cs-1"),
    draftCard("a-2"),
    coach("A3"),
    user("Q4"),
    coach("A4")
  ]);
  saveChanges("cs-1", sessionId);
  return sessionId;
}

test("the question before a delete names what the turn made and whether the summary speaks for it", () => {
  const sessionId = richConversation();
  context.writeSessionSummary(sessionId, "Summary of Q1 and Q2", 6);
  const described = service.describeTurn(sessionId, { index: 2, content: "Q2" });
  assert.equal(described.summarised, true);
  assert.deepEqual(
    described.creations.map(({ name, deletable, keptBecause }) => ({ name, deletable, keptBecause })),
    [
      { name: "Plan d-1", deletable: true, keptBecause: undefined },
      { name: "Plan a-1", deletable: false, keptBecause: "versions" }
    ]
  );
  assert.equal(service.describeTurn(sessionId, { index: 10, content: "Q4" }).summarised, false);
});

test("a deleted turn keeps what it made unless the athlete deletes that too", async () => {
  const sessionId = richConversation();
  await service.deleteTurn(sessionId, { index: 2, content: "Q2" }, { deleteCreations: false, rewriteSummary: false }, noRoll);
  assert.deepEqual(contents(sessionId), [
    "Q1", "A1", "planDraft:d-1", "planDraft:a-1", "Q3", "scheduleChange:cs-1", "planDraft:a-2", "A3", "Q4", "A4"
  ]);
  assert.ok(databaseModule.getChatPlanDraft("d-1"), "the draft stays with its card");
});

test("deleting what a turn made takes only what can go", async () => {
  const sessionId = richConversation();
  await service.deleteTurn(sessionId, { index: 2, content: "Q2" }, { deleteCreations: true, rewriteSummary: false }, noRoll);
  assert.deepEqual(contents(sessionId), ["Q1", "A1", "planDraft:a-1", "Q3", "scheduleChange:cs-1", "planDraft:a-2", "A3", "Q4", "A4"]);
  assert.equal(databaseModule.getChatPlanDraft("d-1"), undefined, "an unsaved creation of this turn goes");
  assert.ok(databaseModule.getChatPlanDraft("a-1"), "one with a version in another turn stays, card and all");

  saveDraft("s-1", "art-S", 1, Date.now());
  const saved = conversation([user("Make a plan"), draftCard("s-1"), coach("Here it is")]);
  await service.deleteTurn(saved, { index: 0, content: "Make a plan" }, { deleteCreations: true, rewriteSummary: false }, noRoll);
  assert.deepEqual(contents(saved), ["planDraft:s-1"], "a saved creation is never deleted from a turn");
  assert.ok(databaseModule.getChatPlanDraft("s-1"));

  const changes = richConversation();
  await service.deleteTurn(changes, { index: 6, content: "Q3" }, { deleteCreations: true, rewriteSummary: false }, noRoll);
  assert.deepEqual(databaseModule.getChatScheduleChanges(["cs-1"]), [], "a proposal goes with its turn");

  const applied = conversation([user("Move my week"), changesCard("cs-applied"), coach("Moved")]);
  saveChanges("cs-applied", applied, [{ lineId: "l1", status: "applied" }, { lineId: "l2", status: "proposed" }]);
  const described = service.describeTurn(applied, { index: 0, content: "Move my week" });
  assert.deepEqual(
    described.creations.map(({ deletable, keptBecause }) => ({ deletable, keptBecause })),
    [{ deletable: false, keptBecause: "saved" }],
    "a line of it is on COROS"
  );
  await service.deleteTurn(applied, { index: 0, content: "Move my week" }, { deleteCreations: true, rewriteSummary: false }, noRoll);
  assert.deepEqual(contents(applied), ["scheduleChange:cs-applied"]);
  assert.equal(databaseModule.getChatScheduleChanges(["cs-applied"]).length, 1, "and the proposal stays to say so");
});

test("a creation deleted with its turn takes the events and references that name it", async () => {
  saveDraft("e-1", "art-E", 1);
  saveDraft("e-2", "art-E", 2);
  saveDraft("k-1", "art-K", 1);
  const ref = (artifactId, draftId) => ({ artifactId, draftId, name: "Plan", artifactType: "plan", scope: "plan", label: "Plan" });
  const sessionId = conversation([
    user("Make a plan"),
    draftCard("e-1"),
    draftCard("e-2"),
    {
      kind: "planEvent",
      event: { eventId: "ev-1", artifactId: "art-E", draftId: "e-2", action: "edited", author: "athlete", name: "Plan", artifactType: "plan", at: 1 }
    },
    coach("Here it is"),
    { kind: "planRefs", refs: [ref("art-E", "e-2")] },
    user("Is week 2 too much?"),
    coach("No"),
    { kind: "planRefs", refs: [ref("art-E", "e-2"), ref("art-K", "k-1")] },
    user("Compare them"),
    coach("Done")
  ]);
  await service.deleteTurn(sessionId, { index: 0, content: "Make a plan" }, { deleteCreations: true, rewriteSummary: false }, noRoll);
  assert.deepEqual(contents(sessionId), ["Is week 2 too much?", "No", "planRefs:", "Compare them", "Done"]);
  assert.deepEqual(
    history.getChatSession(sessionId)[2].refs.map((kept) => kept.artifactId),
    ["art-K"],
    "a question about two creations keeps the one that is left"
  );
});

test("a card the athlete removed stays with the drafts it records", async () => {
  saveDraft("r-1", "art-R", 1, Date.now());
  const removed = { ...draftCard("r-1"), draft: { ...draftCard("r-1").draft, removedAt: Date.now() } };
  const sessionId = conversation([user("Make a plan"), removed, coach("Here it is"), user("Q2"), coach("A2")]);
  await service.deleteTurn(sessionId, { index: 0, content: "Make a plan" }, { deleteCreations: true, rewriteSummary: false }, noRoll);
  assert.deepEqual(contents(sessionId), ["planDraft:r-1", "Q2", "A2"]);
  chatService.deleteChatSessionById(sessionId);
  assert.equal(databaseModule.getChatPlanDraft("r-1"), undefined, "deleting the conversation still finds them");

  // Unsaved, removing it deleted the drafts already, and the card has nothing to record.
  const gone = { ...draftCard("r-2"), draft: { ...draftCard("r-2").draft, removedAt: Date.now() } };
  const unsaved = conversation([user("Make a plan"), gone, coach("Here it is")]);
  await service.deleteTurn(unsaved, { index: 0, content: "Make a plan" }, { deleteCreations: false, rewriteSummary: false }, noRoll);
  assert.deepEqual(contents(unsaved), []);
});

test("the summary's boundaries move with the entries, and a summary left covering nothing goes", async () => {
  const sessionId = richConversation();
  context.writeSessionSummary(sessionId, "Summary", 6);
  context.writeCondensedThrough(sessionId, 10);
  await service.deleteTurn(sessionId, { index: 2, content: "Q2" }, { deleteCreations: true, rewriteSummary: false }, noRoll);
  // Q2, d-1 and A2 went from before both boundaries; a-1 stayed.
  const stored = context.readSessionSummary(sessionId);
  assert.equal(stored.through, 3);
  assert.equal(stored.condensedThrough, 7);
  assert.equal(stored.summary, "Summary", "left as it was: the athlete did not ask for a rewrite");

  const short = conversation([user("Q1"), coach("A1"), user("Q2"), coach("A2")]);
  context.writeSessionSummary(short, "About Q1", 2);
  await service.deleteTurn(short, { index: 0, content: "Q1" }, { deleteCreations: false, rewriteSummary: false }, noRoll);
  const dropped = context.readSessionSummary(short);
  assert.equal(dropped.summary, undefined);
  assert.equal(dropped.through, 0);

  // An AI Plan conversation opens on its brief, which is no turn: deleting the
  // one turn the summary covered leaves it covering the brief alone.
  const briefed = conversation([{ kind: "planBrief", artifactId: "brief-1" }, user("Q1"), coach("A1"), user("Q2"), coach("A2")]);
  context.writeSessionSummary(briefed, "About Q1", 3);
  await service.deleteTurn(briefed, { index: 1, content: "Q1" }, { deleteCreations: false, rewriteSummary: true }, noRoll);
  assert.equal(context.readSessionSummary(briefed).summary, undefined, "nothing Coach may read is left under it");
});

test("a summary asked to be rewritten is written from the turns it now covers", async () => {
  const sessionId = conversation([user("Q1"), coach("A1"), user("Q2"), coach("A2"), user("Q3"), coach("A3")]);
  context.writeSessionSummary(sessionId, "About Q1 and Q2", 4);
  let handed;
  const change = await service.deleteTurn(
    sessionId,
    { index: 0, content: "Q1" },
    { deleteCreations: false, rewriteSummary: true },
    {
      rollSummary: async (_id, entries) => {
        handed = entries.map((entry) => entry.content);
        return { summary: "About Q2" };
      }
    }
  );
  assert.deepEqual(handed, ["Q2", "A2"]);
  assert.equal(change.summary, "rewritten");
  assert.deepEqual(context.readSessionSummary(sessionId), { summary: "About Q2", through: 2 });

  const failing = conversation([user("Q1"), coach("A1"), user("Q2"), coach("A2"), user("Q3"), coach("A3")]);
  context.writeSessionSummary(failing, "About Q1 and Q2", 4);
  const failed = await service.deleteTurn(
    failing,
    { index: 0, content: "Q1" },
    { deleteCreations: false, rewriteSummary: true },
    { rollSummary: async () => ({ summary: null, reason: "the summariser timed out" }) }
  );
  assert.equal(failed.summary, "failed");
  assert.equal(context.readSessionSummary(failing).summary, "About Q1 and Q2", "the old summary stays");
});

test("a rewritten summary reaches sync, though no save follows it", async () => {
  const sessionId = conversation([user("Q1"), coach("A1"), user("Q2"), coach("A2"), user("Q3"), coach("A3")]);
  context.writeSessionSummary(sessionId, "About Q1 and Q2", 4);
  const captured = [];
  const clock = new HlcClock({ device: "turnactionstest00" });
  syncBridge.attachSyncSink({
    enqueue: (entries) => captured.push(...entries),
    nextHlc: () => formatHlc(clock.tick())
  });
  try {
    await service.setTurnHidden(
      sessionId,
      { index: 0, content: "Q1" },
      { hidden: true, rewriteSummary: true },
      { rollSummary: async () => ({ summary: "About Q2" }) }
    );
  } finally {
    syncBridge.attachSyncSink(null);
  }
  const rows = captured.filter((entry) => entry.key === "chat_sessions" && entry.recordId === sessionId);
  assert.equal(rows.at(-1)?.payload.coach_summary, "About Q2");
});

test("a turn is found by its words when its position moved, and refused when they are not unique", async () => {
  const sessionId = conversation([user("Q1"), coach("A1"), user("Q2"), coach("A2")]);
  await service.deleteTurn(sessionId, { index: 9, content: "Q2" }, { deleteCreations: false, rewriteSummary: false }, noRoll);
  assert.deepEqual(contents(sessionId), ["Q1", "A1"]);

  const twice = conversation([user("Same"), coach("A1"), user("Same"), coach("A2")]);
  await assert.rejects(
    service.deleteTurn(twice, { index: 5, content: "Same" }, { deleteCreations: false, rewriteSummary: false }, noRoll),
    /changed since it was opened/
  );
  assert.equal(contents(twice).length, 4, "nothing was touched");
});

test("a turn is found by its question's identity, and refused once that is gone", async () => {
  const sessionId = conversation([user("ok"), coach("A1"), user("Q2"), coach("A2"), user("ok"), coach("A3")]);
  const [first, , , , second] = history.getChatSession(sessionId);
  // Another machine deleted the first "ok"; this window still shows it where it was.
  await service.deleteTurn(sessionId, { index: 0, content: "ok", mid: first.mid }, { deleteCreations: false, rewriteSummary: false }, noRoll);
  assert.deepEqual(contents(sessionId), ["Q2", "A2", "ok", "A3"]);
  await assert.rejects(
    service.deleteTurn(sessionId, { index: 0, content: "ok", mid: first.mid }, { deleteCreations: false, rewriteSummary: false }, noRoll),
    /changed since it was opened/,
    "its words are unique now, and still not this turn"
  );
  await service.deleteTurn(sessionId, { index: 4, content: "ok", mid: second.mid }, { deleteCreations: false, rewriteSummary: false }, noRoll);
  assert.deepEqual(contents(sessionId), ["Q2", "A2"], "found where it moved to");
});

// --- asking again ---------------------------------------------------------------

test("only the last question is asked again, keeping its identity and losing its answer", async () => {
  const sessionId = richConversation();
  assert.throws(() => service.editTurn(sessionId, { index: 2, content: "Q2" }, "Q2 again"), /last question/);

  const lastBefore = history.getChatSession(sessionId).find((entry) => entry.content === "Q4");
  service.editTurn(sessionId, { index: 10, content: "Q4" }, "Q4, said better");
  const after = history.getChatSession(sessionId);
  assert.deepEqual(contents(sessionId).slice(-2), ["A3", "Q4, said better"]);
  assert.equal(after.at(-1).mid, lastBefore.mid, "the question is the same message, edited");
  assert.notEqual(after.at(-1).mrev, lastBefore.mrev, "and its edit outranks the copy elsewhere");
});

test("asking again deletes what the answer made, where it can", () => {
  const sessionId = richConversation();
  history.saveChatSession(sessionId, history.getChatSession(sessionId).slice(0, 10));
  service.editTurn(sessionId, { index: 6, content: "Q3" }, "Q3");
  assert.deepEqual(contents(sessionId).slice(6), ["Q3", "planDraft:a-2"], "a-2 has a version in Q2's turn");
  assert.deepEqual(databaseModule.getChatScheduleChanges(["cs-1"]), []);
});

// --- hiding -------------------------------------------------------------------------

const spoken = (sessionId) =>
  hiddenModule
    .coachTranscript(sessionId, history.getChatSession(sessionId))
    .map((entry) => (entry.kind === "message" ? entry.content : entry.kind));

test("a hidden turn stays in the row and out of what Coach reads", async () => {
  const sessionId = conversation([user("Q1"), coach("A1"), user("Off topic"), coach("Shoes"), user("Q3"), coach("A3")]);
  const change = await service.setTurnHidden(sessionId, { index: 2, content: "Off topic" }, { hidden: true, rewriteSummary: false }, noRoll);
  assert.equal(change.hidden.length, 1);
  assert.equal(change.hidden[0], history.getChatSession(sessionId)[2].mid, "named by its question's identity");
  assert.deepEqual(contents(sessionId), ["Q1", "A1", "Off topic", "Shoes", "Q3", "A3"], "the athlete still reads it");
  assert.deepEqual(spoken(sessionId), ["Q1", "A1", "opaque", "opaque", "Q3", "A3"], "Coach does not, and nothing moved");

  await service.setTurnHidden(sessionId, { index: 2, content: "Off topic" }, { hidden: false, rewriteSummary: false }, noRoll);
  assert.deepEqual(service.hiddenTurns(sessionId), []);
});

test("a hidden turn the summary covers can have the summary written without it", async () => {
  const sessionId = conversation([user("Q1"), coach("A1"), user("Q2"), coach("A2"), user("Q3"), coach("A3")]);
  context.writeSessionSummary(sessionId, "About Q1 and Q2", 4);
  let handed;
  const change = await service.setTurnHidden(
    sessionId,
    { index: 0, content: "Q1" },
    { hidden: true, rewriteSummary: true },
    {
      rollSummary: async (_id, entries) => {
        handed = entries.map((entry) => (entry.kind === "message" ? entry.content : entry.kind));
        return { summary: "About Q2" };
      }
    }
  );
  assert.deepEqual(handed, ["opaque", "opaque", "Q2", "A2"], "the summariser reads what Coach may");
  assert.equal(change.summary, "rewritten");
  assert.deepEqual(context.readSessionSummary(sessionId), { summary: "About Q2", through: 4 });
});

test("asking a hidden turn again shows it, and deleting one forgets it", async () => {
  const sessionId = conversation([user("Q1"), coach("A1"), user("Q2"), coach("A2")]);
  await service.setTurnHidden(sessionId, { index: 2, content: "Q2" }, { hidden: true, rewriteSummary: false }, noRoll);
  const asked = service.editTurn(sessionId, { index: 2, content: "Q2" }, "Q2");
  assert.deepEqual(asked.hidden, [], "a question asked again is meant to be read");

  await service.setTurnHidden(sessionId, { index: 0, content: "Q1" }, { hidden: true, rewriteSummary: false }, noRoll);
  const deleted = await service.deleteTurn(sessionId, { index: 0, content: "Q1" }, { deleteCreations: false, rewriteSummary: false }, noRoll);
  assert.deepEqual(deleted.hidden, []);

  await service.setTurnHidden(sessionId, { index: 0, content: "Q2" }, { hidden: true, rewriteSummary: false }, noRoll);
  chatService.deleteChatSessionById(sessionId);
  assert.deepEqual(service.hiddenTurns(sessionId), [], "and the conversation's go with it");
});

// --- branching ----------------------------------------------------------------------

test("a branch holds the conversation up to its turn, and leaves what Coach made behind", async () => {
  saveDraft("b-1", "art-B", 1);
  const sessionId = conversation([
    user("Q1"),
    coach("A1"),
    user("Q2"),
    draftCard("b-1"),
    coach("A2"),
    user("Q3"),
    coach("A3")
  ]);
  history.setChatSessionTitle(sessionId, "Tuần trước 10K");
  chatService.setConversationSettings({ sessionId, sources: { activities: true, sleep: false, zones: true }, web: true });
  context.writeSessionSummary(sessionId, "About Q1", 2);
  await service.setTurnHidden(sessionId, { index: 0, content: "Q1" }, { hidden: true, rewriteSummary: false }, noRoll);

  const branch = service.branchConversation(sessionId, { index: 2, content: "Q2" });
  assert.equal(branch.title, "↳ Tuần trước 10K");
  const entries = history.getChatSession(branch.id);
  assert.deepEqual(entries[0], { ...entries[0], kind: "branchedFrom", sessionId, title: "Tuần trước 10K" });
  assert.deepEqual(contents(branch.id), ["branchedFrom:", "Q1", "A1", "Q2", "A2"], "the plan card stays in the original");
  const original = history.getChatSession(sessionId);
  assert.ok(
    entries.every((entry) => entry.mid && !original.some((kept) => kept.mid === entry.mid)),
    "a branch's entries are its own"
  );
  assert.deepEqual(context.readSessionSummary(branch.id), { summary: "About Q1", through: 3 }, "one place later for the head");
  assert.deepEqual(service.hiddenTurns(branch.id), [entries[1].mid], "the same turn hidden, under its new identity");
  const settings = chatService.getConversationSettings(branch.id);
  assert.equal(settings.sources.sleep, false);
  assert.equal(settings.web, true);

  chatService.deleteChatSessionById(branch.id);
  assert.ok(databaseModule.getChatPlanDraft("b-1"), "deleting the branch takes nothing of the original's");
});

test("a summary reaching past the branch point is not carried", () => {
  const sessionId = conversation([user("Q1"), coach("A1"), user("Q2"), coach("A2"), user("Q3"), coach("A3")]);
  context.writeSessionSummary(sessionId, "About Q1 and Q2", 4);
  const branch = service.branchConversation(sessionId, { index: 0, content: "Q1" });
  assert.equal(context.readSessionSummary(branch.id).summary, undefined);
  const again = service.branchConversation(branch.id, { index: 1, content: "Q1" });
  assert.equal(again.title.startsWith("↳ ↳"), false, "a branch of a branch is marked once");
  assert.deepEqual(contents(again.id), ["branchedFrom:", "Q1", "A1"], "and opens on one head, its own");
  assert.equal(history.getChatSession(again.id)[0].sessionId, branch.id);
});

// --- a failed turn ---------------------------------------------------------------

test("a failure is sorted by what can be done about it", () => {
  const kinds = {
    "529 overloaded_error: Overloaded": "busy",
    "Rate limit reached for requests": "busy",
    "TypeError: fetch failed (getaddrinfo ENOTFOUND api.anthropic.com)": "offline",
    "prompt is too long: 212480 tokens > 200000 maximum": "tooLong",
    "authentication_error: invalid x-api-key": "auth",
    "Unexpected end of JSON input": "other"
  };
  for (const [message, kind] of Object.entries(kinds)) {
    assert.equal(failure.classifyTurnFailure(message), kind, message);
  }
  assert.equal(failure.classifyTurnFailure("anything", true), "auth", "the main process's own word wins");
  const now = Date.UTC(2026, 9, 21, 7);
  assert.equal(failure.unansweredKind(now - 60_000, now), "elsewhere");
  assert.equal(failure.unansweredKind(now - failure.ANSWERING_ELSEWHERE_MS, now), "noAnswer");
  assert.equal(failure.unansweredKind(undefined, now), "noAnswer");
});

for (const [name, run] of cases) {
  try {
    await run();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}
console.log(`chat turn actions: ${cases.length} passed`);
