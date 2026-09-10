import { COROS_KNOWN_SPORT_TYPES } from "../../../electron/corosSportTypes";
import type {
  AnalysisThresholdMetric,
  AnalysisTrigger,
  CoachAnalysisRun
} from "../../../electron/types";

/** Sports offered in the trigger filter, in the order athletes think of them. */
export const SPORT_FILTER_OPTIONS: Array<{ value: number; label: string }> = [
  100, 102, 101, 103, 200, 204, 201, 300, 301, 402, 104, 900
].map((value) => ({
  value,
  label: COROS_KNOWN_SPORT_TYPES[value] ?? `Sport ${value}`
}));

function formatMinutes(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday"
];

/**
 * The one-line "when does this fire" copy under an analysis's name.
 *
 * `null` is the common case, not an edge: an analysis with no trigger is a
 * manual one, and that is what most start as. It answers "Manual" rather than
 * "Manual only" — there is nothing left for it to be *only*.
 */
export function describeTrigger(trigger: AnalysisTrigger | null): string {
  if (!trigger) {
    return "Manual";
  }
  if (trigger.kind === "schedule") {
    return trigger.cadence === "weekly"
      ? `Every ${WEEKDAYS[trigger.dayOfWeek ?? 1]} at ${trigger.timeOfDay}`
      : `Every day at ${trigger.timeOfDay}`;
  }

  if (trigger.kind === "activity") {
    // No sport filter means every sport, which reads better as a bare
    // "activity" than as the literal "any activity" — especially once
    // multiActivity prefixes it with "Every new".
    const subject = trigger.sportTypes.length
      ? `${trigger.sportTypes
          .map((type) => COROS_KNOWN_SPORT_TYPES[type] ?? `sport ${type}`)
          .join(", ")} activity`
      : "activity";
    const filters: string[] = [];
    if (trigger.minDurationSec) {
      filters.push(`≥ ${formatMinutes(trigger.minDurationSec)}`);
    }
    if (trigger.minDistanceM) {
      filters.push(`≥ ${(trigger.minDistanceM / 1000).toFixed(1)} km`);
    }
    const suffix = filters.length ? ` ${filters.join(" · ")}` : "";
    return trigger.multiActivity
      ? `Every new ${subject}${suffix}`
      : `New ${subject}${suffix}`;
  }

  if (trigger.kind === "threshold") {
    return describeThresholdMetric(trigger.metric, trigger.value);
  }
  return "Manual";
}

/** The four metrics of 3.3, named the way an athlete would say them. */
export const THRESHOLD_METRIC_OPTIONS: Array<{
  value: AnalysisThresholdMetric;
  label: string;
  /** What the number means, so the field never reads as a bare quantity. */
  unit: string;
  hint: string;
}> = [
  {
    value: "acuteChronicRamp",
    label: "Training load is ramping",
    unit: "% over the 4-week average",
    hint: "Last 7 days of load compared with the trailing 28-day average week."
  },
  {
    value: "restingHrDrift",
    label: "Resting heart rate is drifting up",
    unit: "bpm above baseline",
    hint: "Three days running, against the 30-day baseline before them."
  },
  {
    value: "planAdherence",
    label: "A planned workout was missed",
    unit: "hours after the day it was due",
    hint: "Counts scheduled workouts from the last two weeks with nothing matched to them."
  },
  {
    value: "sleepDebt",
    label: "Sleep debt is building",
    unit: "hours short over 7 nights",
    hint: "Against 8 hours a night, counting only the nights with a reading."
  }
];

function describeThresholdMetric(
  metric: AnalysisThresholdMetric,
  value: number
): string {
  const option = THRESHOLD_METRIC_OPTIONS.find((entry) => entry.value === metric);
  return option ? `${option.label} — ${value}${
    option.unit.startsWith("%") ? "" : " "
  }${option.unit}` : `When ${metric} crosses ${value}`;
}

const RUN_STATUS_LABELS: Record<CoachAnalysisRun["status"], string> = {
  running: "Running",
  success: "Reported",
  silent: "Nothing to report",
  skipped: "Skipped",
  failed: "Failed",
  cancelled: "Cancelled"
};

export function runStatusLabel(run: CoachAnalysisRun): string {
  return RUN_STATUS_LABELS[run.status] ?? run.status;
}

const SKIP_REASON_LABELS: Record<string, string> = {
  disabled: "switched off",
  "another-device": "ran on another device",
  "missing-session": "conversation missing",
  "no-auth": "not signed in",
  offline: "COROS unreachable",
  "two-factor-required": "COROS needs a login code",
  "quiet-hours": "quiet hours",
  cooldown: "too soon after the last run",
  budget: "monthly token budget reached",
  burst: "conversation busy",
  backoff: "backing off after a failure",
  "no-activity": "no new activity to analyse",
  "stale-slot": "missed slot"
};

export function skipReasonLabel(reason: string): string {
  return SKIP_REASON_LABELS[reason] ?? reason;
}

/** "2h ago" style, for the last-run line on a card. */
export function formatTimeAgo(iso: string | undefined): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "never";
  const minutes = Math.round((Date.now() - then) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days}d ago`;
}

/**
 * "12.4k" / "1.2M". A token count is an order-of-magnitude fact — nobody
 * budgets to the token — and 483,912 on a run-log row is six characters of
 * noise where two would do.
 */
export function formatTokens(count: number): string {
  if (!Number.isFinite(count) || count < 0) return "—";
  if (count < 1_000) return `${Math.round(count)}`;
  if (count < 1_000_000) {
    const thousands = count / 1_000;
    return `${thousands < 10 ? thousands.toFixed(1) : Math.round(thousands)}k`;
  }
  const millions = count / 1_000_000;
  return `${millions < 10 ? millions.toFixed(1) : Math.round(millions)}M`;
}

/** What one run cost, or null when the provider reported nothing. */
export function formatRunTokens(run: CoachAnalysisRun): string | null {
  if (run.inputTokens === undefined && run.outputTokens === undefined) {
    return null;
  }
  return formatTokens((run.inputTokens ?? 0) + (run.outputTokens ?? 0));
}

export function formatDuration(run: CoachAnalysisRun): string {
  if (!run.finishedAt) return "—";
  const ms = new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  return ms < 1000 ? "<1s" : `${Math.round(ms / 1000)}s`;
}
