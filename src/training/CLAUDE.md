# Activities, Overview and the shared session views

## Activities (`ActivitiesView.tsx`)

The all-sport log, and the only home for sports no sport screen covers (Running 100–103,
Cycling 200–205/299, Hiking 104/105, Strength 400/402). Depth per sport belongs on the sport
screens; Activities links out with the session (`SportScreenRequest`).
- The arithmetic is out of the view: `activityFilters.ts` (periods cut at a Monday,
  categories, search, totals), `activityFacts.ts` (a row's facts, capped at three) and
  `activityDetail.ts`. `npm run test:activity-filters`.
- The mix bar's legend is the sport filter, drawn from the period alone (`inPeriod`). A
  selection the filters no longer admit leaves the pane blank.
- **A hike is read in km/h everywhere** (`isSpeedSport` answers yes for 104/105).
- On screen distances and heights group thousands (`setGroupedDecimalFormatter`); the main
  process keeps `toFixed` (Coach reads "1245.6 km") and `formatDecimal` stays ungrouped
  because some callers fill fields read back as numbers.
- `activities.css` is imported by `ActivitiesView`, so a harness mount of one of its pieces
  must import it or it measures unstyled boxes. `test:activities-renderer`.

## The channel chart ("Performance")

`ActivitySeriesChart`, `activityChannels.ts`, `useActivityDetailSummaries.ts` — shared by every
sport (anything two screens need moves here rather than being copied).
- **The line is drawn from what was recorded**: `smoothActivitySeries` averages noisy channels
  over a few seconds (never heart rate), then `envelopeActivitySeries` cuts to 1 000 rows of
  per-bucket min and max. Every figure the page *states*, the segment line included, comes off
  the recorded samples.
- **Split** (`activity.chart.split`) draws Output above (pace, effort pace, speed, power,
  climbing rate) and Body & form below on one clock; the two-channel cap counts per plot.
  Power is output. Every plot keeps both gutters and round ticks (`activityAxis.ts`) so plots
  line up.
- **Colours are COROS's hues at this app's lightness**, chosen so every pair a chart can draw
  together stays apart under colour-vision deficiency; `test:activity-channel-colors` holds the
  pairs named over `DARK_CHANNEL_COLORS`. Names are COROS's: Effort pace, Ground time, Stride
  height, Stride ratio, Running power (decided by `isRunSportType`, never `motion`).
- `motion` picks the sport's reading: `"speed"` (rides: speed, rpm), `"hike"` (km/h, climbing
  rate), `"trail"` (pace, GAP, climbing rate).

## Training label (`electron/sessionIntensity.ts` reads, `trainingBenefit.ts` names)

A coloured chip (Recovery, Aerobic, Tempo, Threshold, VO2 Max, Anaerobic) and a shape chip
(Intervals 3 × 8′, Strides, Long run). Runs and rides only (100–103, 200, 201, 203, 204, 299).
- **Published standards, not tuned to one athlete**: COROS's zones mapped to Daniels' paces; a
  repeat session named by its work bouts (Seiler & Kjerland); Daniels' least work per type.
  A rep is read on pace where there is one, else heart rate. A steady session is read after a
  10-minute warm-up, each second at the lower of its pace and HR zone. Reps come from a
  structured workout's phases or laps pressed by hand (never 1 km / 1 mile auto-laps).
- **What is read is stored**, versioned on its own (`training_activity_summaries.intensity`,
  `INTENSITY_SUMMARY_VERSION`); the label is decided in the renderer because only it knows the
  HR model (`useHeartRateZoneModel`). Only Running and Cycling sweep for it
  (`requireIntensity`). The screenshot demo profile is HR reserve (`hrZoneType: 2`) because its
  sessions are scored that way. `npm run test:training-benefit`.

## Time in zones (`ActivityZoneTimePanel`, `zoneTime.ts`)

On the run, ride and hike pages (not Activities, not Strength): COROS's own seconds per zone
from `zoneList`, every zone listed. A run switches HR / pace (a trail run's pace is the GAP
list, type 173). Pace's seven buckets draw buckets 3 and 4 as one Threshold row.
`npm run test:zone-time`.

## Overview

The Readiness panel, Coming up, Training load heatmap, Training load distribution, one
section per sport, Strength. Arithmetic in `overview/*Model.ts` (`test:overview-model`); the renderer
suite mounts four states (`test:overview-renderer`). **Every "today" turns over at midnight**
(`useTodayKey`).

**Readiness** is one grid, not three cards: Recovery, Sleep and This week are columns whose
cells share rows; the Recovery column is a subgrid. It stays one row until a figure's name
would wrap (under 840px the week moves below; under 620px all stack).
- **Sleep** is last night (`pickLastNightSleep`): score in the Sleep screen's band colour,
  overnight HRV, and **Sleep HR from the sleep record's `avgHr`**, never COROS's resting HR.
- **This week** is COROS's training status — the Intensity Trend (`trainingLoadRatio` × 100)
  on the COROS app's five bands (Decreasing < 50, Resuming 50–79, Maintaining 80–99, Optimized
  100–149, Excessive ≥ 150) — over a column a day, a block a session; from today on the
  calendar's sessions are hatched, and today's plan is dropped once a session of its sport
  family pairs with it (`pairTodayPlan`, shared with Coming up and the sport sections). The
  columns measure **time, distance or load** (`overview.weekMeasure`); in load a strength
  block stands at the chosen load (COROS's day split by session, plus what Heracles adds). A
  planned session's time is COROS's `estimatedTime` (`durationSeconds`), its distance
  `distanceMeters`. Load the day's sessions do not claim is a block of its own, drawn in load
  only.
- The footer: **Load Impact is `ati`, Base Fitness `cti`** (EWMA of daily load, 7 and 42
  days; `ati / cti` is the trend). Never `tiredRateNew` (= `ati − cti`) or `staminaLevel`
  (present only on run days). This week's load is read **Monday to today** against the
  recommended range (`recommendedLoadMin`/`Max`), which COROS sets per calendar week — never
  against the rolling `t7d`. With Heracles chosen the footer, the Intensity Trend and the range
  are all in Heracles (`fitnessInLoadSource`), each hover naming COROS's own figure.
- Chart tooltips follow the pointer (`followTip.ts`, written onto style, no render); a chart is
  one tab stop with arrow keys between columns (`useColumnFocus`, `chartFocus.ts`).

**Coming up** (`comingUpModel.ts`) pairs today's plan with today's sessions by sport family
(`pairTodayPlan`); a row is pressed as a whole (done opens the session, to-do opens
`UpcomingWorkoutDetailPanel`).

**Training load heatmap** (`TrainingHeatmapPanel`) reads training load alone, in the chosen
load; there is no duration switch, and a month card names each session's load.

**Training load distribution** (`distributionModel.ts`): four weeks' load by sport, every
sport, in the chosen load (`sportLoadShares`). Then time per HR zone over the sports heart rate
measures only (`isHeartRateSport`: running, hiking, cycling, swimming, XC skiing, rowing,
flatwater paddling, walking, stairs, elliptical — not strength, gym cardio, climbing, ball
sports), summed from each session's own `zoneSeconds` (`zoneTimeEntries`, through
`useActivityDetailSummaries`), never COROS's all-sport zone totals; time only, since no session
carries load per zone. Read as the easy share against 80/20 with `intensityForZone`.

**Sport sections** (`sportModel.ts`): Running, Cycling, Hiking, each only when trained in the
last four calendar weeks and shown on the rail, built from the screens' own builders, never a
copy. "A week" figures divide by the weeks the window has run (`sportWindowWeeks`). **Strength**
(`OverviewStrength`, lazy) is the Strength screen's own `StrengthHero` over four weeks
(`useStrengthData`'s `windowDays: 28`), inside a `.strength-view` so its tokens resolve.

## Body figure (`src/training/body/`)

The Recovery column draws a low-poly wireframe of the athlete, lit from the feet to COROS's
recovery %, coloured by `figureColourFor` (the stop colours are declared on
`.training-recovery-panel`, where `--recovery-tone` can reach them).
- **The physique is height and weight only**, on Trefethen's height-adjusted BMI
  (1.3 kg/m^2.5), **continuous**: four baked bodies per sex at 18 · 22.5 · 27 · 31.5
  (`BODY_ANCHORS`) blended vertex by vertex (`shapeBlend`, `blendFigure`), drawn once per
  tenth (`drawingFor`). Missing height or weight draws Medium.
- **VO2max tones, never softens**: each body has a toned twin baked at 95% of its volume (a
  woman's at half the toning, `TONE_REACH`); firmness (`vo2Firmness`) runs from Good to
  Superior on The Cooper Institute's table for age and sex (`fitnessStandards.ts`), read as the
  median of the four weeks to the latest reading (`recentVo2max`), none if older than 90 days.
- **It is SVG** (`BodyFigure.tsx`, `bodyFigureDrawing.ts`): projected once, hidden lines culled
  by facing and a depth buffer, lines grouped by brightness. The far side's faint lines are
  drawn over the opaque skin; the glow is a tight line blur plus a wide outline halo under the
  skin. Colours are `--figure-*` on the stage, stepped at 2x.
- Paper stands it on a slate stage with its own ramp (darkened via `oklch(from …)`). Frames:
  `NARROW_FRAME`, or `WIDE_FRAME` from `WIDE_STAGE_MIN_PX` (the same width as the container
  query; `test:body-figure` holds them together and the order of the bodies by volume).
- `npm run body-figures:bake` (MakeHuman CC0, pinned) regenerates `bodyFigures.json`.
