import fs from "node:fs";
import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Module = require("node:module");
const repoRoot = path.resolve(import.meta.dirname, "..");

// chatService is compiled to CommonJS for Electron and pulls in `electron` and
// the better-sqlite3 native binding at require time, neither of which loads
// under plain node. Stubbing the two lets this file cover the stream sink —
// the seam every headless automation run goes through — without an Electron
// harness. Nothing here touches the stubs; the sink is pure wiring.
const fakeElectron = {
  BrowserWindow: class {},
  app: { getPath: () => "/tmp", on: () => {}, whenReady: () => Promise.resolve() },
  safeStorage: { isEncryptionAvailable: () => false },
  shell: { openExternal: () => {} }
};
const originalLoad = Module._load;
Module._load = function patchedLoad(request, ...rest) {
  if (request === "electron") return fakeElectron;
  if (request === "better-sqlite3") return class FakeDatabase {};
  return originalLoad.call(this, request, ...rest);
};

const { countableUsage, createCollectorSink, createWindowSink } = require(
  path.join(repoRoot, "dist-electron", "chatService.js")
);
const { parseChatTranscriptJson } = require(
  path.join(repoRoot, "dist-electron", "chatHistoryStore.js")
);

function createFakeWindow() {
  const sent = [];
  const listeners = [];
  return {
    sent,
    listeners,
    destroyed: false,
    isDestroyed() {
      return this.destroyed;
    },
    webContents: {
      send(channel, payload) {
        sent.push([channel, payload]);
      }
    },
    once(event, handler) {
      listeners.push([event, handler]);
    },
    removeListener(event, handler) {
      const index = listeners.findIndex(
        ([name, entry]) => name === event && entry === handler
      );
      if (index >= 0) listeners.splice(index, 1);
    },
    close() {
      for (const [event, handler] of [...listeners]) {
        if (event === "closed") handler();
      }
    }
  };
}

// --- emit forwards to the renderer -----------------------------------------
const win = createFakeWindow();
const sink = createWindowSink(win);
sink.emit("chat:streamStart", { requestId: "r1" });
sink.emit("chat:streamDelta", { requestId: "r1", delta: "hi" });
assert.deepEqual(win.sent, [
  ["chat:streamStart", { requestId: "r1" }],
  ["chat:streamDelta", { requestId: "r1", delta: "hi" }]
]);

// --- a destroyed window swallows events instead of throwing ----------------
win.destroyed = true;
sink.emit("chat:streamDelta", { requestId: "r1", delta: "dropped" });
assert.equal(win.sent.length, 2, "nothing is sent to a destroyed window");
win.destroyed = false;

// --- no window at all is still a usable sink -------------------------------
const nullSink = createWindowSink(null);
nullSink.emit("chat:streamStart", { requestId: "r2" });
const undefinedSink = createWindowSink(undefined);
undefinedSink.emit("chat:streamStart", { requestId: "r3" });

// --- closing the window aborts the stream (today's behaviour) --------------
const abortWin = createFakeWindow();
const abortSink = createWindowSink(abortWin);
const controller = new AbortController();
const release = abortSink.bindAbort(controller);
assert.equal(abortWin.listeners.length, 1);
assert.equal(abortWin.listeners[0][0], "closed");
assert.equal(controller.signal.aborted, false);
abortWin.close();
assert.equal(controller.signal.aborted, true, "closing the window aborts the stream");

// --- teardown removes exactly the listener it added ------------------------
release();
assert.equal(abortWin.listeners.length, 0, "the closed listener is removed");
const afterRelease = new AbortController();
const secondWin = createFakeWindow();
const secondSink = createWindowSink(secondWin);
const secondRelease = secondSink.bindAbort(afterRelease);
secondRelease();
secondWin.close();
assert.equal(
  afterRelease.signal.aborted,
  false,
  "a released sink no longer aborts when the window closes"
);

// --- bindAbort tolerates a missing window ----------------------------------
const orphan = createWindowSink(null);
const orphanController = new AbortController();
orphan.bindAbort(orphanController)();
assert.equal(orphanController.signal.aborted, false);

// --- collector sink: the transcript an interactive turn would have built ---
const marker = {
  runId: "run-1",
  automationId: "auto-1",
  bindingId: "bind-1",
  name: "Morning briefing",
  triggerLabel: "Daily at 07:30"
};

function runStream(sink, events) {
  for (const [channel, payload] of events) sink.emit(channel, payload);
}

const collector = createCollectorSink(marker);
assert.equal(
  collector.bindAbort,
  undefined,
  "a collector must not abort when the window closes"
);
assert.deepEqual(collector.entries(), []);
assert.equal(collector.finished(), false);

// These card payloads are the shapes the store's parsers actually accept, so
// the collected transcript can be asserted against a reload further down.
const trendCard = { previewId: "p1", trendPoints: [] };
const promptCard = {
  promptId: "q1",
  question: "How do you feel?",
  allowCustom: true,
  // The store's parser requires at least two choices.
  choices: [
    { id: "c1", label: "Fresh", response: "I feel fresh." },
    { id: "c2", label: "Tired", response: "I feel tired." }
  ]
};

runStream(collector, [
  ["chat:streamStart", { requestId: "r1" }],
  ["chat:streamInfo", { kind: "context", snapshotIncluded: true, mcpEnabled: true }],
  ["chat:streamInfo", { kind: "thinking", delta: "checking " }],
  ["chat:streamInfo", { kind: "thinking", delta: "yesterday" }],
  ["chat:streamInfo", { kind: "mcp", status: "call", tool: "queryActivities" }],
  ["chat:streamInfo", { kind: "fitnessTrend", preview: trendCard }],
  ["chat:streamToken", { delta: "Easy " }],
  ["chat:streamToken", { delta: "40min." }],
  ["chat:streamInfo", { kind: "coachPrompt", prompt: promptCard }],
  ["chat:streamDone", { requestId: "r1", fullText: "Easy 40min." }]
]);

const built = collector.entries();
assert.equal(collector.finished(), true);
assert.equal(collector.cancelled(), false);
assert.equal(collector.error(), undefined);
assert.equal(collector.text(), "Easy 40min.");

// Cards land as they stream, the assistant message at done, prompts after it —
// the order ChatView produces.
assert.deepEqual(
  built.map((entry) => entry.kind),
  ["fitnessTrend", "message", "coachPrompt"]
);

// --- a re-emitted card replaces the first rather than appending ------------
const upserts = createCollectorSink();
runStream(upserts, [
  ["chat:streamStart", {}],
  ["chat:streamInfo", { kind: "planDraft", draft: { draftId: "d1", entries: [] } }],
  ["chat:streamInfo", { kind: "planDraft", draft: { draftId: "d1", entries: ["x"] } }],
  ["chat:streamInfo", { kind: "planDraft", draft: { draftId: "d2", entries: [] } }],
  ["chat:streamInfo", { kind: "workoutDelete", preview: { requestId: "w1", name: "a" } }],
  ["chat:streamInfo", { kind: "workoutDelete", preview: { requestId: "w1", name: "b" } }],
  ["chat:streamInfo", { kind: "activityVisual", preview: { previewId: "v1", n: 1 } }],
  ["chat:streamInfo", { kind: "activityVisual", preview: { previewId: "v1", n: 2 } }],
  ["chat:streamInfo", { kind: "hrZoneSummary", preview: { previewId: "z1", n: 1 } }],
  ["chat:streamInfo", { kind: "hrZoneSummary", preview: { previewId: "z1", n: 2 } }],
  ["chat:streamDone", {}]
]);
const upserted = upserts.entries();
assert.deepEqual(
  upserted.map((entry) => entry.kind),
  ["planDraft", "planDraft", "workoutDelete", "activityVisual", "hrZoneSummary"]
);
assert.deepEqual(upserted[0].draft.entries, ["x"], "same draftId replaced in place");
assert.equal(upserted[1].draft.draftId, "d2", "a different id appends");
assert.equal(upserted[2].preview.name, "b");
assert.equal(upserted[3].preview.n, 2);
assert.equal(upserted[4].preview.n, 2);
// A coachPrompt re-emitted under the same id collapses to one entry too.
const dedupedPrompts = createCollectorSink();
runStream(dedupedPrompts, [
  ["chat:streamStart", {}],
  ["chat:streamInfo", { kind: "coachPrompt", prompt: { promptId: "q1", v: 1 } }],
  ["chat:streamInfo", { kind: "coachPrompt", prompt: { promptId: "q1", v: 2 } }],
  ["chat:streamDone", {}]
]);
assert.equal(dedupedPrompts.entries().length, 1);
assert.equal(dedupedPrompts.entries()[0].prompt.v, 2);

const assistant = built[1];
assert.equal(assistant.role, "assistant");
assert.equal(assistant.content, "Easy 40min.");
assert.equal(assistant.reasoningSummary, "checking yesterday");
assert.deepEqual(assistant.automation, marker);
assert.deepEqual(assistant.source, {
  snapshotIncluded: true,
  mcpEnabled: true,
  mcpUsed: true,
  mcpTools: ["queryActivities"]
});

// --- no marker means no attribution ----------------------------------------
const plain = createCollectorSink();
runStream(plain, [
  ["chat:streamStart", {}],
  ["chat:streamDone", { fullText: "hello" }]
]);
assert.equal("automation" in plain.entries()[0], false);

// --- an mcp failure is recorded on the source ------------------------------
const failing = createCollectorSink();
runStream(failing, [
  ["chat:streamStart", {}],
  ["chat:streamInfo", { kind: "mcp", status: "error", tool: "queryPlans", message: "COROS timed out" }],
  ["chat:streamDone", { fullText: "partial answer" }]
]);
assert.equal(failing.entries()[0].source.mcpError, "COROS timed out");
assert.equal(failing.entries()[0].source.mcpUsed, true);
// The renderer-only toolNotice card is not persistable, so it is never built.
assert.equal(
  failing.entries().some((entry) => entry.kind === "toolNotice"),
  false
);

// --- fullText missing falls back to the accumulated tokens -----------------
const tokensOnly = createCollectorSink();
runStream(tokensOnly, [
  ["chat:streamStart", {}],
  ["chat:streamToken", { delta: "from " }],
  ["chat:streamToken", { delta: "tokens" }],
  ["chat:streamDone", {}]
]);
assert.equal(tokensOnly.entries()[0].content, "from tokens");

// --- a cancelled run keeps its cards but writes no assistant message -------
const cancelled = createCollectorSink(marker);
runStream(cancelled, [
  ["chat:streamStart", {}],
  ["chat:streamInfo", { kind: "planDraft", draft: { draftId: "d9", entries: [] } }],
  ["chat:streamToken", { delta: "half a th" }],
  ["chat:streamInfo", { kind: "coachPrompt", prompt: { promptId: "q9" } }],
  ["chat:streamDone", { fullText: "half a th", finishReason: "cancelled" }]
]);
assert.equal(cancelled.cancelled(), true);
assert.equal(cancelled.finished(), true);
assert.equal(cancelled.text(), "");
assert.deepEqual(
  cancelled.entries().map((entry) => entry.kind),
  ["planDraft"],
  "a cancelled turn drops its assistant message and pending prompts"
);

// --- an errored run reports the message and writes no message entry --------
const errored = createCollectorSink();
runStream(errored, [
  ["chat:streamStart", {}],
  ["chat:streamToken", { delta: "partial" }],
  ["chat:streamError", { message: "Claude is not authenticated." }]
]);
assert.equal(errored.finished(), true);
assert.equal(errored.error(), "Claude is not authenticated.");
assert.deepEqual(errored.entries(), []);

const namelessError = createCollectorSink();
namelessError.emit("chat:streamError", {});
assert.equal(namelessError.error(), "Chat request failed.");

// --- malformed cards are skipped, not half-built ---------------------------
const junk = createCollectorSink();
runStream(junk, [
  ["chat:streamStart", {}],
  ["chat:streamInfo", { kind: "planDraft" }],
  ["chat:streamInfo", { kind: "fitnessTrend", preview: {} }],
  ["chat:streamInfo", { kind: "coachPrompt", prompt: {} }],
  ["chat:streamInfo", { kind: "unknownFutureCard", preview: { previewId: "p" } }],
  ["chat:streamDone", { fullText: "ok" }]
]);
assert.deepEqual(junk.entries().map((entry) => entry.kind), ["message"]);

// --- entries() hands back a copy -------------------------------------------
const copies = createCollectorSink();
runStream(copies, [["chat:streamDone", { fullText: "x" }]]);
copies.entries().push({ kind: "message", role: "user", content: "injected" });
assert.equal(copies.entries().length, 1);

// --- what the collector builds is what the store can reload ----------------
// The two halves of section 5.6 only work together: a collected entry the
// parser drops would vanish the moment the athlete reopens the conversation.
const persisted = parseChatTranscriptJson(JSON.stringify(built));
assert.deepEqual(persisted, built, "every collected entry survives the store");
assert.deepEqual(persisted[1].automation, marker);

// --- 13: a failed turn is not a refund -------------------------------------
// Usage used to reach the collector only on `chat:streamDone`, which a stream
// that errors never sends — so *no* failed automation run ever recorded what it
// spent, and a provider that reliably breaks could run through the month's
// ceiling for free. That is the exact hole section 13 says it closed, and the
// runner's own suite could not see it: its fake collector reported usage on
// every path, including the one the real collector had nothing to report on.
{
  const failed = createCollectorSink();
  runStream(failed, [
    ["chat:streamToken", { requestId: "r", delta: "Looking" }],
    [
      "chat:streamError",
      {
        requestId: "r",
        message: "the provider fell over",
        usage: { inputTokens: 900, outputTokens: 40 }
      }
    ]
  ]);
  assert.equal(failed.error(), "the provider fell over");
  assert.deepEqual(
    failed.usage(),
    { inputTokens: 900, outputTokens: 40 },
    "a turn that broke on a later round still spent the earlier ones"
  );

  // And a provider that reports nothing on the way down leaves it unknown
  // rather than zero, exactly as it does on the way up.
  const silentAboutCost = createCollectorSink();
  runStream(silentAboutCost, [
    ["chat:streamError", { requestId: "r", message: "no idea what that cost" }]
  ]);
  assert.equal(
    silentAboutCost.usage(),
    undefined,
    "\"nobody told us\" is still a different fact from \"it was free\""
  );
}

// --- a report that cannot be counted is not a report ------------------------
// R4 step 8's closing review. The run row's *reader* now refuses a negative
// cost, but that only helps rows already on disk — this is where the number
// enters. `local` is whatever OpenAI-compatible server the athlete pointed the
// app at, and `stream_options: { include_usage: true }` is a request, not a
// promise: what comes back is that server's idea of a number.
{
  for (const [label, usage] of [
    ["negative input", { inputTokens: -900, outputTokens: 40 }],
    ["negative output", { inputTokens: 900, outputTokens: -40 }],
    ["NaN", { inputTokens: Number.NaN, outputTokens: 40 }],
    ["infinite", { inputTokens: Number.POSITIVE_INFINITY, outputTokens: 40 }],
    ["not a number at all", { inputTokens: "900", outputTokens: 40 }]
  ]) {
    const sink = createCollectorSink();
    runStream(sink, [
      ["chat:streamDone", { requestId: "r", fullText: "done", usage }]
    ]);
    assert.equal(
      sink.usage(),
      undefined,
      `${label}: an uncountable report reads as unreported, not as a number`
    );
  }

  // The two that *are* answers still are. Zero most of all: a cancelled turn
  // that never reached the model genuinely cost nothing, and 13 needs that to
  // stay distinct from nobody counting.
  // The rule itself, driven directly: it is the one piece of this that a test
  // can execute, because `addUsage` lives inside `streamChat` and `streamChat`
  // needs a provider, a database and a network.
  assert.equal(countableUsage(undefined), undefined);
  assert.equal(countableUsage({ inputTokens: -1, outputTokens: 0 }), undefined);
  assert.equal(countableUsage({ inputTokens: 0, outputTokens: -1 }), undefined);
  assert.equal(countableUsage({ inputTokens: Number.NaN, outputTokens: 0 }), undefined);
  assert.deepEqual(countableUsage({ inputTokens: 12, outputTokens: 3 }), {
    inputTokens: 12,
    outputTokens: 3
  });

  const free = createCollectorSink();
  runStream(free, [
    [
      "chat:streamDone",
      { requestId: "r", fullText: "", usage: { inputTokens: 0, outputTokens: 0 } }
    ]
  ]);
  assert.deepEqual(free.usage(), { inputTokens: 0, outputTokens: 0 });
}

// --- and the emitting half, which no suite can execute ----------------------
// Genuinely about source: driving `streamChat` to a real provider failure needs
// a provider, a database and a network, and the collector above *is* the stub
// that would stand in for them. What can rot silently is the send itself —
// dropping `usage` from an error payload type-checks and compiles into a call
// that under-reports — so the rule is one function rather than a habit at each
// throw site, and this asserts the function still carries it.
{
  const source = fs.readFileSync(
    path.join(repoRoot, "electron", "chatService.ts"),
    "utf8"
  );
  assert.match(
    source,
    /const sendStreamError = \(payload: \{[\s\S]{0,240}?\.\.\.\(usage \? \{ usage \} : \{\}\)/,
    "the one error send must carry what the turn spent"
  );
  assert.equal(
    (source.match(/send\("chat:streamError"/g) ?? []).length,
    1,
    "and it must be the only one, or the rule is back to being remembered"
  );

  // The per-round half of the usage guard, for the same reason. A round that
  // reports a negative would reduce a total the month's budget trusts, and the
  // collector above cannot see it: by the time a report reaches `chat:streamDone`
  // the rounds have already been summed. The rule has to run where they are
  // added up, and that is inside `streamChat`.
  assert.match(
    source,
    /const addUsage = \([^)]*\) => \{\s*\n\s*const counted = countableUsage\(round\);/,
    "every tool round's report must go through the same rule"
  );
}

Module._load = originalLoad;
console.log("chat stream sink tests passed");
