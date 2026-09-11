import { SLEEP_TARGET_MINUTES } from "./coachThresholdMetrics";
import { isCorosMcpUsable } from "./corosMcpService";
import { getCachedSleepNight, getSleepHistory } from "./sleepHistoryService";
import { getSleepNightSeries } from "./sleepSeriesService";
import type {
  CorosMcpTool,
  SleepHistorySnapshot,
  SleepNightSeries,
  SleepSeriesPoint,
  TrainingHubSleepRecord
} from "./types";

/**
 * Sleep for the coach, read through the Sleep screen's cache.
 *
 * Before this the only way to sleep was the raw COROS MCP tool, which keeps
 * about nine weeks, answers in prose, rejects any date that is not `yyyyMMdd`,
 * and costs a network round trip for nights that cannot have changed.
 * `getSleepHistory` already holds every night the app has seen for 400 days,
 * refetches only last night and partial ones, and has sleep heart rate folded
 * in from the daily-health feed.
 */

export const CHAT_SLEEP_TOOL_NAMES = ["get_sleep_summary"] as const;

export type ChatSleepToolName = (typeof CHAT_SLEEP_TOOL_NAMES)[number];

export function isChatSleepTool(name: string): name is ChatSleepToolName {
  return (CHAT_SLEEP_TOOL_NAMES as readonly string[]).includes(name);
}

const DEFAULT_SLEEP_NIGHTS = 7;
const MAX_SLEEP_NIGHTS = 90;
/** Up to this many nights are listed one by one; a longer window by week. */
const NIGHTLY_TABLE_MAX = 14;
const NIGHTLY_TAIL = 7;

export function getChatSleepTools(): CorosMcpTool[] {
  if (!isCorosMcpUsable()) {
    return [];
  }

  return [
    {
      name: "get_sleep_summary",
      description:
        "Nightly sleep from COROS: duration, sleep score, deep/light/REM/awake " +
        "share, wake-ups, sleep window, overnight HR and naps, led by window " +
        "averages and the net deficit against 8 h a night. Served from the app's " +
        "sleep cache, which keeps nights COROS drops after ~9 weeks. Nights are " +
        "dated by wake-up day, so today's date is last night. Windows over 14 " +
        "nights are rolled up by week with the last 7 nights listed. Pass night " +
        "for one night's HRV and stress detail instead.",
      inputSchema: {
        type: "object",
        properties: {
          days: {
            type: "integer",
            minimum: 1,
            maximum: MAX_SLEEP_NIGHTS,
            description: `Nights back from today (default ${DEFAULT_SLEEP_NIGHTS}, max ${MAX_SLEEP_NIGHTS}).`
          },
          night: {
            type: "string",
            description:
              "One night as YYYYMMDD (its wake-up day) for that night's HRV " +
              "course, COROS's own HRV assessment and sleeping stress. COROS " +
              "keeps these samples about a week; older nights have none."
          }
        }
      }
    }
  ];
}

export function parseSleepNights(value: unknown): number {
  const nights = Math.round(Number(value));
  return Number.isFinite(nights) && nights >= 1
    ? Math.min(nights, MAX_SLEEP_NIGHTS)
    : DEFAULT_SLEEP_NIGHTS;
}

/** The night asked for, as `yyyyMMdd`, or undefined when the window was asked for. */
export function parseSleepNightArgument(value: unknown): string | undefined {
  const night = String(value ?? "").trim().replace(/-/g, "");
  if (!night) {
    return undefined;
  }
  if (!/^\d{8}$/.test(night)) {
    throw new Error("night must be YYYYMMDD (the wake-up day).");
  }
  return night;
}

/** Nights back from today a given day sits. */
function nightsBackFrom(night: string, today: Date): number {
  const start = new Date(
    Number(night.slice(0, 4)),
    Number(night.slice(4, 6)) - 1,
    Number(night.slice(6, 8))
  );
  const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.max(
    Math.round((midnight.getTime() - start.getTime()) / 86_400_000) + 1,
    1
  );
}

/** How far back COROS still answers for a night. Older ones live only on disk. */
const COROS_SLEEP_RETENTION_NIGHTS = 63;

/**
 * The row for one night: from disk when it is there, and otherwise from a fill
 * — but only for a night COROS can still answer for. Asking for a 60-night
 * window to find one settled row is the wasteful shape this avoids, and past
 * COROS's retention the fill could not have returned it anyway.
 */
async function sleepNightRecord(
  night: string,
  today: Date
): Promise<TrainingHubSleepRecord | undefined> {
  const cached = getCachedSleepNight(night);
  if (cached || nightsBackFrom(night, today) > COROS_SLEEP_RETENTION_NIGHTS) {
    return cached;
  }
  const filled = await getSleepHistory({ days: nightsBackFrom(night, today) });
  return filled.records.find((record) => record.happenDay === night);
}

export async function handleChatSleepTool(
  _name: ChatSleepToolName,
  args: Record<string, unknown>
): Promise<string> {
  const night = parseSleepNightArgument(args.night);
  const nights = parseSleepNights(args.days);
  try {
    if (night) {
      const today = new Date();
      // The night's own row and its samples are two different caches, and
      // neither can stand in for the other.
      const [record, series] = await Promise.all([
        sleepNightRecord(night, today),
        getSleepNightSeries({ happenDay: night })
      ]);
      return formatSleepNightForChat(night, record, series);
    }
    return formatSleepSummaryForChat(await getSleepHistory({ days: nights }), nights);
  } catch (caught) {
    const detail = caught instanceof Error ? caught.message : String(caught);
    throw new Error(`get_sleep_summary failed: ${detail}`);
  }
}

// ----- Formatting -----------------------------------------------------------

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function dateFromDayKey(day: string): Date {
  return new Date(Number(day.slice(0, 4)), Number(day.slice(4, 6)) - 1, Number(day.slice(6, 8)));
}

function dayLabel(day: string): string {
  return `${day.slice(4, 6)}-${day.slice(6, 8)} ${WEEKDAYS[dateFromDayKey(day).getDay()]}`;
}

function dayKey(date: Date): string {
  return (
    `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}` +
    `${String(date.getDate()).padStart(2, "0")}`
  );
}

/** "7h12" — a night's length at a glance, and short enough for a table cell. */
function formatSleepMinutes(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  return `${Math.floor(total / 60)}h${String(total % 60).padStart(2, "0")}`;
}

function share(
  percent: number | undefined,
  minutes: number | undefined,
  total: number | undefined
): number | undefined {
  if (percent !== undefined && Number.isFinite(percent)) {
    return percent;
  }
  return minutes !== undefined && total ? (minutes / total) * 100 : undefined;
}

function stages(record: TrainingHubSleepRecord): string | undefined {
  const values = [
    share(record.deepPercent, record.deepMinutes, record.totalMinutes),
    share(record.lightPercent, record.lightMinutes, record.totalMinutes),
    share(record.remPercent, record.remMinutes, record.totalMinutes),
    share(record.awakePercent, record.awakeMinutes, record.totalMinutes)
  ];
  return values.some((value) => value !== undefined)
    ? values.map((value) => (value === undefined ? "—" : String(Math.round(value)))).join("/")
    : undefined;
}

function mean(values: (number | undefined)[]): number | undefined {
  const present = values.filter(
    (value): value is number => value !== undefined && Number.isFinite(value)
  );
  return present.length > 0
    ? present.reduce((total, value) => total + value, 0) / present.length
    : undefined;
}

/** A night whose numbers are final — what averages and the deficit are taken over. */
function isSettled(record: TrainingHubSleepRecord): boolean {
  return record.completeness !== "partial" && (record.totalMinutes ?? 0) > 0;
}

interface Column {
  header: string;
  value: (record: TrainingHubSleepRecord) => string | undefined;
}

const NIGHT_COLUMNS: Column[] = [
  {
    header: "Total",
    value: (record) =>
      record.totalMinutes !== undefined
        ? `${formatSleepMinutes(record.totalMinutes)}${record.completeness === "partial" ? " (partial)" : ""}`
        : undefined
  },
  { header: "Score", value: (record) => (record.score !== undefined ? String(Math.round(record.score)) : undefined) },
  { header: "Deep/Light/REM/Awake %", value: stages },
  {
    header: "Wake-ups >5 min",
    value: (record) =>
      record.awakeCountOverFiveMinutes !== undefined ? String(record.awakeCountOverFiveMinutes) : undefined
  },
  {
    header: "Window",
    value: (record) =>
      record.sleepStart && record.sleepEnd ? `${record.sleepStart}–${record.sleepEnd}` : undefined
  },
  {
    header: "HR avg (min)",
    value: (record) =>
      record.avgHr !== undefined
        ? `${Math.round(record.avgHr)}${record.minHr !== undefined ? ` (${Math.round(record.minHr)})` : ""}`
        : undefined
  },
  {
    header: "Nap",
    value: (record) => (record.napMinutes ? `${Math.round(record.napMinutes)} min` : undefined)
  }
];

function nightTable(nights: TrainingHubSleepRecord[]): string[] {
  const used = NIGHT_COLUMNS.filter((column) => nights.some((night) => column.value(night) !== undefined));
  return [
    ["Night", ...used.map((column) => column.header)].join(" | "),
    ...nights.map((night) =>
      [dayLabel(night.happenDay), ...used.map((column) => column.value(night) ?? "—")].join(" | ")
    )
  ];
}

function weekTable(nights: TrainingHubSleepRecord[]): string[] {
  const weeks = new Map<string, TrainingHubSleepRecord[]>();
  for (const night of nights) {
    const monday = dateFromDayKey(night.happenDay);
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    const key = dayKey(monday);
    weeks.set(key, [...(weeks.get(key) ?? []), night]);
  }

  const rows = [...weeks.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([start, week]) => {
      const settled = week.filter(isSettled);
      const total = mean(settled.map((night) => night.totalMinutes));
      const score = mean(settled.map((night) => night.score));
      const deep = mean(settled.map((night) => share(night.deepPercent, night.deepMinutes, night.totalMinutes)));
      const rem = mean(settled.map((night) => share(night.remPercent, night.remMinutes, night.totalMinutes)));
      const hr = mean(settled.map((night) => night.avgHr));
      return [
        dayLabel(start),
        String(settled.length),
        total !== undefined ? formatSleepMinutes(total) : "—",
        score !== undefined ? String(Math.round(score)) : "—",
        deep !== undefined ? String(Math.round(deep)) : "—",
        rem !== undefined ? String(Math.round(rem)) : "—",
        hr !== undefined ? String(Math.round(hr)) : "—"
      ].join(" | ");
    });

  return ["Week of | Nights | Avg total | Avg score | Deep % | REM % | HR avg", ...rows];
}

/**
 * Sleep as the coach reads it: averages and the net deficit first — both taken
 * over settled nights only, since a night still syncing reads as a short one —
 * then the nights themselves.
 */
export function formatSleepSummaryForChat(
  snapshot: SleepHistorySnapshot,
  nights: number,
  today: Date = new Date()
): string {
  // Windowed here as well as by the caller: `getSleepHistory` already returns
  // the window, but a formatter that trusts its input silently prints thirty
  // rows under a "last 7 nights" heading the day some caller forgets to.
  const from = dayKey(
    new Date(today.getFullYear(), today.getMonth(), today.getDate() - (nights - 1))
  );
  const records = snapshot.records
    .filter((record) => record.kind !== "nap" && record.happenDay >= from)
    .sort((left, right) => left.happenDay.localeCompare(right.happenDay));
  const errorNote = snapshot.error
    ? `The latest COROS fetch failed (${snapshot.error}), so only cached nights are shown.`
    : undefined;

  if (records.length === 0) {
    if (!snapshot.mcpConnected) {
      return (
        "No sleep data: COROS MCP is not connected. Ask the athlete to connect it " +
        "in Settings → MCP Servers."
      );
    }
    return [`No sleep recorded in the last ${nights} nights.`, errorNote].filter(Boolean).join(" ");
  }

  const settled = records.filter(isSettled);
  const lines = [
    `Sleep, last ${nights} nights (dated by wake-up day; ${records.length} of ${nights} recorded):`
  ];

  if (settled.length > 0) {
    const total = mean(settled.map((night) => night.totalMinutes));
    const score = mean(settled.map((night) => night.score));
    const deep = mean(settled.map((night) => share(night.deepPercent, night.deepMinutes, night.totalMinutes)));
    const rem = mean(settled.map((night) => share(night.remPercent, night.remMinutes, night.totalMinutes)));
    const hr = mean(settled.map((night) => night.avgHr));
    const average = [
      total !== undefined ? formatSleepMinutes(total) : undefined,
      score !== undefined ? `score ${Math.round(score)}` : undefined,
      deep !== undefined ? `deep ${Math.round(deep)}%` : undefined,
      rem !== undefined ? `REM ${Math.round(rem)}%` : undefined,
      hr !== undefined ? `overnight HR ${Math.round(hr)} bpm` : undefined
    ].filter(Boolean);
    lines.push(`- Average per settled night: ${average.join(" · ")}`);

    // Nets out, as the sleep-debt trigger does: a long night pays back a short
    // one, and a night with no reading counts on neither side.
    const slept = settled.reduce((sum, night) => sum + (night.totalMinutes ?? 0), 0);
    const deficit = settled.length * SLEEP_TARGET_MINUTES - slept;
    lines.push(
      `- Net against 8 h a night over ${settled.length} settled night${settled.length === 1 ? "" : "s"}: ` +
        (deficit > 0
          ? `${formatSleepMinutes(deficit)} short`
          : `${formatSleepMinutes(-deficit)} over`)
    );
  }

  if (settled.length < records.length) {
    lines.push("- Nights marked partial were still syncing and are left out of the averages.");
  }
  if (!records.some((record) => record.happenDay === dayKey(today))) {
    lines.push("- Last night is not in yet (the watch may not have synced).");
  }
  if (errorNote) {
    lines.push(`- ${errorNote}`);
  }

  lines.push(
    "- One night's HRV course and sleeping stress: call again with night=YYYYMMDD."
  );

  if (nights <= NIGHTLY_TABLE_MAX) {
    lines.push("", ...nightTable(records));
  } else {
    lines.push(
      "",
      "Weekly (Mon–Sun, averages over settled nights):",
      ...weekTable(records),
      "",
      `Last ${NIGHTLY_TAIL} nights:`,
      ...nightTable(records.slice(-NIGHTLY_TAIL))
    );
  }

  return lines.join("\n");
}

/**
 * The night itself, in prose rather than as a row of table cells: a single
 * night reads once, so it is written the way it would be said.
 */
function nightHighlights(record: TrainingHubSleepRecord): string {
  const stageShares = stages(record);
  const wakeUps = record.awakeCountOverFiveMinutes;
  return [
    record.totalMinutes !== undefined
      ? `${formatSleepMinutes(record.totalMinutes)}${
          record.completeness === "partial" ? " (partial)" : ""
        }`
      : undefined,
    record.score !== undefined ? `score ${Math.round(record.score)}` : undefined,
    stageShares ? `deep/light/REM/awake ${stageShares}%` : undefined,
    wakeUps !== undefined ? `${wakeUps} wake-up${wakeUps === 1 ? "" : "s"} >5 min` : undefined,
    record.sleepStart && record.sleepEnd
      ? `window ${record.sleepStart}–${record.sleepEnd}`
      : undefined,
    record.avgHr !== undefined
      ? `HR ${Math.round(record.avgHr)} avg${
          record.minHr !== undefined ? ` (${Math.round(record.minHr)} min)` : ""
        }`
      : undefined,
    record.napMinutes ? `nap ${Math.round(record.napMinutes)} min` : undefined
  ]
    .filter(Boolean)
    .join(" · ");
}

function seriesStats(points: SleepSeriesPoint[]):
  | { average: number; low: number; high: number; first: number; last: number; count: number }
  | undefined {
  const values = points
    .map((point) => point.value)
    .filter((value) => Number.isFinite(value) && value > 0);
  if (values.length === 0) {
    return undefined;
  }
  // Thirds rather than halves, for the same reason the activity form trend
  // takes thirds: the middle of the night must not cancel a drift out.
  const size = Math.max(1, Math.floor(values.length / 3));
  const mean = (slice: number[]) =>
    slice.reduce((total, value) => total + value, 0) / slice.length;
  return {
    average: mean(values),
    low: Math.min(...values),
    high: Math.max(...values),
    first: mean(values.slice(0, size)),
    last: mean(values.slice(-size)),
    count: values.length
  };
}

/**
 * One night in depth: the row from the night list, then what the two series
 * inside the sleep window did.
 *
 * The samples are summarised rather than listed — a night carries roughly a
 * hundred HRV points and three hundred stress points, and a coach reads the
 * shape, not the points. COROS's own HRV verdict is passed through untouched:
 * it is their assessment against their baseline, and recomputing it here would
 * quietly invent a second opinion.
 */
export function formatSleepNightForChat(
  night: string,
  record: TrainingHubSleepRecord | undefined,
  series: SleepNightSeries
): string {
  const lines = [`Sleep detail for ${dayLabel(night)} (wake-up day):`];

  if (record) {
    lines.push(`- Night: ${nightHighlights(record)}`);
  } else {
    lines.push("- No sleep record for this night.");
  }

  const hrv = seriesStats(series.hrv);
  if (hrv) {
    lines.push(
      `- HRV through the night: average ${Math.round(hrv.average)} · low ${Math.round(hrv.low)} · ` +
        `high ${Math.round(hrv.high)} · first third ${Math.round(hrv.first)} → last third ` +
        `${Math.round(hrv.last)} (${hrv.count} samples)`
    );
  }

  const assessment = series.assessment;
  if (assessment) {
    const parts = [
      assessment.avg !== undefined ? `average ${Math.round(assessment.avg)}` : undefined,
      assessment.normalLow !== undefined && assessment.normalHigh !== undefined
        ? `normal range ${Math.round(assessment.normalLow)}–${Math.round(assessment.normalHigh)}`
        : undefined,
      assessment.baseline !== undefined
        ? `baseline ${Math.round(assessment.baseline)}`
        : undefined,
      assessment.evaluation
    ].filter(Boolean);
    if (parts.length > 0) {
      lines.push(`- COROS HRV assessment: ${parts.join(" · ")}`);
    }
  }

  const stress = seriesStats(series.stress);
  if (stress) {
    lines.push(
      `- Stress while asleep: average ${Math.round(stress.average)} · peak ${Math.round(stress.high)} ` +
        `(${stress.count} samples)`
    );
  }

  if (!hrv && !stress) {
    lines.push(
      series.mcpConnected
        ? "- No HRV or stress samples for this night. COROS keeps them about a week, so " +
            "older nights have none."
        : "- No samples: COROS MCP is not connected."
    );
  }
  if (series.error) {
    lines.push(`- ${series.error}`);
  }

  return lines.join("\n");
}
