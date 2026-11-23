# Stress level and Heart rate

Two screens under Today (`StressLevelView`, `HeartRateView`) over one data layer: COROS's stress
and the day's heart rate from the COROS MCP server (`electron/stressHeartService.ts`, parsers in
`electron/stressHeartParser.ts`), cached by day in `stress_heart_days` and `stress_day_series`
(both `derived`). Messages: `stress.*` (Stress level, and the day list both share), `heart.*`.

- **Today states no average.** Both screens open on today. Stress level leads with the latest
  reading; Heart rate with the resting rate (set by the night) and no Avg HR. Averages leave
  today out of every row, detail and period figure, and a trend's average stops at yesterday
  (`stressHeartModel.ts`).
- **A day may change until it is two days old**: it is settled once read a whole day after it
  ended; until then a read is good for `UNSETTLED_TTL_MS`. The first fill asks 365 days of the
  three daily tools; later fills start at the oldest unsettled day. A tool that fails keeps
  the figures it gave before.
- **Both lists are the Sleep screen's month** (`DAY_LIST_DAYS`); one series read covers Stress
  level's, so picking a day asks for nothing. `queryStressTimeSeries` takes at most 7 days a request; a day with no block is
  stored empty so a settled one is not asked again.
- **The day's line** (`StressDayTimeline`) runs between the plot and the clock: asleep, in a
  session (outranks sleep), read, or dotted where nothing was read, with a badge on each sleep
  and session. The day's levels are one bar with no legend; a part names itself when pointed
  at.
- **Heart rate has no curve**: COROS sends no heart rate through the day, so a day is a ladder
  of ranges on one scale — whole day, asleep (the night's `avgHr`/`minHr`/`maxHr`, from the
  sleep records), each session's avg to max — with the resting rate drawn through it. The
  period's exercise zones are each session's `zoneSeconds` on the account's zone model,
  heart-rate sports only, as on Overview (`distributionModel.ts`).
- **A day's lowest–highest is COROS's, as sent** (`dayHeartRange`), pending review: it is not
  the extreme of every reading — 2026-11-23 came back 48–73 while COROS's own sleep summary for
  that night (00:00–06:58) said 48–85. The minimum matched the night's on every day probed.
- The ladder has no footnote; each row's hover card (`DayTip`) says what it holds. A session's
  zones are folded under its row until it is pressed.
- **A Heart rate list row's strip is its ladder in small**: both are drawn on `HEART_DAY_SCALE`
  (30–210 bpm, fixed), so a range sits in the same place in both and days compare. The day's
  range, the night's in lavender, each session from its average to its highest. The highest is
  the session summary's `heartRate` (`HEART_RATE_SUMMARY_VERSION`, swept with
  `requireHeartRate` for the listed days' sessions: from the detail file on disk, COROS only
  for a session with none), so every row is right on open; a mark at the average until it
  answers. Washed at the ladder's strength; no average tick.
- **Washes are mixed into `--heart-wash-ground`**: transparent on dark, the card's white on
  paper — two translucent washes overlapping on paper went muddy (lavender on pink). Heart rate's
  chosen day is in its own hue (`.heart-rate-view`), not Stress level's blue.
- **A session's highest heart rate and its own zones are its detail's**: COROS's activity list
  carries `avgHr` and never `maxHr` (29 of 29 rows, probed 2026-11-23). The day's sessions are
  read through `getTrainingHubActivityDetail` (the disk copy, else COROS), once each for the
  life of the screen (`useSessionDetails`); their zones are `heartRateZoneTime(hrZones)` with
  COROS's own bounds.
- **A period change moves the charts through CSS, not Recharts** (`useChartGrowth`,
  `data-grow`): Recharts animates by drawing every bar again each frame and stuttered at three
  months of stacked bars, so its animation is off and the bars rise from the plot's floor in the
  stylesheet. The floor (`transform-origin`) is the chart's height less its margin and axis;
  change them together. The hover card reads the day's row (`DayTip`), not Recharts' payload,
  which names a strokeless line in no colour.
- Sleep comes from `getSleepHistory({ cacheOnly: true })`, sessions from the activity list App
  holds — neither costs a request.

COROS facts (probed 2026-11-23): `stressHrv` and `stressHr` in the series are always 0, so there
is no all-day heart-rate curve; `queryRestingHeartRate` is the web's `testRhr`, not `rhr`;
`queryAvgHeartRate` and `queryStressLevel` include today; a reading's level is COROS's band
(Relaxed ≤ 25, Low ≤ 50, Medium ≤ 75, High). `npm run test:stress-heart`,
`npm run test:stress-heart-renderer`.
