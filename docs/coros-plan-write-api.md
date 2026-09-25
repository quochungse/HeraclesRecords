# COROS Training Plan Write API (internal)

Reverse-engineered from the COROS Training Hub web app. The workout-program and
calendar contracts below have been verified against the live API. The native
Training Plan Library — create, update, copy, delete, put on the calendar, take
off it, and sync — was verified end to end on 2026-09-24, with payloads taken
from the Training Hub web app's own bundle. These endpoints are
**undocumented** and may change.

All requests use the existing Training Hub session (`accesstoken` + `yfheader`
with `userId`) against the regional `teamapi*.coros.com` host.

This is the private API used by the first-party Training Hub web app. It is not
the partner-only COROS OpenAPI training-plan push API, and it is not the COROS
MCP service. The COROS MCP is currently read-only; CorosLink performs writes
through the athlete's authenticated Training Hub session.

## Endpoints

| Path | Method | Purpose |
|------|--------|---------|
| `/training/program/calculate` | POST | Compute distance, duration, load, sets, and bar chart before a write |
| `/training/program/add` | POST | Save workout to library |
| `/training/program/query` | POST | List library workouts |
| `/training/program/detail` | GET | Read a full library workout (`id`, `supportRestExercise=1`) |
| `/training/program/estimate` | POST | Preview a scheduled occurrence with `{ entity, program }` |
| `/training/program/update` | POST | Update a full library workout while retaining identity fields |
| `/training/program/delete` | POST | Delete library workout(s) |
| `/training/exercise/query` | GET | Resolve Strength and HYROX exercise IDs/names |
| `/training/schedule/query` | GET | Read calendar (`startDate`, `endDate`, `supportRestExercise=1`) |
| `/training/schedule/update` | POST | Add, edit, or delete calendar entries (`status: 1`, `2`, or `3`) |
| `/training/plan/query` | POST | List native plans, templates and instances alike (body `{}`) |
| `/training/plan/detail` | GET | Read one plan (`id`, `supportRestExercise=1`) |
| `/training/plan/add` | POST | Create a plan; `data` is its id |
| `/training/plan/update` | POST | Replace a plan with the body; no `data` |
| `/training/plan/copy` | POST | Duplicate (`?id=&region=`, body = the detail); `data` is the copy |
| `/training/plan/delete` | POST | Delete (body `[id]`), soft; no `data` |
| `/training/plan/sync` | POST | Push a plan's edits into its running instance (`?planId=`); `data` is a task id. **Not used by the app** — it does not carry a move (below) |
| `/training/plan/syncstatus` | GET | Poll that task (`?taskId=`); `data` is `2` when done |
| `/training/schedule/executeSubPlan` | POST | Put a plan on the calendar (`?subPlanId=&startDay=`, body `{}`); no `data` |
| `/training/schedule/quitSubPlan` | POST | Take an instance off the calendar (`?subPlanId=`, body `{}`); no `data` |

## Native COROS Training Plan Library

The app reaches these only through `corosTrainingPlanAdapter.ts`, which calls
two allowlisted bridges in `trainingHubService.ts`:
`readNativeTrainingPlanEndpoint` (query, detail) and
`writeNativeTrainingPlanEndpoint` (the six writes). The body builders are
pure (`buildNativePlanCreateBody`, `buildNativePlanUpdateBody`) and
`npm run test:coros-plan-writes` holds them against the captured requests in
`scripts/fixtures/coros-plan-write/`. `npm run verify:coros-plan-api -- --live`
runs the whole lifecycle against the signed-in account through the same
adapter and removes what it made.

Where the web app's code lives, for re-checking: `https://t.coros.com/` loads
`main-*.js`, whose lazy chunks hold `savePlan` (the `this.addPlan(x)` call),
`updatePlan` (`Object.assign(this.detail, {…})`), `api4DeletePlan({data:[t]})`,
`api4copyPlan`, `usePlan` → `executeSubPlan`, `handleQuit` → `quitSubPlan` and
`doUpdatePlan` → `plan/sync` (the one the app does not call). Chunk names change
per build; search for those strings.

### A plan's shape

```json
{
  "name": "Base block", "overview": "…",
  "entities": [{ "happenDay": "", "idInPlan": 1, "dayNo": 0,
                 "sortNo": 1, "sortNoInPlan": 1, "sortNoInSchedule": 1 }],
  "programs": [{ "…full program…": "…", "idInPlan": 1 }],
  "weekStages": [{ "weekNo": 1, "stage": 2,
                   "trainSum": { "planDistance": 0, "planDuration": 0, "planTrainingLoad": 0 },
                   "sumByType": [] }],
  "maxIdInPlan": 1, "totalDay": 1, "unit": 0,
  "sourceId": "…", "sourceUrl": "…", "minWeeks": 1, "maxWeeks": 1,
  "region": 1, "pbVersion": 5,
  "versionObjects": [{ "id": 1, "status": 1 }]
}
```

- **A session is an entity plus a program sharing `idInPlan`.** The program is
  a complete COROS program — `/training/program/detail`, or a calculated one —
  and COROS stores it as a copy with an id of its own. Nothing links it back to
  a library workout; editing either leaves the other alone.
- `dayNo` counts days across the whole plan, Monday first (week = `dayNo / 7`).
- **`totalDay` is the last session's `dayNo` + 1**, so a plan cannot end in an
  empty week.
- **`minWeeks` / `maxWeeks` are the fewest and most sessions in a week** that has
  any — not week counts, whatever the names say.
- **A week's `stage` is an enum**, the index the web app's picker returns:
  0 Not Set (`R6014`), 1 Preparation (`C1026`), 2 Base (`C1027`), 3 Build
  (`C1028`), 4 Peak (`C1029`), 5 Race (`C1030`), 6 Transition (`C1031`). There
  is no Taper and no naming a stage. `COROS_WEEK_STAGES` in the adapter.
- `sourceId` / `sourceUrl` are the plan's thumbnail; the web app picks one of
  COROS's defaults at random.
- **A plan holds no rest days and no notes.** `eventTags` sent with `plan/add`
  or `plan/update` is answered `0000` and dropped. Tags live on the calendar
  only (`schedule/update` `{eventTags:[{name, type, happenDay, operation}]}`,
  operation 1 add / 2 edit with `id, planId` / 3 delete with `id`; type 1 Other,
  2 Race, 3 Test). A rest day is an empty day.
- The web app refuses an eleventh session on one day.

### Update

`update` takes the whole plan every time — the detail as read, with the
fields above replaced — and `versionObjects` names only what changed:

| Change | versionObject |
|---|---|
| session added | `{ id: <new idInPlan>, status: 1 }` |
| session edited or moved | `{ id, labelId?, planProgramId, planId, status: 2 }` |
| session removed (also drop it from `entities` and `programs`) | `{ id, labelId?, planProgramId, planId, status: 3 }` |

A new session takes the next id past `maxIdInPlan`; ids are never reused.
Its program goes without `planId` and `star` — the web app sends a library
workout that way, and COROS gives the session program ids of its own — so a
session copied inside a plan, or out of another one, is sent the same way
rather than naming the session it came from (`newPlanProgram`).
`version` goes up by one per update. **Nothing refuses a stale write that we
know of**, so `savePlanToCoros` compares `version` against the one the edit
began from and answers a conflict before anything is priced or written.

### Copy, delete

- `copy` keeps the original's **name** and records `originId`. A copy of an
  instance is a plan that is not on the calendar (`executeStatus 0`).
- `delete` is **soft**: the plan leaves `plan/query`, while `detail` still
  answers for it with `status: 0`. Absence from the list is the only test.

### On the calendar: instances

- `executeSubPlan?subPlanId=<plan>&startDay=yyyyMMdd` makes an **instance** — a
  plan with `executeStatus 1`, `sourcePlanId` naming the original, and
  `startDay` / `endDay`. The original stays `executeStatus 0`. **The answer
  carries no id**; find the new instance in `plan/query` by `sourcePlanId`.
- **`dayNo 0` lands on the Monday of the week holding `startDay`, and sessions
  before `startDay` are dropped.** A Wednesday start loses Monday and Tuesday of
  week 1; a Sunday start loses the whole week.
- **Nothing is checked against the calendar.** A day that already holds a
  workout gets the plan's session beside it.
- Each calendar entry carries `planId` = the instance and the plan's
  `idInPlan`; the plan's stages are copied onto the calendar's own
  `weekStages` (keyed by `firstDayInWeek`, `planId` = the account's schedule).
- **Editing the instance with `plan/update` changes the calendar at once** —
  adding, removing, moving (entities carry real `happenDay`s, counted from that
  Monday). Moving a session on the calendar instead (`schedule/update`,
  `versionObjects:[{type:0, id, status:2, planId, planProgramId}]` with the
  moved entity and its program) updates the instance's `dayNo` **and raises its
  `version`** (0 → 1, measured 2026-09-25, list and detail alike) — so a cached
  copy compared by version cannot miss a move made on the calendar.
- **Editing the original leaves the instance alone.** `plan/sync?planId=<original>`
  (no body) pushes the original into the instance in place (same id) and
  answers a task id; poll `syncstatus?taskId=` until `2` (the web app polls
  every second, without end). **Sync overwrites the instance**: a session added
  to the instance directly is gone after it. **And it does not carry a move**
  (measured 2026-09-25): a session moved from day 0 to day 1 in the original and
  then synced stayed on day 0, in the instance and on the calendar. The app
  therefore never uses sync; it writes the original's sessions onto the instance
  with `plan/update`, which moves, adds and removes on the calendar in place.
- `quitSubPlan?subPlanId=<instance>` removes every session of the plan and
  nothing else — a one-off workout on the same day stays. The instance stays
  listed with `executeStatus 2`, and the calendar's stage for its weeks goes
  back to Not Set. Measured 2026-09-25:
  - **`executeStatus 2` is also what a run that ran out reports**; only `endDay`
    tells them apart. `executeSubPlan` sets it past the last session (a 17-day
    plan from Monday 20270104 went on with `endDay` 20270127); `quitSubPlan`
    moves it to the day of removal (20260925, before `startDay` for a run not
    yet begun). The library reads a run whose `endDay` falls before its last
    session day as `stopped`, not `finished`.
  - **`version` does not move**, and the `plan/query` row loses its `entities`
    and `programs` while `detail` keeps them.
  - **A stopped run cannot go back on the calendar**: `executeSubPlan` on it
    answers `1031 Parameter input error`. Copying it is the way to reuse it.
- `schedule/copyWeek?sourceFirstDayOfWeek=&targetFirstDayOfWeek=` copies a
  calendar week; `schedule/deleteWeek?targetFirstDayOfWeek=` empties one —
  **everything** in it, from any plan.
- `rescheduleScheduledWorkout` in `trainingHubService.ts` says a
  `schedule/update` with `status: 2` is refused with 17004. The move above,
  with `type: 0` and the entity, was accepted on 2026-09-24; which part made the
  difference has not been isolated.

### Official plans

A plan saved from COROS's catalogue is written in localization keys (`P10035`)
and carries `officalConfig.isOffical: 0` — it is the athlete's plan, and
update, copy and the instance edits above all work on it. Its keys resolve
through `corosLocale.ts`.

## Create library workout

1. Build the program payload with `exercises[]`, `sportType`, `name`, etc., and
   clear identity fields (`id: "0"`, etc.).
2. `POST /training/program/calculate` with that payload.
3. Merge `planDistance`, `planDuration`, `planTrainingLoad`, `planSets`,
   `planPitch`, `distanceDisplayUnit`, and `exerciseBarChart` into the program.
4. `POST /training/program/add` with the calculated payload.
5. Response `data` is the new program ID string.

Workout sport IDs are Run 1, Bike 2, Pool Swim 3, Strength 4, Trail Run 5,
Indoor Climb 6, Bouldering 7, XC Ski 8, and HYROX 9. The full `targetType` enum (from the
traininghub web-app bundle, `main-*.js` → `targetTypeName`):

| Sport | Step targets | Intensity types / secondary control |
|---|---|---|
| Run | Time, Distance, Training Load, Open; Rest also HR Recovery | % Max HR, % HRR, % LTHR (preset or custom %), Heart Rate (bpm), % Threshold Pace, Pace, % Effort Pace, Effort Pace, running Power (zone or watts), Cadence, Not set |
| Trail Run | Run targets plus Elevation Gain | Same as Run |
| Bike | Time, Distance, Training Load, Open; Rest also HR Recovery | % Max HR, % HRR, % LTHR, Heart Rate, % FTP, Speed, Power, Cadence, Not set |
| Pool Swim | Distance, Time, Training Load, Open; Rest also HR Recovery; Send-off uses Distance plus interval | Stroke (Freestyle, Breaststroke, Backstroke, Butterfly, Mix, Individual Medley, Drills, Not set) |
| Strength | Training: Reps, Time, Open; other steps: Time/Open; Rest also HR Recovery | Training exercise plus Bodyweight/Weight; non-training steps use Not set |
| XC Ski | Time, Distance, Training Load, Elevation Gain, Open; Rest also HR Recovery | % Max HR, % HRR, % LTHR, Heart Rate, Speed, Not set |
| Indoor Climb / Bouldering | Routes, Time, Open | Relative-to-onsight or absolute Grade using the workout grading system |
| HYROX | Running steps use Run targets; Rest uses Time, HR Recovery, Open; functional targets depend on exercise kind | Running intensity set plus RPE; functional exercise kinds use Cadence/RPE or Weight/RPE as supported |

| value | name | targetValue encoding | UI label |
|---|---|---|---|
| 0 | notSet | 0 | — |
| 1 | manualEnd | 0 (no value) | **Open** |
| 2 | time | seconds | **Time** |
| 3 | count | raw | **Reps** |
| 4 | heart | raw | — |
| 5 | distance | **centimeters** (meters × 100) | **Distance** |
| 6 | load | raw integer 0–999 | **Training Load** |
| 7 | heartRateRecovery | absolute bpm | **HR Recovery** on Rest steps |
| 8 | cumulativeClimb | centimeters | **Elevation Gain** |
| 9 | routes | raw | **Routes** |

The web app derives `targetValue` as `100 × meters` for distance, `cm` for
cumulativeClimb, and the **raw input value** for everything else (time, load, …).
Related enums: `intensityType` (1=weight, 2=heart, 3=pace, 4=speed, 5=stroke,
6=power, 7=cadence, 8=effort pace, 9=FTP, 10=grade, 11=RPE), `intensityUnit`
(1=min/km, 2=min/mi, 3=s/100m, 4=km/h, 5=mph, 6=kg, 7=lbs),
`restType` (0=manualEnd, 1=time, 2=heart, 3=noRest, 4=distance).

A **weight** intensity is stored in **grams** (kg x 1000), the same scaling the
strength activity laps use. A 10 kg kettlebell press comes back as
`intensityValue: 10000`, `intensityDisplayUnit: 6`, and every weight in that plan
is a multiple of 1000 between 6000 and 102000. Nothing in the payload marks the
unit, so the scale is fixed in the codec rather than detected.

`intensityDisplayUnit` 6/7 is taken to mean print-as-kg / print-as-lb, leaving the
stored figure canonical metric either way -- the rule pace (s/km x1000) and speed
(km/h x100) already follow regardless of their own display units. **That reading
is measured for kg and inferred for lb**: no capture to hand came from a pound
account. Were COROS to store pounds x1000 under displayUnit 7 instead, a pound
athlete would be off by one factor of 2.2046 each way (a 45 lb step reading as
99.2 lb, and one written from here landing on the watch as 20.4 lb) while a round
trip inside the app stayed self-consistent. One capture from a pound account
settles it: `intensityValue` of 45000 rather than 20412 for a 45 lb step means
the pound branches drop the 2.2046 conversion and scale by 1000 alone.
The codec read and wrote it as kilograms until 2026-09-19, so plan weights showed
1000x too large and a weight this app wrote reached the watch 1000x too small;
a round trip through the codec could not see it, since both halves were wrong by
the same factor. `test:workout-intensity-codec` now pins the scale in both
directions against a verbatim COROS exercise.

Distance-step `targetDisplayUnit` is 2 (meters); an overall metric workout uses
`distanceDisplayUnit: 1` (kilometers). Pace targets use seconds per kilometer
multiplied by 1000, `intensityMultiplier: 1000`, and an ordered low/high range.
For example, `4:05-4:15/km` is encoded as `245000..255000` with
`intensityDisplayUnit: 1`. Speed is stored as km/h ×100. A custom yard pool
length is converted to centimeters and uses `poolLengthUnit: 4` (for example,
25 yd is `poolLength: 2286`).

The program `pbVersion` is feature-sensitive: effort pace requires at least 3,
zone IDs 6/7 require 5, FTP requires 6, climbing starts at 7, swim drills and
send-off/package steps require 8, and XC Ski/HYROX require 9.

Heart-rate recovery is a Rest-only completion target. COROS stores the selected
return-to heart rate directly in `targetValue`; unlike a timed recovery, the
watch waits until the athlete's heart rate reaches that bpm.

### Intensity codec

All new callers use the typed intensity objects in `electron/types.ts`; legacy
raw fields remain read-compatible but cannot be mixed with typed intensity on
one step. Percentage values are written in COROS's official ×1000 format and
the reader accepts both scaled values and older CorosLink unscaled values.

The issue #72 absolute-heart-rate form is deliberately encoded as
`intensityType: 2`, `hrType: 2`, `isIntensityPercent: false`,
`intensityCustom: 0`, with the requested bpm in `intensityValue` and
`intensityValueExtend`. The percent flag, not `hrType` by itself, distinguishes
absolute Heart Rate from Heart Rate Reserve.

Preset IDs are protocol values, not dropdown indexes. Max-HR zones are
Recovery 6 then Warm Up/Fat Burn/Aerobic Endurance/Threshold/Anaerobic 1–5;
HRR/LTHR use Recovery 6 then zones 1–5; threshold/effort pace use Recovery 7,
then 1, 2, 3, 5, 6. FTP uses 1–7 and running power 1–5. Swim strokes are
Freestyle 1, Breaststroke 2, Backstroke 3, Butterfly 4, Drills 6, Individual
Medley 7, Mix 255, and Not set 0.

## Edit an existing workout

Editing must not use the create reset path. Load a fresh full source, retain its
identity, source, and version fields, patch its `exercises[]`, and reject the
save if the source version changed after the editor loaded.

The flattened exercise array uses group-header exercises (`isGroup: true`) and
child exercises whose `groupId` is the header ID. Editing rebuilds `sortNo`,
`groupId`, group counts, and program summaries. Existing exercise IDs stay
stable; new IDs are allocated above the highest source exercise ID. Fields the
sport-aware editor does not understand remain on their original raw objects.

### Library definition

1. `GET /training/program/detail?id=...&supportRestExercise=1`.
2. Preview with `POST /training/program/calculate`.
3. On save, re-read and compare the version.
4. Calculate the edited full program without clearing IDs or versions.
5. Merge calculated distance, duration, load, sets, pitch, display unit, and bar
   chart.
6. `POST /training/program/update` with that full program.
7. Read `/training/program/detail` back and verify structure and totals.

### Scheduled occurrence

1. Load the matching raw `entity` and `program` from `/training/schedule/query`.
2. Preview with `POST /training/program/estimate` and body `{ entity, program }`.
3. On save, re-read and compare the version, then calculate the edited program.
4. `POST /training/schedule/update` with the original full entity and:

```json
{
  "entities": [{ "...original entity...": "..." }],
  "programs": [{ "...calculated edited program...": "..." }],
  "versionObjects": [{
    "id": "101",
    "status": 2,
    "planProgramId": "101",
    "planId": "425868133463670784"
  }],
  "pbVersion": "<program.pbVersion>"
}
```

`status: 2` is the first-party Training Hub's occurrence-edit operation. It is
not the move operation; CorosLink still moves workouts by add-then-delete.
Library and scheduled programs are independent copies, so neither edit flow
propagates into the other.

## Schedule on calendar

1. `GET /training/schedule/query?startDate=YYYYMMDD&endDate=YYYYMMDD&supportRestExercise=1`
2. Read `maxIdInPlan` from response data; next slot is `maxIdInPlan + 1`
3. Set `program.idInPlan` to that value
4. `POST /training/schedule/update`:

```json
{
  "entities": [{
    "happenDay": "20260707",
    "idInPlan": 42,
    "sortNoInSchedule": 1,
    "exerciseBarChart": [{ "...calculated chart entry...": "..." }]
  }],
  "programs": [{ "...full program payload..." }],
  "versionObjects": [{ "id": 42, "status": 1 }],
  "pbVersion": "<program.pbVersion>"
}
```

`status: 1` = add/update, `status: 3` = delete.

### Delete from calendar

```json
{
  "versionObjects": [{
    "id": "101",
    "planProgramId": "101",
    "planId": "425868133463670784",
    "status": 3
  }],
  "pbVersion": "<program.pbVersion>"
}
```

The shown value is always copied from the computed program; it is not hardcoded
to the Run base version.

### Delete from library

`POST /training/program/delete` with body `["425868133463670784"]`.

## Multi-day plan flow

For each unique workout definition:

1. Calculate it via `/training/program/calculate`.
2. Create it in the workout library via `/training/program/add` (optional).
3. Schedule each occurrence via `/training/schedule/update` with the program
   embedded in `programs[]`

One-off calendar workouts can skip the library step and embed the program
directly in the schedule update payload.

The Coach's plan is a confirmation-gated draft: an AI tool call cannot execute
the upload path. Today the card offers Workout Library, Calendar and two local
saves, with the native grouped choices disabled; that is being replaced by a
direct native plan write — see
[training-plan-coros-first.md](training-plan-coros-first.md).

## Fixtures

See `scripts/fixtures/coros-plan-write/` for redacted request/response samples:
`program-*` and `schedule-update-*` for the workout flow, `plan-*` and
`schedule-*-subplan` for native plans (captured 2026-09-24, user ids, names and
avatars replaced). `npm run verify:coros-plan-api -- --live` is the live check
for native plans.
For a cleanup-safe live contract check of workouts, run `npm run verify:coach-workout-api`
while a COROS session is saved in CorosLink. The verifier creates, schedules,
edits, reads back, checks library/calendar isolation for Run, then creates,
round-trips, edits, and deletes a representative workout for every supported
sport. All temporary artifacts are deleted in `finally`.
