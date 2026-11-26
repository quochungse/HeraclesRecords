import { useMemo, useState } from "react";
import { ArrowLeft, CloudOff, RefreshCw } from "lucide-react";
import { MentorIcon } from "../chat/mentorIcon";
import type {
  CoachOpenRequest,
  CorosProfileZoneFamily,
  TrainingHubActivity,
  TrainingHubActivityDetail,
  TrainingHubClimb
} from "../../electron/types";
import { climbFamilyOfSport, isSend } from "../../electron/climbDetail";
import { climbGradeOf, rungIndexFor } from "../../electron/climbGrades";
import type { TrainingHubLoadStatus } from "../training/types";
import { activityCoachRequest } from "../training/askCoachAbout";
import { useSessionChart } from "../training/useSessionChart";
import { formatDurationSeconds, formatOptionalNumber, formatTrainingTimestamp } from "../training/formatters";
import { useUnitSystem } from "../units/UnitSystemProvider";
import { elevationUnit, metersToElevation } from "../units/units";
import { ActivitySeriesChart } from "../training/components/ActivitySeriesChart";
import { OptionGroup } from "../components/OptionGroup";
import { RunDetailSkeleton } from "../running/RunningSkeleton";
import { useBackGesture } from "../running/sportPage";
import { formatClimbClock, gradeName, scaleRungs, styleGroupOf, type ClimbScales } from "./climbMetrics";
import { CLIMB_KIND_LABELS, CLIMB_STYLE_LABELS, classifyClimbKind, gradeLabel } from "./climbType";
import { plural, t } from "../i18n/core";
import { useI18n } from "../i18n/useI18n";

interface ClimbDetailViewProps {
  activity: TrainingHubActivity;
  /** Null until the fetch for *this* session lands. */
  detail: TrainingHubActivityDetail | null;
  /** This session's own detail request — never inferred from the app's `busy`. */
  detailStatus: TrainingHubLoadStatus;
  scales: ClimbScales;
  onBack: () => void;
  /** Where Back goes, as its button reads: the list, or the screen the session came from. */
  backLabel?: string;
  onRetry: () => void;
  onAskCoach?: (request: CoachOpenRequest) => void;
  /** The account's heart-rate model, naming the zones of an activity COROS left unlabelled. */
  zoneFamily?: CorosProfileZoneFamily;
}

interface Stat {
  label: string;
  value: string;
  title?: string;
}

type RouteMeasure = "grade" | "time" | "height";

/**
 * One climbing session, on the whole page — Running's detail page with a
 * climber's figures.
 *
 * The page is read from the session's climbs: how many, how many went, the
 * hardest that went, the time on the wall against the time between. A block
 * for every climb, placed where it was climbed and as wide as it took, in
 * how it went; the heart rate beneath; and every climb in a table, its grade
 * as it was recorded beside the scale the screen shows.
 */
export function ClimbDetailView({
  activity,
  detail,
  detailStatus,
  scales,
  onBack,
  backLabel = t("nav.climbing"),
  onRetry,
  onAskCoach,
  zoneFamily
}: ClimbDetailViewProps) {
  const { unitSystem } = useUnitSystem();
  const { locale } = useI18n();
  const kind = classifyClimbKind(activity.sportType) ?? "indoor";
  const kindLabel = CLIMB_KIND_LABELS[kind];
  const family = climbFamilyOfSport(activity.sportType);
  const climb = detail?.climb;
  const climbs = useMemo(() => climb?.climbs ?? [], [climb]);
  const [measure, setMeasure] = useState<RouteMeasure>("grade");

  const session = useSessionChart(detail, zoneFamily);
  const { series } = session;
  const loading = detailStatus === "pending" && detail === null;
  const failed = detailStatus === "failed" && detail === null;

  useBackGesture(onBack);

  const graded = useMemo(
    () =>
      climbs.map((entry) => {
        const grade = climbGradeOf(activity.sportType, entry.system, entry.gradeIndex);
        return { entry, grade };
      }),
    [activity.sportType, climbs]
  );

  const headline = useMemo<Stat[]>(() => {
    const stats: Stat[] = [];
    const sessionSeconds = detail?.duration ?? activity.duration;
    if (climb) {
      const marked = climbs.filter((entry) => entry.style !== "unrecorded");
      const sent = marked.filter((entry) => isSend(entry.style));
      stats.push({ label: t("climb.climbs"), value: String(climbs.length), title: t("climb.climbsTitle") });
      if (marked.length > 0) {
        stats.push({ label: t("climb.list.sent"), value: t("climb.detail.sentOf", { sent: sent.length, marked: marked.length }) });
      }
      const sends = graded.filter(({ entry, grade }) => grade && grade.family === family && isSend(entry.style));
      const best = sends.reduce<(typeof sends)[number] | undefined>(
        (top, item) => (!top || (item.grade?.ladder ?? 0) > (top.grade?.ladder ?? 0) ? item : top),
        undefined
      );
      if (best?.grade) {
        stats.push({
          label: t("climb.detail.hardest"),
          value: gradeName(family, best.grade.ladder, scales),
          title: CLIMB_STYLE_LABELS[best.entry.style]
        });
      }
      const ladders = graded.flatMap(({ grade }) => (grade && grade.family === family ? [grade.ladder] : []));
      if (ladders.length > 0) {
        const rungs = scaleRungs(family, scales);
        const average =
          ladders.map((ladder) => rungIndexFor(rungs, ladder)).reduce((sum, value) => sum + value, 0) / ladders.length;
        stats.push({
          label: t("climb.detail.avgGrade"),
          value: gradeLabel(rungs[Math.round(average)]?.name ?? ""),
          title: t("climb.detail.avgGradeTitle")
        });
      }
      stats.push({
        label: t("climb.climbingTime"),
        value: formatDurationSeconds(Math.round(climb.climbingSeconds)),
        title: t("climb.climbingTimeTitle")
      });
      const offWall = sessionSeconds === undefined ? undefined : sessionSeconds - climb.climbingSeconds;
      if (offWall !== undefined && offWall > 0) {
        stats.push({
          label: t("climb.detail.offWall"),
          value: formatDurationSeconds(Math.round(offWall)),
          title: t("climb.detail.offWallTitle")
        });
      }
      if (climb.heightMeters !== undefined) {
        stats.push({
          label: t("climb.height"),
          value: `${Math.round(metersToElevation(climb.heightMeters, unitSystem))} ${elevationUnit(unitSystem)}`,
          title: t("climb.heightTitle")
        });
      }
      stats.push({ label: t("climb.falls"), value: String(climb.falls) });
    }
    stats.push({ label: t("activity.m.time"), value: formatDurationSeconds(sessionSeconds) });
    const avgHr = detail?.avgHr ?? activity.avgHr;
    if (avgHr !== undefined) stats.push({ label: t("activity.m.avgHr"), value: `${avgHr} bpm` });
    const maxHr = detail?.maxHr ?? activity.maxHr;
    if (maxHr !== undefined) stats.push({ label: t("activity.m.maxHr"), value: `${maxHr} bpm` });
    const load = detail?.trainingLoad ?? activity.trainingLoad;
    if (load !== undefined) {
      stats.push({ label: t("overview.tiles.load"), value: formatOptionalNumber(Math.round(load)) });
    }
    const calories = detail?.calories ?? activity.calories;
    if (calories !== undefined && calories > 0) {
      stats.push({ label: t("activity.m.calories"), value: `${Math.round(calories)} kcal` });
    }
    return stats;
  }, [activity, climb, climbs, detail, family, graded, scales, unitSystem, locale]);

  return (
    <section className="running-view climbing-view run-detail">
      <div className="run-detail-hero">
        <div className="run-detail-hero-content">
          <header className="run-detail-header">
            <div className="run-detail-header-bar">
              <button type="button" className="run-detail-back" onClick={onBack}>
                <ArrowLeft size={16} aria-hidden="true" />
                <span>{backLabel}</span>
              </button>
              {onAskCoach ? (
                <button
                  type="button"
                  className="ghost-button activity-ask-coach"
                  onClick={() =>
                    onAskCoach(
                      activityCoachRequest({ ...activity, sportName: activity.sportName ?? kindLabel }, unitSystem)
                    )
                  }
                >
                  <MentorIcon size={15} aria-hidden="true" />
                  {t("activity.askCoach")}
                </button>
              ) : null}
            </div>
            <div className="run-detail-title">
              <p className="running-eyebrow">
                {kindLabel}
                {" · "}
                {formatTrainingTimestamp(activity.startTime)}
              </p>
              <h1>{activity.name?.trim() || kindLabel}</h1>
            </div>
          </header>

          <div className="run-detail-stats">
            {headline.map((stat) => (
              <div className="running-stat" key={stat.label} title={stat.title}>
                <span>{stat.label}</span>
                <strong>{stat.value}</strong>
              </div>
            ))}
          </div>
        </div>
      </div>

      {loading ? <RunDetailSkeleton label={t("climb.loadingOne")} /> : null}

      {failed ? (
        <section className="panel running-empty running-state-panel">
          <CloudOff size={22} aria-hidden="true" />
          <div>
            <h3>{t("climb.detail.failed")}</h3>
            <p>{t("climb.detail.failedBody")}</p>
          </div>
          <button type="button" className="primary-button" onClick={onRetry}>
            <RefreshCw size={14} aria-hidden="true" />
            {t("common.tryAgain")}
          </button>
        </section>
      ) : null}

      {climb && climbs.length === 0 ? (
        <section className="panel running-empty">
          <div>
            <h3>{t("climb.detail.noClimbs")}</h3>
            <p>{t("climb.detail.noClimbsBody")}</p>
          </div>
        </section>
      ) : null}

      {climbs.length > 0 ? (
        <ClimbRoutesChart
          climbs={climbs}
          sportType={activity.sportType}
          sessionSeconds={detail?.elapsedDuration ?? detail?.duration ?? activity.duration}
          scales={scales}
          measure={measure}
          onMeasureChange={setMeasure}
        />
      ) : null}

      {series.length > 0 ? (
        <ActivitySeriesChart
          {...session.chart}
          {...session.page}
          activityTime={detail?.duration ?? activity.duration}
          sportType={activity.sportType}
          motion="hike"
          wholeLabel={t("climb.detail.wholeSession")}
        />
      ) : null}

      {climbs.length > 0 ? (
        <section className="panel run-detail-panel run-block">
          <p className="running-eyebrow">{t("climb.detail.byClimb")}</p>
          <div className="run-table-scroll">
            <table className="run-list climb-route-table">
              <thead>
                <tr>
                  <th scope="col" className="climb-route-index">#</th>
                  <th scope="col">{t("climb.detail.grade")}</th>
                  <th scope="col">{t("climb.detail.style")}</th>
                  <th scope="col" className="is-numeric">{t("climb.detail.onWall")}</th>
                  <th scope="col" className="is-numeric">{t("climb.height")}</th>
                  <th scope="col" className="is-numeric">{t("climb.falls")}</th>
                  <th scope="col" className="is-numeric">{t("activity.m.avgHr")}</th>
                  <th scope="col" className="is-numeric">{t("activity.m.maxHr")}</th>
                  <th scope="col" className="is-numeric">{t("climb.detail.restAfter")}</th>
                </tr>
              </thead>
              <tbody>
                {graded.map(({ entry, grade }) => {
                  const shown = grade ? gradeName(grade.family, grade.ladder, scales) : undefined;
                  const recorded = grade ? gradeLabel(grade.name) : undefined;
                  return (
                    <tr key={entry.index}>
                      <td className="climb-route-index">{entry.index}</td>
                      <td>
                        {shown ?? "—"}
                        {recorded && recorded !== shown ? (
                          <span className="climb-recorded" title={t("climb.detail.recordedTitle")}>
                            {" "}
                            ({recorded})
                          </span>
                        ) : null}
                        {entry.pitches ? (
                          <span className="climb-recorded"> · {plural("climb.detail.pitches", entry.pitches)}</span>
                        ) : null}
                      </td>
                      <td>
                        <span className={`climb-style-tag climb-group-${styleGroupOf(entry.style)}`}>
                          {CLIMB_STYLE_LABELS[entry.style]}
                        </span>
                      </td>
                      <td className="is-numeric">{formatClimbClock(entry.seconds)}</td>
                      <td className="is-numeric">
                        {entry.heightMeters === undefined
                          ? "—"
                          : `${Math.round(metersToElevation(entry.heightMeters, unitSystem))} ${elevationUnit(unitSystem)}`}
                      </td>
                      <td className="is-numeric">{entry.falls ? entry.falls : "—"}</td>
                      <td className="is-numeric">{entry.avgHr ?? "—"}</td>
                      <td className="is-numeric">{entry.maxHr ?? "—"}</td>
                      <td className="is-numeric">{entry.restAfter === undefined ? "—" : formatClimbClock(entry.restAfter)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </section>
  );
}

interface ClimbRoutesChartProps {
  climbs: readonly TrainingHubClimb[];
  sportType: number | undefined;
  /** The session on the wall clock, which the climbs' starts are read against. */
  sessionSeconds: number | undefined;
  scales: ClimbScales;
  measure: RouteMeasure;
  onMeasureChange: (measure: RouteMeasure) => void;
}

/**
 * Every climb as a block, placed where it was climbed and as wide as the time
 * on the wall, in how it went; the gaps between are rest. Where the laps carry
 * no start the blocks stand side by side in order.
 */
function ClimbRoutesChart({ climbs, sportType, sessionSeconds, scales, measure, onMeasureChange }: ClimbRoutesChartProps) {
  const { unitSystem } = useUnitSystem();
  const family = climbFamilyOfSport(sportType);
  const rungs = useMemo(() => scaleRungs(family, scales), [family, scales]);
  const timed = climbs.every((entry) => entry.startSeconds !== undefined);
  const last = climbs[climbs.length - 1];
  const span = timed
    ? Math.max(sessionSeconds ?? 0, (last?.startSeconds ?? 0) + (last?.seconds ?? 0))
    : climbs.length;

  const blocks = climbs.map((entry, order) => {
    const grade = climbGradeOf(sportType, entry.system, entry.gradeIndex);
    const rung = grade && grade.family === family ? rungIndexFor(rungs, grade.ladder) : undefined;
    const value =
      measure === "grade" ? (rung === undefined ? 0 : rung + 1) : measure === "time" ? entry.seconds : (entry.heightMeters ?? 0);
    const label =
      measure === "grade"
        ? rung === undefined ? "—" : gradeLabel(rungs[rung]?.name ?? "")
        : measure === "time"
          ? formatClimbClock(entry.seconds)
          : entry.heightMeters === undefined
            ? "—"
            : `${Math.round(metersToElevation(entry.heightMeters, unitSystem))}`;
    const left = timed ? ((entry.startSeconds ?? 0) / span) * 100 : (order / span) * 100;
    const width = timed ? (entry.seconds / span) * 100 : (0.7 / span) * 100;
    return { entry, value, label, left, width };
  });
  const top = Math.max(1, ...blocks.map((block) => block.value));
  const hasHeight = climbs.some((entry) => entry.heightMeters !== undefined);

  return (
    <section className="panel run-block climb-routes">
      <header className="run-block-head">
        <div>
          <p className="running-eyebrow">{t("climb.detail.routesTitle")}</p>
          <h3>
            {String(climbs.length)}
            <span className="run-block-sub"> {plural("climb.detail.routesSub", climbs.length)}</span>
          </h3>
        </div>
        <OptionGroup
          label={t("run.volume.measure")}
          motion="slide"
          value={measure}
          options={[
            { value: "grade" as const, label: t("climb.detail.grade") },
            { value: "time" as const, label: t("climb.detail.onWall") },
            ...(hasHeight ? [{ value: "height" as const, label: t("climb.height") }] : [])
          ]}
          onChange={onMeasureChange}
        />
      </header>
      <div className="climb-routes-plot">
        {blocks.map((block) => (
          <div
            key={block.entry.index}
            className={`climb-routes-block climb-group-${styleGroupOf(block.entry.style)}`}
            style={{
              left: `${block.left}%`,
              width: `max(8px, ${block.width}%)`,
              height: `${(block.value / top) * 100}%`
            }}
            title={`#${block.entry.index} · ${CLIMB_STYLE_LABELS[block.entry.style]} · ${formatClimbClock(block.entry.seconds)}`}
          >
            <span className="climb-routes-label">
              {block.entry.falls ? <em>×{block.entry.falls}</em> : null}
              {block.label}
            </span>
          </div>
        ))}
      </div>
      {timed ? (
        <div className="climb-routes-axis">
          <span>0</span>
          <span>{formatDurationSeconds(Math.round(span / 2))}</span>
          <span>{formatDurationSeconds(Math.round(span))}</span>
        </div>
      ) : null}
      <p className="run-block-note">
        {timed ? t("climb.detail.routesNote") : t("climb.detail.routesNoteUntimed")}
        {measure === "time" ? ` ${t("climb.detail.avgOnWall", { time: formatClimbClock(average(climbs.map((entry) => entry.seconds))) })}` : ""}
      </p>
    </section>
  );
}

function average(values: readonly number[]): number {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}
