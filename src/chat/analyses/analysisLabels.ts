import { countedTokens } from "../../../electron/tokenUsage";
import { formatDistanceValue, type UnitSystem } from "../../units/units";
import type {
  AnalysisThresholdMetric,
  AnalysisTrigger,
  CoachAnalysisRun
} from "../../../electron/types";
import { formatDecimal, messageRecord, plural, t, weekdayNames, type MessageKey } from "../../i18n/core";
import { knownSportName } from "../../training/sportTypes";

/** Sports offered in the trigger filter, in the order athletes think of them. */
export const SPORT_FILTER_OPTIONS: ReadonlyArray<{ value: number; readonly label: string }> = [
  100, 102, 101, 103, 200, 204, 201, 300, 301, 402, 104, 900
].map((value) => ({
  value,
  get label() {
    return sportName(value);
  }
}));

function sportName(code: number): string {
  return knownSportName(code) ?? t("chat.an.sportN", { n: code });
}

function formatMinutes(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return t("units.min", { m: minutes });
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? t("units.duration.hm", { h: hours, m: rest }) : t("units.duration.h", { h: hours });
}

/** A COROS day of the week (0 = Sunday) by its name in the language on screen. */
export function weekdayName(dayOfWeek: number): string {
  return weekdayNames("long")[(dayOfWeek + 6) % 7] ?? "";
}

/**
 * The one-line "when does this fire" copy under an analysis's name.
 *
 * `null` is the common case, not an edge: an analysis with no trigger is a
 * manual one, and that is what most start as. It answers "Manual" rather than
 * "Manual only" — there is nothing left for it to be *only*.
 */
export function describeTrigger(
  trigger: AnalysisTrigger | null,
  unitSystem: UnitSystem = "metric"
): string {
  if (!trigger) {
    return t("chat.an.trigger.manual");
  }
  if (trigger.kind === "schedule") {
    return trigger.cadence === "weekly"
      ? t("chat.an.trigger.weekly", { day: weekdayName(trigger.dayOfWeek ?? 1), time: trigger.timeOfDay })
      : t("chat.an.trigger.daily", { time: trigger.timeOfDay });
  }

  if (trigger.kind === "activity") {
    // No sport filter means every sport, which reads better as a bare
    // "activity" than as the literal "any activity" — especially once
    // multiActivity prefixes it with "Every new".
    const sports = trigger.sportTypes.map(sportName).join(", ");
    const filters: string[] = [];
    if (trigger.minDurationSec) {
      filters.push(`≥ ${formatMinutes(trigger.minDurationSec)}`);
    }
    if (trigger.minDistanceM) {
      filters.push(`≥ ${formatDistanceValue(trigger.minDistanceM, unitSystem, { digits: 1 })}`);
    }
    const suffix = filters.length ? ` ${filters.join(" · ")}` : "";
    const key = trigger.multiActivity
      ? sports
        ? "chat.an.trigger.everySports"
        : "chat.an.trigger.everyAny"
      : sports
        ? "chat.an.trigger.newSports"
        : "chat.an.trigger.newAny";
    return `${t(key, { sports })}${suffix}`;
  }

  if (trigger.kind === "threshold") {
    return describeThresholdMetric(trigger.metric, trigger.value);
  }
  return t("chat.an.trigger.manual");
}

/** The four metrics of 3.3, named the way an athlete would say them. */
export const THRESHOLD_METRIC_OPTIONS: ReadonlyArray<{
  value: AnalysisThresholdMetric;
  readonly label: string;
  /** What the number means, so the field never reads as a bare quantity. */
  readonly unit: string;
  readonly hint: string;
}> = (["acuteChronicRamp", "restingHrDrift", "planAdherence", "sleepDebt"] as const).map((value) => ({
  value,
  get label() {
    return t(`chat.an.metric.${value}` as MessageKey);
  },
  get unit() {
    return t(`chat.an.metric.${value}.unit` as MessageKey);
  },
  get hint() {
    return t(`chat.an.metric.${value}.hint` as MessageKey);
  }
}));

function describeThresholdMetric(
  metric: AnalysisThresholdMetric,
  value: number
): string {
  const option = THRESHOLD_METRIC_OPTIONS.find((entry) => entry.value === metric);
  return option ? `${option.label} — ${value}${
    option.unit.startsWith("%") ? "" : " "
  }${option.unit}` : t("chat.an.metric.crosses", { metric, value });
}

const RUN_STATUS_LABELS = messageRecord<CoachAnalysisRun["status"]>({
  running: "chat.an.run.running",
  success: "chat.an.run.success",
  silent: "chat.an.run.silent",
  skipped: "chat.an.run.skipped",
  failed: "chat.an.run.failed",
  cancelled: "chat.an.run.cancelled"
});

export function runStatusLabel(run: CoachAnalysisRun): string {
  return RUN_STATUS_LABELS[run.status] ?? run.status;
}

const SKIP_REASON_KEYS: Record<string, MessageKey> = {
  disabled: "chat.an.skip.disabled",
  "another-device": "chat.an.skip.anotherDevice",
  "missing-session": "chat.an.skip.missingSession",
  "no-auth": "chat.an.skip.noAuth",
  offline: "chat.an.skip.offline",
  "two-factor-required": "chat.an.skip.twoFactor",
  "quiet-hours": "chat.an.skip.quietHours",
  cooldown: "chat.an.skip.cooldown",
  budget: "chat.an.skip.budget",
  burst: "chat.an.skip.burst",
  backoff: "chat.an.skip.backoff",
  "no-activity": "chat.an.skip.noActivity",
  "stale-slot": "chat.an.skip.staleSlot"
};

export function skipReasonLabel(reason: string): string {
  const key = Object.hasOwn(SKIP_REASON_KEYS, reason) ? SKIP_REASON_KEYS[reason] : undefined;
  return key ? t(key) : reason;
}

/** "2h ago" style, for the last-run line on a card. */
export function formatTimeAgo(iso: string | undefined): string {
  if (!iso) return t("chat.an.ago.never");
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return t("chat.an.ago.never");
  const minutes = Math.round((Date.now() - then) / 60_000);
  if (minutes < 1) return t("chat.an.ago.now");
  if (minutes < 60) return t("chat.an.ago.minutes", { n: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t("chat.an.ago.hours", { n: hours });
  const days = Math.round(hours / 24);
  return days === 1 ? t("chat.an.ago.yesterday") : plural("chat.an.ago.days", days);
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
    return `${thousands < 10 ? formatDecimal(thousands, 1) : Math.round(thousands)}k`;
  }
  const millions = count / 1_000_000;
  return `${millions < 10 ? formatDecimal(millions, 1) : Math.round(millions)}M`;
}

/** What one run cost, or null when the provider reported nothing. */
export function formatRunTokens(run: CoachAnalysisRun): string | null {
  if (run.inputTokens === undefined && run.outputTokens === undefined) {
    return null;
  }
  return formatTokens(
    countedTokens({
      inputTokens: run.inputTokens ?? 0,
      outputTokens: run.outputTokens ?? 0,
      cacheReadTokens: run.cacheReadTokens
    })
  );
}

export function formatDuration(run: CoachAnalysisRun): string {
  if (!run.finishedAt) return "—";
  const ms = new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  return ms < 1000 ? `<${t("units.duration.s", { s: 1 })}` : t("units.duration.s", { s: Math.round(ms / 1000) });
}
