/**
 * The plan's weeks as one row of bars, each a way to get to its week.
 *
 * The reader drew the tile's ridge — 4px bars, 26px tall — above a list of
 * week cards, so the one picture of the plan's shape was the smallest thing
 * on the page and did nothing when pressed. A twelve-week plan is a long
 * scroll, and the question "what is week 9" was answered by scrolling to it.
 * Here each week is a button the height of its load, the week being trained
 * is marked, and the week stages run underneath as a band, so where a block starts
 * and ends is read off the same axis as how hard it is.
 *
 * **What a bar measures is chosen, not assumed** (`ridgeMeasure`): load where
 * every week of training has some, hours where every one is timed, sessions
 * otherwise — a plan of unpriced library workouts drew one bar and eleven
 * stubs under "Weekly load". **And a bar is split by sport**, in the hues the
 * sessions below it wear, with a legend once there is more than one.
 *
 * Only past two weeks: a plan of one or two weeks is on the screen whole
 * already, and a chart of two bars is a comparison, not a shape.
 */
import { formatWorkoutSport } from "../../electron/workoutCapabilities";
import {
  RIDGE_CAPTIONS as CAPTIONS,
  RIDGE_UNITS as UNITS,
  formatRidgeValue as formatValue,
  ridgeMeasure,
  weekRidgeSegments,
  type PlanReaderWeek
} from "./planReaderModel";
import { sportChipStyle } from "./sportTheme";

interface PlanWeekRidgeProps {
  weeks: readonly PlanReaderWeek[];
  /** 0-based week being trained today, when the plan is running. */
  currentWeek?: number;
  onJump: (weekIndex: number) => void;
}

/** Bars below this share of the tallest still get a visible stub. */
const MINIMUM_SHARE = 0.06;
/** The tallest bar, in pixels: a height a percentage could not be taken of
    inside a button that also holds the week's number. */
const BAR_MAX = 80;

export function PlanWeekRidge({ weeks, currentWeek, onJump }: PlanWeekRidgeProps) {
  const measure = ridgeMeasure(weeks);
  const stacks = weeks.map((week) => weekRidgeSegments(week, measure));
  const values = stacks.map((segments) => segments.reduce((sum, segment) => sum + segment.value, 0));
  const peak = Math.max(0, ...values);
  const sports = [...new Map(stacks.flat().map((segment) => [segment.sport, segment])).keys()];
  /* Every number fits up to sixteen weeks; past that, every fourth and the last. */
  const labelled = (index: number) =>
    weeks.length <= 16 || index % 4 === 0 || index === weeks.length - 1;

  /* Consecutive weeks in one stage are one segment of the band, spanning the
     same grid columns as their bars so an edge falls between two weeks. */
  const segments: Array<{ name?: string; slug?: string; span: number; start: number }> = [];
  weeks.forEach((week, index) => {
    const last = segments[segments.length - 1];
    if (last && last.slug === week.stageSlug) last.span += 1;
    else segments.push({ name: week.stage, slug: week.stageSlug, span: 1, start: index });
  });
  const hasStages = segments.some((segment) => segment.name);
  const unit = UNITS[measure];

  return (
    <div
      className="plan-ridge"
      style={{ "--plan-ridge-weeks": weeks.length } as React.CSSProperties}
    >
      <div className="plan-ridge-caption">
        <span>{CAPTIONS[measure]}</span>
        <b>{formatValue(peak, measure)}</b>
        <small>peak</small>
        {sports.length > 1 ? (
          <span className="plan-ridge-legend">
            {sports.map((sport) => (
              <span key={sport ?? "other"} style={sportChipStyle(sport)}>
                {sport ? formatWorkoutSport(sport) : "Other"}
              </span>
            ))}
          </span>
        ) : null}
      </div>
      <div
        className="plan-ridge-bars"
        role="group"
        aria-label={`${CAPTIONS[measure]} across ${weeks.length} weeks`}
      >
        {weeks.map((week, index) => {
          const value = values[index];
          const share = peak > 0 ? value / peak : 0;
          const current = index === currentWeek;
          const breakdown =
            stacks[index].length > 1
              ? ` (${stacks[index]
                  .map((segment) => `${segment.sport ? formatWorkoutSport(segment.sport) : "Other"} ${formatValue(segment.value, measure)}`)
                  .join(", ")})`
              : "";
          const label =
            `Week ${index + 1}${week.stage ? `, ${week.stage}` : ""}: ` +
            `${formatValue(value, measure)} ${unit}${breakdown}${current ? ", this week" : ""}`;
          return (
            <button
              type="button"
              key={week.weekIndex}
              className={`plan-ridge-week${current ? " is-current" : ""}${value > 0 ? "" : " is-empty"}`}
              aria-label={label}
              title={label}
              onClick={() => onJump(index)}
            >
              <span
                className="plan-ridge-bar"
                style={{
                  "--plan-bar-height":
                    value > 0 ? `${Math.round(Math.max(share, MINIMUM_SHARE) * BAR_MAX)}px` : "2px"
                } as React.CSSProperties}
              >
                {stacks[index].map((segment) => (
                  <span
                    key={segment.sport ?? "other"}
                    className="plan-ridge-seg"
                    style={{ ...sportChipStyle(segment.sport), flexGrow: segment.value }}
                  />
                ))}
              </span>
              <small aria-hidden="true">{labelled(index) ? index + 1 : ""}</small>
            </button>
          );
        })}
      </div>
      {hasStages ? (
        <div className="plan-ridge-stages" aria-hidden="true">
          {segments.map((segment) => (
            <span
              key={segment.start}
              className="plan-ridge-stage"
              data-stage={segment.slug}
              style={{ gridColumn: `span ${segment.span}` }}
              title={segment.name}
            >
              {segment.name ?? ""}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
