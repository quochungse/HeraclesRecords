import {
  ChevronRight,
  Loader2,
  Moon,
  MoonStar,
  Sunrise
} from "lucide-react";
import {
  formatSleepClockRange,
  formatSleepDurationMinutes,
  formatSleepNightLabel,
  formatSleepPercent
} from "../formatters";
import { pickLastNightSleep } from "../../sleep/sleepFreshness";
import { MCP_SLEEP_NOTICE, mcpTextOr } from "../../mcp/mcpNotice";
import { sleepScoreLabel, sleepScoreTone } from "../../sleep/sleepScore";
import { drawableStages } from "../../sleep/sleepStages";
import type { TrainingHubSleepRecord, TrainingHubSleepSummary } from "../../../electron/types";

interface SleepSummaryPanelProps {
  sleep?: TrainingHubSleepSummary | null;
  connecting?: boolean;
  refreshing?: boolean;
  /** Opens the Sleep screen. Omitted, the panel stays a plain card. */
  onOpenDetails?: () => void;
}

function formatNapSummary(record: TrainingHubSleepRecord): string {
  if (record.napMinutes === undefined) {
    return "No data";
  }

  return formatSleepDurationMinutes(record.napMinutes);
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
  value
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="sleep-metric">
      <dt>{label}</dt>
      <dd title={String(value)}>{value}</dd>
    </div>
  );
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
              <Moon size={13} strokeWidth={2} aria-hidden="true" />
              {window.start}
            </span>
            <span className="sleep-window-arrow" aria-hidden="true">→</span>
            <span className="sleep-window-time">
              <Sunrise size={13} strokeWidth={2} aria-hidden="true" />
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
  const segments = drawableStages(record).map((stage) => ({
    key: stage.key,
    label: stage.label,
    className: stage.className,
    value: stage.weight,
    detail:
      stage.percent !== undefined
        ? formatSleepPercent(stage.percent)
        : formatSleepDurationMinutes(stage.minutes)
  }));

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
            aria-label={`${segment.label}: ${segment.detail}`}
            data-stage-label={`${segment.label}: ${segment.detail}`}
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

  if (record.totalMinutes !== undefined && Number.isFinite(record.totalMinutes)) {
    parts.push(formatSleepDurationMinutes(record.totalMinutes));
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
        .filter((record) => record.kind !== "nap")
        .sort((left, right) => right.happenDay.localeCompare(left.happenDay))[0]
    : undefined;
  const night = lastNight ?? previewNight;
  const staleNight = !night ? sleep?.latest : undefined;
  const tone = sleepScoreTone(night?.score);
  const label = sleepScoreLabel(night?.score, "Waiting");
  const isLoading = connecting || refreshing;

  return (
    <section
      className={`panel sleep-panel tone-${tone}${onOpenDetails ? " is-openable" : ""}`}
      // The whole card is the target — a person reaching for "more sleep detail"
      // aims at the score, not at a link under it. Keyboard users get the real
      // button in the header, so the card itself stays out of the tab order.
      onClick={onOpenDetails}
    >
      <div className="sleep-panel-header">
        <div>
          <p className="eyebrow">Sleep</p>
          <h2>{night ? formatSleepNightLabel(night) : "Last night"}</h2>
        </div>
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
              <strong>{night.score !== undefined ? Math.round(night.score) : "–"}</strong>
              <span>{label}</span>
            </div>
            <div className="sleep-panel-duration">
              <span>Main sleep</span>
              <strong>{formatSleepDurationMinutes(night.totalMinutes)}</strong>
            </div>
          </div>

          <SleepStageBar record={night} />

          {night.completeness === "partial" ? (
            <p className="sleep-panel-partial">
              Partial data: {night.partialReason ?? "COROS is still syncing this sleep."}
            </p>
          ) : null}

          <dl className="sleep-panel-metrics" aria-label="Sleep details">
            <SleepWindowMetric record={night} />
            <SleepMetric
              label="Awake"
              value={formatSleepMetricDuration(night.awakeMinutes)}
            />
            <SleepMetric
              label="Wake-ups > 5m"
              value={night.awakeCountOverFiveMinutes ?? "No data"}
            />
            <SleepMetric
              label="Naps"
              value={formatNapSummary(night)}
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
              sleep?.mcpConnected,
              MCP_SLEEP_NOTICE,
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
    </section>
  );
}
