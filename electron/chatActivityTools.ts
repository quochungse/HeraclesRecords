import {
  getTrainingHubStatus,
  getTrainingHubActivityDetail,
  listTrainingHubActivities,
  downsampleActivitySeries,
  formatActivitySeriesForChat
} from "./trainingHubService";
import type {
  ActivityHrTrendPreview,
  ActivityVisualLapPoint,
  ActivityVisualPreview,
  CorosMcpTool,
  StrengthDetail,
  StrengthExercise,
  TrainingHubActivity,
  TrainingHubActivityDetail,
  TrainingHubActivityDynamics,
  TrainingHubActivityEffect,
  TrainingHubActivityLap,
  TrainingHubActivitySeriesPoint,
  TrainingHubActivityWeather,
  TrainingHubActivityZoneBucket,
  UnitSystem
} from "./types";
import {
  distanceUnit,
  elevationUnit,
  formatDistanceValue,
  formatElevationValue,
  formatPaceValue,
  formatSpeedValue,
  formatWeightValue,
  metersToElevation,
  secondsPerKmToDisplayPace
} from "./unitSystem.js";

export const CHAT_ACTIVITY_TOOL_NAMES = [
  "list_recent_activities",
  "get_activity_detail"
] as const;

export type ChatActivityToolName = (typeof CHAT_ACTIVITY_TOOL_NAMES)[number];

const MAX_LAPS = 50;

export function isChatActivityTool(name: string): name is ChatActivityToolName {
  return (CHAT_ACTIVITY_TOOL_NAMES as readonly string[]).includes(name);
}

export function getChatActivityTools(): CorosMcpTool[] {
  const hubStatus = getTrainingHubStatus();
  if (!hubStatus.authenticated) {
    return [];
  }

  return [
    {
      name: "list_recent_activities",
      description:
        "List recent COROS activities with activity_id and sport_type needed for " +
        "get_activity_detail. Prefer this over COROS MCP when you need reliable lap data.",
      inputSchema: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Number of activities to return (default 10, max 25)"
          },
          page: {
            type: "number",
            description: "Page number for pagination (default 1)"
          }
        }
      }
    },
    {
      name: "get_activity_detail",
      description:
        "Fetch detailed COROS activity data: local start time and weekday; the " +
        "lap/split breakdown (distance, duration, avg/max HR, pace, elevation gain, " +
        "and the running-form group — cadence, stride length, ground contact time, " +
        "vertical oscillation, vertical ratio, power), labelled with the " +
        "structured-workout phase of each lap where the watch recorded one " +
        "(warm-up/work/recovery/cool-down, or set/rest in the gym); the activity's " +
        "own HR zone split; grade-adjusted pace; average and peak of every " +
        "running-form metric; how pace, HR and running form drifted from the first " +
        "third of the activity to the last; total ascent and descent plus an " +
        "eight-segment elevation profile showing where the climbing happened; " +
        "aerobic and anaerobic training effect; VO2max; the weather it was run in; " +
        "and for a strength session the set-by-set breakdown with reps and load. " +
        "Use activity_id and sport_type from list_recent_activities or the training " +
        "snapshot. Prefer this local tool over COROS MCP for lap and split analysis.",
      inputSchema: {
        type: "object",
        properties: {
          activity_id: {
            type: "string",
            description: "COROS activity ID (labelId)"
          },
          sport_type: {
            type: "number",
            description: "COROS sport type code from the activity list"
          },
          include_series: {
            type: "boolean",
            description:
              "Include the downsampled sample-by-sample table (~60 points): elapsed " +
              "time, distance, HR, pace, power, and whichever of altitude, cadence, " +
              "stride length, ground contact time, vertical oscillation and vertical " +
              "ratio the watch recorded. Default false; the summary, form trend and " +
              "lap table already cover most questions."
          }
        },
        required: ["activity_id", "sport_type"]
      }
    }
  ];
}

export interface ChatActivityToolCallbacks {
  onActivityVisual?: (preview: ActivityVisualPreview) => void;
  requestId?: string;
  unitSystem?: UnitSystem;
}

export async function handleChatActivityTool(
  name: ChatActivityToolName,
  args: Record<string, unknown>,
  callbacks?: ChatActivityToolCallbacks
): Promise<string> {
  if (name === "list_recent_activities") {
    return handleListRecentActivities(args, callbacks?.unitSystem ?? "metric");
  }
  return handleGetActivityDetail(args, callbacks);
}

async function handleListRecentActivities(
  args: Record<string, unknown>,
  unitSystem: UnitSystem
): Promise<string> {
  const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 25);
  const page = Math.max(Number(args.page) || 1, 1);

  try {
    const activities = await listTrainingHubActivities(page, limit);
    if (activities.length === 0) {
      return "No recent activities found in COROS Training Hub.";
    }

    const lines = activities.map((activity) =>
      formatActivityListLine(activity, unitSystem)
    );
    return [
      `Recent activities (${activities.length}):`,
      "",
      ...lines,
      "",
      "Use get_activity_detail with activity_id and sport_type for lap splits."
    ].join("\n");
  } catch (caught) {
    throw formatActivityToolError("list_recent_activities", caught);
  }
}

async function handleGetActivityDetail(
  args: Record<string, unknown>,
  callbacks?: ChatActivityToolCallbacks
): Promise<string> {
  const activityId = String(args.activity_id ?? args.activityId ?? "").trim();
  const sportType = Number(args.sport_type ?? args.sportType);

  if (!activityId) {
    throw new Error(
      "activity_id is required. Call list_recent_activities first to find the correct ID."
    );
  }
  if (!Number.isFinite(sportType)) {
    throw new Error(
      "sport_type is required. Copy it from list_recent_activities or the training snapshot."
    );
  }

  const includeSeries = args.include_series === true || args.includeSeries === true;

  try {
    const listActivities = await listTrainingHubActivities(1, 50);
    const listActivity = listActivities.find(
      (activity) => activity.activityId === activityId
    );
    const detail = await getTrainingHubActivityDetail(
      activityId,
      sportType,
      listActivity
    );

    if (!detail.laps.length && !detail.duration && !detail.distance) {
      return (
        `No activity detail found for activity_id=${activityId} sport_type=${sportType}. ` +
        "Check the ID and sport type from list_recent_activities."
      );
    }

    if (callbacks?.onActivityVisual && callbacks.requestId) {
      const preview = buildActivityVisualPreview(detail, callbacks.requestId);
      if (preview) {
        callbacks.onActivityVisual(preview);
      }
    }

    return formatActivityDetailForChat(
      detail,
      includeSeries,
      callbacks?.unitSystem ?? "metric"
    );
  } catch (caught) {
    throw formatActivityToolError("get_activity_detail", caught);
  }
}

function mapLapPoints(laps: TrainingHubActivityLap[]): ActivityVisualLapPoint[] {
  return laps.slice(0, MAX_LAPS).map((lap) => ({
    index: lap.index,
    avgHr: lap.avgHr,
    maxHr: lap.maxHr,
    distance: lap.distance,
    duration: lap.duration,
    pace: lap.pace,
    avgCadence: lap.avgCadence
  }));
}

export function migrateActivityHrTrendPreview(
  legacy: ActivityHrTrendPreview
): ActivityVisualPreview {
  return {
    previewId: legacy.previewId,
    activityId: legacy.activityId,
    name: legacy.name,
    startTime: legacy.startTime,
    avgHr: legacy.avgHr,
    maxHr: legacy.maxHr,
    sections: {
      hr: {
        chartKind: legacy.chartKind,
        series: legacy.series,
        laps: legacy.laps
      }
    }
  };
}

export function buildActivityVisualPreview(
  detail: TrainingHubActivityDetail,
  requestId: string
): ActivityVisualPreview | null {
  const activityId = detail.activityId?.trim();
  if (!activityId) {
    return null;
  }

  const downsampled =
    detail.series && detail.series.length > 0
      ? downsampleActivitySeries(detail.series)
      : [];

  const sections: ActivityVisualPreview["sections"] = {};

  const hrSeriesPoints = downsampled.filter(
    (point) => point.hr !== undefined && Number.isFinite(point.hr)
  );
  const hrLaps = detail.laps.filter(
    (lap) => lap.avgHr !== undefined && Number.isFinite(lap.avgHr)
  );

  if (hrSeriesPoints.length >= 2) {
    sections.hr = { chartKind: "series", series: downsampled };
  } else if (hrLaps.length >= 2) {
    sections.hr = {
      chartKind: "laps",
      laps: mapLapPoints(hrLaps)
    };
  }

  const pacePoints = downsampled.filter(
    (point) => point.pace !== undefined && Number.isFinite(point.pace)
  );
  if (pacePoints.length >= 2) {
    sections.pace = { series: downsampled };
  }

  const powerPoints = downsampled.filter(
    (point) => point.power !== undefined && Number.isFinite(point.power)
  );
  if (powerPoints.length >= 2) {
    sections.power = { series: downsampled };
  }

  // Cadence falls back to per-lap averages the way heart rate does. Plenty of
  // COROS payloads carry the form group on the laps and not as a sample
  // channel, and a cadence chart that only appears on the activities that
  // happen to record samples is a chart the athlete cannot rely on.
  const cadencePoints = downsampled.filter(
    (point) => point.cadence !== undefined && Number.isFinite(point.cadence)
  );
  const cadenceLaps = detail.laps.filter(
    (lap) => lap.avgCadence !== undefined && Number.isFinite(lap.avgCadence)
  );
  if (cadencePoints.length >= 2) {
    sections.cadence = { chartKind: "series", series: downsampled };
  } else if (cadenceLaps.length >= 2) {
    sections.cadence = { chartKind: "laps", laps: mapLapPoints(cadenceLaps) };
  }

  const elevationPoints = (detail.track?.points ?? []).filter(
    (point) => point.elevation !== undefined && Number.isFinite(point.elevation)
  );
  if (elevationPoints.length >= 2) {
    sections.elevation = { points: elevationPoints };
  }

  if (detail.laps.length > 0) {
    sections.laps = mapLapPoints(detail.laps);
  }

  if (Object.keys(sections).length === 0) {
    return null;
  }

  return {
    previewId: `${activityId}:${requestId}`,
    activityId,
    sportType: detail.sportType,
    name: detail.name,
    startTime: detail.startTime ? formatIsoDate(detail.startTime) : undefined,
    avgHr: detail.avgHr,
    maxHr: detail.maxHr,
    sections
  };
}

/** @deprecated Use buildActivityVisualPreview */
export function buildActivityHrTrendPreview(
  detail: TrainingHubActivityDetail,
  requestId: string
): ActivityHrTrendPreview | null {
  const preview = buildActivityVisualPreview(detail, requestId);
  if (!preview?.sections.hr) {
    return null;
  }

  const hr = preview.sections.hr;
  return {
    previewId: preview.previewId,
    activityId: preview.activityId,
    name: preview.name,
    startTime: preview.startTime,
    avgHr: preview.avgHr,
    maxHr: preview.maxHr,
    chartKind: hr.chartKind,
    series: hr.series,
    laps: hr.laps
  };
}

function formatActivityToolError(tool: string, caught: unknown): Error {
  const detail = caught instanceof Error ? caught.message : String(caught);
  if (/not authenticated|sign in/i.test(detail)) {
    return new Error(
      `${tool} failed: Training Hub is not signed in. Ask the athlete to connect COROS in Settings.`
    );
  }
  if (/not found|404/i.test(detail)) {
    return new Error(
      `${tool} failed: activity not found. Verify activity_id and sport_type from list_recent_activities.`
    );
  }
  return new Error(`${tool} failed: ${detail}`);
}

function isSwimActivity(sportType: number | undefined, sportName?: string): boolean {
  return sportType === 300 || sportType === 301 || /swim/i.test(sportName ?? "");
}

function isCyclingActivity(sportType: number | undefined, sportName?: string): boolean {
  return (sportType !== undefined && sportType >= 200 && sportType <= 299) ||
    /bike|cycl|ride/i.test(sportName ?? "");
}

function formatActivityListLine(
  activity: TrainingHubActivity,
  unitSystem: UnitSystem
): string {
  const parts = [
    `id=${activity.activityId}`,
    `sport_type=${activity.sportType}`,
    activity.startTime ? formatActivityStart(activity.startTime) : undefined,
    activity.sportName ?? undefined,
    activity.name ?? undefined,
    activity.distance
      ? formatDistanceValue(activity.distance, unitSystem, {
          swim: isSwimActivity(activity.sportType, activity.sportName)
        })
      : undefined,
    activity.duration ? formatDurationSeconds(activity.duration) : undefined,
    activity.avgHr ? `avg HR ${activity.avgHr}` : undefined,
    activity.maxHr ? `max HR ${activity.maxHr}` : undefined,
    activity.trainingLoad ? `load ${activity.trainingLoad}` : undefined
  ].filter(Boolean);
  return `- ${parts.join(" · ")}`;
}

export function formatActivityDetailForChat(
  detail: TrainingHubActivityDetail,
  includeSeries: boolean,
  unitSystem: UnitSystem = "metric"
): string {
  const swim = isSwimActivity(detail.sportType, detail.sportName);
  const cycling = isCyclingActivity(detail.sportType, detail.sportName);
  const performance = detail.distance && detail.duration
    ? cycling
      ? `Avg speed: ${formatSpeedValue((detail.distance / 1000) / (detail.duration / 3600), unitSystem)}`
      : !swim
        ? `Avg pace: ${formatPaceSeconds(detail.duration / (detail.distance / 1000), unitSystem)}`
        : undefined
    : undefined;
  const summaryParts = [
    detail.name ? `Name: ${detail.name}` : undefined,
    detail.activityId ? `Activity ID: ${detail.activityId}` : undefined,
    detail.sportType !== undefined ? `Sport type: ${detail.sportType}` : undefined,
    detail.startTime ? `Start: ${formatActivityStart(detail.startTime)}` : undefined,
    detail.distance
      ? `Distance: ${formatDistanceValue(detail.distance, unitSystem, { swim })}`
      : undefined,
    detail.duration ? `Duration: ${formatDurationSeconds(detail.duration)}` : undefined,
    performance,
    detail.adjustedPace
      ? `Adjusted pace (grade-adjusted): ${formatPaceSeconds(detail.adjustedPace, unitSystem)}`
      : undefined,
    detail.avgHr ? `Avg HR: ${detail.avgHr} bpm` : undefined,
    detail.maxHr ? `Max HR: ${detail.maxHr} bpm` : undefined,
    formatElevationTotals(detail, unitSystem),
    detail.trainingLoad ? `Training load: ${detail.trainingLoad}` : undefined,
    detail.calories ? `Calories: ${Math.round(detail.calories)}` : undefined
  ].filter(Boolean);

  const sections = ["Activity detail", summaryParts.join("\n")];

  const context = [
    formatActivityDynamics(detail.dynamics, cycling),
    formatActivityEffect(detail.effect),
    formatActivityWeather(detail.weather)
  ].filter(Boolean);
  if (context.length > 0) {
    sections.push("", context.join("\n"));
  }

  const formTrend = formatFormTrend(detail, unitSystem, cycling);
  if (formTrend) {
    sections.push("", formTrend);
  }

  const zones = formatActivityHrZones(detail.hrZones);
  if (zones) {
    sections.push("", zones);
  }

  const elevationProfile = formatElevationProfile(detail, unitSystem, swim);
  if (elevationProfile) {
    sections.push("", elevationProfile);
  }

  if (detail.laps.length > 0) {
    sections.push("", formatLapTable(detail.laps, unitSystem, swim, cycling));
  } else {
    sections.push("", "Laps: none recorded for this activity.");
  }

  const strength = formatStrengthDetailForChat(detail.strength, unitSystem);
  if (strength) {
    sections.push("", strength);
  }

  if (includeSeries) {
    sections.push("");
    if (detail.series && detail.series.length > 0) {
      sections.push(
        formatActivitySeriesForChat(
          downsampleActivitySeries(detail.series),
          unitSystem,
          swim,
          cycling
        )
      );
    } else {
      sections.push(
        "Time series: HR/pace samples are not available in the COROS detail response for this activity. " +
          "For full per-second data, export the FIT file from Heracles Records."
      );
    }
  }

  return sections.join("\n");
}

/**
 * Running/cycling dynamics stay in metric with the unit spelled out, in both
 * unit systems. They are reported that way by COROS and read that way in the
 * literature; converting stride length to feet or ground contact to anything
 * else would invent a convention the athlete has never seen on their watch.
 * Pace and distance still follow the athlete's chosen units.
 */
function formatActivityDynamics(
  dynamics: TrainingHubActivityDynamics | undefined,
  cycling: boolean
): string | undefined {
  if (!dynamics) {
    return undefined;
  }

  const cadenceUnit = cycling ? "rpm" : "spm";
  const parts = [
    withMax(dynamics.avgCadence, dynamics.maxCadence, `cadence`, cadenceUnit, 0),
    withMax(
      dynamics.strideLength,
      dynamics.maxStrideLength,
      "stride length",
      "m",
      2
    ),
    withMax(dynamics.groundTime, dynamics.maxGroundTime, "ground contact", "ms", 0),
    withMax(
      dynamics.verticalOscillation,
      dynamics.maxVerticalOscillation,
      "vertical oscillation",
      "cm",
      1
    ),
    withMax(
      dynamics.verticalRatio,
      dynamics.maxVerticalRatio,
      "vertical ratio",
      "%",
      1
    ),
    withMax(dynamics.avgPower, dynamics.maxPower, "power", "W", 0)
  ].filter(Boolean);

  return parts.length > 0
    ? `${cycling ? "Cycling" : "Running"} dynamics: ${parts.join(" · ")}`
    : undefined;
}

/**
 * `label average unit (max maximum)`, with the unit written once. The peak of
 * each form channel was parsed and dropped before; it is what separates a
 * steady stride from one that spiked, and the parser already refuses a maximum
 * that COROS reported below its own average.
 */
function withMax(
  average: number | undefined,
  maximum: number | undefined,
  label: string,
  unit: string,
  decimals: number
): string | undefined {
  if (average === undefined) {
    return undefined;
  }

  const separator = unit === "%" ? "" : " ";
  const base = `${label} ${average.toFixed(decimals)}${separator}${unit}`;
  return maximum === undefined
    ? base
    : `${base} (max ${maximum.toFixed(decimals)})`;
}

function formatActivityEffect(
  effect: TrainingHubActivityEffect | undefined
): string | undefined {
  if (!effect) {
    return undefined;
  }

  const parts = [
    effect.aerobic !== undefined
      ? `aerobic ${effect.aerobic.toFixed(1)}/5`
      : undefined,
    effect.anaerobic !== undefined
      ? `anaerobic ${effect.anaerobic.toFixed(1)}/5`
      : undefined,
    effect.vo2max !== undefined
      ? `VO2max ${Math.round(effect.vo2max)}`
      : undefined
  ].filter(Boolean);

  return parts.length > 0 ? `Training effect: ${parts.join(" · ")}` : undefined;
}

function formatActivityWeather(
  weather: TrainingHubActivityWeather | undefined
): string | undefined {
  if (!weather) {
    return undefined;
  }

  const parts = [
    weather.temperatureC !== undefined
      ? `${weather.temperatureC.toFixed(1)} °C`
      : undefined,
    weather.feelsLikeC !== undefined
      ? `feels like ${weather.feelsLikeC.toFixed(1)} °C`
      : undefined,
    weather.humidityPct !== undefined
      ? `humidity ${Math.round(weather.humidityPct)}%`
      : undefined
  ].filter(Boolean);

  return parts.length > 0 ? `Conditions: ${parts.join(" · ")}` : undefined;
}


/**
 * Ascent and descent on one line. COROS reports both and only the climb was
 * ever shown, which reads a point-to-point descent as a flat run.
 */
function formatElevationTotals(
  detail: TrainingHubActivityDetail,
  unitSystem: UnitSystem
): string | undefined {
  const parts = [
    detail.elevationGain
      ? `+${formatElevationValue(detail.elevationGain, unitSystem)}`
      : undefined,
    detail.elevationLoss
      ? `-${formatElevationValue(detail.elevationLoss, unitSystem)}`
      : undefined
  ].filter(Boolean);

  return parts.length > 0 ? `Elevation: ${parts.join(" / ")}` : undefined;
}

const ELEVATION_PROFILE_SEGMENTS = 8;

/** Below this total spread there is no terrain worth eight lines of profile. */
const FLAT_COURSE_RANGE_METERS = 10;

/**
 * Where the climbing actually happened.
 *
 * The recorded altitude track was parsed for the chart card and never reached
 * the coach in text, so a lap that lost a minute to a hill looked like a lap
 * the athlete faded on. Eight segments is enough to place a climb without
 * turning the tool result into a terrain dump.
 */
function formatElevationProfile(
  detail: TrainingHubActivityDetail,
  unitSystem: UnitSystem,
  swim: boolean
): string | undefined {
  const points = (detail.track?.points ?? []).filter(
    (point) => point.elevation !== undefined && Number.isFinite(point.elevation)
  );
  if (points.length < ELEVATION_PROFILE_SEGMENTS) {
    return undefined;
  }

  const elevations = points.map((point) => point.elevation!);
  const lowest = Math.min(...elevations);
  const highest = Math.max(...elevations);

  // A flat course has nothing to say here, and "0 → 1 m" eight times over is
  // noise the coach has to read past.
  if (highest - lowest < FLAT_COURSE_RANGE_METERS) {
    return (
      "Elevation profile: flat — the recorded altitude varies by less than " +
      `${formatElevationValue(FLAT_COURSE_RANGE_METERS, unitSystem)} across the activity.`
    );
  }

  const size = points.length / ELEVATION_PROFILE_SEGMENTS;
  const rows: string[] = [];
  // Segments are labelled by where each one ends, carrying the previous end
  // forward as the next one's start. Reading the start off the segment's own
  // first point instead would leave the opening segment unlabelled: a track
  // begins at distance 0, which the parser reads as "not recorded".
  let previousEnd = 0;

  for (let index = 0; index < ELEVATION_PROFILE_SEGMENTS; index += 1) {
    const start = Math.floor(index * size);
    const end = Math.min(points.length, Math.floor((index + 1) * size));
    const segment = points.slice(start, end);
    if (segment.length === 0) {
      continue;
    }

    const from = segment[0]!;
    const to = segment[segment.length - 1]!;
    const label =
      to.distance !== undefined
        ? `${formatDistanceValue(previousEnd, unitSystem, { swim })}–` +
          `${formatDistanceValue(to.distance, unitSystem, { swim })}`
        : `segment ${index + 1}/${ELEVATION_PROFILE_SEGMENTS}`;
    previousEnd = to.distance ?? previousEnd;

    // Both ends are converted before the change is taken, so the bracketed
    // number is in the same unit as the two either side of the arrow.
    const fromDisplay = metersToElevation(from.elevation!, unitSystem);
    const toDisplay = metersToElevation(to.elevation!, unitSystem);
    rows.push(
      `- ${label}: ${Math.round(fromDisplay)} → ${Math.round(toDisplay)} ` +
        `${elevationUnit(unitSystem)} (${signedNumber(toDisplay - fromDisplay, 0)})`
    );
  }

  return [
    `Elevation profile (range ${formatElevationValue(lowest, unitSystem)}–` +
      `${formatElevationValue(highest, unitSystem)}):`,
    ...rows
  ].join("\n");
}

/** A signed change, with `-0.00` normalised to `0.00`. */
function signedNumber(value: number, decimals: number): string {
  const rounded = Number(value.toFixed(decimals)) || 0;
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(decimals)}`;
}

interface FormTrendSample {
  value: number;
  weight: number;
}

interface FormTrendMetric {
  label: string;
  fromPoint: (point: TrainingHubActivitySeriesPoint) => number | undefined;
  fromLap: (lap: TrainingHubActivityLap) => number | undefined;
  render: (first: number, last: number, unitSystem: UnitSystem) => string;
}

function numericTrend(unit: string, decimals: number) {
  const separator = unit === "%" ? "" : " ";
  return (first: number, last: number): string =>
    `${first.toFixed(decimals)} → ${last.toFixed(decimals)}${separator}${unit} ` +
    `(${signedNumber(last - first, decimals)})`;
}

/**
 * Pace renders as pace on both sides but its change renders as plain seconds,
 * in the athlete's own distance unit: "5:12/km → 5:31/km (+19 s/km)" is a
 * number a coach can act on, where a pace-formatted difference of 0:19 reads
 * like a lap split.
 */
function paceTrend(first: number, last: number, unitSystem: UnitSystem): string {
  const change =
    secondsPerKmToDisplayPace(last, unitSystem) -
    secondsPerKmToDisplayPace(first, unitSystem);
  return (
    `${formatPaceSeconds(first, unitSystem)} → ${formatPaceSeconds(last, unitSystem)} ` +
    `(${signedNumber(change, 0)} s/${distanceUnit(unitSystem)})`
  );
}

function formTrendMetrics(cadenceUnit: string): FormTrendMetric[] {
  return [
    {
      label: "pace",
      fromPoint: (point) => point.pace,
      fromLap: (lap) => lap.pace,
      render: paceTrend
    },
    {
      label: "HR",
      fromPoint: (point) => point.hr,
      fromLap: (lap) => lap.avgHr,
      render: numericTrend("bpm", 0)
    },
    {
      label: "cadence",
      fromPoint: (point) => point.cadence,
      fromLap: (lap) => lap.avgCadence,
      render: numericTrend(cadenceUnit, 0)
    },
    {
      label: "stride length",
      fromPoint: (point) => point.strideLength,
      fromLap: (lap) => lap.strideLength,
      render: numericTrend("m", 2)
    },
    {
      label: "ground contact",
      fromPoint: (point) => point.groundTime,
      fromLap: (lap) => lap.groundTime,
      render: numericTrend("ms", 0)
    },
    {
      label: "vertical oscillation",
      fromPoint: (point) => point.verticalOscillation,
      fromLap: (lap) => lap.verticalOscillation,
      render: numericTrend("cm", 1)
    },
    {
      label: "vertical ratio",
      fromPoint: (point) => point.verticalRatio,
      fromLap: (lap) => lap.verticalRatio,
      render: numericTrend("%", 1)
    },
    {
      label: "power",
      fromPoint: (point) => point.power,
      fromLap: (lap) => lap.avgPower,
      render: numericTrend("W", 0)
    }
  ];
}

const MIN_FORM_TREND_SAMPLES = 4;

/**
 * Weighted means of the first and last third of a channel. Thirds rather than
 * halves so the middle of the activity — where a negative split turns around —
 * cannot cancel the drift out.
 */
function weightedThirds(samples: FormTrendSample[]): [number, number] | undefined {
  if (samples.length < MIN_FORM_TREND_SAMPLES) {
    return undefined;
  }

  const size = Math.max(1, Math.floor(samples.length / 3));
  const mean = (slice: FormTrendSample[]): number => {
    const weight = slice.reduce((sum, sample) => sum + sample.weight, 0);
    return weight > 0
      ? slice.reduce((sum, sample) => sum + sample.value * sample.weight, 0) / weight
      : Number.NaN;
  };

  const first = mean(samples.slice(0, size));
  const last = mean(samples.slice(-size));
  return Number.isFinite(first) && Number.isFinite(last) ? [first, last] : undefined;
}

/**
 * Laps to read a whole-activity trend from.
 *
 * A structured session's laps are not comparable to each other — its first
 * third is the warm-up and its last third the cool-down, so a naive comparison
 * reports every interval workout as a collapse. Where COROS labelled the work
 * reps, only those are compared; otherwise every lap is, weighted by its own
 * duration so an auto-lap sprint does not count as much as a 10-minute block.
 */
function formTrendLaps(laps: TrainingHubActivityLap[]): {
  laps: TrainingHubActivityLap[];
  label: string;
} {
  const work = laps.filter((lap) => lap.phase === "work");
  return work.length >= MIN_FORM_TREND_SAMPLES
    ? { laps: work, label: `${work.length} work laps` }
    : { laps, label: `${laps.length} laps` };
}

/**
 * How pace, HR and the running-form group moved across the activity.
 *
 * Every one of these numbers was already being reported as a single average,
 * which cannot distinguish a run held together to the finish from one where
 * cadence fell and ground contact climbed over the last third. Read from the
 * time series when the watch recorded per-sample form, and from the lap table
 * otherwise — laps always carry the form group, so this works on any activity
 * with enough of them.
 */
function formatFormTrend(
  detail: TrainingHubActivityDetail,
  unitSystem: UnitSystem,
  cycling: boolean
): string | undefined {
  const metrics = formTrendMetrics(cycling ? "rpm" : "spm");
  const series = detail.series ?? [];

  const fromSeries = (metric: FormTrendMetric): FormTrendSample[] =>
    series
      .map((point) => metric.fromPoint(point))
      .filter((value): value is number => value !== undefined)
      .map((value) => ({ value, weight: 1 }));

  const trendLaps = formTrendLaps(detail.laps);
  const fromLaps = (metric: FormTrendMetric): FormTrendSample[] =>
    trendLaps.laps
      .map((lap) => ({ value: metric.fromLap(lap), weight: lap.duration ?? 1 }))
      .filter((sample): sample is FormTrendSample => sample.value !== undefined);

  // One source for the whole block, so every row is measured over the same
  // stretch of the activity and the rows can be read against each other.
  const seriesRows = countUsable(metrics, fromSeries);
  const lapRows = countUsable(metrics, fromLaps);
  if (seriesRows === 0 && lapRows === 0) {
    return undefined;
  }

  const useSeries = seriesRows >= lapRows;
  const pick = useSeries ? fromSeries : fromLaps;
  const source = useSeries
    ? `${series.length} recorded samples`
    : trendLaps.label;

  const rows = metrics
    .map((metric) => {
      const thirds = weightedThirds(pick(metric));
      return thirds
        ? `- ${metric.label}: ${metric.render(thirds[0], thirds[1], unitSystem)}`
        : undefined;
    })
    .filter(Boolean);

  if (rows.length === 0) {
    return undefined;
  }

  return [`Trend across the activity (first third → last third, ${source}):`, ...rows].join(
    "\n"
  );
}

function countUsable(
  metrics: FormTrendMetric[],
  pick: (metric: FormTrendMetric) => FormTrendSample[]
): number {
  return metrics.filter((metric) => weightedThirds(pick(metric)) !== undefined).length;
}

const MAX_STRENGTH_EXERCISES = 20;
const MAX_STRENGTH_SETS = 12;
const EXERCISE_CODE_RE = /^[TS]\d/;

/**
 * COROS labels a library exercise with a `T####`/`S####` code and only sends a
 * readable name for custom ones. The renderer resolves those codes through
 * `src/training/exerciseNames.json`, which the main process cannot import —
 * `tsconfig.electron.json` roots the build at `electron/` — so the code is
 * printed verbatim when that is all there is. The coach can still read the
 * sets, reps and load, which is what the numbers are for.
 */
function strengthExerciseLabel(exercise: StrengthExercise): string {
  const raw = exercise.rawName?.trim();
  return raw && !EXERCISE_CODE_RE.test(raw) ? raw : exercise.nameKey;
}

/**
 * The set-by-set breakdown of a gym session.
 *
 * `parseStrengthDetail` has always populated this and the chat formatter never
 * printed it, so asking the coach about a strength activity returned its
 * duration and average HR and nothing about what was lifted.
 */
function formatStrengthDetailForChat(
  strength: StrengthDetail | undefined,
  unitSystem: UnitSystem
): string | undefined {
  if (!strength || strength.exercises.length === 0) {
    return undefined;
  }

  const { summary } = strength;
  const headline = [
    summary.exercises ? `${summary.exercises} exercises` : undefined,
    summary.sets ? `${summary.sets} sets` : undefined,
    summary.totalReps ? `${summary.totalReps} reps` : undefined,
    summary.totalWeightKg
      ? `${formatWeightValue(summary.totalWeightKg, unitSystem)} total volume`
      : undefined
  ].filter(Boolean);

  const rows = strength.exercises
    .slice(0, MAX_STRENGTH_EXERCISES)
    .map((exercise) => {
      const sets = exercise.entries
        .slice(0, MAX_STRENGTH_SETS)
        .map((entry) =>
          entry.weightKg > 0
            ? `${formatWeightValue(entry.weightKg, unitSystem)} x${entry.reps}`
            : `${entry.reps} reps`
        );
      if (exercise.entries.length > MAX_STRENGTH_SETS) {
        sets.push(`… ${exercise.entries.length - MAX_STRENGTH_SETS} more`);
      }

      const heading = [
        strengthExerciseLabel(exercise),
        `${exercise.sets} sets`,
        `${exercise.totalReps} reps`
      ].join(" — ");
      return `- ${heading}: ${sets.join(", ")}`;
    });

  if (strength.exercises.length > MAX_STRENGTH_EXERCISES) {
    rows.push(
      `… ${strength.exercises.length - MAX_STRENGTH_EXERCISES} more exercises omitted`
    );
  }

  return [
    headline.length > 0 ? `Strength: ${headline.join(" · ")}` : "Strength:",
    ...rows
  ].join("\n");
}

/**
 * The activity's own zone split, which is what makes "this easy run spent a
 * third of its time in Z3" sayable. Zones with no time are dropped rather than
 * printed as rows of zeros.
 */
function formatActivityHrZones(
  zones: TrainingHubActivityZoneBucket[] | undefined
): string | undefined {
  const used = (zones ?? []).filter((zone) => (zone.seconds ?? 0) > 0);
  if (used.length === 0) {
    return undefined;
  }

  const rows = used.map((zone) => {
    const label =
      zone.index === 0
        ? `Below Z1${zone.high !== undefined ? ` (<${zone.high} bpm)` : ""}`
        : `Z${zone.index}` +
          (zone.low !== undefined && zone.high !== undefined
            ? ` ${zone.low}–${zone.high} bpm`
            : "");
    const time = formatDurationSeconds(zone.seconds ?? 0);
    return `- ${label}: ${time}${
      zone.percent !== undefined ? ` (${Math.round(zone.percent)}%)` : ""
    }`;
  });

  return ["HR zones (this activity):", ...rows].join("\n");
}

interface LapDynamicsColumn {
  header: string;
  value: (lap: TrainingHubActivityLap) => string | undefined;
}

/**
 * Only columns some lap actually carries are added, so a pool swim or a gym
 * session keeps the narrow table it had before. Elevation gain and vertical
 * oscillation are per-lap fields the parser has always filled and this table
 * never showed — the first is what explains a slow uphill lap, and the second
 * completes the form group the other columns start.
 */
function lapDynamicsColumns(unitSystem: UnitSystem): LapDynamicsColumn[] {
  return [
    {
      header: "Climb",
      value: (lap) =>
        lap.elevationGain
          ? `+${formatElevationValue(lap.elevationGain, unitSystem)}`
          : undefined
    },
    { header: "Cad", value: (lap) => lap.avgCadence?.toFixed(0) },
    { header: "Stride (m)", value: (lap) => lap.strideLength?.toFixed(2) },
    { header: "GCT (ms)", value: (lap) => lap.groundTime?.toFixed(0) },
    { header: "VO (cm)", value: (lap) => lap.verticalOscillation?.toFixed(1) },
    { header: "Vert ratio (%)", value: (lap) => lap.verticalRatio?.toFixed(1) },
    { header: "Power (W)", value: (lap) => lap.avgPower?.toFixed(0) }
  ];
}

const LAP_PHASE_LABELS: Record<string, string> = {
  warmup: "warm-up",
  work: "work",
  recovery: "recovery",
  cooldown: "cool-down",
  set: "set",
  rest: "rest"
};

function formatLapTable(
  laps: TrainingHubActivityLap[],
  unitSystem: UnitSystem,
  swim: boolean,
  cycling: boolean
): string {
  const capped = laps.slice(0, MAX_LAPS);
  const dynamicsColumns = lapDynamicsColumns(unitSystem).filter((column) =>
    capped.some((lap) => column.value(lap) !== undefined)
  );
  const hasPhases = capped.some((lap) => lap.phase !== undefined);
  const header = [
    "Lap",
    ...(hasPhases ? ["Phase"] : []),
    "Distance",
    "Duration",
    "Avg HR",
    "Max HR",
    cycling ? "Speed" : "Pace",
    ...dynamicsColumns.map((column) => column.header)
  ].join(" | ");
  const rows = capped.map((lap) => {
    const cols = [
      String(lap.index),
      ...(hasPhases ? [lap.phase ? LAP_PHASE_LABELS[lap.phase] ?? lap.phase : "—"] : []),
      lap.distance ? formatDistanceValue(lap.distance, unitSystem, { swim }) : "—",
      lap.duration ? formatDurationSeconds(lap.duration) : "—",
      lap.avgHr ? `${lap.avgHr}` : "—",
      lap.maxHr ? `${lap.maxHr}` : "—",
      cycling && lap.distance && lap.duration
        ? formatSpeedValue((lap.distance / 1000) / (lap.duration / 3600), unitSystem)
        : lap.pace ? formatPaceSeconds(lap.pace, unitSystem) : "—",
      ...dynamicsColumns.map((column) => column.value(lap) ?? "—")
    ];
    return cols.join(" | ");
  });

  const lines = ["Laps:", header, ...rows];
  if (laps.length > MAX_LAPS) {
    lines.push(`… ${laps.length - MAX_LAPS} more laps omitted`);
  }
  if (hasPhases) {
    // The phase comes off the COROS lap mode rather than being measured, so it
    // is offered as the watch's own labelling and the HR and pace columns are
    // left to confirm it.
    lines.push(
      "Phase is the structured-workout role COROS recorded for each lap; " +
        "read it against the HR and pace columns."
    );
  }
  return lines.join("\n");
}

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function padTwo(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * The activity's calendar date in machine-local time.
 *
 * This used to be `toISOString().slice(0, 10)`, which dates an activity by its
 * UTC day: a 06:00 run in UTC+7 came back filed under the previous date, and a
 * late evening run in UTC-5 under the next one. COROS sends an epoch and the
 * rest of the app reads it locally, so this does too.
 */
function formatIsoDate(epochSeconds: number): string {
  const date = new Date(epochSeconds * 1000);
  return `${date.getFullYear()}-${padTwo(date.getMonth() + 1)}-${padTwo(date.getDate())}`;
}

/**
 * Date plus time of day and weekday. The hour is what makes "ran at 13:20 in
 * 30 °C" and "third early morning session this week" sayable, and it is also
 * what separates two activities filed on the same day.
 */
function formatActivityStart(epochSeconds: number): string {
  const date = new Date(epochSeconds * 1000);
  const clock = `${padTwo(date.getHours())}:${padTwo(date.getMinutes())}`;
  return `${formatIsoDate(epochSeconds)} ${clock} (${WEEKDAY_NAMES[date.getDay()]})`;
}

function formatDurationSeconds(value: number): string {
  const total = Math.max(0, Math.round(value));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatPaceSeconds(
  paceSecondsPerKm: number,
  unitSystem: UnitSystem = "metric"
): string {
  return formatPaceValue(paceSecondsPerKm, unitSystem).replace(" /", "/");
}

export { formatDurationSeconds, formatPaceSeconds };
