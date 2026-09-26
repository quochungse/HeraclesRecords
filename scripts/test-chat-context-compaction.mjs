// Context compaction: the rolling summary shared by the interactive chat and
// by automation runs.
//
// The runner suite covers what a *run* does with a plan. This one covers the
// mechanism itself — the window, the wire transcript, and the roll — because it
// is now load-bearing for the athlete's own messages too, and a defect here
// costs turns nobody asked for or drops turns nobody notices.
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distUrl = (file) =>
  pathToFileURL(path.join(repoRoot, "dist-electron", file)).href;

const {
  DEFAULT_COMPACT_CONTEXT,
  DEFAULT_CONTEXT_KEEP,
  DEFAULT_CONTEXT_LIMIT,
  DEFAULT_CONTEXT_WINDOW,
  MAX_CONTEXT_LIMIT,
  MIN_CONTEXT_GAP,
  MIN_CONTEXT_KEEP,
  applyTranscriptContext,
  buildRollingSummaryTurn,
  contextMessages,
  normalizeContextWindow,
  creationIndex,
  planEventNote,
  planRefsNote,
  planTranscriptContext,
  summaryContextMessage,
  toWireMessages,
  withCreationIndex
} = await import(
  `${distUrl("chatContextCompaction.js")}?cacheBust=${Date.now()}`
);

const message = (index) => ({
  kind: "message",
  role: index % 2 === 0 ? "user" : "assistant",
  content: `entry ${index}`
});
const transcript = (count) =>
  Array.from({ length: count }, (_, index) => message(index));
const contentsOf = (entries) => entries.map((entry) => entry.content);

// ---------------------------------------------------------------------------
// The window
// ---------------------------------------------------------------------------

assert.deepEqual(DEFAULT_CONTEXT_WINDOW, {
  limit: DEFAULT_CONTEXT_LIMIT,
  keep: DEFAULT_CONTEXT_KEEP
});
assert.deepEqual(DEFAULT_COMPACT_CONTEXT, {
  enabled: true,
  limit: DEFAULT_CONTEXT_LIMIT,
  keep: DEFAULT_CONTEXT_KEEP
});
assert.ok(
  DEFAULT_CONTEXT_KEEP + MIN_CONTEXT_GAP <= DEFAULT_CONTEXT_LIMIT,
  "the shipped pair must itself satisfy the rule typed pairs are held to"
);

// Nothing stored, nothing typed: the shipped pair.
assert.deepEqual(normalizeContextWindow(), DEFAULT_CONTEXT_WINDOW);
assert.deepEqual(normalizeContextWindow(null), DEFAULT_CONTEXT_WINDOW);
assert.deepEqual(normalizeContextWindow({}), DEFAULT_CONTEXT_WINDOW);

// A pair that is already legal is returned as it was typed.
assert.deepEqual(normalizeContextWindow({ limit: 120, keep: 30 }), {
  limit: 120,
  keep: 30
});

// `keep` wins a disagreement. Sending fewer recent turns verbatim than the
// athlete asked for is the change they would notice; rolling more often than
// they asked for is the one they would not.
assert.deepEqual(normalizeContextWindow({ limit: 10, keep: 40 }), {
  limit: 40 + MIN_CONTEXT_GAP,
  keep: 40
});
assert.deepEqual(normalizeContextWindow({ limit: 20, keep: 20 }), {
  limit: 20 + MIN_CONTEXT_GAP,
  keep: 20,
});

// Both ends are bounded, and a fraction is not a count of entries.
assert.deepEqual(normalizeContextWindow({ limit: 1e9, keep: 1e9 }), {
  limit: MAX_CONTEXT_LIMIT,
  keep: MAX_CONTEXT_LIMIT - MIN_CONTEXT_GAP
});
assert.deepEqual(normalizeContextWindow({ limit: -5, keep: -5 }), {
  limit: MIN_CONTEXT_KEEP + MIN_CONTEXT_GAP,
  keep: MIN_CONTEXT_KEEP
});
assert.deepEqual(normalizeContextWindow({ limit: 60.4, keep: 20.6 }), {
  limit: 60,
  keep: 21
});

// A half-written pair — one key from an older version, the other absent — reads
// as "this half was set, the other is the default", never as NaN.
assert.deepEqual(normalizeContextWindow({ keep: 50 }), {
  limit: DEFAULT_CONTEXT_LIMIT,
  keep: 50
});
assert.deepEqual(normalizeContextWindow({ keep: 100 }), {
  limit: 104,
  keep: 100
});
assert.deepEqual(normalizeContextWindow({ limit: "80", keep: undefined }), {
  limit: 80,
  keep: DEFAULT_CONTEXT_KEEP
});
assert.deepEqual(normalizeContextWindow({ limit: "abc", keep: {} }), {
  limit: DEFAULT_CONTEXT_LIMIT,
  keep: DEFAULT_CONTEXT_KEEP
});

// ---------------------------------------------------------------------------
// Transcript → wire
// ---------------------------------------------------------------------------

// Only entries that carry words. The cards are renderings of tool output the
// model already narrated, and replaying them would be the same facts twice.
assert.deepEqual(
  toWireMessages([
    message(0),
    { kind: "planDraft", draft: { id: "d1" } },
    { kind: "activityVisual", preview: { previewId: "p1" } },
    { kind: "fitnessTrend", preview: { previewId: "p2" } },
    { kind: "hrZoneSummary", preview: { previewId: "p3" } },
    { kind: "workoutDelete", preview: { requestId: "r1" } },
    message(1)
  ]),
  [
    { role: "user", content: "entry 0" },
    { role: "assistant", content: "entry 1" }
  ]
);

// Blank content is not a turn.
assert.deepEqual(
  toWireMessages([{ kind: "message", role: "user", content: "   " }]),
  []
);

// A coachPrompt is a turn of the conversation and is expanded, not dropped.
// The main-process copy used to drop it, so a coach could not see what it had
// asked and asked again; that divergence is why there is now one function.
{
  const answered = toWireMessages([
    {
      kind: "coachPrompt",
      prompt: {
        promptId: "p1",
        question: "Which day is your long run?",
        choices: [{ id: "sat", label: "Saturday" }, { id: "sun", label: "Sunday" }],
        answer: "Saturday",
        answeredAt: 1
      }
    }
  ]);
  assert.equal(answered.length, 2);
  assert.equal(answered[0].role, "assistant");
  assert.match(answered[0].content, /Which day is your long run\?/);
  assert.match(answered[0].content, /- Saturday/);
  assert.deepEqual(answered[1], { role: "user", content: "Saturday" });

  const unanswered = toWireMessages([
    {
      kind: "coachPrompt",
      prompt: { promptId: "p2", question: "How is the calf?", choices: [] }
    }
  ]);
  assert.equal(unanswered.length, 1, "an unanswered prompt is the question alone");
  assert.equal(unanswered[0].role, "assistant");
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

// Exactly at the limit is under it; one past trips the roll.
{
  const settled = planTranscriptContext(transcript(DEFAULT_CONTEXT_LIMIT), {
    through: 0
  });
  assert.deepEqual(settled.toSummarise, []);
  assert.equal(settled.tail.length, DEFAULT_CONTEXT_LIMIT);
  assert.equal(settled.through, 0);

  const rolling = planTranscriptContext(transcript(DEFAULT_CONTEXT_LIMIT + 1), {
    through: 0
  });
  assert.equal(rolling.tail.length, DEFAULT_CONTEXT_KEEP);
  assert.equal(
    rolling.through,
    DEFAULT_CONTEXT_LIMIT + 1 - DEFAULT_CONTEXT_KEEP
  );
  // Nothing is ever dropped: every entry is in the summary or in the tail.
  assert.deepEqual(
    [...contentsOf(rolling.toSummarise), ...contentsOf(rolling.tail)],
    contentsOf(transcript(DEFAULT_CONTEXT_LIMIT + 1))
  );
}

// The count is measured from the summary, not from the start: a settled
// conversation costs no roll at all until it runs `limit` past what is covered.
{
  const plan = planTranscriptContext(transcript(100), {
    summary: "So far.",
    through: 80
  });
  assert.deepEqual(plan.toSummarise, []);
  assert.equal(plan.summary, "So far.");
  assert.equal(plan.tail.length, 20);
}

// A custom window is obeyed in both directions.
{
  const narrow = planTranscriptContext(transcript(30), { through: 0 }, {
    limit: 20,
    keep: 6
  });
  assert.equal(narrow.toSummarise.length, 24);
  assert.equal(narrow.tail.length, 6);

  const wide = planTranscriptContext(transcript(100), { through: 0 }, {
    limit: 200,
    keep: 20
  });
  assert.deepEqual(wide.toSummarise, [], "a wider window defers the roll");
  assert.equal(wide.tail.length, 100);
}

// The pair is one fact. A summary with no count, a count with no summary, and a
// count past the end all read as *no summary* rather than as half of one.
for (const stored of [
  { summary: "Orphan." },
  { summary: "Orphan.", through: 0 },
  { summary: "Orphan.", through: -1 },
  { through: 40 },
  { summary: "Stale.", through: 999 }
]) {
  const plan = planTranscriptContext(transcript(100), stored);
  assert.equal(plan.summary, undefined, JSON.stringify(stored));
  assert.equal(
    plan.toSummarise.length + plan.tail.length,
    100,
    "and the whole transcript is accounted for from the top"
  );
}

// `force` rolls below the limit — but not below the tail, where a roll would
// spend a model call to summarise turns it then sends in full anyway.
{
  const forced = planTranscriptContext(transcript(30), { through: 0 }, DEFAULT_CONTEXT_WINDOW, {
    force: true
  });
  assert.equal(forced.toSummarise.length, 30 - DEFAULT_CONTEXT_KEEP);
  assert.equal(forced.tail.length, DEFAULT_CONTEXT_KEEP);

  const nothingToDo = planTranscriptContext(
    transcript(DEFAULT_CONTEXT_KEEP),
    { through: 0 },
    DEFAULT_CONTEXT_WINDOW,
    { force: true }
  );
  assert.deepEqual(nothingToDo.toSummarise, []);
  assert.equal(nothingToDo.tail.length, DEFAULT_CONTEXT_KEEP);

  // A forced roll leaves the conversation in the same shape a triggered one
  // does, so the two cannot disagree about where the tail starts.
  const triggered = planTranscriptContext(transcript(61), { through: 0 });
  const alsoForced = planTranscriptContext(transcript(61), { through: 0 }, DEFAULT_CONTEXT_WINDOW, {
    force: true
  });
  assert.deepEqual(alsoForced.through, triggered.through);
  assert.deepEqual(contentsOf(alsoForced.tail), contentsOf(triggered.tail));
}

// ---------------------------------------------------------------------------
// The summariser's own turn
// ---------------------------------------------------------------------------

{
  const first = buildRollingSummaryTurn(undefined, transcript(2));
  assert.match(first, /opening turns/);
  assert.doesNotMatch(first, /Running summary/);
  assert.match(first, /Athlete: entry 0/);
  assert.match(first, /Coach: entry 1/);

  const later = buildRollingSummaryTurn("Marathon in October.", transcript(2));
  assert.match(later, /--- Running summary ---/);
  assert.match(later, /Marathon in October\./);
  assert.match(later, /--- Newer turns ---/);
}

// The summary reaches the model as a labelled user turn, so it reads the same
// way to four providers and is obviously a compression rather than something
// the athlete just said.
{
  const framed = summaryContextMessage("Calf grumbling.");
  assert.equal(framed.role, "user");
  assert.match(framed.content, /\[Earlier in this conversation, summarised\]/);
  assert.match(framed.content, /Calf grumbling\./);
  assert.match(framed.content, /the recent turns in full/);
}

// ---------------------------------------------------------------------------
// Applying a plan
// ---------------------------------------------------------------------------

/** A world that records what the roll was asked for and what was stored. */
function harness({ result = "Rolled.", usage, reason } = {}) {
  const state = { rolls: [], writes: [] };
  return {
    state,
    roll: async (previous, entries) => {
      state.rolls.push({ previous, count: entries.length });
      return {
        summary: result,
        ...(usage ? { usage } : {}),
        ...(reason ? { reason } : {})
      };
    },
    store: (summary, through) => state.writes.push({ summary, through })
  };
}

// A short transcript costs nothing and writes nothing.
{
  const world = harness();
  const result = await applyTranscriptContext({
    entries: transcript(10),
    stored: { through: 0 },
    roll: world.roll,
    store: world.store
  });
  assert.equal(result.rolled, false);
  assert.equal(result.failed, false);
  assert.equal(result.tailStart, 0);
  assert.deepEqual(world.state.rolls, []);
  assert.deepEqual(world.state.writes, []);
  assert.deepEqual(contextMessages(result).map((m) => m.content), contentsOf(transcript(10)));
}

// A long one rolls once, stores the pair, and reports where the tail starts.
{
  const world = harness({ usage: { inputTokens: 90, outputTokens: 20 } });
  const result = await applyTranscriptContext({
    entries: transcript(100),
    stored: { through: 0 },
    roll: world.roll,
    store: world.store
  });
  assert.equal(result.rolled, true);
  assert.equal(result.failed, false);
  assert.equal(result.summary, "Rolled.");
  assert.equal(result.through, 80);
  assert.equal(result.tailStart, 80, "the caller can slice its own array by this");
  assert.deepEqual(world.state.rolls, [{ previous: undefined, count: 80 }]);
  assert.deepEqual(world.state.writes, [{ summary: "Rolled.", through: 80 }]);
  assert.deepEqual(result.usage, { inputTokens: 90, outputTokens: 20 });

  const wire = contextMessages(result);
  assert.match(wire[0].content, /Rolled\./);
  assert.equal(wire.length, 1 + DEFAULT_CONTEXT_KEEP);
}

// A roll that fails costs more this once and loses nothing: everything the
// stored summary does not already cover still goes, untrimmed.
{
  const world = harness({ result: null, usage: { inputTokens: 40, outputTokens: 0 } });
  const result = await applyTranscriptContext({
    entries: transcript(100),
    stored: { summary: "Earlier.", through: 10 },
    roll: world.roll,
    store: world.store
  });
  assert.equal(result.rolled, true);
  assert.equal(result.failed, true);
  assert.equal(result.summary, "Earlier.", "the stored summary still stands");
  assert.equal(result.through, 10, "and the count does not move");
  assert.deepEqual(world.state.writes, [], "nothing is stored that was not written");
  assert.equal(result.tailStart, 10);
  assert.equal(result.tail.length, 90);
  assert.deepEqual(
    result.usage,
    { inputTokens: 40, outputTokens: 0 },
    "a summariser that spent and then declined still spent"
  );
}

// A failure carries its reason out. Best-effort silence is right for the
// per-turn pass, but the athlete's own "Compact context" needs to say why
// nothing happened — a dead button with a generic message is how a real
// provider error reads as a bug in the feature.
{
  const world = harness({ result: null, reason: "the summariser answered with nothing" });
  const result = await applyTranscriptContext({
    entries: transcript(100),
    stored: { through: 0 },
    roll: world.roll,
    store: world.store
  });
  assert.equal(result.failed, true);
  assert.equal(result.failureReason, "the summariser answered with nothing");
}

// A roll that succeeds carries no reason, so a caller cannot render one.
{
  const world = harness();
  const result = await applyTranscriptContext({
    entries: transcript(100),
    stored: { through: 0 },
    roll: world.roll,
    store: world.store
  });
  assert.equal(result.failed, false);
  assert.equal(result.failureReason, undefined);
}

// A roll that failed without saying why still reports the failure — the reason
// is optional, and a caller must not depend on it being there.
{
  const world = harness({ result: null });
  const result = await applyTranscriptContext({
    entries: transcript(100),
    stored: { through: 0 },
    roll: world.roll,
    store: world.store
  });
  assert.equal(result.failed, true);
  assert.equal(result.failureReason, undefined);
}

// A forced roll on a conversation the window would have left alone.
{
  const world = harness();
  const result = await applyTranscriptContext({
    entries: transcript(30),
    stored: { through: 0 },
    force: true,
    roll: world.roll,
    store: world.store
  });
  assert.equal(result.rolled, true);
  assert.equal(result.tailStart, 10);
  assert.deepEqual(world.state.writes, [{ summary: "Rolled.", through: 10 }]);

  // The same conversation without `force` is left alone, which is what makes
  // the assertion above about `force` rather than about the transcript.
  const untouched = harness();
  const same = await applyTranscriptContext({
    entries: transcript(30),
    stored: { through: 0 },
    roll: untouched.roll,
    store: untouched.store
  });
  assert.equal(same.rolled, false);
  assert.deepEqual(untouched.state.rolls, []);
}

// The tail the caller is told about is the tail it gets: `tailStart` must index
// the array that was handed in, or a caller slicing by it sends the wrong turns.
for (const [count, stored] of [
  [100, { through: 0 }],
  [100, { summary: "Earlier.", through: 40 }],
  [10, { through: 0 }]
]) {
  const world = harness();
  const entries = transcript(count);
  const result = await applyTranscriptContext({
    entries,
    stored,
    roll: world.roll,
    store: world.store
  });
  assert.deepEqual(
    contentsOf(entries.slice(result.tailStart)),
    contentsOf(result.tail),
    `tailStart must index the caller's array (${count}, ${JSON.stringify(stored)})`
  );
}

// ---------------------------------------------------------------------------
// The IPC entry point's policy
// ---------------------------------------------------------------------------

const { compactChatSessionContext, inspectChatSessionContext } = await import(
  `${distUrl("chatContextService.js")}?cacheBust=${Date.now()}`
);

/** The three decisions the handler makes, with nothing behind them. */
function handlerWorld({ enabled = true, stored = transcript(50) } = {}) {
  const state = { compacts: [], loads: 0 };
  return {
    state,
    deps: {
      enabled: () => enabled,
      loadEntries: (sessionId) => {
        state.loads += 1;
        state.loadedFor = sessionId;
        return stored;
      },
      compact: async (sessionId, entries, options) => {
        state.compacts.push({ sessionId, count: entries.length, options });
        return {
          summary: "Rolled.",
          tail: entries.slice(-5),
          tailStart: Math.max(0, entries.length - 5),
          through: Math.max(0, entries.length - 5),
          rolled: true,
          failed: false
        };
      }
    }
  };
}

// Entries the window handed over are used as they are: reading them back from
// disk would race the window's own saves.
{
  const world = handlerWorld();
  const result = await compactChatSessionContext(
    "s1",
    transcript(12),
    {},
    world.deps
  );
  assert.equal(world.state.loads, 0, "nothing is read back from disk");
  assert.equal(world.state.compacts[0].count, 12);
  assert.equal(result.entryCount, 12);
  assert.equal(result.tailStart, 7);
  assert.equal(result.tailLength, 5);
  assert.equal(result.summary, "Rolled.");
  assert.equal(result.rolled, true);
}

// Omitted entries — the conversation menu on a thread the window never opened.
{
  const world = handlerWorld({ stored: transcript(40) });
  const result = await compactChatSessionContext(
    "s9",
    undefined,
    { force: true },
    world.deps
  );
  assert.equal(world.state.loads, 1);
  assert.equal(world.state.loadedFor, "s9");
  assert.equal(world.state.compacts[0].count, 40);
  assert.equal(result.entryCount, 40);
}

// The switch off means send it whole — and costs no model call.
{
  const world = handlerWorld({ enabled: false });
  const result = await compactChatSessionContext(
    "s1",
    transcript(500),
    {},
    world.deps
  );
  assert.deepEqual(world.state.compacts, [], "no roll while it is switched off");
  assert.equal(result.tailStart, 0);
  assert.equal(result.rolled, false);
  assert.equal(result.summary, undefined);
  assert.equal(result.tailLength, 500, "the whole transcript is the tail");
  assert.equal(result.entryCount, 500);
}

// ...but the athlete asking for one by name still gets one. The switch governs
// the per-turn pass, not the menu action.
{
  const world = handlerWorld({ enabled: false });
  const result = await compactChatSessionContext(
    "s1",
    transcript(30),
    { force: true },
    world.deps
  );
  assert.equal(world.state.compacts.length, 1);
  assert.deepEqual(world.state.compacts[0].options, { force: true });
  assert.equal(result.rolled, true);
}

// `force` is passed on only when it was asked for, so a per-turn pass can never
// roll a conversation the window would have left alone.
{
  const world = handlerWorld();
  await compactChatSessionContext("s1", transcript(30), {}, world.deps);
  assert.deepEqual(world.state.compacts[0].options, {});
}

// The handler passes a failure reason on to the window rather than flattening
// it into a bare `failed`, which is what the menu action shows.
{
  const world = handlerWorld();
  world.deps.compact = async (_sessionId, entries) => ({
    tail: entries,
    tailStart: 0,
    through: 0,
    rolled: true,
    failed: true,
    failureReason: "Claude request failed (429)"
  });
  const result = await compactChatSessionContext(
    "s1",
    transcript(100),
    { force: true },
    world.deps
  );
  assert.equal(result.failed, true);
  assert.equal(result.failureReason, "Claude request failed (429)");
  assert.equal(result.tailLength, 100, "and the whole tail is still what to send");
}

// An empty transcript answers "send it whole" rather than erroring, which is
// what a conversation that has been deleted out from under the menu looks like.
{
  const world = handlerWorld({ stored: [] });
  const result = await compactChatSessionContext(
    "gone",
    undefined,
    { force: true },
    world.deps
  );
  assert.equal(result.entryCount, 0);
  assert.equal(result.tailStart, 0);
  assert.equal(result.tailLength, 0);
}

// ---------------------------------------------------------------------------
// The dev-build inspector
// ---------------------------------------------------------------------------

function inspectWorld({
  enabled = true,
  window: contextWindow = DEFAULT_CONTEXT_WINDOW,
  stored = { through: 0 },
  entries = transcript(10)
} = {}) {
  const state = { loads: 0, rolls: 0, writes: 0 };
  return {
    state,
    deps: {
      enabled: () => enabled,
      window: () => contextWindow,
      stored: () => stored,
      loadEntries: (sessionId) => {
        state.loads += 1;
        state.loadedFor = sessionId;
        return entries;
      }
    }
  };
}

// A settled conversation: no summary, everything verbatim, nothing pending.
{
  const world = inspectWorld({ entries: transcript(6) });
  const view = inspectChatSessionContext("s1", transcript(6), world.deps);
  assert.equal(world.state.loads, 0, "the handed-over transcript is used as-is");
  assert.equal(view.summary, undefined);
  assert.equal(view.through, 0);
  assert.equal(view.entryCount, 6);
  assert.equal(view.tailStart, 0);
  assert.deepEqual(view.pending, []);
  assert.equal(view.tail.length, 6);
  assert.equal(view.enabled, true);
  assert.deepEqual(view.window, DEFAULT_CONTEXT_WINDOW);
  assert.equal(
    view.characterCount,
    contentsOf(transcript(6)).join("").length,
    "characters count the turns, not the entries"
  );
}

// A rolled conversation reports the stored summary and where the tail begins.
{
  const world = inspectWorld({ stored: { summary: "Marathon in October.", through: 80 } });
  const view = inspectChatSessionContext("s1", transcript(100), world.deps);
  assert.equal(view.summary, "Marathon in October.");
  assert.equal(view.through, 80);
  assert.equal(view.tailStart, 80);
  assert.deepEqual(view.pending, [], "nothing is due yet");
  assert.equal(view.tail.length, 20);
  // The summary turn is part of what the next message sends, so it counts.
  assert.ok(
    view.characterCount >
      contentsOf(transcript(100).slice(80)).join("").length,
    "the summary turn is included in the character count"
  );
}

// A roll due but not run: `through` is what the summary covers **now**, not
// what it will cover, and the turns about to be folded in are still going over
// in full — which is the whole reason this view separates the two.
{
  const world = inspectWorld({ stored: { summary: "Earlier.", through: 10 } });
  const view = inspectChatSessionContext("s1", transcript(100), world.deps);
  assert.equal(view.through, 10, "not 80 — that is the count after the roll");
  assert.equal(view.pending.length, 70);
  assert.equal(view.tail.length, 20);
  assert.equal(view.tailStart, 80);
  assert.equal(
    view.pending.length + view.tail.length,
    100 - 10,
    "and together they are everything the summary does not cover"
  );
}

// An invalid pair reads as no summary here too, so the inspector agrees with
// what a turn would actually send rather than reporting the broken row.
{
  const world = inspectWorld({ stored: { summary: "Stale.", through: 999 } });
  const view = inspectChatSessionContext("s1", transcript(20), world.deps);
  assert.equal(view.summary, undefined);
  assert.equal(view.through, 0);
  assert.equal(view.tail.length, 20);
}

// Switched off: the plan is still shown — "what would this send if it were on"
// is the question the inspector is open to answer — and `enabled` says which.
{
  const world = inspectWorld({ enabled: false, stored: { summary: "Earlier.", through: 10 } });
  const view = inspectChatSessionContext("s1", transcript(100), world.deps);
  assert.equal(view.enabled, false);
  assert.equal(view.pending.length, 70, "the plan is reported regardless");
}

// The configured window is reported and obeyed, not the shipped default.
{
  const world = inspectWorld({ window: { limit: 20, keep: 6 } });
  const view = inspectChatSessionContext("s1", transcript(30), world.deps);
  assert.deepEqual(view.window, { limit: 20, keep: 6 });
  assert.equal(view.tail.length, 6);
  assert.equal(view.pending.length, 24);
}

// Entries omitted — the menu on a conversation the window never opened.
{
  const world = inspectWorld({ entries: transcript(7) });
  const view = inspectChatSessionContext("s9", undefined, world.deps);
  assert.equal(world.state.loads, 1);
  assert.equal(world.state.loadedFor, "s9");
  assert.equal(view.entryCount, 7);
}

// It is synchronous and touches no roll or write seam at all: there is nothing
// in its deps that could spend a token, which is the guarantee that matters.
assert.deepEqual(
  Object.keys(inspectWorld().deps).sort(),
  ["enabled", "loadEntries", "stored", "window"],
  "the inspector must have no way to roll or to write"
);

// ---------------------------------------------------------------------------
// The coach is told what it has made, and what was done to it (P1.3)
// ---------------------------------------------------------------------------
{
  const planCard = (overrides = {}) => ({
    kind: "planDraft",
    draft: {
      draftId: "d1",
      artifactType: "plan",
      name: "Base block",
      summary: "2 weeks · 2 sessions a week · Run",
      entries: [
        { key: "a", name: "Easy", scheduleDate: "2099-08-03", volume: "45 min", saveToLibrary: true, workoutType: "Easy", stepsSummary: "Z2" },
        { key: "b", name: "Long", scheduleDate: "2099-08-09", volume: "90 min", saveToLibrary: true, workoutType: "Long" }
      ],
      conflicts: [],
      warnings: [],
      ...overrides
    }
  });
  const conversation = [
    { kind: "message", role: "user", content: "Write me a block" },
    planCard(),
    { kind: "message", role: "assistant", content: "Here it is" },
    { kind: "message", role: "user", content: "Is Sunday too long?" }
  ];

  assert.equal(creationIndex(conversation.filter((entry) => entry.kind === "message"), []), null, "nothing made, nothing said");
  const index = creationIndex(conversation, []);
  assert.match(index, /newest version of each/);
  assert.match(
    index,
    /- Plan "Base block" · draft_id d1 · v1 by you · 2 weeks · 2 sessions a week · Run · not saved/,
    "a card the version list does not know is its own first version"
  );
  const wire = withCreationIndex(toWireMessages(conversation), conversation, []);
  assert.equal(wire.length, 3, "the card never goes on the wire, and the index is no message of its own");
  assert.ok(wire[2].content.startsWith(index), "it rides in front of the latest question");
  assert.ok(wire[2].content.endsWith("Is Sunday too long?"), "which is kept whole");
  assert.equal(wire[0].content, "Write me a block", "earlier turns are untouched");

  // Two versions of one creation: only the newest is listed, with who made it.
  const v2 = planCard({ draftId: "d2", name: "Base block, Sunday long", editedAt: 9 });
  const versioned = [...conversation, v2];
  const versions = [
    { draftId: "d1", artifactId: "d1", version: 1, author: "coach", name: "Base block", createdAt: 1 },
    { draftId: "d2", artifactId: "d1", version: 2, author: "athlete", name: "Base block, Sunday long", createdAt: 2 }
  ];
  const listed = creationIndex(versioned, versions);
  assert.doesNotMatch(listed, /draft_id d1/, "an older version is not listed");
  assert.match(listed, /Plan "Base block, Sunday long" · draft_id d2 · v2 by the athlete · edited by the athlete/);

  const saved = creationIndex(
    [planCard({ uploadedAt: 7, uploadResult: { workoutsScheduled: 0, workoutsCreated: 2, destination: "nativePlan", planId: "P9" } })],
    []
  );
  assert.match(saved, /saved to COROS as plan P9$/);
  assert.match(
    creationIndex([planCard({ artifactType: "workout", uploadedAt: 7, uploadResult: { workoutsScheduled: 1, workoutsCreated: 1, destination: "calendar" } })], []),
    /- Workout "Base block" .* · on the calendar$/
  );
  assert.equal(creationIndex([planCard({ removedAt: 6 })], []), null, "a card taken out of the conversation is not listed");

  // An edit is said once, where it happened, riding on the athlete's next message.
  const event = {
    kind: "planEvent",
    event: {
      eventId: "e1",
      artifactId: "d1",
      draftId: "d1",
      action: "edited",
      author: "athlete",
      name: "Base block",
      artifactType: "plan",
      at: 8
    }
  };
  const edited = [
    conversation[0],
    conversation[1],
    conversation[2],
    event,
    { kind: "message", role: "user", content: "Is Sunday too long?" },
    { kind: "message", role: "assistant", content: "No." }
  ];
  const editedWire = toWireMessages(edited);
  assert.deepEqual(editedWire.map((item) => item.role), ["user", "assistant", "user", "assistant"], "roles still alternate");
  assert.match(editedWire[2].content, /^\[The athlete edited the plan "Base block" in the editor\. Its newest version is draft_id d1; read it with get_plan_draft/);
  assert.ok(editedWire[2].content.endsWith("Is Sunday too long?"));

  // With nothing after it, it goes on the athlete's last message; after an
  // answer with no question since, it stands as the athlete's turn.
  const trailing = toWireMessages([conversation[0], event]);
  assert.equal(trailing.length, 1);
  assert.ok(trailing[0].content.startsWith("Write me a block\n\n[The athlete edited"));
  const afterAnswer = toWireMessages([conversation[0], conversation[2], event]);
  assert.deepEqual(afterAnswer.map((item) => item.role), ["user", "assistant", "user"]);

  const restored = planEventNote({ ...event.event, action: "restored", fromVersion: 3, toVersion: 4, changes: ["Long run back to Saturday"] });
  assert.match(restored, /restored an earlier version of the plan "Base block" \(v3 → v4\)\. Changes: Long run back to Saturday\./);
  assert.match(planEventNote({ ...event.event, action: "imported", author: "coros" }), /changed in the Training Library or on COROS/);
}

// ---------------------------------------------------------------------------
// What the athlete pointed at rides on their question (P1.7)
// ---------------------------------------------------------------------------
{
  const refs = {
    kind: "planRefs",
    refs: [
      {
        artifactId: "d1",
        draftId: "d3",
        version: 3,
        name: "Base block",
        artifactType: "plan",
        scope: "session",
        weekIndex: 5,
        sessionKey: "long",
        label: "Week 6 (Build) · Sun · Long run"
      }
    ]
  };
  const wire = toWireMessages([
    { kind: "message", role: "user", content: "Write me a block" },
    { kind: "message", role: "assistant", content: "Here it is" },
    refs,
    { kind: "message", role: "user", content: "Is this too long?" }
  ]);
  assert.deepEqual(wire.map((item) => item.role), ["user", "assistant", "user"], "no message of its own");
  assert.equal(
    wire[2].content,
    '[The athlete is asking about the plan "Base block" v3 (draft_id d3) — Week 6 (Build) · Sun · Long run. Read it with get_plan_draft if you need more than this.]\n\nIs this too long?'
  );
  assert.match(
    planRefsNote([{ ...refs.refs[0], scope: "plan", version: undefined, label: "the whole plan" }]),
    /the plan "Base block" \(draft_id d3\) — the whole of it/
  );
}

// P3.3: what became of each calendar proposal is said to the coach, from the row.
{
  const proposal = {
    changeSetId: "sc-1",
    summary: "Rest while ill",
    lines: [
      { lineId: "l1", op: "move", label: 'Move "Long run" from Sat 27 Sep to Sun 28 Sep', status: "applied" },
      { lineId: "l2", op: "replace", label: 'Replace "Tempo" on Thu 25 Sep with "Easy 30"', status: "stale", reason: "It is now \"Hills\"." },
      { lineId: "l3", op: "remove", label: 'Remove "Strides" from Fri 26 Sep', status: "dismissed" },
      { lineId: "l4", op: "add", label: 'Add "Walk" on Mon 29 Sep', status: "proposed" }
    ],
    createdAt: "x",
    updatedAt: "x"
  };
  const entries = [
    { kind: "message", role: "user", content: "I am ill" },
    { kind: "scheduleChange", changeSetId: "sc-1" },
    { kind: "scheduleChange", changeSetId: "sc-gone" }
  ];
  const index = creationIndex(entries, [], [], [proposal]);
  assert.match(index, /A calendar proposal is applied by the athlete, line by line, from its card\./);
  assert.match(
    index,
    /- Calendar proposal "Rest while ill" · 1 applied · 1 out of date \(Replace "Tempo" on Thu 25 Sep with "Easy 30": It is now "Hills"\.\) · 1 dismissed · 1 not decided yet$/m
  );
  assert.equal(index.split("\n").length, 2, "a set the store no longer holds is not listed");
  assert.equal(creationIndex(entries, [], [], []), null, "with nothing read, nothing is said");
}

// P3.5: the calendar or a COROS plan, pointed at, rides on the question with the ids the tools take.
{
  const wire = toWireMessages([
    { kind: "message", role: "assistant", content: "Hi" },
    {
      kind: "scheduleRefs",
      refs: [
        { scope: "week", day: "20260921", label: "Week of 21–27 Sep" },
        { scope: "session", day: "20260920", activityId: "act-9", label: "Sun 20 Sep · Long run" },
        { scope: "session", planId: "T1", idInPlan: "4", label: "Tempo · Week 2 · Thu · Base block" }
      ]
    },
    { kind: "message", role: "user", content: "Too much?" }
  ]);
  assert.equal(wire.length, 2, "no message of its own");
  assert.equal(
    wire[1].content,
    "[The athlete is asking about the week Week of 21–27 Sep (from 20260921; read it with list_scheduled_workouts); " +
      "and the activity Sun 20 Sep · Long run (activity_id act-9); " +
      "and the session Tempo · Week 2 · Thu · Base block (plan_id T1, id_in_plan 4). " +
      "Read what you need with list_scheduled_workouts, get_training_plan or get_activity_detail.]\n\nToo much?"
  );
}

console.log("chat context compaction tests passed");
