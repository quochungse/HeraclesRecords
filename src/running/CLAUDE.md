# Running, Cycling, Hiking, Swimming

Four screens built on one shape (kind filter and period, hero, totals, weekly chart,
intensity beside a split by kind, sortable list, full-page detail that keeps the list's
scroll). **Shared, never copied**:
- All four carry `.running-view` and import `running.css`; `src/cycling/cycling.css`,
  `src/hiking/hiking.css` and `src/swimming/swimming.css` hold only their kinds' colours
  (`--ride-*`, `--hike-*`, `--swim-*`, mirrored as hex in `rideTypeColors.ts` /
  `hikeTypeColors.ts` / `swimColors.ts` — change both).
- `src/running/sportPage.ts`: the period cut (`weeksForPeriod`, `withinPeriod`), the list that
  opens a session on the whole page and restores its scroll (`useSessionPage`), the mouse's
  back button (`useBackGesture`). Fix it there, not in a screen.
- `src/running/sportVolume.ts`: volume measures, the four-week `trailingAverage`,
  `oneYearEarlier`. `formatVerticalRate` (`unitSystem.ts`) writes a height gained per hour.
- `RunIntensityPanel` (`sport="ride"|"hike"`) over `intensityMix`, `LoadRatioCard` over
  `acuteChronicLoad`, `DeltaChip`, the skeletons.
- Renderer suites pin `force-device-scale-factor` to 1 (a scaled display puts every box a few
  thousandths off). `test:running-renderer`, `test:cycling-renderer`, `test:hiking-renderer`,
  `test:swimming-renderer`.

## Running

- **A trail run (102) is a run**, on Running, in its load ratio and totals. Pressing **Trail**
  in the surface filter changes the blocks: `TrailRunningHero` (hours, climb, load ratio over
  all runs, climb per hour), climb per km instead of pace, the volume chart opening on Time, no
  efficiency chart, Climb and Climb/h columns. A 102's page adds Hiking's Terrain and climbs
  panels (`src/hiking/TerrainPanels.tsx`, `reading="trail"`) and drops decoupling. Running's
  word is "Climb", Hiking's "Ascent". `test:run-metrics`.

**Running efficiency** (`electron/runPerformance.ts` reads, `runPerformanceModel.ts` arranges):
speed bought for heart rate, on the VO2max scale — Daniels & Gilbert's oxygen cost of the GAP
over Swain's share of HR reserve. Road and track runs only (100, 103).
- **The summary keeps a raw curve, not a figure** (`performance` on
  `training_activity_summaries`, `PERFORMANCE_SUMMARY_VERSION`): every 30 s past a 10-minute
  warm-up, 90 s of GAP against 90 s of heart rate **40 s later** (measured lag), kept only with
  pace steady (±7%), heart settled (±8 bpm) and a running cadence (140+). Every step not read
  says why (`runPerformanceSteps`: *no data* dotted, *not steady* hatched; above the profile
  maximum is its own reason, `readingGapReason`). No profile figure is in the curve.
- **Each minute is read against the athlete's usual at that minute** (median of six weeks of
  runs, each levelled over minutes 10–40), scaled onto COROS's VO2max. Heat is not taken out.
- **Read on demand, bounded**: Running sweeps with `requirePerformance` for the runs shown and
  six weeks before; a run's page for six weeks before it; never under Trail. The line is a
  rolling seven-day median (`performanceRollingMedian`). `npm run test:run-performance`.

## Cycling (`src/cycling/`)

Rides split by kind (`rideType.ts`: Road 200/299, Gravel 203, Mountain 204, Indoor 201, E-bike
202/205). A rider reads **speed over the time that recorded distance** (`distanceDuration`), a
week in **hours** first, kind shares by time, FTP and W/kg in the hero, `motion="speed"`.
- The ride page (`rideAnalysis.ts`, node-free, activity time): top speed held 5 s, the Power
  panel (NP, IF, TSS against **today's** FTP — COROS keeps no FTP history), power zones on
  COROS's `cyclePower` ceilings, coasting at 0 W outside the zones, climbs categorised as
  Strava scores them. **COROS's own `np`, `bicycleIf`, `work`, `trackClimbInfo` are not read**
  (always 0 or empty). No efficiency or decoupling (the road and wind decide them).
- The route map colours a ride's speed on the ramp, never COROS's (running) pace zones.
- `npm run test:ride-metrics`.

## Hiking (`src/hiking/`)

Hikes (104) and mountain climbs (105); 106 "Climb" is left out. A walker reads **height and
hours before distance**: the hero is this week's time, ascent, biggest day, ascent per hour; no
VO2max, threshold pace, load ratio, efficiency or pace.
- **The list's time is COROS's activity time, usually the whole day** (hike mode has
  auto-pause off). **The hike page finds the moving time** (`hikeAnalysis.ts`, node-free,
  wall-clock series): a stop is ≥ 20 s with distance held over a ±5 s window; COROS's pauses
  are taken out of gaps; a gap over 30 s with no pause is a dropout counted as one second.
  Rests ≥ 2 min are listed. Terrain by the grade of every 25 m on the moving clock; ascents by
  a 30 m / 60 m zigzag; Vs Naismith.
- `motion="hike"` adds **Climbing rate** (`withVerticalSpeed`, over at least a minute either
  side, never across a large gap). `npm run test:hike-metrics`.
- The sport colour group is **Hiking** (`hiking`, `--sport-hiking`); a colour stored under the
  old `trail` key is read as `hiking` (`LEGACY_CATEGORY_KEYS`). `test:sport-colors`.

## Swimming (`src/swimming/`, `electron/swimDetail.ts`)

Pool (300) and open water (301). A swimmer reads **pace per 100 m (or yd), never per km**, a
week in metres, and in the pool **the length**: strokes, SWOLF, stroke, stroke rate.
- **COROS's swim fields are its web app's** (training.coros.com reads the same payload; no
  account here has swims, so nothing is probed live): `lapList` `type` 1 = lengths, 2 = laps,
  each a `lapItemList` with `swimStyle` (1 free, 2 breast, 3 back, 4 fly, 5/6 drill, 7 IM,
  255 mixed), `strokes`, `avgSwolf`, `avgStrokeRateLen`, `swimRelationIndex` (length → lap); a
  rest is an item with no distance. Summary: `totalCadence` (strokes), `avgSwolfLen`,
  `avgCadence` (stroke rate), `waterTemperature` in hundredths. **The pool length is in no
  field**: `poolFromLengths` takes the median length (25 yd is 22.86 m, said in yards).
- `parseSwimDetail` → `detail.swim` (lengths with `restBefore`, intervals with `restAfter`);
  `swimSummaryOf` → `training_activity_summaries.swim` (`SWIM_SUMMARY_VERSION`, swept by the
  Swimming screen alone with `requireSwim`). **A pool swim's `detail.laps` are its
  intervals** (`swimLaps`) for every reader — Activities, Coach, the chart — never COROS's
  generic list, which is the lengths with the rests among them; open water keeps its watch laps.
- **One figure, one definition**: SWOLF is `sessionSwolf` (counted lengths, drills out) on the
  row and the page; pace is over the swimming (`swimmingPace`, rests out once read), the
  lengths chart's pace line too. Until the summaries are read (`settled` from
  `useActivityDetailSummariesState`) the hero and panels say they are reading, never "none".
- **Read honestly**: SWOLF only within one pool length and on freestyle (a 50 m length has a
  turn fewer); the stroke mix across pools shows distance per stroke and stroke rate, a swim's
  page adds SWOLF and strokes a length. Best efforts are freestyle lengths in a row inside one
  interval with no rest; CSS = (400 − 200) / (T400 − T200) over 12 weeks, and nothing when
  the 400 was no slower a metre than the 200. No HR intensity panel or load ratio (heart rate
  runs lower in water and a wrist reads it roughly).
- Swims (300, 301) have their own sport colour group, **Swim** (`swim`, `--sport-swim`); open
  water is mixed off it and the strokes are `--swim-*`.
- Sets are intervals in a row of one distance, one stroke and about one pace (6% rep to rep:
  a descending set stays one, an easy warm-up hundred does not join the hard set after it).
- `npm run test:swim-metrics`, `test:swimming-renderer`.

## Sample sessions for screenshots

`dev:sample-rides`, `dev:sample-hikes`, `dev:sample-trail-runs`, `dev:sample-swims`
(`electron/sampleRides.ts`, `sampleHikes.ts`, `sampleTrailRuns.ts`, `sampleSwims.ts`, shared
`sampleActivityKit.ts`) simulate sessions — the first three on real routes (committed,
regenerated by `*:fetch`), the swims as COROS-shaped pool payloads read back through
`parseSwimDetail` plus Hồ Tây loops — seeded and dated back from today. Each is also a switch
in the development bar's Sample menu. **They are added at the window's door only** — the
list, detail, raw and summaries handlers in `main.ts` — and reach no store, sweep, Coach tool
or watcher. Rides scale to the account's FTP (`setSampleRiderFtp`). `test:sample-rides`,
`test:sample-hikes`, `test:sample-trail-runs`, `test:sample-swims`.
