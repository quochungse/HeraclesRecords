import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * What happens to a transcript when two synced machines run builds that know
 * different entry shapes (docs/coach-plan-canvas.md §4).
 *
 * The first half pins the facts the plan rests on, by feeding this build's
 * store and merger exactly what an *older* build hands them: the renderer
 * rebuilds entries field by field and drops `mid`/`mrev`, and an older parser
 * drops any field or kind it does not know. Those facts hold whatever this
 * build's parser does, which is why they are written as the older build's
 * output rather than produced by the parser.
 *
 * The second half is this build's own rule: nothing it does not understand is
 * dropped.
 */

const repoRoot = path.resolve(import.meta.dirname, "..");
const distUrl = (file) =>
  pathToFileURL(path.join(repoRoot, "dist-electron", file)).href;

const { parseChatTranscriptJson, saveChatSession } = await import(
  `${distUrl("chatHistoryStore.js")}?cacheBust=${Date.now()}`
);
const { mergeTranscripts } = await import(
  `${distUrl("sync/rowMergers.js")}?cacheBust=${Date.now()}`
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

/**
 * The row an older build leaves after its window saves `sentEntries`.
 *
 * `storedAsItReadsIt` is the stored row as the older build's parser returns
 * it — without the fields and kinds it does not know. That step has to be
 * stated rather than run, because this build's parser no longer drops them;
 * everything after it (identity recovery, stamping) is the same code in both.
 */
function saveAsOlderBuild(storedAsItReadsIt, sentEntries) {
  const database = memoryDatabase(JSON.stringify(storedAsItReadsIt));
  saveChatSession("chat-1", sentEntries, database, {
    knownEntryCount: sentEntries.length
  });
  return JSON.parse(database.row.messages_json);
}

/** An entry as a build that does not know `futureField` reads it. */
const withoutFutureField = (entry) => {
  const { futureField: _field, ...rest } = entry;
  return rest.draft
    ? { ...rest, draft: withoutFutureField(rest.draft) }
    : rest;
};

const question = {
  kind: "message",
  role: "user",
  content: "Build me a plan",
  mid: "1-000000000001-0000-aa",
  mrev: "1-000000000001-0000-aa"
};

const draft = {
  draftId: "draft-1",
  artifactType: "plan",
  name: "Hanoi Half",
  summary: "10 weeks",
  entries: [
    {
      key: "w1-tue",
      name: "Easy 45'",
      saveToLibrary: false,
      workoutType: "easy"
    }
  ],
  conflicts: [],
  warnings: []
};

// --- H3: a field an older build does not know, on a kind it does -----------
//
// The newer machine wrote `futureField` into a plan card, and the older build
// reads the card without it. What happens next depends on whether it changes
// the card.
{
  const newerCard = {
    kind: "planDraft",
    draft: { ...draft, futureField: { version: 2 } },
    mid: "1-000000000002-0000-aa",
    mrev: "1-000000000002-0000-aa"
  };
  const newer = [question, newerCard];
  const asked = { kind: "message", role: "user", content: "Build me a plan" };

  // H3a. Saved back untouched: the older build parses the stored row the same
  // way it parsed the copy it sends, so the two match, and the card keeps both
  // its `mid` and its `mrev`. Two copies at one revision are then settled by
  // comparing their JSON — which copy survives is decided by how the two happen
  // to serialize, not by anything either machine meant. Here, the stripped one.
  {
    const olderRow = saveAsOlderBuild(newer.map(withoutFutureField), [asked, { kind: "planDraft", draft }]);
    const card = olderRow.find((entry) => entry.kind === "planDraft");
    assert.equal(card.mid, newerCard.mid, "H3a: the card keeps its identity");
    assert.equal(card.mrev, newerCard.mrev, "H3a: and its revision");
    assert.equal(card.draft.futureField, undefined);

    const merged = mergeTranscripts(newer, olderRow).filter(
      (entry) => entry.kind === "planDraft"
    );
    assert.equal(merged.length, 1);
    assert.equal(
      merged[0].draft.futureField,
      undefined,
      "H3a: a tie on revision can drop the field"
    );
  }

  // H3b. Changed on the older build — here removed from the conversation, as
  // answering a question or editing a plan would: the content no longer
  // matches, the card's own id does, so the entry keeps its `mid` and is
  // stamped with a newer `mrev`. The copy without the field then wins on every
  // machine, whatever it serializes to.
  {
    const olderRow = saveAsOlderBuild(newer.map(withoutFutureField), [
      asked,
      { kind: "planDraft", draft: { ...draft, removedAt: 1 } }
    ]);
    const card = olderRow.find((entry) => entry.kind === "planDraft");
    assert.equal(card.mid, newerCard.mid, "H3b: the card keeps its identity");
    assert.ok(card.mrev > newerCard.mrev, "H3b: and is stamped as an edit");

    const merged = mergeTranscripts(newer, olderRow).filter(
      (entry) => entry.kind === "planDraft"
    );
    assert.equal(merged.length, 1);
    assert.equal(merged[0].draft.removedAt, 1);
    assert.equal(
      merged[0].draft.futureField,
      undefined,
      "H3b: an edit on the older build always drops the field"
    );
  }
}

// --- H4: a field an older build does not know, on a message -----------------
//
// The older build strips the field from the stored row and from the copy it
// sends alike, so the message still matches by content: same `mid`, same
// `mrev`, never duplicated. It is exposed to the same tie as H3a, and an older
// build never edits a message, so there is no H3b for it.
{
  const newer = [{ ...question, futureField: "refers to week 6" }];
  const olderRow = saveAsOlderBuild(newer.map(withoutFutureField), [
    { kind: "message", role: "user", content: "Build me a plan" }
  ]);
  assert.equal(olderRow[0].mid, newer[0].mid, "H4: the message keeps its identity");
  assert.equal(olderRow[0].mrev, newer[0].mrev, "H4: and its revision");

  const merged = mergeTranscripts(newer, olderRow);
  const copies = merged.filter((entry) => entry.content === "Build me a plan");
  assert.equal(copies.length, 1, "H4: the question is not duplicated");
  assert.equal(copies[0].futureField, undefined, "H4: a tie on revision can drop the field");
}

// --- H1: a kind an older build does not know --------------------------------
//
// The older build drops the entry when it reads the row and saves without it.
// Its own row loses it; the union with the newer machine's row keeps it.
{
  const brief = {
    kind: "planBrief",
    artifactId: "artifact-1",
    mid: "1-000000000003-0000-aa",
    mrev: "1-000000000003-0000-aa"
  };
  const newer = [question, brief];
  const olderRow = saveAsOlderBuild([question], [
    { kind: "message", role: "user", content: "Build me a plan" }
  ]);
  assert.equal(
    olderRow.some((entry) => entry.kind === "planBrief"),
    false,
    "H1: the older build's own row loses the entry"
  );
  assert.equal(olderRow[0].mid, question.mid, "H1: the message keeps its identity");

  const merged = mergeTranscripts(newer, olderRow);
  assert.deepEqual(
    merged.filter((entry) => entry.kind === "planBrief"),
    [brief],
    "H1: the union keeps it, untouched"
  );
}

// --- This build: nothing it does not understand is dropped (Q4) -------------

const newerRow = [
  { ...question, futureField: "refers to week 6" },
  {
    kind: "planBrief",
    artifactId: "artifact-1",
    fields: { goal: "Hanoi Half" },
    mid: "1-000000000003-0000-aa",
    mrev: "1-000000000003-0000-aa"
  },
  {
    kind: "planDraft",
    draft: {
      ...draft,
      entries: [{ ...draft.entries[0], week: 1, day: "tue" }],
      futureField: { version: 2 }
    },
    cardNote: "top level",
    mid: "1-000000000004-0000-aa",
    mrev: "1-000000000004-0000-aa"
  },
  {
    kind: "coachPrompt",
    prompt: {
      promptId: "prompt-1",
      question: "Long run on Saturday or Sunday?",
      allowCustom: true,
      choices: [
        { id: "choice-1", label: "Saturday", response: "Saturday", icon: "sun" },
        { id: "choice-2", label: "Sunday", response: "Sunday" }
      ],
      askedFor: "artifact-1"
    },
    mid: "1-000000000005-0000-aa",
    mrev: "1-000000000005-0000-aa"
  }
];
const newerJson = JSON.stringify(newerRow);

// Read: the unknown kind is carried as an opaque wrapper, unknown fields ride
// along at every depth, and the merge metadata is where it always is.
{
  const [message, brief, card, prompt] = parseChatTranscriptJson(newerJson);
  assert.equal(message.futureField, "refers to week 6");
  assert.equal(message.mid, question.mid);

  assert.equal(brief.kind, "opaque");
  assert.deepEqual(brief.raw, {
    kind: "planBrief",
    artifactId: "artifact-1",
    fields: { goal: "Hanoi Half" }
  });
  assert.equal(brief.mid, "1-000000000003-0000-aa", "merge metadata stays on the wrapper");

  assert.equal(card.cardNote, "top level");
  assert.deepEqual(card.draft.futureField, { version: 2 });
  assert.equal(card.draft.entries[0].day, "tue");

  assert.equal(prompt.prompt.askedFor, "artifact-1");
  assert.equal(prompt.prompt.choices[0].icon, "sun");
}

// A field this build does know keeps being validated: a malformed one is still
// dropped rather than passed through as if it were unknown.
{
  const [card] = parseChatTranscriptJson(
    JSON.stringify([
      { kind: "planDraft", draft: { ...draft, removedAt: "yesterday", editedAt: 5 } }
    ])
  );
  assert.equal(card.draft.removedAt, undefined);
  assert.equal(card.draft.editedAt, 5);
}

// Save: the content is kept whole, the opaque entry as its raw object again.
// A row another build wrote may come back with its keys in this build's order
// once; after that an unchanged save leaves it byte for byte as it was, which
// is what keeps opening a conversation from rewriting and republishing it.
{
  const database = memoryDatabase(newerJson);
  const save = () =>
    saveChatSession("chat-1", parseChatTranscriptJson(database.row.messages_json), database, {
      knownEntryCount: newerRow.length
    });
  save();
  assert.deepEqual(JSON.parse(database.row.messages_json), newerRow);
  const settled = database.row.messages_json;
  const before = database.row.updated_at;
  save();
  assert.equal(database.row.messages_json, settled);
  assert.equal(database.row.updated_at, before, "an unchanged save touches nothing");
}

// Save what the window sends back — no `mid`/`mrev`, the opaque entry as the
// wrapper it received — and nothing is lost: every identity is recovered, and
// a merge with the machine that wrote the row adds nothing and drops nothing.
{
  const database = memoryDatabase(newerJson);
  const fromWindow = parseChatTranscriptJson(newerJson).map(
    ({ mid: _mid, mrev: _mrev, ...entry }) => entry
  );
  saveChatSession("chat-1", fromWindow, database, { knownEntryCount: fromWindow.length });
  const saved = JSON.parse(database.row.messages_json);
  assert.deepEqual(saved, newerRow);
  assert.deepEqual(mergeTranscripts(newerRow, saved), newerRow);
}

console.log("test-chat-transcript-compat: ok");
