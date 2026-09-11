import {
  getCoachCorosProfile,
  getDailyMetrics,
  getTrainingAnalytics,
  getTrainingDashboard,
  getTrainingHubStatus
} from "./trainingHubService";
import { buildTrendPoints, mergeTrainingDayLists, recentTrainingHubDateList } from "./trainingTrendUtils";
import { formatDurationSeconds, formatPaceSeconds } from "./chatActivityTools";
import type {
  CorosMcpTool,
  CorosProfile,
  CorosProfileZone,
  CorosProfileZoneFamily,
  FitnessTrendPreview,
  HrZonePreview,
  TrainingHubDailyMetric,
  TrainingHubDashboard,
  TrainingHubThresholdZone,
  TrainingHubZoneDistributionEntry,
  TrainingHubZoneDistributions,
  UnitSystem
} from "./types";
import { formatDistanceValue } from "./unitSystem.js";

export const CHAT_ANALYTICS_TOOL_NAMES = [
  "get_fitness_trends",
  "get_training_zones"
] as const;

export type ChatAnalyticsToolName = (typeof CHAT_ANALYTICS_TOOL_NAMES)[number];

export function isChatAnalyticsTool(name: string): name is ChatAnalyticsToolName {
  return (CHAT_ANALYTICS_TOOL_NAMES as readonly string[]).includes(name);
}

export interface ChatAnalyticsToolCallbacks {
  onFitnessTrend?: (preview: FitnessTrendPreview) => void;
  onHrZoneSummary?: (preview: HrZonePreview) => void;
  requestId?: string;
  unitSystem?: UnitSystem;
}

const DEFAULT_TREND_DAYS = 7;
const MAX_TREND_DAYS = 90;
/** Up to this many days a window is read day by day; a longer one by week. */
const DAILY_TABLE_MAX_DAYS = 14;
/** The daily tail kept under a weekly roll-up, where "this week" lives. */
const DAILY_TAIL_DAYS = 7;

export function getChatAnalyticsTools(): CorosMcpTool[] {
  const hubStatus = getTrainingHubStatus();
  if (!hubStatus.authenticated) {
    return [];
  }

  return [
    {
      name: "get_fitness_trends",
      description:
        "COROS load and recovery markers per day: training load (and RPE load), " +
        "resting HR, overnight HRV vs baseline, Load Impact, load ratio " +
        "(acute:chronic, ~1.0 = steady), Base Fitness and VO2max (recorded on run " +
        "days only), led by a summary of the latest values and 7-day load totals. " +
        "Windows over 14 days are rolled up by week with the last 7 days kept " +
        "daily. Pick days to fit the question: 7 for this week, 28 for a block.",
      inputSchema: {
        type: "object",
        properties: {
          days: {
            type: "integer",
            minimum: 1,
            maximum: MAX_TREND_DAYS,
            description: `Days back from today (default ${DEFAULT_TREND_DAYS}, max ${MAX_TREND_DAYS}).`
          }
        }
      }
    },
    {
      name: "get_training_zones",
      description:
        "The athlete's own COROS zone tables — heart rate (on whichever model " +
        "the account is set to), running pace against threshold pace, and " +
        "cycling power against FTP — plus how the last 4 weeks were spent " +
        "across the HR zones, by time, training load and distance. Use it " +
        "before prescribing any HR, pace or power target instead of inferring " +
        "ranges from recent activities.",
      inputSchema: {
        type: "object",
        properties: {
          metric: {
            type: "string",
            enum: ["time", "distance", "trainingLoad"],
            description:
              "Which measure the chart card shows (default trainingLoad). The text always carries all three."
          }
        }
      }
    }
  ];
}

export async function handleChatAnalyticsTool(
  name: ChatAnalyticsToolName,
  args: Record<string, unknown>,
  callbacks?: ChatAnalyticsToolCallbacks
): Promise<string> {
  if (name === "get_fitness_trends") {
    return handleGetFitnessTrends(args, callbacks);
  }
  return handleGetTrainingZones(args, callbacks);
}

export function parseTrendDays(value: unknown): number {
  const days = Math.round(Number(value));
  return Number.isFinite(days) && days >= 1
    ? Math.min(days, MAX_TREND_DAYS)
    : DEFAULT_TREND_DAYS;
}

async function handleGetFitnessTrends(
  args: Record<string, unknown>,
  callbacks?: ChatAnalyticsToolCallbacks
): Promise<string> {
  const days = parseTrendDays(args.days);

  try {
    // The dashboard used to be a third read here, for the latest resting HR and
    // recovery — both already in the snapshot every turn carries.
    const [analytics, dailyMetrics] = await Promise.all([
      getTrainingAnalytics(),
      getDailyMetrics(recentTrainingHubDateList(days))
    ]);

    const window = trendWindow(mergeTrainingDayLists(dailyMetrics, analytics), days);
    const preview = buildFitnessTrendPreview(
      buildTrendPoints(window, window.length),
      callbacks?.requestId,
      days
    );

    if (preview && callbacks?.onFitnessTrend) {
      callbacks.onFitnessTrend(preview);
    }

    return formatFitnessTrendsForChat(window, days);
  } catch (caught) {
    throw formatAnalyticsToolError("get_fitness_trends", caught);
  }
}

// ----- Fitness trends -------------------------------------------------------

function padTwo(value: number): string {
  return String(value).padStart(2, "0");
}

function dayKeyDaysAgo(today: Date, offset: number): string {
  const date = new Date(today);
  date.setDate(date.getDate() - offset);
  return `${date.getFullYear()}${padTwo(date.getMonth() + 1)}${padTwo(date.getDate())}`;
}

function dateFromDayKey(day: string): Date {
  return new Date(Number(day.slice(0, 4)), Number(day.slice(4, 6)) - 1, Number(day.slice(6, 8)));
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "09-07 Sun": the year is in the heading, the weekday is what a coach reads. */
function dayLabel(day: string): string {
  return `${day.slice(4, 6)}-${day.slice(6, 8)} ${WEEKDAYS[dateFromDayKey(day).getDay()]}`;
}

function hasReading(day: TrainingHubDailyMetric): boolean {
  return [
    day.trainingLoad,
    day.rpeLoad,
    day.rhr,
    day.avgSleepHrv,
    day.tiredRateNew,
    day.trainingLoadRatio,
    day.staminaLevel,
    day.vo2max
  ].some((value) => value !== undefined && Number.isFinite(value));
}

/**
 * The days inside the window, oldest first. Filtered by date rather than taken
 * as the last N rows: the day list has gaps, and `getDailyMetrics` appends
 * RPE-only days from a whole year back, so the last seven rows are not the
 * last seven days.
 */
export function trendWindow(
  dayList: TrainingHubDailyMetric[],
  days: number,
  today: Date = new Date()
): TrainingHubDailyMetric[] {
  const from = dayKeyDaysAgo(today, days - 1);
  const to = dayKeyDaysAgo(today, 0);
  return dayList
    .filter(
      (day) =>
        /^\d{8}$/.test(day.happenDay) &&
        day.happenDay >= from &&
        day.happenDay <= to &&
        hasReading(day)
    )
    .sort((left, right) => left.happenDay.localeCompare(right.happenDay));
}

interface Column<Row> {
  header: string;
  value: (row: Row) => string | undefined;
}

/**
 * A pipe table with only the columns some row fills — an athlete without an
 * HRV-capable watch should not cost the coach a column of dashes.
 */
function pipeTable<Row>(rows: Row[], key: Column<Row>, columns: Column<Row>[]): string[] {
  const used = columns.filter((column) => rows.some((row) => column.value(row) !== undefined));
  return [
    [key.header, ...used.map((column) => column.header)].join(" | "),
    ...rows.map((row) =>
      [key.value(row) ?? "—", ...used.map((column) => column.value(row) ?? "—")].join(" | ")
    )
  ];
}

function rounded(value: number | undefined): string | undefined {
  return value === undefined || !Number.isFinite(value) ? undefined : String(Math.round(value));
}

function defined(values: (number | undefined)[]): number[] {
  return values.filter((value): value is number => value !== undefined && Number.isFinite(value));
}

function sumOf(values: (number | undefined)[]): number | undefined {
  const present = defined(values);
  return present.length > 0 ? present.reduce((total, value) => total + value, 0) : undefined;
}

function meanOf(values: (number | undefined)[]): number | undefined {
  const present = defined(values);
  return present.length > 0
    ? present.reduce((total, value) => total + value, 0) / present.length
    : undefined;
}

/** The newest day carrying a value, with the value. */
function latestOf(
  window: TrainingHubDailyMetric[],
  pick: (day: TrainingHubDailyMetric) => number | undefined
): { day: string; value: number } | undefined {
  for (let index = window.length - 1; index >= 0; index -= 1) {
    const value = pick(window[index]!);
    if (value !== undefined && Number.isFinite(value)) {
      return { day: window[index]!.happenDay, value };
    }
  }
  return undefined;
}

function firstOf(
  window: TrainingHubDailyMetric[],
  pick: (day: TrainingHubDailyMetric) => number | undefined
): { day: string; value: number } | undefined {
  for (const day of window) {
    const value = pick(day);
    if (value !== undefined && Number.isFinite(value)) {
      return { day: day.happenDay, value };
    }
  }
  return undefined;
}

function hrvCell(hrv: number | undefined, base: number | undefined): string | undefined {
  if (hrv === undefined) {
    return undefined;
  }
  return base !== undefined ? `${Math.round(hrv)} (${Math.round(base)})` : `${Math.round(hrv)}`;
}

function statusColumns<Row>(
  pick: (row: Row) => Pick<
    TrainingHubDailyMetric,
    "tiredRateNew" | "trainingLoadRatio" | "staminaLevel" | "vo2max"
  >
): Column<Row>[] {
  return [
    { header: "Load Impact", value: (row) => rounded(pick(row).tiredRateNew) },
    { header: "Load ratio", value: (row) => pick(row).trainingLoadRatio?.toFixed(2) },
    { header: "Base Fitness", value: (row) => rounded(pick(row).staminaLevel) },
    { header: "VO2max", value: (row) => rounded(pick(row).vo2max) }
  ];
}

function dailyTable(window: TrainingHubDailyMetric[]): string[] {
  return pipeTable(window, { header: "Day", value: (day) => dayLabel(day.happenDay) }, [
    { header: "Load", value: (day) => rounded(day.trainingLoad) },
    { header: "RPE load", value: (day) => rounded(day.rpeLoad) },
    { header: "RHR", value: (day) => rounded(day.rhr) },
    { header: "HRV (baseline)", value: (day) => hrvCell(day.avgSleepHrv, day.sleepHrvBase) },
    ...statusColumns((day: TrainingHubDailyMetric) => day)
  ]);
}

interface TrendWeek {
  start: string;
  partial: boolean;
  days: TrainingHubDailyMetric[];
}

/** Monday-start weeks, as the calendar draws them. */
function weeksOf(
  window: TrainingHubDailyMetric[],
  windowStart: string,
  windowEnd: string
): TrendWeek[] {
  const weeks = new Map<string, TrendWeek>();
  for (const day of window) {
    const date = dateFromDayKey(day.happenDay);
    date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
    const start = dayKeyDaysAgo(date, 0);
    const end = dayKeyDaysAgo(date, -6);
    const week = weeks.get(start) ?? {
      start,
      // A week the window cuts into is flagged, so a three-day total is not
      // read against a full week's.
      partial: start < windowStart || end > windowEnd,
      days: []
    };
    week.days.push(day);
    weeks.set(start, week);
  }
  return [...weeks.values()].sort((left, right) => left.start.localeCompare(right.start));
}

function weeklyTable(window: TrainingHubDailyMetric[], windowStart: string, windowEnd: string): string[] {
  const lastValue = (week: TrendWeek, pick: (day: TrainingHubDailyMetric) => number | undefined) =>
    latestOf(week.days, pick)?.value;
  return pipeTable(
    weeksOf(window, windowStart, windowEnd),
    {
      header: "Week of",
      value: (week) => `${dayLabel(week.start)}${week.partial ? " (partial)" : ""}`
    },
    [
      { header: "Load", value: (week) => rounded(sumOf(week.days.map((day) => day.trainingLoad))) },
      { header: "RPE load", value: (week) => rounded(sumOf(week.days.map((day) => day.rpeLoad))) },
      {
        header: "Time",
        value: (week) => {
          const seconds = sumOf(week.days.map((day) => day.duration));
          return seconds ? formatDurationSeconds(seconds) : undefined;
        }
      },
      { header: "RHR avg", value: (week) => rounded(meanOf(week.days.map((day) => day.rhr))) },
      {
        header: "HRV avg (baseline)",
        value: (week) =>
          hrvCell(
            meanOf(week.days.map((day) => day.avgSleepHrv)),
            meanOf(week.days.map((day) => day.sleepHrvBase))
          )
      },
      ...statusColumns((week: TrendWeek) => ({
        tiredRateNew: lastValue(week, (day) => day.tiredRateNew),
        trainingLoadRatio: lastValue(week, (day) => day.trainingLoadRatio),
        staminaLevel: lastValue(week, (day) => day.staminaLevel),
        vo2max: lastValue(week, (day) => day.vo2max)
      }))
    ]
  );
}

/**
 * The numbers a recovery question turns on, taken here rather than left to
 * the model: summing fourteen rows of load or counting nights under baseline is
 * arithmetic a model gets wrong often enough to matter.
 */
function trendSummary(window: TrainingHubDailyMetric[], days: number, today: Date): string[] {
  const since = (offset: number) => dayKeyDaysAgo(today, offset);
  const between = (from: string, to: string) =>
    window.filter((day) => day.happenDay >= from && day.happenDay <= to);
  const last7 = between(since(6), since(0));
  const lines: string[] = [];

  const load7 = sumOf(last7.map((day) => day.trainingLoad));
  if (load7 !== undefined) {
    const parts = [`last 7 days ${Math.round(load7)}`];
    if (days >= 14) {
      const previous = sumOf(between(since(13), since(7)).map((day) => day.trainingLoad));
      if (previous !== undefined) parts.push(`previous 7 days ${Math.round(previous)}`);
    }
    if (days >= 28) {
      const block = sumOf(between(since(27), since(0)).map((day) => day.trainingLoad));
      if (block !== undefined) parts.push(`28-day weekly average ${Math.round(block / 4)}`);
    }
    lines.push(`- Training load: ${parts.join("; ")}`);
  }

  const rhr = latestOf(window, (day) => day.rhr);
  if (rhr) {
    const average = meanOf(window.map((day) => day.rhr));
    lines.push(
      `- Resting HR: ${Math.round(rhr.value)} bpm on ${dayLabel(rhr.day)}` +
        (average !== undefined ? `; ${days}-day average ${Math.round(average)}` : "")
    );
  }

  const hrv = latestOf(window, (day) => day.avgSleepHrv);
  if (hrv) {
    const latest = window.find((day) => day.happenDay === hrv.day);
    const paired = last7.filter(
      (day) => day.avgSleepHrv !== undefined && day.sleepHrvBase !== undefined
    );
    const below = paired.filter((day) => day.avgSleepHrv! < day.sleepHrvBase!).length;
    lines.push(
      `- Overnight HRV: ${Math.round(hrv.value)}` +
        (latest?.sleepHrvBase !== undefined ? ` vs baseline ${Math.round(latest.sleepHrvBase)}` : "") +
        ` on ${dayLabel(hrv.day)}` +
        (paired.length > 0 ? `; below baseline on ${below} of the last ${paired.length} readings` : "")
    );
  }

  const status = [
    ["Load Impact", latestOf(window, (day) => day.tiredRateNew), 0],
    ["load ratio", latestOf(window, (day) => day.trainingLoadRatio), 2],
    ["Base Fitness", latestOf(window, (day) => day.staminaLevel), 0]
  ] as const;
  const statusParts = status
    .filter(([, reading]) => reading !== undefined)
    .map(([label, reading, decimals]) =>
      `${label} ${reading!.value.toFixed(decimals)} (${dayLabel(reading!.day)})`
    );
  if (statusParts.length > 0) {
    lines.push(`- Latest COROS status: ${statusParts.join(" · ")}`);
  }

  const vo2 = latestOf(window, (day) => day.vo2max);
  if (vo2) {
    const first = firstOf(window, (day) => day.vo2max);
    lines.push(
      `- VO2max: ${Math.round(vo2.value)} on ${dayLabel(vo2.day)}` +
        (first && first.day !== vo2.day && Math.round(first.value) !== Math.round(vo2.value)
          ? ` (was ${Math.round(first.value)} on ${dayLabel(first.day)})`
          : "")
    );
  }

  return lines;
}

/**
 * The trend as the coach reads it: a computed summary first, then the rows.
 * Resting HR and HRV were all this used to say — Load Impact, load ratio, Base
 * Fitness and VO2max were parsed off the same response and dropped.
 */
export function formatFitnessTrendsForChat(
  window: TrainingHubDailyMetric[],
  days: number,
  today: Date = new Date()
): string {
  if (window.length === 0) {
    return `No fitness trend data for the last ${days} days.`;
  }

  const windowStart = dayKeyDaysAgo(today, days - 1);
  const windowEnd = dayKeyDaysAgo(today, 0);
  const lines = [
    `Fitness trends, last ${days} days (${dayLabel(windowStart)} → ${dayLabel(windowEnd)}; ` +
      "days without any reading are omitted):",
    ...trendSummary(window, days, today)
  ];

  if (days <= DAILY_TABLE_MAX_DAYS) {
    lines.push("", "Daily:", ...dailyTable(window));
  } else {
    const tailStart = dayKeyDaysAgo(today, DAILY_TAIL_DAYS - 1);
    lines.push(
      "",
      "Weekly (Mon–Sun; load and time summed, RHR and HRV averaged, COROS status as of the week's last reading):",
      ...weeklyTable(window, windowStart, windowEnd),
      "",
      `Daily, last ${DAILY_TAIL_DAYS} days:`,
      ...dailyTable(window.filter((day) => day.happenDay >= tailStart))
    );
  }

  return lines.join("\n");
}

export function buildFitnessTrendPreview(
  trendPoints: FitnessTrendPreview["trendPoints"],
  requestId?: string,
  windowDays?: number
): FitnessTrendPreview | null {
  if (trendPoints.length === 0) {
    return null;
  }

  return {
    previewId: `fitness-trends:${requestId ?? "static"}`,
    trendPoints,
    ...(windowDays !== undefined ? { windowDays } : {})
  };
}

// ----- Heart-rate zones -----------------------------------------------------

async function handleGetTrainingZones(
  args: Record<string, unknown>,
  callbacks?: ChatAnalyticsToolCallbacks
): Promise<string> {
  const metricArg = String(args.metric ?? "trainingLoad");
  const metric =
    metricArg === "time" || metricArg === "distance" || metricArg === "trainingLoad"
      ? metricArg
      : "trainingLoad";

  try {
    // The profile is cached for an hour, so on most calls the whole zone model
    // costs no request beyond the analytics read.
    const [analytics, profile] = await Promise.all([
      getTrainingAnalytics(),
      getCoachCorosProfile()
    ]);
    // The dashboard is only worth a request when the profile named no zones —
    // its LTHR table is the fallback, and asking for it otherwise would spend a
    // round trip on something already in hand.
    let model = accountHrZoneModel(profile, null);
    if (!model) {
      model = accountHrZoneModel(profile, await getTrainingDashboard().catch(() => null));
    }

    const preview = buildHrZonePreview(
      analytics.zoneDistributions,
      model?.zones ?? [],
      metric,
      callbacks?.requestId ?? "unknown"
    );

    if (preview && callbacks?.onHrZoneSummary) {
      callbacks.onHrZoneSummary(preview);
    }

    return formatTrainingZonesForChat(
      analytics.zoneDistributions,
      model,
      profile,
      callbacks?.unitSystem ?? "metric"
    );
  } catch (caught) {
    throw formatAnalyticsToolError("get_training_zones", caught);
  }
}

/**
 * The zone tables the athlete is actually scored against, in one answer.
 *
 * Pace and power zones live in the same `/account/query` payload the HR zones
 * come from and had never reached the coach, so every prescribed pace was
 * inferred from recent activities rather than read off the athlete's own
 * threshold.
 */
export function formatTrainingZonesForChat(
  distributions: TrainingHubZoneDistributions,
  model: AccountHrZoneModel | undefined,
  profile: CorosProfile | null | undefined,
  unitSystem: UnitSystem
): string {
  const thresholds = profile?.thresholds;
  const anchors = [
    thresholds?.maxHr ? `max HR ${thresholds.maxHr} bpm` : undefined,
    thresholds?.restingHr ? `resting HR ${thresholds.restingHr} bpm` : undefined,
    thresholds?.lthr ? `LTHR ${thresholds.lthr} bpm` : undefined,
    thresholds?.thresholdPaceSecondsPerKm
      ? `threshold pace ${formatPaceSeconds(thresholds.thresholdPaceSecondsPerKm, unitSystem)}`
      : undefined,
    thresholds?.ftp ? `FTP ${Math.round(thresholds.ftp)} W` : undefined
  ].filter(Boolean);

  const blocks = [
    `Training zones${model ? ` — ${model.label} model` : ""}` +
      (anchors.length > 0 ? ` (${anchors.join(" · ")})` : "") +
      ":",
    formatHrZoneSummaryForChat(distributions, model, unitSystem),
    formatPaceZonesForChat(thresholds?.zones.thresholdPace ?? [], unitSystem),
    formatPowerZonesForChat(thresholds?.zones.cyclePower ?? [])
  ].filter(Boolean);

  return blocks.join("\n\n");
}

/**
 * Running pace zones.
 *
 * Verified against the live account on 2026-09-11: `ratio` is a percentage of
 * threshold *speed* and `pace` is the zone's fast edge, so
 * `pace = ltsp / (ratio / 100)` — 328 s/km at 100%, 473 at 69.3%. The last
 * entry is a sentinel in the same way `hr: 404` is: 200% of threshold speed,
 * 164 s/km, a pace nobody runs. So each row spans two stated boundaries and
 * only the open ends are interpreted.
 */
export function formatPaceZonesForChat(
  zones: CorosProfileZone[],
  unitSystem: UnitSystem
): string | undefined {
  const boundaries = [...zones]
    .filter((zone) => zone.paceSecondsPerKm !== undefined)
    .sort((left, right) => left.index - right.index);
  if (boundaries.length < 2) {
    return undefined;
  }

  const pace = (zone: CorosProfileZone) =>
    formatPaceSeconds(zone.paceSecondsPerKm!, unitSystem);
  const percent = (zone: CorosProfileZone) =>
    zone.ratio !== undefined ? `${Math.round(zone.ratio)}%` : "—";

  const rows = boundaries.map((zone, position) => {
    const previous = boundaries[position - 1];
    const label = `Z${position + 1}`;
    if (position === 0) {
      return `${label} | slower than ${pace(zone)} | below ${percent(zone)}`;
    }
    if (position === boundaries.length - 1) {
      return `${label} | faster than ${pace(previous!)} | above ${percent(previous!)}`;
    }
    // Fast edge first, the way a pace band is written, with the unit spelled
    // once: "6:41–7:53/km", not "6:41/km–7:53/km".
    const fast = pace(zone).replace(/\/\w+$/, "");
    return `${label} | ${fast}–${pace(previous!)} | ${percent(previous!)}–${percent(zone)}`;
  });

  return [
    "Pace zones (% of threshold speed):",
    "Zone | Pace | % of threshold",
    ...rows
  ].join("\n");
}

/**
 * Cycling power zones. Each entry states the zone's ceiling in watts, as the
 * heart-rate families state theirs in bpm, and the last is the same kind of
 * sentinel (900 W at 500% of FTP).
 */
export function formatPowerZonesForChat(zones: CorosProfileZone[]): string | undefined {
  const sorted = [...zones]
    .filter((zone) => zone.watts !== undefined)
    .sort((left, right) => left.index - right.index);
  if (sorted.length < 2) {
    return undefined;
  }

  const rows = sorted.map((zone, position) => {
    const previous = sorted[position - 1];
    const label = `Z${position + 1}`;
    if (position === sorted.length - 1) {
      return `${label} | ≥ ${previous!.watts! + 1} W`;
    }
    return position === 0
      ? `${label} | ≤ ${zone.watts} W`
      : `${label} | ${previous!.watts! + 1}–${zone.watts} W`;
  });

  return ["Power zones:", "Zone | Power", ...rows].join("\n");
}

export interface AccountHrZoneModel {
  label: string;
  /** What the zone percentages are taken of, e.g. "LTHR 171 bpm". */
  anchor?: string;
  /** Ascending; each `hr` is the zone's ceiling, as COROS states it. */
  zones: TrainingHubThresholdZone[];
}

const HR_ZONE_MODELS: Record<number, { family: CorosProfileZoneFamily; label: string }> = {
  1: { family: "maxHr", label: "Max heart rate" },
  2: { family: "restingHr", label: "Heart rate reserve" },
  3: { family: "lthr", label: "Lactate threshold" }
};

function zoneAnchor(
  family: CorosProfileZoneFamily,
  thresholds: CorosProfile["thresholds"]
): string | undefined {
  if (family === "maxHr") {
    return thresholds.maxHr ? `max HR ${thresholds.maxHr} bpm` : undefined;
  }
  if (family === "restingHr") {
    return thresholds.maxHr && thresholds.restingHr
      ? `max HR ${thresholds.maxHr} bpm, resting ${thresholds.restingHr} bpm`
      : undefined;
  }
  return thresholds.lthr ? `LTHR ${thresholds.lthr} bpm` : undefined;
}

/**
 * The zones COROS scored the distribution against: the model picked on the
 * account (`hrZoneType`), not the dashboard's LTHR zones. The renderer's twin
 * is `heartRateZoneModelFromProfile` in src/training/heartRateZoneModel.ts,
 * which the main process cannot import; the two must agree.
 *
 * Falls back to the dashboard's LTHR zones, labelled as a fallback, when the
 * profile could not be read.
 */
export function accountHrZoneModel(
  profile: CorosProfile | null | undefined,
  dashboard: TrainingHubDashboard | null | undefined
): AccountHrZoneModel | undefined {
  const definition = profile ? HR_ZONE_MODELS[profile.hrZoneType ?? -1] : undefined;
  if (profile && definition) {
    const zones = profile.thresholds.zones[definition.family]
      .map(
        (zone): TrainingHubThresholdZone => ({
          index: zone.index,
          ...(zone.bpm !== undefined ? { hr: zone.bpm } : {}),
          ...(zone.ratio !== undefined ? { ratio: zone.ratio } : {})
        })
      )
      .sort((left, right) => left.index - right.index);
    if (zones.length > 0) {
      const anchor = zoneAnchor(definition.family, profile.thresholds);
      return { label: definition.label, ...(anchor ? { anchor } : {}), zones };
    }
  }

  const lthr = dashboard?.lthrZones ?? [];
  return lthr.length > 0
    ? {
        label: "Lactate threshold (the account's own zone model could not be read)",
        zones: [...lthr].sort((left, right) => left.index - right.index)
      }
    : undefined;
}

/**
 * The bpm span of the zone at `position`. COROS states a zone by its ceiling,
 * so the floor is the zone below plus a beat, and the top zone's ceiling is a
 * sentinel (404 bpm on `rhrZone`) that has to read open-ended.
 */
export function formatZoneBpmRange(
  zones: TrainingHubThresholdZone[],
  position: number
): string | undefined {
  const sorted = [...zones].sort((left, right) => left.index - right.index);
  const zone = sorted[position];
  if (!zone) {
    return undefined;
  }
  const previous = position > 0 ? sorted[position - 1] : undefined;
  if (position === sorted.length - 1) {
    return previous?.hr !== undefined ? `≥ ${previous.hr + 1} bpm` : undefined;
  }
  if (previous?.hr !== undefined) {
    return zone.hr !== undefined
      ? `${previous.hr + 1}–${zone.hr} bpm`
      : `≥ ${previous.hr + 1} bpm`;
  }
  return zone.hr !== undefined ? `≤ ${zone.hr} bpm` : undefined;
}

function sortedEntries(
  entries: TrainingHubZoneDistributionEntry[]
): TrainingHubZoneDistributionEntry[] {
  return [...entries].sort((left, right) => left.index - right.index);
}

function totalOf(entries: TrainingHubZoneDistributionEntry[]): number {
  return entries.reduce((sum, entry) => sum + (entry.value ?? 0), 0);
}

/**
 * All three measures in one table. The tool used to answer for one measure per
 * call from a payload that carries all three, so a model wanting time and load
 * made the same request twice; it also labelled COROS's 0-based buckets
 * "Zone 0…5" with no bpm, where the Training screen says Zone 1…6 with ranges.
 */
export function formatHrZoneSummaryForChat(
  distributions: TrainingHubZoneDistributions,
  model: AccountHrZoneModel | undefined,
  unitSystem: UnitSystem
): string {
  const measures = [
    {
      header: "Time",
      entries: sortedEntries(distributions.hrTime),
      format: (value: number) => formatDurationSeconds(value)
    },
    {
      header: "Load",
      entries: sortedEntries(distributions.hrTrainingLoad),
      format: (value: number) => String(Math.round(value))
    },
    {
      header: "Distance",
      entries: sortedEntries(distributions.hrDistance),
      format: (value: number) => formatDistanceValue(value, unitSystem)
    }
  ].filter((measure) => totalOf(measure.entries) > 0);

  if (measures.length === 0) {
    return "No heart-rate zone distribution data for the last 4 weeks.";
  }

  const zoneCount = Math.max(...measures.map((measure) => measure.entries.length));
  const ranges = Array.from({ length: zoneCount }, (_, position) =>
    model ? formatZoneBpmRange(model.zones, position) : undefined
  );
  const withRanges = ranges.some((range) => range !== undefined);

  const header = [
    "Zone",
    ...(withRanges ? ["HR range"] : []),
    ...measures.map((measure) => measure.header)
  ].join(" | ");
  const rows = Array.from({ length: zoneCount }, (_, position) =>
    [
      `Z${position + 1}`,
      ...(withRanges ? [ranges[position] ?? "—"] : []),
      ...measures.map((measure) => {
        const value = measure.entries[position]?.value ?? 0;
        const percent = (value / totalOf(measure.entries)) * 100;
        return `${measure.format(value)} (${Math.round(percent)}%)`;
      })
    ].join(" | ")
  );

  const title =
    "HR zones and the last 4 weeks in them" +
    (model
      ? ` — ${model.label}${model.anchor ? ` (${model.anchor})` : ""}`
      : "") +
    ":";
  const lines = [title, header, ...rows];
  if (!withRanges) {
    lines.push("Zone bpm ranges are unavailable: COROS returned no zone model for this account.");
  }
  return lines.join("\n");
}

export function buildHrZonePreview(
  distributions: {
    hrTrainingLoad: TrainingHubZoneDistributionEntry[];
    hrDistance: TrainingHubZoneDistributionEntry[];
    hrTime: TrainingHubZoneDistributionEntry[];
  },
  /**
   * The zones that label the card's bpm ranges — the account's own model. The
   * preview field is still called `lthrZones` because stored transcripts carry
   * it under that name.
   */
  rangeZones: HrZonePreview["lthrZones"],
  metric: HrZonePreview["metric"],
  requestId: string
): HrZonePreview | null {
  const areaList =
    metric === "time"
      ? distributions.hrTime
      : metric === "distance"
        ? distributions.hrDistance
        : distributions.hrTrainingLoad;

  if (areaList.length === 0) {
    return null;
  }

  const total = totalOf(areaList);
  if (total <= 0) {
    return null;
  }

  const zones = sortedEntries(areaList).map((entry, position) => {
    const value = entry.value ?? 0;
    return {
      // COROS's own 0-based index, which is what the card looks the bpm range
      // up by; the label is 1-based, as the Training screen writes it.
      index: entry.index,
      label: `Zone ${position + 1}`,
      percent: (value / total) * 100,
      value
    };
  });

  return {
    previewId: `hr-zones:${metric}:${requestId}`,
    metric,
    zones,
    lthrZones: rangeZones
  };
}

function formatAnalyticsToolError(tool: string, caught: unknown): Error {
  const detail = caught instanceof Error ? caught.message : String(caught);
  if (/not authenticated|sign in/i.test(detail)) {
    return new Error(
      `${tool} failed: Training Hub is not signed in. Ask the athlete to connect COROS in Settings.`
    );
  }
  return new Error(`${tool} failed: ${detail}`);
}
