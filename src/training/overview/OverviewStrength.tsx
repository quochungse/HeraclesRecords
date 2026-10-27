import { useMemo } from "react";
import { ArrowUpRight, Dumbbell, Loader2 } from "lucide-react";
import type { TrainingHubUpcomingWorkout } from "../../../electron/types";
import type { HeraclesRecordsApi } from "../../heraclesrecords-api";
import type { PrimaryView } from "../../navigation/primaryNav";
import { StrengthHero } from "../../strength/StrengthHero";
import { buildStrengthAnalytics, formatVolumeKg } from "../../strength/strengthAnalytics";
import { useStrengthData } from "../../strength/useStrengthData";
import "../../strength/strength.css";
import { periodLabel, periodPhrase } from "../../preferences/periodScale";
import { useUnitSystem } from "../../units/UnitSystemProvider";
import { formatDurationSpan, formatHappenDayLabel, happenDayFromTimestamp } from "../formatters";
import { formatDecimal, getIntlLocale, plural, t } from "../../i18n/core";
import { useI18n } from "../../i18n/useI18n";
import { nextPlanned, sportWindow, SPORT_WINDOW_WEEKS } from "./sportModel";

const WINDOW_DAYS = 28;

function whole(value: number): string {
  return new Intl.NumberFormat(getIntlLocale()).format(Math.round(value));
}

function mondayMs(nowMs: number): number {
  const monday = new Date(nowMs);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return monday.getTime();
}

/**
 * Strength in the last four weeks: the sessions' figures, the body heat map
 * and the muscle breakdown the Strength screen opens with (`StrengthHero`,
 * read over these four weeks rather than the screen's own window), and the
 * last session and the next. Lazy, as the Strength Distribution it replaced
 * was: the body map is three.js.
 */
export default function OverviewStrength({
  api,
  connected,
  upcomingWorkouts,
  onOpenActivity,
  onOpenView
}: {
  api: HeraclesRecordsApi;
  connected: boolean;
  upcomingWorkouts: TrainingHubUpcomingWorkout[];
  onOpenActivity?: (activityId: string) => void;
  onOpenView?: (view: PrimaryView) => void;
}) {
  useI18n();
  const { unitSystem } = useUnitSystem();
  const { sessions, source, error, initializing } = useStrengthData({ api, corosConnected: connected });
  const nowMs = Date.now();
  const window = useMemo(() => sportWindow(sessions, Date.now()), [sessions]);
  const analytics = useMemo(() => buildStrengthAnalytics(window, WINDOW_DAYS), [window]);

  // Nothing lifted in four weeks, once the history has been read: no section.
  if (!initializing && window.length === 0) {
    return null;
  }

  const summary = analytics.summary;
  const sinceMonday = mondayMs(nowMs) / 1000;
  const thisWeek = window.filter((session) => (session.startTime ?? 0) >= sinceMonday);
  const thisWeekSeconds = thisWeek.reduce((sum, session) => sum + (session.duration ?? 0), 0);
  const volume = formatVolumeKg(summary.volumeKg, unitSystem);
  const split = volume.indexOf(" ");
  const last = [...window].sort((left, right) => (right.startTime ?? 0) - (left.startTime ?? 0))[0];
  const lastDay = last ? happenDayFromTimestamp(last.startTime) : undefined;
  const next = nextPlanned(upcomingWorkouts, "strength");
  const title = t("nav.strength");

  return (
    <section className="overview-section" aria-labelledby="overview-sport-strength" data-sport="strength">
      <div className="overview-section-head">
        <Dumbbell className="overview-sport-icon" size={20} strokeWidth={2} aria-hidden="true" />
        <h2 id="overview-sport-strength" className="overview-section-title">
          {title}
        </h2>
        <span className="overview-section-aside">
          {`${plural("overview.sport.sessions", window.length)} · ${periodPhrase(WINDOW_DAYS)}`}
        </span>
        {onOpenView ? (
          <button
            type="button"
            className="overview-section-link"
            onClick={() => onOpenView("strength")}
            aria-label={t("overview.sport.open", { screen: title })}
          >
            {title}
            <ArrowUpRight size={14} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      <div className="panel overview-sport overview-strength">
        {initializing ? (
          <p className="overview-sport-note" role="status">
            <Loader2 className="spin" size={14} aria-hidden="true" /> {t("strength.readingSessions")}
          </p>
        ) : (
          <>
            {error ? (
              <p className="overview-sport-note" role="alert">
                {error}
              </p>
            ) : null}
            <dl className="overview-sport-kpis">
              <div>
                <dt>{t("overview.tiles.thisWeek")}</dt>
                <dd>
                  <span className="figure">{whole(thisWeek.length)}</span>
                  <span className="overview-sport-unit">{t("overview.sport.sessionsUnit")}</span>
                </dd>
                <dd className="overview-sport-note">
                  {t("overview.sport.timeAndAverage", {
                    time: formatDurationSpan(thisWeekSeconds),
                    avg: formatDecimal(summary.sessions / SPORT_WINDOW_WEEKS, 1)
                  })}
                </dd>
              </div>
              <div>
                <dt>{t("overview.sport.weightLifted")}</dt>
                <dd>
                  <span className="figure">{split > 0 ? volume.slice(0, split) : volume}</span>
                  {split > 0 ? <span className="overview-sport-unit">{volume.slice(split + 1)}</span> : null}
                </dd>
                <dd className="overview-sport-note">{periodLabel(WINDOW_DAYS)}</dd>
              </div>
              <div>
                <dt>{t("overview.sport.sets")}</dt>
                <dd>
                  <span className="figure">{whole(summary.sets)}</span>
                </dd>
                <dd className="overview-sport-note">
                  {t("overview.sport.perSession", {
                    value: summary.sessions > 0 ? whole(summary.sets / summary.sessions) : "–"
                  })}
                </dd>
              </div>
              <div>
                <dt>{t("overview.sport.timeLifting")}</dt>
                <dd>
                  <span className="figure">{formatDurationSpan(summary.durationSec)}</span>
                </dd>
                <dd className="overview-sport-note">
                  {t("overview.sport.perSession", {
                    value: summary.sessions > 0 ? formatDurationSpan(summary.durationSec / summary.sessions) : "–"
                  })}
                </dd>
              </div>
            </dl>
            {/* `.strength-view` carries the Strength screen's tokens — the heat
                ramp, the stage, the 3D figure's materials — which the hero
                reads; without it the bars and the stage draw empty. */}
            <div className="overview-strength-hero strength-view">
              <StrengthHero analytics={analytics} source={source} />
            </div>
            <div className="overview-sport-facts">
              {last ? (
                <span>
                  <span className="overview-sport-fact-label">{t("overview.sport.last")}</span>{" "}
                  {onOpenActivity && last.source !== "hevy" ? (
                    <button
                      type="button"
                      className="overview-sport-fact-link"
                      onClick={() => onOpenActivity(last.activityId)}
                    >
                      {last.name?.trim() || title}
                    </button>
                  ) : (
                    <span>{last.name?.trim() || title}</span>
                  )}{" "}
                  <span className="overview-sport-fact-meta">
                    · {[lastDay ? formatHappenDayLabel(lastDay) : null, formatDurationSpan(last.duration)].filter(Boolean).join(" · ")}
                  </span>
                </span>
              ) : null}
              <span>
                <span className="overview-sport-fact-label">{t("overview.sport.next")}</span>{" "}
                {next ? (
                  <>
                    {next.name} <span className="overview-sport-fact-meta">· {formatHappenDayLabel(next.happenDay)}</span>
                  </>
                ) : (
                  <span className="overview-sport-fact-meta">{t("overview.sport.nothingPlanned")}</span>
                )}
              </span>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
