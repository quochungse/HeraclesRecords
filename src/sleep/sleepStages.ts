import type { TrainingHubSleepRecord } from "../../electron/types";

export type SleepStageKey = "awake" | "rem" | "light" | "deep";

export interface SleepStageSlice {
  key: SleepStageKey;
  label: string;
  /** Minutes in the stage, when COROS gave enough to say. */
  minutes?: number;
  /** Share of the night in bed, 0–100. */
  percent?: number;
  className: string;
}

/**
 * Listed the way COROS's own card lists them — lightest first, deepest last —
 * rather than in the order of the stacked bar, which reads bottom-up.
 */
const STAGE_ORDER: Array<{
  key: SleepStageKey;
  label: string;
  className: string;
  minutesOf: (record: TrainingHubSleepRecord) => number | undefined;
  percentOf: (record: TrainingHubSleepRecord) => number | undefined;
}> = [
  {
    key: "awake",
    label: "Awake",
    className: "is-awake",
    minutesOf: (record) => record.awakeMinutes,
    percentOf: (record) => record.awakePercent
  },
  {
    key: "rem",
    label: "REM",
    className: "is-rem",
    minutesOf: (record) => record.remMinutes,
    percentOf: (record) => record.remPercent
  },
  {
    key: "light",
    label: "Light",
    className: "is-light",
    minutesOf: (record) => record.lightMinutes,
    percentOf: (record) => record.lightPercent
  },
  {
    key: "deep",
    label: "Deep",
    className: "is-deep",
    minutesOf: (record) => record.deepMinutes,
    percentOf: (record) => record.deepPercent
  }
];

function finite(value?: number): number | undefined {
  return value !== undefined && Number.isFinite(value) ? value : undefined;
}

/**
 * The time the athlete was in bed, which is what the stage percentages are a
 * share of — COROS reports awake time as a stage, so the four add up to the
 * window rather than to the time asleep.
 *
 * `windowMinutes` is the parser's own reading of the sleep window and is
 * preferred; the stage minutes are summed only when it is missing.
 */
export function timeInBedMinutes(record: TrainingHubSleepRecord): number | undefined {
  const window = finite(record.windowMinutes);
  if (window !== undefined && window > 0) {
    return window;
  }

  const staged = STAGE_ORDER.reduce((total, stage) => {
    const minutes = finite(stage.minutesOf(record));
    return minutes !== undefined ? total + minutes : total;
  }, 0);

  if (staged > 0) {
    return staged;
  }

  const asleep = finite(record.totalMinutes);
  const awake = finite(record.awakeMinutes) ?? 0;
  return asleep !== undefined ? asleep + awake : undefined;
}

/**
 * The four stages with whatever COROS said about each. A stage missing both a
 * duration and a share is still returned — the legend says "No data" for it
 * rather than quietly dropping a row and leaving the others to imply a whole.
 */
export function stageBreakdown(record: TrainingHubSleepRecord): SleepStageSlice[] {
  const inBed = timeInBedMinutes(record);

  return STAGE_ORDER.map((stage) => {
    const minutes = finite(stage.minutesOf(record));
    const percent = finite(stage.percentOf(record));

    return {
      key: stage.key,
      label: stage.label,
      className: stage.className,
      minutes:
        minutes ??
        (percent !== undefined && inBed !== undefined
          ? Math.round((percent / 100) * inBed)
          : undefined),
      percent:
        percent ??
        (minutes !== undefined && inBed !== undefined && inBed > 0
          ? Math.round((minutes / inBed) * 1000) / 10
          : undefined)
    };
  });
}

/** The slices that can be drawn, with a positive weight for the bar and donut. */
export function drawableStages(
  record: TrainingHubSleepRecord
): Array<SleepStageSlice & { weight: number }> {
  return stageBreakdown(record)
    .map((slice) => ({
      ...slice,
      weight: slice.minutes ?? slice.percent ?? 0
    }))
    .filter((slice) => slice.weight > 0);
}

/**
 * Time asleep over time in bed, as a percentage. COROS does not send this, and
 * it is the one number a stage breakdown implies but never states.
 */
export function sleepEfficiencyPercent(
  record: TrainingHubSleepRecord
): number | undefined {
  const asleep = finite(record.totalMinutes);
  const inBed = timeInBedMinutes(record);

  if (asleep === undefined || inBed === undefined || inBed <= 0) {
    return undefined;
  }

  return Math.min(100, Math.round((asleep / inBed) * 1000) / 10);
}
