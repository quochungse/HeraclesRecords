# Training Library architecture

Two entities, two tabs. **Workouts** are reusable sessions you own; **Plans**
are multi-week schedules of them. They share four attributes — name, tags,
favourite, archived — and not one figure, which is why they are two tabs
rather than one list with a facet.

**Both live on COROS.** A workout is a COROS program and a plan is a COROS
plan; this app is where the athlete presses the buttons, and the account is
where the data is. The one thing kept here that COROS has no place for is a
plan **draft** — an edit in progress — plus the app's own metadata (tags,
favourite, archived, where a plan came from). The spec this was rebuilt to is
[training-plan-coros-first.md](training-plan-coros-first.md); the endpoints are
in [coros-plan-write-api.md](coros-plan-write-api.md).

It extends the existing workout codecs and Training Hub service rather than
creating a second workout protocol. React never calls COROS: it requests one
`TrainingLibrarySnapshot`.

## What this screen deliberately does not have

Each of these existed and was removed. Reintroducing one is a decision, not a
merge.

- **Local plans.** A plan used to be a row in `training_plans` with a `source`
  of `coros`, `local` or `coach`, and a COROS plan was edited by forking it into
  a "Local Copy". There is one kind of plan now, the COROS one.
  `dropLocalTrainingPlans` drops `training_plans` and
  `training_plan_workout_links` on open, carrying a COROS plan's tags,
  favourite and archived flag into `training_plan_metadata` first. Local and
  coach rows are dropped outright — the sessions they had put on the calendar
  are ordinary COROS workouts and stay where they are; the migration calls
  nothing on COROS.
- **Rest days, notes, a holding area, phases, a goal, a difficulty.** COROS
  stores none of them. `eventTags` sent with `plan/add` or `plan/update` are
  answered `0000` and dropped, a stage is one of seven enum values rather than a
  named span, and a session has a day or it is not in the plan. A rest day is an
  empty day; a note belongs in the description.
- **Calendar installs.** Putting a plan on the calendar was the app writing
  each session as a workout of its own and keeping the bookkeeping
  (`calendarInstalls`, `writeMayHaveSucceeded`, a partial state) on the plan.
  COROS has a first-class way to do this — a running copy of the plan — and
  keeps it in step with the calendar in both directions.
- **Collections.** COROS serves four training endpoints — program, plan,
  schedule and exercise — and not one of them knows about a collection.
  `dropRetiredCollectionTable` drops the table and the
  `training_workout_metadata.collection_id` column on open.
- **Templates, Adherence and All tabs.** A template is a plan not on the
  calendar; adherence is a fact about a plan (`planCompliance.ts`, one figure on
  the row and an outcome per session in the reader); a workout and a plan do not
  belong in one list.
- **Search in the masthead.** It is a filter; it sits with the filters.

## Model and ownership

- `TrainingLibraryWorkout` decorates a COROS library summary with local
  favourites, tags and cache metadata. Full reads and edits use the lossless
  workout editor document and revision check.
- `TrainingPlanDocument` is a COROS plan as the renderer reads it, and a draft
  is the same shape, so saving a draft loses nothing. `id` is `coros:<remoteId>`
  or `draft:<uuid>`; `remoteVersion` is COROS's `version`, compared before every
  write. A session (`TrainingPlanEntry`) has a week, a day (0 = Monday), an order
  and a typed `PlanWorkoutEntryInput`; one read from COROS also carries
  `corosProgram` — the raw program, written back untouched unless the session is
  edited — and its `idInPlan`. `weekStages` are COROS's seven stages. `calendar`
  is `unscheduled` (a plan), `running`, `finished` or `stopped` (COROS's running
  copy of one — a stopped run was taken off the calendar and is not listed); a
  running copy has `startDate` (the Monday COROS counts from) and
  `sourcePlanId`, and a plan with a copy running has `runningInstanceId`.
- `training_plan_metadata` (`personal`) holds tags, favourite, archived and
  `origin` (`user` | `coach`) per `coros:` id. `training_plan_drafts`
  (`personal`, so a draft follows the athlete between machines) holds
  `TrainingPlanDraftRecord`s: the plan, and for an edit of an existing plan the
  `baseRemoteId` and `baseVersion` it started from. `coros_plan_cache`
  (`device`) is a read cache of documents — the screen paints from it and falls
  back to it offline; every write reads `detail` again first.
- `TrainingActivityMatch` links a calendar session to a completed activity by
  `schedulePlanId:scheduleIdInPlan`. A running copy's sessions carry exactly that
  pair — the copy's id and the session's `idInPlan` — so compliance joins on it
  directly, and a template reads its figures off its running copy.

The screen re-reads on a `sync:changed` naming `training_plan_metadata`,
`training_plan_drafts` or `training_workout_metadata` — selective on
`change.tables`, because a pull carrying a sleep night must not cost a COROS
round trip.

## The renderer's arithmetic lives outside the components

Pure modules, for the reason `activityFilters.ts` sits outside
`ActivitiesView`: a 1000-line view is the one place a test cannot reach.

| Module | Owns | The rule worth knowing |
|---|---|---|
| `planFilters.ts` | chips, filter, lifecycle, start label, empty states | A running copy whose plan is in the list folds into that plan's row, or one plan is listed twice. |
| `planCompliance.ts` | the plan↔activity join | `undefined`, never 0%, for a plan not on the calendar, and `ratio: undefined` while nothing has settled. 0% is the one number read as failure. |
| `planReaderModel.ts` | weeks, days, stages, per-session facts and status | A session with no match has **no status**. |
| `planEditorModel.ts` | what an edit does to a plan | A session lands at the bottom of its day; deleting a week moves the stages after it; a copy claims neither the original's `idInPlan` nor its day on the calendar. |
| `planDraft.ts` | the editor's undo stack | The baseline survives trimming, and a fresh `updatedAt` is not a change. A draft resumes only for the same plan at the same stored version. |

`planEntryMetrics` (exported from `trainingPlanDomain.ts`) is the one
implementation of what a session amounts to: the steps' own figures, falling
back **per figure** to the entry's `planned*` fields.

## Reading a plan is not editing it

`PlanReader` opens from the snapshot already in hand and asks COROS for
nothing. The plan is then read in full in the background through
`/training/plan/detail` — the list leaves out each session's program, which a
save writes back — and **that failure is silent**: it only ever refines what is
already readable. Edit and Duplicate wait for it, and Edit waits for a
duplicate being made too, because the reader moves to the copy when it lands.

`PlanEntryRow` is why a plan item is not a workout tile: week, day, the real
date on a running copy, the target it states, the steps behind it, its outcome.

## The builder holds its draft outside itself

The draft lives in `TrainingLibraryView` and the editor draws what it is
handed, so leaving the tab does not throw the work away. Keystrokes into one
text field fold into one undo state until the field is left
(`commitDraft(draft, next, field)`, `sealDraft`).

## The editor is the reader with handles on it

- **The reader's picture.** Serif title (a bordered input), description, the
  reader's figures and `PlanWeekRidge`, every week as a `.plan-week-card` with
  seven day columns and COROS's stage picked per week. `readPlan(plan, [])`
  supplies the weeks, days and figures, so a session reads the same in both
  screens. Its day grid is `.plan-editor-days`; it does not borrow
  `.plan-reader-days`.
- **A day's `+` is a menu**: New session → Create workout's builder
  (`WorkoutBuilderModal`), headed "New session" over the plan's name, week and day;
  From workout library → a picker that reads the workout's program from COROS
  (`libraryWorkoutAsPlanSession`), because a COROS plan holds its own copy of
  every program rather than a link to the library.
- **One control per session.** The ⋯ holds Edit, Move to…, Duplicate, Copy to
  next week and Delete. Alt + arrows move by a day or a week, Delete deletes,
  and focus follows a moved session. **Shortcuts listen on the window**, gated
  on `layer`: an undo remounts the session it moves back and focus falls to
  `<body>`.
- **A draft sits where its plan does** (`attachPlanDrafts` in `planFilters.ts`).
  A new plan's draft is a tile among the plans marked Draft, and opens the
  editor, where Discard draft lets it go. Edits kept for a plan mark its tile
  Editing; the reader shows Continue editing (filled) outside the ⋯, Edit leaves
  the ⋯ while it is there, and the ⋯ leads with Clear editing. One draft per
  plan, one way into the editor: Save draft replaces the draft held. A
  draft whose plan is gone from the list stands as a tile of its own.
- **Save goes to COROS; Save draft keeps it here.** A plan changed on COROS
  since the edit began (`version` ≠ the version the edit started from) is a
  conflict, answered with Replace with my edit / Save as a new plan / Keep
  editing. A plan deleted on COROS meanwhile is saved as a new one. The plan is
  read back after the write and the draft is let go only if it read back whole.
  Editing a running copy changes the calendar at once, and the editor says so.
- **Problems sit under the bar**, and Save names them in its title. More than
  ten sessions on a day is an error (COROS's limit); trailing empty weeks are a
  warning, because COROS counts a plan's length from its last session.

`npm run test:plan-editor-model` holds the arithmetic;
`npm run test:plan-editor-renderer` mounts the editor in its backdrop at
1180px and fails on a 0px session name, the unstyled portal, a hidden reason,
a session added anywhere but its day, focus left behind by a move, and undo
going deaf once focus is lost. **A rule that styles a library control must name
all three scopes** — `.training-library-view`, `.tl-plan-modal-backdrop` (the
editor is portalled to `<body>`) and `.tl-dialog-backdrop` (so is the builder,
and the question it asks through the plan's `ConfirmDialog`).

## The calendar is COROS's running copy

"Add to calendar" is `executeSubPlan`, which makes a running copy of the plan.
Two things COROS does without a word, which the dialog
(`TrainingPlanCalendarDialog`) says before anything is written:

- **It counts the plan's days from the Monday of the week the start day falls
  in, and leaves off every session before the start.** A Wednesday start loses
  week 1's Monday and Tuesday. The month picker opens on the next Monday and the
  preview (`previewPlanOnCalendar`) is read again on every pick, listing the
  sessions left off.
- **It never checks the calendar.** A day that already holds a workout gets the
  plan's too; the preview names what is already there.

The preview refuses a past start, a second run of a plan already running, a
run of a running copy, a plan with no sessions and a start that keeps none. It
answers "already running" from the cache, since it is read on every day
picked; `executeNativeCorosPlan` asks COROS again just before the write.
"Remove from calendar" is `quitSubPlan` on the running copy, asked of either
side; it takes off the plan's sessions and nothing else. Saving a plan that has
a copy running asks whether the calendar follows (Save plan only / Save &
update calendar). Updating writes the plan's sessions from today on onto the
copy with `plan/update` (`planOntoRunningCopy`) — not `plan/sync`, which leaves
a moved session on its old day — so a change made on the calendar from today on
is lost, and the question says so.

## Dialogs

`window.prompt` **is not implemented in Electron** and `window.confirm` blocks
on a native OS box; `PromptDialog` and `ConfirmDialog` replace them. **Cancel
takes focus, not confirm.** `ConfirmDialog` takes an optional third answer
(`alternative`), which is how the save conflict offers "Save as a new plan".
Both catch Escape in the **capture** phase and stop `mousedown` inside the
panel. A dialog over the portalled editor is portalled to `<body>` too, or the
view's stacking context holds it underneath.

## Coach plans

A plan the coach writes stays in the conversation until it is saved: it is a
chat plan draft (`chat_plan_drafts`), not a library draft, and the Plans screen
does not list it. The card's **Training Plan** destination saves it to COROS as
one plan (`origin: "coach"`), its description as the overview and its week
stages as COROS's. **Edit plan first** opens the plan editor over the
conversation (`CoachPlanEditor`) and saves back into the coach's own draft — the
same card, marked `editedAt` — and leaves a `planEvent` where it happened, which
the coach is told on the athlete's next message; each turn also lists the
conversation's creations (`creationIndex`), and the coach reads one back with
`get_plan_draft`. A conversation's drafts are deleted with it.

## Verified COROS surface

Every plan write was probed live on 2026-09-24 with temporary data, cleaned up
in `finally`, and the captures are the fixtures in
`scripts/fixtures/coros-plan-write/`: `plan/add`, `update`, `copy`, `delete`,
`schedule/executeSubPlan`, `schedule/quitSubPlan`. (`plan/sync` was probed too
and is documented in [coros-plan-write-api.md](coros-plan-write-api.md); the app
does not use it.)
`npm run verify:coros-plan-api -- --live` repeats the round against the live
account. **There is no collection, folder, group or template endpoint.**

## Safety and fallbacks

- Remote workout deletion, plan deletion and bulk deletion require an explicit
  confirmation flag. A plan on the calendar — or one with a running copy — is
  taken off before it can be deleted.
- Coach tool calls can create a draft but cannot save one. Only the athlete's
  confirmation card invokes the write IPC method.
- Authentication tokens and request headers are never included in plan logs,
  and COROS's raw plan payloads are not stored.

## Tests

| Script | Covers |
|---|---|
| `test:coros-plan-writes` | The write bodies (`totalDay`, `versionObjects`, the Monday anchor), each endpoint through the app's request path, and the library's saves, calendar and Coach flows against a fake COROS that keeps what it is sent. |
| `test:training-library` | Parsing, drafts, metadata, pairing, confirmation guards, workout/intensity codecs. SQLite, so Electron's ABI. |
| `test:library-migrations` | The collection drop and `dropLocalTrainingPlans`, against a hand-written old-shape database. |
| `test:training-library-surface` | Static: no `window.prompt` or `window.confirm`, no collections or local plans, two tabs, sync watched, the arithmetic delegated, one grid track per cell. |
| `test:plan-filters`, `test:plan-compliance`, `test:plan-reader`, `test:plan-editor-model`, `test:plan-draft` | The pure modules above. |
| `test:coros-official-plan` | A catalogue plan's localization keys, program distances in centimetres, `totalSets` counting steps. |
| `test:library-renderer` | A real window: plan items, the day grid at both widths, three status tones, the calendar dialog and its confirmations, the index folding a running copy into its plan, `ConfirmDialog`. |
| `test:plan-editor-renderer` | The editor in its portal. |
