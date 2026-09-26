import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distUrl = (file) =>
  pathToFileURL(path.join(repoRoot, "dist-electron", file)).href;

const {
  createChatSession,
  deleteChatSession,
  deriveSessionTitleFromEntries,
  getChatSession: readChatSession,
  listChatSessions,
  migrateLegacyTranscriptRow,
  parseChatTranscriptJson,
  restoreChatPlanDraftSources,
  saveChatSession,
  setChatSessionPinned,
  setChatSessionTitle
} = await import(`${distUrl("chatHistoryStore.js")}?cacheBust=${Date.now()}`);

/**
 * Every entry now carries `mid` and `mrev` so a transcript can be merged entry
 * by entry rather than row by row — see `sync/rowMergers.ts`. They are minted
 * from a clock, so they cannot be written into an expected value; the
 * assertions below are about content, and the bookkeeping has its own block at
 * the end of this file.
 */
const stripMergeMeta = (value) => {
  if (Array.isArray(value)) return value.map(stripMergeMeta);
  if (value && typeof value === "object") {
    const { mid: _mid, mrev: _mrev, ...rest } = value;
    return rest;
  }
  return value;
};
const getChatSession = (...args) => stripMergeMeta(readChatSession(...args));

function createMemoryDatabase() {
  /** @type {Map<string, { id: string, provider: string, title: string, messages_json: string, created_at: string, updated_at: string, pinned_at: string | null }>} */
  const rows = new Map();

  return {
    listSessions(provider) {
      return [...rows.values()]
        .filter((row) => row.provider === provider)
        .sort(
          (left, right) =>
            new Date(right.updated_at).getTime() -
            new Date(left.updated_at).getTime()
        );
    },
    getSession(id) {
      return rows.get(id);
    },
    insertSession(id, provider, title, messagesJson, createdAt, updatedAt) {
      rows.set(id, {
        id,
        provider,
        title,
        messages_json: messagesJson,
        created_at: createdAt,
        updated_at: updatedAt,
        pinned_at: null
      });
    },
    updateSession(id, title, messagesJson, updatedAt) {
      const row = rows.get(id);
      if (!row) return;
      rows.set(id, {
        ...row,
        title,
        messages_json: messagesJson,
        updated_at: updatedAt
      });
    },
    setSessionPinned(id, pinnedAt) {
      const row = rows.get(id);
      if (!row) return;
      rows.set(id, { ...row, pinned_at: pinnedAt });
    },
    setSessionTitle(id, title) {
      const row = rows.get(id);
      if (!row) return;
      rows.set(id, { ...row, title });
    },
    deleteSession(id) {
      rows.delete(id);
    }
  };
}

assert.deepEqual(parseChatTranscriptJson("not-json"), []);
assert.deepEqual(parseChatTranscriptJson("{}"), []);
assert.deepEqual(parseChatTranscriptJson('[{"role":"nope","content":"x"}]'), []);

assert.deepEqual(
  parseChatTranscriptJson(
    JSON.stringify([
      { kind: "message", role: "user", content: "Hello" },
      {
        kind: "message",
        role: "assistant",
        content: "Hi",
        reasoningSummary: "I should greet the athlete briefly.",
        source: {
          snapshotIncluded: true,
          mcpEnabled: false,
          mcpUsed: false,
          mcpTools: []
        }
      }
    ])
  ),
  [
    { kind: "message", role: "user", content: "Hello" },
    {
      kind: "message",
      role: "assistant",
      content: "Hi",
      reasoningSummary: "I should greet the athlete briefly.",
      source: {
        snapshotIncluded: true,
        mcpEnabled: false,
        mcpUsed: false,
        mcpTools: []
      }
    }
  ]
);

const waitingPromptEntry = {
  kind: "coachPrompt",
  prompt: {
    promptId: "prompt-1",
    question: "Which strength option should Coach use?",
    choices: [
      {
        id: "choice-1",
        label: "Use split squats",
        description: "Recommended supported alternative.",
        response: "Use split squats."
      },
      {
        id: "choice-2",
        label: "I’ll provide the exact name",
        response: "I’ll provide the exact COROS exercise name."
      }
    ],
    allowCustom: true
  }
};
assert.deepEqual(
  parseChatTranscriptJson(JSON.stringify([waitingPromptEntry])),
  [waitingPromptEntry]
);

const oneOffWorkoutEntry = {
  kind: "planDraft",
  draft: {
    draftId: "workout-1",
    artifactType: "workout",
    name: "Full Gym Push Day",
    summary: "Strength · 16 sets · structured",
    entries: [{
      key: "push-day",
      name: "Full Gym Push Day",
      sport: "strength",
      volume: "16 sets",
      scheduleDate: "2026-07-31",
      saveToLibrary: true,
      workoutType: "structured",
      stepsSummary: "warmup 10 min → Chest Press Machine 4 × 8 reps",
      source: {
        key: "push-day",
        name: "Full Gym Push Day",
        sport: "strength",
        save_to_library: true,
        steps: [
          {
            kind: "warmup",
            target_type: "time",
            target_duration_seconds: 600
          },
          {
            kind: "training",
            target_type: "reps",
            target_reps: 8,
            exercise_id: "1338",
            exercise_name: "Chest Press Machine",
            sets: 4,
            rest_type: 1,
            rest_value: 120,
            intensity: { type: "weight", mode: "weight", value: 0, unit: "kg" }
          }
        ]
      }
    }],
    conflicts: [],
    warnings: [],
    uploadedAt: 1234,
    uploadResult: {
      workoutsScheduled: 1,
      workoutsCreated: 0,
      destination: "calendar"
    }
  }
};
assert.equal(
  parseChatTranscriptJson(JSON.stringify([oneOffWorkoutEntry]))[0].draft.artifactType,
  "workout"
);
assert.equal(
  parseChatTranscriptJson(JSON.stringify([oneOffWorkoutEntry]))[0].draft.uploadResult.destination,
  "calendar"
);
const groupedLocalPlanEntry = structuredClone(oneOffWorkoutEntry);
groupedLocalPlanEntry.draft.artifactType = "plan";
groupedLocalPlanEntry.draft.uploadResult.destination = "localPlan";
groupedLocalPlanEntry.draft.uploadResult.localPlanId = "plan:coach:workout-1";
groupedLocalPlanEntry.draft.uploadResult.groupedPlanCreated = true;
assert.equal(
  parseChatTranscriptJson(JSON.stringify([groupedLocalPlanEntry]))[0].draft.uploadResult.destination,
  "localPlan"
);
assert.deepEqual(
  parseChatTranscriptJson(JSON.stringify([oneOffWorkoutEntry]))[0].draft.entries[0].source,
  oneOffWorkoutEntry.draft.entries[0].source
);
const flattenedWorkoutEntry = structuredClone(oneOffWorkoutEntry);
delete flattenedWorkoutEntry.draft.entries[0].source;
const restoredWorkoutEntry = restoreChatPlanDraftSources(
  parseChatTranscriptJson(JSON.stringify([flattenedWorkoutEntry])),
  (draftId) => draftId === oneOffWorkoutEntry.draft.draftId
    ? JSON.stringify(oneOffWorkoutEntry.draft)
    : undefined
)[0];
assert.deepEqual(
  restoredWorkoutEntry.draft.entries[0].source,
  oneOffWorkoutEntry.draft.entries[0].source
);
const legacyPlanEntry = structuredClone(oneOffWorkoutEntry);
delete legacyPlanEntry.draft.artifactType;
assert.equal(
  parseChatTranscriptJson(JSON.stringify([legacyPlanEntry]))[0].draft.artifactType,
  "plan"
);
assert.deepEqual(
  parseChatTranscriptJson(
    JSON.stringify([
      {
        ...waitingPromptEntry,
        prompt: {
          ...waitingPromptEntry.prompt,
          answer: "Use split squats.",
          selectedChoiceId: "choice-1",
          answeredAt: 1234
        }
      }
    ])
  )[0].prompt,
  {
    ...waitingPromptEntry.prompt,
    answer: "Use split squats.",
    selectedChoiceId: "choice-1",
    answeredAt: 1234
  }
);

assert.equal(
  deriveSessionTitleFromEntries([
    { kind: "message", role: "user", content: "How was my long run yesterday?" }
  ]),
  "How was my long run yesterday?"
);

const db = createMemoryDatabase();

const migrated = migrateLegacyTranscriptRow(
  "chatgpt",
  JSON.stringify([{ kind: "message", role: "user", content: "Plan my week" }]),
  "2026-07-01T12:00:00.000Z",
  db
);
assert.equal(migrated.title, "Plan my week");
assert.equal(migrated.messageCount, 1);

const first = createChatSession("chatgpt", db);
assert.equal(first.title, "New chat");
assert.equal(first.messageCount, 0);

const saved = saveChatSession(
  first.id,
  [{ kind: "message", role: "user", content: "Build a 5K plan" }],
  db
);
assert.ok(saved);
assert.equal(saved.title, "Build a 5K plan");
assert.equal(saved.preview, "Build a 5K plan");
assert.equal(saved.messageCount, 1);

assert.deepEqual(getChatSession(first.id, db), [
  { kind: "message", role: "user", content: "Build a 5K plan" }
]);

const second = createChatSession("chatgpt", db);
assert.equal(listChatSessions("chatgpt", db).length, 3);

deleteChatSession(first.id, db);
assert.equal(listChatSessions("chatgpt", db).length, 2);

const local = createChatSession("local", db);
saveChatSession(
  local.id,
  [{ kind: "message", role: "assistant", content: "Easy day tomorrow." }],
  db
);
assert.equal(listChatSessions("local", db).length, 1);
assert.equal(listChatSessions("chatgpt", db).length, 2);

const pinTarget = createChatSession("chatgpt", db);
assert.equal(pinTarget.pinnedAt, null);

const pinned = setChatSessionPinned(pinTarget.id, true, db);
assert.ok(pinned);
assert.ok(pinned.pinnedAt);
assert.equal(
  listChatSessions("chatgpt", db).find((session) => session.id === pinTarget.id)
    .pinnedAt,
  pinned.pinnedAt
);

// Re-pinning keeps the original timestamp so the pinned order stays stable.
assert.equal(setChatSessionPinned(pinTarget.id, true, db).pinnedAt, pinned.pinnedAt);

// Saving a transcript must not clear the pin.
saveChatSession(
  pinTarget.id,
  [{ kind: "message", role: "user", content: "Keep me pinned" }],
  db
);
assert.equal(
  listChatSessions("chatgpt", db).find((session) => session.id === pinTarget.id)
    .pinnedAt,
  pinned.pinnedAt
);

assert.equal(setChatSessionPinned(pinTarget.id, false, db).pinnedAt, null);
assert.equal(setChatSessionPinned("missing-session", true, db), null);

deleteChatSession(pinTarget.id, db);

// Opening a conversation replays its stored transcript back through
// saveChatSession; that must not count as a change and reorder the sidebar.
const replayTarget = createChatSession("chatgpt", db);
saveChatSession(
  replayTarget.id,
  [{ kind: "message", role: "user", content: "Replay me" }],
  db
);
const storedRow = db.getSession(replayTarget.id);
const backdated = "2020-01-01T00:00:00.000Z";
db.updateSession(
  replayTarget.id,
  storedRow.title,
  storedRow.messages_json,
  backdated
);

const replayed = saveChatSession(
  replayTarget.id,
  getChatSession(replayTarget.id, db),
  db
);
assert.equal(replayed.updatedAt, backdated);
assert.equal(replayed.title, storedRow.title);
assert.equal(replayed.messageCount, 1);

// A genuine edit still writes.
const appended = saveChatSession(
  replayTarget.id,
  [
    ...getChatSession(replayTarget.id, db),
    { kind: "message", role: "assistant", content: "Sure thing." }
  ],
  db
);
assert.notEqual(appended.updatedAt, backdated);
assert.equal(appended.messageCount, 2);

deleteChatSession(replayTarget.id, db);

const claude = createChatSession("claude-code", db);
saveChatSession(
  claude.id,
  [{ kind: "message", role: "assistant", content: "Claude CLI response." }],
  db
);
assert.equal(listChatSessions("claude-code", db).length, 1);
assert.equal(listChatSessions("local", db).length, 1);

const openRouter = createChatSession("openrouter", db);
saveChatSession(
  openRouter.id,
  [{ kind: "message", role: "assistant", content: "OpenRouter response." }],
  db
);
assert.equal(listChatSessions("openrouter", db).length, 1);
assert.equal(listChatSessions("chatgpt", db).length, 2);

// --- setChatSessionTitle (coach analyses name their own conversations) ---
const named = createChatSession("local", db);
const renamed = setChatSessionTitle(named.id, "  Morning briefing  ", db);
assert.equal(renamed.title, "Morning briefing");
assert.equal(
  renamed.updatedAt,
  named.updatedAt,
  "renaming must not jump the conversation to the top of the sidebar"
);

// An over-long title is truncated the same way a derived one is.
const longTitle = setChatSessionTitle(named.id, "x".repeat(120), db);
assert.equal(longTitle.title.length, 49);
assert.ok(longTitle.title.endsWith("\u2026"));

// A blank rename falls back to the default rather than storing "".
assert.equal(setChatSessionTitle(named.id, "   ", db).title, "New chat");

// Renaming to the stored title is a no-op that still returns the summary.
assert.equal(setChatSessionTitle(named.id, "New chat", db).title, "New chat");
assert.equal(setChatSessionTitle("missing", "Nope", db), null);

// A renamed conversation keeps its name: saveChatSession only derives a title
// while the stored one is still the default, which is exactly what stops an
// analysis's conversation being named after its own playbook text.
setChatSessionTitle(named.id, "Daily briefing", db);
const afterPlaybook = saveChatSession(
  named.id,
  [{ kind: "message", role: "user", content: "Summarise yesterday and set today's focus." }],
  db
);
assert.equal(afterPlaybook.title, "Daily briefing");
deleteChatSession(named.id, db);

// --- analysis attribution survives a round-trip (section 5.6) ------------
// parseMessageEntry rebuilds entries field by field, so an unlisted field is
// silently dropped on reload. These assertions are the guard on that.
const marker = {
  runId: "run-1",
  automationId: "auto-1",
  bindingId: "bind-1",
  name: "Morning briefing",
  triggerLabel: "Daily at 07:30"
};

const attributed = createChatSession("local", db);
saveChatSession(
  attributed.id,
  [
    // The synthetic user turn carrying the playbook, stored as role "user".
    {
      kind: "message",
      role: "user",
      content: "Summarise yesterday and set today's focus.",
      automation: marker
    },
    {
      kind: "message",
      role: "assistant",
      content: "Easy 40min today.",
      reasoningSummary: "checked yesterday's load",
      automation: marker
    },
    // An interactive turn in the same conversation carries no marker.
    { kind: "message", role: "user", content: "Why easy?" }
  ],
  db
);

const reloaded = getChatSession(attributed.id, db);
assert.equal(reloaded.length, 3);
assert.deepEqual(reloaded[0].automation, marker, "the user turn keeps its marker");
assert.deepEqual(reloaded[1].automation, marker, "the assistant turn keeps its marker");
assert.equal(reloaded[1].reasoningSummary, "checked yesterday's load");
assert.equal(
  "analysis" in reloaded[2],
  false,
  "an interactive turn gains no marker"
);
// It survives the JSON the row actually stores, not just the in-memory object.
assert.deepEqual(
  parseChatTranscriptJson(db.getSession(attributed.id).messages_json)[1].automation,
  marker
);
deleteChatSession(attributed.id, db);

// A marker missing any field is dropped rather than half-restored, and the
// message itself still survives.
const partialCases = [
  { ...marker, triggerLabel: undefined },
  { ...marker, name: "   " },
  { ...marker, runId: 42 },
  { runId: "r", automationId: "a" },
  "not-an-object",
  null,
  []
];
for (const analysis of partialCases) {
  const parsed = parseChatTranscriptJson(
    JSON.stringify([{ kind: "message", role: "assistant", content: "hi", analysis }])
  );
  assert.equal(parsed.length, 1, `message dropped for ${JSON.stringify(analysis)}`);
  assert.equal(
    parsed[0].automation,
    undefined,
    `partial marker kept for ${JSON.stringify(analysis)}`
  );
}

// A field this build does not know rides along on the marker rather than
// being dropped: a newer build on another machine may have written it, and
// a save here must not take it away (docs/coach-plan-canvas.md §4, Q4). The
// four known fields are still validated — the partial cases above.
const extraFields = parseChatTranscriptJson(
  JSON.stringify([
    {
      kind: "message",
      role: "assistant",
      content: "hi",
      automation: { ...marker, analysisVersion: 2 }
    }
  ])
);
assert.deepEqual(extraFields[0].automation, { ...marker, analysisVersion: 2 });

// The shape `runAnalysis` actually writes: four fields, no `bindingId`.
//
// Every fixture above carries one because attachments existed when they were
// written, which is precisely why nothing caught this — the parser demanded a
// field the runner had stopped writing, so a run's own answer lost its marker
// in the same statement that stored it (`normalizeEntries` runs on every save).
// The chip never appeared, and the synthetic playbook turn that opens a run
// rendered as the athlete's own bubble.
const currentMarker = {
  runId: "run-2",
  automationId: "analysis-2",
  name: "Post-activity debrief",
  triggerLabel: "After Run, Indoor Run"
};
const unbound = createChatSession("local", db);
saveChatSession(
  unbound.id,
  [
    { kind: "message", role: "user", content: "A new activity synced.", automation: currentMarker },
    { kind: "message", role: "assistant", content: "Heart rate ran high.", automation: currentMarker }
  ],
  db
);
const unboundRows = getChatSession(unbound.id, db);
assert.deepEqual(
  unboundRows[0].automation,
  currentMarker,
  "a marker without bindingId keeps its attribution"
);
assert.deepEqual(unboundRows[1].automation, currentMarker);
// Through the row, not just the in-memory array: the save normalizes too.
assert.deepEqual(
  parseChatTranscriptJson(db.getSession(unbound.id).messages_json)[1].automation,
  currentMarker
);
// An entry written while attachments existed still parses, and `bindingId`
// keeps its stored position so the row does not look rewritten on next save.
assert.deepEqual(
  parseChatTranscriptJson(
    JSON.stringify([{ kind: "message", role: "assistant", content: "hi", automation: marker }])
  )[0].automation,
  marker
);
deleteChatSession(unbound.id, db);

// --- what the answer cost, restored for the footer under it ----------------
// Same hazard as the marker above and the reason it is worth a test: an entry
// is rebuilt from the fields this file names, so a count nobody reads back is
// one the athlete sees until the next reload and never again.
{
  const priced = parseChatTranscriptJson(
    JSON.stringify([
      {
        kind: "message",
        role: "assistant",
        content: "hi",
        model: "claude-opus-5",
        usage: { inputTokens: 18_200, outputTokens: 900 }
      }
    ])
  );
  assert.deepEqual(priced[0].usage, { inputTokens: 18_200, outputTokens: 900 });
  assert.equal(priced[0].model, "claude-opus-5");

  // A half-reported pair is dropped rather than half-restored: the footer adds
  // the two, so one missing number would print a total that is simply wrong.
  // Zero is not half-reported — a turn someone counted as free stays free.
  const brokenCases = [
    { inputTokens: 900 },
    { outputTokens: 900 },
    { inputTokens: 900, outputTokens: -40 },
    { inputTokens: "900", outputTokens: 40 },
    { inputTokens: Number.NaN, outputTokens: 40 },
    "18200",
    null
  ];
  for (const usage of brokenCases) {
    const parsed = parseChatTranscriptJson(
      JSON.stringify([{ kind: "message", role: "assistant", content: "hi", usage }])
    );
    assert.equal(parsed.length, 1, `message dropped for ${JSON.stringify(usage)}`);
    assert.equal(
      parsed[0].usage,
      undefined,
      `uncountable usage kept for ${JSON.stringify(usage)}`
    );
  }
  const free = parseChatTranscriptJson(
    JSON.stringify([
      {
        kind: "message",
        role: "assistant",
        content: "hi",
        usage: { inputTokens: 0, outputTokens: 0 }
      }
    ])
  );
  assert.deepEqual(free[0].usage, { inputTokens: 0, outputTokens: 0 });
}

// --- the silent-run trace survives a round-trip (section 5.5) --------------
// A run that found nothing writes no answer, so this one-line entry is the
// only record the conversation keeps of it. Same hazard as the marker above:
// parseEntry rebuilds field by field.
const lookedAt = Date.parse("2026-08-24T06:12:00.000Z");
const traced = createChatSession("local", db);
saveChatSession(
  traced.id,
  [
    { kind: "message", role: "user", content: "Morning." },
    { kind: "automationSilent", automation: marker, at: lookedAt }
  ],
  db
);

const withTrace = getChatSession(traced.id, db);
assert.equal(withTrace.length, 2);
assert.deepEqual(
  withTrace[1],
  { kind: "automationSilent", automation: marker, at: lookedAt },
  "the trace comes back whole"
);
assert.deepEqual(
  stripMergeMeta(
    parseChatTranscriptJson(db.getSession(traced.id).messages_json)[1]
  ),
  { kind: "automationSilent", automation: marker, at: lookedAt },
  "and it survives the JSON the row actually stores"
);
deleteChatSession(traced.id, db);

// Both halves are required: the marker says who looked, `at` says when, and a
// chip that can answer neither is not worth restoring. The entry is not
// half-rendered: it is carried verbatim as an opaque entry, drawn as nothing,
// so this machine's next save does not take it out of the row (Q4) — it may be
// a newer build's shape. The turns around it are untouched.
const brokenTraces = [
  { kind: "automationSilent", at: lookedAt },
  { kind: "automationSilent", analysis: { ...marker, name: "" }, at: lookedAt },
  { kind: "automationSilent", automation: marker },
  { kind: "automationSilent", automation: marker, at: "06:12" },
  { kind: "automationSilent", automation: marker, at: Number.NaN }
];
for (const broken of brokenTraces) {
  const parsed = parseChatTranscriptJson(
    JSON.stringify([{ kind: "message", role: "user", content: "hi" }, broken])
  );
  assert.equal(parsed.length, 2, `half-formed trace carried: ${JSON.stringify(broken)}`);
  assert.equal(parsed[0].kind, "message", "the surrounding turn survives it");
  assert.equal(parsed[1].kind, "opaque", `not restored as a chip: ${JSON.stringify(broken)}`);
  assert.deepEqual(parsed[1].raw, JSON.parse(JSON.stringify(broken)), "and kept exactly as the row held it");
}

// A field this build does not know rides along on the trace too (Q4).
assert.deepEqual(
  parseChatTranscriptJson(
    JSON.stringify([
      { kind: "automationSilent", automation: marker, at: lookedAt, note: "newer build" }
    ])
  ),
  [{ kind: "automationSilent", automation: marker, at: lookedAt, note: "newer build" }]
);

// --- append-on-save: the renderer and the runner racing (section 5.6b) -----
// The window holds its own copy of the transcript and saves the whole array.
// A run writes from the main process behind its back, so between the run
// landing and the window's reload arriving there is a window in which the
// window's next save would delete the coach's answer.
{
  const marker = {
    runId: "run-race",
    automationId: "auto-race",
    bindingId: "bind-race",
    name: "Post-run debrief",
    triggerLabel: "Manual"
  };
  const athleteOpening = { kind: "message", role: "user", content: "Morning." };
  const runEntries = [
    { kind: "message", role: "user", content: "Debrief the session.", automation: marker },
    { kind: "message", role: "assistant", content: "Easy week, hold it there.", automation: marker }
  ];
  const athleteReply = { kind: "message", role: "user", content: "Thanks." };

  const race = () => {
    const session = createChatSession("local", db);
    // What the window read when it opened the conversation.
    saveChatSession(session.id, [athleteOpening], db);
    return session;
  };

  // 1. Interleaved: the run lands, then the window saves its pre-run copy.
  {
    const session = race();
    const windowBase = getChatSession(session.id, db).length;

    // The runner re-read a moment ago and has nothing awaited since, so it
    // replaces outright — no option.
    saveChatSession(session.id, [athleteOpening, ...runEntries], db);

    // The window never saw that. Its array is its own copy plus what the
    // athlete just typed.
    saveChatSession(session.id, [athleteOpening, athleteReply], db, {
      knownEntryCount: windowBase
    });

    assert.deepEqual(
      getChatSession(session.id, db).map((entry) => entry.content),
      ["Morning.", "Thanks.", "Debrief the session.", "Easy week, hold it there."],
      "the run survives the window's save, and the athlete's turn survives the run"
    );
    deleteChatSession(session.id, db);
  }

  // 2. The same sequence without the option is exactly the bug this closes.
  {
    const session = race();
    saveChatSession(session.id, [athleteOpening, ...runEntries], db);
    saveChatSession(session.id, [athleteOpening, athleteReply], db);
    assert.deepEqual(
      getChatSession(session.id, db).map((entry) => entry.content),
      ["Morning.", "Thanks."],
      "without it the coach's answer is overwritten — which is why the option exists"
    );
    deleteChatSession(session.id, db);
  }

  // 3. Saving again before the reload arrives keeps the tail once, not twice.
  // The base advances to what was sent, never to what the row ended up with,
  // so the same foreign tail is re-preserved until the window catches up.
  {
    const session = race();
    const windowBase = getChatSession(session.id, db).length;
    saveChatSession(session.id, [athleteOpening, ...runEntries], db);

    saveChatSession(session.id, [athleteOpening, athleteReply], db, {
      knownEntryCount: windowBase
    });
    saveChatSession(
      session.id,
      [athleteOpening, athleteReply, { kind: "message", role: "assistant", content: "Noted." }],
      db,
      { knownEntryCount: 2 }
    );

    assert.deepEqual(
      getChatSession(session.id, db).map((entry) => entry.content),
      [
        "Morning.",
        "Thanks.",
        "Noted.",
        "Debrief the session.",
        "Easy week, hold it there."
      ],
      "the tail is preserved once more, not duplicated"
    );
    deleteChatSession(session.id, db);
  }

  // 3b. A stale count must not turn the window's own entries into a foreign
  // tail. This is the shape that actually corrupted a conversation: the count
  // fell behind — a save that never fired leaves it where it was while the
  // timeline keeps growing — so the window sent an array that already held
  // everything in the row while claiming to account for only the first entry.
  // Position alone reads the rest as somebody else's and appended it, and the
  // conversation ended up replaying a stretch of its own history, with two
  // chart cards carrying one `previewId` — the duplicate React key that is how
  // anyone noticed.
  {
    const session = race();
    // A card the store accepts. It has to be: a preview `parseEntry` rejects is
    // dropped on the way in, and a test built on one passes against the broken
    // guard too — this one did, until it was mutated.
    const chart = {
      kind: "fitnessTrend",
      preview: {
        previewId: "fitness-trends:af53b193",
        trendPoints: [{ date: "2026-09-10", label: "Thu", trainingLoad: 240 }]
      }
    };
    const whole = [athleteOpening, athleteReply, chart];
    saveChatSession(session.id, whole, db, { knownEntryCount: 1 });
    assert.equal(getChatSession(session.id, db).length, 3, "the card is stored");
    // The count is now stale by two, and the array is the whole row again.
    saveChatSession(session.id, whole, db, { knownEntryCount: 1 });

    const stored = getChatSession(session.id, db);
    assert.deepEqual(
      stored.map((entry) => entry.content ?? entry.preview.previewId),
      ["Morning.", "Thanks.", "fitness-trends:af53b193"],
      "an array that already holds the row must not have the row appended to it"
    );
    const previewIds = stored
      .filter((entry) => entry.preview)
      .map((entry) => entry.preview.previewId);
    assert.deepEqual(
      previewIds,
      [...new Set(previewIds)],
      "and no two cards may end up sharing a previewId"
    );
    deleteChatSession(session.id, db);
  }

  // 3b'. The same stale count one turn later: the array holds the whole row
  // *and* a new entry after it. Its end is then the new entry, not the row's
  // last one, so an ends-with test finds no overlap and appends the tail again.
  {
    const session = race();
    const noted = { kind: "message", role: "assistant", content: "Noted." };
    saveChatSession(session.id, [athleteOpening, athleteReply, noted], db, {
      knownEntryCount: 1
    });
    const question = { kind: "message", role: "user", content: "And tomorrow?" };
    saveChatSession(session.id, [athleteOpening, athleteReply, noted, question], db, {
      knownEntryCount: 1
    });
    assert.deepEqual(
      getChatSession(session.id, db).map((entry) => entry.content),
      ["Morning.", "Thanks.", "Noted.", "And tomorrow?"],
      "entries the window holds are not foreign because newer ones follow them"
    );
    deleteChatSession(session.id, db);
  }

  // 3c. The overlap test is content, not position, so a run's genuine append
  // still survives a stale count — the entries it added are not ones the window
  // is holding, however far behind its count is.
  {
    const session = race();
    saveChatSession(session.id, [athleteOpening, ...runEntries], db);
    // Stale by one: the window accounts for the opening alone and is sending
    // the athlete's reply on top of it. The run's two entries are nowhere in
    // that array, so they are genuinely foreign and must survive.
    saveChatSession(session.id, [athleteOpening, athleteReply], db, {
      knownEntryCount: 1
    });
    assert.deepEqual(
      getChatSession(session.id, db).map((entry) => entry.content),
      ["Morning.", "Thanks.", "Debrief the session.", "Easy week, hold it there."],
      "a tail the window does not hold is still foreign, whatever it claims to know"
    );
    deleteChatSession(session.id, db);
  }

  // 4. Nothing foreign to keep: a window that is up to date replaces its own
  // entries freely, which is what editing a card in place needs.
  {
    const session = race();
    saveChatSession(
      session.id,
      [{ kind: "message", role: "user", content: "Morning, rewritten." }],
      db,
      { knownEntryCount: 1 }
    );
    assert.deepEqual(
      getChatSession(session.id, db).map((entry) => entry.content),
      ["Morning, rewritten."],
      "a caller that accounts for the whole row still owns the whole row"
    );
    deleteChatSession(session.id, db);
  }

  // 5. A caller that knows nothing keeps everything. This is the state a window
  // is in before it has read the conversation, and the safe direction to fail.
  {
    const session = race();
    saveChatSession(session.id, [athleteOpening, ...runEntries], db);
    saveChatSession(session.id, [], db, { knownEntryCount: 0 });
    assert.equal(
      getChatSession(session.id, db).length,
      3,
      "an empty save from a window that has read nothing destroys nothing"
    );
    deleteChatSession(session.id, db);
  }

  // 6. Junk counts do not corrupt the row. Both directions of nonsense fail the
  // same way — towards keeping what nobody accounted for.
  {
    const session = race();
    saveChatSession(session.id, [athleteOpening, ...runEntries], db);
    saveChatSession(session.id, [athleteReply], db, { knownEntryCount: 99 });
    // A count *larger* than the array the caller sent is a claim to have
    // accounted for entries it did not send — which is an assertion that they
    // were deleted, and nothing deletes entries: the window only appends to its
    // own timeline or rewrites it in place. This block used to assert the
    // opposite ("a count past the end leaves no tail to keep"), and that is
    // precisely the loss 5.6b exists to prevent: one over-claiming save wiped
    // the coach's answer out of the conversation with nothing to notice it.
    assert.deepEqual(
      getChatSession(session.id, db).map((entry) => entry.content),
      ["Thanks.", "Debrief the session.", "Easy week, hold it there."],
      "a count past what was sent is clamped to it, so the run's tail survives"
    );

    // Four stored entries against a count of -3, so a count used unclamped
    // would slice from the end and quietly drop the first one.
    saveChatSession(
      session.id,
      [athleteOpening, ...runEntries, { kind: "message", role: "assistant", content: "And rest." }],
      db
    );
    saveChatSession(session.id, [athleteReply], db, { knownEntryCount: -3 });
    assert.deepEqual(
      getChatSession(session.id, db).map((entry) => entry.content),
      [
        "Thanks.",
        "Morning.",
        "Debrief the session.",
        "Easy week, hold it there.",
        "And rest."
      ],
      "a negative count claims nothing, so the whole row is kept"
    );
    deleteChatSession(session.id, db);
  }

  // 7. The silent-run trace is preserved the same way — it is a tail like any
  // other, and it is the only record that run left.
  {
    const session = race();
    const windowBase = getChatSession(session.id, db).length;
    saveChatSession(
      session.id,
      [athleteOpening, { kind: "automationSilent", automation: marker, at: 1787626149503 }],
      db
    );
    saveChatSession(session.id, [athleteOpening, athleteReply], db, {
      knownEntryCount: windowBase
    });
    assert.deepEqual(
      getChatSession(session.id, db).map((entry) => entry.kind),
      ["message", "message", "automationSilent"]
    );
    deleteChatSession(session.id, db);
  }
}

// --- the option survives the whole IPC chain -------------------------------
// A store that can merge but is never asked to is no better than one that
// cannot. The renderer's end is asserted in test-coach-analysis-runner.mjs;
// these are the three links between it and this function, none of which
// TypeScript would notice going missing — a dropped argument is still a valid
// call to every signature involved.
{
  const read = (...parts) => fs.readFileSync(path.join(repoRoot, ...parts), "utf8");

  assert.match(
    read("electron", "preload.ts"),
    /invoke\("chat:saveSession", sessionId, entries, options\)/,
    "preload must forward the options across the bridge"
  );
  assert.match(
    read("electron", "main.ts"),
    /saveChatSessionEntries\(sessionId, entries, options\)/,
    "the ipcMain handler must forward the options"
  );
  assert.match(
    read("electron", "chatService.ts"),
    /saveChatSession\(id, entries, undefined, options\)/,
    "the chatService wrapper must forward the options to the store"
  );
}

// An activity visual survives a save/reload with every channel it was drawn
// from. Dropping a channel here empties the chart on the next session restore
// without any error to show for it.
const activityVisualEntry = {
  kind: "activityVisual",
  preview: {
    previewId: "act-1:req-1",
    activityId: "act-1",
    sportType: 100,
    name: "Easy 9 km",
    startTime: "2026-03-02",
    avgHr: 152,
    maxHr: 168,
    sections: {
      hr: {
        chartKind: "series",
        series: [
          { elapsed: 0, distance: 0, hr: 140, cadence: 175, groundTime: 240 },
          { elapsed: 300, distance: 1000, hr: 148, cadence: 172, groundTime: 246 }
        ]
      },
      cadence: {
        chartKind: "laps",
        laps: [
          { index: 1, avgHr: 140, avgCadence: 172 },
          { index: 2, avgHr: 148, avgCadence: 169 }
        ]
      },
      laps: [
        { index: 1, avgHr: 140, avgCadence: 172 },
        { index: 2, avgHr: 148, avgCadence: 169 }
      ]
    }
  }
};

const restoredVisual = parseChatTranscriptJson(
  JSON.stringify([activityVisualEntry])
);
assert.equal(restoredVisual.length, 1);
assert.deepEqual(restoredVisual[0].preview.sections.cadence, {
  chartKind: "laps",
  series: undefined,
  laps: [
    { index: 1, avgHr: 140, maxHr: undefined, distance: undefined, duration: undefined, pace: undefined, avgCadence: 172 },
    { index: 2, avgHr: 148, maxHr: undefined, distance: undefined, duration: undefined, pace: undefined, avgCadence: 169 }
  ]
});
assert.deepEqual(restoredVisual[0].preview.sections.hr.series, [
  { elapsed: 0, distance: 0, hr: 140, cadence: 175, groundTime: 240 },
  { elapsed: 300, distance: 1000, hr: 148, cadence: 172, groundTime: 246 }
]);
assert.equal(restoredVisual[0].preview.sections.laps[0].avgCadence, 172);
// The card reads the sport to draw a ride as speed and a swim in pool units;
// dropped here, every reopened ride charted its speed as a running pace.
assert.equal(restoredVisual[0].preview.sportType, 100);

// Removing a creation is a mark on the draft that survives a round trip, and
// a save that keeps the array's length so `foreignTail` has no tail to put
// back. Both halves matter: `parsePlanDraft` rebuilds the draft field by
// field, so an unlisted key is dropped, and a save that *shortened* the array
// would have the guard restore the entry it just removed.
{
  const removedDb = createMemoryDatabase();
  const session = createChatSession("claude-code", removedDb);
  const keptMessage = { kind: "message", role: "user", content: "Plan my week" };
  const creation = structuredClone(oneOffWorkoutEntry);
  saveChatSession(session.id, [keptMessage, creation], removedDb, {
    knownEntryCount: 0
  });

  const removed = structuredClone(creation);
  removed.draft.removedAt = 1758000000000;
  saveChatSession(session.id, [keptMessage, removed], removedDb, {
    knownEntryCount: 2
  });

  const stored = parseChatTranscriptJson(
    removedDb.getSession(session.id).messages_json
  );
  assert.equal(stored.length, 2);
  assert.equal(stored[1].draft.removedAt, 1758000000000);
  // The removed creation stops speaking for the conversation in the sidebar.
  assert.equal(
    listChatSessions("claude-code", removedDb)[0].preview,
    "Plan my week"
  );

  // And a draft that was never removed keeps saying nothing about it, rather
  // than gaining a null field that a `deepEqual` elsewhere would trip on.
  assert.equal(
    parseChatTranscriptJson(JSON.stringify([oneOffWorkoutEntry]))[0].draft
      .removedAt,
    undefined
  );
}

// ---------------------------------------------------------------------------
// Merge identity. Every entry gets a `mid` it keeps for life and a `mrev` that
// moves when its content does, which is what lets two machines union a
// conversation instead of one of them winning it outright. Recovered on every
// save rather than trusted, because the renderer rebuilds entries field by
// field on the way here and drops both.
// ---------------------------------------------------------------------------
{
  const db = createMemoryDatabase();
  const session = createChatSession("claude-code", db);
  const prompt = {
    promptId: "p1",
    question: "How hard on Thursday?",
    choices: [
      { id: "c1", label: "Easy", response: "Easy" },
      { id: "c2", label: "Hard", response: "Hard" }
    ],
    allowCustom: false
  };

  saveChatSession(
    session.id,
    [
      { kind: "message", role: "user", content: "Plan my week" },
      { kind: "coachPrompt", prompt }
    ],
    db
  );
  const first = readChatSession(session.id, db);
  assert.ok(first[0].mid && first[1].mid, "every entry is given an identity");
  assert.notEqual(first[0].mid, first[1].mid, "and they are distinct");
  assert.ok(first[0].mid < first[1].mid, "ids sort in the order entries were made");

  // Opening a conversation replays it through this path. The identities have to
  // come back the same or the row would be rewritten — and, worse, the other
  // machine would see the same turns arrive under new ids and union them in
  // beside themselves.
  const replayed = JSON.parse(JSON.stringify(stripMergeMeta(first)));
  saveChatSession(session.id, replayed, db, { knownEntryCount: replayed.length });
  assert.deepEqual(
    readChatSession(session.id, db).map((entry) => entry.mid),
    first.map((entry) => entry.mid),
    "a save that changed nothing recovers every identity by content"
  );
  assert.equal(
    db.getSession(session.id).updatedAt ?? db.getSession(session.id).updated_at,
    db.getSession(session.id).updated_at,
    "and the row is not touched"
  );

  // Answering the card edits it in place. Content no longer matches, so the
  // identity is recovered from the card's own id and the revision moves — which
  // is what makes this edit outrank the unanswered copy the other machine holds.
  const answered = stripMergeMeta(first).map((entry) =>
    entry.kind === "coachPrompt"
      ? { ...entry, prompt: { ...entry.prompt, answer: "Easy", selectedChoiceId: "c1" } }
      : entry
  );
  saveChatSession(session.id, answered, db, { knownEntryCount: answered.length });
  const edited = readChatSession(session.id, db);
  assert.equal(edited[1].mid, first[1].mid, "an edited card keeps its identity");
  assert.ok(edited[1].mrev > first[1].mrev, "and its revision moves forward");
  assert.equal(edited[0].mrev, first[0].mrev, "the entry beside it is untouched");

  // A turn arriving from somewhere this window cannot see keeps its own
  // identity rather than being renumbered on the way past.
  const appended = [
    ...stripMergeMeta(edited),
    { kind: "message", role: "assistant", content: "Easy it is." }
  ];
  saveChatSession(session.id, appended, db, { knownEntryCount: appended.length });
  const grown = readChatSession(session.id, db);
  assert.equal(grown.length, 3);
  assert.deepEqual(
    grown.slice(0, 2).map((entry) => entry.mid),
    edited.slice(0, 2).map((entry) => entry.mid),
    "existing entries keep their identities when one is appended"
  );
  assert.ok(grown[2].mid > grown[1].mid, "and the new one sorts after them");

  // A transcript written before any of this exists gets identities that both
  // machines derive the same way — by position, which is the only thing two
  // copies of the same history agree on.
  const legacy = createChatSession("claude-code", db);
  db.updateSession(
    legacy.id,
    "Old",
    JSON.stringify([
      { kind: "message", role: "user", content: "written long ago" },
      { kind: "message", role: "assistant", content: "answered long ago" }
    ]),
    "2026-09-01T00:00:00.000Z"
  );
  const carried = readChatSession(legacy.id, db);
  assert.deepEqual(
    carried.map((entry) => entry.mid),
    [undefined, undefined],
    "reading does not mint anything"
  );
  saveChatSession(legacy.id, stripMergeMeta(carried), db, { knownEntryCount: 2 });
  const backfilled = readChatSession(legacy.id, db);
  assert.ok(
    backfilled.every((entry, index) =>
      new RegExp(`^0-${String(index).padStart(6, "0")}-[0-9a-f]{8}$`).test(entry.mid)
    ),
    "a backfilled id is position and content, so two machines derive the same one"
  );
  // Content, not only position: two machines that each appended a turn while
  // both were on the old build would otherwise claim the same slot and one
  // athlete's turn would be dropped resolving it.
  assert.notEqual(
    backfilled[0].mid.slice(9),
    backfilled[1].mid.slice(9),
    "and two different entries never share one"
  );
  assert.ok(
    backfilled[1].mid < first[0].mid,
    "and every backfilled id sorts before every minted one"
  );
}

console.log("chat history store tests passed");
