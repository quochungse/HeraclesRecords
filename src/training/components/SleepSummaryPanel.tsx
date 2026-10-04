import { useMemo } from "react";
import {
  ChevronRight,
  Loader2,
  MoonStar
} from "lucide-react";
import {
  formatSleepClockRange,
  formatSleepDurationMinutes,
  formatSleepNightLabel,
  formatSleepPercent,
  getLocalHappenDayKey
} from "../formatters";
import { pickLastNightSleep } from "../../sleep/sleepFreshness";
import { MCP_SLEEP_SUBJECT, mcpTextOr } from "../../mcp/mcpNotice";
import { sleepScoreLabel, sleepScoreTone } from "../../sleep/sleepScore";
import { drawableStages } from "../../sleep/sleepStages";
import {
  isNapOnlyRecord,
  isSleepDayRecord,
  totalSleepMinutes
} from "../../../electron/sleepMetrics";
import { formatNapValue, napHover } from "../../sleep/napSummary";
import { SleepMetricValue } from "../../sleep/components/SleepMetricValue";
import type { TrainingHubSleepRecord, TrainingHubSleepSummary } from "../../../electron/types";
import type { TrainingTrendPoint } from "../types";
import { buildSleepWeekTotals } from "../sleepWeekTotals";
import { SleepWeekTotals } from "./SleepWeekTotals";
import { t } from "../../i18n/core";

interface SleepSummaryPanelProps {
  sleep?: TrainingHubSleepSummary | null;
  connecting?: boolean;
  refreshing?: boolean;
  /**
   * The day-by-day metrics, where a night's HRV and resting heart rate live:
   * the sleep feed carries neither, and both are keyed by the day the athlete
   * woke up, as a night is.
   */
  points?: TrainingTrendPoint[];
  /** Opens the Sleep screen. Omitted, the panel stays a plain card. */
  onOpenDetails?: () => void;
}

function formatSleepWindow(
  record: TrainingHubSleepRecord
): { start: string; end: string } | undefined {
  const range = formatSleepClockRange(record.sleepStart, record.sleepEnd);
  if (!range) {
    return undefined;
  }

  const [start, end] = range.split(" – ");
  return start && end ? { start, end } : undefined;
}

function formatSleepMetricDuration(minutes?: number): string {
  const duration = formatSleepDurationMinutes(minutes);
  return duration === "–" ? t("overview.noData") : duration;
}

function SleepMetric({
  label,
  value,
  hover,
  area
}: {
  label: string;
  value: string | number;
  hover?: string;
  /** Its cell in the card's grid (`.sleep-panel-metrics`), where it has one. */
  area?: string;
}) {
  return (
    <div className={`sleep-metric${area ? ` is-${area}` : ""}`}>
      <dt>{label}</dt>
      <SleepMetricValue label={label} value={String(value)} hover={hover} />
    </div>
  );
}

const NO_POINTS: TrainingTrendPoint[] = [];

function formatWholeFigure(value: number | undefined, unit: string): string {
  return value !== undefined && Number.isFinite(value) && value > 0
    ? `${Math.round(value)} ${unit}`
    : t("overview.noData");
}

function SleepWindowMetric({ record }: { record: TrainingHubSleepRecord }) {
  const window = formatSleepWindow(record);

  return (
    <div className="sleep-metric is-window">
      <dt>{t("overview.sleep.window")}</dt>
      <dd
        className="sleep-window-value"
        title={window ? t("overview.sleep.windowRange", { start: window.start, end: window.end }) : t("overview.noData")}
      >
        {window ? (
          <>
            <span className="sleep-window-time">
              {window.start}
            </span>
            <span className="sleep-window-arrow" aria-hidden="true">→</span>
            <span className="sleep-window-time">
              {window.end}
            </span>
          </>
        ) : (
          t("overview.noData")
        )}
      </dd>
    </div>
  );
}

function SleepStageBar({ record }: { record: TrainingHubSleepRecord }) {
  // The same breakdown the Sleep screen draws, so one night cannot read as two
  // different splits depending on which surface you are looking at.
  const segments = drawableStages(record).map((stage) => {
    const percent =
      stage.percent !== undefined ? formatSleepPercent(stage.percent) : undefined;
    const duration =
      stage.minutes !== undefined ? formatSleepDurationMinutes(stage.minutes) : undefined;

    return {
      key: stage.key,
      label: stage.label,
      className: stage.className,
      value: stage.weight,
      // The legend states time: the minutes are COROS's own where the
      // daily-health feed has them, and the bar's widths already show the share.
      detail: duration ?? percent ?? "\u2013",
      // Hover gives both, the duration leading.
      hover:
        duration !== undefined && percent !== undefined
          ? `${duration} (${percent})`
          : duration ?? percent ?? "\u2013"
    };
  });

  if (segments.length === 0) {
    return <p className="sleep-panel-empty-stages">{t("overview.sleep.noStages")}</p>;
  }

  return (
    <div className="sleep-stage-stack">
      <div
        className="sleep-stage-bar"
        aria-label={t("overview.sleep.stageBreakdown")}
        role="list"
      >
        {segments.map((segment) => (
          <span
            key={segment.key}
            className={`sleep-stage-segment ${segment.className}`}
            style={{ flexGrow: segment.value }}
            aria-label={`${segment.label}: ${segment.hover}`}
            data-stage-label={`${segment.label}: ${segment.hover}`}
            role="listitem"
            tabIndex={0}
          />
        ))}
      </div>
      <div className="sleep-stage-legend" aria-hidden="true">
        {segments.map((segment) => (
          <span key={segment.key} className="sleep-stage-legend-item">
            <span className={`sleep-stage-legend-dot ${segment.className}`} />
            {segment.label}
            <strong>{segment.detail}</strong>
          </span>
        ))}
      </div>
    </div>
  );
}

function formatStaleNightSummary(record: TrainingHubSleepRecord): string {
  const parts = [formatSleepNightLabel(record)];

  const total = totalSleepMinutes(record);
  if (total !== undefined) {
    parts.push(formatSleepDurationMinutes(total));
  }

  if (record.score !== undefined && Number.isFinite(record.score)) {
    parts.push(t("overview.sleep.score", { score: Math.round(record.score) }));
  }

  return parts.join(" · ");
}

export function SleepSummaryPanel({
  sleep,
  connecting = false,
  refreshing = false,
  points = NO_POINTS,
  onOpenDetails
}: SleepSummaryPanelProps) {
  // Only last night's record may be shown here. `sleep.latest` is the newest
  // night COROS returned, which on an unsynced watch is days old — and read
  // under this panel's heading it becomes a score for a night that never
  // happened.
  const lastNight = pickLastNightSleep(sleep);
  // DEV-BUILD SCAFFOLD — delete to restore the rule above. A watch that has not
  // synced today leaves this card empty, which makes the Overview layout
  // impossible to judge, so a development build falls back to the newest main
  // sleep on record. The heading names that night's own date rather than "Last
  // night", so nothing on screen claims to be this morning's.
  const previewNight = import.meta.env.DEV
    ? [...(sleep?.records ?? [])]
        .filter(isSleepDayRecord)
        .sort((left, right) => right.happenDay.localeCompare(left.happenDay))[0]
    : undefined;
  const night = lastNight ?? previewNight;
  const staleNight = !night ? sleep?.latest : undefined;
  const tone = sleepScoreTone(night?.score);
  // A day the athlete only napped has no score and never will, so "Waiting"
  // would have the card waiting on something COROS is not sending.
  const napOnly = night !== undefined && isNapOnlyRecord(night);
  const label = sleepScoreLabel(
    night?.score,
    napOnly ? t("overview.sleep.napsOnly") : t("overview.recovery.waiting.label")
  );
  const isLoading = connecting || refreshing;
  const nightPoint = night
    ? points.find((point) => point.date === night.happenDay)
    : undefined;
  // The seven days end on the night shown, so the column and the card beside
  // it are about the same week.
  const endKey = night?.happenDay ?? getLocalHappenDayKey();
  const weekTotals = useMemo(
    () => buildSleepWeekTotals(sleep?.records ?? [], points, endKey),
    [sleep, points, endKey]
  );

  return (
    <section
      className={`panel sleep-panel tone-${tone}${onOpenDetails ? " is-openable" : ""}`}
      // The whole card is the target — a person reaching for "more sleep detail"
      // aims at the score, not at a link under it. Keyboard users get the real
      // button in the header, so the card itself stays out of the tab order.
      onClick={onOpenDetails}
    >
      <div className="sleep-panel-header">
        {/* Which night it is sits over the score it belongs to, not up here:
            the column of seven days beside the score is not about that night. */}
        <p className="eyebrow">{t("nav.sleep")}</p>
        {onOpenDetails ? (
          <button
            type="button"
            className="sleep-panel-open"
            onClick={(event) => {
              event.stopPropagation();
              onOpenDetails();
            }}
            aria-label={t("overview.sleep.openDetails")}
          >
            {isLoading ? (
              <Loader2 className="spin" size={16} aria-hidden="true" />
            ) : (
              <MoonStar size={16} aria-hidden="true" />
            )}
            <ChevronRight size={14} aria-hidden="true" />
          </button>
        ) : (
          <span className="sleep-panel-icon" aria-hidden="true">
            {isLoading ? <Loader2 className="spin" size={16} /> : <MoonStar size={16} />}
          </span>
        )}
      </div>

      <div className="sleep-panel-body">
        <SleepWeekTotals totals={weekTotals} />
        <div className="sleep-panel-main">
          {connecting ? (
            <p className="sleep-panel-message">{t("overview.sleep.connecting")}</p>
          ) : null}

          {!connecting && isLoading ? (
            <p className="sleep-panel-message">{t("overview.sleep.syncing")}</p>
          ) : null}

          {!isLoading && night ? (
            <>
              <div className="sleep-panel-hero">
                <div className="sleep-panel-score">
                  <h2 className="sleep-panel-night">{formatSleepNightLabel(night)}</h2>
                  <strong>{night.score !== undefined ? Math.round(night.score) : "–"}</strong>
                  <span>{label}</span>
                </div>
                <div className="sleep-panel-duration">
                  {/* The whole day's sleep. The stage bar under it is the main
                      sleep's split, which is why the naps get a row of their own. */}
                  <span>{t("overview.sleep.total")}</span>
                  <strong>{formatSleepDurationMinutes(totalSleepMinutes(night))}</strong>
                </div>
              </div>

              {napOnly ? (
                <p className="sleep-panel-empty-stages">
                  {t("overview.sleep.napsOnlyNote")}
                </p>
              ) : (
                <SleepStageBar record={night} />
              )}

              {night.completeness === "partial" ? (
                <p className="sleep-panel-partial">
                  {t("overview.sleep.partial", { reason: night.partialReason ?? t("overview.sleep.stillSyncing") })}
                </p>
              ) : null}

              <dl className="sleep-panel-metrics" aria-label={t("overview.sleep.details")}>
                <SleepWindowMetric record={night} />
                <SleepMetric
                  label={t("overview.sleep.awake")}
                  area="awake"
                  value={formatSleepMetricDuration(night.awakeMinutes)}
                />
                <SleepMetric
                  label={t("overview.sleep.wakeUps")}
                  area="wakeups"
                  value={night.awakeCountOverFiveMinutes ?? t("overview.noData")}
                />
                <SleepMetric
                  label={t("overview.sleep.naps")}
                  area="naps"
                  value={formatNapValue(night)}
                  hover={napHover(night)}
                />
                <SleepMetric
                  label={t("overview.sleep.hrv")}
                  area="hrv"
                  value={formatWholeFigure(nightPoint?.avgSleepHrv, "ms")}
                  hover={
                    nightPoint?.avgSleepHrv !== undefined &&
                    nightPoint.sleepHrvBase !== undefined &&
                    nightPoint.sleepHrvBase > 0
                      ? t("overview.sleep.hrvHover", { baseline: Math.round(nightPoint.sleepHrvBase) })
                      : undefined
                  }
                />
                <SleepMetric
                  label={t("overview.sleep.rhr")}
                  area="rhr"
                  value={formatWholeFigure(nightPoint?.rhr, "bpm")}
                />
              </dl>
            </>
          ) : null}

          {!isLoading && !night ? (
            <div className="sleep-panel-empty">
              <p className="sleep-panel-message">
                {/* Two empties that look alike and need opposite things doing:
                    MCP down is the athlete's to fix, a missing night is the
                    watch's. */}
                {mcpTextOr(
                  sleep?.mcpState,
                  MCP_SLEEP_SUBJECT,
                  t("overview.sleep.noneYet")
                )}
              </p>
              {staleNight ? (
                <p className="sleep-panel-stale">
                  {t("overview.sleep.mostRecent", { summary: formatStaleNightSummary(staleNight) })}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
