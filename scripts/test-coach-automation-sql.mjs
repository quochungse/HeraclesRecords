// The SQL the in-memory fakes stand in for. Every other coach-automation suite
// injects a hand-written database so it can run under plain node; that means a
// WHERE clause can be wrong in database.ts and every one of them still passes.
// This one opens a real SQLite file, which is why it runs under Electron:
// better-sqlite3 is built for the Electron ABI and will not dlopen otherwise.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distUrl = (file) =>
  `${pathToFileURL(path.join(repoRoot, "dist-electron", file)).href}?cacheBust=${Date.now()}`;
const database = await import(distUrl("database.js"));

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "coroslink-coach-sql-"));
database.initializeDatabase(tempRoot);

const run = (patch) => ({
  id: patch.id,
  automation_id: patch.automation_id ?? "auto-1",
  binding_id: patch.binding_id ?? "bind-1",
  status: patch.status ?? "success",
  trigger_kind: patch.trigger_kind ?? "activity",
  trigger_payload_json: null,
  session_id: patch.session_id ?? null,
  summary: null,
  model: null,
  effort: null,
  error: null,
  skip_reason: patch.skip_reason ?? null,
  seen_at: patch.seen_at ?? null,
  input_tokens: patch.input_tokens ?? null,
  output_tokens: patch.output_tokens ?? null,
  started_at: patch.started_at ?? "2026-08-25T07:00:00.000Z",
  finished_at: patch.finished_at ?? "2026-08-25T07:00:04.000Z"
});

// Distinct timestamps throughout: ordering has to be a property of the SQL,
// not of the order the rows happened to be inserted in.
const rows = [
  run({
    id: "r-read",
    session_id: "s-a",
    started_at: "2026-08-25T07:01:00.000Z",
    seen_at: "2026-08-25T08:00:00.000Z"
  }),
  run({ id: "r-unread", session_id: "s-a", started_at: "2026-08-25T07:02:00.000Z" }),
  run({
    id: "r-silent",
    session_id: "s-a",
    status: "silent",
    started_at: "2026-08-25T07:03:00.000Z"
  }),
  run({
    id: "r-skip",
    session_id: "s-a",
    status: "skipped",
    skip_reason: "cooldown",
    started_at: "2026-08-25T07:04:00.000Z"
  }),
  run({ id: "r-other", session_id: "s-b", started_at: "2026-08-25T07:05:00.000Z" }),
  run({ id: "r-orphan", started_at: "2026-08-25T07:06:00.000Z" }),
  run({
    id: "r-old",
    session_id: "s-a",
    started_at: "2026-08-01T07:00:00.000Z",
    finished_at: "2026-08-01T07:00:04.000Z"
  })
];
for (const row of rows) database.insertCoachAutomationRunRow(row);

const ids = (filter) =>
  database.listCoachAutomationRunRows(filter).map((row) => row.id).sort();

// --- the filters, one at a time -------------------------------------------
assert.deepEqual(ids({ sessionId: "s-b" }), ["r-other"]);
assert.deepEqual(ids({ statuses: ["silent"] }), ["r-silent"]);
assert.deepEqual(
  ids({ since: "2026-08-20T00:00:00.000Z" }).includes("r-old"),
  false,
  "`since` is an inclusive lower bound on started_at"
);
assert.deepEqual(
  ids({ unseenOnly: true }).includes("r-read"),
  false,
  "a run already stamped seen_at is not unseen"
);
assert.equal(
  ids({ unseenOnly: true }).length,
  rows.length - 1,
  "and every other run still is"
);

// --- combined, which is how the conversation list asks --------------------
// This is the exact query behind the unread dot (9.3), and it is the one the
// hand-written fakes cannot vouch for.
assert.deepEqual(
  ids({ sessionId: "s-a", statuses: ["success", "silent"], unseenOnly: true }),
  ["r-old", "r-silent", "r-unread"],
  "unread runs that wrote something, in one conversation"
);

// Stamping one clears it from that answer and leaves the rest alone.
const stamped = database.getCoachAutomationRunRow("r-unread");
database.updateCoachAutomationRunRow({
  ...stamped,
  seen_at: "2026-08-25T09:00:00.000Z"
});
assert.deepEqual(
  ids({ sessionId: "s-a", statuses: ["success", "silent"], unseenOnly: true }),
  ["r-old", "r-silent"],
  "seen_at is what removes a run from the unread answer"
);
assert.equal(
  database.listCoachAutomationRunRows({ sessionId: "s-a" }).length,
  5,
  "and nothing was deleted along the way"
);

// --- ordering and the cap -------------------------------------------------
assert.deepEqual(
  database
    .listCoachAutomationRunRows({ sessionId: "s-a", limit: 2 })
    .map((row) => row.id),
  ["r-skip", "r-silent"],
  "newest first, so a limit keeps the most recent"
);

// --- the index the activity scan leans on (3.2) ---------------------------
// A per-binding watermark asks "what landed after this timestamp" on every
// trigger, once per binding. Without the index that is a full scan of the
// athlete's whole history.
const plan = database
  .requireDatabase()
  .prepare(
    `EXPLAIN QUERY PLAN
     SELECT activity_id FROM training_activities
     WHERE start_time IS NOT NULL AND start_time > ?
     ORDER BY start_time DESC LIMIT ?`
  )
  .all(0, 10)
  .map((step) => step.detail)
  .join(" | ");
assert.match(
  plan,
  /idx_training_activities_start_time/,
  `the activity scan must use its index, got: ${plan}`
);

// --- and the index the monthly spend leans on (13) ------------------------
// The budget guard rail asks "what did every automation cost since the 1st" on
// every run. It narrows by nothing but the date, so neither of the run log's
// other two indexes — both prefixed by an id — can serve it.
{
  const spendPlan = database
    .requireDatabase()
    .prepare(
      `EXPLAIN QUERY PLAN
       SELECT COALESCE(SUM(input_tokens), 0) FROM coach_automation_runs
       WHERE started_at >= ?
         AND status IN ('success', 'silent', 'failed', 'cancelled')`
    )
    .all("2026-09-01T00:00:00.000Z")
    .map((step) => step.detail)
    .join(" | ");
  assert.match(
    spendPlan,
    /idx_automation_runs_started/,
    `the monthly spend must use its index, got: ${spendPlan}`
  );
}

// --- the binding's three clocks are really columns (10) -------------------
// The runner suite drives the backoff against a hand-written world, and the
// store suite against a fake row, so both would stay green with the columns
// missing from the real table — `ensureColumn` is the only thing that adds
// them, and it runs once, on a database that already exists.
{
  // The binding's foreign key is a real constraint here, unlike in the fakes.
  database.insertCoachAutomationRow({
    id: "auto-1",
    name: "Post-run debrief",
    role: null,
    playbook: "Summarise the run.",
    enabled: 1,
    preset_id: null,
    trigger_json: JSON.stringify({ kind: "activity", sportTypes: [] }),
    conditions_json: JSON.stringify({
      batchWindowMin: 0,
      cooldownMin: 0,
      maxRunsPerDay: 3
    }),
    runtime_json: null,
    created_at: "2026-08-25T07:00:00.000Z",
    updated_at: "2026-08-25T07:00:00.000Z"
  });

  database.insertCoachAutomationBindingRow({
    id: "bind-backoff",
    automation_id: "auto-1",
    mode: "existing",
    session_id: "s-backoff",
    title_template: null,
    enabled: 1,
    sort_order: 0,
    last_run_at: null,
    next_run_at: null,
    last_activity_at: null,
    backoff_until: null,
    backoff_level: null,
    threshold_firing: null,
    created_at: "2026-08-25T07:00:00.000Z"
  });

  const stored = database.getCoachAutomationBindingRow("bind-backoff");
  assert.equal(stored.backoff_until, null, "a fresh binding is not backing off");
  assert.equal(stored.backoff_level, null);

  database.updateCoachAutomationBindingRow({
    ...stored,
    backoff_until: "2026-08-25T07:05:00.000Z",
    backoff_level: 1
  });
  const failing = database.getCoachAutomationBindingRow("bind-backoff");
  assert.equal(failing.backoff_until, "2026-08-25T07:05:00.000Z");
  assert.equal(failing.backoff_level, 1);
  assert.equal(
    failing.last_activity_at,
    null,
    "and the column it was added next to still reads back"
  );

  // 3.3's transition state is the same kind of column and the same kind of
  // risk: the threshold suite drives it against a hand-written world, so
  // nothing else would notice it missing from the real table. Its three values
  // all have to survive, NULL most of all — that is "never evaluated", and it
  // is what stops a binding attached today firing on history.
  assert.equal(
    failing.threshold_firing,
    null,
    "a binding that has never been evaluated says so"
  );
  for (const value of [0, 1]) {
    database.updateCoachAutomationBindingRow({ ...failing, threshold_firing: value });
    assert.equal(
      database.getCoachAutomationBindingRow("bind-backoff").threshold_firing,
      value
    );
  }
  database.updateCoachAutomationBindingRow({ ...failing, threshold_firing: null });
  assert.equal(
    database.getCoachAutomationBindingRow("bind-backoff").threshold_firing,
    null,
    "and it can be put back to never-evaluated, which a trigger edit does"
  );
}

// --- 3.3's local sample cache, against the real table ----------------------
{
  database.upsertCoachDailySamples(
    [
      { day: "20260820", resting_hr: 48, sleep_minutes: 430 },
      { day: "20260821", resting_hr: 51, sleep_minutes: null }
    ],
    "2026-08-25T07:00:00.000Z"
  );
  assert.deepEqual(database.listCoachDailySamples("20260820"), [
    { day: "20260820", resting_hr: 48, sleep_minutes: 430 },
    { day: "20260821", resting_hr: 51, sleep_minutes: null }
  ]);
  assert.deepEqual(
    database.listCoachDailySamples("20260821").map((row) => row.day),
    ["20260821"],
    "the window is a string comparison on a sortable key"
  );

  // A snapshot that reached COROS for resting HR and could not reach the MCP
  // server for sleep must not blank the sleep it already had — otherwise every
  // disconnected poll would erase a night.
  database.upsertCoachDailySamples(
    [{ day: "20260820", resting_hr: 49, sleep_minutes: null }],
    "2026-08-25T13:00:00.000Z"
  );
  assert.deepEqual(database.listCoachDailySamples("20260820")[0], {
    day: "20260820",
    resting_hr: 49,
    sleep_minutes: 430
  });
}

// --- 5.7's rolling summary, against the real column -----------------------
// The runner suite drives trimming against a hand-written world, so nothing
// else would notice the columns missing from the real table — and a summary
// that cannot be stored turns "one turn a year" back into "a year a turn".
{
  database.insertChatSessionRow(
    "sess-long",
    "claude-code",
    "Morning briefing",
    "[]",
    "2026-08-01T07:00:00.000Z",
    "2026-08-25T07:00:00.000Z"
  );

  assert.deepEqual(
    database.getChatSessionCoachSummaryRow("sess-long"),
    { coach_summary: null, coach_summary_through: null },
    "a conversation nobody has summarised says so"
  );

  database.setChatSessionCoachSummaryRow(
    "sess-long",
    "Marathon in October. Calf grumbling since July.",
    80
  );
  assert.deepEqual(database.getChatSessionCoachSummaryRow("sess-long"), {
    coach_summary: "Marathon in October. Calf grumbling since July.",
    coach_summary_through: 80
  });

  // Rolling it forward replaces both halves together: a summary and the count
  // it covers are one fact, and a row carrying one without the other would send
  // the model a description of turns it is also about to read in full.
  database.setChatSessionCoachSummaryRow("sess-long", "Calf settled.", 130);
  assert.deepEqual(database.getChatSessionCoachSummaryRow("sess-long"), {
    coach_summary: "Calf settled.",
    coach_summary_through: 130
  });

  // The transcript is untouched by any of it — 5.7 trims the context window,
  // never what is on disk.
  const row = database
    .requireDatabase()
    .prepare("SELECT messages_json, title FROM chat_sessions WHERE id = ?")
    .get("sess-long");
  assert.equal(row.messages_json, "[]");
  assert.equal(row.title, "Morning briefing");

  assert.equal(database.getChatSessionCoachSummaryRow("no-such-session"), undefined);
}

// --- the month's spend, summed against the real table ---------------------
// The runner suite hands the month-to-date total in as a number, so nothing
// else would notice this query counting the wrong rows — and a budget built on
// the wrong rows pauses the athlete's coaches for the wrong reason.
{
  const spent = (patch) =>
    database.insertCoachAutomationRunRow(
      run({
        automation_id: "auto-spend",
        binding_id: "bind-spend",
        started_at: patch.started_at,
        status: patch.status ?? "success",
        skip_reason: patch.skip_reason ?? null,
        input_tokens: patch.input_tokens ?? null,
        output_tokens: patch.output_tokens ?? null,
        id: patch.id
      })
    );

  spent({ id: "t-1", started_at: "2026-09-01T00:00:00.000Z", input_tokens: 100, output_tokens: 20 });
  spent({ id: "t-2", started_at: "2026-09-14T09:00:00.000Z", input_tokens: 300, output_tokens: 40 });
  // Before the window: last month is somebody else's problem.
  spent({ id: "t-old", started_at: "2026-08-31T23:59:59.000Z", input_tokens: 9_000, output_tokens: 9_000 });
  // Reached the provider and cost something, whatever it turned into.
  spent({ id: "t-fail", started_at: "2026-09-15T09:00:00.000Z", status: "failed", input_tokens: 50, output_tokens: 5 });
  spent({ id: "t-silent", started_at: "2026-09-15T10:00:00.000Z", status: "silent", input_tokens: 10, output_tokens: 1 });
  // Never reached a provider, so it is not a run the budget has to count.
  spent({ id: "t-skip", started_at: "2026-09-16T09:00:00.000Z", status: "skipped", skip_reason: "cooldown" });
  // Reached the provider, which said nothing about what it cost.
  spent({ id: "t-quiet", started_at: "2026-09-17T09:00:00.000Z" });

  const totals = database.sumCoachAutomationTokensSince("2026-09-01T00:00:00.000Z");
  assert.equal(totals.inputTokens, 100 + 300 + 50 + 10);
  assert.equal(totals.outputTokens, 20 + 40 + 5 + 1);
  assert.equal(totals.providerRuns, 5, "the cooldown skip is not a run that spent anything");
  assert.equal(
    totals.countedRuns,
    4,
    "and the one whose provider said nothing is reported as uncounted, not as free"
  );

  const empty = database.sumCoachAutomationTokensSince("2027-01-01T00:00:00.000Z");
  assert.deepEqual(empty, {
    inputTokens: 0,
    outputTokens: 0,
    countedRuns: 0,
    providerRuns: 0
  });
}

// ---------------------------------------------------------------------------
// R4 step 7: what a row from an earlier version, or a hand edit, reads as
// ---------------------------------------------------------------------------
// Nine columns arrived through `ensureColumn` across three phases, so every one
// of them is NULL on a database that predates it. NULL is covered above and
// throughout; what nothing covered is the other half of the question — a value
// that is *present* and means nothing. Section 10 settled the rule when it made
// a half-written pause read as *not paused*: the safe reading is the one where
// a shape nobody checked cannot hold the feature hostage. These are the same
// rule, applied to the columns that had not had it.
//
// Read through the real store rather than the raw row, because the reading is
// the thing under test — `database.js` hands back what SQLite holds, and
// `toBinding`/`toRun` are what decide what that means.
const store = await import(distUrl("coachAutomationStore.js"));

const corruptAutomationId = "auto-corrupt";
database.insertCoachAutomationRow({
  id: corruptAutomationId,
  name: "Hand-edited",
  role: null,
  playbook: "Say something.",
  enabled: 1,
  preset_id: null,
  trigger_json: JSON.stringify({ kind: "activity", sportTypes: [] }),
  conditions_json: JSON.stringify({
    batchWindowMin: 0,
    cooldownMin: 0,
    maxRunsPerDay: 3
  }),
  runtime_json: null,
  created_at: "2026-08-25T07:00:00.000Z",
  updated_at: "2026-08-25T07:00:00.000Z"
});

const corruptBinding = (id, patch) => {
  database.insertCoachAutomationBindingRow({
    id,
    automation_id: corruptAutomationId,
    mode: "existing",
    session_id: `sess-${id}`,
    title_template: null,
    enabled: 1,
    sort_order: 0,
    last_run_at: null,
    next_run_at: null,
    last_activity_at: null,
    backoff_until: null,
    backoff_level: null,
    threshold_firing: null,
    created_at: "2026-08-25T07:00:00.000Z",
    ...patch
  });
  return store.getCoachAutomationBinding(id);
};

// --- last_activity_at: a watermark is a start_time, so zero is not one ------
{
  // Trusting a zero would put the floor at the epoch instead of at the attach
  // time, and the binding would replay every activity the athlete has — up to
  // the 200-row scan cap — which is the one thing 3.2's floor exists to stop.
  assert.equal(
    corruptBinding("b-wm-zero", { last_activity_at: 0 }).lastActivityAt,
    undefined,
    "a zero watermark reads as never analysed"
  );
  assert.equal(
    corruptBinding("b-wm-neg", { last_activity_at: -1 }).lastActivityAt,
    undefined,
    "and so does a negative one"
  );
  assert.equal(
    corruptBinding("b-wm-real", { last_activity_at: 1_756_000_000 }).lastActivityAt,
    1_756_000_000,
    "a real one is untouched"
  );
}

// --- threshold_firing: three values, and only three ------------------------
{
  // Anything else read as `false` before — which claims the condition *was*
  // evaluated and did not hold, so the next tick sees a transition and
  // announces a condition that may have been true all week. That is the exact
  // announcement the NULL is there to prevent.
  assert.equal(
    corruptBinding("b-tf-two", { threshold_firing: 2 }).thresholdFiring,
    undefined,
    "a value that is neither 0 nor 1 reads as never evaluated"
  );
  assert.equal(
    corruptBinding("b-tf-neg", { threshold_firing: -1 }).thresholdFiring,
    undefined
  );
  assert.equal(
    corruptBinding("b-tf-zero", { threshold_firing: 0 }).thresholdFiring,
    false,
    "and the two real values still mean what they say"
  );
  assert.equal(
    corruptBinding("b-tf-one", { threshold_firing: 1 }).thresholdFiring,
    true
  );
}

// --- backoff: garbage holds nobody off -------------------------------------
{
  // The safe direction for a clock nobody can parse is *not held*: a binding
  // frozen by a string somebody typed is the failure mode, not a binding that
  // tries once too often.
  const garbage = corruptBinding("b-bo-junk", {
    backoff_until: "soon",
    backoff_level: -3
  });
  assert.equal(garbage.backoffUntil, "soon", "the row is reported as it stands");
  assert.equal(
    Number.isNaN(Date.parse(garbage.backoffUntil)),
    true,
    "and the guard rail's own comparison is what makes it harmless"
  );
  assert.equal(garbage.backoffLevel, undefined, "a negative level is no level");
}

// --- a `per-run` binding owns no conversation, whatever the row says --------
{
  // The attach path refuses this combination, so it can only arrive by hand or
  // by a migration. Every reader already behaves as though the id were absent —
  // `checkSessionTarget` branches on the mode before it looks — so reading it
  // as null is what stops the row and the behaviour disagreeing.
  const contradictory = corruptBinding("b-perrun", {
    mode: "per-run",
    session_id: "sess-should-not-be-here"
  });
  assert.equal(contradictory.mode, "per-run");
  assert.equal(
    contradictory.sessionId,
    null,
    "a per-run binding reads as owning no conversation"
  );
}

// --- a negative cost is not a cost -----------------------------------------
{
  // It would subtract from the month's SUM, and a budget reading *under* the
  // truth is what 13 calls worse than no budget: a number the athlete trusts.
  database.insertCoachAutomationRunRow(
    run({ id: "r-neg", input_tokens: -5_000, output_tokens: -10 })
  );
  const negative = store.listCoachAutomationRuns({ automationId: "auto-1" }).find(
    (entry) => entry.id === "r-neg"
  );
  assert.ok(negative, "fixture sanity: the row is there");
  assert.equal(negative.inputTokens, undefined, "a negative cost reads as unreported");
  assert.equal(negative.outputTokens, undefined);

  // Zero stays a real answer: a cancelled run that never reached the model
  // genuinely cost nothing, and that is different from nobody counting.
  database.insertCoachAutomationRunRow(
    run({ id: "r-zero", input_tokens: 0, output_tokens: 0 })
  );
  const free = store.listCoachAutomationRuns({ automationId: "auto-1" }).find(
    (entry) => entry.id === "r-zero"
  );
  assert.equal(free.inputTokens, 0, "zero is a cost, not an absence");
  assert.equal(free.outputTokens, 0);
}

fs.rmSync(tempRoot, { recursive: true, force: true });
console.log("coach automation sql tests passed");
