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
  return duration === "–" ? "No data" : duration;
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
    : "No data";
}

function SleepWindowMetric({ record }: { record: TrainingHubSleepRecord }) {
  const window = formatSleepWindow(record);

  return (
    <div className="sleep-metric is-window">
      <dt>Sleep window</dt>
      <dd
        className="sleep-window-value"
        title={window ? `${window.start} to ${window.end}` : "No data"}
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
          "No data"
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
    return <p className="sleep-panel-empty-stages">Stage breakdown unavailable.</p>;
  }

  return (
    <div className="sleep-stage-stack">
      <div
        className="sleep-stage-bar"
        aria-label="Sleep stage breakdown"
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
    parts.push(`score ${Math.round(record.score)}`);
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
  const label = sleepScoreLabel(night?.score, napOnly ? "Naps only" : "Waiting");
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
        <p className="eyebrow">Sleep</p>
        {onOpenDetails ? (
          <button
            type="button"
            className="sleep-panel-open"
            onClick={(event) => {
              event.stopPropagation();
              onOpenDetails();
            }}
            aria-label="Open sleep details"
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
            <p className="sleep-panel-message">Connecting COROS data access…</p>
          ) : null}

          {!connecting && isLoading ? (
            <p className="sleep-panel-message">Syncing sleep data…</p>
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
                  <span>Total sleep</span>
                  <strong>{formatSleepDurationMinutes(totalSleepMinutes(night))}</strong>
                </div>
              </div>

              {napOnly ? (
                <p className="sleep-panel-empty-stages">
                  Naps only — COROS reports no score or stages for a day without a
                  main sleep.
                </p>
              ) : (
                <SleepStageBar record={night} />
              )}

              {night.completeness === "partial" ? (
                <p className="sleep-panel-partial">
                  Partial data: {night.partialReason ?? "COROS is still syncing this sleep."}
                </p>
              ) : null}

              <dl className="sleep-panel-metrics" aria-label="Sleep details">
                <SleepWindowMetric record={night} />
                <SleepMetric
                  label="Awake"
                  area="awake"
                  value={formatSleepMetricDuration(night.awakeMinutes)}
                />
                <SleepMetric
                  label="Wake-ups > 5m"
                  area="wakeups"
                  value={night.awakeCountOverFiveMinutes ?? "No data"}
                />
                <SleepMetric
                  label="Naps"
                  area="naps"
                  value={formatNapValue(night)}
                  hover={napHover(night)}
                />
                <SleepMetric
                  label="HRV"
                  area="hrv"
                  value={formatWholeFigure(nightPoint?.avgSleepHrv, "ms")}
                  hover={
                    nightPoint?.avgSleepHrv !== undefined &&
                    nightPoint.sleepHrvBase !== undefined &&
                    nightPoint.sleepHrvBase > 0
                      ? `Overnight average · baseline ${Math.round(nightPoint.sleepHrvBase)} ms`
                      : undefined
                  }
                />
                <SleepMetric
                  label="RHR"
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
                  "No sleep recorded for last night yet. Sync your watch to see it here."
                )}
              </p>
              {staleNight ? (
                <p className="sleep-panel-stale">
                  Most recent night on record: {formatStaleNightSummary(staleNight)}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
