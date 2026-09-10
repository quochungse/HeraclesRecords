# Coach Analysis

Status: **built**. Written 2026-09-10, revised the same day after the
one-analysis-per-conversation rework.

This document is the current shape of the feature. Its predecessor,
[coach-automations.md](./coach-automations.md), and the eight companion files
around it are a **dated record of the original design and its review** — much
of what they say about the run pipeline, the guard rails, the refusal ordering
and the cost model is still true, and each carries a banner naming the sections
that are not. Where they disagree with this file, this one is right.

---

## What it is

An **Analysis** is a coaching question written inside one conversation: a role,
a playbook, and — if the athlete wants one — a trigger that asks it without
being asked.

```
Conversation
    ├── Analysis  (role + playbook + runtime)
    │      └── no trigger  → manual: Run now
    │      └── a trigger   → an auto analysis
    └── Analysis  … up to five
```

One analysis belongs to exactly one conversation and cannot be moved. That is
the whole model, and everything below follows from it.

## How it got here, and why the shape kept narrowing

Two reworks, in the same direction both times.

**Automations (before).** A definition declared a trigger — "every morning at
07:00" — before it had anywhere to speak, and was then *attached* to one or
more conversations. Three attach modes: `per-run` created a conversation on
each run, `dedicated` made one up front, `existing` used one you picked.

**Analyses with attachments (interim).** The trigger moved off the definition
and onto the attachment, so the same analysis could fire on two cadences in two
conversations. The three modes collapsed to one: attach from a conversation you
already have open.

**Analyses (now).** The attachment is gone too. The reuse it existed for was
not something athletes wanted — a coaching question is written *about* a
conversation's history, and a definition shared across two conversations was
one object pretending to be about both. Collapsing it removed a screen, an
entity, eight IPC channels, and every way the two halves could disagree.

What that buys, concretely:

1. **One entry point.** Create Auto Analysis, from the conversation. There is
   no separate place to make one and no attach step.
2. **No global list.** There is no screen showing every analysis, because such
   a list would be a list of unrelated things. Each conversation shows its own.
3. **Nothing creates a conversation.** The runner has no `createSession` path
   at all — the target exists or the run does not happen.
4. **One place to change one analysis.** Its own screen, opened from the row's
   options button, holds the playbook, the trigger and the run log.

### What the athlete does

| Then (automations) | Now |
|---|---|
| Manage automations → New → pick a trigger and guard rails | Open a conversation → **Create Auto Analysis** |
| Attach to a conversation, pick a mode | — the conversation is where you are |
| Manage automations → find it → edit | Its row's **⋯** → its own screen |
| Manage automations → pause / budget | Settings → Analyses |

The detail screen has two tabs, **Settings** and **Run log**. "Where it runs"
is gone: an analysis has one place and cannot be moved, so a tab listing one
unchangeable row said nothing worth opening a tab for.

It carries no **Run now** and no back arrow either. Run now sits on the
analysis's row in the conversation, one click from where its answer will
appear; a second copy behind a modal only made it possible to start the same
run twice. And the modal holds a single screen, so back and close were always
the same move — the X is the one that stayed. **Stop** remains on the detail
screen, offered only while a run it is showing is in flight.

## The model

### Tables

Named for what they are. Their predecessors — `coach_automations`,
`coach_automation_bindings`, `coach_automation_local_triggers`,
`coach_automation_runs` — are **dropped** by `dropLegacyAutomationTables`, and
so is everything in them. See Migration below for why nothing is carried over.

| Table | Tier | Holds |
|---|---|---|
| `coach_analyses` | `personal` | the analysis: what it says, where, when, and its clocks |
| `coach_analysis_local_triggers` | **`device`** | the trigger of an analysis marked "this device only" |
| `coach_analysis_runs` | `derived` | the run log |
| `coach_daily_samples` | `derived` | 3.3's resting-HR and sleep cache |

`coach_analyses` was created rather than grown, so every column it has is in
the `CREATE TABLE` block — there is nothing here for `ensureColumn` to add and
no fresh-vs-migrated difference to reason about.

Two names in stored data *do* keep their pre-rename spelling, and both are
outside these tables:

- The `app_settings` keys `coachAutomation.pause` and
  `coachAutomation.monthlyTokenBudget`. They are `preference` tier and already
  sitting in other machines' vaults under those names.
- The `automation` key on a transcript entry, and `automationId` inside it.
  Every entry an athlete already has spells it that way, and renaming it would
  cost historical runs their attribution — the chip would render nameless.
  `bindingId` is still *read* for the same reason and is no longer written.

### Types (`electron/types.ts`)

```ts
interface CoachAnalysis {
  id,
  sessionId: string,                    // one conversation, never null, never changed
  name, role?, playbook, enabled, presetId?, runtime,
  trigger: AnalysisTrigger | null,      // null = manual
  conditions: AnalysisConditions,       // cooldown, daily cap, quiet hours
  deviceOnly: boolean,
  sortOrder,                            // run order within the conversation
  lastRunAt?, nextRunAt?, lastActivityAt?,
  backoffUntil?, backoffLevel?, thresholdFiring?,
  createdAt, updatedAt
}
```

`AnalysisTrigger` is unchanged — the same four kinds (`schedule`, `activity`,
`threshold`, `manual`) with the same fields and the same normalizers.

`CoachAnalysisPatch` is `Partial<Omit<CoachAnalysisInput, "sessionId">>`:
everything is editable except which conversation it belongs to. A move would
be a new analysis with a new run history, and pretending otherwise would leave
the log naming a conversation the runs never touched.

---

## "This device only"

The requirement: an analysis should sync, but its trigger should optionally
stay on one machine.

**It is a separate table, not a column filtered on the way out**, and that is
forced rather than chosen. `syncPolicy.ts` classifies whole tables; the oplog
carries whole rows (`SELECT *`); a merge is an `INSERT OR REPLACE`. A column
withheld from a payload therefore arrives on the other machine as NULL — as
*deleted*, not as *unchanged*. There is no honest way to hold back half a row,
so the half that must not travel lives somewhere that cannot travel at all.

What each side sees:

| | This machine | Any other machine |
|---|---|---|
| The analysis | present | present |
| `deviceOnly` | `true` | `true` |
| The trigger | the schedule the athlete set | `null` — it reads as manual |
| Runs on a timer | yes | no |

`readTrigger` in the store is the one place that resolves this, so no caller —
scheduler, watcher, runner, UI — has to know which side of the fence a trigger
is on. `writeTrigger` is its mirror, and clearing the other side is its whole
job:

- **Turning it on withdraws the published trigger.** The row's `trigger_json`
  is cleared in the same write. Without that, the other machine would keep
  firing a schedule this one just took private.
- **Turning it off deletes the local copy.** Without that, the local row would
  shadow the shared one for ever.

And dropping the trigger drops the flag: "this device only" is a statement
about a trigger, and a flag remembered against nothing reads as a promise the
next trigger never made.

A device-only trigger is still a trigger *here* — the scheduler's tick sees
it, or the option would mean "on no device at all".

---

## Migration: there isn't one

`dropLegacyAutomationTables` in `database.ts` drops all four predecessor
tables on the upgrade. **Nothing is carried over, deliberately.**

The shape did not narrow, it changed. An automation was a definition that
could be attached to several conversations, each attachment carrying a
trigger; an analysis lives in exactly one conversation and carries its own.
There is no honest mapping between them:

- An automation attached **nowhere** has no conversation to become an analysis
  in.
- One attached **three times** would become three analyses the athlete never
  wrote, each inheriting a schedule they set once.

Guessing either way produces coaching that speaks without being asked, which
is the one failure this feature cannot afford.

What is *not* dropped is everything an athlete would miss. Their conversations
are `chat_sessions` rows and are untouched, **including every answer an
automation ever wrote into one** — those are transcript entries, and they keep
their attribution chip. What goes is the machinery: the definitions, the
attachments, and the log of runs against them.

No tombstones. Each machine drops these for itself on the upgrade, and a row
republished by a machine still on the old build lands in a table that no
longer exists — `syncPolicy` no longer classifies those names, so the merge
path skips it rather than recreating anything.

`npm run test:analysis-legacy-drop` drives this against a hand-written copy of
the old schema, and asserts the conversation and its chip survive.

---

## IPC

Channels are `analysis:*`, and the three-file invariant is unchanged — a name
is a bare string in `main.ts`, `preload.ts` and `src/coroslink-api.ts`, and
`npm run test:ipc-surface` scrapes all three. That suite also fails on any
bridge method still spelling `Automation` or `Attach`, so neither rename can
half-happen.

| Channel | Notes |
|---|---|
| `analysis:listForSession` | one conversation's analyses, each with its last run |
| `analysis:get` | one analysis |
| `analysis:create` | answers a result, not a throw: the refusals are UI copy |
| `analysis:update` | everything but the conversation |
| `analysis:setEnabled` / `:delete` / `:reorder` | |
| `analysis:runNow` / `:listRuns` / `:cancelRun` / `:markSeen` | |
| `analysis:getPause` / `:resume` / `:getSpend` / `:setBudget` | section 10 and 13 |
| `analysis:sessionAttention` / `:markSessionSeen` | 9.3's marks |
| *pushes:* `analysis:runUpdate`, `analysis:changed`, `analysis:pauseUpdate` | |

There is deliberately **no channel listing every analysis**. The eight the
attach model needed (`analysis:list`, `:attach`, `:detach`,
`:listAttachments`, `:updateAttachment`, `:setAttachmentEnabled`,
`:reorderAttachments`, `:save`) are gone, and the IPC suite fails if one comes
back.

The push is `analysis:changed`, not `analysis:update`, because the latter is
an invoke handler — a channel cannot be both, and the suite says so.

---

## What the scheduler and the watcher ask for

`listTriggeredCoachAnalyses()`: every enabled analysis carrying a real
trigger, in one read. The trigger is a column on the row, so there is nothing
to join and nothing to look up per analysis.

A trigger names **one** analysis and expands to at most one queued run, before
the activity expansion turns it into a catch-up sequence. `expandTriggerToQueue`
still checks the trigger *kind* against the event: the tick reads every
analysis in one pass rather than one query per kind, so a schedule tick must
not run an analysis whose trigger is an activity filter. A manual run is
exempt — "run this one now" is the athlete asking, and a manual analysis has
no trigger to match.

Serialisation (5.4) is process-wide and always was; it used to fall out of the
fan-out walking its attachments in order, and now it is only the queue every
trigger goes through.

### One behaviour genuinely changed

With `per-run` gone, a long activity catch-up meets the burst guard. That
guard counts five runs per conversation per hour; a `per-run` attachment wrote
into a new conversation each time and so never met it, while every analysis
now lives in one. So a twelve-deep backlog plans ten runs
(`MULTI_ACTIVITY_MAX_PER_TRIGGER`) and completes five, and the watermark stops
with them — the rest is still owed and rides along with the next trigger. That
is the guard doing its job rather than a regression, but it is a real change
in what an athlete sees after a week away.

---

## Renderer

`src/chat/analyses/`.

| File | What it is |
|---|---|
| `ConversationAnalyses.tsx` | the conversation's analyses, and the only entry point: **Create Auto Analysis**, plus a **⋯** per row into its own screen |
| `AnalysesModal.tsx` | the full-screen host for one analysis — the create form, or one detail screen. Its header shows the open screen's title (`analysesTitle.tsx`) and one way out |
| `AnalysisCreate.tsx` | writing one, inside the conversation. Preset gallery, definition and trigger on one screen |
| `AnalysisDefinitionForm.tsx` | name, role, playbook, model, effort |
| `TriggerForm.tsx` | the trigger, the guard rails, and "this device only" |
| `AnalysisDetail.tsx` | Settings / Run log. No "Where it runs", no Run now, no back arrow |
| `DeleteAnalysisDialog.tsx` | confirms, and says what is *not* lost |
| `ChatSettingsPanel.tsx` (in `src/chat/`) | the two feature-wide controls: the pause, and the monthly ceiling |

Deleted with the attach model: `AnalysesPanel.tsx` (the global list),
`AttachAnalysisDialog.tsx`, `EditTriggerDialog.tsx`, `RunNowDialog.tsx` (a
picker for a question with one answer).

**The pause and the budget moved to Settings.** They are feature-wide
preferences with no conversation to belong to, and the screen that used to
host them is gone; without a home, a paused world would have no Resume button.

---

## Tests

| Suite | Covers |
|---|---|
| `test:analysis-legacy-drop` | opening a database written by the Automation build: the tables go, the conversations and their chips do not. **Its own process** — `initializeDatabase` returns the process's existing database, so a drop test sharing a process with another database test silently tests nothing |
| `test:coach-analysis-store` | the fields, the normalizers, the run log, the preset gallery |
| `test:coach-analysis-lifecycle` | the per-conversation cap, the trigger's two homes, run order, the clocks, a deleted conversation, the tick's read |
| `test:coach-analysis-sql` | the real columns and the device-only table |
| `test:coach-analysis-schedule` / `-threshold` / `test:coach-activity-watcher` | the tick, per analysis |
| `test:coach-analysis-runner` | expansion, the guard rails, the run pipeline |
| `test:coach-analysis-renderer` | the popover's entry points, the detail screen's pushes, Settings' pause and budget — all mounted |
| `test:ipc-surface` | the three-file contract, the retired channels, and no `Automation`/`Attach` left on the bridge |
| `test:sync-policy` | every table classified, including the device-only one |
