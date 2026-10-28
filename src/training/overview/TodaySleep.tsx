import { useMemo } from "react";
import { ArrowUpRight, Loader2 } from "lucide-react";
import type { TrainingHubSleepRecord, TrainingHubSleepSummary } from "../../../electron/types";
import { isNapOnlyRecord, isSleepDayRecord, totalSleepMinutes } from "../../../electron/sleepMetrics";
import { pickLastNightSleep } from "../../sleep/sleepFreshness";
import { sleepScoreLabel, sleepScoreTone } from "../../sleep/sleepScore";
import { drawableStages } from "../../sleep/sleepStages";
import { MCP_SLEEP_SUBJECT, mcpTextOr } from "../../mcp/mcpNotice";
import {
  formatSleepClockRange,
  formatSleepDurationMinutes,
  formatSleepNightLabel,
  getLocalHappenDayKey
} from "../formatters";
import { happenDayToDate } from "../parsers";
import { buildSleepWeekTotals, SLEEP_WEEK_DAYS } from "../sleepWeekTotals";
import type { TrainingTrendPoint } from "../types";
import { getIntlLocale, t } from "../../i18n/core";
import { useI18n } from "../../i18n/useI18n";

const NO_POINTS: TrainingTrendPoint[] = [];

/** Deep first, as a night is read; the ring and the list go round the same way. */
const STAGE_ORDER = ["deep", "light", "rem", "awake"];

function previousDay(day: Date): Date {
  const before = new Date(day);
  before.setDate(day.getDate() - 1);
  return before;
}

/**
 * The night as the two days it spans — "Oct 23 → 24" — in the app's language.
 * `formatRange` folds the shared month into one, and its dash between the two
 * days becomes the arrow a night is read with.
 */
function nightDates(record: TrainingHubSleepRecord): string {
  const end = happenDayToDate(record.happenDay);
  if (!end) {
    return formatSleepNightLabel(record);
  }
  const start = (record.sleepStartDay && happenDayToDate(record.sleepStartDay)) || previousDay(end);
  const format = new Intl.DateTimeFormat(getIntlLocale(), { month: "short", day: "numeric" });
  if (start.getTime() >= end.getTime()) {
    return format.format(end);
  }
  return format
    .formatRangeToParts(start, end)
    .map((part) =>
      part.source === "shared" && part.type === "literal" && /[–—~～-]/.test(part.value)
        ? " → "
        : part.value
    )
    .join("");
}

function formatWholeMinutes(minutes: number | undefined): string {
  return minutes !== undefined && minutes > 0 ? formatSleepDurationMinutes(minutes) : "–";
}

function SleepRing({ record }: { record: TrainingHubSleepRecord }) {
  const slices = drawableStages(record).sort(
    (left, right) => STAGE_ORDER.indexOf(left.key) - STAGE_ORDER.indexOf(right.key)
  );
  const total = slices.reduce((sum, slice) => sum + slice.weight, 0);
  const radius = 48;
  const circumference = 2 * Math.PI * radius;
  // A hairline of the panel between slices, so two dark stages stay countable.
  const gap = 2;
  let offset = 0;

  return (
    <svg className="overview-sleep-ring" viewBox="0 0 120 120" aria-hidden="true">
      <circle className="overview-sleep-ring-track" cx="60" cy="60" r={radius} />
      {total > 0
        ? slices.map((slice) => {
            const length = (slice.weight / total) * circumference;
            const dash = Math.max(0, length - gap);
            const start = offset;
            offset += length;
            return (
              <circle
                key={slice.key}
                cx="60"
                cy="60"
                r={radius}
                style={{ stroke: `var(--sleep-${slice.key})` }}
                strokeDasharray={`${dash} ${circumference}`}
                strokeDashoffset={-start}
                transform="rotate(-90 60 60)"
              />
            );
          })
        : null}
      <text className="overview-sleep-ring-figure" x="60" y="61">
        {formatWholeMinutes(record.totalMinutes)}
      </text>
      <text className="overview-sleep-ring-caption" x="60" y="78">
        {t("overview.today.asleep")}
      </text>
    </svg>
  );
}

function SleepStages({ record }: { record: TrainingHubSleepRecord }) {
  const slices = drawableStages(record).sort(
    (left, right) => STAGE_ORDER.indexOf(left.key) - STAGE_ORDER.indexOf(right.key)
  );
  return (
    <dl className="overview-sleep-stages" aria-label={t("overview.today.stages")}>
      {slices.map((slice) => (
        <div key={slice.key}>
          <dt>
            <i style={{ background: `var(--sleep-${slice.key})` }} aria-hidden="true" />
            {slice.label}
          </dt>
          <dd className="figure">{formatWholeMinutes(slice.minutes)}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The newest night on record, said beside a column that has none for last night. */
function staleNightSummary(record: TrainingHubSleepRecord): string {
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

function roundOr(value: number | undefined): string {
  return value !== undefined && Number.isFinite(value) && value > 0 ? String(Math.round(value)) : "–";
}

/**
 * Last night, as the Readiness panel's middle column: the score in COROS's
 * words and the night's two recovery figures, the stages round a ring with
 * the night's clock under it, and the seven days the night ends.
 *
 * The heart rate is the one slept at (the sleep record's average), never
 * COROS's daytime resting HR: a resting figure moves with the whole day, a
 * night's does not.
 */
export function TodaySleep({
  sleep,
  points = NO_POINTS,
  connecting = false,
  refreshing = false,
  onOpenDetails
}: {
  sleep?: TrainingHubSleepSummary | null;
  points?: TrainingTrendPoint[];
  connecting?: boolean;
  refreshing?: boolean;
  onOpenDetails?: () => void;
}) {
  useI18n();
  // Only last night may be shown under this heading: `sleep.latest` is the
  // newest night COROS returned, which on an unsynced watch is days old.
  const lastNight = pickLastNightSleep(sleep);
  // DEV-BUILD SCAFFOLD, as on the Sleep card this replaced: a watch that has
  // not synced today leaves the column empty, which makes the layout
  // impossible to judge, so a development build falls back to the newest main
  // sleep on record. The dates name that night's own days.
  const previewNight = import.meta.env.DEV
    ? [...(sleep?.records ?? [])]
        .filter(isSleepDayRecord)
        .sort((left, right) => right.happenDay.localeCompare(left.happenDay))[0]
    : undefined;
  const night = lastNight ?? previewNight;
  const staleNight = !night ? sleep?.latest : undefined;
  const napOnly = night !== undefined && isNapOnlyRecord(night);
  const score = night?.score !== undefined && Number.isFinite(night.score) ? Math.round(night.score) : undefined;
  const tone = sleepScoreTone(score);
  const nightPoint = night ? points.find((point) => point.date === night.happenDay) : undefined;
  const busy = connecting || refreshing;
  const endKey = night?.happenDay ?? getLocalHappenDayKey();
  const week = useMemo(
    () => buildSleepWeekTotals(sleep?.records ?? [], points, endKey),
    [sleep, points, endKey]
  );
  const clock = night ? formatSleepClockRange(night.sleepStart, night.sleepEnd) : undefined;

  return (
    <>
      <div className="overview-today-cell overview-today-head is-sleep">
        <p className="eyebrow">{t("nav.sleep")}</p>
        {night ? <span className="overview-today-date">{nightDates(night)}</span> : null}
        {onOpenDetails ? (
          <button
            type="button"
            className="overview-today-open"
            onClick={onOpenDetails}
            aria-label={t("overview.sleep.openDetails")}
            title={t("overview.sleep.openDetails")}
          >
            {busy ? (
              <Loader2 className="spin" size={15} aria-hidden="true" />
            ) : (
              <ArrowUpRight size={15} aria-hidden="true" />
            )}
          </button>
        ) : null}
      </div>

      {night ? (
        <>
          <dl className="overview-today-cell overview-today-hero is-sleep">
            <div className="overview-today-lead">
              <dt>{t("overview.today.sleepScore")}</dt>
              <dd className={`overview-sleep-score tone-${tone}`}>
                <span className="figure">{score ?? "–"}</span>
                {score !== undefined ? <span className="overview-sleep-band">{sleepScoreLabel(score)}</span> : null}
              </dd>
            </div>
            <i className="overview-today-rule" aria-hidden="true" />
            <div>
              <dt>{t("overview.today.overnightHrv")}</dt>
              <dd>
                <span className="figure">{roundOr(nightPoint?.avgSleepHrv)}</span>
                <span className="overview-today-unit">ms</span>
              </dd>
            </div>
            <div>
              <dt>{t("overview.today.sleepHr")}</dt>
              <dd>
                <span className="figure">{roundOr(night.avgHr)}</span>
                <span className="overview-today-unit">bpm</span>
              </dd>
            </div>
          </dl>

          <div className="overview-today-cell overview-today-vis is-sleep">
            {napOnly ? (
              <p className="overview-today-note">{t("overview.sleep.napsOnlyNote")}</p>
            ) : (
              <>
                <div className="overview-sleep-night">
                  <SleepRing record={night} />
                  {clock ? <p className="overview-sleep-clock figure">{clock}</p> : null}
                </div>
                <div className="overview-sleep-side">
                  <SleepStages record={night} />
                  {night.completeness === "partial" ? (
                    <p className="overview-today-note">
                      {t("overview.sleep.partial", {
                        reason: night.partialReason ?? t("overview.sleep.stillSyncing")
                      })}
                    </p>
                  ) : null}
                </div>
              </>
            )}
          </div>
        </>
      ) : (
        <div className="overview-today-cell overview-today-body is-sleep">
          <p className="overview-today-message">
            {connecting
              ? t("overview.sleep.connecting")
              : refreshing
                ? t("overview.sleep.syncing")
                : mcpTextOr(sleep?.mcpState, MCP_SLEEP_SUBJECT, t("overview.sleep.noneYet"))}
          </p>
          {staleNight && !busy ? (
            <p className="overview-today-note">
              {t("overview.sleep.mostRecent", { summary: staleNightSummary(staleNight) })}
            </p>
          ) : null}
        </div>
      )}

      <div className="overview-today-cell overview-today-foot is-sleep">
        <p className="eyebrow">{t("overview.sleepTrend.lastDays", { days: SLEEP_WEEK_DAYS })}</p>
        <dl>
          <div>
            <dt>{t("overview.sleepWeek.avgSleep")}</dt>
            <dd className="figure">{formatWholeMinutes(week.avgSleepMinutes)}</dd>
          </div>
          <div>
            <dt>{t("overview.sleepWeek.avgScore")}</dt>
            <dd className="figure">{roundOr(week.avgScore)}</dd>
          </div>
          <div>
            <dt>{t("overview.sleepWeek.hrvRange")}</dt>
            <dd>
              <span className="figure">
                {week.hrvMin !== undefined && week.hrvMax !== undefined
                  ? `${Math.round(week.hrvMin)}–${Math.round(week.hrvMax)}`
                  : "–"}
              </span>
              {week.hrvMin !== undefined ? <span className="overview-today-unit">ms</span> : null}
            </dd>
          </div>
        </dl>
      </div>
    </>
  );
}
