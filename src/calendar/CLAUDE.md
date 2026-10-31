# Calendar and the workout builder

## One builder for every workout

`WorkoutBuilder.tsx` (rows in `workoutBuilderRows.ts`) writes every workout: Create workout
(Calendar and Library), a plan session new or edited (`WorkoutBuilderModal`), **Edit workout**
in the Library and **Edit** on a scheduled session (both read by `getWorkoutForEdit`, saved and
verified by `saveWorkoutEdit`, source `library` or `scheduled`). What else remains is
read-only: `WorkoutViewModal` and `WorkoutReadOnlyBody` (Library reader, plan reader, Calendar).
- **A row read from a workout remembers its node (`BuilderRow.origin`) and an untouched row
  writes that node back byte for byte**: rows hold display strings, so re-encoding drifts and
  drops what the builder has no field for (a step's own name, strength instructions, a
  send-off, `sourceExerciseId`). A changed step keeps its identity and only what still belongs
  to it; a step the builder cannot represent arrives `locked`; a chosen zone keeps its
  heart-rate family (`keepBasis`) until changed. The validator skips untouched rows.
  `npm run test:workout-builder-rows`.
- An existing workout keeps its sport (stated, never a locked dropdown). Defaults come from
  `electron/workoutDefaults.ts` (see `electron/CLAUDE.md`).
- `scheduledStructure.ts` + `WorkoutStructureView.tsx` draw a workout read-only; each strength
  exercise states its rest after a set. `test:scheduled-structure`.

## The Calendar screen

- `preloadableLazy` with `CalendarSkeleton` as its fallback; the range cache in
  `useCalendarData.ts` is module-level so a revisit paints at once. `test:calendar-renderer`
  holds the grid's box.
- **A day opens as a whole**: a press anywhere in a cell opens the day panel (`daySelection`,
  the number's button stretched over the cell), an empty day included; a card opens its own
  session (`DayOverview`). A card is two lines (sport icon and name; distance · time · load, or
  "Plan"/"Missed"), three per month cell before "+N more". A planned card's time and its session
  panel's are one figure, `plannedSessionSeconds`: COROS's `estimatedTime`, else the steps' sum
  only when every step is timed (a sum over some steps read as the whole session's).
- The week column states its load as a figure and a bar (done solid, planned hatched),
  COROS's target in words, and planned sessions/time apart from totals. Load Impact and Base
  Fitness are COROS's `ati`/`cti` (`computeWeeklyStats`, `test:calendar-pairing`). The figure
  and bar, the target (`weekRangeInLoadSource`) and the tooltip's figures are in the chosen load;
  the hovers name COROS's own.
- Sessions pair with plans by sport family, closest by load, then distance, then time
  (`matchScore` in `pairing.ts`); Overview reads today with the same order.
- Ask Coach for a day, week or session sends a `scheduleRefs` chip, never pasted figures.
- Days are local: `keyFromDate`, `monthGridWeeks` (`dateUtils.ts`); "today" turns over at
  midnight through `useTodayKey` (shared with Overview).
