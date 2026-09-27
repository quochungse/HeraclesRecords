import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * A transcript's whole trip through a window: the store parses the row, IPC
 * hands it to the renderer, the renderer rebuilds its timeline from it and
 * rebuilds the entries again to save them, and the store writes the row. Every
 * step but IPC rebuilds entries field by field, so this is where a field or a
 * kind this build does not know would be dropped (docs/coach-plan-canvas.md
 * §4, Q4) — and where the converters must not drop them.
 *
 * Launched through Electron, not plain `node`: it imports
 * `src/chat/chatTypes.ts` with `--experimental-strip-types`, which a Node
 * built without Amaro cannot run (see CLAUDE.md).
 */

const repoRoot = path.resolve(import.meta.dirname, "..");
const distUrl = (file) =>
  pathToFileURL(path.join(repoRoot, "dist-electron", file)).href;

const { parseChatTranscriptJson, saveChatSession } = await import(
  `${distUrl("chatHistoryStore.js")}?cacheBust=${Date.now()}`
);
const {
  fromPersistedEntries,
  toPersistedEntries,
  upsertCoachPromptEntry,
  upsertPlanDraftEntry
} = await import(
  `${pathToFileURL(path.join(repoRoot, "src", "chat", "chatTypes.ts")).href}?cacheBust=${Date.now()}`
);

function memoryDatabase(messagesJson) {
  const row = {
    id: "chat-1",
    provider: "claude-code",
    title: "Plan",
    messages_json: messagesJson,
    created_at: "2026-09-25T00:00:00.000Z",
    updated_at: "2026-09-25T00:00:00.000Z",
    pinned_at: null
  };
  return {
    row,
    listSessions: () => [row],
    getSession: (id) => (id === row.id ? row : undefined),
    insertSession() {
      throw new Error("not used");
    },
    updateSession(id, title, json, updatedAt) {
      row.title = title;
      row.messages_json = json;
      row.updated_at = updatedAt;
    },
    setSessionPinned() {},
    setSessionTitle() {},
    deleteSession() {}
  };
}

const draft = {
  draftId: "draft-1",
  artifactType: "plan",
  name: "Hanoi Half",
  summary: "10 weeks",
  entries: [
    { key: "w1-tue", name: "Easy 45'", saveToLibrary: false, workoutType: "easy", day: "tue" }
  ],
  conflicts: [],
  warnings: [],
  futureField: { version: 2 }
};

// Written in the order this build serializes, so a save that changes nothing
// has to leave the row byte for byte.
const row = [
  {
    kind: "message",
    role: "user",
    content: "Build me a plan",
    refs: ["artifact-1"],
    mid: "1-000000000001-0000-aa",
    mrev: "1-000000000001-0000-aa"
  },
  {
    kind: "futureAnchor",
    artifactId: "artifact-1",
    mid: "1-000000000002-0000-aa",
    mrev: "1-000000000002-0000-aa"
  },
  {
    kind: "planDraft",
    draft,
    cardNote: "top level",
    mid: "1-000000000003-0000-aa",
    mrev: "1-000000000003-0000-aa"
  },
  {
    kind: "coachPrompt",
    prompt: {
      promptId: "prompt-1",
      question: "Long run on Saturday or Sunday?",
      choices: [
        { id: "choice-1", label: "Saturday", response: "Saturday" },
        { id: "choice-2", label: "Sunday", response: "Sunday" }
      ],
      allowCustom: true
    },
    askedFor: "artifact-1",
    mid: "1-000000000004-0000-aa",
    mrev: "1-000000000004-0000-aa"
  },
  {
    kind: "message",
    role: "assistant",
    content: "Here is the plan.",
    mid: "1-000000000005-0000-aa",
    mrev: "1-000000000005-0000-aa"
  }
];
const rowJson = JSON.stringify(row);

/** Through the window and back, as a turn's save sends it. */
function throughWindow(json, edit = (timeline) => timeline) {
  const sent = structuredClone(parseChatTranscriptJson(json));
  const timeline = edit(fromPersistedEntries(sent));
  return structuredClone(toPersistedEntries(timeline));
}

// The renderer keeps the unknown kind in its place and carries the unknown
// top-level fields, but draws neither.
{
  const timeline = fromPersistedEntries(structuredClone(parseChatTranscriptJson(rowJson)));
  assert.deepEqual(
    timeline.map((entry) => entry.kind),
    ["message", "opaque", "planDraft", "coachPrompt", "message"]
  );
  assert.deepEqual(timeline[0].extra, { refs: ["artifact-1"] });
  assert.equal(timeline[0].refs, undefined, "an unknown field is not mistaken for a known one");
  assert.deepEqual(timeline[2].extra, { cardNote: "top level" });
  assert.deepEqual(timeline[2].draft.futureField, { version: 2 });
  assert.equal(timeline[4].extra, undefined, "an entry with nothing unknown carries no bag");
  assert.equal(timeline[1].extra, undefined, "an opaque entry's raw object is not an unknown field");
}

// An unchanged round trip leaves the row byte for byte.
{
  const database = memoryDatabase(rowJson);
  saveChatSession("chat-1", throughWindow(rowJson), database, { knownEntryCount: row.length });
  assert.equal(database.row.messages_json, rowJson);
  assert.equal(database.row.updated_at, "2026-09-25T00:00:00.000Z");
}

// The edits a window actually makes keep what they do not touch: answering the
// question, and the coach's card replaced by a newer copy of itself.
{
  const database = memoryDatabase(rowJson);
  const sent = throughWindow(rowJson, (timeline) => {
    const answered = timeline.map((entry) =>
      entry.kind === "coachPrompt"
        ? { ...entry, prompt: { ...entry.prompt, answer: "Saturday", answeredAt: 7 } }
        : entry
    );
    const prompt = answered.find((entry) => entry.kind === "coachPrompt").prompt;
    return upsertPlanDraftEntry(upsertCoachPromptEntry(answered, prompt), {
      ...draft,
      summary: "10 weeks, edited"
    });
  });
  saveChatSession("chat-1", sent, database, { knownEntryCount: row.length });
  const saved = JSON.parse(database.row.messages_json);

  assert.equal(saved[0].refs[0], "artifact-1");
  assert.deepEqual(
    { ...saved[1], mid: undefined, mrev: undefined },
    { kind: "futureAnchor", artifactId: "artifact-1", mid: undefined, mrev: undefined }
  );
  assert.equal(saved[1].mid, row[1].mid);
  assert.equal(saved[2].cardNote, "top level");
  assert.equal(saved[2].draft.summary, "10 weeks, edited");
  assert.deepEqual(saved[2].draft.futureField, { version: 2 });
  assert.equal(saved[3].askedFor, "artifact-1");
  assert.equal(saved[3].prompt.answer, "Saturday");
  assert.equal(saved[3].mid, row[3].mid, "an answered prompt keeps its identity");
  assert.ok(saved[3].mrev > row[3].mrev, "and outranks the unanswered copy");
}

// A planEvent (P1.3) is a kind this build knows: parsed, not wrapped as
// opaque, and carried through all four rebuilds with a field it does not know.
{
  const event = {
    kind: "planEvent",
    mid: "1-00000000000a",
    mrev: "1-00000000000a",
    event: {
      eventId: "e1",
      artifactId: "d1",
      draftId: "d2",
      action: "restored",
      author: "athlete",
      name: "Base block",
      artifactType: "plan",
      fromVersion: 3,
      toVersion: 4,
      changes: ["Long run back to Saturday"],
      at: 12,
      fromLaterBuild: "kept"
    },
    alsoLater: 1
  };
  const [parsed] = parseChatTranscriptJson(JSON.stringify([event]));
  assert.equal(parsed.kind, "planEvent", "known, not opaque");
  assert.deepEqual(parsed.event, event.event, "every field of the event, the unknown one too");
  assert.equal(parsed.alsoLater, 1, "and the entry's own unknown field");
  const back = toPersistedEntries(fromPersistedEntries([parsed]));
  assert.deepEqual(back[0].event, event.event, "the renderer's round trip keeps it");
  assert.equal(back[0].alsoLater, 1);
  assert.equal(
    parseChatTranscriptJson(JSON.stringify([{ kind: "planEvent", event: { eventId: "e2" } }]))[0].kind,
    "opaque",
    "half an event is not restored as one, and not dropped either"
  );
}

// planRefs (P1.7): a known kind, carried through all four rebuilds.
{
  const entry = {
    kind: "planRefs",
    refs: [
      { artifactId: "d1", draftId: "d3", version: 3, name: "Base block", artifactType: "plan", scope: "week", weekIndex: 5, label: "Week 6", later: "kept" }
    ]
  };
  const [parsed] = parseChatTranscriptJson(JSON.stringify([entry]));
  assert.equal(parsed.kind, "planRefs");
  assert.deepEqual(parsed.refs, entry.refs);
  assert.deepEqual(toPersistedEntries(fromPersistedEntries([parsed]))[0].refs, entry.refs);
  assert.equal(
    parseChatTranscriptJson(JSON.stringify([{ kind: "planRefs", refs: [{ draftId: "x" }] }]))[0].kind,
    "opaque",
    "a reference that says nothing is not restored as one, and not dropped either"
  );
}

console.log("test-chat-entry-passthrough: ok");
