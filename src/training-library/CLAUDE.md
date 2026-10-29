# Training Library

Main process: `electron/trainingLibraryService.ts`, `corosTrainingPlanAdapter.ts`,
`trainingPlanDomain.ts`. React never calls COROS directly; it requests one
`TrainingLibrarySnapshot`. Three tabs: **Workouts** (one session, no date; 40/60 list and
reader), **Plans** (a multi-week schedule) and the **Exercises Library** (a catalogue, not an
entity). Architecture: [docs/training-library-architecture.md](../../docs/training-library-architecture.md).
Workouts are written in the shared builder — `src/calendar/CLAUDE.md`. Coach's plans stay in
their conversation until saved — `src/chat/CLAUDE.md`.

## A plan is a COROS plan, and nothing else

Spec: [docs/training-plan-coros-first.md](../../docs/training-plan-coros-first.md). Every save
goes through `plan/add` / `plan/update`. This machine keeps only a **draft** (an edit in
progress, `training_plan_drafts`, `personal`), the app's metadata (`training_plan_metadata`:
tags, favourite, archived, origin) and `coros_plan_cache` (`device`; paints the list, stands in
offline; every write reads `detail` again first). There are no local plans
(`dropLocalTrainingPlans` drops the old tables on open, calling nothing on COROS).

**The model is cut to what COROS stores** (`TrainingPlanDocument`): `id` `coros:<remoteId>` or
`draft:<uuid>`; `remoteVersion` compared before a write; a session has week, day (0 = Monday),
order, a typed `workout`, and from COROS its raw `corosProgram` (written back byte for byte
unless edited) and `idInPlan`; `weekStages` are COROS's seven; `calendar` is `unscheduled` for
a plan and `running`/`finished`/`stopped` for a running copy. COROS stores no rest days, notes,
goal, difficulty, collections or free-named phases — don't add them back. A plan's length is
the last session's day + 1 (trailing empty weeks do not survive; the editor warns). More than
ten sessions on a day is an error.

- **Saving** (`savePlanToCoros`): a plan changed on COROS since the edit began is a conflict
  the athlete answers (Replace with my edit / Save as a new plan / Keep editing); one deleted
  meanwhile is saved as new; the plan is read back and the draft let go only if every session
  came back. Only sessions written here are priced through `/training/program/calculate`.
- **Duplicate** is `plan/copy` then a rename ("X Copy"). **Deleting a plan on the calendar
  takes it off first** (`takeOffCalendar`, `quitSubPlan` then delete; nothing deleted if the
  removal failed; refused without the flag).
- **Every open reads `/training/plan/detail`** (one request; `/training/plan/query` only when a
  detail lacks programs) and the answer replaces the copy in reader and list unless its
  `version` is older. Edit and Duplicate wait (`loadingFull`) only when the programs a save
  writes back are missing. A plan read alone joins its running copy through the cache
  (`findCachedRunningCorosPlan`).
- **Catalogue plans** arrive in localization keys (see `electron/CLAUDE.md`), are not locked,
  and carry their `exercises` on every program — never re-fetch a program that has them.

## Reader and editor

- `PlanReader` draws from the snapshot in hand and asks COROS for nothing (a background
  deepening fails silently). Its head: close (X), then right-to-left **Add to calendar** (the
  one filled button) or the **On calendar** pill, Continue editing when edits are kept, ♥, ⋯.
- **The editor is the reader with handles** (`PlanEditor`); its draft lives in the view so
  leaving the tab keeps the work. Save goes to COROS, **Save draft** keeps it here (one draft
  per plan; `attachPlanDrafts` shows a new plan's draft as a tile marked Draft, a plan with
  kept edits as Editing). A day's `+` is a menu: New session (the workout builder on the
  plan's sport) or From workout library (`libraryWorkoutAsPlanSession` reads the program — a
  COROS plan holds its own copy). A copied session drops its `idInPlan`.
- **A rule that styles a library control must name all four scopes**:
  `.training-library-view`, `.tl-plan-modal-backdrop` (the portalled editor),
  `.tl-dialog-backdrop` (the builder and its `ConfirmDialog`, portalled to `<body>`) and
  `.coach-sheet` — or the control draws as the platform's grey button. Coach's canvas takes
  the library's tokens block only. A dialog over the portalled editor is portalled to `<body>`.
- The editor's shortcuts listen on the window, gated on `layer` (an undo remounts the focused
  session). A new plan opens named (`defaultPlanName`) with the name selected.
- **The week ridge picks what it measures** (`ridgeMeasure`: load only where every week with a
  session has some, else hours where every one is timed, else a count), stacked by sport
  (`weekRidgeSegments`); the tile's small ridge reads the same measure.
- **A session opens inside the reader** (`PlanSessionView`, Escape steps back one layer),
  drawn by `WorkoutReadOnlyBody` from `planWorkoutInputToEditorDraft` (a step with no `kind` is
  `training` — old plans lack it). A duration is stated only when every step is timed.
- A week is seven columns when its card is wide enough (a container query on
  `.plan-week-card`), else a list. A running plan folds past weeks and opens on this week.
- Arithmetic lives outside components: `planFilters.ts`, `planCompliance.ts`,
  `planReaderModel.ts`, `planEditorModel.ts`, `planDraft.ts`. Compliance is `undefined`, not
  0%, for a plan not on the calendar; an unmatched session has **no status**, not "upcoming".
  `test:plan-editor-model`, `test:plan-editor-renderer`.

## The calendar is COROS's running copy

`executeSubPlan` creates it; COROS keeps it and the calendar in step both ways.
- **A move is the web app's move, in place**: `rescheduleScheduledWorkout` sends the session's
  own entity on its new day (`status 2`, `type 0`), keeping `idInPlan`. A replacement is
  `replaceScheduledWorkout`. Both go through `electron/scheduleMoves.ts` for the Calendar and
  Coach alike. `schedule/update` status 3 removes a session from the copy too. One
  `schedule/update` is all or nothing (`17004`).
- `TrainingPlanCalendarDialog` states before writing what COROS does silently: **it counts the
  plan from the Monday of the start week and drops every session before the start**, and **it
  never checks the calendar**. `previewPlanOnCalendar` refuses a past start, a second run, a run
  of a running copy, an empty plan, a start that keeps nothing; `executeNativeCorosPlan` asks
  COROS again just before writing.
- **Remove from calendar** is `quitSubPlan`. COROS gives a removed run `executeStatus 2` (the
  status of one that ran out) and only `endDay` tells them apart, so it reads `stopped`, and **a
  stopped run is not listed** (COROS refuses to run it again, 1031). A running copy whose plan
  is gone (`runOutlivesItsPlan`) warns and offers Duplicate first.
- **Saving a plan with a copy running asks** Keep editing / Save plan only / Save & update
  calendar. Updating is not `plan/sync` (it does not move sessions): `syncPlanToCalendar`
  rewrites the copy through `plan/update` (`planOntoRunningCopy`), from today on only.
- A running copy folds into its plan's row (`groupPlans`). `PlanCalendarBadge` marks a plan on
  the calendar. Compliance joins `remoteId:idInPlan` to the calendar's
  `schedulePlanId:scheduleIdInPlan`.
- `npm run test:coros-plan-writes` (fake COROS), `npm run verify:coros-plan-api -- --live`.

## Workouts tab

- **The list states what the list row carries** (probed): COROS fills only `exerciseNum`,
  `totalSets` and `estimatedTime` (`exerciseCount`, `setCount`, `durationSeconds`), so the
  columns are Workout / Exercises / Sets, in **name order** (figure sorts reshuffled the list
  as details arrived). No training-load column: only `calculate` reports one.
- The list's head is a sibling of the scroller (`scrollbar-gutter: stable`), and a long name
  ellipsises on `.tl-row-name-text`, not the flex line.
- The reader's dock is one row; scheduling opens `MonthDayPicker` (built from
  `monthGridWeeks`, upward, Escape in capture). Days are local (`keyFromDate`), never
  `toISOString`.
- There is no selection or bulk toolbar, and no "used by"/"last used" facts (nothing records
  the link; `last_used_at` stays in the synced table so it is not rewritten).

## Exercises Library (`ExercisesLibrary.tsx`)

COROS's movement catalogue to read: **one library, no sport tabs** (COROS keeps one catalogue,
Strength's; Hybrid Fitness reads it), the HYROX stations a toggle (`exerciseKind` 1–8, race
order), two cards at 35/65, nothing docked under the reader.
- Two filters: the body (`BodyFilterPanel` — the figure picks a part, then zooms
  (`zoomViewBox`) to pick muscles; a "Whole <part>" row lights the part) and equipment.
- **A COROS movement is described by its row and `exerciseReview.ts`, never by its name**:
  the review corrects COROS's muscles (71 movements), gives twists and side planks the obliques
  and neck work the neck (COROS has neither code), and fixes misfiled equipment; "Others" is
  dropped beside any other kind. Only a non-COROS movement (no `T####` key) is read off its
  name. Equipment uses COROS's 14 codes (`COROS_EQUIPMENT`). The abductors are a muscle of
  their own (COROS 10), drawn for this app in `body-shapes:fetch`.
- Everything said comes from `optionFacets` (`exerciseLibraryModel.ts`) and effort from
  `exerciseEffort.ts`. Favourites: `exercise_library_favorites` (`personal`).
  `npm run test:exercise-library`.

## Paper

The library stands on the canvas like every screen: white cards on `--shadow-card`, the reader
a pale well (`--tl-reader-bg`) with white cards inside. A workout read in full is white cards
wherever it is read (the `.sched-*` paper rules in `styles.css` cover the library reader, the
Calendar's session panel and the workout view); Coach's Workbench is left out on purpose.
