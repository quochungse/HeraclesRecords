# Persistence and lifecycle — what survives an upgrade, and what survives a crash

> **Superseded in part — read [coach-analysis.md](./coach-analysis.md) first.**
>
> Two reworks have happened since this was written (both 2026-09-10): the
> trigger moved off the definition onto an attachment, and then the attachment
> was removed — an analysis is now one thing living in one conversation, and
> the tables described here are dropped on upgrade. This file is kept as the
> record of the design it reviewed: every column reading it pins is still true, and three columns were added to the attachment (`trigger_json`, `conditions_json`, `device_only`) that it does not cover.
>
> Vocabulary here is pre-rename throughout — *automation* is an analysis,
> a *binding* no longer exists, `coachAutomation:*` channels are `analysis:*`,
> and `coachAutomationService.ts` is `coachAnalysisService.ts`. The tables were
> renamed and their rows dropped; the `app_settings` keys and the stored
> transcript-marker keys did **not** change.

R4 of [coach-automations-review.md](./coach-automations-review.md), both steps.
Section 1's columns and section 10's *"app quits mid-run"* row.

Two questions, and they turn out to be the same one asked twice: **what does a
value mean when nobody wrote it on purpose.** A column from before a migration
and a row left by a process that died are both state nothing chose.

---

## Part one — every column, from every prior version

### 1. What arrived when

Nine columns through `ensureColumn`, plus a table and four settings keys. Every
one of them is NULL, absent, or empty on a database that predates it.

| Added to | Column | Phase | NULL means |
|---|---|---|---|
| `chat_sessions` | `coach_summary` | 3 | no summary; send the transcript |
| `chat_sessions` | `coach_summary_through` | 3 | the same — the pair is one fact |
| `training_activities` | `coach_seen_at` | 1 | the watcher has not looked at this row |
| `coach_automation_bindings` | `last_activity_at` | 1 | never analysed; the attach time is the floor |
| `coach_automation_bindings` | `backoff_until` | 3 | not held off |
| `coach_automation_bindings` | `backoff_level` | 3 | healthy |
| `coach_automation_bindings` | `threshold_firing` | 3 | **never evaluated** — the value that matters most |
| `coach_automation_runs` | `input_tokens` | 3 | the provider reported nothing, which is not "free" |
| `coach_automation_runs` | `output_tokens` | 3 | the same |
| — | `coach_daily_samples` (table) | 3 | absent → created empty; metrics answer *no* until the watcher fills it |
| `app_settings` | `coachAutomation.pause` | 3 | not paused |
| `app_settings` | `coachAutomation.monthlyTokenBudget` | 3 | no ceiling, which is the default |
| `app_settings` | `coachAutomation.activityWatcherInitializedAt` | 1 | cold start: stamp the back catalogue and say nothing |
| `app_settings` | `coachAutomation.dailySamplesCapturedAt` | 3 | snapshot due |

Every NULL reading was already correct, and most were already asserted. The
half nothing had asked was the other one.

### 2. A value that is present and means nothing

Section 10 settled the rule when it made a half-written pause read as *not
paused*: *"trusting a shape nobody checked would hold every automation forever
on the strength of a string in a settings table."* The pause and the budget were
built to it. Five readers were not.

| Reader | Was | Now | Why that direction |
|---|---|---|---|
| `last_activity_at` | any finite number | `> 0`, else **never analysed** | a zero put the floor at the epoch, so the binding replayed the athlete's whole history up to the 200-row scan cap — the one thing 3.2's attach floor exists to prevent |
| `threshold_firing` | anything non-NULL → `false` | exactly `0` or `1`, else **never evaluated** | reading `2` as `false` claims the condition *was* evaluated and did not hold, so the next tick sees a transition and announces something that may have been true all week |
| `input_tokens` / `output_tokens` | any finite number | `>= 0`, else **unreported** | a negative subtracts from the month's `SUM`, and a budget reading *under* the truth is what 13 calls worse than no budget: a number the athlete trusts |
| `sessionId` on a `per-run` binding | whatever the row held | **null**, always | the mode owns no conversation (2.1) and every reader already branches on the mode before it looks — so the row and the behaviour disagreed, silently |
| `resting_hr` | any finite number | `> 0`, else not a reading | it feeds a *baseline*, so one zero drags the average down and turns an ordinary morning into three days of drift. `isSleepDebt`, in the same file, already wanted `> 0` from its nights |

Zero stays a real answer for the token columns and only for those: a cancelled
run that never reached the model genuinely cost nothing, and that is a different
fact from nobody counting.

### 3. Values that were already safe

One line each, so the next reviewer does not redo them.

| Value | Why it is fine |
|---|---|
| `backoff_until` = garbage text | `Date.parse` → NaN → `now < NaN` is false → not held off. A binding frozen by a string somebody typed is the failure; trying once too often is not |
| `backoff_level` ≤ 0 | already read as no level |
| `last_run_at` = garbage | `NaN < cooldownMs` is false → the cooldown reads as elapsed |
| `next_run_at` = garbage | `parseSlot` → null → "no slot booked" → the tick books one |
| `enabled` = 2 | `=== 1` → reads as **off**, which is the safe direction for a switch |
| `mode` = unknown | falls back to `existing`; with no session it disables itself on the next run |
| `status` = unknown | falls back to `failed`; it counts against the daily cap and against nothing else |
| `coach_seen_at` = garbage | only ever tested for NULL-ness → reads as seen, and since [L3](./coach-automations-lifecycle.md#l3) the tick asks again anyway |
| `coach_summary` with no count | fixed in R2 as [C2](./coach-automations-conversations.md#c2) — reads as no summary |
| a count with no summary | reads as no summary; costs a full transcript once, loses nothing |
| `coach_daily_samples` absent | `CREATE TABLE IF NOT EXISTS` makes it empty; every metric returns false on no readings, and 3.3 says a rule created later finds it empty for one tick |

### 4. Contradictory combinations

| Combination | Reachable? | What happens |
|---|---|---|
| `per-run` + a `session_id` | hand edit only — the attach path refuses it | **fixed**: reads as null. It also used to dodge `idx_binding_unique_per_run`, whose partial index is `WHERE session_id IS NULL`, so a second `per-run` binding could exist for one automation against 2.2's constraint 3 |
| `dedicated` + no `session_id` | hand edit, or a migration | self-heals: the next run creates a conversation and the binding adopts it (2.4) |
| `backoff_until` set, `backoff_level` NULL | hand edit — `applyBackoff` writes both together | the hold holds; the next failure restarts at 5 minutes. Harmless |
| `status = 'running'` with a `finished_at` | a crash between two writes | the next launch's reconciliation flips it to `cancelled` |
| a summary covering more entries than exist | a truncating writer, which there is none of | `planTranscriptContext` abandons the summary — 5.7's *"the one failure that cannot be noticed by reading the answer"* |

**Tests** — `test-coach-automation-sql.mjs`, which is the only suite that opens
a real SQLite file, now writes each corrupt row with raw SQL and reads it back
through the **real store**, because the reading is the thing under test. Plus
one in `test-coach-automation-threshold.mjs` for the resting-HR baseline.
**Mutations:** five, one per reader, all red.

The resting-HR fixture had to be moved before it counted. Its first version put
the streak at 52 against a baseline of 50, where a dragged-down baseline of 48.3
and an honest one both answer *no* — the same trap the trimming suite fell into
once, and it survived its own mutation until the streak moved to 54, which is
between the two.

---

## Part two — crash, quit and restart

### 5. Every point the process can die at

`cancelStaleCoachAutomationRuns()` runs at `app.whenReady()`, before the watcher
and the scheduler start, and turns every `running` row into `cancelled`. That is
the whole of the reconciliation, and it reaches exactly one of these.

| Dies at | Run row | What the next launch does | |
|---|---|---|---|
| **mid-stream** | `running` | **the reconciliation** flips it to `cancelled` | ✅ the one point it covers |
| **mid-roll** | none yet — the roll happens before `recordRun` | nothing to reconcile. The summary, if it committed, covers a prefix that still exists | ✅ see §6 for the one casualty |
| **mid-fan-out, token live** | one `running`, the rest never made | the token is memory and goes with the process. Runs already recorded stand; the steps never reached are still owed | ✅ |
| **mid-snapshot** | none | the stamp is written only after a successful write, so the snapshot is simply due again. The upsert is column-wise, so a half-written one is idempotent | ✅ 3.3's own rule |
| **between the threshold write and its run** | none | the state says announced and nothing was. **Lost** — and deliberately: 3.3 chose one missed announcement over one an hour | ✅ documented |
| **between the slot booking and its run** | none | the slot is advanced and the briefing missed. **Lost**, deliberately: 3.1's book-before-run | ✅ documented |
| **between the stamp and the trigger** | none | see §7 — this one was not covered until R2 | ✅ **now** |
| **between `saveSession` and `finish`** | `running` | the answer is in the conversation, the log says `cancelled`, and 9.3's dot skips it | ⚠️ cosmetic, microseconds |
| **between `createTargetSession` and `recordRun`** | none | an empty `per-run` conversation with no run behind it | ⚠️ cosmetic, microseconds |

### 6. What the reconciliation must not do

The invariant is that it touches the **run log and nothing else**, and that is
load-bearing rather than incidental.

A `cancelled` run taken through the runner's own `finish` **clears the binding's
backoff streak** — section 10's rule is *"anything that reached the provider and
did not fail"*. So routing the reconciliation through the same exit, which is
the obvious tidy-up somebody will eventually propose, would mean **a crash
resets the hold on every binding that was failing**. The app closing is not a
provider reporting itself healthy, any more than the athlete pressing Stop is.

The same goes for the other two clocks: a crash must leave the activity owed and
the cooldown where it was, because nothing about the run reached a conclusion.

Now asserted in `test-coach-automation-bindings.mjs`. **Mutations:** clearing the
streak from the reconciliation; advancing the watermark from it → both red.

The one casualty with nowhere to go is **a roll that spent and whose run never
got a row**. R2's [F1](./coach-automations-refusals.md#f1) attributes a roll's
tokens to the run that asked for it, and the row is created after the roll — so
a process that dies in between leaves spend the budget cannot see. The window is
one synchronous step wide and there is no row to put the number on; recorded
rather than fixed.

### 7. The point the reconciliation cannot reach, and how it got covered

The poll stamps `coach_seen_at` and **then** awaits the runner. A process that
dies in between leaves rows marked seen with no run behind them —
and there is no `running` row to reconcile, because the trigger never got as far
as making one.

Before [L3](./coach-automations-lifecycle.md#l3) that was permanent. The watcher
fired only when something was unseen, so nothing ever came back for those rows,
and with `multiActivity` off — the default — the next activity to arrive
replaced them. R2 found that from the refusal side; it is the same hole from the
crash side, and the same fix closes both.

Its other half went with the batch window. Rows used to be stamped at flush, so
matches still collecting stayed unseen and a crash mid-window re-collected them
— in-memory state that a crash was *supposed* to drop. With the window removed
the poll stamps and fires in the same step and the watcher holds nothing between
ticks, so the gap above is the only one left, and the L3 catch-up is what closes
it.

**Tests** — `test-coach-activity-watcher.mjs`: a trigger that dies on handover
leaves the rows stamped, and the next launch offers the activity anyway.
**Mutations:** removing the re-offer → red.

### 8. Checked and found sound

| Question | Answer |
|---|---|
| Can the reconciliation cancel a *live* run from a second instance? | no — `hasSingleInstanceLock` gates the whole of `whenReady` |
| Does it run before anything can create a `running` row? | yes: line 868, before the watcher and scheduler start at 869–870 |
| Does a crash clear the pause? | no, and it must not — 10: *"a restart must not quietly resume a paused world"* |
| Does a crash during the cold start replay the back catalogue? | no: `markAllSeen()` precedes the stamp, so a crash between them means another cold start, which stamps again |
| Does a crash leave the scheduler's queue wedged? | no — `queueTail` and `liveTriggers` are both memory |
| Does the threshold retry hold survive? | no, and it does not need to: the state it guards is on disk, and a lost hold costs one extra skip row |


---

## 9. Found on the closing review of R4

**One end of a pipe was hardened and the other was not.** §2 made the run row's
*reader* refuse a cost that cannot be counted — but a reader only helps rows
already on disk. The number enters somewhere, and that somewhere had no guard at
all: `recordUsage` in the collector accepted any two values that were
`typeof === "number"`, which includes negative, `NaN` and `Infinity`.

It matters because of who reports it. Three providers are Anthropic's or
OpenAI's; the fourth, `local`, is *whatever OpenAI-compatible server the athlete
pointed the app at*, and 13 already notes that
`stream_options: { include_usage: true }` is a request rather than a promise. A
server that answers it badly writes into the column the month's budget sums.

Worse at the round level than at the turn level: `addUsage` sums each tool
round, so one negative round quietly reduces a total whose *final* value looks
perfectly reasonable — and the collector cannot see it, because by the time a
report reaches `chat:streamDone` the rounds have already been added up.

**Fixed** with one shared rule, `countableUsage`, at both entry points: the
per-round sum inside `streamChat` and the collector's own ingest. Finite,
non-negative, or it is *unreported* — which is 13's third state and the only
honest reading of a number that is neither a cost nor an absence. Zero stays a
cost.

**Tests** — `test-chat-stream-sink.mjs`: five uncountable shapes each read as
unreported, zero still reads as zero, and the rule itself driven directly.
**Mutations:** four, all red — but the first attempt at the round-level one
**survived**, because `addUsage` lives inside `streamChat` and `streamChat`
needs a provider, a database and a network. It is the same blind spot R3 found
around `createDefaultDeps`: the default wiring is the code a test cannot reach.
Covered the same way, with a source assertion labelled as one.

**Also checked and found complete:** the nine `ensureColumn` calls in §1 are
every coach-automation column in the file — the other three (`activity_type`,
`feel_type`, `pinned_at`) belong to features this review does not touch.
