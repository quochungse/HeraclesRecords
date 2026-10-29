# Strength

COROS strength sessions merged with Hevy imports (`electron/strengthHistoryService.ts`,
`hevyService.ts`, `strengthSessionMerge.ts`).

## The screen

**One scope at a time**: the session list beside a header band and the body map, and under
them only what the selection is about — a session's exercises, or the window's weekly chart,
main lifts and records. **The band is one fixed height** (`--strength-band-height`) for a
session and for "All sessions", so picking a session never moves the map. Records are written
in the exercise rows. A row's mark is the body figure lit on the heat ramp
(`SessionBodyGlyph` over `sessionHeat`). The list is as tall as the detail through
`contain: size` and scrolls inside its card with a measured fade. No time-in-zones panel (by
decision). The 3D hero (`StrengthHero`) is reused by Overview inside a `.strength-view`.

## Reading COROS's sets

- **Laps are read by their `mode`** (`lapItemKind` in `strengthDetail.ts`): 14 set, 15 rest,
  16 roll-up, 17 rest between exercises. Exercises are grouped by index *and* name; a set with
  `targetType` 2 is timed (reps 0). A run's laps carry exercise keys too (`S4208`) under modes
  0–2 and are no sets.
- **A movement's muscles come from its identity, never its display name**
  (`electron/strengthExerciseMetadata.ts`, `src/strength/exerciseTargets.ts`). Metadata is
  taken lap → roll-up → program step → catalogue row, then the Exercises Library's review is
  applied by `corosKey` (`reviewedMuscleLoads`); Hevy uses its template's muscle groups.
  `S4208` is generic; `S4209`–`S4214` are body regions, read by code. A session's `muscleList`
  is never per-exercise data.
- **On a program session a lap's `exerciseId` is a rounded 64-bit number, not an identity**:
  the step is found by matching `summary.programId` to a program's `idInPlan` in that day's
  `/training/schedule/query`, then by the roll-up's `programExerciseIndex` (work laps carry 0),
  and only when the lap's key agrees with the step's. `strengthSessionsWithCatalog` fills only
  COROS exercises with no metadata of their own (Hevy ids are another namespace).
  `test:strength-exercise-targets`.
- Two parsers for two readers: `parseStrengthDetail` (this screen, cached in
  `strength_sessions`) and `parseSessionSets` (`sessionSets.ts`, node-free, Coach's card and
  text); they agree set for set.
- **A cached breakdown is a parse, not the payload**: `strength_sessions.parse_version` below
  `STRENGTH_DETAIL_VERSION` counts as missing and is read again by the ordinary backfill — bump
  it with any change to what the parse keeps. The parse reads the exercise catalogue (a failed
  read falls back to an empty map) and, for a program session, the day's schedule.
- A Coach card stored before `setList` is redrawn from the detail on render
  (`useStoredSetsRedraw`), asked once a window per session, never written back.

## Hevy

Hevy is its REST API; nobody here has a real Hevy account, so shapes are checked against
Hevy's OpenAPI and faked in `test:hevy-service`.
- **The full read stops at a page that is all older than the window**, never at the first older
  workout (no documented order) — a short read hands `reconcileHevyWorkoutIds` a short list,
  which deletes what it was not handed.
- **Every request is bounded** (20 s): COROS and Hevy refresh in sequence.
- **Events are read from a day before the stored cursor** (`EVENT_CURSOR_OVERLAP_MS`); replays
  are idempotent, which is why `StrengthHistory.fetched` counts COROS alone.
- A workout only Hevy knows, and the Hevy connection itself, live on Strength alone — the
  sport-screen toggle in Settings warns when Strength is hidden with Hevy connected.
