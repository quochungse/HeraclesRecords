import { useMemo, type ReactNode } from "react";
import { Bike, Dumbbell, Footprints, Mountain } from "lucide-react";
import type {
  CorosProfile,
  ActivityDetailSummary,
  TrainingHubActivity,
} from "../../../electron/types";
import type { TrainingHubSnapshot } from "../types";
import type { SportScreen } from "../../navigation/sportScreens";
import type { HeartRateZoneModel } from "../heartRateZoneModel";
import { useUnitSystem } from "../../units/UnitSystemProvider";
import { rideTypeColors } from "../../cycling/rideTypeColors";
import {
  distanceUnit,
  elevationUnit,
  metersToDisplayDistance,
  metersToElevation,
  formatVerticalRate,
} from "../../units/units";
import { formatCount, formatDecimal, t } from "../../i18n/core";
import {
  formatDistanceMeters,
  formatDurationSpan,
  formatElevationMeters,
  getLocalHappenDayKey,
} from "../formatters";
import { mergeTrainingDayLists } from "../parsers";
import {
  buildRunWeeks,
  runIntensityMix,
  runSurfaceBreakdown,
  summariseRuns,
} from "../../running/runMetrics";
import { RUN_SURFACE_LABELS, runsOnly } from "../../running/runSurface";
import {
  buildRideWeeks,
  rideTypeBreakdown,
  summariseRides,
} from "../../cycling/rideMetrics";
import { RIDE_TYPE_LABELS, ridesOnly } from "../../cycling/rideType";
import {
  buildHikeWeeks,
  climbingRate,
  summariseHikes,
} from "../../hiking/hikeMetrics";
import { hikesOnly } from "../../hiking/hikeType";
import {
  OVERVIEW_DAYS,
  OVERVIEW_WEEKS,
  overviewActivities,
} from "./overviewModel";
import {
  OverviewHeading,
  OverviewStat,
  OverviewVolumeChart,
  overviewTone,
  overviewDate,
  weekLabels,
} from "./OverviewParts";

export function OverviewSportSection({
  sport,
  onOpen,
  children,
}: {
  sport: SportScreen;
  onOpen?: (sport: SportScreen) => void;
  children: ReactNode;
}) {
  const icons = {
    running: Footprints,
    cycling: Bike,
    hiking: Mountain,
    strength: Dumbbell,
  };
  const colors = {
    running: "run",
    cycling: "bike",
    hiking: "hiking",
    strength: "strength",
  };
  const Icon = icons[sport];
  const titles = {
    running: t("nav.running"),
    cycling: t("nav.cycling"),
    hiking: t("nav.hiking"),
    strength: t("nav.strength"),
  };
  return (
    <section
      className="overview-sport"
      data-overview-sport={sport}
      style={overviewTone(`var(--sport-${colors[sport]})`)}
    >
      <OverviewHeading
        title={titles[sport]}
        icon={<Icon size={20} />}
        onOpen={onOpen ? () => onOpen(sport) : undefined}
      />
      <div className="panel overview-sport-panel">{children}</div>
    </section>
  );
}

function SportMix({
  title,
  rows,
  note,
  loading = false,
}: {
  title: string;
  rows: { label: string; value: number; display: string; color: string }[];
  note?: string;
  loading?: boolean;
}) {
  const sum = rows.reduce((s, r) => s + r.value, 0);
  return (
    <div className="overview-mix">
      <h3>{title}</h3>
      {loading ? (
        <p className="overview-caption" role="status">{t("overview.zones.reading")}</p>
      ) : sum > 0 ? (
        <>
          <div className="overview-mix-track" aria-hidden="true">
            {rows
              .filter((r) => r.value > 0)
              .map((r) => (
                <i
                  key={r.label}
                  style={{ flex: r.value, background: r.color }}
                />
              ))}
          </div>
          {rows.map((r) => (
            <div className="overview-mix-row" key={r.label}>
              <span>
                <i style={{ background: r.color }} />
                {r.label}
              </span>
              <strong>{r.display}</strong>
              <small>{formatDecimal((r.value / sum) * 100, 0)}%</small>
            </div>
          ))}
        </>
      ) : (
        <p className="overview-caption">{t("overview.noData")}</p>
      )}
      {!loading && note && <p className="overview-caption">{note}</p>}
    </div>
  );
}

function SportHighlight({
  label,
  activity,
}: {
  label: string;
  activity?: TrainingHubActivity;
}) {
  const { unitSystem } = useUnitSystem();
  return (
    <div className="overview-sport-highlight">
      <span className="overview-caption">{label}</span>
      <strong>{activity?.name ?? t("overview.noData")}</strong>
      {activity && (
        <p>
          {overviewDate(
            getLocalHappenDayKey(new Date((activity.startTime ?? 0) * 1000)),
          )}{" "}
          · {formatDurationSpan(activity.duration)} ·{" "}
          {formatDistanceMeters(activity.distance, unitSystem)}
        </p>
      )}
    </div>
  );
}


export function OverviewSports({
  activities,
  snapshot,
  profile,
  model,
  summaries,
  summariesLoading,
  hidden = [],
  onOpen,
}: {
  activities: TrainingHubActivity[];
  snapshot: TrainingHubSnapshot | null;
  profile: CorosProfile | null;
  model: HeartRateZoneModel | null;
  summaries: ReadonlyMap<string, ActivityDetailSummary>;
  summariesLoading: boolean;
  hidden?: readonly SportScreen[];
  onOpen?: (sport: SportScreen) => void;
}) {
  const { unitSystem } = useUnitSystem();
  const today = getLocalHappenDayKey();
  const {
    runs, rides, hikes, recentRuns, recentRides, recentHikes,
    run, ride, hike, runWeeks, rideWeeks, hikeWeeks, climb, rideMix, surfaces,
  } = useMemo(() => {
    const now = new Date();
    const completed = activities.filter((a) => (a.startTime ?? Infinity) * 1000 <= +now);
    const recent = overviewActivities(completed, now);
    const runs = runsOnly(completed);
    const rides = ridesOnly(completed);
    const hikes = hikesOnly(completed);
    const recentRuns = runsOnly(recent);
    const recentRides = ridesOnly(recent);
    const recentHikes = hikesOnly(recent);
    const weekOptions = { weeks: OVERVIEW_WEEKS, nowMs: +now };
    return {
      runs, rides, hikes, recentRuns, recentRides, recentHikes,
      run: summariseRuns(recentRuns),
      ride: summariseRides(recentRides),
      hike: summariseHikes(recentHikes),
      runWeeks: buildRunWeeks(runs, weekOptions),
      rideWeeks: buildRideWeeks(rides, weekOptions),
      hikeWeeks: buildHikeWeeks(hikes, weekOptions),
      climb: climbingRate(hikes, { days: OVERVIEW_DAYS, nowMs: +now }),
      rideMix: rideTypeBreakdown(recentRides),
      surfaces: runSurfaceBreakdown(recentRuns),
    };
  }, [activities, today]);
  const days = useMemo(() => mergeTrainingDayLists(
    snapshot?.dailyMetrics ?? null,
    snapshot?.analytics ?? null,
  ).filter((d) => d.happenDay <= today), [snapshot, today]);
  const vo2 = (field: "vo2max" | "cycleVo2max") => {
    for (let i = days.length - 1; i >= 0; i--) {
      const value = days[i][field];
      if (value !== undefined && Number.isFinite(value) && value > 0) return value;
    }
    return undefined;
  };
  const runMix = useMemo(
    () => model ? runIntensityMix(recentRuns, model, summaries) : undefined,
    [model, recentRuns, summaries],
  );
  const rideColors = rideTypeColors();
  const longest = (
    items: TrainingHubActivity[],
    field: "duration" | "distance",
  ) => items.reduce<TrainingHubActivity | undefined>(
    (best, item) => (item[field] ?? 0) > (best?.[field] ?? 0) ? item : best,
    undefined,
  );
  const window = t("overview.sleepTrend.lastDays", { days: OVERVIEW_DAYS });
  return (
    <div className="overview-sports">
      {!hidden.includes("running") && runs.length > 0 && (
        <OverviewSportSection sport="running" onOpen={onOpen}>
          <div className="overview-sport-metrics">
            <OverviewStat
              label={`${t("overview.tiles.distance")} · ${window}`}
              value={formatDistanceMeters(run.distance, unitSystem)}
            />
            <OverviewStat
              label={t("overview.tiles.duration")}
              value={formatDurationSpan(run.duration)}
            />
            <OverviewStat
              label={t("strength.summary.sessions")}
              value={formatCount(run.count)}
            />
            <OverviewStat label="VO₂max" value={vo2("vo2max") ?? "—"} />
          </div>
          <div className="overview-sport-body">
            <div>
              <OverviewVolumeChart
                values={runWeeks.map((w) =>
                  metersToDisplayDistance(w.distance, unitSystem),
                )}
                labels={weekLabels(runWeeks)}
                weeks={runWeeks}
                color="var(--sport-run)"
                unit={distanceUnit(unitSystem)}
                title={t("run.volume.title")}
              />
              <p className="overview-sport-caption">
                {surfaces.map((surface) => (
                  <span key={surface.surface}>
                    {RUN_SURFACE_LABELS[surface.surface]}: {formatDistanceMeters(surface.distance, unitSystem)}
                  </span>
                ))}
              </p>
            </div>
            <SportMix
              title={t("activity.intensity.title")}
              loading={summariesLoading}
              rows={
                runMix
                  ? [
                      {
                        label: t("activity.intensity.easy"),
                        value: runMix.easy.duration,
                        display: formatDurationSpan(runMix.easy.duration),
                        color: "var(--sport-run)",
                      },
                      {
                        label: t("activity.intensity.moderate"),
                        value: runMix.moderate.duration,
                        display: formatDurationSpan(runMix.moderate.duration),
                        color: "var(--accent)",
                      },
                      {
                        label: t("activity.intensity.hard"),
                        value: runMix.hard.duration,
                        display: formatDurationSpan(runMix.hard.duration),
                        color: "var(--sport-strength)",
                      },
                      ...(runMix.unrated.duration > 0
                        ? [
                            {
                              label: t("common.unknown"),
                              value: runMix.unrated.duration,
                              display: formatDurationSpan(
                                runMix.unrated.duration,
                              ),
                              color: "var(--text-muted)",
                            },
                          ]
                        : []),
                    ]
                  : []
              }
              note={
                runMix
                  ? t("activity.intensity.mixed.run", {
                      placed: runMix.zoneTimed,
                      total: run.count,
                    })
                  : t("activity.intensity.noZones")
              }
            />
          </div>
          <div className="overview-sport-footer">
            <SportHighlight
              label={t("run.volume.longest")}
              activity={longest(recentRuns, "distance")}
            />
            <OverviewStat
              label={t("overview.zones.frequency")}
              value={formatDecimal(run.count / (OVERVIEW_DAYS / 7), 1)}
              unit={t("overview.briefing.perWeek")}
            />
          </div>
        </OverviewSportSection>
      )}
      {!hidden.includes("cycling") && rides.length > 0 && (
        <OverviewSportSection sport="cycling" onOpen={onOpen}>
          <div className="overview-sport-metrics is-five">
            <OverviewStat
              label={`${t("overview.tiles.duration")} · ${window}`}
              value={formatDurationSpan(ride.duration)}
            />
            <OverviewStat
              label={t("overview.tiles.distance")}
              value={formatDistanceMeters(ride.distance, unitSystem)}
            />
            <OverviewStat
              label={t("activity.m.climb")}
              value={formatElevationMeters(ride.elevationGain, unitSystem)}
            />
            <OverviewStat
              label="FTP"
              value={
                profile?.thresholds.ftp !== undefined
                  ? `${formatCount(profile.thresholds.ftp)} W`
                  : "—"
              }
            />
            <OverviewStat label="VO₂max" value={vo2("cycleVo2max") ?? "—"} />
          </div>
          <div className="overview-sport-body">
            <OverviewVolumeChart
              values={rideWeeks.map((w) => w.duration / 3600)}
              labels={weekLabels(rideWeeks)}
              weeks={rideWeeks}
              color="var(--sport-bike)"
              unit={t("strength.unit.h")}
              title={t("run.volume.title")}
            />
            <SportMix
              title={t("overview.briefing.ridingMix")}
              rows={rideMix.map((r) => ({
                label: RIDE_TYPE_LABELS[r.type],
                value: r.duration,
                display: formatDurationSpan(r.duration),
                color: rideColors[r.type],
              }))}
            />
          </div>
          <div className="overview-sport-footer">
            <SportHighlight
              label={t("ride.volume.longest")}
              activity={longest(recentRides, "duration")}
            />
            <OverviewStat
              label={t("overview.briefing.averageSession")}
              value={
                ride.count
                  ? formatDurationSpan(ride.duration / ride.count)
                  : "—"
              }
            />
          </div>
        </OverviewSportSection>
      )}
      {!hidden.includes("hiking") && hikes.length > 0 && (
        <OverviewSportSection sport="hiking" onOpen={onOpen}>
          <div className="overview-sport-metrics">
            <OverviewStat
              label={`${t("activity.m.climb")} · ${window}`}
              value={formatElevationMeters(hike.elevationGain, unitSystem)}
            />
            <OverviewStat
              label={t("overview.tiles.duration")}
              value={formatDurationSpan(hike.duration)}
            />
            <OverviewStat
              label={t("overview.tiles.distance")}
              value={formatDistanceMeters(hike.distance, unitSystem)}
            />
            <OverviewStat
              label={t("strength.summary.sessions")}
              value={formatCount(hike.count)}
            />
          </div>
          <div className="overview-sport-body">
            <OverviewVolumeChart
              values={hikeWeeks.map((w) =>
                metersToElevation(w.elevationGain, unitSystem),
              )}
              labels={weekLabels(hikeWeeks)}
              weeks={hikeWeeks}
              color="var(--sport-hiking)"
              unit={elevationUnit(unitSystem)}
              title={t("run.volume.title")}
            />
            <div className="overview-mix">
              <h3>{t("hike.list.ascentRate")}</h3>
              <strong className="overview-climbing-rate">
                {climb.rate !== undefined
                  ? formatVerticalRate(climb.rate, unitSystem)
                  : "—"}
              </strong>
              <p className="overview-caption">
                {t("overview.briefing.hikeRate", {
                  floor: formatElevationMeters(300, unitSystem),
                })}
              </p>
            </div>
          </div>
          <div className="overview-sport-footer">
            <SportHighlight
              label={t("hike.volume.longestDay")}
              activity={longest(recentHikes, "duration")}
            />
            <OverviewStat
              label={t("overview.briefing.averageSession")}
              value={
                hike.count
                  ? formatDurationSpan(hike.duration / hike.count)
                  : "—"
              }
            />
          </div>
        </OverviewSportSection>
      )}
    </div>
  );
}
