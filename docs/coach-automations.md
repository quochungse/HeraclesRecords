# Coach Automations (proactive coach runs)

Status: **all three phases shipped, and reviewed**. Target: CorosLink desktop (Electron main + React renderer). Written 2026-08-21, revised 2026-08-25 against the built code, reconciled 2026-08-27 after the review below.

Every section describes what exists. Nothing here is design any more — the two that were, 3.3 and 5.7, shipped in phase 3. Where the build diverged from the original design the divergence is written down with its reason; those reasons are the useful part.

**The review.** Seven rounds, run along failure modes rather than modules, on the plan in [coach-automations-review.md](./coach-automations-review.md). It found 25 defects and fixed them, and its workings live in six companion files rather than here — this document says what the feature *is*, and they say how it was checked:

| | What it holds |
|---|---|
| [map](./coach-automations-map.md) | every table, column, IPC channel, dep seam and suite, and where this document had drifted from the code |
| [refusals](./coach-automations-refusals.md) | every ordered pair of the twenty ways a run can be declined, and what each writes |
| [lifecycle](./coach-automations-lifecycle.md) | the schedule slot, the activity watermark and the threshold flag through every way a run can end |
| [conversations](./coach-automations-conversations.md) | the three writers on one transcript, and every interleaving that could lose an entry |
| [pushes](./coach-automations-pushes.md) | every piece of main-process state, the push that announces it, and the surfaces that render it |
| [persistence](./coach-automations-persistence.md) | what every column reads as from an older version, a hand edit, or a crash |
| [test integrity](./coach-automations-test-integrity.md) | 48 mutations over the suites everything above rests on |
| [cost and exposure](./coach-automations-cost-and-exposure.md) | what a tick, a run and a year cost, and what the tool policy lets through |

Three lessons recur often enough to be worth stating once, because they are how almost every defect here was found:

1. **A fixture that sits where two readings agree proves nothing**, and looks exactly like one that does. Three separate tests passed against inverted logic for this reason.
2. **A default dep is code no suite can reach.** Every suite injects fakes on purpose; `createDefaultDeps` and the body of `streamChat` are therefore permanently outside them, and three rounds each found a wire there with no cover.
3. **A test can assert the defect it was written beside.** Four did — the merge that deleted a coach's answer, the watcher that never asked again, the tool policy that let a new tool through, and the run cost that was never recorded.

A **Coach Automation** is a reusable coach definition — a role, a job, and a trigger condition — that the athlete can attach to one or more conversations. When its trigger fires, it runs one coach turn headlessly in the main process and writes the result into every conversation it is attached to.

```
Automation (role + job + trigger)  ──attached to──▶  Binding (a conversation)
                    trigger fires  ──────────────▶  Run (one per binding)
```

## Locked decisions

| # | Decision | Consequence |
|---|----------|-------------|
| 1 | Automations run **whenever the app process is alive**, window open or not. Nothing keeps the process alive for them. | Scheduler owned by the `app` lifecycle, not by `BrowserWindow`. No auto-launch, no tray, no OS scheduler. |
| 2 | Automations may **override provider model and reasoning effort** independently of the interactive chat. | `streamChat` must accept per-run model/effort overrides instead of always reading `getChatSettings()`. |
| 3 | Auto runs are **read-only**. They may draft and propose, never write to COROS. | Tool allowlist excludes every write tool. Drafts land as approval cards the athlete confirms manually, in **every** phase. |
| 4 | An automation is a **definition**, decoupled from where it runs. One automation ↔ many conversations; one conversation ↔ at most **5** automations. | Destination is not a field on the automation. It is a separate `coach_automation_bindings` entity carrying its own state. |

### Execution lifetime (decision 1)

Keep this simple: the scheduler and the activity watcher start in `app.whenReady()` and stop in `before-quit` ([main.ts:885](../electron/main.ts#L885)) — never wired to the window. If the app is running, automations run; if it is not, they do not, and the next launch catches up (3.1). On macOS that means they keep going with the window closed ([main.ts:879](../electron/main.ts#L879)); elsewhere they stop with the app.

Nothing is built to keep the process alive — no auto-launch, no tray, no OS scheduling. A run with no window open still completes and persists; the athlete sees it as unread next time a window exists.

## Vocabulary

- **Automation** — the reusable definition: name, role, playbook, trigger, guard rails, model/effort. Owns no conversation.
- **Binding** — one place the automation is active: a conversation, plus its own enabled flag, ordering, and run state. The unit the athlete manages on the "where it runs" screen.
- **Run** — one execution against **one binding**. Always logged, even when silent.
- **Silent run** — the coach concluded nothing was worth reporting. Logged, no badge, no message bubble.
- **Playbook** — the prompt template sent as the user turn of the run.
- **Role** — persona and remit ("strict marathon coach, injury-prevention first"), injected into the system instructions for that run only.

---

## 1. Data model

New tables, following the `CREATE TABLE IF NOT EXISTS` block in [database.ts:147](../electron/database.ts#L147). Additive columns later go through `ensureColumn` ([database.ts:662](../electron/database.ts#L662)).

**The block below is the model, not the schema.** Nine of its columns arrived through `ensureColumn` across three phases — on bindings: `last_activity_at`, `backoff_until`, `backoff_level`, `threshold_firing`; on runs: `input_tokens`, `output_tokens`; on `chat_sessions`: `coach_summary`, `coach_summary_through`; on `training_activities`: `coach_seen_at` — so they are absent from a database that predates them and NULL on one that has just been migrated. They are shown inline because that is how the tables read; what each NULL means, and what a hand-edited value reads as, is in [persistence](./coach-automations-persistence.md).

```sql
-- The definition. Knows nothing about conversations.
CREATE TABLE IF NOT EXISTS coach_automations (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  role             TEXT,               -- persona/remit, injected into instructions
  playbook         TEXT NOT NULL,      -- prompt template with {{variables}}
  enabled          INTEGER NOT NULL DEFAULT 1,   -- master switch over all bindings
  preset_id        TEXT,
  trigger_json     TEXT NOT NULL,      -- AutomationTrigger
  conditions_json  TEXT NOT NULL,      -- AutomationConditions (guard rails)
  runtime_json     TEXT,               -- AutomationRuntime (provider/model/effort)
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

-- Where the automation runs. One row per attachment point.
CREATE TABLE IF NOT EXISTS coach_automation_bindings (
  id             TEXT PRIMARY KEY,
  automation_id  TEXT NOT NULL,
  mode           TEXT NOT NULL,        -- per-run | dedicated | existing
  -- per-run: NULL (a fresh conversation is created on every run)
  -- dedicated/existing: the conversation this binding writes into
  session_id     TEXT,
  title_template TEXT,                 -- per-run mode only
  enabled        INTEGER NOT NULL DEFAULT 1,
  sort_order     INTEGER NOT NULL DEFAULT 0,   -- run order within one conversation
  last_run_at    TEXT,
  next_run_at    TEXT,                 -- schedule triggers; per binding
  -- start_time (epoch seconds) of the newest activity this binding analysed.
  -- NULL = it never analysed one; the attach time is the floor instead (3.2).
  last_activity_at INTEGER,
  -- The failure backoff (10). backoff_until is the wall clock this binding is
  -- held off until; backoff_level counts consecutive failures and picks the
  -- step. NULL/0 mean healthy, which is also what a pre-migration row says.
  backoff_until  TEXT,
  backoff_level  INTEGER,
  -- 3.3's transition state. NULL = never evaluated, which is what stops a
  -- binding attached today firing on a condition that has held all week.
  threshold_firing INTEGER,
  created_at     TEXT NOT NULL,
  FOREIGN KEY (automation_id) REFERENCES coach_automations(id) ON DELETE CASCADE
);

-- One automation cannot be attached twice to the same conversation.
CREATE UNIQUE INDEX IF NOT EXISTS idx_binding_unique_session
  ON coach_automation_bindings (automation_id, session_id)
  WHERE session_id IS NOT NULL;

-- At most one "new conversation per run" binding per automation.
CREATE UNIQUE INDEX IF NOT EXISTS idx_binding_unique_per_run
  ON coach_automation_bindings (automation_id)
  WHERE session_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_binding_session
  ON coach_automation_bindings (session_id);

-- Every activity trigger asks "what landed after this binding's watermark",
-- once per binding, and the answer is ordered by start_time.
CREATE INDEX IF NOT EXISTS idx_training_activities_start_time
  ON training_activities (start_time);

CREATE TABLE IF NOT EXISTS coach_automation_runs (
  id                   TEXT PRIMARY KEY,
  automation_id        TEXT NOT NULL,
  binding_id           TEXT NOT NULL,
  status               TEXT NOT NULL,  -- running|success|silent|skipped|failed|cancelled
  trigger_kind         TEXT NOT NULL,  -- schedule|activity|threshold|manual
  trigger_payload_json TEXT,
  session_id           TEXT,           -- conversation actually written into
  summary              TEXT,           -- opening line, for the run log (5.5)
  model                TEXT,
  effort               TEXT,
  error                TEXT,
  skip_reason          TEXT,           -- see the full list in section 4
  seen_at              TEXT,           -- unread badge cleared
  -- What the run cost (12, item 6). NULL = the provider reported nothing,
  -- which is not the same as a run that cost nothing.
  input_tokens         INTEGER,
  output_tokens        INTEGER,
  started_at           TEXT NOT NULL,
  finished_at          TEXT
);

CREATE INDEX IF NOT EXISTS idx_automation_runs_automation
  ON coach_automation_runs (automation_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_automation_runs_binding
  ON coach_automation_runs (binding_id, started_at DESC);

-- 13's monthly spend narrows by nothing but the date, and the two above are
-- both prefixed by an id, so neither can serve it.
CREATE INDEX IF NOT EXISTS idx_automation_runs_started
  ON coach_automation_runs (started_at);

-- 3.3: the two series a threshold metric needs and the app does not otherwise
-- keep. COROS owns resting HR and sleep; the activity watcher snapshots them
-- here on its slow poll, so the scheduler's 60-second tick can evaluate a
-- threshold without a request of its own.
-- 5.7: the rolling summary that stands in for the head of a long transcript,
-- and how many entries of that head it accounts for. On the conversation
-- rather than the binding, because five automations can share one conversation.
-- (Added to chat_sessions by ensureColumn.)
--   coach_summary          TEXT
--   coach_summary_through  INTEGER

CREATE TABLE IF NOT EXISTS coach_daily_samples (
  day           TEXT PRIMARY KEY,   -- local "YYYYMMDD", as COROS keys it
  resting_hr    REAL,
  sleep_minutes REAL,
  captured_at   TEXT NOT NULL
);
```

The 5-per-conversation cap is enforced in the store on insert (`COUNT(*) WHERE session_id = ?`), not by a SQL constraint, so the UI can show a clear message.

`coach_automation_runs` is not optional polish. An automation that silently does nothing is indistinguishable from a broken one; the run log is the only way the athlete (and support) can tell them apart.

### TypeScript shapes (`electron/types.ts`)

```ts
export type AutomationTriggerKind = "schedule" | "activity" | "threshold" | "manual";

export type AutomationTrigger =
  | {
      kind: "schedule";
      cadence: "daily" | "weekly";
      /** 0=Sunday..6=Saturday; weekly only. */
      dayOfWeek?: number;
      /** Local wall-clock "HH:mm". */
      timeOfDay: string;
    }
  | {
      kind: "activity";
      /** COROS sport type ids; empty means every sport. */
      sportTypes: number[];
      minDurationSec?: number;
      minDistanceM?: number;
      /**
       * Analyse every matching activity that appeared since the last analysis,
       * one run each in chronological order. Off (the default) analyses only
       * the most recent match. See 3.2.
       */
      multiActivity?: boolean;
    }
  | {
      kind: "threshold";
      metric: "acuteChronicRamp" | "restingHrDrift" | "planAdherence" | "sleepDebt";
      value: number;
    }
  | { kind: "manual" };

export interface AutomationConditions {
  /** Minimum gap between two runs of the same binding. */
  cooldownMin: number;           // default 120
  /** Per binding, per local day. */
  maxRunsPerDay: number;         // default 3
  /** Local "HH:mm" range where runs are deferred, not dropped. */
  quietHours?: { start: string; end: string };
}

export interface AutomationRuntime {
  provider?: ChatProvider;       // defaults to the chat provider
  model?: string;
  effort?: AnthropicEffort;
}

/** The definition. */
export interface CoachAutomation {
  id: string;
  name: string;
  /** Persona and remit, injected into the run's system instructions. */
  role?: string;
  playbook: string;
  enabled: boolean;
  presetId?: string;
  trigger: AutomationTrigger;
  conditions: AutomationConditions;
  runtime: AutomationRuntime;
  createdAt: string;
  updatedAt: string;
}

export type AutomationBindingMode = "per-run" | "dedicated" | "existing";

/** Where the definition is active. */
export interface CoachAutomationBinding {
  id: string;
  automationId: string;
  mode: AutomationBindingMode;
  /** null for "per-run". */
  sessionId: string | null;
  /** "per-run" only: "{{rule.name}} · {{activity.name}} · {{date}}". */
  titleTemplate?: string;
  enabled: boolean;
  sortOrder: number;
  lastRunAt?: string;
  nextRunAt?: string;
  /** Activity watermark; absent means this binding never analysed one (3.2). */
  lastActivityAt?: number;
  createdAt: string;
}

/** List-screen projection. */
export interface CoachAutomationSummary {
  automation: CoachAutomation;
  bindingCount: number;
  enabledBindingCount: number;
  lastRun?: CoachAutomationRun;
  nextRunAt?: string;            // earliest across bindings
}

export interface CoachAutomationRun {
  id: string;
  automationId: string;
  bindingId: string;
  status: "running" | "success" | "silent" | "skipped" | "failed" | "cancelled";
  triggerKind: AutomationTriggerKind;
  triggerPayload?: Record<string, unknown>;
  sessionId?: string;
  summary?: string;
  model?: string;
  effort?: string;
  error?: string;
  skipReason?: string;
  seenAt?: string;
  startedAt: string;
  finishedAt?: string;
}
```

---

## 2. Bindings

### 2.1 The three modes

| Mode | `session_id` | Behaviour | Good for |
|---|---|---|---|
| `per-run` | `NULL` | Every trigger creates a fresh conversation, titled from `titleTemplate`. | Post-activity debriefs — one conversation per session. |
| `dedicated` | set at bind time | Binding creates **one** conversation up front (named after the automation) and always appends to it. | Daily briefing — the coach sees what it said yesterday. |
| `existing` | chosen by the athlete | Appends into a conversation that already exists. | Adding a specialist coach to an ongoing thread. |

`dedicated` and `existing` differ only in who created the conversation, but the distinction is worth keeping: a `dedicated` conversation is auto-recreated if the athlete deletes it, an `existing` one is not (the binding is marked broken instead — see 2.4).

**Who creates the dedicated conversation.** The store refuses a `dedicated` binding with no `session_id` (`BINDING_SESSION_REQUIRED`) and is right to: it has no business creating chat sessions. Somebody still has to, and that is the attach screen — it creates the conversation, **names it after the automation**, and hands it over; if the attach is then refused it deletes the conversation again rather than leaving an empty thread behind.

Naming it at creation is not cosmetic (2.5). The first thing ever written into it is the automation's own playbook, and `saveChatSession` derives a title from the first entry while the stored one is still the default — so a conversation left as "New chat" ends up named after the coach's prompt.

This was broken from phase 1 until the phase-2 gallery started recommending the mode: the button attached with no session id and failed every time.

### 2.2 Constraints

1. **Max 5 automations per conversation.** Enforced in the store; the sixth attach returns `BINDING_LIMIT_REACHED` and the UI disables the control with a reason.
2. **No duplicate attach** — an automation cannot be bound twice to the same conversation (unique index).
3. **One `per-run` binding per automation** (unique index) — "a new conversation every time" is a single behaviour, not something to configure twice.
4. **`sort_order` is unique-ish per conversation** and defines run order when several automations fire into the same conversation.

### 2.3 Fan-out semantics

One trigger event produces **one run per enabled binding**, not one run broadcast to many conversations. Each conversation carries different history, so the coach's context — and therefore its answer — legitimately differs.

The cost consequence must be visible: the automation editor shows *"Runs in 3 places → 3 model calls per trigger"*, and the list screen shows the binding count next to the name. A single-binding default keeps new automations cheap.

**Serialization is mandatory, not an optimisation.** `saveChatSession` ([chatHistoryStore.ts:1071](../electron/chatHistoryStore.ts#L1071)) writes the whole entry array; two runs finishing into the same conversation concurrently would clobber each other last-write-wins. Runs targeting the same `session_id` therefore execute **sequentially in `sort_order`**, which has a useful side effect: a later coach sees the earlier coach's message in the transcript and can build on it.

**Burst guard:** at most 5 automation messages per conversation per hour. A run over the limit records a `burst` skip; the trigger that would have produced it comes round again on the next poll.

### 2.4 Lifecycle

| Event | Result |
|---|---|
| Automation deleted | Its bindings are deleted (FK cascade). Conversations are kept — they are the athlete's chat history. |
| Automation disabled | All bindings stop; binding rows and run history are kept. |
| Binding removed | Conversation kept, run history kept (rows remain readable via `automation_id`). |
| Conversation deleted, `dedicated` binding | Binding recreates the conversation on the next run and logs it. |
| Conversation deleted, `existing` binding | Binding flagged broken (`enabled = 0`, `skip_reason = "missing-session"`), athlete is asked to re-point it. |

### 2.5 Naming conversations

There is no rename API today: `createChatSession` ([chatHistoryStore.ts:1014](../electron/chatHistoryStore.ts#L1014)) inserts `DEFAULT_SESSION_TITLE`, and `saveChatSession` only derives a title from the first entries while the title is still the default — which would name an automation's conversation after its own prompt text.

Phase 1 therefore adds `setChatSessionTitle(id, title)` to the store plus a `chat:renameSession` IPC channel, used for both `dedicated` conversations and `per-run` `titleTemplate` rendering. Template variables: `{{rule.name}}`, `{{date}}`, `{{activity.name}}`, `{{activity.sport}}`, `{{week.range}}`.

---

## 3. Triggers

Triggers live on the **automation**, not the binding — one definition, one condition. Bindings inherit it and keep their own `next_run_at` / `last_run_at`, so attaching an automation to a second conversation does not reset the first.

### 3.1 Schedule

Desktop apps are not always running, so the scheduler is **not** a cron. Each binding stores its own `next_run_at`, and [coachAutomationScheduler.ts](../electron/coachAutomationScheduler.ts) evaluates every one of them on a 60-second tick:

| Binding state | What the tick does |
|---|---|
| No slot booked | Book the next one and wait. Creating a "daily at 07:00" rule at lunchtime must not fire on the spot. |
| Slot in the future | Nothing. Not even a rewrite of the booking. |
| Slot due, inside quiet hours | Move the slot to the end of the window. No run, no skip record. |
| Slot due, missed by **more than 24h** | One `stale-slot` skip, and the next slot booked **from now** — the whole backlog behind it goes with it. |
| Slot due | Book the next slot, *then* run. |

Ticker: `setInterval` at 60s in the main process, started inside `app.whenReady()` and cleared on `before-quit` ([main.ts:888](../electron/main.ts#L888)) — **not** tied to `createWindow` / `"closed"`.

**The catch-up pass is the ordinary tick.** `start()` ticks immediately rather than waiting out the first minute, and a slot that came due while the app was closed is simply a slot in the past. There is no second code path for it.

Four things the build had to get right that the design above does not say on its own:

**The slot is booked before the run, not after.** A run takes as long as the provider does and the app may be closed mid-answer. Booking first means the worst case is one missed briefing; booking afterwards means the same slot is retried on every tick for the rest of the day.

**The next slot is anchored on `now`, not on the slot that just fired.** They are the same answer — a slot only reaches the run branch once it is already due — but `now` has one fewer edge: `slot + one cadence` can still land in the past for a slot that is a whole day late, and then the run repeats a minute later.

**Every step is a calendar step.** `setDate(getDate() + n)`, never `+ 86_400_000`. The day a clock springs forward is 23 real hours long, so a scheduler that advanced by a fixed span would deliver the 07:00 briefing at 08:00 every day until the next boundary. A time the clock skips entirely (02:30 on a spring-forward morning) resolves to the moment the clock passes it rather than vanishing.

**Editing a trigger clears every slot it had booked.** Moving a briefing from 07:00 to 21:00 must not deliver one more 07:00 first, so `updateCoachAutomation` nulls `next_run_at` on that automation's bindings when the trigger actually changed ([coachAutomationStore.ts:508](../electron/coachAutomationStore.ts#L508)). Re-sending an identical trigger is not a change. This is also what keeps a quiet-hours deferral safe: because nothing else second-guesses a stored slot, a deferred one is left exactly where the scheduler put it.

### 3.2 New activity

`listTrainingHubActivities` ([trainingHubService.ts:864](../electron/trainingHubService.ts#L864)) already persists each page into `training_activities` as a side effect, and the watcher reuses that.

**The build split one job into two.** The original design had the watcher pick the activities and hand them to the runner in the trigger payload. That cannot be right once a binding has its own history: two conversations attached a week apart owe answers on different activities, and the watcher knows nothing about bindings. So:

| Component | Decides |
|---|---|
| `coachActivityWatcher.ts` | **When** to fire. Polls, diffs `coach_seen_at`, fires one payload-free trigger per automation. |
| `coachAutomationService.ts` | **What** to analyse. Per binding, from that binding's own `last_activity_at` watermark. |

Watcher loop, every 15 minutes for as long as the process is alive:

1. Fetch page 1 of the activity index for the last 7 days.
2. Diff `activity_id` against `training_activities.coach_seen_at` (added via `ensureColumn`).
3. Match new rows against every enabled `activity` automation (sport, duration, distance).
4. Fire `{ automationId, kind: "activity" }` once per matching automation, however many of its activities the poll found.

**The batch window is gone.** `conditions.batchWindowMin` held matches back for up to 20 minutes so several activities landing together became one run; nothing else read it, and the poll interval already collapses them — 15 minutes of arrivals reach the runner as one trigger, and the runner decides what each binding owes from its own watermark either way. What the window bought was a delay the athlete could see. The field, its control, and the never-recorded `"batch-window"` skip reason were removed together; old stored conditions keep the key in their JSON and `normalizeAutomationConditions` drops it on read.

Rows are stamped `coach_seen_at` **as the poll fires, before the runner answers** — the flag means "the watcher has looked at this", and it has. A run the stamp outlives is re-offered by the catch-up below rather than lost. Cold start stamps everything already on disk, so switching the feature on does not replay the athlete's back catalogue.

#### Per-binding selection

`selectActivitiesForBinding` answers "what does this binding still owe an opinion on", oldest first:

| Situation | Selection |
|---|---|
| Has a watermark | Everything matching with `start_time > last_activity_at` |
| Never analysed anything | Everything matching **since the binding was attached** — attaching a coach today must not replay history |
| `multiActivity` off (default) | Only the newest match, however many piled up |
| `multiActivity` on | All of them, **one run each**, in the order the athlete lived them |
| "Run now", never analysed anything | The newest match, **ignoring the attach floor** — the athlete asked for an answer now, and a coach attached five minutes ago would otherwise have nothing to say |

The watermark advances only on `success` or `silent` — the model looked — and only **after the answer is on disk**, so a run whose persistence throws leaves it where it was rather than recording an activity nobody can read. A `failed` or `cancelled` run leaves it too, so the activity returns with the next trigger.

**And something has to come back for it.** `coach_seen_at` is stamped at flush, before the runner answers and whatever it answers, so the watcher's own "is anything unseen" test can never re-fire for a refused activity. The tick therefore asks again on every poll: one payload-free trigger per enabled activity automation, whose binding-level plan is empty — and costs no row — when nothing is owed. Without it, a run refused for any reason at all left the activity owed by the watermark and asked for by nobody, and with `multiActivity` off the next activity to arrive replaced it. See [lifecycle](./coach-automations-lifecycle.md).

Two caps, both deliberate: a scan reaches back at most 200 activities, and one catch-up sequence runs at most 10. A longer backlog analyses only its most recent entries, because replaying a month in one burst costs real provider spend and buries the answer the athlete wanted.

Because `multiActivity` sends the same playbook once per activity, each run appends a focus line naming its own subject — otherwise three answers would be interchangeable.

#### Why the watermark is per binding, not per automation

`coach_seen_at` is one flag on a shared row: it can only mean "the watcher has looked at this". It cannot mean "conversation A has been told about this but conversation B has not". Keeping the two separate is what lets a binding attached last month and one attached today both behave correctly.

### 3.3 Threshold

Evaluated on the scheduler's tick, from data already cached locally:

| Metric | Source | Fires when |
|---|---|---|
| `acuteChronicRamp` | `training_activities.training_load` | 7-day load exceeds the trailing 28-day average week by more than `value` % |
| `restingHrDrift` | `coach_daily_samples.resting_hr` | resting HR is at least `value` bpm above the 30-day baseline for 3 consecutive days |
| `planAdherence` | `training_activity_matches` | a scheduled workout has no matching activity more than `value` hours after the day it was due |
| `sleepDebt` | `coach_daily_samples.sleep_minutes` | the rolling 7-night deficit against 8 hours a night exceeds `value` hours |

The metrics are pure functions over rows the caller has already read ([coachThresholdMetrics.ts](../electron/coachThresholdMetrics.ts)), and **nothing in them reaches the network**. The scheduler evaluates on a 60-second tick, and a metric that fetched would put a request on that tick for every rule the athlete has — on the one path that has already paid for an unbounded call (10).

**Two of the four sources did not exist.** The table above originally named `getDailyMetrics` and "sleep data service", and both are COROS requests rather than local tables — the app keeps activities and plans on disk, and nothing else. So `coach_daily_samples` is new: one row per local day, holding resting HR and total sleep, snapshotted by the **activity watcher** rather than the scheduler. That is where the app already talks to COROS on a slow cadence, and the snapshot is slower still — every six hours, for 35 days of history, because the widest window a metric reads is a 30-day baseline with a 3-day streak in front of it.

Three rules the snapshot follows, each for a reason section 10 already established:

- **It is bounded, and it goes last.** Neither COROS call carries a deadline of its own and one of them can reach an MCP connect, so it is raced against a minute and the tick carries on without it. It also runs after the activity work rather than before: activities are the half of a tick an athlete may be waiting on.
- **A failure is not stamped.** The cache keeps whatever it had — the metrics read multi-week windows, so one missed top-up changes nothing — but the next tick tries again rather than buying six hours of silence.
- **It happens only when a threshold rule exists.** This cache feeds nothing else, and most athletes never write one; filling it anyway would buy them a COROS request every six hours forever for a table nobody reads. A rule created later finds it empty for one tick and full after — and its first evaluation only seeds, so nothing is missed by waiting.
- **Sleep is read only when the COROS MCP connection already exists.** Its own helper will open an OAuth window to get there, which is right when an athlete asked for a sleep screen and unacceptable on a path that runs unattended, possibly with no window at all.

**A crossing the runner refused is still owed.** Quiet hours *defer* it in the scheduler, exactly as 3.1 defers a slot and for the same reason — the state is left unwritten, so the first tick after the window closes sees the identical transition and announces it then, and the night writes no rows. Any other refusal rolls the state back and the crossing is re-offered on the binding's own retry rhythm rather than on the tick, because one identical skip a minute is the log 10 built the pause to stop filling. A run that *reached* the provider is not a refusal, whatever it concluded.

**The firing state is per binding, on disk, and has three values.** It sits beside `next_run_at` as `threshold_firing`, and `NULL` is the one that matters: it means *never evaluated*. A binding's first tick records what the condition says and announces nothing — otherwise attaching a "tell me when my ramp is steep" coach during a steep block would immediately report a block the athlete has just finished training. After that a `false → true` transition fires and nothing else does, so a metric hovering on its threshold reports once rather than once an hour.

Falling back below is recorded but not announced. The rule is "tell me when this becomes true", and a coach that also spoke up on every recovery would be twice as loud for no more information — but the state has to move, or the rule could never fire a second time.

An automation attached to nothing is not evaluated at all: the snapshot is a scan of a month of activities and thirty days of samples, and a rule with no bindings has nobody to tell.

The state is written **before** the run, for the same reason 3.1 books the next slot before firing: a run takes as long as the provider does and the app may be closed mid-flight, so the worst case is one missed announcement rather than the same one re-announced on every tick. Editing the trigger clears it back to `NULL` alongside the booked slot, because it records whether the *old* condition held and a rule moved from 30% to 5% would be answering a question nobody is asking any more.

**Two decisions the metrics needed that 3.3 did not make.** A sleep *deficit* has to be a deficit from something, and 8 hours a night is a stated constant rather than a hidden one; nights with no reading drop out of both sides of the sum, so a watch left on the charger cannot manufacture eight hours of debt. And `planAdherence` ages slots out after two weeks — without it the metric **latches**, because a workout missed in March stays unmatched forever, so the condition would be true forever and the rule would fire once and then quietly retire itself.

### 3.4 Manual

"Run now", either from the automation screen (choose which bindings — default all enabled) or from a conversation (runs only that binding). Bypasses cooldown, quiet hours and `maxRunsPerDay`; still writes a run record with `trigger_kind = "manual"`. This is how an athlete builds confidence in a rule before enabling it, so it ships in phase 1.

**The choice is only offered where there is one.** A coach attached in one place runs straight away; attached in several, the card asks first, because running everywhere is one model call and one conversation per place and that is not something to spend on a mis-click. Paused places are listed unticked rather than hidden: the bypass above is exactly what makes "run this one now even though it is paused" a thing the athlete can mean — but never by default. For the same reason the button no longer refuses an automation whose places are all paused; it used to tell a coach attached to five conversations to attach itself to one.

---

## 4. Guard rails

Evaluated per binding, in this order; the first failure records a `skipped` run with the matching `skip_reason`:

| # | Check | `skip_reason` |
|---|---|---|
| 1 | Automation `enabled` **and** binding `enabled` | `disabled` |
| 2 | Target session resolvable (2.4) | `missing-session` |
| 2b | This activity is still owed (see below) | `no-activity` |
| 3 | Chat provider usable — every provider, not only ChatGPT (10) | `no-auth`, with the reason in words on the row |
| 4 | COROS session usable — one `reconnectTrainingHub()` attempt | `offline` / `two-factor-required` |
| 4b | The month's token budget is not spent (13) | `budget` |
| 5 | Not inside the binding's failure backoff (10) | `backoff` |
| 5b | Not inside quiet hours | `quiet-hours` |
| 6 | Cooldown elapsed since the binding's `last_run_at` | `cooldown` |
| 7 | Binding's `maxRunsPerDay` not exhausted | `budget` |
| 8 | Conversation burst guard (2.3) not exhausted | `burst` |

Two reasons are not in the table. `stale-slot` is not the runner's at all: the scheduler records it for a slot it decided never to hand over (3.1). `another-device` is the runner's but sits *before* guard rail 1 — automations sync, so the same 6am job now exists on every machine the athlete signs in on, and one lease per automation is what keeps three computers from all running it. The lease is taken inside the queue rather than around it, so a machine waiting its turn is not holding the lock; the machine that loses it records the skip and says where the work went, because an unexplained gap in the run log reads as a rule that stopped firing. See [`automationLease.ts`](../electron/sync/automationLease.ts).

**Guards 4b and 7 record the same code and are not the same event.** 4b is the month's ceiling: one fact about every automation the athlete has, so it raises the pause and stops the fan-out. 7 is this binding's own three-runs-a-day: it clears at midnight, says nothing about the other places, and raises nothing. The recorded `skip_reason` is `budget` for both — the words on the row are what tells them apart, following the precedent 10 sets for `no-auth`. Folding the two into one return value meant exhausting one binding's day held every automation in the app; see [refusals](./coach-automations-refusals.md). And two refusals leave the table as soon as they happen: guard rail 4b and the 2FA demand both raise the **pause** (10, 13), which is read before the fan-out — so the first one records a row and every trigger after it records nothing at all.

A manual run bypasses **1**, 4b, 5, 5b, 6, 7 and 8 (3.4) — including the backoff, because the athlete pressing "Run now" has usually just fixed whatever was broken and an hour of silence is the wrong answer to that. Guard 1 is in that list for the reason 3.4 gives: paused places are listed unticked rather than hidden, so "run this one now even though it is paused" is a thing the athlete can mean. Every guard reads the binding **as it stands now**, not the snapshot taken when the trigger fanned out — a catch-up sequence writes to that row between its own runs.

**Quiet hours skip for an activity, and defer for a slot.** An activity trigger has nothing to defer *to*: the activity is not going anywhere, and the next poll will find it still unanalysed because the watermark did not move. A slot is a real loss, so the scheduler moves it to the end of the window (3.1) and the run never reaches guard rail 5. The guard stays in the runner as the backstop for the paths that are not the scheduler — chiefly a run the runner was handed directly.

Two rules exist only because of `multiActivity` catch-up:

**The cooldown gates the reaction, not the backlog.** It is checked once, on the first run of a sequence. A two-hour cooldown is there to stop a binding *reacting* every few minutes; it is not a reason to strand three activities the athlete already did.

The backoff is the opposite, and deliberately so: it is checked on **every** step. A failure part-way through a sequence is exactly the storm it exists to prevent, and the resulting skip ends the sequence by the rule below.

**A refusal ends the sequence.** The daily cap will not have changed by the next activity in the list, so the run log records it once rather than once per pending activity. The watermark stays put and the leftovers ride along with the next trigger.

**Guard 2b — idempotence.** The plan for a binding is built before its runs are queued, so two triggers seconds apart (the 15-minute poll and a "Run now") can both select the same activity. Each run re-checks its activity against the freshly-read watermark, so the same activity is never analysed twice into the same conversation.

## 5. Run pipeline

### 5.1 The blocking problem

Today the transcript is assembled and persisted **in the renderer**: `persistHistory` in [ChatView.tsx:1910](../src/chat/ChatView.tsx#L1910) turns stream events into `PersistedChatEntry[]` and calls `chat:saveSession`. The main process only stores what the renderer hands it. A headless run has no renderer turn, so this logic must move.

`streamChat` ([chatService.ts:1253](../electron/chatService.ts#L1253)) pushes everything through a local `send()` that writes to `mainWindow.webContents`. It already null-guards the window ([chatService.ts:944](../electron/chatService.ts#L944)), but it also aborts the stream when the window closes ([chatService.ts:953](../electron/chatService.ts#L953)).

### 5.2 Refactor: stream sinks

Replace the `mainWindow` parameter with a sink interface, keeping the current behaviour as one implementation:

```ts
export interface ChatStreamSink {
  emit(channel: string, payload: unknown): void;
  /** Abort wiring; the window sink aborts on "closed". */
  bindAbort?(controller: AbortController): () => void;
}

export interface StreamChatOptions {
  unitSystem?: UnitSystem;
  /** Automation runs override the saved model/effort (decision 2). */
  runtime?: AutomationRuntime;
  /** Automation runs narrow the tool set (decision 3); `none` is 5.7's summariser. */
  toolPolicy?: ChatToolPolicy;
  /** Automation role, injected as its own hardened instruction block. */
  roleInstructions?: string;
}

export async function streamChat(
  sink: ChatStreamSink,
  requestId: string,
  messages: ChatMessage[],
  options?: StreamChatOptions
): Promise<void>;
```

- `createWindowSink(mainWindow)` — current behaviour, including abort-on-close.
- `createCollectorSink(marker?)` — accumulates tokens, `thinking`, and every card `kind` into a `PersistedChatEntry[]`, attributing each to the marker it was given (5.6), mirroring what [ChatView.tsx:2109](../src/chat/ChatView.tsx#L2109) does with `chat:streamInfo`, and does **not** abort when the window closes.

The runner uses a **tee sink**: collector (always) + window sink (when a window exists), so an open Coach view shows the run streaming live while persistence happens in main regardless.

Because a run may start, continue, or finish with no window at all, the tee sink resolves the window **lazily on each emit** (`BrowserWindow.getAllWindows()[0]`, guarded by `isDestroyed()`), never capturing a reference at run start. It also never calls `bindAbort`: closing the window must not abort an automation run, only an interactive one.

`ipcMain.handle("chat:send", ...)` becomes `streamChat(createWindowSink(mainWindow), ...)` — no behaviour change for interactive chat.

### 5.3 Role injection

`buildCoachInstructions(customInstructions)` ([chatCoachContext.ts:18](../electron/chatCoachContext.ts#L9)) already wraps athlete text in a delimited `<athlete_custom_instructions>` block and strips those delimiters from the input so a paste cannot escape it. The automation `role` goes through the **same** hardening as a second block:

```
<automation_role> … </automation_role>
```

appended after the athlete's custom instructions, with the same sanitizer and the same "preference data, not operating rules" framing. Role text never gets to override tool policy or confirmation rules.

### 5.4 Runner (`electron/coachAutomationService.ts`)

```
trigger event
  -> expand to one queued run per enabled binding
  -> per binding: plan the runs it owes (activity triggers: one per
                  pending activity, oldest first — see 3.2)
  -> per run: guard rails -> resolve/create target session
  -> render playbook (variables + trigger payload)
  -> streamChat(teeSink, runId, messages,
                { runtime, toolPolicy: "read-only", roleInstructions })
  -> collector entries -> saveChatSession(sessionId, [...existing, ...entries])
  -> parse output contract -> run record (success | silent)
  -> advance the binding's activity watermark
  -> emit "coachAutomation:runUpdate" to the renderer
```

**The transcript is re-read immediately before the append.** A run takes as long as the provider does, and the athlete may well have typed in that conversation meanwhile; appending to the snapshot taken at run start would delete their turn.

The conversation is created **after** every guard passes, never at guard 2. A `per-run` binding that created its conversation up front would leave an empty thread behind on every cooldown, quiet-hour or offline skip — and the watcher polls every 15 minutes.

Concurrency: one run at a time process-wide in phase 1 (simplest, and the provider is the bottleneck anyway). The queue is ordered by `session_id` then `sort_order`, so same-conversation runs stay serialized and ordered when concurrency is raised later.

Cancellation: reuse the existing `activeStreams` abort map — cancelling by run id works unchanged.

### 5.5 Output contract

Appended to every playbook by the runner, not editable per automation:

```
---
Two house rules from the app. They sit on top of the playbook above and do
not replace it — the playbook decides what to look at, how long to be, and
how the answer is laid out.

1. If nothing is materially different from recent history, reply with exactly
   NOTHING_TO_REPORT and nothing else.
2. Otherwise make the very first line one plain sentence saying what you found,
   under 140 characters. The app shows that line on its own, away from the rest
   of the answer, so it has to make sense with no context around it. Everything
   after that line belongs to the playbook — length, structure, tables,
   whatever it asked for.
```

`NOTHING_TO_REPORT` → run status `silent`, no badge, and **nothing the model wrote** reaches the transcript. What lands instead is a one-line trace — `⚡ Post-run debrief looked, nothing new · 9:49` — persisted as a `PersistedChatAutomationSilentEntry`. The opening line of a reported answer becomes the `summary` column → run-log row, and the card's *"Last run 2h ago · "Tempo felt controlled…""* line (9.1). There is no notification: native notifications are phase 4 and out of scope (12).

**Why the trace exists.** The first build wrote genuinely nothing, and a conversation that keeps no record of a run cannot be told apart from an automation that is broken. Worse, the athlete watching a run stream in saw the bubble vanish mid-sentence. A toast covered that for one release; it only reached whoever happened to be looking, and said nothing to whoever opened the conversation the next morning. The trace answers both, so the toast is gone.

```ts
export interface PersistedChatAutomationSilentEntry {
  kind: "automationSilent";
  automation: ChatEntryAutomationMarker;
  /** Epoch milliseconds. */
  at: number;
}
```

Both halves are required on the way back in: the marker says who looked, `at` says when, and a chip that can answer neither is not worth restoring. The runner appends it exactly the way it appends an answer — re-reading the conversation first, because the athlete may have typed while the model was thinking.

The time is rendered **absolute**, not relative. A transcript entry is read long after it was written, and "2h ago" becomes a lie the moment the conversation is reopened.

#### Two things the first draft got wrong

**It dictated the body.** The original contract also demanded "up to 3 observations, each one line" and "at most 1 recommended action". That is editorial taste, not machinery, and because the contract is appended *last* it quietly overruled the athlete's own playbook — a playbook asking for a week-by-week table could not get one. The contract now carries only what the app cannot work without: a line for the run log, and a way to say "nothing happened".

**It put machinery in the athlete's transcript.** The first line was originally labelled `TLDR:` so the parser could find it. The athlete reads this answer in their conversation, where a label that exists for the run log has no business appearing. Stripping it back out afterwards — from the persisted entry *and* from the live stream, where it arrives split across chunks — cost more code than finding the line does.

Rule 2 states the *reason* rather than a list of prohibitions. A model told what a line is for places it correctly in cases nobody enumerated; a model given "no heading, no bullet, no table" only learns about the three cases someone thought of.

#### Reading the answer back

`parseAutomationOutput` does two things and no more:

- `NOTHING_TO_REPORT` alone on any line (models add preamble; wrappers like `` ` `` are tolerated) → `silent`.
- Otherwise `summary` = the first line **containing a letter**, markup trimmed off both ends, capped at 140.

The one guard is general, not a list of markdown constructs to skip: a line with no letters in it is not a sentence, whatever syntax produced it. A model that ignores rule 2 and opens with a labelled table gets a poor run-log row — that is prevented in the prompt, not rescued in the parser.

### 5.6 Transcript attribution

Add an optional field to `PersistedChatMessageEntry` ([types.ts:2360](../electron/types.ts#L2360)):

```ts
automation?: {
  runId: string;
  automationId: string;
  bindingId: string;
  name: string;
  triggerLabel: string;
};
```

**Important:** `parseEntry` / `parseMessageEntry` in [chatHistoryStore.ts:784](../electron/chatHistoryStore.ts#L784) rebuild entries field by field, so an unlisted field is silently dropped on reload. The parser must be extended in the same change, with a store test covering round-trip.

Because a conversation can host up to five automations, the marker carries the automation **name**: the UI renders `⚡ <name> · <triggerLabel>` so the athlete can tell which coach spoke. The synthetic user turn is stored with `role: "user"` and the same marker, rendered as a chip rather than an athlete bubble.

### 5.6b Showing a run in the open conversation

The runner writes in the main process, behind the window's back. Two things follow, and both were live bugs before they were handled:

**A conversation can be opened mid-run.** The subscription that shows a live run only ever hears about one whose conversation is *already* open, because it filters on the active session id at delivery time. A `per-run` binding invites exactly the opposite order — its conversation appears in the sidebar the moment the run starts, and the athlete clicks it — which showed an empty transcript with nothing to say why. Switching conversations therefore asks for a run still `running` in the new one and re-establishes the bubble. The text already streamed is gone (it lives in the runner's collector, which nothing exposes), but the bubble names the coach, says *running now*, and the tokens from that point land in it; the reload at the end brings the whole answer.

**The transcript on screen goes stale — and then overwrites the run.** `ChatView` holds its own `timeline` and saves the whole array on change, so the next thing the athlete typed would write its pre-run copy straight over the coach's answer. The window therefore re-reads the conversation from disk when a run reports `success` or `silent`.

That reload happens **immediately, even mid-turn**. Deferring it until the athlete's turn ends is worse than useless: their turn persists the whole timeline, so the stale copy lands on top of the coach's answer before the deferred reload ever sees it.

**The reload is not enough on its own.** It shrinks the window from seconds to milliseconds, not to zero: a save issued between the run landing and the reload arriving still carries a pre-run array. So `saveChatSession` takes an option saying how much of the row the caller's array accounts for:

```ts
export interface SaveChatSessionOptions {
  knownEntryCount?: number;
}
```

Anything the row holds **past that point** is kept and re-appended after the incoming array. Position is the whole test, and it works because the runner only ever appends — a foreign write is always a tail. Omitting the option replaces the row outright, which is what the runner itself wants: it re-read the transcript a moment earlier with nothing awaited in between — both are synchronous SQLite calls in one single-threaded process, so no IPC handler can interleave.

**The count is clamped to the array it arrived with.** A caller claiming to account for more entries than it sent is asserting a deletion, and nothing deletes entries — the window only appends to its own timeline or rewrites it in place. Honouring the claim dropped the difference silently, which is the loss this whole mechanism exists to prevent, arrived at from the other direction.

It is a *count*, not an append-only mode, because the window legitimately rewrites its own earlier entries — a plan-draft card gaining upload state, a coach prompt gaining its answer — so it cannot send only what is new. Stating what its array is based on keeps that freedom over its own prefix while never touching a foreign tail.

Three properties make this safe rather than clever:

- **A caller that knows nothing keeps everything.** `knownEntryCount: 0` — a window that has not read the conversation, or whose read failed — preserves the whole row, so the accident this guards against fails in the harmless direction.
- **The window's base advances at send time, to what it sent** — never to what the row ended up holding. IPC handlers run in send order, so the row ends at the last array sent; setting the base on the *reply* would let an earlier save's answer roll it backwards. And basing on what was sent means a second save before the reload arrives preserves the same tail once more rather than losing it.
- **The replay guard still holds.** A window that is up to date sends an array identical to the row, so opening a conversation still does not bump `updatedAt` (9.3's ordering caveat).

The window re-bases wherever it reads the conversation from disk — `loadSession` and `reloadTranscript` — and to zero on a fresh conversation or a failed read.

**A reload cancels any save still waiting on the debounce.** That save holds the copy the reload is replacing, and the base is about to move past it; letting it fire would write the pre-run transcript back with a base that no longer covers the run's entries — the exact loss the merge exists to prevent. Every other path either fires immediately or reschedules itself, so this window is narrow, but it is the one place where the invariant depends on tracing three effect guards rather than reading one line.

**A run has to be visible while it happens.** An automation the athlete triggered and then cannot see reads as a button that did nothing. The window keeps a small, separate live state — run id, coach name, accumulated text — fed by filtering the stream events on the run id.

That state must never touch the athlete's own streaming state: theirs is persisted as *their* turn when the stream ends, and the runner has already written the same text from the main process. Card events (plan drafts, charts) from a run are ignored live; the reload at the end is what puts them on screen.

A `silent` run's live bubble is replaced by the trace of 5.5, so the window reloads the transcript on `silent` exactly as it does on `success`. The bubble does not vanish; it becomes the one-line chip that says what happened, and that chip is still there tomorrow.

`NOTHING_TO_REPORT` is a control token, not prose, and the athlete must never read it. The runner keeps it out of the transcript by persisting the trace instead of anything the model wrote; the window keeps it out of the live bubble by holding its text back while what has arrived could still *become* the marker. House rule 1 asks for the marker alone, so a run heading for silence has nothing else in flight — the guard costs one comparison and needs no chunk reassembly. The constant therefore lives in `electron/types.ts`, the one module both sides already import.


### 5.7 Context trimming

> **This is no longer automation-only.** It shipped here and now belongs to the chat as a whole: the interactive coach rolls the same summary, through the same window, on the same conversation row, and the numbers are a setting rather than two constants. The mechanism lives in [chatContextCompaction.ts](../electron/chatContextCompaction.ts) (pure) and [chatContextService.ts](../electron/chatContextService.ts) (the roll and the storage); this section is still where the reasoning is written down, and what follows now describes both callers. What changed is listed at the end.

For `dedicated` and `existing` bindings the transcript grows without bound: a daily briefing writes two entries a day and nobody ever deletes it. So does a conversation the athlete types in every morning. Both send a stored **rolling summary** in place of the head of the conversation and the recent turns in full, so a year-old thread still costs one turn. The full transcript stays on disk — this trims the context window, never the record.

The summary lives on the **conversation** (`chat_sessions.coach_summary`), not on the binding, because five automations can be attached to one conversation and the summary is a fact about the conversation. Beside it, `coach_summary_through` counts how many entries at the head it accounts for. Those two are one fact and are always written together: a row carrying a summary without its count would describe turns the model is also about to read in full.

**The count is measured from the summary, not from the start of the conversation** — and that is the difference between this and the fixed window the section first described. A literal "always send the last 20" needs the summary re-rolled on **every** turn, because every turn adds two entries to the head. Instead a roll happens only when the stretch the summary does not cover passes the limit, and rolls it back to `keep` — 60 and 20 out of the box:

- **A roll is a model call**, so doing one per run would double what an automation costs — on a feature whose whole purpose is what a long conversation costs.
- **A summary re-summarised is a compression of a compression.** Rolling once every forty runs is forty times less lossy than rolling every run, and what survives forty rounds of paraphrase is whatever happened to be in the last one.

Nothing is ever dropped: every entry is either inside the summary or inside the tail, and the two account for the whole transcript.

**The roll runs on the automation's own provider and model** (decision 2), not the interactive chat's: it is a turn taken on this automation's behalf, guard rail 3 pre-flighted *that* provider and no other, and 13 charges its tokens to this run's row. An interactive roll passes no runtime at all and so inherits the saved chat settings, which is the same rule read from the other side. Effort is the one thing that does not inherit in either case — it is cost rather than capability (7), and a summariser compressing text it was handed has nothing to think harder about.

**The pair is one fact on the way in and on the way out.** A stored summary with no count, or a count of zero, is a half-written row. Such a row reads as *no summary* — the same reading 10 gives a half-written pause — because trusting it sends a summary of turns the model is also about to read in full, and nothing downstream could notice. (The original text added that a real roll can never write a count below `limit - keep`; **that is no longer true** — "Compact context" rolls a short conversation on request — so the check is on the pair being whole, not on the count being large.)

**The summariser is a `none`-tool turn.** `ChatToolPolicy` gained a third value for it. The summariser is compressing text it was handed and has nothing to look up, so a tool round-trip is both slower and a chance to wander off the one job it has. It runs under the same idle bound as a run (10), for the same reason: it is a provider call on the automation path, and it happens while a run is still being prepared, before there is a run id for Stop to aim at.

**A roll is best-effort.** If it fails — a provider that declined, or went quiet — the run does **not** fail and the middle of the conversation is **not** dropped. It sends what it would have sent before the roll: everything the stored summary does not already cover. That costs more this once, and the next run rolls again. The alternative, trimming to the tail without a summary to stand in for the head, would quietly delete a year of context and produce an answer that reads perfectly well.

A `through` past the end of a transcript describes a conversation that is no longer there, so the summary is abandoned rather than trusted. It should not happen — the window's saves merge rather than truncate (5.6b), and a deleted conversation takes its row with it — but of everything here it is the one failure that cannot be noticed by reading the answer.

`per-run` bindings need no special case: a conversation created for one run has nothing to trim, and the same count says so.

#### What generalising it changed

| | Then | Now |
|---|---|---|
| Callers | the runner | the runner and `chat:send`'s caller in the window |
| The numbers | `AUTOMATION_CONTEXT_LIMIT` / `_KEEP`, constants | `chat.compactContext.limit` / `.keep`, with those two as defaults, plus `.enabled` |
| Where the code lives | `coachAutomationService.ts` | `chatContextCompaction.ts` (pure) + `chatContextService.ts` (roll + storage); the runner re-exports the old names for its suites |
| Who owns the entry array | the runner reads it from disk | the runner still does; the window sends its own, in-flight turn included, because reading it back here would race the window's own saves (5.6b) |
| Rolling on demand | — | `chat:compactContext` with `force`, from the conversation's `⋯` menu. Same window, same tail, so a forced roll and a triggered one leave the conversation in the same shape |
| Seeing what was sent | — | `chat:inspectContext` + [ContextHistoryDialog.tsx](../src/chat/ContextHistoryDialog.tsx), dev builds only |
| `toWireMessages` | dropped `coachPrompt` entries | expands them into the question and its answer. There were two copies of this function, one per process, and they had drifted: an automation could not see what it had asked, so it asked again |

**The window is one setting, not two.** The summary is a fact about the conversation, and a conversation can host both an athlete typing and up to five coaches. Two windows that disagreed about where the tail starts would roll each other's work forward — one of them re-summarising a summary the other had just written, which is the compression-of-a-compression this design exists to avoid.

**Compaction is invisible by construction, so the manual action has to say something.** The transcript on screen and on disk is untouched; the only observable effect is on the *next* turn. A forced roll therefore reports what it did — compacted, already short enough, or the summariser declined — rather than completing silently and looking like a no-op.

All three go to the app's one toast stack (`showToast`), the benign two included. It started as a dedicated banner above the transcript for the successes and the toast for the failure, which was wrong for a reason worth writing down: *every* outcome here is equally invisible, so splitting them across two surfaces means an athlete watching the wrong corner of the window for half of them. `runNow.ts` had already settled the same question the same way — "No new activity to analyse yet." is an error-kind toast, not a third surface.

**A failed roll carries its reason.** Best-effort silence is right for the per-turn pass, where the next turn simply rolls again; for the athlete pressing the button it is a dead control with a generic sentence attached. `rollTranscriptSummary` funnels every exit that produced no summary through one `failed(reason)` helper — provider error, idle timeout, cancellation, an empty answer, a throw — so no failure can reach a caller as a bare `null`, and the reason is logged in the main process as well as returned. Five distinguishable causes had been collapsed into one message, and that is exactly the shape of defect this document keeps finding: two readings that look identical from the outside.

**Dev builds get an inspector, and it must not roll.** Compaction being invisible is right for the athlete and useless while building it: the transcript on screen is complete whatever the model was given, so the two only diverge after a roll and nothing on screen says one happened. "Show context history" in the conversation's `⋯` menu — gated on `import.meta.env.DEV`, which is a compile-time constant, so the item and its handler leave a production bundle rather than merely being hidden in one — shows the stored summary, the turns going over verbatim, and the counts.

`inspectChatSessionContext` **plans and stops**: no roll, no write, no provider call. Two reasons, and the second is the one that decided the shape:

1. A debug view that spends a summariser turn to show you what you are spending is a trap.
2. A view that rolled would change the thing it claims to report. Opening it would advance `coach_summary_through`, and the state you came to look at would be the state your looking created.

That is why it reports `pending` separately from `tail` rather than showing "what the next turn sends" as one list. When a roll is due, the next turn will fold `pending` into the summary first — but it has not yet, and until it does those turns are still going over in full. It also reports `through` as what the summary covers **now**, not `planTranscriptContext`'s `through`, which is what that count *becomes*: an inspector reporting the future value would say a summary covers turns it has never seen.

**The interactive roll is best-effort in one more direction than the automation one.** No session yet, no bridge, or a summariser that declined all resolve the same way: send the conversation whole. A trimmed context is an optimisation, and an optimisation that eats the athlete's messages is a bug with a good excuse. The one case that needed handling on top of the automation path is Stop pressed *during* a roll: the turn has not reached a provider, so there is no stream for the cancel to find and no `chat:streamError` coming to clear the spinner. The window drops the turn itself; the summariser finishes on its own under its own request id and its own idle bound.

---

## 6. Tool policy for auto runs (decision 3)

`ChatToolPolicy` has three values: `interactive` (everything), `read-only` (decision 3's automation set) and `none`. The third is 5.7's summariser, which works on text it was handed and has no business calling anything.


`getClaudeCodeTools(permissions)` ([chatService.ts:2007](../electron/chatService.ts#L2007)) gains a policy argument. Under `read-only`:

**Allowed:** `list_recent_activities`, `get_activity_detail`, `get_fitness_trends`, `get_hr_zone_summary`, `list_scheduled_workouts`, `search_coros_exercises`, `draft_workout`, `draft_training_plan`, `request_coach_input`, and COROS MCP read tools already gated by `permissions`.

**Blocked:** `upload_training_plan`, `delete_workout`, and any future write tool. Non-COROS MCP servers the athlete configured are **excluded** from auto runs by default — their write surface is unknown.

**It is an allowlist, and it has to be.** The list above is the mechanism, not a description of one: `READ_ONLY_ALLOWED_TOOLS` holds exactly those names and a local tool that is not on it is unreachable from an unattended run. It was a *blocklist* of the two write tools until R6, which cannot deliver "any future write tool" — a tool added tomorrow was allowed, and decision 3 held only for as long as everybody adding one remembered this file existed. `test:coach-automation-guards` now scrapes every `*_TOOL_NAMES` export and fails if a tool the app owns is on neither side, so adding one forces the decision rather than defaulting to reachable.

Drafting stays allowed because it is already non-destructive: `upload_training_plan` refuses to write from a tool call and returns `confirmation_required` ([chatWorkoutTools.ts:789](../electron/chatWorkoutTools.ts#L789)); the real write happens from the athlete's confirmation card via `chat:uploadPlanDraft`. An automation therefore produces a `planDraft` entry that waits in the transcript until the athlete approves it. Identical in every phase.

`request_coach_input` ([chatInteractionTools.ts:9](../electron/chatInteractionTools.ts#L9)): in an auto run nobody is present to answer. The tool returns *"No athlete is available; state your assumption and continue."*, and the resulting `coachPrompt` entry is persisted so the athlete can answer later.

---

## 7. Model and effort override (decision 2)

`streamChat` currently reads `settings.claudeCode.model` / `.effort` (and the Anthropic equivalents) straight from `getChatSettings()`. Thread `options.runtime` through so a run can override provider, model and effort without touching saved chat settings.

Defaults when the automation leaves them unset: inherit the chat provider and its model; **effort defaults to `low`**, `AUTOMATION_DEFAULT_EFFORT` in [types.ts](../electron/types.ts), resolved by `resolveAutomationRuntime` at run time.

**The open question, decided.** The original design lowered effort to `low` for `activity` and daily `schedule` triggers only. That carve-out was rejected and a flat default taken instead:

1. **The editor already promised it.** `EffortSwitch` renders `runtime.effort ?? "low"`, so a definition saved without touching that control *showed* `low` and then ran at the interactive chat's effort. That divergence — not the cost question — was the real problem behind the deferral.
2. **A default keyed on the trigger is invisible.** The same automation moved from daily to weekly would silently get more expensive, with nothing on screen to explain it. One rule the athlete can hold in their head beats a table they cannot see.
3. **Effort is cost, not capability.** Provider and model still inherit from chat settings — those are the coach the athlete chose. How hard it thinks on a run nobody is watching is a different question, and a preset that wants more says so out loud (`Weekly review` and `Next week's plan` both ask for `medium`).

The cost of the decision: "inherit the chat's effort" is no longer expressible. It was never visible anywhere, so nothing legible is lost.

Resolved once, in the runner, so the **run log records what the run actually used** rather than what the definition happened to leave blank; the definition's blank stays blank and follows the default if it ever changes. The automation card shows the resolved value too, but only for providers where effort means anything.

The automation editor reuses [ModelSwitch.tsx](../src/chat/ModelSwitch.tsx) and [EffortSwitch.tsx](../src/chat/EffortSwitch.tsx).

---

## 8. IPC surface

`electron/main.ts` (alongside the `chat:*` handlers around [main.ts:1512](../electron/main.ts#L1512)) and `electron/preload.ts`:

| Channel | Purpose |
|---|---|
| `coachAutomation:list` | Automation summaries (binding counts, last run, next run) |
| `coachAutomation:get` | One automation with its bindings |
| `coachAutomation:save` | Create/update the definition |
| `coachAutomation:setEnabled` | Master toggle |
| `coachAutomation:delete` | Delete definition + bindings, keep conversations |
| `coachAutomation:listBindings` | Bindings of one automation, with session titles |
| `coachAutomation:attach` | Bind to `per-run` / `dedicated` / an existing session; enforces the cap |
| `coachAutomation:detach` | Remove a binding |
| `coachAutomation:setBindingEnabled` | Per-place toggle |
| `coachAutomation:reorderBindings` | `sort_order` within a conversation |
| `coachAutomation:listForSession` | The ≤5 automations attached to a conversation (chat UI) |
| `coachAutomation:runNow` | Manual run for one or all bindings; returns run ids |
| `coachAutomation:listRuns` | Run log, filterable by binding |
| `coachAutomation:cancelRun` | Abort an in-flight run |
| `coachAutomation:markSeen` | Clear the unread badge for a set of runs. **Wired end to end and called by nothing** — the sidebar clears marks through `markSessionSeen` below. Kept because the run-log surface 9.2 describes would use it |
| `coachAutomation:markSessionSeen` | Clear a conversation's marks; this is the one `loadSession` calls (9.3) |
| `coachAutomation:sessionAttention` | The `⚡`/dot projection for the conversation list (9.3) |
| `coachAutomation:getPause` | The pause, read on mount (10) |
| `coachAutomation:resume` | The single way back from a pause (10) |
| `coachAutomation:getSpend` | The month's spend and the ceiling (13) |
| `coachAutomation:setBudget` | Set or clear the ceiling (13) |
| `chat:renameSession` | New; needed by 2.5 |

Three pushes, and that is the whole of the main process's way of telling a window anything:

| Push | Carries | Announces |
|---|---|---|
| `coachAutomation:runUpdate` | the run | started / finished / failed / skipped, from the runner and from the scheduler's `stale-slot` |
| `coachAutomation:pauseUpdate` | the pause or null | 10's flag going up or coming down |
| `coachAutomation:bindingUpdate` | the binding | a binding whose *rendered* state changed with no run behind it: the slot the scheduler booked (9.1's next-run line), a binding guard rail 2 broke, a `dedicated` binding adopting the conversation it rebuilt |

`bindingUpdate` is deliberately **not** sent for the clocks nothing renders — `last_run_at`, the activity watermark, the backoff pair, `threshold_firing`. A push per binding per run for state no surface shows is the chatter that makes the next reviewer distrust the ones that matter.

Every channel string is paired across `main.ts` and `preload.ts` by `test:ipc-surface`, including the pushes: a typo in either half compiles, type-checks, passes every renderer test, and leaves the push silently dead.

---

## 9. UI

### 9.1 Automations list — Coaches → Manage automations

**Moved.** The original design put this under Settings → Coach. It belongs behind the Coaches control in the conversation header instead: automations are something the athlete manages per conversation, not a preference they set once.

Cards, one per definition:

```
⚡ Post-run debrief                                    [ On ]
   Every new running activity ≥ 20 min · Sonnet · effort low
   Runs in 3 places · Last run 2h ago · "Tempo felt controlled…"
   [ Run now ]  [ Manage ]

⚡ Morning briefing                                    [ On ]
   Every day at 07:00 · next in 9h · Sonnet · effort low
   Runs in 1 place · Running
   [ ◌ Stop ]  [ Manage ]
```

**The action reflects the run.** While one is in flight the button is **Stop**; the rest of the time it is **Run now**. Both read the run log rather than the promise that started the run — see 10.

A schedule automation carries **when it next fires** on the trigger line — the earliest slot across its bindings. It fires with nobody watching, so the card is the only place the athlete can check it without opening anything. The line is absent until the scheduler has booked a slot, which is its next tick.

`Runs in 3 places` links into the bindings tab. An automation with zero bindings is shown as **Not attached anywhere** with a prompt to attach — the most likely mistake in this model, and the one case where "Run now" is disabled with that reason. Attached but paused everywhere is *not* that case: 3.4's bypass is exactly what makes running one anyway meaningful, and the old rule told a coach attached to five conversations to go and attach itself to one.

Creating an automation is a **screen of its own**, not an inline form: a preset picker plus the shared definition form.

**The gallery.** Each preset earns its place by teaching something different about what an automation can be — a trigger kind, a binding mode, a job — rather than by being a variation on the last one. They are plain data in [coachAutomationPresets.ts](../electron/coachAutomationPresets.ts), which lives beside the store rather than in the renderer so the store's own normalizers can be run over them: a preset with a malformed trigger degrades silently to `manual` on the way in, which is exactly the typo a gallery of hand-written definitions invites.

| Preset | Trigger | Binding | Effort | What it shows |
|---|---|---|---|---|
| Post-activity debrief | activity ≥ 20 min | `per-run` | default | reacting to one session |
| Morning briefing | daily 07:00 | `dedicated` | default | a schedule, and a thread that remembers |
| Weekly review | weekly Sun 18:00 | `dedicated` | `medium` | analysis over a block, and that effort is per-automation |
| Next week's plan | weekly Mon 06:30 | `dedicated` | `medium` | that an automation can **propose**, not just describe |

`Next week's plan` is the only one that drafts. Decision 3 holds: the draft waits in the conversation as a card the athlete confirms, and nothing reaches COROS on its own.

A preset records the binding mode it was written around, and the attach screen marks it **Recommended** — advisory only; all three modes stay on offer.

### 9.2 Automation detail — three tabs

Sub-screens do not draw their own headers. Each publishes its title and back action to the modal's title bar, so there is one place to go back from however deep the athlete is.

1. **Definition** — name, role, playbook (preset starting point + variable hints), the trigger kind and its fields, model/effort, guard rails, and a danger zone.

   The trigger picker offers all four kinds — **after a new activity**, **on a schedule**, **when a metric crosses a threshold** and **manual only**. Threshold was held back from the picker while 3.3 was unbuilt, on the grounds that the control must never render with nothing selected; phase 3 built it and opened the picker, because otherwise a threshold rule could not be created at all. Switching kinds resets the trigger rather than remembering the old one — the kinds share no fields, so there is nothing to preserve. A schedule shows cadence, weekday (weekly only) and a time; an activity shows sports, minimums and `multiActivity`.

   Guard rails gained **quiet hours**, which had a place in the data model from phase 1 and no way to set. Clearing it needs an explicit `conditions.quietHours: null`: an absent key already means "unchanged", so it could not also mean "remove".

   Deleting a coach opens a confirm dialog that **lists the conversations it is attached to** and states plainly that those conversations are kept. The list is the point: it is the only place the athlete can see what a delete actually affects.

2. **Where it runs** — the binding list. Per row: enabled toggle first, last run + outcome, open conversation, run here now, reorder, detach; a row whose binding is off is greyed. Attaching is a **full screen**, not a dialog — the list of conversations needs the height, and it lists those already at 5 automations as disabled with the reason shown.

3. **Run log** — status chips, duration, model, error, target conversation, filter by binding. **A row opens the conversation it wrote into** (9.3): the row says what the coach found, and reading it is the obvious next thing to do.

### 9.3 Conversation side

The Coach view header shows **one** `Automation Coaches` chip carrying a live count, not one chip per coach: five chips crowd out the conversation for something the athlete rarely changes. The count is of *live* bindings — a binding whose automation is switched off does not count.

Its popover manages the attached coaches (toggle, reorder, run here now, detach) and offers **Attach Automation Coach**, which opens the picker as its own screen. Enabled state is one model at two depths: an automation's master switch turns off every binding; a binding switch turns off just that place, and both screens show the same state.

**"Run now" has to answer even when it does nothing.** A run that streams into the conversation is its own feedback; one that declined leaves the screen unchanged and reads as a broken button. When every run of a manual trigger is skipped, the app raises a toast saying why — *"No new activity to analyse yet."* being the common case, which is why `no-activity` is a recorded skip reason rather than a silent no-op.

Toasts from these screens reach the app's existing `Toaster` through a module-scoped emitter ([src/toast.ts](../src/toast.ts)) rather than threading a callback down through every layer.

**The conversation list carries two marks.** A `⚡` beside the title says a coach speaks here; a dot beside the timestamp says it has said something the athlete has not read, and that row's title goes bolder. Both come from one projection, `listCoachAutomationSessionAttention`, which the window turns into a `Map` keyed by session id and passes down through `ChatSidebar` → `ChatHistoryPanel` → `ChatSessionRow`.

| Mark | Shown when |
|---|---|
| `⚡` | An enabled binding of an enabled automation writes into that conversation — or a run once did, so the answer is still sitting in it |
| dot | Runs in that conversation with `seen_at IS NULL` and status `success` or `silent` |

Only those two statuses count. They are the two that write to the transcript, and therefore the two that bumped the row up the list; a skip or a failure wrote nothing and belongs in the run log. A `per-run` binding has no conversation of its own, so it marks none. A conversation with neither mark is simply absent from the projection.

**Reading it means opening it.** `loadSession` — the one funnel for "the athlete is now looking at this conversation" — clears the marks for that session, scoped to the same two statuses so a skip nobody saw is never quietly stamped as read. `reloadTranscript` deliberately does not: it fires *because* a run landed, and that case is handled by the run subscription.

**A run into a conversation that is not open is the whole point of the dot,** and the live-view subscription (5.6b) returns early for exactly those. So there is a second subscription to the same channel that watches every run: it clears the marks when the run landed in the conversation on screen — the reload has already put the answer there, so it is read on arrival — and otherwise re-reads the projection.

**Every entry point has to report what it changed.** The ⚡ mark is derived from the *bindings*, so attaching or detaching moves it. The header popover is the entry point most athletes use and it was the only one with no way upward — it refreshed its own chips and told nobody — so the mark stayed where it was until the app was restarted. It now reports on the same version counter the Automations screen uses.

**The list itself has to be re-read.** A run reaches into the conversation list from outside the window: a `per-run` binding brings a conversation into existence every time it fires (2.2), a `dedicated` one rebuilds its own when it has been deleted, and every run bumps whatever it wrote into. `ChatView` reads that list on mount and on a provider change and nowhere else, so none of it was visible until the app was restarted — a conversation the window had never heard of was simply not in the array, and the reorder below had nothing to reorder. The `running` update carries the session id already (the conversation exists before the model is asked anything), so a new one appears while the run is still going, which is the only way the athlete can open it and watch the answer arrive.

**The run log is a way back into the conversation.** A row names what the coach found and the conversation it wrote into; reading the answer is the obvious next thing to do, and it sits one screen away behind a modal covering it. The row opens it. The conversation list is re-read on the way rather than searched as it stands — a `per-run` conversation can be newer than anything the window has heard of, and one from an old run may have been deleted since; selecting a session id no row exists for would leave the sidebar with nothing selected and the composer writing into a conversation that is not there. A run whose automation overrode the provider (decision 2) wrote into *that* provider's list, so its row reports the conversation as gone rather than switching provider underneath the athlete.

**"A run is in flight here" is derived, never accumulated.** The popover's per-row spinner reads a `statuses: ["running"]` query re-run on every refresh, not a map built up from the pushes. Accumulating looked cheaper and was wrong twice: the terminal update for a `per-run` binding names the conversation the run *created*, not the one the binding is attached to, so its entry was never cleared; and switching conversations and back left the map holding runs that had finished while the athlete was elsewhere. For the same reason the subscription is deliberately **unfiltered** — filtering on the open session's id threw away every update about a `per-run` row on screen. Runs are serialised process-wide (5.4), so the query reads at most one row.

**Ordering caveat:** commit `d893206` deliberately stopped read-only opens from bumping `updated_at`, and `saveChatSession` skips the write when the transcript is unchanged ([chatHistoryStore.ts:1096](../electron/chatHistoryStore.ts#L1096)). An auto run *does* change the transcript, so it bumps the conversation to the top. That is intended, and the dot is what stops it reading as a glitch. Unread state lives in `coach_automation_runs.seen_at`, not a new flag on `chat_sessions`, so marking a conversation read touches no row the sidebar orders by — the list does not reshuffle underneath the athlete as they click.

## 10. Failure handling

| Failure | Behaviour | Built |
|---|---|---|
| Provider not authenticated | `skipped` (`no-auth`) with the reason in words, no retry storm, banner on the Automations panel; pre-flighted for **every** provider | ✅ |
| COROS token expired | one `reconnectTrainingHub()` attempt, then `skipped` | ✅ |
| COROS demands 2FA | one `skipped` (`two-factor-required`) row, then **every** automation is paused until the athlete resumes | ✅ |
| Network offline | `skipped` (`offline`), retried on the next tick | ✅ |
| Target conversation missing | `dedicated` recreates it; `existing` disables the binding with `missing-session` | ✅ |
| Provider error / rate limit | `failed` with message, and the binding backs off 5m → 15m → 60m | ✅ |
| One binding throwing mid-fan-out | that binding records a `failed` run, the rest still run | ✅ |
| App quits mid-run | run left `running`; on next start, stale `running` rows become `cancelled` | ✅ — shipped in phase 1, not phase 3 |
| A run that reached the model and then could not write its answer | one `failed` row through the run's own exit, the watermark left, and the backoff applied | ✅ |
| Provider stops answering mid-run | `failed` after 3 minutes of silence, the stream aborted, and the binding backs off exactly as a thrown run does; "Run now" offers **Stop** throughout | ✅ |

**A timed-out run leaves both clocks where they were.** Like a thrown one, it returns before `last_run_at` and the activity watermark advance, so the work is not lost. On its own that leaves nothing to slow the retry down — an activity trigger would offer the same activity again on the next 15-minute poll, and again after that — which is what the **backoff** is for.

**The startup reconciliation touches the run log and nothing else**, and that is load-bearing rather than incidental. A `cancelled` run taken through the runner's own exit *clears* the binding's backoff streak — so routing the reconciliation through it, which is the obvious tidy-up, would mean a crash resets the hold on every binding that was failing. The app closing is not a provider reporting itself healthy, any more than the athlete pressing Stop is.

**The backoff is a third clock on the binding, and a guard rail in the runner.** A `failed` run holds its binding off for 5 minutes, then 15, then 60, and stays at 60; anything that reached the provider and did not fail clears the streak. It lives beside `last_run_at` and the watermark because it is the same kind of thing — per-binding state that survives a restart — and it is enforced where every other *whether* is enforced (4), not in the scheduler. The scheduler goes on booking and firing slots; the runner declines them with a `backoff` skip. Two consequences worth stating:

- **A run that never reached the provider says nothing either way.** The exit taken when Stop lands while a run is still being prepared leaves the streak exactly where it was. It is the one place `finish` is reached without a provider call, and treating it as a success would let an athlete pressing Stop reset the hold on a binding that is failing.
- **A skip is neither a failure nor a success.** It never reached the provider, so it says nothing about whether the provider is alive, and it leaves the streak exactly where it was. A `backoff` skip clearing the backoff would be a guard rail that switches itself off the first time it does anything. The single skip decided *after* the provider answered — `no-auth` — follows the same rule for the same reason.
- **It is the timeout that made this necessary, so the timeout has to be covered by it.** Both paths return early and leave the other two clocks alone, and both go through the run's one exit, so the two are the same code. The runner suite asserts that by running the same three-failure sequence against a provider that throws and one that goes quiet, and comparing the traces.

**A run is bounded by silence, not by wall clock.** A playbook that walks a month of activities through several tool rounds is legitimately slow; a provider that has stopped answering emits nothing at all, and the tee sink of 5.2 sees every token, tool call and status line, so it is the one place that can tell the two apart. Three minutes quiet and the run is given up on: `cancelChat` aborts the stream, and the run records `failed` with the reason.

The bound matters beyond the run that trips it. Runs are serialised process-wide (5.4), so a `streamChat` that never settles wedges **every later run and every later "Run now" for the life of the process** — the athlete sees a button that spins with nothing behind it and no way out. Neither the MCP connect nor the provider fetch on this path carries a deadline of its own, so the runner keeps one. Aborting alone would not be enough: a stall inside a call that never looks at the signal would still hold the queue, so the runner stops waiting on the stream and lets it settle in its own time.

**"Run now" reflects the run, not the promise.** `runCoachAutomationNow` resolves only once the whole fan-out has finished, so a button whose spinner is that promise's lifetime tells the truth only by accident: the Automations panel is not unmounted by opening a coach, so the spinner outlived the run; the modal *is* unmounted on close, so a reopen mid-run showed an idle button and would happily queue a second one. All three surfaces — the panel card, the detail's binding rows, the conversation popover — read `running` off the run log instead, which every one of them already follows by push, and offer **Stop** (`coachAutomation:cancelRun`) while it lasts.

The promise is still awaited, for two things the log cannot give. One is the outcome: whether every run of this trigger declined or failed, and why (9.2) — a failure now raises a toast alongside the skips, because a provider that stopped answering leaves a conversation exactly as empty as one that was never asked. The other is a floor under the log: a trigger fans out to one run per place (2.3) and they are serialised, so between two of them there is a moment with no `running` row at all, and a card reading only the log would offer "Run now" in the middle of its own fan-out.

**Stop stops the trigger.** It used to stop one run: the abort map is keyed by run id, `runAutomationTrigger` loops over its plan awaiting each `enqueue`, and so a three-place fan-out took three presses — aimed, in between, at runs that did not exist yet and therefore had no id to aim at. A **cancellation token per trigger** fixes that. Every run a fan-out produces is claimed by its token, so Stop on any one of them finds the whole trigger; the run's own stream is still aborted, which is where the id comes in.

The token is read at the top of every step, not only between them. That is what covers the step already sitting in the process-wide queue (5.4) behind a stalled run — the one Stop could not previously reach, and which used to start anyway once the idle bound gave up three minutes later. A step dropped that way logs nothing: a run log full of rows for runs that never happened is not what Stop means.

It is also read once more, after the COROS check and before the provider call, for the Stop that lands while a run is still getting itself ready. That run has a row by then, so it is finished as `cancelled` rather than dropped.

All three surfaces reach this through the one `coachAutomation:cancelRun` handler, so all three got it at once; what each of them had to change is the copy, because a button that now ends a five-conversation fan-out must not still read "Stop this run".

**Guard rail 3 pre-flights every provider, and reads nothing off the network.** It used to inspect only ChatGPT's stored token and answer a flat "fine" for the other three, which meant an automation running on a provider with no API key, no model or no CLI learned that from the stream, one wasted run at a time. Each provider now answers from a **local** read — a stored OAuth token, the CLI state the app recorded last time it looked, a key in the keychain, a configured model — and that is a rule rather than a convenience: a pre-flight that reached out would be a second way for a run to hang, on the one path that already learned what that costs.

The verdict carries its reason in words, and the reason lands on the skipped row. `no-auth` is the right code for all of these — the provider cannot be asked — but "not signed in" is only one of the things it can mean, and a run log that cannot tell a missing API key from a missing CLI sends the athlete to the wrong screen.

**What declines is what is unambiguous *and* stable.** A CLI that reports `sign-in-required` or `not-installed` will still report it in fifteen minutes. Everything else goes through and is left to the stream: `connecting` is in flight, `connection-failed` may be a network that has since come back, and a `claude-code` state the app has **never recorded** is the shape of a fresh install whose Coach view nobody has opened. Declining on unknown would hold every automation on a machine where nothing is wrong, which is the failure this whole section exists to avoid.

**The sign-in banner.** An expired provider sign-in produces `no-auth` skips and nothing else — no error, no failed run, just automations quietly declining. The Automations panel says so, derived from the summaries already on screen rather than a second query: every *enabled* automation whose **last** run declined for that reason is the shape a signed-out provider makes, and it clears itself the moment one of them runs again.

It matters most for the providers with no sign-in gate. ChatGPT puts one in front of the whole Coach view, so the athlete never reaches this panel signed out; the others have none, and without the banner they would have no indication at all.

**A 2FA demand pauses everything, because it is one thing to fix.** Every other guard rail is a fact about one binding, and recording it per binding is right — a cooldown or a quiet hour is exactly what the run log is for. This one is not. COROS asking for a login code is the same answer for every automation in the app, and no amount of retrying anywhere can supply it, so the old behaviour was five bindings recording `two-factor-required` every fifteen minutes for as long as it took the athlete to notice.

So the pause is **one flag**, in `app_settings`, persisted — a restart must not quietly resume a paused world. A per-binding column would have been five copies of one fact, each able to disagree with the others. It carries the run that tripped it, so the banner points at something real, and a half-written or hand-edited row reads as *not paused*: trusting a shape nobody checked would hold every automation forever on the strength of a string in a settings table, and the way out of that is a banner that never renders.

**It is read at the gate, not as a guard rail.** A held trigger produces no runs and logs nothing, which is the whole point — a guard rail would have turned N identical skips into N identical skips with a different reason. The fan-out that trips it stops there too, for the same reason: the remaining places would each write the same row. What survives is the single skip that explains the pause.

Three things follow from where the gate sits:

- **A manual run goes through.** 3.4's bypass already means "the athlete is asking", and this is the case where that matters most: it is how they find out whether the fix took. Still locked, and they get the one skip that says so rather than a button that silently does nothing; unlocked, and the run succeeds and clears the pause.
- **The pause lifts itself when its cause is gone.** The athlete signs in to COROS from a settings screen that knows nothing about automations, and nothing would ever ask again — the gate is what stopped the asking. So the gate checks, on a local read of stored credentials, whether COROS is authenticated again. That is the cause disappearing rather than a second way to resume.
- **Nothing is lost while paused.** The activity watcher keeps stamping `coach_seen_at`, but that marker only decides when the watcher *fires*; which activities a binding still owes is its own `last_activity_at`, and no run advances it while everything is held. The scheduler keeps booking slots and the briefings inside the paused window are simply missed, which is 3.1's rule and not a new one.

**Resume promises "try again", not "fixed".** It clears the flag and nothing else. Whether COROS is reachable is a question only the next trigger can ask, and it re-trips the pause if the answer is still a login code — so the button keeps the only promise it can. It is the single control the prompt asked for, on the Automations panel beside the sign-in banner, which has the same reach and the same limitation: an athlete who never opens that screen never sees either.

---

## 11. Testing

Follow the existing `scripts/test-*.mjs` convention (see `package.json`):

| Suite | Covers | Built |
|---|---|---|
| `test:coach-automation-store` | definition CRUD, JSON round-trip, `multiActivity` normalisation, every preset surviving the normalizers | ✅ |
| `test:coach-automation-bindings` | the monthly budget setting (whole tokens, and everything that is not a positive number reading as no ceiling), the backoff columns' round-trip (including a pre-migration row reading as healthy), 5-per-conversation cap, duplicate-attach rejection, single `per-run` binding, cascade on delete, broken binding, reordering, watermark round-trip, slot invalidation on a trigger edit, the conversation-list attention projection, the pause flag's round-trip and its half-written rows reading as *not* paused, and the source-level assertions that are genuinely about source — the preload/main pair, the attach screen's dedicated-binding flow, the preset's recommended mode, the signed-out banner | ✅ |
| `test:coach-automation-renderer` | the components **executed**: the run-now picker's threshold in both directions and the athlete's answer reaching the runner, the picker defaulting to every live place rather than every place, the popover reporting an attach and re-reading its own rows, a run update re-reading the conversation list — and a run with no conversation not doing so — the marks following a run into a conversation nobody is looking at while a run into the open one is read on arrival, the live bubble re-establishing (with the coach's name) on a conversation opened mid-run, and the pause banner — read on mount, followed by push, and its Resume reaching the main process rather than only clearing itself — and section 13's spend line: the month's total rounded, the runs it cannot see named, the typed ceiling reaching the main process as a number, and a budget pause explaining itself rather than offering 2FA advice. Plus a clean console on every one | ✅ |
| `test:coach-automation-sql` | the run-row filters against **real SQLite**, the activity scan's index, the binding columns phase 3 added (backoff, and the three values of `threshold_firing`), the daily-sample cache's column-wise upsert, 5.7's summary columns round-tripping while the transcript beside them is untouched, and section 13's monthly SUM — which rows it counts, which it leaves out, and how it separates "reported nothing" from "cost nothing" | ✅ |
| `test:coach-automation-guards` | read-only tool allowlist, the `none` policy handing back nothing at all, `request_coach_input` no-athlete response | ✅ |
| `test:coach-automation-runner` | fan-out and ordering, output contract, activity selection (all six rules of 3.2), cooldown-vs-catch-up, the daily cap ending a sequence, two triggers racing off one watermark, the mid-run append race (for an answer and for the silent-run trace), silent/failed watermark handling, section 7's effort default across every trigger kind, the idle watchdog — a provider that goes quiet, one that talks for six windows without a gap, and a stall not holding the runs behind it — the failure backoff (its three steps and its ceiling, what clears it and what does not, the manual bypass, a sequence stopping on it, and a timed-out run backing off identically to a thrown one), cancelling a trigger (one press ending a fan-out, the step behind a stall, the Stop that lands mid-preparation, and one that no live trigger owns), guard rail 3's pre-flight for all four providers — including that one provider's problem holds back none of the others and that an unrecorded CLI state is not a refusal — the 2FA pause (one row rather than one per binding, a held trigger logging nothing, the manual probe, the self-heal, Resume re-tripping, and an offline COROS pausing nothing), 5.7's context trimming (the limit's boundary, the split accounting for the whole transcript, the count measured from the summary rather than the start, a stale `through` abandoning the summary, the prompts on both sides of a roll, and a failed roll falling back to the full transcript rather than dropping its middle), and section 13's cost (the month's boundary, the ceiling's `>=`, every exit that reached a provider recording what it spent, an unreported cost staying unknown, and the budget pause tripping once and lifting on all three of its causes) | ✅ |
| `test:coach-activity-watcher` | cold start, one trigger per automation however many activities landed, payload-free triggers, per-automation matching, and 3.3's sample snapshot — throttled, bounded, unstamped on failure, and not gated on there being an activity trigger | ✅ |
| `test:coach-automation-threshold` | each metric's boundary in both directions, the windows they read and what falls outside them, a missing reading breaking a streak rather than passing through it, the baseline excluding the streak it measures, an old miss ageing out, the per-binding transition (seed-and-be-silent, fire once, sixty ticks of hovering, recovery re-arming), the state written before the run, and it surviving a restart | ✅ |
| `test:coach-automation-plan-draft` | draft approval from an auto run still writes through `chat:uploadPlanDraft` | ✅ |
| `test:chat-history-store` | the `automation` field round-trip, the silent-run trace round-trip and its half-formed rejections, `setChatSessionTitle`, the renderer/runner save race and the option's path through the IPC chain | ✅ |
| `test:coach-automation-schedule` | next-slot maths, seeding, book-before-run ordering, missed-slot skipping, quiet-hours deferral, both DST boundaries, per-binding independence, tick re-entrancy | ✅ |
| `test:chat-stream-sink` | 5.2's seam, which every headless run goes through: the window sink's abort-on-close and its teardown, the collector building the transcript an interactive turn would have, a re-emitted card replacing rather than appending, and 13's usage arriving on a *failed* turn as well as a finished one | ✅ |
| `test:ipc-surface` | section 8's contract: every channel string paired across `main.ts` and `preload.ts`, no push also registered as a handler, no listener whose emitter was renamed away, and the preload/renderer key sets agreeing | ✅ |

The habits this feature earned the hard way:

**A new test must be shown to fail.** After fixing a bug found in review, revert the fix and confirm the test goes red. Several tests written here passed against the broken code — the cooldown-vs-catch-up test passed because a stale snapshot happened to produce the right answer, and the sequence-break test passed because the fixture had exactly as many activities as the cap allowed.

**A wrong test looks exactly like a right one until it is mutated.** The scheduler's ten mutations were run against its suite before the suite was believed: reverse the book/run order, swap a calendar step for `+ 86_400_000`, loosen `>` to `>=` on the stale threshold, drop the re-entrancy guard. The re-entrancy test was the one that did not bite — its single binding had already had its slot advanced by the first tick, so a second tick found nothing to do either way. It needed a second binding the first tick had not yet reached.

**Static checks do not find UI bugs.** Driving the real app over the Chrome DevTools Protocol found an empty `MODEL` fieldset, a delete button rendered in the safe-action accent, a dialog that could not scroll, and an infinite render loop that only ever announced itself in the console. **Read the console, not just the DOM.** The renderer harness does: every block ends by asserting the page logged nothing, which is why it is built against React's *development* bundle — the production one drops the warnings that say a component is looping or setting state after unmount.

**A mutation that does not compile is not a detection.** Twice here a mutation was recorded as caught when the suite had never run — `tsc` rejected the edit first. Both had to be rewritten as variants that compile and are still wrong. The same discipline applied to the source-level assertions while they were the renderer's only cover: three of them passed against genuinely broken code because the regex matched a *different* call site, or asserted that a query existed without asserting where its answer went. Those three are gone now — they are the reason the harness below exists.

**Renderer wiring is executed now, not grepped.** `test:coach-automation-renderer` mounts the real components in a hidden Electron `BrowserWindow` against a stubbed `CorosLinkApi`, drives them through the DOM, and asserts in node so a failure reads like every other suite. Electron rather than a DOM emulation because it is already a dev dependency and already hosts a suite, so the harness costs nothing new — and because the bugs being chased are the kind a real browser has.

**What is left at the source level is source that is about source**, and each of the survivors now carries a line saying which kind it is. A regex earns its keep for a contract between two files that never run in the same process — the preload/main pair, where an argument dropped on either side type-checks and compiles into a call that quietly does the wrong thing. The harness cannot see across that bridge, because the harness *is* the stub standing in for it. The same goes for the marker held back from the live bubble (5.5) and the pair of `chatTypes` converters, which are claims about shape rather than behaviour.

**And for a default dep, which no suite can reach.** Every suite here injects fakes, deliberately — which makes `createDefaultDeps` and the body of `streamChat` permanently outside them. Four assertions live there for that reason and nothing else: the three emitters of `bindingUpdate`, the single `chat:streamError` send that carries what the turn spent, `addUsage` routing every tool round through the same rule, and the draft the plan-draft tool hands to the wire untouched. Each is a *rule* rather than a shape — the first version of the last one pinned five exact lines and went red on a harmless refactor, which is the failure mode a regex has and a rule does not.

Six more are portable and **not** ported: four on the sidebar marks and one on the signed-out banner, whose surfaces the harness already mounts, and three on `AttachAutomationScreen`, which it does not. They are marked in place. The test that decided which to port first was not "is it a regex" but "is it the only thing covering a bug".

**A regex that counts call sites is the weakest kind, and there were two.** The first asserted `onCoachAutomationRunUpdate` appeared exactly three times in `ChatView.tsx` and called that "a run into a conversation that is not open must still update the marks" — a claim it cannot make, since three listeners all doing the same thing satisfy it. Its replacement is two behavioural claims: a run into a conversation nobody is looking at re-reads the marks and is *not* marked read, and the same run into the open one is.

The second survived that pass: `setStartingId` appearing exactly twice, standing in for "the card's run flag outlasts the gap inside its own fan-out". It fails as loudly for a correct third call site as for a wrong one, and cutting the wire it protects left the *whole* renderer suite green — so it was the only cover for a real bug. Ported: the harness now holds a fan-out open with a promise it resolves by hand, and reads the button. A stub that answers immediately cannot express "the fan-out is still going", which is the whole of 10's *"Run now reflects the run, not the promise."*

**A fixture can sit exactly where two readings agree.** The trimming suite's "the count is measured from the summary" test used a 200-entry conversation whose summary covered 180 — and there the correct reading and the wrong one produce *identical* output, because the roll a start-counted reading would trigger has nothing left to fold in. The mutation that swapped one for the other went undetected until the fixture moved to 100 entries with 50 covered, where the two genuinely disagree. Picking the boundary is not enough; the fixture has to sit where the mutation would show.

**An assertion can be about the wrong axis and still pass.** The threshold suite claimed "one snapshot for the whole tick" against a fixture with two *bindings* — but the snapshot is read once per *automation*, outside the binding loop, so the fixture would have read once either way and the mutation that removed the caching went undetected. Rewriting it with two automations is what made the claim testable. The lesson is the same shape as the counting regex of item 2: an assertion has to vary along the axis it is about.

**A fake that collapses two facts hides the wire between them.** The runner's world modelled "COROS credentials are on disk" and "a reconnect would succeed" as one field, because in the ordinary case they agree. They do not always: the gate reads the first and the run reads the second, and the case where they differ — nothing on disk, but a reconnect that works — is the only one in which the run's own COROS check is what lifts the pause. With one field the two were indistinguishable, so removing that clear was a mutation nothing caught. Splitting the field is what made the wire testable.

**The negative half of a claim is the half that needed new machinery.** A wire that fires for everything passes every "did it fire" test, so what the harness had to grow was a way to say *and not then* — a settle that lets the page finish and then asserts a call count is still zero. Two of the ported claims are only claims at all because of it: the conversation list must *not* re-read for a run that touched no conversation, and the live bubble must *not* appear on a conversation with no run in it.

---

## 12. Phasing

### Phase 1 — shipped

Definitions, bindings and runs; `setChatSessionTitle`; the stream-sink refactor; a headless runner with per-binding fan-out, per-session serialization and per-binding activity watermarks; read-only tool policy; role injection; model/effort override; `activity` and `manual` triggers; all three binding modes; the Automations screens; conversation-side chips, attach and toasts; a run streaming live into the open conversation.

Cooldown, `maxRunsPerDay`, quiet hours and the burst guard were listed for phase 2 but **shipped in phase 1** — the runner could not be correct without them once activity triggers existed. Stale-`running` cleanup on startup likewise moved up from phase 3.

### What phase 1 did not build

| Gap | Why it waited | Phase |
|---|---|---|
| Schedule trigger (3.1) | Needs its own ticker and slot maths; activity triggers proved the pipeline first | 2 — **built** |
| Silent runs leave no trace in the transcript (5.5) | Needs a new `PersistedChatEntry` kind — a design decision, not a detail | 2 — **built** |
| `saveChatSession` overwrites rather than appends | A sub-second collision between the athlete's turn and a finishing run can still lose one of them (5.6b) | 2 — **built** |
| `⚡` chip and unread dot in the sidebar (9.3) | Only earns its keep once runs happen unattended | 2 — **built** |
| Preset gallery | One preset was enough to prove the form | 2 — **built** |
| Effort defaults per trigger kind (7) | A silent per-automation discount deserves a deliberate decision | 2 — **decided**, and the trigger-kind carve-out rejected (7) |
| Context trimming (5.7) | No `dedicated` conversation is long enough to need it yet | 3 |
| Threshold triggers (3.3) | The hardest to get right and the easiest to get wrong | 3 |
| Pause-all on 2FA, per-binding backoff (10) | Single skips are correct today; the escalation layer is not | 3 — and backoff is now **first**, see below |
| Token budget | Needs per-run cost accounting first | 3 |

**A review pass after step 15** found: a stale debounced save that could fire after a reload had moved the base past it (5.6b); a malformed schedule trigger re-booking `null` on every tick forever; the batch-window control offered on triggers that ignore it; a doc comment orphaned from its function and another mangled mid-sentence by a scripted edit; and ~280 lines of import-block churn from a sort helper, which buried the real diff. The scheduler firing a run end to end — the one phase-2 path never exercised in the app — was verified then too.

### Phase 2 — Unattended, and visible

The theme is **the athlete is not watching**. Phase 1 runs are things the athlete triggered or was present for; phase 2 is the first time a coach speaks into an empty room, and everything here is about that being trustworthy rather than eerie.

1. ~~**Schedule triggers.**~~ **Built.** 60s ticker owned by the `app` lifecycle, per-binding `next_run_at`, catch-up as the first tick, the 24h stale-slot rule, quiet-hours deferral (3.1). It pulled in three things the plan did not have: a trigger picker and quiet-hours fields in the definition form, slot invalidation when a trigger is edited, and the next-slot line on the automation card — a rule that fires unattended is not finished until the athlete can see when.
2. ~~**Silent runs leave a trace.**~~ **Built.** A collapsed transcript entry — *"⚡ Post-run debrief looked, nothing new · 9:49"* — instead of nothing at all, persisted by the runner and parsed back in `chatHistoryStore.ts`. The live-bubble toast it replaces is gone; the guard that holds the marker back from the bubble stays (5.5, 5.6b).
3. ~~**Append-on-save.**~~ **Built.** `chat:saveSession` takes `knownEntryCount`, and anything the row holds beyond it survives the window's save. Closes the last correctness hole in 5.6b.
4. ~~**Attention.**~~ **Built.** `⚡` chip and unread dot in the conversation list, driven by `coach_automation_runs.seen_at` (9.3), and the signed-out-provider banner on the Automations panel (10).
5. ~~**Presets.**~~ **Built.** Four presets (9.1), and section 7's open question decided: a flat `low` default rather than the trigger-kind carve-out, which was rejected with the reasoning recorded.

**A UAT round after step 15** found six bugs, and five of them were the same shape: *something true in the main process that no window was ever told about.* Phase 2 moved the work out of the renderer and left the renderer reading a world it had stopped being notified of.

| What the athlete saw | What was actually true |
|---|---|
| "Run now" spun forever with no answer and no way out | Two faults at once: nothing bounded a run, and one stalled run wedges the process-wide queue (10); and the spinner was the IPC promise's lifetime, so it outlived the run in one direction and vanished mid-run in the other |
| A `per-run` run's new conversation never appeared until a restart | `ChatView` reads the conversation list on mount and on a provider change, and a run creates conversations from outside it (9.3) |
| Attaching or detaching from the header popover left the `⚡` mark where it was | The mark is derived from bindings, and the popover was the one entry point with no way to report a change (9.3) |
| Opening a conversation mid-run showed an empty transcript | The live-bubble subscription filters on the *active* session at delivery time, so it only ever hears about a run whose conversation is already open (5.6b) |
| "Run now" from the automation screen ran everywhere with no way to choose | 3.4 always said "choose which bindings"; only the default had been built |
| The attached-count badge sat a pixel low | `place-items: center` centres the line box, not the glyph in it (9.1) |

Nothing in the data model changed. Every fix was a wire, every wire type-checked before and after, and every one now carries a source-level assertion that dies when it is cut (11).

**A second review pass** found two more of the same kind, both introduced by the fixes above: the popover's "a run is in flight here" map was accumulated from pushes it also filtered, so a `per-run` row never cleared and a conversation switch left it stale; and the automation card, reading `running` off the log alone, offered "Run now" in the gap between two runs of its own fan-out.

### Phase 3 — Judgement, cost, and surviving both

**Shipped.** The theme was **the coach deciding for itself when to speak, and the app surviving what that decision costs** — safe to attempt only once phase 2 had made unattended runs legible.

Phase 2 reordered this list. Threshold triggers are still the headline, but they are no longer first: one item that read as tidying-up is now the only thing phase 2 left actively unsafe, and two are new, because the UAT round showed what an unattended feature does when something goes wrong and nobody is watching. Listed in the order they should be built.

1. ~~**Backoff, and cancelling a trigger.**~~ **Built.** Section 10 describes what exists: `backoff_until` / `backoff_level` beside the binding's other clocks, a guard rail in the runner rather than the scheduler, and a token per trigger that Stop cancels through any run the trigger has claimed.

   Three things the plan did not have. A **skip** turned out to be neither a failure nor a success — the case that decides whether the guard rail works at all, since a `backoff` skip that cleared the backoff would switch the feature off on its first use. The token is read **at the top of each step** rather than only between them, which is the only read that reaches a step already queued behind a stall, and a second time after the COROS check for a Stop that lands mid-preparation. And a mutation pass over the suite found the first draft's three checks were mutually redundant — none of them individually necessary, so none of them individually testable — which is why the fan-out loop now carries a shortcut and the step carries the guard.

2. ~~**A renderer harness.**~~ **Built**, as `test:coach-automation-renderer` (11). It went the component-runner way rather than the CDP-over-the-real-app way, and the deciding argument was not fidelity but cost: a hidden `BrowserWindow` under Electron is a real Chromium, Electron is already a dev dependency, and the repo already runs a suite under it. A CDP pass would have had to boot the whole app — COROS session, database, a real provider — to assert things about four wires.

   Four things the plan did not have. **`requestAnimationFrame` never fires in a window that is never shown**, so the first settle built on it waited forever instead of failing — the worst way for a test to be wrong; it is timers only now. **Vite's `build` stamps `NODE_ENV=production` before it resolves the config**, so `mode: "development"` alone still gave the production React build, and with it none of the warnings the harness exists to read. The **negative half** of each claim is what needed the new machinery at all, and two of the ported claims are only claims because of it. And the weakest assertion in the block turned out to be the one that *counted call sites*, which is why its port is two claims rather than one.

3. ~~**Auth escalation.**~~ **Built.** Section 10 describes what exists: one persisted flag rather than a column per binding, read at the gate rather than as a guard rail so a held trigger logs nothing, and a pre-flight that answers per provider from local state only.

   Three things the plan did not have. The pause had to stop **the rest of the fan-out that tripped it**, not just the polls after it — otherwise the first trip still wrote one row per binding, which is the log this was meant to stop filling. It had to **lift itself** when COROS is signed in from a settings screen that knows nothing about automations, because the gate is what stopped anything asking again; that is the cause disappearing, not a second way to resume. And the pre-flight had to decide what to do about a provider state the app has **never recorded** — a fresh install — where refusing would hold every automation on a machine where nothing is wrong.

4. ~~**Threshold triggers**~~ **Built.** Section 3.3 describes what exists: four pure metrics, a `threshold_firing` column beside `next_run_at` whose `NULL` means *never evaluated*, and a transition check on the scheduler's tick.

   Three things the plan did not have. **Two of the four sources were not cached at all** — 3.3 named `getDailyMetrics` and "sleep data service", which are COROS requests — so the step had to build `coach_daily_samples` and a snapshot job in the activity watcher before the metrics had anything local to read. **`planAdherence` latches** without a lookback: an unmatched workout stays unmatched forever, so the rule would fire once and then retire itself, which is why old slots age out after two weeks. And **`sleepDebt` needed a target to be a deficit from**, plus a rule for nights with no reading — counting those against a full night manufactures eight hours of debt out of a watch left on the charger.

5. ~~**Long conversations.**~~ **Built.** Section 5.7 describes what exists.

   Three things the plan did not have. The window is **elastic**, measured from the summary rather than from the start of the conversation: the literal "always send the last 20" would have re-rolled the summary on every run, which doubles what an automation costs and compresses a compression forty times a year. A roll is **best-effort** — a summariser that declined must not fail the run, and must not trim to a tail with nothing standing in for the head, which would delete a year of context and still produce an answer that reads perfectly well. And `ChatToolPolicy` gained a `none` value, because the summariser has nothing to look up and a tool round-trip there is both slower and a way to wander off.

6. ~~**Cost.**~~ **Built**, as section 13.

   Three things the plan did not have. Nothing in the app had **ever** asked a provider what a turn cost, so the step ran through all four of them — and one of them, a local OpenAI-compatible server, can decline to answer, which is what forced the distinction between *unreported* and *free*. A budget that reads the second as the first is worse than no budget, because it is a number the athlete would trust. **Failed and cancelled runs are counted**: the tokens were spent, and forgiving them leaves a ceiling a broken provider can run through for nothing. And reaching the ceiling reuses item 3's **pause** rather than being a guard rail on its own — the month's allowance is one fact about every automation, so a skip per binding per poll until the 1st is the run log that machinery already exists to stop filling.

**Smaller things, triaged.** Each of the three was carried through three phases; the review closed them out.

| Carried item | Verdict |
|---|---|
| A run's partial text is lost when a conversation is opened mid-run — the collector has it, nothing exposes it, so the re-established bubble starts empty (5.6b) | **Kept as a limitation, deliberately.** Exposing it means a fourth push carrying accumulated text, or a query for a partial transcript; the bubble already names the coach, says *running now*, and the reload at the end brings the whole answer. The gap is seconds of text the athlete gets anyway |
| A run whose automation overrode the provider writes into that provider's conversation list; the run log reports the row as gone rather than offering to switch (9.3) | **Kept, and now the stated behaviour rather than a loose end.** Switching provider underneath an athlete who clicked a run-log row is worse than telling them the conversation is elsewhere. The alternative — showing every provider's conversations in one list — is a change to the chat, not to automations |
| The scheduler's tick awaits the runs it starts, so the tick is not purely a decision | **Closed.** It is bounded by the idle watchdog (10), runs are serialised process-wide (5.4), and R2 established that the tick's own state — the booked slot, the threshold flag — is written before the run and rolled back only on a refusal. Any future parallelism reckons with 5.4's queue, not with the tick |

**Four more the review chose not to fix, each for a reason and each written down where it belongs:**

- **`sort_order` does not order runs across triggers.** 2.3 promises *"sequentially in `sort_order`"*; sequentially is built and correct, the ordering is not — a fan-out is one automation, and one automation has at most one binding per conversation, so the tiebreaker never breaks a tie. Two automations writing into one conversation are ordered by whichever fired first. Honouring it needs a queue both the scheduler and the watcher feed, which is architecture. See [lifecycle](./coach-automations-lifecycle.md).
- **The pause banner reaches only the Automations panel.** 10 already says so; what it did not say is the consequence on the conversation side, where the popover goes on offering "Run here now" — which still works, because 3.4's bypass means a manual run goes through. See [pushes](./coach-automations-pushes.md).
- **A skip repeats once per poll while a refusal lasts** — 96 rows a day for a binding whose provider is signed out. That is 4's stated rhythm and the price of an activity coming round again at all; bounding it interacts with the fan-out's pause check, 9.3's toast and the log's own purpose. See [cost and exposure](./coach-automations-cost-and-exposure.md).
- **A crash between the roll and the run row loses the roll's cost.** One synchronous step wide, and there is no row to put the number on. See [persistence](./coach-automations-persistence.md).

### Phase 4 — Beyond the process lifetime

Explicitly out of scope. Auto-launch at login, a tray presence that keeps the app alive with no window, native notifications. Everything before this phase runs only while the app itself is running (decision 1).

### Deliberately out of scope, so nobody rediscovers it

Restated in one place, because each of these looks like an omission until you know it was a decision:

- **Nothing keeps the process alive.** Decision 1, and phase 4 is where that changes. A run with no window still completes and persists; the athlete sees it as unread next time a window exists.
- **No native notification.** 5.5's summary line feeds the run log and the card, and nothing else.
- **The run log is never pruned.** 2.4 keeps run history on purpose. ~1,500 rows a year for four automations, and both queries that read it are indexed.
- **`threshold_firing`, the activity watermark, the backoff clocks and the rolling summary have no surface.** They are machinery; the run log is what the athlete reads. Whether the backoff deserves a countdown is a design question, not a gap.
- **"Inherit the chat's effort" is not expressible.** 7 traded it for one rule the athlete can hold in their head; it was never visible anywhere.
- **Non-COROS MCP servers are unreachable from a run**, and a *new* local tool is too until somebody puts it on 6's allowlist. Both are the safe default, deliberately.
- **A backlog longer than ten loses its oldest entries.** 3.2, and the reason is provider spend rather than an oversight.
- **The athlete's own activity names reach the prompt unsanitised**, in the focus line, at the same level as their own playbook. The *role* block is hardened because it reaches the system instructions; this one does not. Revisit if activity names ever come from anywhere but the athlete's own watch.

## 13. Cost

Every phase-2 addition multiplied what this feature spends — a schedule fires whether or not anything happened, and the run-now picker turns a five-place fan-out into one click — and until now there was no number anywhere saying so.

**Every run that reached a provider records what it cost.** `input_tokens` and `output_tokens` on the run row, summed across the turn's tool rounds, because a tool-using answer is several provider calls and the athlete pays for all of them. It is recorded on **every** exit that reached the model — success, silent, failed and cancelled — not just the successful one: a budget that forgave failures is a budget a broken provider can run through for nothing, and one that forgave cancellations would make a fan-out stopped halfway cost nothing on paper.

**A provider that reports nothing leaves the cost unknown, not zero.** The columns are NULL, the totals count the run as uncounted, and the panel says how many runs it cannot see. Conflating the two would make a budget read as comfortably under when nobody actually knows — which is worse than no budget, because it is a number the athlete would trust. Cache reads and writes go into the input count wherever a provider separates them: the athlete is billed for those too.

| Provider | Reports | Where from |
|---|---|---|
| `claude-api` | ✅ | `finalMessage().usage`, per tool round |
| `claude-code` | ✅ | the Agent SDK's `result` message, whole query |
| `chatgpt` | ✅ | `response.completed`, per round |
| `local` | best-effort | `stream_options: { include_usage: true }`, which a server may ignore |

**A failed turn is not a refund**, and for a long time it was: usage reached the run row only through `chat:streamDone`, which a stream that errors never sends — so *no* failed run had ever recorded a cost, which is the exact hole this section claims to close. Every error send now carries what the turn spent, through one helper rather than a rule remembered at each throw site.

**And a report that cannot be counted is not a report.** Negative, `NaN` and infinite all read as *unreported*, at both entry points: the per-round sum inside `streamChat` and the collector's own ingest. It matters because of who reports it — `local` is whatever OpenAI-compatible server the athlete pointed the app at, and a negative round quietly reduces a total whose final value looks perfectly reasonable. Zero stays a cost: a cancelled run that never reached the model genuinely cost nothing.

**The rolling summariser's turn is on the bill.** 5.7 is the one feature built to make a long conversation affordable, and it pays for that with a provider turn of its own; reading only the run's own stream left that turn outside this total, so the budget under-reported by exactly the thing whose whole purpose is cost.

**The ceiling is read before the total.** The total is a `SUM` over the whole run log and no ceiling is the default, so asking in the other order would make every athlete who never set a budget pay for that scan on every run to discard the answer. The scan itself has its own index — the run log's other two are both prefixed by an id, so neither can serve a query that narrows by nothing but the date.

**The budget is one number, monthly, and off by default.** A ceiling nobody chose is a ceiling that pauses the athlete's coaches at an arbitrary moment, so the default is none, and everything that is not a positive number — zero, blank, a hand-edited row — reads as none rather than as a stop. The month is the **athlete's**, on their wall clock, because a budget is something a person plans around.

**Reaching it is guard rail 4b, and it raises the pause.** The same shape as section 10's 2FA demand and for the same reason: the month's allowance is one fact about every automation the athlete has, so one skip per binding per poll until the 1st is exactly the run log this already learned not to fill. One row explains it, the fan-out that hit it stops there, and every trigger after it is held at the gate.

`>=`, not `>`: 500k means five hundred thousand tokens is what the athlete agreed to, and the run that would take them past it has not been paid for. A ceiling that lets one more run through every time is not a ceiling.

**Three things lift it, and none of them is a second button.** The month rolling over, the athlete raising the ceiling, and the athlete clearing it. All three are the same check — is the month's spend still over the number — made at the gate, so the pause lifts itself the way a 2FA one does when COROS is signed in elsewhere.

**Each pause lifts on its own cause, not on any good news.** The two reasons share one flag, and the run pipeline clears a 2FA pause the moment a COROS session answers — which a "Run now" reaches even while a *budget* pause is up, because the athlete's own button bypasses the gate. Clearing there would take the banner down and let one more unattended run through before guard rail 4b put it back, so the clear is narrowed to the reason it is about.

**"Run now" spends anyway.** Every other rate guard yields to 3.4's bypass and this one is no different: an athlete who has been shown the number and presses the button has decided. A ceiling that also refused them would be a ceiling on their own decisions rather than on unattended spend.

### What the feature costs, counted

Measured rather than estimated, so nobody has to count it again — the workings are in [coach-automations-cost-and-exposure.md](./coach-automations-cost-and-exposure.md), and the watcher's per-tick reads are asserted in `test:coach-activity-watcher`.

| | Cost |
|---|---|
| Scheduler tick, steady state | 4 store calls: one automation list, one binding list per automation. The threshold snapshot is read **once** per tick and only when a threshold rule exists |
| Watcher tick | 1 automation list, 1 COROS-auth read, 1 unseen-activity scan, 1 COROS index fetch — plus one payload-free trigger per enabled activity automation, which is what makes a refused activity come round again (4) |
| One run | ~21 store calls and **1 provider turn**, plus one turn per tool round the model asks for, plus one for a roll. A roll happens once every `LIMIT - KEEP` = 40 runs |
| Rows per day, four automations and one activity | ~4 run rows, 1 conversation (the `per-run` debrief's), 1 daily sample. About 1,500 run rows a year |

**Nothing prunes the run log**, deliberately (2.4). At that rate nothing degrades: the log is read with `limit: 50` behind `idx_automation_runs_automation`, and the monthly `SUM` has `idx_automation_runs_started`.

The one unbounded number is **skips**. A binding refused persistently — a signed-out provider is the realistic case — writes one row per 15-minute poll for as long as it lasts, which is 96 a day. Queries do not degrade; the run log becomes hard to read, which is the same complaint 10 makes about the 2FA case. Bounding it is an open decision, not a defect.

---

## Appendix: build prompt sequence

Each prompt is one focused session, verified before the next. They assume this document is on disk.

### Phase 1 — as built

The ten planned steps all landed. Four things the plan did not have:

- **Step 6 grew.** Activity selection moved out of the watcher and into the runner (3.2), which pulled in the per-binding watermark, `multiActivity`, and the guard-rail rules in 4.
- **A review pass after step 10** found orphan conversations on skipped runs, dead lifecycle code, a fan-out that aborted on one binding's failure, and a `NOTHING_TO_REPORT` marker destroyed by its own summary stripper.
- **Several UAT rounds** moved the screens (9.1), reshaped the conversation-side UI (9.3), and made a run visible while it happens (5.6b).
- **A second review** found an infinite render loop, a duplicate-analysis race, and a missing index.

The original ten prompts are preserved below as a record of the shape; anyone re-deriving this feature should read the *sections* they point at, which now describe what exists.

<details>
<summary>Original phase 1 prompts</summary>

1. **Schema + definition store** — tables, indexes, `coach_seen_at`, TS shapes, `coachAutomationStore.ts`, store test.
2. **Binding store + rules** — attach/detach/toggle/reorder, the 5-per-conversation cap, lifecycle rules (2.4), `setChatSessionTitle` (2.5), binding test.
3. **Stream sink refactor** — `ChatStreamSink` + `StreamChatOptions` replacing `mainWindow`/`unitSystem`, `createWindowSink`, no behaviour change.
4. **Collector sink + attribution** — `createCollectorSink`, the `automation` field on `PersistedChatMessageEntry` **and** on `parseMessageEntry`.
5. **Read-only policy, runtime override, role injection** — sections 5.3, 6, 7.
6. **Runner with fan-out** — sections 2.3 and 5.4.
7. **Activity watcher** — section 3.2, started in `app.whenReady()`, stopped in `before-quit`.
8. **IPC + preload** — section 8.
9. **Automations list + detail** — sections 9.1 and 9.2.
10. **Conversation-side integration** — section 9.3.

</details>

### Phase 2

11. ~~**Schedule trigger**~~ — **built**, as [coachAutomationScheduler.ts](../electron/coachAutomationScheduler.ts). The guard rails were reused as asked: the scheduler decides *when*, and everything about *whether* stays in the runner. Section 3.1 now describes what exists.

12. ~~**Silent runs leave a trace**~~ — **built**. Sections 5.5 and 5.6b describe what exists. One thing the prompt did not have: the renderer's *own* converters (`toPersistedEntries` / `fromPersistedEntries` in `chatTypes.ts`) rebuild entries field by field too, so the athlete's next message would have stripped the trace back off. The union catches a missing branch; nothing catches a missing field, which is why that pair is asserted at the source level.

13. ~~**Append-on-save**~~ — **built**. Section 5.6b describes what exists, including why the option ended up a count rather than the append-only mode the prompt asked for.

14. ~~**Attention**~~ — **built**. Sections 9.3 and 10 describe what exists. Two things the prompt did not have: the rows live in `ChatHistoryPanel`/`ChatSessionRow`, not in `ChatSidebar`, which is a shell; and every coach-automation suite until now injected a hand-written database, so a WHERE clause could be wrong in `database.ts` with all of them still green. `test:coach-automation-sql` opens a real SQLite file under Electron and closes that.

15. ~~**Presets and defaults**~~ — **built**. Sections 9.1 and 7 describe what exists. Two things the prompt did not have: the presets moved from `src/` to `electron/` so the store's normalizers could be run over them in a test, and three of the four recommend a `dedicated` binding — which turned out to have never worked (2.1).

**UAT** — six bugs, listed in 12. No prompt: they came from using the thing.

A second UAT closed the review, on the real app against a stub provider and an isolated profile: the whole walk-through from an empty database to a run landing in the sidebar. It found **no behavioural bug** — the four rounds before it had taken those — and one stale sentence in 9.2, which is above. What it did confirm, and no suite can: the app boots clean, a `per-run` conversation appears in the sidebar without a restart and titled from the real activity name, the silent trace is the only thing in its conversation, the card's spend line rounds, and the token count on the row is exactly what the provider reported. The shape they share is worth carrying into phase 3 — phase 2 moved the work into the main process and left the renderer reading a world it had stopped being notified of, so *every push the main process sends is part of the feature's contract, not an optimisation*. It also added two things the plan never had: a bound on how long a run may say nothing (10), and the "where should this run?" picker 3.4 had always described but nobody had built.

### Phase 3

One prompt per item of 12's phase-3 list, in the same order and for the same reasons.

16. ~~**Backoff and cancelling a trigger**~~ — **built**. Sections 4, 10 and 11 describe what exists. The prompt's original text:

    "Read docs/coach-automations.md sections 10 and 12 (phase 3, item 2). Add per-binding exponential backoff after a `failed` run — 5m, 15m, 60m, reset on any non-failure — stored beside the binding's other clocks and enforced as a guard rail in the runner, not in the scheduler. Then add a cancellation token per trigger, checked between the steps of `runAutomationTrigger`'s plan, so Stop ends a fan-out rather than one run of it, and wire it to the Stop control on all three surfaces. Cover both in scripts/test-coach-automation-runner.mjs, including that a timed-out run backs off exactly as a thrown one does."

17. ~~**A renderer harness**~~ — **built**. Section 11 describes what exists. The prompt's original text, with its stale cross-reference: the renderer harness is phase 3 item **2**, not 6 — phase 2 reordered that list and the appendix was not updated with it.

    "Read docs/coach-automations.md section 11 and phase 3 item 6. Every phase-2 UAT bug was renderer wiring that type-checked, and the only cover it has is a regex over the source. Stand up something that executes the renderer — a component runner, or a scripted CDP pass over the app with a stub provider — and port the source-level assertions in test-coach-automation-bindings.mjs that are really behavioural claims: the conversation list re-reading on a run update, the popover reporting an attach, the live bubble re-establishing when a conversation is opened mid-run, the run-now picker's threshold. Keep the source assertions that are genuinely about source (the ipc-surface pair, the marker held back from the live bubble)."

18. ~~**Auth escalation**~~ — **built**. Sections 4 and 10 describe what exists. The prompt's original text:

    "Read docs/coach-automations.md section 10. Pause every automation when COROS demands 2FA, with a banner that says so and a single way to resume — today each binding records `two-factor-required` on its own and the run log fills with the same skip. Then add a provider-auth pre-flight that works for more than ChatGPT, closing guard rail 3's known limit."

19. ~~**Threshold triggers**~~ — **built**. Sections 1 and 3.3 describe what exists. The prompt's original text:

    "Read docs/coach-automations.md section 3.3. Add the four threshold metrics, evaluated on the scheduler tick from locally cached data, with **per-binding** firing state stored beside `next_run_at` so a rule fires on the transition rather than on every tick the condition holds — and so a metric hovering on its threshold cannot produce a run an hour. Add scripts/test-coach-automation-threshold.mjs covering each metric's boundary, the transition state surviving a restart, and a binding attached today not firing on history."

20. ~~**Long conversations**~~ — **built**. Sections 5.7 and 6 describe what exists. The prompt's original text:

    "Read docs/coach-automations.md section 5.7. Add context trimming for `dedicated` and `existing` bindings with a stored rolling summary, so a year-old briefing conversation still costs one turn."

21. ~~**Cost**~~ — **built**, as section 13. The prompt's cross-reference is off by one — Cost is phase 3 item **6**, not 5; phase 2 reordered that list and the appendix was not renumbered with it, the same slip step 17 carried. The prompt's original text:

    "Add per-run token accounting to the run log and a monthly budget with auto-pause (section 12, phase 3, item 5). The schedule trigger and the run-now picker both multiply spend and neither shows a number anywhere."
