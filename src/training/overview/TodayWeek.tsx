import { useMemo } from "react";
import { Activity, Mountain, type LucideIcon } from "lucide-react";
import type {
  TrainingHubActivity,
  TrainingHubUpcomingWorkout
} from "../../../electron/types";
import { workoutSportView } from "../../calendar/workoutSportIcons";
import { happenDayToDate, mergeTrainingDayLists } from "../parsers";
import { enrichDayListWithActivityTotals, getCalendarWeekDateKeys } from "../weeklyActivity";
import type { TrainingHubSnapshot } from "../types";
import { useUnitSystem } from "../../units/UnitSystemProvider";
import { getIntlLocale, plural, t, weekdayNames } from "../../i18n/core";
import { useI18n } from "../../i18n/useI18n";
import { BandScale } from "./BandScale";
import {
  buildWeekChart,
  columnIcons,
  latestTrainingLoad,
  trainingStatusBand,
  trainingStatusMarker,
  TRAINING_STATUS_BANDS,
  TRAINING_STATUS_EDGES,
  type WeekBlock,
  type WeekChart,
  type WeekColumn
} from "./todayModel";

function blockIcon(block: WeekBlock): LucideIcon {
  if (block.sport === "hiking") {
    return Mountain;
  }
  return block.sport ? workoutSportView(block.sport).icon : Activity;
}

/** The week's own dates, "Oct 19 – 25", with the month said once. */
function weekDates(now: Date): string {
  const keys = getCalendarWeekDateKeys(now);
  const start = happenDayToDate(keys[0]);
  const end = happenDayToDate(keys[6]);
  if (!start || !end) {
    return "";
  }
  return new Intl.DateTimeFormat(getIntlLocale(), { month: "short", day: "numeric" }).formatRange(
    start,
    end
  );
}

function figure(value: number): string {
  return new Intl.NumberFormat(getIntlLocale()).format(Math.round(value));
}

function WeekDay({
  column,
  chart,
  label
}: {
  column: WeekColumn;
  chart: WeekChart;
  label: string;
}) {
  const { shown, more } = columnIcons(column.blocks);
  const total = column.doneLoad + column.plannedLoad;
  const rest = column.isPast && column.blocks.length === 0;
  return (
    <div className={`overview-week-day${column.isToday ? " is-today" : ""}`}>
      <div className="overview-week-plot">
        <div className="overview-week-stack">
          {column.blocks.map((block) => (
            <i
              key={block.key}
              className={[
                "overview-week-block",
                block.planned && "is-planned",
                block.category === null && "is-residual"
              ]
                .filter(Boolean)
                .join(" ")}
              style={{ height: `${(block.load / chart.axisMax) * 100}%` }}
            />
          ))}
          {total > 0 ? <span className="overview-week-value figure">{figure(total)}</span> : null}
          {rest ? <span className="overview-week-rest">{t("overview.heatmap.rest")}</span> : null}
        </div>
      </div>
      <div className="overview-week-icons">
        {shown.map((block) => {
          const Icon = blockIcon(block);
          return (
            <Icon
              key={block.key}
              size={12}
              strokeWidth={2}
              className={block.planned ? "is-planned" : undefined}
              aria-hidden="true"
            />
          );
        })}
        {more > 0 ? <span className="figure">+{more}</span> : null}
      </div>
      <span className="overview-week-label">{label}</span>
    </div>
  );
}

/**
 * This week, as the Readiness panel's right-hand column: COROS's training
 * status on its five bands, a column a day with every session a block (done
 * in the accent, planned hatched), and the trend with the two figures it is
 * the ratio of.
 */
export function TodayWeek({
  snapshot,
  activities,
  upcomingWorkouts,
  loading = false
}: {
  snapshot: TrainingHubSnapshot | null;
  activities: TrainingHubActivity[];
  upcomingWorkouts: TrainingHubUpcomingWorkout[];
  loading?: boolean;
}) {
  useI18n();
  const { unitSystem } = useUnitSystem();
  const dayList = useMemo(
    () =>
      enrichDayListWithActivityTotals(
        mergeTrainingDayLists(snapshot?.dailyMetrics ?? null, snapshot?.analytics ?? null),
        activities
      ),
    [snapshot, activities]
  );
  const now = new Date();
  const chart = useMemo(
    () => buildWeekChart({ dayList, activities, upcoming: upcomingWorkouts, unitSystem }),
    [dayList, activities, upcomingWorkouts, unitSystem]
  );
  const reading = useMemo(() => latestTrainingLoad(dayList), [dayList]);
  const percent = reading.percent;
  const status = percent !== undefined ? trainingStatusBand(percent) : undefined;
  // Drawn once COROS has answered, an empty week included: a Monday morning
  // with nothing recorded yet is seven empty columns.
  const answered = !loading && snapshot !== null;
  const weekdays = weekdayNames("short");
  const bands = TRAINING_STATUS_BANDS.map((key) => ({ key, label: t(`overview.status.${key}`) }));

  return (
    <>
      <div className="overview-today-cell overview-today-head is-week">
        <p className="eyebrow">{t("overview.tiles.thisWeek")}</p>
        <span className="overview-today-date">
          {weekDates(now)}
          <span className="overview-today-date-aside">
            {" · "}
            {plural("overview.today.sessions", chart.doneSessions)}
            {chart.plannedSessions > 0
              ? ` ${plural("overview.today.planned", chart.plannedSessions)}`
              : null}
          </span>
        </span>
      </div>

      <div className="overview-today-cell overview-today-status is-week">
        <BandScale
          scale="status"
          bands={bands}
          ticks={TRAINING_STATUS_EDGES.map((edge) => `${edge}%`)}
          marker={percent !== undefined ? trainingStatusMarker(percent) : undefined}
          current={status}
          label={
            percent !== undefined && status
              ? t("overview.today.statusScale", { percent, status: t(`overview.status.${status}`) })
              : t("overview.today.intensityTrend")
          }
        />
      </div>

      <div className="overview-today-cell overview-today-vis is-week">
        {answered ? (
          <div className="overview-week-chart" role="img" aria-label={t("overview.today.weekChart")}>
            <div className="overview-week-axis" aria-hidden="true">
              {chart.ticks.map((tick) => (
                <span key={tick} style={{ bottom: `${(tick / chart.axisMax) * 100}%` }}>
                  {figure(tick)}
                </span>
              ))}
            </div>
            <div className="overview-week-grid" aria-hidden="true">
              {chart.ticks.map((tick) => (
                <i key={tick} style={{ bottom: `${(tick / chart.axisMax) * 100}%` }} />
              ))}
            </div>
            <div className="overview-week-cols" aria-hidden="true">
              {chart.columns.map((column, index) => (
                <WeekDay
                  key={column.happenDay}
                  column={column}
                  chart={chart}
                  label={column.isToday ? t("overview.today") : weekdays[index]}
                />
              ))}
            </div>
          </div>
        ) : (
          <p className="overview-today-message">
            {loading ? t("overview.weekly.reading") : t("overview.weekly.unreadable")}
          </p>
        )}
      </div>

      <div className="overview-today-cell overview-today-foot is-week">
        <p className="eyebrow">{t("overview.trainingLoad")}</p>
        <dl>
          <div>
            <dt>{t("overview.today.loadImpact")}</dt>
            <dd className="figure">{reading.loadImpact !== undefined ? figure(reading.loadImpact) : "–"}</dd>
          </div>
          <div>
            <dt>{t("overview.today.baseFitness")}</dt>
            <dd className="figure">{reading.baseFitness !== undefined ? figure(reading.baseFitness) : "–"}</dd>
          </div>
          <div>
            <dt>{t("overview.today.intensityTrend")}</dt>
            <dd className="figure">{percent !== undefined ? `${percent}%` : "–"}</dd>
          </div>
        </dl>
      </div>
    </>
  );
}
