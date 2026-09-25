/**
 * One sport identity for the whole training library: every workout sport gets
 * its own colour and icon. Sports that Settings → Activity colors can recolour
 * read the customizable --sport-* tokens; the rest use fixed hues so swim,
 * ski, the climbs, and HYROX no longer share the "other" teal.
 */
import {
  Activity,
  Bike,
  Dumbbell,
  Flame,
  Hand,
  HandGrab,
  Mountain,
  Snowflake,
  Waves,
  type LucideIcon
} from "lucide-react";
import type { CSSProperties } from "react";
import type { TrainingPlanDocument, WorkoutSport } from "../../electron/types";
import { formatWorkoutSport } from "../../electron/workoutCapabilities";
import { planOriginLabel } from "./planFilters";
import { RunnerIcon } from "../running/runnerIcon";

export interface SportTheme {
  /** CSS colour — a customizable --sport-* token where one exists. */
  color: string;
  icon: LucideIcon;
}

export const WORKOUT_SPORT_THEME: Record<WorkoutSport, SportTheme> = {
  run: { color: "var(--sport-run)", icon: RunnerIcon },
  trailRun: { color: "var(--sport-trail)", icon: Mountain },
  bike: { color: "var(--sport-bike)", icon: Bike },
  swim: { color: "#38b6e8", icon: Waves },
  strength: { color: "var(--sport-strength)", icon: Dumbbell },
  xcSki: { color: "#8ab4f8", icon: Snowflake },
  indoorClimb: { color: "#f59e0b", icon: HandGrab },
  bouldering: { color: "#a78bfa", icon: Hand },
  hyrox: { color: "#ec4899", icon: Flame }
};

/** Unknown or missing sports still get a quiet identity, never a crash. */
const FALLBACK_SPORT_THEME: SportTheme = { color: "var(--sport-other)", icon: Activity };

export function sportTheme(sport: WorkoutSport | undefined): SportTheme {
  return (sport ? WORKOUT_SPORT_THEME[sport] : undefined) ?? FALLBACK_SPORT_THEME;
}

/**
 * The sport a plan is mostly made of. `distribution` counts workouts per
 * sport (from summarizeTrainingPlan); ties keep the first sport seen, and an
 * empty distribution falls back to the plan's declared mix.
 */
export function dominantSport(
  distribution: Partial<Record<WorkoutSport, number>> | undefined,
  fallback: readonly WorkoutSport[] = []
): WorkoutSport | undefined {
  let best: WorkoutSport | undefined;
  let bestCount = 0;
  if (distribution) {
    for (const [sport, count] of Object.entries(distribution) as Array<[WorkoutSport, number]>) {
      if (count > bestCount) {
        best = sport;
        bestCount = count;
      }
    }
  }
  return best ?? fallback[0];
}

/** Sets --tl-sport-accent: recolours a tile/row and everything sport-tinted inside it. */
export function sportAccentStyle(sport: WorkoutSport | undefined): CSSProperties {
  return { "--tl-sport-accent": sportTheme(sport).color } as CSSProperties;
}

/** Sets --tl-sport: tints a single chip, dot, or badge. */
export function sportChipStyle(sport: WorkoutSport | undefined): CSSProperties {
  return { "--tl-sport": sportTheme(sport).color } as CSSProperties;
}

interface SportBadgeProps {
  sport: WorkoutSport | undefined;
  /** Overrides the formatted sport name. */
  label?: string;
  /** Compact drops the pill chrome for dense list rows. */
  compact?: boolean;
}

/** Pill with the sport's icon and name, tinted in the sport's own colour. */
export function SportBadge({ sport, label, compact }: SportBadgeProps) {
  const theme = sportTheme(sport);
  const Icon = theme.icon;
  return (
    <span className={`tl-sport-badge${compact ? " is-compact" : ""}`} style={sportChipStyle(sport)}>
      <Icon size={11} strokeWidth={2.2} aria-hidden="true" />
      <span>{label ?? (sport ? formatWorkoutSport(sport) : "Workout")}</span>
    </span>
  );
}

/** A single sport as a mini icon chip. */
export function SportDot({ sport }: { sport: WorkoutSport | undefined }) {
  const theme = sportTheme(sport);
  const Icon = theme.icon;
  return (
    <span
      className="tl-sport-dot"
      style={sportChipStyle(sport)}
      title={sport ? formatWorkoutSport(sport) : undefined}
    >
      <Icon size={10} strokeWidth={2.2} aria-hidden="true" />
    </span>
  );
}

interface SportMixDotsProps {
  sports: readonly WorkoutSport[];
  /** Per-sport workout counts; sports sort most-first when provided. */
  counts?: Partial<Record<WorkoutSport, number>>;
}

/** A row of mini icon chips, one per sport in a plan's mix. */
export function SportMixDots({ sports, counts }: SportMixDotsProps) {
  if (!sports.length) return null;
  const ordered = counts
    ? [...sports].sort((left, right) => (counts[right] ?? 0) - (counts[left] ?? 0))
    : [...sports];
  const visible = ordered.slice(0, 4);
  const overflow = ordered.length - visible.length;
  return (
    <span
      className="tl-sport-dots"
      role="img"
      aria-label={ordered.map((sport) => formatWorkoutSport(sport)).join(", ")}
    >
      {visible.map((sport) => <SportDot key={sport} sport={sport} />)}
      {overflow > 0 ? <b>+{overflow}</b> : null}
    </span>
  );
}

/* The label itself lives in planFilters, beside the chip that spends it: a
   filter chip and a badge naming the same origin differently is a drift with
   nothing to catch it, and only planFilters is reachable from a test. */

/**
 * Where a plan came from, when that is worth saying — every plan is a COROS
 * plan, so the badge only speaks for one the coach wrote.
 */
export function PlanOriginBadge({
  plan,
  className
}: {
  plan: Pick<TrainingPlanDocument, "origin">;
  className?: string;
}) {
  const label = planOriginLabel(plan);
  if (!label) return null;
  return (
    <em
      className={className ? `tl-source ${className}` : "tl-source"}
      data-source={plan.origin}
    >
      {label}
    </em>
  );
}
