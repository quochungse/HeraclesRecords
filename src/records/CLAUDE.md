# Hall of Records

Three screens on the rail under Your journey, drawn by one lazy module (`HallOfRecordsView`,
`section`): the **Timeline** of every milestone the athlete has reached, newest first (its
view id is still `records`, so a stored startup view opens it); **Personal Records**
(`personalRecords`); and **the Twelve Labours** (`labours`) — twelve kinds of achievement
(`labours.ts`), three stages each, all twelve being Apotheosis. A labour's toast and
celebration open the Labours; a stage's date there opens its milestone on the Timeline
(`timelineFocus` in App). Only the Timeline marks milestones seen, and carries the rail's
"new" count.

## Rules for stages

- **Every stage is a standard, never a first and never a gain on the athlete's own past**: I is
  what an ordinary beginner reaches in weeks, II in months, III in a year. A first swim or ride
  is a timeline milestone, no stage.
- Speed and VO2max are graded **for age and sex on the day** (`fitnessStandards.ts`): the Mares
  on a WMA 2025 road age grade (45/60/70%, a best effort of 5K or longer), the Hesperides on The
  Cooper Institute's ratings (60th/80th/95th percentile). Birthday and sex come from the COROS
  profile (default: a man of 30), and `settled` waits for it.
- Lifetime counts are kept; the Lion counts **days**, not sessions. A stretch is any days
  running, never a calendar month. The Geryon counts places only (as Where you've been draws
  them). Not built on purpose: a strength 1RM stage (Hevy sets are not read here).

## How it is worked out

- **Computed, not stored**: `milestones.ts` (`computeRecords`) walks every activity oldest
  first. **An id is the fact, not the moment** (`first:ride`, `pr:<activityId>`), so computing
  twice gives the same ids — the "New" badge and notices key on them. `timelineModel.ts` folds
  the timeline. `npm run test:records`.
- **Records were noise until three rules**: one run's records are one milestone; nothing counts
  in the first four weeks at a distance or under a 1% gain; COROS's own all-time record stands
  in for ours on the same run, and an effort under 97% of it is a GPS fault. Best efforts come
  from the summary (`bestEfforts` in `activityMetrics.ts`, versioned apart under
  `RECORDS_SUMMARY_VERSION`); the hall backfills oldest first, 4 at a time, 400 per session,
  only while open.
- **What a source forgets is remembered** in `athlete_milestones` (`personal`,
  `electron/recordsLedger.ts`): VO2max past COROS's year, nights past what a machine kept,
  finished plan runs. The earliest day seen wins; the window may write only VO2max and sleep.
  `test:records-ledger`.
- **Computed in App** (`useHallOfRecords`) because the rail's count and notices need it on
  every screen; local reads only.
- **Notices** (`recordsNotices.ts`, `LabourNotices.tsx`): what was told is
  `heraclesrecords.records.notices.v1` (`personal`). **The first reckoning announces nothing**
  and waits for `settled`; a milestone older than 30 days gets no badge, a stage older than 14
  days no toast.
- **Personal Records** (`personalBests.ts`, `PersonalRecordsBoard.tsx`) is worked out in
  `computeRecords` as `board`, so samples have it too. Each period's best is COROS's own
  (`recordDetailList` groups 4/2/3/1 = all, 6 months, 12 weeks, 4 weeks — the figures the
  watch shows); a record's history is every time the records walk's best effort fell, COROS's
  figure in place of ours on the same run. Only the best-effort distances are on it: COROS's
  3K is a figure with no history, and is left out. The page opens on the record that grades
  highest for age and sex.
- The developer toolbar's Sample menu has four presets (`sampleRecords.ts`), told against a
  notices record in memory, asking nothing of COROS.

## Drawing

A labour's emblem is the athlete's gold artwork (`src/assets/labours/<LabourId>.webp`) in a CSS
frame with four steps of light by stage; its golds are the artwork's, not `--accent`. On paper
the hall is gold on white (`--hall-gold*`, derived from the accent in `recordsNotices.css`);
each labour's head is a black plaque.
