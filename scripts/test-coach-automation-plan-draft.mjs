import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Module = require("node:module");
const repoRoot = path.resolve(import.meta.dirname, "..");

const fakeElectron = {
  BrowserWindow: Object.assign(class {}, { getAllWindows: () => [] }),
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

const { createCollectorSink } = require(
  path.join(repoRoot, "dist-electron", "chatService.js")
);
const { parseChatTranscriptJson } = require(
  path.join(repoRoot, "dist-electron", "chatHistoryStore.js")
);
const { applyChatToolPolicy } = require(
  path.join(repoRoot, "dist-electron", "chatService.js")
);

// Decision 3: an auto run may draft and propose, never write. The card the
// athlete confirms goes through chat:uploadPlanDraft, which is not a tool — so
// this walks the whole path a drafted plan takes out of a headless run.

// --- the draft tool is reachable from an auto run, the write tool is not ----
const toolNames = applyChatToolPolicy(
  [
    { name: "draft_training_plan" },
    { name: "draft_workout" },
    { name: "upload_training_plan" },
    { name: "delete_workout" }
  ],
  "read-only"
).map((tool) => tool.name);
assert.deepEqual(toolNames, ["draft_training_plan", "draft_workout"]);

// --- a drafted plan survives the run's persistence path --------------------
// The exact shape buildPlanPreview produces, which the store's parser accepts.
const preview = {
  draftId: "draft-1",
  artifactType: "plan",
  name: "Marathon block week 3",
  summary: "5 sessions, 62 km",
  entries: [
    {
      key: "e1",
      name: "Tuesday tempo",
      sport: "run",
      scheduleDate: "2026-08-25",
      volume: "12 km",
      saveToLibrary: false,
      workoutType: "run",
      stepsSummary: "3 × 8 min @ threshold"
    }
  ],
  conflicts: [],
  warnings: []
};

const marker = {
  runId: "run-1",
  automationId: "auto-1",
  bindingId: "bind-1",
  name: "Weekly plan check",
  triggerLabel: "Weekly at 07:30"
};

const collector = createCollectorSink(marker);
collector.emit("chat:streamStart", { requestId: "run-1" });
collector.emit("chat:streamInfo", { kind: "planDraft", draft: preview });
collector.emit("chat:streamDone", {
  requestId: "run-1",
  fullText: "TLDR: Next week's block is ready to review."
});

const produced = collector.entries();
assert.deepEqual(
  produced.map((entry) => entry.kind),
  ["planDraft", "message"],
  "the run produced an approval card plus its answer"
);
assert.equal(produced[0].draft.draftId, "draft-1");

// The runner saves [...existing, syntheticUserTurn, ...produced]; what matters
// here is that the card survives the store's field-by-field rebuild.
const transcript = [
  { kind: "message", role: "user", content: "playbook text", automation: marker },
  ...produced.map((entry) =>
    entry.kind === "message" ? { ...entry, automation: marker } : entry
  )
];
const reloaded = parseChatTranscriptJson(JSON.stringify(transcript));
assert.deepEqual(
  reloaded.map((entry) => entry.kind),
  ["message", "planDraft", "message"],
  "the approval card is not dropped on reload"
);
const reloadedDraft = reloaded[1];
assert.equal(reloadedDraft.draft.draftId, "draft-1");
assert.equal(reloadedDraft.draft.entries.length, 1);
assert.equal(reloadedDraft.draft.name, "Marathon block week 3");

// --- and the renderer turns it back into a card entry ----------------------
// fromPersistedEntries lives in the renderer bundle as TypeScript; the mapping
// for planDraft is a straight pass-through, asserted here against the same
// object the store handed back so a future change to it fails this test.
const rendererSource = require("node:fs").readFileSync(
  path.join(repoRoot, "src", "chat", "chatTypes.ts"),
  "utf8"
);
assert.match(
  rendererSource,
  /if \(entry\.kind === "planDraft"\) \{\s*result\.push\(\{ kind: "planDraft", draft: entry\.draft \}\);/,
  "fromPersistedEntries no longer passes planDraft through unchanged"
);
assert.match(
  rendererSource,
  /if \(entry\.kind === "planDraft"\) \{\s*return \{ kind: "planDraft", draft: entry\.draft \};/,
  "toPersistedEntries no longer passes planDraft through unchanged"
);

// --- the draft id the card confirms with is the one the tool stored --------
// uploadPlanDraftById resolves from the draft store / chat_plan_drafts by id,
// with no notion of who created it, so an auto run's draft is confirmable the
// same way an interactive one is.
const workoutToolsSource = require("node:fs").readFileSync(
  path.join(repoRoot, "electron", "chatWorkoutTools.ts"),
  "utf8"
);
assert.match(
  workoutToolsSource,
  /function persistPlanDraft\([\s\S]*?saveChatPlanDraft\(/,
  "drafts are no longer persisted to chat_plan_drafts"
);
assert.match(
  workoutToolsSource,
  /export async function uploadPlanDraftById\(/,
  "the confirm path changed name"
);
assert.equal(
  /uploadPlanDraftById\([\s\S]{0,400}?toolPolicy/.test(workoutToolsSource),
  false,
  "the confirm path must not be gated by the read-only tool policy"
);

// R5. The three assertions above are about *names and shapes*, and a mutation
// pass showed what they cannot say: change the id `chatService` puts on the
// wire — `draft: { ...preview, draftId: preview.draftId + "-copy" }` — and all
// three still pass, while the athlete's confirmation card then looks up a draft
// that was never stored and the upload fails.
//
// The leg between the tool and the send is the one no suite can execute: it
// runs inside `handleChatWorkoutTool`, which needs COROS behind it. So this
// stays a source assertion, and it is tight on the one line that matters: the
// preview goes out **as it is**, with nothing between the tool and the wire.
const chatServiceSourceForDraft = require("node:fs").readFileSync(
  path.join(repoRoot, "electron", "chatService.ts"),
  "utf8"
);
const onPlanDraftBody = /onPlanDraft: \([^)]*\) => \{([\s\S]*?)\n      \},/.exec(
  chatServiceSourceForDraft
);
assert.ok(onPlanDraftBody, "the onPlanDraft callback moved; this claim needs re-aiming");
// Stated as a rule rather than as a shape. The first version of this assertion
// pinned the exact five lines and went red on a harmless extraction — brittle
// about layout, which is section 11's own complaint about regexes and no better
// for being mine. What actually matters is that this layer does not *touch* the
// id: it is the tool's, it is already in `chat_plan_drafts` under it, and the
// athlete's confirmation card looks the draft up by it.
assert.doesNotMatch(
  onPlanDraftBody[1],
  /draftId/,
  "the draft that reaches the card must carry the id the tool stored, untouched"
);

// The marker rides along on the answer, so the card is attributable too.
assert.deepEqual(reloaded[2].automation, marker);

Module._load = originalLoad;
console.log("coach automation plan draft tests passed");
