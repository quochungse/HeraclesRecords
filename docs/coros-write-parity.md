# What we write to COROS, against what COROS writes

Audit and fix of 2026-10-20. Every object this app writes to the Training Hub API
— a workout (program), a plan, a calendar session — should carry at least the
fields COROS's own web app (t.coros.com) writes, with the same meaning. This page
records what the web app does, what the app did differently, and what was changed.
`npm run test:coros-write-parity` holds the program side; `test:coros-plan-writes`
and `test:schedule-changes` hold plans and the calendar.

## How the reference was taken

- The web app's bundle (`https://t.coros.com/` → `static.coros.com/coros-traininghub-v2/assets/main-*.js`
  and its chunks), read for the serializer and the request bodies. The step
  serializer is `ts()`; the plan saves are `savePlan` in the plan add and edit
  screens; the calendar writes are `addProgram`, `sportMove` and the occurrence
  edit.
- The live account, read only: every plan, the workout library, the calendar
  July–December 2026, and `/training/exercise/query` per sport. Objects COROS
  wrote (catalog plans, library workouts made in the COROS app) against objects
  this app wrote.
- Live writes of temporary "Sample" objects, read back and deleted, to confirm
  the move, the occurrence edit and the rebuilt programs.

## Steps (exercises)

The web app starts every step from a deep clone of a catalog row and writes over
it only: `id` (numbered 1…n), `groupId`, `isGroup`, `originId`, `sets`, the
target (`targetType`, `targetValue`, `targetDisplayUnit`), all ten intensity
fields (reset, then set), the rest, swim `packageTime`/send-off, HYROX
`exerciseKind`/`hyroxTrainingMode`, climbing `gradeSystem`/`onsightGradeOffset`.
A name or overview typed in the editor replaces the row's. The server fills
`animationId`, `coverUrlArrStr`, `thumbnailUrl`, `videoInfos` and
`videoUrlArrStr` from `originId`; nothing else.

| | warm-up (1) | training (2) | cool-down (3) | rest (4) |
|---|---|---|---|---|
| run | T1120 `425895398452936705` | T3001 `426109589008859136` | T1122 `425895456971866112` | T1123 `425895332954685440` |
| bike | T1120 `425895843250487297` | T4000 `425895474420170753` | T1122 `425895892642611200` | T1123 `425895820970344449` |
| pool swim | T1120 `425896164567728129` | T5000 `425895924049559553` | T1122 `425896212886110208` | T1123 `425896122691796993` |
| strength | T1120 `425898928110747648` | the movement's own row | T1122 `425898949585584128` | T1123 `426842174601216000` |

Trail run, climbing, XC ski and HYROX have no catalog; the web template uses the
run ids (`sid_run_*`), and a HYROX run step is always named `T1398`.

**What COROS reads off a strength step:** `muscle`, `muscleRelevance`, `part`,
`equipment`. The activity's `muscleList` — the muscle map in the COROS app — is
built from them, not from `originId`. Steps written here had `part: [0]`,
`equipment: [1]` and no muscle fields, so every session of a plan written here
came back with `muscleList: []`. A movement swapped in the app's editor kept the
old movement's muscles (the library workout "Full ngực lưng" v7 filed Straight
Arm Pulldown under the chest).

What the app did differently, all fixed:

- strength movements hand-built (above); name the English words instead of the
  key, overview always `sid_strength_training`;
- every other step `originId: "0"`, names "Warm-up"/"training"/…, and overview
  keys COROS does not have (`sid_run_warm_up`, `sid_run_cool_down`, `sid_run_rest`,
  `sid_run_rest_dist`);
- strength warm-up/cool-down/rest treated as movements (`restType 1/60`);
- the editor rewrote an untouched native step's name and overview, and swapped
  movements without their row; editing one session of a plan rebuilt every step;
- repeat groups named "Interval Group"/"Repeat", with the sport and `restType 3/0`
  (the web: name `""`, `sportType 0`, `restType 0`, `restValue 30`);
- programs without a cover (`sourceId`/`sourceUrl`), `unit` always 0, swim
  `poolLengthId` always 0 (the web: 1 = 25 m, 2 = 50 m, 3 = 25 yd, 4 = 33⅓ m,
  5 = 33⅓ yd, 0 = custom).

Deliberate differences kept: the coach's and the athlete's own step names and
descriptions (the web allows them); a cover picked by the program's name rather
than at random, so the same workout built twice is the same payload.

## Calendar

| | web app | the app, now |
|---|---|---|
| add | `{entities:[{happenDay, idInPlan, sortNo 0, dayNo 0, sortNoInPlan 0, sortNoInSchedule, exerciseBarChart}], programs, versionObjects:[{id, status 1}], pbVersion}` | same; `sortNoInSchedule` one past the day's highest |
| move | the stored entity on its new day, `versionObjects:[{type 0, id, status 2, planId, planProgramId}]`, `pbVersion 2` | same (was add-then-delete; a plan's session through `plan/update`) |
| occurrence edit / replace | the stored entity, the new program, `status 2` | same (a replacement was add-then-delete) |
| delete | `versionObjects:[{id, labelId?, planProgramId, planId, status 3}]`, `pbVersion 2` | same (sent the program's pbVersion) |
| library workout onto a day | the detail with each HR/pace step's unused half of figures zeroed | same (`libraryProgramForCalendar`) |
| quitSubPlan | query only | same (sent `{}`) |

## Plans

- `plan/add`: `{name, overview, entities, programs, weekStages, maxIdInPlan, totalDay, unit, sourceId, sourceUrl, minWeeks, maxWeeks, region, pbVersion, versionObjects}` — already matched; the cover is now one of COROS's ten rather than always the same one, and `unit` follows the account.
- `plan/update`: the detail with those fields over it, `type: 0` on every version object (added). A session nobody moved keeps COROS's `sortNo`/`sortNoInSchedule` (they were renumbered on every save, so untouched sessions read as moved).
- A session copied inside a plan has `id` and `planId` blanked, as the web's copy does; a library workout keeps its `id`.
- A rebuilt session (edited, or a template session written onto its running copy by "Save & update calendar") keeps the identity of the row it replaces — `id`, `planId`, `version`, cover — so only what it says changes.
- A catalog plan's name and overview (`P10035`, …) are sent back as their keys unless the athlete changed the text.

## Not changed

- `pbVersion` of a plan stays the highest of its programs (the web sends 2 on add and none on update); COROS has accepted both.
- `labelId` is sent on a delete only where the caller has it.
- The manual activity upload is a TCX through COROS's own import endpoint — the same thing the web app's file import does — so there is no object to compare.
