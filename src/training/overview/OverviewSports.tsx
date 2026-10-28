import { useMemo, type ReactNode } from "react";
import { ArrowUpRight, Bike, Mountain, type LucideIcon } from "lucide-react";
import type {
  CorosProfile,
  TrainingHubActivity,
  TrainingHubThresholdZone,
  TrainingHubUpcomingWorkout,
  UnitSystem
} from "../../../electron/types";
import type { HeraclesRecordsApi } from "../../heraclesrecords-api";
import type { PrimaryView } from "../../navigation/primaryNav";
import type { SportScreen } from "../../navigation/sportScreens";
import { RunnerIcon } from "../../running/runnerIcon";
import {
  buildRunWeeks,
  climbPerDistanceUnit,
  runIntensityMix,
  runSurfaceBreakdown,
  summariseRuns
} from "../../running/runMetrics";
import { runsOnly, RUN_SURFACE_LABELS } from "../../running/runSurface";
import { buildRideWeeks, rideTypeBreakdown, summariseRides, totalsSpeedKmh } from "../../cycling/rideMetrics";
import { ridesOnly, RIDE_TYPE_LABELS } from "../../cycling/rideType";
import {
  buildHikeWeeks,
  climbingRate,
  CLIMBING_RATE_MIN_GAIN_M,
  hikeAscentRate,
  summariseHikes
} from "../../hiking/hikeMetrics";
import { hikesOnly } from "../../hiking/hikeType";
import { periodLabel, periodPhrase } from "../../preferences/periodScale";
import { useUnitSystem } from "../../units/UnitSystemProvider";
import {
  distanceUnit,
  elevationUnit,
  formatVerticalRate,
  kmhToDisplaySpeed,
  metersToDisplayDistance,
  metersToElevation,
  speedUnit
} from "../../units/units";
import type { Vo2Reading } from "../body/physique";
import { formatDurationSpan, formatHappenDayLabel, happenDayFromTimestamp } from "../formatters";
import type { HeartRateZoneModel } from "../heartRateZoneModel";
import { benefitZoneFamily } from "../trainingBenefit";
import { trainingBenefitName } from "../components/TrainingBenefitChip";
import { useActivityDetailSummaries } from "../useActivityDetailSummaries";
import { formatDecimal, getIntlLocale, plural, t, type MessageKey } from "../../i18n/core";
import { useI18n } from "../../i18n/useI18n";
import { followTip, releaseTip } from "./followTip";
import {
  longestAndLast,
  nextPlanned,
  plannedThisWeek,
  previousWeeksAverage,
  sessionTypeCounts,
  sportWindow,
  SPORT_CHART_WEEKS,
  SPORT_WINDOW_WEEKS,
  type SessionTypeCount
} from "./sportModel";

const WINDOW_DAYS = 28;

function whole(value: number): string {
  return new Intl.NumberFormat(getIntlLocale()).format(Math.round(value));
}

function distance(meters: number, unitSystem: UnitSystem): string {
  const value = metersToDisplayDistance(meters, unitSystem);
  return formatDecimal(value, value >= 100 ? 0 : 1);
}

/** "Sat Oct 17", the day a session was on. */
function sessionDay(activity: TrainingHubActivity): string {
  const day = happenDayFromTimestamp(activity.startTime);
  return day ? formatHappenDayLabel(day) : "";
}

interface Kpi {
  label: string;
  value: string;
  unit?: string;
  note?: ReactNode;
}

function Kpis({ items }: { items: readonly Kpi[] }) {
  return (
    <dl className="overview-sport-kpis">
      {items.map((item) => (
        <div key={item.label}>
          <dt>{item.label}</dt>
          <dd>
            <span className="figure">{item.value}</span>
            {item.unit ? <span className="overview-sport-unit">{item.unit}</span> : null}
          </dd>
          {item.note ? <dd className="overview-sport-note">{item.note}</dd> : null}
        </div>
      ))}
    </dl>
  );
}

interface ChartFact {
  label: string;
  value: string;
}

interface ChartWeek {
  label: string;
  value: number;
  planned?: number;
  /** A word over the column: the week's hike, say. */
  note?: string;
  /** "Oct 13 – 19", the heading of the column's tooltip. */
  dates: string;
  /** What the tooltip states, a label and a figure a row. */
  facts: readonly ChartFact[];
}

/** The seven days from a week's Monday, the month said once. */
function weekRange(weekStartMs: number): string {
  return new Intl.DateTimeFormat(getIntlLocale(), { month: "short", day: "numeric" }).formatRange(
    new Date(weekStartMs),
    new Date(weekStartMs + 6 * 86_400_000)
  );
}

/** What every sport's tooltip states besides its own measure. */
function weekFacts(
  week: { count: number; duration: number; trainingLoad: number },
  countLabel: string
): ChartFact[] {
  return [
    { label: countLabel, value: whole(week.count) },
    { label: t("overview.zones.time"), value: formatDurationSpan(week.duration) },
    ...(week.trainingLoad > 0 ? [{ label: t("overview.tiles.load"), value: whole(week.trainingLoad) }] : [])
  ];
}

/** A round axis over the tallest column: steps of 1, 2, 2.5 or 5 at its scale. */
function axisFor(max: number): { top: number; ticks: number[] } {
  if (!(max > 0)) {
    return { top: 1, ticks: [0, 1] };
  }
  const rough = max / 3;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * magnitude).find((candidate) => candidate >= rough) ?? rough;
  const top = Math.ceil((max * 1.08) / step) * step;
  const ticks: number[] = [];
  for (let tick = 0; tick <= top + step / 1000; tick += step) {
    ticks.push(Number(tick.toFixed(6))); // i18n-ignore: an axis value, not a display string
  }
  return { top, ticks };
}

/**
 * Five weeks a column — the four before this one faded, this one solid, what
 * the calendar still holds for it hatched on top — with the four weeks' mean
 * as a dashed line whose figure stands over the line past the last column. A
 * column opens its week's figures on focus, and beside the pointer on hover.
 */
function WeekChart({
  title,
  weeks,
  average,
  format
}: {
  title: string;
  weeks: readonly ChartWeek[];
  average?: number;
  format: (value: number) => string;
}) {
  const { top, ticks } = axisFor(
    Math.max(average ?? 0, ...weeks.map((week) => week.value + (week.planned ?? 0)))
  );
  const at = (value: number) => `${(value / top) * 100}%`;
  return (
    <div className="overview-sport-chart">
      <p className="overview-sport-subhead">{title}</p>
      <div className="overview-sport-weeks" role="group" aria-label={title}>
        <div className="overview-sport-plot">
          {ticks.map((tick) => (
            <i key={tick} className="overview-sport-grid" style={{ bottom: at(tick) }} aria-hidden="true">
              <span>{format(tick)}</span>
            </i>
          ))}
          {average !== undefined && average > 0 ? (
            <i className="overview-sport-average" style={{ bottom: at(average) }} aria-hidden="true">
              <span>{t("overview.sport.average", { value: format(average) })}</span>
            </i>
          ) : null}
          <div className="overview-sport-columns">
            {weeks.map((week, index) => {
              const current = index === weeks.length - 1;
              return (
                <div
                  key={week.label}
                  className={`overview-sport-column${current ? " is-current" : ""}`}
                  role="img"
                  tabIndex={0}
                  aria-label={[week.dates, ...week.facts.map((fact) => `${fact.label} ${fact.value}`)].join(", ")}
                  onPointerMove={followTip}
                  onPointerLeave={releaseTip}
                >
                  {week.note ? <em aria-hidden="true">{week.note}</em> : null}
                  {week.planned && week.planned > 0 ? (
                    <b className="is-planned" style={{ height: at(week.planned) }} />
                  ) : null}
                  <b style={{ height: week.value > 0 ? at(week.value) : "2px" }} />
                  <span className={`overview-tip is-${index < 3 ? "after" : "before"}`} aria-hidden="true">
                    <strong>{week.dates}</strong>
                    <dl>
                      {week.facts.map((fact) => (
                        <div key={fact.label}>
                          <dt>{fact.label}</dt>
                          <dd>{fact.value}</dd>
                        </div>
                      ))}
                    </dl>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
        <div className="overview-sport-labels" aria-hidden="true">
          {weeks.map((week, index) => (
            <span key={week.label} className={index === weeks.length - 1 ? "is-current" : undefined}>
              {week.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

const SESSION_TYPE_KEYS: Readonly<Record<string, MessageKey>> = {
  intervals: "overview.sport.type.intervals",
  strides: "overview.sport.type.strides"
};

function sessionTypeName(key: SessionTypeCount["key"], ride: boolean): string {
  if (key === "long") {
    return t(ride ? "activity.benefit.format.longRide" : "activity.benefit.format.longRun");
  }
  const named = SESSION_TYPE_KEYS[key];
  return named ? t(named) : trainingBenefitName(key as Parameters<typeof trainingBenefitName>[0]);
}

/** How the window's sessions were labelled, most first, a bar each against the most. */
function SessionTypes({
  counts,
  note,
  ride,
  footer
}: {
  counts: readonly SessionTypeCount[];
  note: string;
  ride: boolean;
  footer?: string;
}) {
  const most = Math.max(1, ...counts.map((entry) => entry.count));
  return (
    <div className="overview-sport-types">
      <p className="overview-sport-subhead">
        {t("overview.sport.sessionTypes")} <span>· {note}</span>
      </p>
      {counts.length > 0 ? (
        <ul>
          {counts.map((entry) => (
            <li key={entry.key}>
              <span>{sessionTypeName(entry.key, ride)}</span>
              <i aria-hidden="true">
                <b style={{ width: `${(entry.count / most) * 100}%` }} />
              </i>
              <span className="figure">{whole(entry.count)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="overview-sport-note">{t("overview.sport.noTypes")}</p>
      )}
      {footer ? <p className="overview-sport-note">{footer}</p> : null}
    </div>
  );
}

function SessionFact({
  label,
  activity,
  meta,
  onOpenActivity
}: {
  label: string;
  activity: TrainingHubActivity;
  meta: string;
  onOpenActivity?: (activityId: string) => void;
}) {
  const name = activity.name?.trim() || label;
  return (
    <span>
      <span className="overview-sport-fact-label">{label}</span>{" "}
      {onOpenActivity ? (
        <button type="button" className="overview-sport-fact-link" onClick={() => onOpenActivity(activity.activityId)}>
          {name}
        </button>
      ) : (
        <span>{name}</span>
      )}{" "}
      <span className="overview-sport-fact-meta">· {meta}</span>
    </span>
  );
}

function Section({
  sport,
  icon: Icon,
  title,
  aside,
  screen,
  onOpenView,
  children
}: {
  sport: string;
  icon: LucideIcon;
  title: string;
  aside: string;
  screen: SportScreen;
  onOpenView?: (view: PrimaryView) => void;
  children: ReactNode;
}) {
  const id = `overview-sport-${screen}`;
  return (
    <section className="overview-section" aria-labelledby={id} data-sport={sport}>
      <div className="overview-section-head">
        <Icon className="overview-sport-icon" size={20} strokeWidth={2} aria-hidden="true" />
        <h2 id={id} className="overview-section-title">
          {title}
        </h2>
        <span className="overview-section-aside">{aside}</span>
        {onOpenView ? (
          <button
            type="button"
            className="overview-section-link"
            onClick={() => onOpenView(screen)}
            aria-label={t("overview.sport.open", { screen: title })}
          >
            {title}
            <ArrowUpRight size={14} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <div className="panel overview-sport">{children}</div>
    </section>
  );
}

/** Easy, moderate and hard by time, against the 80/20 line, with the time in each. */
function IntensitySplit({
  mix,
  note
}: {
  mix: ReturnType<typeof runIntensityMix>;
  note: string;
}) {
  const total = mix.easy.duration + mix.moderate.duration + mix.hard.duration;
  if (total <= 0) {
    return null;
  }
  const share = (seconds: number) => seconds / total;
  return (
    <div className="overview-sport-intensity">
      <p className="overview-sport-subhead">
        {t("overview.sport.intensity")} <span>· {note}</span>
      </p>
      <div className="overview-dist-split" aria-hidden="true">
        <div className="overview-dist-split-bar">
          <i data-intensity="easy" style={{ flex: share(mix.easy.duration) }} />
          <i data-intensity="moderate" style={{ flex: share(mix.moderate.duration) }} />
          <i data-intensity="hard" style={{ flex: share(mix.hard.duration) }} />
        </div>
        <b style={{ left: "80%" }} />
      </div>
      <dl className="overview-sport-split">
        {(["easy", "moderate", "hard"] as const).map((band) => (
          <div key={band}>
            <dt>{t(`overview.sport.${band}`)}</dt>
            <dd>
              <span className="figure">{formatDurationSpan(mix[band].duration)}</span>
              <span className="overview-sport-unit">{`${Math.round(share(mix[band].duration) * 100)}%`}</span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** What every sport section reads, worked out once for all three. */
interface SportContext {
  unitSystem: UnitSystem;
  nowMs: number;
  activities: TrainingHubActivity[];
  upcomingWorkouts: TrainingHubUpcomingWorkout[];
  summaries: ReturnType<typeof useActivityDetailSummaries>;
  family: ReturnType<typeof benefitZoneFamily>;
  onOpenActivity?: (activityId: string) => void;
  onOpenView?: (view: PrimaryView) => void;
}

function weekLabels<T extends { label: string }>(weeks: readonly T[]): string[] {
  return weeks.map((week, index) => (index === weeks.length - 1 ? t("overview.tiles.thisWeek") : week.label));
}

function NextFact({ next }: { next: TrainingHubUpcomingWorkout | undefined }) {
  return (
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
  );
}

function RunningSection({
  context,
  runs,
  window,
  zoneScale,
  vo2Readings
}: {
  context: SportContext;
  runs: TrainingHubActivity[];
  window: TrainingHubActivity[];
  zoneScale: Parameters<typeof runIntensityMix>[1];
  vo2Readings: readonly Vo2Reading[];
}) {
  const { unitSystem, nowMs, summaries, family, onOpenActivity, onOpenView } = context;
  const distUnit = distanceUnit(unitSystem);
  const weeks = buildRunWeeks(runs, { weeks: SPORT_CHART_WEEKS, nowMs });
  const values = weeks.map((week) => metersToDisplayDistance(week.distance, unitSystem));
  const average = previousWeeksAverage(values);
  const planned = plannedThisWeek(context.upcomingWorkouts, context.activities, "run");
  const plannedDistance = metersToDisplayDistance(planned.km * 1000, unitSystem);
  const totals = summariseRuns(window);
  const mix = runIntensityMix(window, zoneScale, summaries);
  const timed = mix.easy.duration + mix.moderate.duration + mix.hard.duration;
  const vo2 = [...vo2Readings].sort((left, right) => left.day.localeCompare(right.day)).at(-1)?.value;
  const surfaces = runSurfaceBreakdown(window)
    .map((entry) => `${RUN_SURFACE_LABELS[entry.surface]} ${distance(entry.distance, unitSystem)} ${distUnit}`)
    .join(" · ");
  const { longest, last } = longestAndLast(window, runs);
  const current = values[values.length - 1] ?? 0;
  const labels = weekLabels(weeks);
  return (
    <Section
      sport="run"
      icon={RunnerIcon}
      title={t("nav.running")}
      aside={`${plural("overview.sport.runs", window.length)} · ${periodPhrase(WINDOW_DAYS)}`}
      screen="running"
      onOpenView={onOpenView}
    >
      <Kpis
        items={[
          {
            label: t("overview.tiles.thisWeek"),
            value: formatDecimal(current, 1),
            unit: distUnit,
            note:
              plannedDistance > 0
                ? t("overview.sport.plannedAvg", {
                    planned: formatDecimal(plannedDistance, 1),
                    avg: formatDecimal(average ?? 0, 1)
                  })
                : t("overview.sport.average", { value: formatDecimal(average ?? 0, 1) })
          },
          {
            label: periodLabel(WINDOW_DAYS),
            value: distance(totals.distance, unitSystem),
            unit: distUnit,
            note: formatDurationSpan(totals.duration)
          },
          {
            label: t("overview.sport.runsLabel"),
            value: whole(totals.count),
            note: t("overview.sport.perWeek", { count: formatDecimal(totals.count / SPORT_WINDOW_WEEKS, 1) })
          },
          {
            label: t("overview.sport.vo2max"),
            value: vo2 !== undefined ? whole(vo2) : "–",
            note: t("overview.sport.corosEstimate")
          },
          {
            label: t("overview.sport.easyShare"),
            value: timed > 0 ? `${Math.round((mix.easy.duration / timed) * 100)}%` : "–",
            note: t("overview.sport.ofRunTime")
          }
        ]}
      />
      <div className="overview-sport-body">
        <WeekChart
          title={t("overview.sport.weeklyDistance", { unit: distUnit })}
          weeks={weeks.map((week, index) => {
            const planned = index === weeks.length - 1 ? plannedDistance : undefined;
            return {
              label: labels[index],
              value: values[index],
              planned,
              dates: weekRange(week.weekStartMs),
              facts: [
                { label: t("overview.sport.distance"), value: `${formatDecimal(values[index], 1)} ${distUnit}` },
                ...(planned && planned > 0
                  ? [{ label: t("overview.today.plannedTag"), value: `${formatDecimal(planned, 1)} ${distUnit}` }]
                  : []),
                ...weekFacts(week, t("overview.sport.runsLabel"))
              ]
            };
          })}
          average={average}
          format={(value) => formatDecimal(value, value >= 10 || value === 0 ? 0 : 1)}
        />
        <div className="overview-sport-side">
          <IntensitySplit
            mix={mix}
            note={t("overview.sport.zoneTimed", { count: mix.zoneTimed, total: window.length })}
          />
          <SessionTypes
            counts={sessionTypeCounts(window, summaries, family)}
            note={t("overview.sport.typesRunNote")}
            ride={false}
            footer={surfaces}
          />
        </div>
      </div>
      <div className="overview-sport-facts">
        {longest ? (
          <SessionFact
            label={t("overview.sport.longest")}
            activity={longest}
            meta={`${sessionDay(longest)} · ${distance(longest.distance ?? 0, unitSystem)} ${distUnit} · ${formatDurationSpan(longest.duration)}`}
            onOpenActivity={onOpenActivity}
          />
        ) : null}
        {last ? (
          <SessionFact
            label={t("overview.sport.last")}
            activity={last}
            meta={`${sessionDay(last)} · ${distance(last.distance ?? 0, unitSystem)} ${distUnit}`}
            onOpenActivity={onOpenActivity}
          />
        ) : null}
        <NextFact next={nextPlanned(context.upcomingWorkouts, "run")} />
      </div>
    </Section>
  );
}

function CyclingSection({
  context,
  rides,
  window,
  ftp
}: {
  context: SportContext;
  rides: TrainingHubActivity[];
  window: TrainingHubActivity[];
  ftp: number | undefined;
}) {
  const { unitSystem, nowMs, summaries, family, onOpenActivity, onOpenView } = context;
  const distUnit = distanceUnit(unitSystem);
  const climbUnit = elevationUnit(unitSystem);
  const weeks = buildRideWeeks(rides, { weeks: SPORT_CHART_WEEKS, nowMs });
  const seconds = weeks.map((week) => week.duration);
  const average = previousWeeksAverage(seconds);
  const current = seconds[seconds.length - 1] ?? 0;
  const delta = average && average > 0 ? Math.round(((current - average) / average) * 100) : undefined;
  const totals = summariseRides(window);
  const speed = totalsSpeedKmh(totals);
  const kinds = rideTypeBreakdown(window)
    .map((entry) => `${RIDE_TYPE_LABELS[entry.type]} ${formatDurationSpan(entry.duration)}`)
    .join(" · ");
  const { longest, last } = longestAndLast(window, rides);
  const labels = weekLabels(weeks);
  return (
    <Section
      sport="bike"
      icon={Bike}
      title={t("nav.cycling")}
      aside={`${plural("overview.sport.rides", window.length)} · ${periodPhrase(WINDOW_DAYS)}`}
      screen="cycling"
      onOpenView={onOpenView}
    >
      <Kpis
        items={[
          {
            label: t("overview.tiles.thisWeek"),
            value: formatDurationSpan(current),
            note:
              delta !== undefined && average !== undefined ? (
                <>
                  <span className={delta >= 0 ? "is-up" : "is-down"}>{`${delta >= 0 ? "+" : ""}${delta}%`}</span>{" "}
                  {t("overview.sport.vsAverage", { avg: formatDurationSpan(average) })}
                </>
              ) : undefined
          },
          {
            label: periodLabel(WINDOW_DAYS),
            value: formatDurationSpan(totals.duration),
            note: plural("overview.sport.rides", totals.count)
          },
          {
            label: t("overview.sport.distance"),
            value: distance(totals.distance, unitSystem),
            unit: distUnit,
            note:
              speed !== undefined
                ? t("overview.sport.moving", {
                    speed: `${formatDecimal(kmhToDisplaySpeed(speed, unitSystem), 1)} ${speedUnit(unitSystem)}`
                  })
                : undefined
          },
          {
            label: t("overview.sport.climb"),
            value: whole(metersToElevation(totals.elevationGain, unitSystem)),
            unit: climbUnit,
            note:
              totals.distance > 0
                ? t("overview.sport.perDistance", {
                    value: whole(climbPerDistanceUnit(totals.elevationGain / (totals.distance / 1000), unitSystem)),
                    unit: climbUnit,
                    per: distUnit
                  })
                : undefined
          },
          {
            label: t("overview.sport.ftp"),
            value: ftp ? whole(ftp) : "–",
            unit: ftp ? "W" : undefined,
            note: t("overview.sport.fromProfile")
          }
        ]}
      />
      <div className="overview-sport-body">
        <WeekChart
          title={t("overview.sport.weeklyRidingTime")}
          weeks={weeks.map((week, index) => ({
            label: labels[index],
            value: seconds[index] / 3600,
            dates: weekRange(week.weekStartMs),
            facts: [
              ...weekFacts(week, t("overview.sport.ridesLabel")),
              { label: t("overview.sport.distance"), value: `${distance(week.distance, unitSystem)} ${distUnit}` },
              {
                label: t("overview.sport.climb"),
                value: `${whole(metersToElevation(week.elevationGain, unitSystem))} ${climbUnit}`
              }
            ]
          }))}
          average={average !== undefined ? average / 3600 : undefined}
          format={(value) => formatDecimal(value, value === 0 || Number.isInteger(value) ? 0 : 1)}
        />
        <div className="overview-sport-side">
          <SessionTypes
            counts={sessionTypeCounts(window, summaries, family)}
            note={t("overview.sport.typesRideNote")}
            ride
            footer={kinds}
          />
        </div>
      </div>
      <div className="overview-sport-facts">
        {longest ? (
          <SessionFact
            label={t("overview.sport.longest")}
            activity={longest}
            meta={`${sessionDay(longest)} · ${distance(longest.distance ?? 0, unitSystem)} ${distUnit} · ${formatDurationSpan(longest.duration)}`}
            onOpenActivity={onOpenActivity}
          />
        ) : null}
        {last ? (
          <SessionFact
            label={t("overview.sport.last")}
            activity={last}
            meta={`${sessionDay(last)} · ${formatDurationSpan(last.duration)}`}
            onOpenActivity={onOpenActivity}
          />
        ) : null}
        <NextFact next={nextPlanned(context.upcomingWorkouts, "bike")} />
      </div>
    </Section>
  );
}

function HikingSection({
  context,
  hikes,
  window
}: {
  context: SportContext;
  hikes: TrainingHubActivity[];
  window: TrainingHubActivity[];
}) {
  const { unitSystem, nowMs, onOpenActivity, onOpenView } = context;
  const distUnit = distanceUnit(unitSystem);
  const climbUnit = elevationUnit(unitSystem);
  const weeks = buildHikeWeeks(hikes, { weeks: SPORT_CHART_WEEKS, nowMs });
  const values = weeks.map((week) => metersToElevation(week.elevationGain, unitSystem));
  const totals = summariseHikes(window);
  const rate = climbingRate(hikes, { days: WINDOW_DAYS, nowMs }).rate;
  const current = weeks[weeks.length - 1];
  // A week's column is named by its biggest hike, as the Hiking screen's chart names it.
  const biggestOf = (startMs: number) =>
    hikes
      .filter((hike) => {
        const ms = (hike.startTime ?? 0) * 1000;
        return ms >= startMs && ms < startMs + 7 * 86_400_000;
      })
      .sort((left, right) => (right.elevationGain ?? 0) - (left.elevationGain ?? 0))[0];
  const recent = [...window].sort((left, right) => (right.startTime ?? 0) - (left.startTime ?? 0)).slice(0, 3);
  const labels = weekLabels(weeks);
  const ascent = (meters: number) => whole(metersToElevation(meters, unitSystem));
  return (
    <Section
      sport="hiking"
      icon={Mountain}
      title={t("nav.hiking")}
      aside={`${plural("overview.sport.hikes", window.length)} · ${periodPhrase(WINDOW_DAYS)}`}
      screen="hiking"
      onOpenView={onOpenView}
    >
      <Kpis
        items={[
          {
            label: t("overview.sport.ascent"),
            value: ascent(totals.elevationGain),
            unit: climbUnit,
            note: t("overview.sport.perWeekValue", {
              value: `${ascent(totals.elevationGain / SPORT_WINDOW_WEEKS)} ${climbUnit}`
            })
          },
          {
            label: t("overview.sport.recordedTime"),
            value: formatDurationSpan(totals.duration),
            note: t("overview.sport.restsIncluded")
          },
          {
            label: t("overview.sport.distance"),
            value: distance(totals.distance, unitSystem),
            unit: distUnit,
            note: plural("overview.sport.hikes", totals.count)
          },
          {
            label: t("overview.sport.ascentRate"),
            value: rate !== undefined ? ascent(rate) : "–",
            unit: rate !== undefined ? `${climbUnit}/h` : undefined,
            note: t("overview.sport.minGain", { gain: `${ascent(CLIMBING_RATE_MIN_GAIN_M)} ${climbUnit}` })
          },
          {
            label: t("overview.tiles.thisWeek"),
            value: current && current.elevationGain > 0 ? ascent(current.elevationGain) : "–",
            unit: current && current.elevationGain > 0 ? climbUnit : undefined,
            note:
              current && current.count > 0
                ? plural("overview.sport.hikes", current.count)
                : t("overview.sport.noHikeYet")
          }
        ]}
      />
      <div className="overview-sport-body">
        <WeekChart
          title={t("overview.sport.weeklyAscent", { unit: climbUnit })}
          weeks={weeks.map((week, index) => ({
            label: labels[index],
            value: values[index],
            note: week.elevationGain > 0 ? biggestOf(week.weekStartMs)?.name?.trim() || undefined : undefined,
            dates: weekRange(week.weekStartMs),
            facts: [
              { label: t("overview.sport.ascent"), value: `${ascent(week.elevationGain)} ${climbUnit}` },
              ...weekFacts(week, t("overview.sport.hikesTitle")),
              { label: t("overview.sport.distance"), value: `${distance(week.distance, unitSystem)} ${distUnit}` }
            ]
          }))}
          format={(value) => whole(value)}
        />
        <div className="overview-sport-side">
          <p className="overview-sport-subhead">{t("overview.sport.hikesTitle")}</p>
          <ol className="overview-sport-hikes">
            {recent.map((hike) => {
              const ascentRate = hikeAscentRate(hike);
              return (
                <li key={hike.activityId}>
                  <button
                    type="button"
                    className="overview-sport-hike"
                    onClick={onOpenActivity ? () => onOpenActivity(hike.activityId) : undefined}
                    disabled={!onOpenActivity}
                  >
                    <span className="overview-sport-hike-icon" aria-hidden="true">
                      <Mountain size={18} strokeWidth={2} />
                    </span>
                    <span className="overview-sport-hike-copy">
                      <strong>{hike.name?.trim() || t("nav.hiking")}</strong>
                      <span>
                        {`${sessionDay(hike)} · ${distance(hike.distance ?? 0, unitSystem)} ${distUnit} · ${formatDurationSpan(hike.duration)}`}
                      </span>
                    </span>
                    <span className="overview-sport-hike-figures">
                      <span>
                        <span className="figure">{ascent(hike.elevationGain ?? 0)}</span>
                        <span className="overview-sport-unit">{climbUnit}</span>
                      </span>
                      {ascentRate !== undefined ? <span>{formatVerticalRate(ascentRate, unitSystem)}</span> : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </Section>
  );
}

/**
 * One section a sport the athlete has trained in the last four weeks —
 * Running, Cycling, Hiking — each its own screen's figures in brief, with the
 * way out to that screen. A sport whose screen is taken off the rail has no
 * section here either.
 */
export function OverviewSports({
  api,
  connected,
  activities,
  upcomingWorkouts,
  profile,
  hrZoneModel,
  zonesSettled,
  lthrZones,
  vo2Readings,
  hiddenSportScreens = [],
  onOpenActivity,
  onOpenView
}: {
  api: HeraclesRecordsApi;
  connected: boolean;
  activities: TrainingHubActivity[];
  upcomingWorkouts: TrainingHubUpcomingWorkout[];
  profile: CorosProfile | null;
  hrZoneModel: HeartRateZoneModel | null;
  zonesSettled: boolean;
  lthrZones: TrainingHubThresholdZone[];
  vo2Readings: readonly Vo2Reading[];
  hiddenSportScreens?: readonly SportScreen[];
  onOpenActivity?: (activityId: string) => void;
  onOpenView?: (view: PrimaryView) => void;
}) {
  useI18n();
  const { unitSystem } = useUnitSystem();
  const runs = useMemo(() => runsOnly(activities), [activities]);
  const rides = useMemo(() => ridesOnly(activities), [activities]);
  const hikes = useMemo(() => hikesOnly(activities), [activities]);
  const runWindow = useMemo(() => sportWindow(runs, Date.now()), [runs]);
  const rideWindow = useMemo(() => sportWindow(rides, Date.now()), [rides]);
  const hikeWindow = useMemo(() => sportWindow(hikes, Date.now()), [hikes]);
  const showRuns = runWindow.length > 0 && !hiddenSportScreens.includes("running");
  const showRides = rideWindow.length > 0 && !hiddenSportScreens.includes("cycling");
  const showHikes = hikeWindow.length > 0 && !hiddenSportScreens.includes("hiking");
  // The labels and the time in zone come off the sessions' summaries, swept as
  // the Running and Cycling lists sweep theirs.
  const labelled = useMemo(
    () => [...(showRuns ? runWindow : []), ...(showRides ? rideWindow : [])],
    [showRuns, showRides, runWindow, rideWindow]
  );
  const summaries = useActivityDetailSummaries({
    api,
    activities: labelled,
    enabled: connected && labelled.length > 0,
    requireIntensity: true
  });
  const context: SportContext = {
    unitSystem,
    nowMs: Date.now(),
    activities,
    upcomingWorkouts,
    summaries,
    family: benefitZoneFamily({ settled: zonesSettled, model: hrZoneModel }),
    onOpenActivity,
    onOpenView
  };
  return (
    <>
      {showRuns ? (
        <RunningSection
          context={context}
          runs={runs}
          window={runWindow}
          zoneScale={hrZoneModel ?? { family: "lthr", zones: lthrZones }}
          vo2Readings={vo2Readings}
        />
      ) : null}
      {showRides ? (
        <CyclingSection context={context} rides={rides} window={rideWindow} ftp={profile?.thresholds.ftp} />
      ) : null}
      {showHikes ? <HikingSection context={context} hikes={hikes} window={hikeWindow} /> : null}
    </>
  );
}
