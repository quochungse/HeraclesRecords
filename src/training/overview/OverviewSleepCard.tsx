import { MoonStar } from "lucide-react";
import { formatCount, t } from "../../i18n/core";
import { pickLastNightSleep } from "../../sleep/sleepFreshness";
import { drawableStages, stageBreakdown } from "../../sleep/sleepStages";
import { sleepScoreTone } from "../../sleep/sleepScore";
import {
  isNapOnlyRecord,
  totalSleepMinutes,
} from "../../../electron/sleepMetrics";
import {
  formatSleepClockRange,
  formatSleepDurationMinutes,
  formatSleepNightLabel,
  getLocalHappenDayKey,
} from "../formatters";
import { MCP_SLEEP_SUBJECT, mcpTextOr } from "../../mcp/mcpNotice";
import { buildSleepWeekTotals } from "../sleepWeekTotals";
import { SleepWeekTotals } from "../components/SleepWeekTotals";
import type { TrainingHubSleepSummary } from "../../../electron/types";
import type { TrainingTrendPoint } from "../types";
import {
  OverviewCardHeader,
  OverviewStat,
  overviewDate,
} from "./OverviewParts";

const STAGE_ORDER = ["awake", "light", "rem", "deep"];
const COLORS: Record<string, string> = {
  awake: "#b5a98d",
  light: "#7d86bc",
  rem: "#b5a6e5",
  deep: "#555c92",
};

export function OverviewSleepCard({
  sleep,
  points = [],
  connecting = false,
  refreshing = false,
  onOpen,
}: {
  sleep?: TrainingHubSleepSummary | null;
  points?: TrainingTrendPoint[];
  connecting?: boolean;
  refreshing?: boolean;
  onOpen?: () => void;
}) {
  const today = getLocalHappenDayKey();
  const night = pickLastNightSleep(sleep);
  const score =
    night?.score !== undefined && Number.isFinite(night.score)
      ? Math.round(night.score)
      : undefined;
  const point = points.find((p) => p.date === today);
  const duration = night ? totalSleepMinutes(night) : undefined;
  const napsOnly = night ? isNapOnlyRecord(night) : false;
  const stages = night
    ? drawableStages(night).sort(
        (a, b) => STAGE_ORDER.indexOf(a.key) - STAGE_ORDER.indexOf(b.key),
      )
    : [];
  const legend = night
    ? stageBreakdown(night).sort(
        (a, b) => STAGE_ORDER.indexOf(a.key) - STAGE_ORDER.indexOf(b.key),
      )
    : [];
  const total = stages.reduce((sum, s) => sum + s.weight, 0);
  const circumference = 2 * Math.PI * 64;
  const totals = buildSleepWeekTotals(sleep?.records ?? [], points, today);
  let offset = 0;
  const validVital = (value?: number) =>
    value !== undefined && Number.isFinite(value) && value > 0
      ? value
      : undefined;
  const hrv = validVital(point?.avgSleepHrv);
  const rhr = validVital(point?.rhr);
  const vital = (value?: number) => value !== undefined ? formatCount(Math.round(value)) : "—";
  return (
    <section
      className={`panel overview-sleep tone-${sleepScoreTone(score)}`}
      aria-busy={connecting || refreshing}
    >
      <OverviewCardHeader
        title={t("nav.sleep")}
        icon={<MoonStar size={14} />}
        onOpen={onOpen}
      />
      <div className="overview-sleep-day">
        <span>
          {t("overview.today")} · {overviewDate(today)}
        </span>
        <div
          className="overview-sleep-score"
          aria-label={t("overview.sleep.score", { score: score ?? "—" })}
        >
          <span>{t("sleep.trend.score")}</span>
          <strong>{score ?? "—"}</strong>
        </div>
      </div>
      {night ? (
        <div className="overview-sleep-breakdown">
          <div className="overview-sleep-chart-column">
            <div
              className="overview-sleep-ring"
              role="img"
              aria-label={`${t("overview.sleep.stageBreakdown")} · ${formatSleepDurationMinutes(duration)}`}
            >
              <svg viewBox="0 0 160 160" aria-hidden="true">
                <circle
                  cx="80"
                  cy="80"
                  r="64"
                  fill="none"
                  stroke="var(--glass-border)"
                  strokeWidth="11"
                />
                {stages.map((s) => {
                  const arc = (s.weight / total) * circumference,
                    start = offset;
                  offset += arc;
                  return (
                    <circle
                      key={s.key}
                      cx="80"
                      cy="80"
                      r="64"
                      fill="none"
                      stroke={COLORS[s.key]}
                      strokeWidth="11"
                      strokeDasharray={`${Math.max(0, arc - 3)} ${circumference}`}
                      strokeDashoffset={-start}
                      transform="rotate(-90 80 80)"
                    />
                  );
                })}
              </svg>
              <div>
                <strong>{formatSleepDurationMinutes(duration)}</strong>
                <span>
                  {napsOnly
                    ? t("overview.sleep.napsOnly")
                    : t("overview.sleep.total")}
                </span>
              </div>
            </div>
            <p className="overview-caption">
              {formatSleepClockRange(night.sleepStart, night.sleepEnd) ??
                t("overview.noData")}
            </p>
          </div>
          <div className="overview-sleep-right">
            <div className="overview-sleep-vitals">
              <OverviewStat
                label={t("overview.briefing.overnightHrv")}
                value={vital(hrv)}
                unit={hrv !== undefined ? "ms" : undefined}
              />
              <OverviewStat
                label={t("overview.briefing.restingHr")}
                value={vital(rhr)}
                unit={rhr !== undefined ? "bpm" : undefined}
              />
            </div>
            <div className="overview-sleep-stages">
              {stages.length === 0 ? (
                <p className="overview-caption">{napsOnly ? t("overview.sleep.napsOnlyNote") : t("overview.sleep.noStages")}</p>
              ) : legend.map((s) => (
                <div key={s.key}>
                  <i style={{ background: COLORS[s.key] }} />
                  <span>{s.label}</span>
                  <strong>
                    {s.minutes !== undefined
                      ? formatSleepDurationMinutes(s.minutes)
                      : t("overview.noData")}
                  </strong>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="overview-empty" role="status">
          <p>
            {connecting
              ? t("overview.sleep.connecting")
              : refreshing
                ? t("overview.sleep.syncing")
                : mcpTextOr(
                    sleep?.mcpState,
                    MCP_SLEEP_SUBJECT,
                    t("overview.sleep.noneYet"),
                  )}
          </p>
          {sleep?.latest && (
            <p>
              {t("overview.sleep.mostRecent", {
                summary: formatSleepNightLabel(sleep.latest),
              })}
            </p>
          )}
        </div>
      )}
      {night?.completeness === "partial" && (
        <p className="overview-caption">
          {t("overview.sleep.partial", {
            reason: night.partialReason ?? t("overview.sleep.stillSyncing"),
          })}
        </p>
      )}
      {!napsOnly && (night?.napMinutes ?? 0) > 0 && (
        <p className="overview-caption">
          {t("overview.sleep.naps")}:{" "}
          {formatSleepDurationMinutes(night?.napMinutes)}
        </p>
      )}
      <SleepWeekTotals totals={totals} showAverageRhr={false} />
    </section>
  );
}
