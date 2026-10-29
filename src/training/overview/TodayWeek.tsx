import { useMemo } from "react";
import { Activity, Mountain, type LucideIcon } from "lucide-react";
import type {
  TrainingHubActivity,
  TrainingHubUpcomingWorkout,
  UnitSystem
} from "../../../electron/types";
import { workoutSportView } from "../../calendar/workoutSportIcons";
import { OptionGroup } from "../../components/OptionGroup";
import {
  defineSelectionPreference,
  selectionIsOneOf,
  useSelectionPreference
} from "../../preferences/selectionPreferences";
import { formatDurationSpan } from "../formatters";
import { happenDayToDate, mergeTrainingDayLists } from "../parsers";
import { SPORT_COLOR_LABELS } from "../sportColors";
import { enrichDayListWithActivityTotals, getCalendarWeekDateKeys } from "../weeklyActivity";
import type { TrainingHubSnapshot } from "../types";
import { useUnitSystem } from "../../units/UnitSystemProvider";
import { formatDistanceValue, metersToDisplayDistance } from "../../units/units";
import { useTodayKey } from "../useTodayKey";
import { loadPairTitle } from "../loadFigures";
import { useLoadSource } from "../loadSource";
import { formatCount, formatDecimal, getIntlLocale, t, weekdayNames } from "../../i18n/core";
import { useI18n } from "../../i18n/useI18n";
import { BandScale } from "./BandScale";
import { useColumnFocus } from "./chartFocus";
import { followTip, releaseTip } from "./followTip";
import {
  buildWeekChart,
  latestTrainingLoad,
  thisWeekLoad,
  trainingStatusBand,
  trainingStatusMarker,
  TRAINING_STATUS_BANDS,
  TRAINING_STATUS_EDGES,
  type WeekBlock,
  type WeekChart,
  type WeekColumn,
  type WeekMeasure
} from "./todayModel";

const WEEK_MEASURE = defineSelectionPreference<WeekMeasure>({
  key: "overview.weekMeasure",
  defaultValue: "time",
  validate: selectionIsOneOf(["time", "distance", "load"])
});

/** A tooltip lists this many sessions, and counts the rest. */
const TIP_SESSIONS = 5;

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
  return formatCount(Math.round(value));
}

/** An axis step: "0", "30m", "1h", "1.5h"; distance in whole km or miles. */
function axisLabel(value: number, measure: WeekMeasure, unitSystem: UnitSystem): string {
  if (measure === "distance") {
    return figure(metersToDisplayDistance(value, unitSystem));
  }
  if (measure === "load" || value === 0) {
    return figure(value);
  }
  if (value > 0 && value < 3_600) {
    return t("units.duration.m", { m: Math.round(value / 60) });
  }
  const hours = value / 3_600;
  return t("units.duration.h", { h: formatDecimal(hours, Number.isInteger(hours) ? 0 : 1) });
}

function distance(meters: number, unitSystem: UnitSystem): string {
  return formatDistanceValue(meters, unitSystem, { digits: 1 });
}

function amount(value: number, measure: WeekMeasure, unitSystem: UnitSystem): string {
  if (measure === "time") return formatDurationSpan(value);
  return measure === "distance" ? distance(value, unitSystem) : figure(value);
}

/**
 * A session's figures, time, distance and load, each only where it has one. A
 * load read in Heracles names COROS's figure beside it.
 */
function blockFigures(
  block: { seconds: number; meters: number; load: number; corosLoad?: number },
  unitSystem: UnitSystem
): string {
  const coros = block.corosLoad !== undefined && Math.round(block.corosLoad) !== Math.round(block.load)
    ? t("strength.load.coros", { value: figure(block.corosLoad) })
    : null;
  return [
    block.seconds > 0 ? formatDurationSpan(block.seconds) : null,
    block.meters > 0 ? distance(block.meters, unitSystem) : null,
    block.load > 0 ? t("units.trainingLoadShort", { value: Math.round(block.load) }) : null,
    block.load > 0 ? coros : null
  ]
    .filter(Boolean)
    .join(" · ");
}

function blockName(block: WeekBlock): string {
  if (block.category === null) {
    return t("overview.today.outsideSessions");
  }
  return block.name || SPORT_COLOR_LABELS[block.category];
}

/**
 * A tooltip's sessions, two lines each: the sport in its colour beside the
 * name, and its figures under the name, so a long name is not cut short.
 */
function TipSessions({ blocks, unitSystem }: { blocks: readonly WeekBlock[]; unitSystem: UnitSystem }) {
  if (blocks.length === 0) {
    return null;
  }
  return (
    <ul>
      {blocks.map((block) => {
        const Icon = blockIcon(block);
        return (
          <li key={block.key}>
            <span className="overview-tip-sport" data-sport={block.category ?? undefined} aria-hidden="true">
              <Icon size={12} strokeWidth={2} />
            </span>
            <span className="overview-tip-name">{blockName(block)}</span>
            <span className="overview-tip-value">{blockFigures(block, unitSystem)}</span>
          </li>
        );
      })}
    </ul>
  );
}

function WeekDay({
  column,
  chart,
  unitSystem,
  label,
  date,
  tipSide,
  focus
}: {
  column: WeekColumn;
  chart: WeekChart;
  unitSystem: UnitSystem;
  label: string;
  /** Its place in the chart's one tab stop (`useColumnFocus`). */
  focus: ReturnType<ReturnType<typeof useColumnFocus>>;
  /** "Thu, Oct 22": the tooltip's heading. */
  date: string;
  /** Which side of the column its tooltip opens on when focused, so it stays inside the panel. */
  tipSide: "after" | "before";
}) {
  const total = column.done + column.planned;
  const rest = column.isPast && column.blocks.length === 0;
  const listed = column.blocks.slice(0, TIP_SESSIONS);
  const totals = column.blocks.reduce(
    (sum, block) => ({
      seconds: sum.seconds + block.seconds,
      meters: sum.meters + block.meters,
      load: sum.load + block.load,
      corosLoad: sum.corosLoad + (block.corosLoad ?? block.load)
    }),
    { seconds: 0, meters: 0, load: 0, corosLoad: 0 }
  );
  const empty = column.isPast
    ? t("overview.heatmap.rest")
    : t("overview.sport.nothingPlanned");
  const description = [
    date,
    ...(column.blocks.length > 0
      ? column.blocks.map((block) =>
          [blockName(block), block.planned ? t("overview.today.plannedTag") : null, blockFigures(block, unitSystem)]
            .filter(Boolean)
            .join(", ")
        )
      : [empty])
  ].join(". ");
  return (
    <div
      className={`overview-week-day${column.isToday ? " is-today" : ""}`}
      role="img"
      {...focus}
      aria-label={description}
      onPointerMove={followTip}
      onPointerLeave={releaseTip}
    >
      <div className="overview-week-plot" aria-hidden="true">
        <div className="overview-week-stack">
          {/* Load no session claims has no time or distance: there it stands at zero, undrawn. */}
          {column.blocks.filter((block) => block.value > 0 || block.category !== null).map((block) => (
            <i
              key={block.key}
              className={[
                "overview-week-block",
                block.planned && "is-planned",
                block.category === null && "is-residual"
              ]
                .filter(Boolean)
                .join(" ")}
              style={{ height: `${(block.value / chart.axisMax) * 100}%` }}
            />
          ))}
          {total > 0 ? <span className="overview-week-value figure">{amount(total, chart.measure, unitSystem)}</span> : null}
          {rest ? <span className="overview-week-rest">{t("overview.heatmap.rest")}</span> : null}
        </div>
      </div>
      <span className="overview-week-label" aria-hidden="true">{label}</span>

      <span className={`overview-tip is-${tipSide}`} aria-hidden="true">
        <strong>{date}</strong>
        {column.blocks.length > 0 ? (
          <>
            <TipSessions blocks={listed.filter((block) => !block.planned)} unitSystem={unitSystem} />
            {listed.some((block) => block.planned) ? (
              <>
                <span className="overview-tip-group">{t("overview.today.plannedTag")}</span>
                <TipSessions blocks={listed.filter((block) => block.planned)} unitSystem={unitSystem} />
              </>
            ) : null}
            {column.blocks.length > TIP_SESSIONS ? (
              <span className="overview-tip-more">
                {t("overview.heatmap.more", { count: column.blocks.length - TIP_SESSIONS })}
              </span>
            ) : null}
            {column.blocks.length > 1 ? (
              <span className="overview-tip-total">
                <span>{t("overview.today.total")}</span>
                <span className="overview-tip-value">{blockFigures(totals, unitSystem)}</span>
              </span>
            ) : null}
          </>
        ) : (
          <span className="overview-tip-empty">{empty}</span>
        )}
      </span>
    </div>
  );
}

/**
 * This week, as the Readiness panel's right-hand column: COROS's training
 * status on its five bands, a column a day with every session a block (done
 * in the accent, planned hatched) in time, distance or load, and under them
 * the two figures the trend is the ratio of, each with the span it averages,
 * and the week's load so far against the range COROS recommends for the week.
 * A column opens what it holds on hover.
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
  const { source: loadSource } = useLoadSource();
  const dayList = useMemo(
    () =>
      enrichDayListWithActivityTotals(
        mergeTrainingDayLists(snapshot?.dailyMetrics ?? null, snapshot?.analytics ?? null),
        activities
      ),
    [snapshot, activities]
  );
  // Read again when the day turns over, so a window left open past midnight
  // or into a Monday does not keep yesterday's week under today's dates.
  const todayKey = useTodayKey();
  const now = useMemo(() => new Date(), [todayKey]);
  const [measure, setMeasure] = useSelectionPreference(WEEK_MEASURE);
  const chart = useMemo(
    () => buildWeekChart({ dayList, activities, upcoming: upcomingWorkouts, now, unitSystem, measure, loadSource }),
    [dayList, activities, upcomingWorkouts, now, unitSystem, measure, loadSource]
  );
  const reading = useMemo(() => latestTrainingLoad(dayList), [dayList]);
  // Tabbed into at today, which this week always holds.
  const columnFocus = useColumnFocus(
    chart.columns.length,
    Math.max(0, chart.columns.findIndex((column) => column.isToday))
  );
  const week = useMemo(
    () => thisWeekLoad({ dayList, activities, now, unitSystem, loadSource }),
    [dayList, activities, now, unitSystem, loadSource]
  );
  const percent = reading.percent;
  const status = percent !== undefined ? trainingStatusBand(percent) : undefined;
  // Drawn once COROS has answered, an empty week included: a Monday morning
  // with nothing recorded yet is seven empty columns.
  const answered = !loading && snapshot !== null;
  const weekdays = weekdayNames("short");
  const dayFormat = new Intl.DateTimeFormat(getIntlLocale(), { weekday: "short", month: "short", day: "numeric" });
  const edges = TRAINING_STATUS_EDGES;
  const bands = TRAINING_STATUS_BANDS.map((key, index) => ({
    key,
    label: t(`overview.status.${key}`),
    range:
      index === 0
        ? `< ${edges[0]}%`
        : index === edges.length
          ? `≥ ${edges[index - 1]}%`
          : `${edges[index - 1]}–${edges[index] - 1}%`
  }));

  return (
    <>
      <div className="overview-today-cell overview-today-head is-week">
        <p className="eyebrow">{t("overview.tiles.thisWeek")}</p>
        <span className="overview-today-date">{weekDates(now)}</span>
        <OptionGroup
          className="overview-week-measure"
          label={t("overview.today.weekMeasure")}
          tone="quiet"
          size="xs"
          value={measure}
          options={[
            { value: "time", label: t("overview.zones.time") },
            { value: "distance", label: t("overview.tiles.distance") },
            { value: "load", label: t("overview.tiles.load") }
          ]}
          onChange={setMeasure}
        />
      </div>

      <div className="overview-today-cell overview-today-status is-week">
        <BandScale
          title={t("overview.today.intensityTrend")}
          value={percent !== undefined ? `${percent}%` : undefined}
          explain={t("overview.today.trendExplain", {
            loadImpact: t("overview.today.loadImpact"),
            baseFitness: t("overview.today.baseFitness")
          })}
          bands={bands}
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
          <div
            className="overview-week-chart"
            role="group"
            aria-label={t(
              measure === "time"
                ? "overview.today.weekChartTime"
                : measure === "distance"
                  ? "overview.today.weekChartDistance"
                  : "overview.today.weekChart"
            )}
          >
            <div className="overview-week-axis" aria-hidden="true">
              {chart.ticks.map((tick) => (
                <span key={tick} style={{ bottom: `${(tick / chart.axisMax) * 100}%` }}>
                  {axisLabel(tick, measure, unitSystem)}
                </span>
              ))}
            </div>
            <div className="overview-week-grid" aria-hidden="true">
              {chart.ticks.map((tick) => (
                <i key={tick} style={{ bottom: `${(tick / chart.axisMax) * 100}%` }} />
              ))}
            </div>
            <div className="overview-week-cols">
              {chart.columns.map((column, index) => {
                const date = happenDayToDate(column.happenDay);
                return (
                  <WeekDay
                    key={column.happenDay}
                    column={column}
                    chart={chart}
                    unitSystem={unitSystem}
                    label={column.isToday ? t("overview.today") : weekdays[index]}
                    date={date ? dayFormat.format(date) : column.happenDay}
                    tipSide={index < 3 ? "after" : "before"}
                    focus={columnFocus(index)}
                  />
                );
              })}
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
            <dd className="overview-today-sub">{t("overview.today.sevenDayAverage")}</dd>
          </div>
          <div>
            <dt>{t("overview.today.baseFitness")}</dt>
            <dd className="figure">{reading.baseFitness !== undefined ? figure(reading.baseFitness) : "–"}</dd>
            <dd className="overview-today-sub">{t("overview.today.sixWeekAverage")}</dd>
          </div>
          {/* Always COROS's, against COROS's range; the hover names the
              Heracles figure the columns above add up to. */}
          <div title={loadPairTitle(loadSource, week.heraclesLoad, week.load)}>
            <dt>{t("overview.today.weekLoad")}</dt>
            <dd className="figure">{week.load !== undefined ? figure(week.load) : "–"}</dd>
            {week.recommended ? (
              <dd className="overview-today-sub">
                {/* Word joiners about the dash, so the range wraps whole rather than at it. */}
                {t("overview.today.recommendedRange", {
                  min: `${figure(week.recommended.min)}\u2060`,
                  max: `\u2060${figure(week.recommended.max)}`
                })}
              </dd>
            ) : null}
          </div>
        </dl>
      </div>
    </>
  );
}
