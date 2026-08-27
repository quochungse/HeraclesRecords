# Coach Automations — ground-truth map

Companion to [coach-automations.md](./coach-automations.md). This file is a
checkable inventory of what the feature actually is in `electron/`, plus every
place the doc no longer describes it. Nothing here is a fix and nothing here is
a judgement about whether the built behaviour is right — only whether the doc
says what the code does.

Read against commit `d99c295` (`feature/auto_coach`). Renderer components were
deliberately not read; the renderer column below is a call-site index, not a
review of what those components do with the answer.

> **Status after the review.** Every drift item in §7 has been resolved in
> `coach-automations.md` by R7 step 14 — the status lines, the seventeen stale
> line references, §8's missing channels and the `runUpdate` name, §4's bypass
> list, §1's `ensureColumn` caveat and the missing index, §5.2's snippet, §11's
> two missing suites and its call-site-regex claim, §5.5's phantom notification,
> and §7.6's `budget` collision (fixed in code, not just described). Two items
> outlived the drift list rather than being fixed: `coachAutomation:markSeen`
> still has no caller — now documented as such in §8 — and the `types.ts`
> comments in §7.11 are unchanged. The **inventories** above are still the
> current shape of the feature, plus the `bindingUpdate` channel R3 added.

---

## 1. Tables and columns

### 1.1 Tables the feature owns

`electron/database.ts`, inside the `CREATE TABLE IF NOT EXISTS` block that
starts at [database.ts:148](../electron/database.ts#L148).

| Table | Where | Doc section |
|---|---|---|
| `coach_automations` | [database.ts:375](../electron/database.ts#L375) | 1 |
| `coach_automation_bindings` | [database.ts:389](../electron/database.ts#L389) | 1, 2 |
| `coach_automation_runs` | [database.ts:421](../electron/database.ts#L421) | 1, 5.5, 13 |
| `coach_daily_samples` | [database.ts:456](../electron/database.ts#L456) | 1, 3.3 |

### 1.2 Columns, in the `CREATE TABLE` blocks

**`coach_automations`** — `id`, `name`, `role`, `playbook`, `enabled`,
`preset_id`, `trigger_json`, `conditions_json`, `runtime_json`, `created_at`,
`updated_at`. All of section 1; the three `_json` blobs are section 1's
`AutomationTrigger` / `AutomationConditions` / `AutomationRuntime`.

**`coach_automation_bindings`** — `id`, `automation_id`, `mode`, `session_id`,
`title_template`, `enabled`, `sort_order`, `last_run_at`, `next_run_at`,
`created_at`, plus `FOREIGN KEY (automation_id) … ON DELETE CASCADE`.
Sections 1, 2.1, 2.4, 3.1.

**`coach_automation_runs`** — `id`, `automation_id`, `binding_id`, `status`,
`trigger_kind`, `trigger_payload_json`, `session_id`, `summary`, `model`,
`effort`, `error`, `skip_reason`, `seen_at`, `started_at`, `finished_at`.
Sections 1, 4, 5.5, 9.3.

**`coach_daily_samples`** — `day` (PK, local `YYYYMMDD`), `resting_hr`,
`sleep_minutes`, `captured_at`. Section 3.3.

### 1.3 Columns added by `ensureColumn`

[database.ts:475–499](../electron/database.ts#L475). These are **not** in the
`CREATE TABLE` blocks, which matters for what a fresh-vs-migrated database
looks like.

| Table | Column | Type | Doc section |
|---|---|---|---|
| `chat_sessions` | `coach_summary` | TEXT | 5.7 |
| `chat_sessions` | `coach_summary_through` | INTEGER | 5.7 |
| `training_activities` | `coach_seen_at` | TEXT | 3.2 |
| `coach_automation_bindings` | `last_activity_at` | INTEGER | 3.2 |
| `coach_automation_bindings` | `backoff_until` | TEXT | 10 |
| `coach_automation_bindings` | `backoff_level` | INTEGER | 10 |
| `coach_automation_bindings` | `threshold_firing` | INTEGER | 3.3 |
| `coach_automation_runs` | `input_tokens` | INTEGER | 13 |
| `coach_automation_runs` | `output_tokens` | INTEGER | 13 |

### 1.4 Indexes

| Index | On | Doc section |
|---|---|---|
| `idx_binding_unique_session` (unique, partial) | `bindings (automation_id, session_id) WHERE session_id IS NOT NULL` | 1, 2.2 |
| `idx_binding_unique_per_run` (unique, partial) | `bindings (automation_id) WHERE session_id IS NULL` | 1, 2.2 |
| `idx_binding_session` | `bindings (session_id)` | 1 |
| `idx_training_activities_start_time` | `training_activities (start_time)` | 1, 3.2 |
| `idx_automation_runs_automation` | `runs (automation_id, started_at DESC)` | 1 |
| `idx_automation_runs_binding` | `runs (binding_id, started_at DESC)` | 1 |
| `idx_automation_runs_started` | `runs (started_at)` | **13 (prose only — absent from section 1's SQL block)** |

---

## 2. IPC surface

Handlers: [main.ts:1486–1613](../electron/main.ts#L1486).
Preload: [preload.ts:985–1076](../electron/preload.ts#L985).
Renderer files are call sites found by grep; `src/coroslink-api.ts` declares the
type for every one and is omitted from the caller column.

| Channel | Main handler | Preload method | Renderer callers | Doc §8 |
|---|---|---|---|---|
| `chat:renameSession` | [main.ts:1486](../electron/main.ts#L1486) → `setChatSessionTitle` | `renameChatSession` | `AttachAutomationScreen` | ✅ |
| `coachAutomation:list` | [main.ts:1493](../electron/main.ts#L1493) → `listCoachAutomationSummaries` | `listCoachAutomations` | `CoachAutomationsPanel`, `AttachAutomationScreen`, `AttachCoachToConversationDialog`, `ConversationCoaches` | ✅ |
| `coachAutomation:get` | main.ts:1496 | `getCoachAutomation` | `CoachAutomationDetail`, `CoachAutomationsPanel`, `RunNowDialog`, `ChatView` | ✅ |
| `coachAutomation:save` | main.ts:1505 | `saveCoachAutomation` | `CoachAutomationDetail`, `CoachAutomationCreate` | ✅ |
| `coachAutomation:setEnabled` | main.ts:1513 | `setCoachAutomationEnabled` | `CoachAutomationsPanel` | ✅ |
| `coachAutomation:delete` | main.ts:1518 | `deleteCoachAutomation` | `DeleteAutomationDialog` | ✅ |
| `coachAutomation:listBindings` | main.ts:1522 | `listCoachAutomationBindings` | `AttachAutomationScreen` | ✅ |
| `coachAutomation:attach` | main.ts:1529 | `attachCoachAutomation` | `AttachAutomationScreen`, `AttachCoachToConversationDialog` | ✅ |
| `coachAutomation:detach` | main.ts:1542 | `detachCoachAutomation` | `CoachAutomationDetail`, `ConversationCoaches` | ✅ |
| `coachAutomation:setBindingEnabled` | main.ts:1547 | `setCoachAutomationBindingEnabled` | `ConversationCoaches`, `CoachAutomationDetail` | ✅ |
| `coachAutomation:reorderBindings` | main.ts:1553 | `reorderCoachAutomationBindings` | `ConversationCoaches`, `CoachAutomationDetail` | ✅ |
| `coachAutomation:listForSession` | main.ts:1560 | `listCoachAutomationsForSession` | `ConversationCoaches` | ✅ |
| `coachAutomation:runNow` | main.ts:1569 → `runAutomationNow` | `runCoachAutomationNow` | `CoachAutomationDetail`, `ConversationCoaches`, `CoachAutomationsPanel` | ✅ |
| `coachAutomation:listRuns` | main.ts:1575 | `listCoachAutomationRuns` | `ConversationCoaches`, `CoachAutomationDetail`, `ChatView` | ✅ |
| `coachAutomation:cancelRun` | main.ts:1583 → `cancelAutomationRun` | `cancelCoachAutomationRun` | `CoachAutomationDetail`, `ConversationCoaches`, `CoachAutomationsPanel` | ✅ |
| `coachAutomation:markSeen` | main.ts:1602 → `markCoachAutomationRunsSeen` | `markCoachAutomationRunsSeen` | **none** | ✅ |
| `coachAutomation:getPause` | main.ts:1590 | `getCoachAutomationPause` | `CoachAutomationsPanel` | ❌ |
| `coachAutomation:resume` | main.ts:1592 | `resumeCoachAutomations` | `CoachAutomationsPanel` | ❌ |
| `coachAutomation:getSpend` | main.ts:1595 | `getCoachAutomationSpend` | `CoachAutomationsPanel` | ❌ |
| `coachAutomation:setBudget` | main.ts:1598 | `setCoachAutomationBudget` | `CoachAutomationsPanel` | ❌ |
| `coachAutomation:sessionAttention` | main.ts:1606 | `listCoachAutomationSessionAttention` | `ChatView` | ❌ |
| `coachAutomation:markSessionSeen` | main.ts:1611 | `markCoachAutomationSessionSeen` | `ChatView` | ❌ |
| `coachAutomation:runUpdate` *(push)* | `emitAutomationRunUpdate` [coachAutomationService.ts:575](../electron/coachAutomationService.ts#L575) | `onCoachAutomationRunUpdate` | `ChatView`, `CoachAutomationDetail`, `ConversationCoaches`, `CoachAutomationsPanel` | ⚠️ named `coachAutomation:onRunUpdate` in §8 |
| `coachAutomation:pauseUpdate` *(push)* | `emitAutomationPauseUpdate` [coachAutomationService.ts:584](../electron/coachAutomationService.ts#L584) | `onCoachAutomationPauseUpdate` | `CoachAutomationsPanel` | ❌ |

Also on the feature's path but not owned by it: `chat:saveSession`
([main.ts:1464](../electron/main.ts#L1464)) grew the third argument
`SaveChatSessionOptions` for 5.6b.

---

## 3. Injectable dep seams

| Seam | Where | What it stands in for | Suite that drives it |
|---|---|---|---|
| `CoachAutomationDatabase` | [coachAutomationStore.ts:58](../electron/coachAutomationStore.ts#L58); default at `createDefaultDatabase`, threaded as the last parameter of 32 exported functions | every row read/write, plus the pause and budget settings (`readPause`/`writePause`/`readBudget`/`writeBudget`) | `test:coach-automation-store`, `test:coach-automation-bindings` |
| `CoachAutomationRunnerDeps` | [coachAutomationService.ts:494](../electron/coachAutomationService.ts#L494), 30 members; default at `createDefaultDeps` [:599](../electron/coachAutomationService.ts#L599) | clock, store, session store, transcript summariser, provider pre-flight, COROS session, pause, budget, collector, `streamChat`, run-update emit, cancel, `idleTimeoutMs` | `test:coach-automation-runner` (and the trimming/cost/backoff/2FA blocks inside it) |
| `CoachAutomationSchedulerDeps` | [coachAutomationScheduler.ts:44](../electron/coachAutomationScheduler.ts#L44), 9 members | clock, automations, active bindings, `setBindingNextRun`, `recordStaleSlot`, `runTrigger`, `readThresholdSnapshot`, `setBindingThresholdFiring`, `onError` | `test:coach-automation-schedule`, `test:coach-automation-threshold` |
| `CoachActivityWatcherDeps` | [coachActivityWatcher.ts:54](../electron/coachActivityWatcher.ts#L54), 13 members | clock, `refreshActivityIndex`, unseen rows, `markSeen`/`markAllSeen`, automations, COROS auth, settings get/set, `runTrigger`, `readDailySamples`/`writeDailySamples`, `dailySampleTimeoutMs`, `onError` | `test:coach-activity-watcher` |
| `ChatStreamSink` | [chatService.ts:859](../electron/chatService.ts#L859); `createWindowSink` :884, `createCollectorSink` :941 | where a stream's events go (5.2) | `test:chat-stream-sink` |
| `ChatSessionDatabase` | `chatHistoryStore.ts`, threaded into `saveChatSession` :1057, `createChatSession` :1009, `setChatSessionTitle` :1119 | the conversation rows the runner appends into | `test:chat-history-store` |
| `CorosLinkApi` stub | `scripts/test-coach-automation-renderer.mjs` fixtures | the whole preload bridge, for mounted components | `test:coach-automation-renderer` |

Not a seam but the same shape: `getClaudeCodeTools(permissions, policy)`
([chatService.ts:1812](../electron/chatService.ts#L1812)) is a pure function of
its arguments, which is what lets `test:coach-automation-guards` drive the
`read-only` / `none` allowlists with no chat service behind it.

---

## 4. `app_settings` keys

| Key | Written by | Meaning | Doc section |
|---|---|---|---|
| `coachAutomation.activityWatcherInitializedAt` | [coachActivityWatcher.ts:30](../electron/coachActivityWatcher.ts#L30) | cold-start stamp; its absence is what makes the first tick `markAllSeen()` instead of replaying the back catalogue | 3.2 (behaviour described, key not named) |
| `coachAutomation.dailySamplesCapturedAt` | [coachActivityWatcher.ts:41](../electron/coachActivityWatcher.ts#L41) | six-hour throttle on the resting-HR/sleep snapshot; deliberately not stamped on failure | 3.3 (behaviour described, key not named) |
| `coachAutomation.pause` | [coachAutomationStore.ts:131](../electron/coachAutomationStore.ts#L131) | the one pause flag; JSON `{reason, since, runId?}`, a half-written row reads as *not paused*; deleted rather than blanked on resume | 10, 13 |
| `coachAutomation.monthlyTokenBudget` | [coachAutomationStore.ts:168](../electron/coachAutomationStore.ts#L168) | the monthly ceiling in whole tokens; anything not a positive number reads as no ceiling | 13 |

No other `app_settings` key belongs to this feature.

---

## 5. Constants worth pinning

| Constant | Value | Where | Doc section |
|---|---|---|---|
| `SCHEDULER_TICK_INTERVAL_MS` | 60 000 | coachAutomationScheduler.ts:33 | 3.1 |
| `STALE_SLOT_MS` | 24 h | coachAutomationScheduler.ts:39 | 3.1 |
| `ACTIVITY_POLL_INTERVAL_MS` | 15 min | coachActivityWatcher.ts:25 | 3.2 |
| `ACTIVITY_LOOKBACK_DAYS` | 7 | coachActivityWatcher.ts:28 | 3.2 |
| `DAILY_SAMPLE_INTERVAL_MS` | 6 h | coachActivityWatcher.ts:42 | 3.3 |
| `DAILY_SAMPLE_LOOKBACK_DAYS` | 35 | coachActivityWatcher.ts:45 | 3.3 |
| `DAILY_SAMPLE_TIMEOUT_MS` | 60 000 | coachActivityWatcher.ts:52 | 3.3 |
| `ACTIVITY_SCAN_LIMIT` | 200 | coachAutomationService.ts:217 | 3.2 |
| `MULTI_ACTIVITY_MAX_PER_TRIGGER` | 10 | coachAutomationService.ts:224 | 3.2 |
| `SESSION_BURST_PER_HOUR` | 5 | coachAutomationService.ts:330 | 2.3 |
| `AUTOMATION_BACKOFF_STEPS_MS` | 5m / 15m / 60m | coachAutomationService.ts:345 | 10 |
| `AUTOMATION_IDLE_TIMEOUT_MS` | 3 min | coachAutomationService.ts:1297 | 10 |
| `SUMMARY_MAX` | 140 | coachAutomationService.ts:65 | 5.5 |
| `AUTOMATION_CONTEXT_LIMIT` / `_KEEP` | 60 / 20 | coachAutomationService.ts:1131, 1134 | 5.7 |
| `AUTOMATION_DEFAULT_EFFORT` | `"low"` | types.ts:2674 | 7 |
| `THRESHOLD_LOOKBACK_DAYS` | 33 (`max(28, 30+3, 7)`) | coachThresholdMetrics.ts:44 | 3.3 |
| `PLAN_ADHERENCE_LOOKBACK_DAYS` | 14 | coachThresholdMetrics.ts:41 | 3.3 |
| `SLEEP_TARGET_MINUTES` | 480 | coachThresholdMetrics.ts:55 | 3.3 |

Lifecycle: watcher and scheduler start at
[main.ts:863–864](../electron/main.ts#L863) inside `app.whenReady()`
([main.ts:772](../electron/main.ts#L772)) and stop in `before-quit`
([main.ts:879–882](../electron/main.ts#L879)); `cancelStaleCoachAutomationRuns()`
runs immediately before them.

---

## 6. Test suites, and the one thing each cannot see

Every suite is `scripts/test-*.mjs`, per the `package.json` convention.

| Suite | What it would fail to catch |
|---|---|
| `test:coach-automation-store` | It drives an in-memory `CoachAutomationDatabase`, so any SQL in `database.ts` that disagrees with the fake — a wrong `WHERE`, a column mapped to the wrong index — passes here untouched. |
| `test:coach-automation-bindings` | Its remaining renderer regexes assert *text*, not execution: the `setStartingId` call-count check is satisfied by two calls anywhere in the file, including two wrong ones. |
| `test:coach-automation-renderer` | The stub `CorosLinkApi` **is** the bridge, so nothing on the main side of it is visible — a preload/main argument mismatch, or a store returning a correctly-shaped but wrong answer, looks identical to correct. |
| `test:coach-automation-sql` | It issues the queries itself against real SQLite; it cannot say the runner or scheduler ever call them, or call them with those arguments. |
| `test:coach-automation-guards` | It checks the allowlist as a pure function; it cannot say `streamChat` actually threads `toolPolicy` into each of the four provider paths. |
| `test:coach-automation-runner` | `createDefaultDeps` is never exercised — every one of the 30 members is replaced — so a default wired to the wrong store function type-checks and is never run here. |
| `test:coach-activity-watcher` | `refreshActivityIndex` is stubbed, so the side effect the whole diff depends on — `listTrainingHubActivities` persisting each page into `training_activities` — is asserted nowhere. |
| `test:coach-automation-threshold` | The metrics are driven from hand-built snapshots; the default `readThresholdSnapshot` mapping (rows → `{startTime, load}` / `{day, restingHr, sleepMinutes}` / `{day, matched}`) is not exercised, so a mis-mapped column reads as a metric that simply never fires. |
| `test:coach-automation-plan-draft` | It follows the draft entry through persistence; it cannot say the confirmation card is reachable from the transcript an automation wrote. |
| `test:chat-history-store` | It asserts the merge and the option's path through IPC, not the window's base bookkeeping — a `knownEntryCount` computed from the wrong array still merges "correctly" here. |
| `test:coach-automation-schedule` | The scheduler's deps are all fakes, so it cannot say `recordStaleSlot` really emits, or that the runner honours the `bindingIds` the tick hands it. |
| `test:chat-stream-sink` *(not in §11)* | It covers `createWindowSink`/`createCollectorSink` in isolation; the tee sink the runner actually builds lives in `coachAutomationService.ts` and is not this suite's. |
| `test:ipc-surface` *(not in §11)* | It compares channel **strings** only: a channel handled and invoked with mismatched argument order passes, and its `SECTION_8_CHANNELS` list is hand-maintained. |

---

## 7. Drift: where the doc and the code disagree

### 7.1 The doc contradicts itself about its own status

- [coach-automations.md:3](./coach-automations.md) — "phase 1 shipped, phase 2
  shipped, **phase 3 shipped**. The rest of phase 3 is still design." The second
  sentence survives from before phase 3 landed; §12's phase-3 list marks all six
  items **Built**.
- [coach-automations.md:5](./coach-automations.md) — "sections 3.3, 5.7 and the
  phase 3 plan are still design." Both are built:
  `coachThresholdMetrics.ts` + `threshold_firing` for 3.3,
  `planTranscriptContext` + `coach_summary`/`coach_summary_through` for 5.7.

### 7.2 Stale line-number cross-references

Every anchor below points at an unrelated line today.

| Doc says | Actually |
|---|---|
| `main.ts:825` (before-quit) | `before-quit` at [main.ts:879](../electron/main.ts#L879) |
| `main.ts:819` (macOS keeps going) | `window-all-closed` at [main.ts:873](../electron/main.ts#L873) |
| `main.ts:854` (ticker cleared) | `stopCoachAutomationScheduler()` at [main.ts:882](../electron/main.ts#L882) |
| `main.ts:1301` ("alongside the `chat:*` handlers") | coach handlers at [main.ts:1486–1613](../electron/main.ts#L1486); 1301 is `youtube:listHistory` |
| `database.ts:536` (`ensureColumn`) | [database.ts:656](../electron/database.ts#L656) |
| `chatHistoryStore.ts:985` (`saveChatSession`) | [chatHistoryStore.ts:1057](../electron/chatHistoryStore.ts#L1057) |
| `chatHistoryStore.ts:963` (`createChatSession`) | [chatHistoryStore.ts:1009](../electron/chatHistoryStore.ts#L1009) |
| `chatHistoryStore.ts:748` (`parseEntry`/`parseMessageEntry`) | :779 and :752 |
| `chatHistoryStore.ts:1006` (unchanged-transcript skip) | [chatHistoryStore.ts:1082](../electron/chatHistoryStore.ts#L1082) |
| `coachAutomationStore.ts:463` (`updateCoachAutomation`) | [coachAutomationStore.ts:508](../electron/coachAutomationStore.ts#L508) |
| `chatService.ts:835 / 843 / 850` (`streamChat`, null-guard, abort-on-close) | `streamChat` :1184; the guard and the abort live in `createWindowSink` :884–898 |
| `chatService.ts:1356` (`getClaudeCodeTools`) | [chatService.ts:1812](../electron/chatService.ts#L1812) |
| `chatInteractionTools.ts:18` (`request_coach_input`) | tool name at :9, definition at :23, the no-athlete string at :130 |
| `ChatView.tsx:1848` (`persistHistory`) and `:2109` | both land on unrelated lines |
| `types.ts:2330` (`PersistedChatMessageEntry`) | the `automation` field at [types.ts:2356](../electron/types.ts#L2356) |

Correct as written: `database.ts:147`, `trainingHubService.ts:864`,
`chatCoachContext.ts:18`, `chatWorkoutTools.ts:789`.

### 7.3 Section 8's table is six channels and one push short

`getPause`, `resume`, `getSpend`, `setBudget`, `sessionAttention`,
`markSessionSeen` and the `pauseUpdate` push are all built, wired through
preload, and called from the renderer — and none of them is in §8. Sections 9.3,
10 and 13 describe the *behaviour*, but §8 is the doc's only IPC inventory.

`scripts/test-ipc-surface.mjs` carries the same stale list as a hard-coded
`SECTION_8_CHANNELS` array, so the suite agrees with the doc rather than with
the code.

Also in §8: the push channel is listed as `coachAutomation:onRunUpdate`. The
channel is `coachAutomation:runUpdate`; `onCoachAutomationRunUpdate` is the
preload method name.

### 7.4 `coachAutomation:markSeen` has no caller

§8 lists it as "Clear the unread badge". Nothing in `src/` calls
`markCoachAutomationRunsSeen` — `ChatView` clears marks through
`markCoachAutomationSessionSeen` (§9.3's "reading it means opening it"). The
channel, its preload method and its `CorosLinkApi` declaration are all live;
only the caller is missing.

### 7.5 Section 4's manual-bypass list omits guard rail 1

§4 says "A manual run bypasses 4b, 5, 5b, 6, 7 and 8". The code also bypasses
guard 1 — [coachAutomationService.ts:1351](../electron/coachAutomationService.ts#L1351)
gates the disabled check on `!event.bypassGuards`, and
[:788](../electron/coachAutomationService.ts#L788) / [:795](../electron/coachAutomationService.ts#L795)
let a disabled automation and disabled bindings into the fan-out for a manual
trigger. That is what §3.4's "run this one now even though it is paused" needs,
so §4's list is the half that is stale, not the behaviour.

### 7.6 Guard rail 7 raises the global budget pause

`checkRateGuards` returns `"budget"` for **two** different refusals — the
monthly ceiling (4b, [:934](../electron/coachAutomationService.ts#L934)) and the
binding's `maxRunsPerDay` (7, [:970](../electron/coachAutomationService.ts#L970)) —
and `runOneBinding` raises the app-wide pause on either
([:1422](../electron/coachAutomationService.ts#L1422)), then
`runAutomationTrigger` stops the rest of the fan-out on either
([:1862](../electron/coachAutomationService.ts#L1862)).

§13 says only the ceiling raises the pause; §4 lists 7 as an ordinary
per-binding skip. Built behaviour: a binding exhausting its three runs for the
day pauses every automation the athlete has until the next trigger re-reads
`overBudget()` and clears it. Not fixing here — recording that §4/§13 and the
code disagree.

### 7.7 Section 1's SQL block is not the schema

Six columns are shown inside `CREATE TABLE` that the code adds by
`ensureColumn` (`last_activity_at`, `backoff_until`, `backoff_level`,
`threshold_firing` on bindings; `input_tokens`, `output_tokens` on runs), and
`idx_automation_runs_started` — built at
[database.ts:449](../electron/database.ts#L449) and explained in §13 — is
missing from the block entirely. §1's opening sentence says additive columns go
through `ensureColumn`, so the block contradicts its own preamble.

### 7.8 Section 5.2's `StreamChatOptions` is a version behind

The doc's snippet types `toolPolicy?: "interactive" | "read-only"`. The code
uses `ChatToolPolicy` — three values, the third added for 5.7's summariser
([types.ts:2590](../electron/types.ts#L2590), §6). The doc's own §6 is right;
only 5.2's block is stale.

Same block: `createCollectorSink()` is described as taking nothing. It takes an
optional `ChatEntryAutomationMarker`
([chatService.ts:941](../electron/chatService.ts#L941)), which is how a
collected entry gets its attribution.

### 7.9 Section 11 claims a habit the suite does not keep

"**The regex that counted call sites was the one worth deleting first.**" A
call-site-counting regex is still in `test-coach-automation-bindings.mjs`:

```js
assert.equal((runPanel.match(/setStartingId\(/g) ?? []).length, 2, …)
```

The one §11 is describing (`onCoachAutomationRunUpdate` × 3) is genuinely gone —
its two behavioural replacements are in the renderer suite — but the claim as
written is broader than what happened.

Related: §11 summarises what is left in the bindings suite as "the preload/main
pair, the attach screen's dedicated-binding flow, the preset's recommended mode,
the signed-out banner". The block also still greps `ChatSessionRow.tsx` class
names, `ChatView.tsx`'s `markSessionRead` and `attention` props, the Stop wiring
across three components, `ConversationCoaches`'s mutation wrapper and its
in-flight query, and the run-log row's `onOpenConversation` — none of which is
"source about source".

### 7.10 Section 11's table is two suites short

`test:chat-stream-sink` (5.2's seam) and `test:ipc-surface` (§8's contract, and
the only thing asserting main and preload agree at all) are both in
`package.json` and both about this feature. Neither is in §11's table.

### 7.11 Small stale comments in `types.ts`

Not the doc, but they are the doc's shapes and they disagree with §4 and §5.5:

- [types.ts:2818](../electron/types.ts#L2818) — `skipReason` is documented as
  "cooldown | quiet-hours | no-auth | offline | budget | stale-slot". §4's table
  and the code also produce `disabled`, `missing-session`, `no-activity`,
  `two-factor-required`, `backoff` and `burst`.
- [types.ts:2810](../electron/types.ts#L2810) — `summary` is "One-line TLDR for
  the badge/notification". §5.5 records the `TLDR:` label as a mistake that was
  removed, and notifications are Phase 4, explicitly out of scope.

### 7.12 Section 5.5 promises a phase-3 notification

"The opening line … becomes the `summary` column → run-log row and (phase 3)
notification body." No native notification exists anywhere in `electron/`, and
§12's Phase 4 puts notifications out of scope. The parenthesis is stale.

---

## 8. What the doc gets right

Worth stating, because it bounds where reviewing against the doc is safe:

- All four presets in [coachAutomationPresets.ts](../electron/coachAutomationPresets.ts)
  match §9.1's table exactly — trigger, binding mode and effort.
- Guard-rail **order** in `checkRateGuards` matches §4's table (budget →
  backoff → quiet-hours → cooldown → daily cap → burst), as does the earlier
  1 → 2 → 2b → 3 → 4 sequence in `runOneBinding`.
- Every constant in §5 above matches the value the doc states.
- The three-value `threshold_firing`, its seed-and-be-silent first tick, the
  write-before-run ordering and the trigger-edit reset are all as §3.3 describes
  ([coachAutomationScheduler.ts:303](../electron/coachAutomationScheduler.ts#L303),
  [coachAutomationStore.ts:579](../electron/coachAutomationStore.ts#L579)).
- 5.7's elastic window is 60/20, measured from `through`, with an invalid
  `through` abandoning the summary — exactly as written.
