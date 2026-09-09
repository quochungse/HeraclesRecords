import {
  callCorosMcpTool,
  ensureCorosMcpConnected,
  getCorosMcpTools,
  listCorosMcpTools
} from "./corosMcpService";
import { recentTrainingHubDateList } from "./trainingTrendUtils";
import type {
  CorosMcpTool,
  TrainingHubSleepRecord,
  TrainingHubSleepSummary
} from "./types";

const PREFERRED_SLEEP_TOOL = "querySleepData";
const FALLBACK_SLEEP_TOOL = "get_sleep_data";

function toOptionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function happenDayToIso(happenDay: string): string {
  return `${happenDay.slice(0, 4)}-${happenDay.slice(4, 6)}-${happenDay.slice(6, 8)}`;
}

function getLocalTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

function isoToHappenDay(value: string): string | undefined {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) {
    return undefined;
  }

  return `${match[1]}${match[2]}${match[3]}`;
}

function normalizeHappenDay(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") {
    return undefined;
  }

  const raw = String(value).trim();
  if (!raw) {
    return undefined;
  }

  if (/^\d{8}$/.test(raw)) {
    return raw;
  }

  const iso = isoToHappenDay(raw);
  if (iso) {
    return iso;
  }

  const parsed = Date.parse(raw);
  if (Number.isFinite(parsed)) {
    const date = new Date(parsed);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}${month}${day}`;
  }

  return undefined;
}

function parseClockMinutes(value?: string): number | undefined {
  if (!value) {
    return undefined;
  }

  const match = value.match(/^(\d{1,2}):(\d{2})/);
  if (!match) {
    return undefined;
  }

  return Number(match[1]) * 60 + Number(match[2]);
}

function dayKeyToUtcMillis(happenDay?: string): number | undefined {
  if (!happenDay || !/^\d{8}$/.test(happenDay)) {
    return undefined;
  }

  return Date.UTC(
    Number(happenDay.slice(0, 4)),
    Number(happenDay.slice(4, 6)) - 1,
    Number(happenDay.slice(6, 8))
  );
}

function sleepWindowDurationMinutes(record: TrainingHubSleepRecord): number | undefined {
  const startMinutes = parseClockMinutes(record.sleepStart);
  const endMinutes = parseClockMinutes(record.sleepEnd);

  if (startMinutes === undefined || endMinutes === undefined) {
    return undefined;
  }

  // When COROS dated both ends, the length is arithmetic rather than inference.
  const startDayMs = dayKeyToUtcMillis(record.sleepStartDay);
  const endDayMs = dayKeyToUtcMillis(record.sleepEndDay);

  if (startDayMs !== undefined && endDayMs !== undefined) {
    const dayGapMinutes = Math.round((endDayMs - startDayMs) / 60_000);
    const span = dayGapMinutes + endMinutes - startMinutes;
    if (span >= 0) {
      return span;
    }
  }

  let adjustedEnd = endMinutes;
  if (adjustedEnd <= startMinutes) {
    adjustedEnd += 24 * 60;
  }

  return adjustedEnd - startMinutes;
}

function isPlausibleMainSleep(record: TrainingHubSleepRecord): boolean {
  const totalMinutes = record.totalMinutes ?? 0;
  const windowMinutes = sleepWindowDurationMinutes(record);

  if (windowMinutes !== undefined && totalMinutes > 0) {
    // Reject records where the clock window is a short nap but duration says overnight sleep.
    if (windowMinutes <= 150 && totalMinutes >= 240) {
      return false;
    }
  }

  return true;
}

function parseClockHour(value?: string): number | undefined {
  if (!value) {
    return undefined;
  }

  const match = value.match(/^(\d{1,2}):(\d{2})/);
  if (!match) {
    return undefined;
  }

  return Number(match[1]);
}

function parseDurationMinutes(value: unknown): number | undefined {
  const direct = toOptionalNumber(value);
  if (direct !== undefined) {
    return direct;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const raw = value.trim().toLowerCase();
  if (!raw) {
    return undefined;
  }

  const hourMinuteMatch = raw.match(
    /^(?:(\d+(?:\.\d+)?)\s*h(?:ours?)?)?\s*(?:(\d+(?:\.\d+)?)\s*m(?:in(?:utes?)?)?)?$/i
  );
  if (hourMinuteMatch) {
    if (!hourMinuteMatch[1] && !hourMinuteMatch[2]) {
      return undefined;
    }

    const hours = hourMinuteMatch[1] ? Number(hourMinuteMatch[1]) : 0;
    const minutes = hourMinuteMatch[2] ? Number(hourMinuteMatch[2]) : 0;
    if (Number.isFinite(hours) && Number.isFinite(minutes)) {
      return hours * 60 + minutes;
    }
  }

  const colonMatch = raw.match(/^(\d+):(\d{2})(?::(\d{2}))?$/);
  if (colonMatch) {
    const hours = Number(colonMatch[1]);
    const minutes = Number(colonMatch[2]);
    const seconds = colonMatch[3] ? Number(colonMatch[3]) : 0;
    if ([hours, minutes, seconds].every(Number.isFinite)) {
      return Math.round(hours * 60 + minutes + seconds / 60);
    }
  }

  return undefined;
}

function readNestedNumber(source: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = source[key];
    const parsed = toOptionalNumber(value);
    if (parsed !== undefined) {
      return parsed;
    }
  }

  return undefined;
}

function readNestedDuration(
  source: Record<string, unknown>,
  keys: string[]
): number | undefined {
  for (const key of keys) {
    const value = source[key];
    const parsed = parseDurationMinutes(value);
    if (parsed !== undefined) {
      return parsed;
    }
  }

  return undefined;
}

function readNestedString(source: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

function extractSleepClocks(value?: string): string[] {
  if (!value) {
    return [];
  }

  const clocks: string[] = [];
  const clockPattern =
    /(?<![\d+-])(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?\s*([ap]\.?(?:m)\.?)?/gi;

  for (const match of value.matchAll(clockPattern)) {
    let hours = Number(match[1]);
    const minutes = Number(match[2]);
    const period = match[3]?.replace(/\./g, "").toLowerCase();

    if (minutes > 59) {
      continue;
    }

    if (period) {
      if (hours < 1 || hours > 12) {
        continue;
      }
      if (period === "pm" && hours < 12) {
        hours += 12;
      } else if (period === "am" && hours === 12) {
        hours = 0;
      }
    } else if (hours > 23) {
      continue;
    }

    clocks.push(
      `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`
    );
  }

  return clocks;
}

function normalizeSleepClock(value?: string): string | undefined {
  return extractSleepClocks(value)[0];
}

function parseSleepClockRange(value?: string): [string?, string?] {
  const clocks = extractSleepClocks(value);

  return [clocks[0], clocks[1]];
}

export interface SleepWindowRange {
  start?: string;
  end?: string;
  startDay?: string;
  endDay?: string;
}

/**
 * A window line, with the days kept when COROS put them there.
 *
 * It writes `Main Sleep Window: 2026-09-08 00:40 - 2026-09-08 06:00`, and the
 * dates are the only thing that says outright whether a night began before
 * midnight. Reading the clocks alone left that to be inferred from which end
 * was smaller, which is right for an ordinary night and wrong for the ones
 * worth being right about: a nap window and a 25-hour gap infer the same way.
 *
 * Falls back to the clock-only reading, because the JSON shapes and older
 * responses give exactly that.
 */
function parseSleepWindowRange(value?: string): SleepWindowRange {
  if (!value) {
    return {};
  }

  // The time half has to be captured whole — seconds and any AM/PM included —
  // or "2026-07-20 10:58:00 PM" reads as ten in the morning.
  const dated = [
    ...value.matchAll(
      /\b(20\d{2})-(\d{2})-(\d{2})[T\s]+(\d{1,2}:\d{2}(?::\d{2})?\s*(?:[ap]\.?m\.?)?)/gi
    )
  ];

  if (dated.length >= 2) {
    const [first, second] = dated;
    return {
      startDay: `${first[1]}${first[2]}${first[3]}`,
      start: normalizeSleepClock(first[4]),
      endDay: `${second[1]}${second[2]}${second[3]}`,
      end: normalizeSleepClock(second[4])
    };
  }

  const [start, end] = parseSleepClockRange(value);
  return { start, end };
}

function readAwakeCountOverFiveMinutes(
  source: Record<string, unknown>
): number | undefined {
  return readNestedNumber(source, [
    "awakeCountOverFiveMinutes",
    "awakeCountOver5Minutes",
    "awakeCountGt5Minutes",
    "awakeCountGt5Min",
    "wakeCountOverFiveMinutes",
    "wakeCountOver5Minutes",
    "wakeupsOverFiveMinutes",
    "wakeupsOver5Minutes",
    "wakeUpsOverFiveMinutes",
    "wakeUpsOver5Minutes"
  ]);
}

function parseNapDurationText(value?: string): number | undefined {
  if (!value) {
    return undefined;
  }

  if (/\b(?:none|no|zero)\b/i.test(value)) {
    return 0;
  }

  return parseDurationMinutes(value);
}

function percentToMinutes(
  percent: number | undefined,
  totalMinutes?: number
): number | undefined {
  if (percent === undefined || totalMinutes === undefined) {
    return undefined;
  }

  const normalized = percent <= 1 ? percent * 100 : percent;
  return Math.round((normalized / 100) * totalMinutes);
}

function normalizePercent(value?: number): number | undefined {
  if (value === undefined || !Number.isFinite(value)) {
    return undefined;
  }

  return value <= 1 ? value * 100 : value;
}

function hasPositiveMinutes(value?: number): boolean {
  return value !== undefined && Number.isFinite(value) && value > 0;
}

function readPhasePercent(
  source: Record<string, unknown>,
  phaseKeys: string[],
  percentKeys: string[]
): number | undefined {
  const direct = readNestedNumber(source, [
    ...percentKeys,
    ...phaseKeys.map((key) => `${key}Percent`),
    ...phaseKeys.map((key) => `${key}Ratio`),
    ...phaseKeys.map((key) => `${key}Percentage`)
  ]);
  if (direct !== undefined) {
    return normalizePercent(direct);
  }

  const phases = source.phases;
  if (!phases || typeof phases !== "object") {
    return undefined;
  }

  const phaseRecord = phases as Record<string, unknown>;
  return normalizePercent(
    readNestedNumber(phaseRecord, [
      ...percentKeys,
      ...phaseKeys.map((key) => `${key}Percent`),
      ...phaseKeys.map((key) => `${key}Ratio`),
      ...phaseKeys.map((key) => `${key}Percentage`)
    ])
  );
}

function readPhaseMinutes(
  source: Record<string, unknown>,
  phaseKeys: string[],
  percentKeys: string[],
  totalMinutes?: number,
  percentDenominatorMinutes?: number
): number | undefined {
  const direct = readNestedDuration(source, phaseKeys);
  if (direct !== undefined) {
    return direct;
  }

  const percent = readNestedNumber(source, [
    ...percentKeys,
    ...phaseKeys.map((key) => `${key}Percent`),
    ...phaseKeys.map((key) => `${key}Ratio`),
    ...phaseKeys.map((key) => `${key}Percentage`)
  ]);

  const fromPercent = percentToMinutes(
    percent,
    percentDenominatorMinutes ?? totalMinutes
  );
  if (fromPercent !== undefined) {
    return fromPercent;
  }

  const phases = source.phases;
  if (!phases || typeof phases !== "object") {
    return undefined;
  }

  const phaseRecord = phases as Record<string, unknown>;
  const nestedMinutes = readNestedDuration(phaseRecord, phaseKeys);
  if (nestedMinutes !== undefined) {
    return nestedMinutes;
  }

  const nestedPercent = readNestedNumber(phaseRecord, [
    ...percentKeys,
    ...phaseKeys,
    ...phaseKeys.map((key) => `${key}Percent`),
    ...phaseKeys.map((key) => `${key}Ratio`)
  ]);

  return percentToMinutes(nestedPercent, percentDenominatorMinutes ?? totalMinutes);
}

function inferLightMinutes(record: TrainingHubSleepRecord): number | undefined {
  if (record.lightMinutes !== undefined) {
    return record.lightMinutes;
  }

  const denominator = record.windowMinutes ?? record.totalMinutes;
  const fromPercent = percentToMinutes(record.lightPercent, denominator);
  if (fromPercent !== undefined) {
    return fromPercent;
  }

  if (record.totalMinutes === undefined) {
    return undefined;
  }

  const accountedSleep = (record.deepMinutes ?? 0) + (record.remMinutes ?? 0);
  const sleepOnlyRemainder = record.totalMinutes - accountedSleep;
  if (sleepOnlyRemainder > 0 && record.windowMinutes !== undefined) {
    return sleepOnlyRemainder;
  }

  const accounted = accountedSleep + (record.awakeMinutes ?? 0);

  if (accounted <= 0 || accounted >= record.totalMinutes) {
    return undefined;
  }

  return record.totalMinutes - accounted;
}

function inferAwakePercent(record: TrainingHubSleepRecord): number | undefined {
  if (record.awakePercent !== undefined) {
    return record.awakePercent;
  }

  const denominator = record.windowMinutes ?? record.totalMinutes;
  if (
    record.awakeMinutes === undefined ||
    denominator === undefined ||
    denominator <= 0
  ) {
    return undefined;
  }

  return Math.round((record.awakeMinutes / denominator) * 1000) / 10;
}

function inferLightPercent(record: TrainingHubSleepRecord): number | undefined {
  if (record.lightPercent !== undefined) {
    return record.lightPercent;
  }

  const known = [
    record.deepPercent,
    record.remPercent,
    record.awakePercent
  ].filter((value): value is number => value !== undefined && Number.isFinite(value));

  if (known.length < 3) {
    return undefined;
  }

  const remaining = 100 - known.reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(remaining) || remaining < -1 || remaining > 100) {
    return undefined;
  }

  return Math.max(0, Math.round(remaining * 10) / 10);
}

function normalizeSleepRecordFields(
  record: TrainingHubSleepRecord
): TrainingHubSleepRecord {
  const withWindow = {
    ...record,
    windowMinutes: record.windowMinutes ?? sleepWindowDurationMinutes(record)
  };
  const withAwakePercent = {
    ...withWindow,
    awakePercent: inferAwakePercent(withWindow)
  };
  const withLightPercent = {
    ...withAwakePercent,
    lightPercent: inferLightPercent(withAwakePercent)
  };

  return {
    ...withLightPercent,
    lightMinutes: inferLightMinutes(withLightPercent)
  };
}

function sleepRecordPartialReason(record: TrainingHubSleepRecord): string | undefined {
  if (record.kind === "nap") {
    return undefined;
  }

  if (!isPlausibleMainSleep(record)) {
    return "Sleep window does not match the reported main sleep duration.";
  }

  if (record.score === undefined) {
    return "Sleep score is still syncing.";
  }

  if ((record.totalMinutes ?? 0) < 180) {
    return "Main sleep duration is still syncing.";
  }

  if (!isOvernightMainSleep(record)) {
    return "Overnight sleep window is still syncing.";
  }

  if (!hasPositiveMinutes(record.deepMinutes) || !hasPositiveMinutes(record.remMinutes)) {
    return "Sleep stages are still syncing.";
  }

  return undefined;
}

function inferSleepKind(
  raw: Record<string, unknown>,
  record: TrainingHubSleepRecord
): "main" | "nap" {
  const explicit = readNestedString(raw, ["sleepType", "type", "recordType", "sleepKind"]);
  if (explicit && /nap/i.test(explicit)) {
    return "nap";
  }
  if (raw.isNap === true || raw.nap === true) {
    return "nap";
  }

  const startHour = parseClockHour(record.sleepStart);
  const duration = record.totalMinutes ?? 0;

  if (
    startHour !== undefined &&
    startHour >= 10 &&
    startHour <= 18 &&
    duration > 0 &&
    duration <= 150
  ) {
    return "nap";
  }

  if (duration > 0 && duration <= 90 && record.score === undefined) {
    return "nap";
  }

  return "main";
}

function finalizeSleepRecord(
  raw: Record<string, unknown>,
  record: TrainingHubSleepRecord
): TrainingHubSleepRecord {
  const normalized = normalizeSleepRecordFields({
    ...record,
    kind: record.kind ?? inferSleepKind(raw, record)
  });
  const computedPartialReason = sleepRecordPartialReason(normalized);
  const partialReason =
    computedPartialReason ??
    (record.completeness === "partial" ? record.partialReason : undefined);

  return {
    ...normalized,
    completeness: partialReason ? "partial" : "complete",
    partialReason
  };
}

function looksLikeSleepRecord(raw: Record<string, unknown>): boolean {
  const keys = Object.keys(raw).join(" ").toLowerCase();
  return /sleep|score|deep|rem|awake|nap|main.?sleep|duration|happen.?day|quality/.test(
    keys
  );
}

function readSleepWindow(raw: Record<string, unknown>): {
  sleepStart?: string;
  sleepEnd?: string;
  sleepStartDay?: string;
  sleepEndDay?: string;
} {
  const sleepWindowValue =
    raw.sleepWindow ??
    raw.mainSleepWindow ??
    raw.sleepTimeRange ??
    raw.sleepPeriod ??
    raw.sleepRange;
  const sleepWindow =
    sleepWindowValue && typeof sleepWindowValue === "object"
      ? (sleepWindowValue as Record<string, unknown>)
      : undefined;
  const [rangeStart, rangeEnd] = parseSleepClockRange(
    typeof sleepWindowValue === "string" ? sleepWindowValue : undefined
  );

  const sleepStart =
    readNestedString(raw, [
      "sleepStart",
      "sleepWindowStart",
      "startTime",
      "sleepStartTime",
      "beginTime",
      "fallAsleepTime",
      "fallAsleep",
      "sleepBeginTime",
      "sleepOnsetTime",
      "bedTime",
      "bedtime"
    ]) ??
    readNestedString(sleepWindow ?? {}, ["start", "startTime", "begin", "from"]) ??
    rangeStart;
  const sleepEnd =
    readNestedString(raw, [
      "sleepEnd",
      "sleepWindowEnd",
      "endTime",
      "sleepEndTime",
      "finishTime",
      "wakeUpTime",
      "wakeUp",
      "sleepFinishTime",
      "getUpTime",
      "wakeTime"
    ]) ??
    readNestedString(sleepWindow ?? {}, ["end", "endTime", "finish", "to"]) ??
    rangeEnd;

  // A single dated string ("2026-09-08 00:40 - 2026-09-08 06:00") carries both
  // ends; separate fields each carry one, and may be dated on their own.
  const rangeText = typeof sleepWindowValue === "string" ? sleepWindowValue : undefined;
  const range = parseSleepWindowRange(rangeText);
  const startDated = parseSleepWindowRange(sleepStart);
  const endDated = parseSleepWindowRange(sleepEnd);

  return {
    sleepStart: normalizeSleepClock(sleepStart) ?? range.start,
    sleepEnd: normalizeSleepClock(sleepEnd) ?? range.end,
    sleepStartDay: startDated.startDay ?? range.startDay,
    sleepEndDay: endDated.startDay ?? range.endDay
  };
}

function parseSleepRecord(
  raw: unknown,
  defaults: Partial<TrainingHubSleepRecord> = {}
): TrainingHubSleepRecord | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }

  const record = raw as Record<string, unknown>;
  if (!looksLikeSleepRecord(record)) {
    return undefined;
  }

  const happenDay = normalizeHappenDay(
    defaults.happenDay ??
      record.happenDay ??
      record.date ??
      record.day ??
      record.sleepDate ??
      record.statDay ??
      record.happen_day ??
      record.sleepDay
  );

  if (!happenDay) {
    return undefined;
  }

  const mainSleepMinutes = readNestedDuration(record, [
    "mainSleepMinutes",
    "mainSleepMinute",
    "mainSleepDurationMinutes",
    "mainSleepDuration",
    "mainSleepTime",
    "mainSleep",
    "totalSleepTime",
    "sSleepTime"
  ]);

  const totalMinutes =
    defaults.kind === "nap"
      ? readNestedDuration(record, [
          "napMinutes",
          "nap_minutes",
          "napDurationMinutes",
          "napDuration",
          "napTime",
          "totalMinutes",
          "durationMinutes"
        ])
      : mainSleepMinutes ??
        readNestedDuration(record, [
          "totalMinutes",
          "totalDurationMinutes",
          "total_duration_minutes",
          "sleepDurationMinutes",
          "durationMinutes",
          "sleepDuration",
          "sleepTime"
        ]) ??
        (() => {
          const seconds = readNestedNumber(record, [
            "totalDurationSeconds",
            "total_duration_seconds",
            "sleepDurationSeconds",
            "mainSleepSeconds"
          ]);
          return seconds !== undefined ? Math.round(seconds / 60) : undefined;
        })();

  const window = readSleepWindow(record);
  const windowMinutes = sleepWindowDurationMinutes({
    happenDay,
    sleepStart: defaults.sleepStart ?? window.sleepStart,
    sleepEnd: defaults.sleepEnd ?? window.sleepEnd,
    sleepStartDay: defaults.sleepStartDay ?? window.sleepStartDay,
    sleepEndDay: defaults.sleepEndDay ?? window.sleepEndDay
  });

  const deepPhaseKeys = [
    "deepMinutes",
    "deep_minutes",
    "deepSleepMinutes",
    "deepSleep",
    "deep",
    "deepTime"
  ];
  const deepPercentKeys = [
    "deepSleepPercent",
    "deepPercent",
    "deepRatio",
    "deepSleepRatio",
    "deepSleepPercentage"
  ];
  const lightPhaseKeys = [
    "lightMinutes",
    "light_minutes",
    "lightSleepMinutes",
    "lightSleep",
    "light",
    "lightTime"
  ];
  const lightPercentKeys = [
    "lightSleepPercent",
    "lightPercent",
    "lightRatio",
    "lightSleepRatio",
    "lightSleepPercentage"
  ];
  const remPhaseKeys = [
    "remMinutes",
    "rem_minutes",
    "remSleepMinutes",
    "remSleep",
    "rem",
    "remTime",
    "eyeTime"
  ];
  const remPercentKeys = [
    "remSleepPercent",
    "remPercent",
    "remRatio",
    "remSleepRatio",
    "remSleepPercentage"
  ];
  const awakePhaseKeys = [
    "awakeMinutes",
    "awake_minutes",
    "wakeMinutes",
    "awakeTime",
    "awake",
    "wakeTime"
  ];
  const awakePercentKeys = [
    "awakePercent",
    "awakeRatio",
    "awakeTimePercent",
    "awakeTimePercentage",
    "wakePercent",
    "wakeRatio",
    "wakeTimePercent"
  ];
  const percentDenominator = windowMinutes ?? totalMinutes;
  const deepPercent = readPhasePercent(record, deepPhaseKeys, deepPercentKeys);
  const lightPercent = readPhasePercent(record, lightPhaseKeys, lightPercentKeys);
  const remPercent = readPhasePercent(record, remPhaseKeys, remPercentKeys);
  const awakePercent = readPhasePercent(record, awakePhaseKeys, awakePercentKeys);

  const deepMinutes = readPhaseMinutes(
    record,
    deepPhaseKeys,
    deepPercentKeys,
    totalMinutes,
    percentDenominator
  );
  const lightMinutes = readPhaseMinutes(
    record,
    lightPhaseKeys,
    lightPercentKeys,
    totalMinutes,
    percentDenominator
  );
  const remMinutes = readPhaseMinutes(
    record,
    remPhaseKeys,
    remPercentKeys,
    totalMinutes,
    percentDenominator
  );
  const awakeMinutes =
    readPhaseMinutes(
      record,
      awakePhaseKeys,
      awakePercentKeys,
      totalMinutes,
      percentDenominator
    ) ??
    readNestedDuration(record, [
      "awakeTimeMinutes",
      "awakeDurationMinutes",
      "awakeDuration",
      "awakeTime",
      "wakeDuration"
    ]);

  const phases =
    record.phases && typeof record.phases === "object"
      ? (record.phases as Record<string, unknown>)
      : undefined;

  return finalizeSleepRecord(record, {
    happenDay,
    kind: defaults.kind,
    totalMinutes,
    score:
      defaults.score ??
      readNestedNumber(record, [
        "score",
        "sleepScore",
        "qualityScore",
        "quality_score",
        "sleepQualityScore",
        "performance"
      ]),
    deepMinutes,
    lightMinutes,
    remMinutes,
    awakeMinutes,
    deepPercent,
    lightPercent,
    remPercent,
    awakePercent,
    awakeCountOverFiveMinutes:
      defaults.awakeCountOverFiveMinutes ?? readAwakeCountOverFiveMinutes(record),
    windowMinutes,
    napMinutes:
      readNestedDuration(record, [
        "napMinutes",
        "nap_minutes",
        "napDurationMinutes",
        "napDuration",
        "shortSleepTime",
        "shortSleep"
      ]) ??
      (phases
        ? readNestedDuration(phases, [
            "napMinutes",
            "nap_minutes",
            "napDurationMinutes",
            "napDuration",
            "shortSleepTime",
            "shortSleep"
          ])
        : undefined),
    napStart: readNestedString(record, ["napStart", "napStartTime", "napWindowStart"]),
    napEnd: readNestedString(record, ["napEnd", "napEndTime", "napWindowEnd"]),
    avgHr: readNestedNumber(record, [
      "avgHr",
      "avg_hr",
      "avgHeartRate",
      "avgHeartRateBpm",
      "averageHeartRate"
    ]),
    sleepStart: defaults.sleepStart ?? window.sleepStart,
    sleepEnd: defaults.sleepEnd ?? window.sleepEnd,
    sleepStartDay: defaults.sleepStartDay ?? window.sleepStartDay,
    sleepEndDay: defaults.sleepEndDay ?? window.sleepEndDay
  });
}

function parseSleepDayBundle(raw: Record<string, unknown>): TrainingHubSleepRecord[] {
  const happenDay = normalizeHappenDay(
    raw.happenDay ?? raw.date ?? raw.day ?? raw.sleepDate ?? raw.statDay
  );

  if (!happenDay) {
    return [];
  }

  const dayScore = readNestedNumber(raw, [
    "score",
    "sleepScore",
    "qualityScore",
    "quality_score",
    "sleepQualityScore",
    "performance"
  ]);

  const records: TrainingHubSleepRecord[] = [];
  const window = readSleepWindow(raw);
  const sleepData = raw.sleepData ?? raw.sleep_data;
  const mainNested =
    raw.mainSleep ?? raw.mainSleepData ?? raw.nightSleep ?? raw.main ?? sleepData;
  const napNested = raw.napSleep ?? raw.napData ?? raw.napInfo;

  if (mainNested && typeof mainNested === "object") {
    const main = parseSleepRecord(mainNested, {
      happenDay,
      kind: "main",
      score: dayScore,
      awakeCountOverFiveMinutes: readAwakeCountOverFiveMinutes(raw),
      sleepStart: window.sleepStart,
      sleepEnd: window.sleepEnd,
      sleepStartDay: window.sleepStartDay,
      sleepEndDay: window.sleepEndDay
    });
    if (main) {
      records.push(main);
    }
  } else {
    const topLevelMain = parseSleepRecord(raw, { happenDay, kind: "main", score: dayScore });
    if (topLevelMain) {
      records.push(topLevelMain);
    }
  }

  const napMinutes = readNestedDuration(raw, [
    "napMinutes",
    "nap_minutes",
    "napDurationMinutes",
    "napDuration",
    "shortSleepTime",
    "shortSleep"
  ]);
  const napStart = readNestedString(raw, ["napStart", "napStartTime", "napWindowStart"]);
  const napEnd = readNestedString(raw, ["napEnd", "napEndTime", "napWindowEnd"]);

  const mainIndex = records.findIndex((record) => record.kind === "main");
  if (mainIndex >= 0 && (napMinutes !== undefined || napStart || napEnd)) {
    records[mainIndex] = finalizeSleepRecord(raw, {
      ...records[mainIndex],
      napMinutes: napMinutes ?? records[mainIndex].napMinutes,
      napStart: napStart ?? records[mainIndex].napStart,
      napEnd: napEnd ?? records[mainIndex].napEnd
    });
  }

  if (napNested && typeof napNested === "object") {
    const nap = parseSleepRecord(napNested, {
      happenDay,
      kind: "nap"
    });
    if (nap) {
      records.push(nap);
    }
  } else if (
    (napMinutes !== undefined && napMinutes > 0) ||
    napStart ||
    napEnd
  ) {
    records.push(
      finalizeSleepRecord(raw, {
        happenDay,
        kind: "nap",
        totalMinutes: napMinutes,
        sleepStart: napStart,
        sleepEnd: napEnd,
        napStart,
        napEnd
      })
    );
  }

  return records;
}

function sleepRecordKey(record: TrainingHubSleepRecord): string {
  return [
    record.happenDay,
    record.kind ?? "main",
    record.sleepStart ?? "",
    record.totalMinutes ?? "",
    record.score ?? ""
  ].join(":");
}

function mergeSleepRecord(
  existing: TrainingHubSleepRecord,
  incoming: TrainingHubSleepRecord
): TrainingHubSleepRecord {
  return finalizeSleepRecord(
    {},
    {
      ...existing,
      ...Object.fromEntries(
        Object.entries(incoming).filter(([, value]) => value !== undefined)
      ),
      kind: existing.kind ?? incoming.kind,
      score: incoming.score ?? existing.score,
      totalMinutes:
        incoming.kind === "nap"
          ? incoming.totalMinutes ?? existing.napMinutes
          : incoming.totalMinutes ?? existing.totalMinutes,
      napMinutes: incoming.napMinutes ?? existing.napMinutes,
      napStart: incoming.napStart ?? existing.napStart,
      napEnd: incoming.napEnd ?? existing.napEnd
    }
  );
}

function sleepRecordCompleteness(record: TrainingHubSleepRecord): number {
  let score = 0;
  if (record.kind === "main") score += 4;
  if (record.score !== undefined) score += 3;
  if (record.totalMinutes !== undefined) score += 3;
  if (hasPositiveMinutes(record.deepMinutes)) score += 1;
  if (hasPositiveMinutes(record.lightMinutes)) score += 1;
  if (hasPositiveMinutes(record.remMinutes)) score += 1;
  if (hasPositiveMinutes(record.awakeMinutes)) score += 1;
  if (record.sleepStart && record.sleepEnd) score += 2;
  if (hasPositiveMinutes(record.napMinutes)) score += 1;
  if (record.napStart && record.napEnd) score += 1;
  return score;
}

function isOvernightMainSleep(record: TrainingHubSleepRecord): boolean {
  if (record.kind === "nap") {
    return false;
  }

  const startHour = parseClockHour(record.sleepStart);
  const endHour = parseClockHour(record.sleepEnd);
  const duration = record.totalMinutes ?? 0;

  if (startHour !== undefined && endHour !== undefined) {
    // Same-evening nap (e.g. 18:28–19:39) — not overnight main sleep.
    if (endHour > startHour && endHour <= 22 && duration <= 150) {
      return false;
    }

    if (startHour >= 21 && endHour <= 12) {
      return true;
    }

    if (startHour >= 20 && endHour <= 10 && duration >= 180) {
      return true;
    }
  }

  if (startHour !== undefined && startHour >= 21) {
    return true;
  }

  if (endHour !== undefined && endHour <= 10 && duration >= 180) {
    return true;
  }

  return duration >= 300;
}

function isCompleteMainSleep(record: TrainingHubSleepRecord): boolean {
  if (record.kind === "nap") {
    return false;
  }

  if (record.completeness === "partial") {
    return false;
  }

  if (record.score === undefined) {
    return false;
  }

  if ((record.totalMinutes ?? 0) < 180) {
    return false;
  }

  if (!isOvernightMainSleep(record)) {
    return false;
  }

  if (!isPlausibleMainSleep(record)) {
    return false;
  }

  return hasPositiveMinutes(record.deepMinutes) || hasPositiveMinutes(record.remMinutes);
}

function isSelectableMainSleep(record: TrainingHubSleepRecord): boolean {
  return record.kind !== "nap" && isPlausibleMainSleep(record);
}

function attachNapToMain(
  main: TrainingHubSleepRecord,
  naps: TrainingHubSleepRecord[]
): TrainingHubSleepRecord {
  const dayNaps = naps.filter((nap) => nap.happenDay === main.happenDay);
  if (dayNaps.length === 0) {
    return main;
  }

  const bestNap = dayNaps.sort(
    (left, right) => (right.totalMinutes ?? 0) - (left.totalMinutes ?? 0)
  )[0];

  return {
    ...main,
    napMinutes: bestNap.totalMinutes ?? main.napMinutes,
    napStart: bestNap.sleepStart ?? main.napStart,
    napEnd: bestNap.sleepEnd ?? main.napEnd
  };
}

export function pickLatestSleepRecord(
  records: TrainingHubSleepRecord[]
): TrainingHubSleepRecord | undefined {
  if (records.length === 0) {
    return undefined;
  }

  const mains = records.filter((record) => record.kind !== "nap");
  const naps = records.filter((record) => record.kind === "nap");
  const selectableMains = mains.filter(isSelectableMainSleep);
  const candidates = selectableMains.length > 0 ? selectableMains : mains;

  const sortedMains = candidates.sort((left, right) => {
    const dayCompare = right.happenDay.localeCompare(left.happenDay);
    if (dayCompare !== 0) {
      return dayCompare;
    }

    const completeCompare =
      Number(isCompleteMainSleep(right)) - Number(isCompleteMainSleep(left));
    if (completeCompare !== 0) {
      return completeCompare;
    }

    const overnightCompare =
      Number(isOvernightMainSleep(right)) - Number(isOvernightMainSleep(left));
    if (overnightCompare !== 0) {
      return overnightCompare;
    }

    return sleepRecordCompleteness(right) - sleepRecordCompleteness(left);
  });

  const latestMain = sortedMains[0];

  if (!latestMain) {
    return undefined;
  }

  return attachNapToMain(latestMain, naps);
}

function extractJsonPayload(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      // fall through
    }
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    try {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
    } catch {
      // fall through
    }
  }

  const firstBracket = trimmed.indexOf("[");
  const lastBracket = trimmed.lastIndexOf("]");
  if (firstBracket >= 0 && lastBracket > firstBracket) {
    try {
      return JSON.parse(trimmed.slice(firstBracket, lastBracket + 1));
    } catch {
      return null;
    }
  }

  return null;
}

function parseProseSleepRecords(
  text: string,
  fallbackHappenDay?: string
): TrainingHubSleepRecord[] {
  const sectionsWithIsoDate = text
    .split(/\n(?=20\d{2}-\d{2}-\d{2}\b)/i)
    .map((section) => section.trim())
    .filter(Boolean);
  const sectionsWithDate = text
    .split(/\n(?=Sleep for\s+)/i)
    .map((section) => section.trim())
    .filter(Boolean);
  const hasIsoDatedSection = sectionsWithIsoDate.some((section) =>
    /^20\d{2}-\d{2}-\d{2}\b/.test(section)
  );
  const hasDatedSection = sectionsWithDate.some((section) =>
    /^Sleep for\s+/i.test(section)
  );
  const sections = hasIsoDatedSection
    ? sectionsWithIsoDate
    : hasDatedSection
    ? sectionsWithDate
    : text
        .split(/\n(?=Sleep score:)/i)
        .map((section) => section.trim())
        .filter(Boolean);

  const candidates = sections.length > 1 ? sections : [text.trim()].filter(Boolean);
  const records: TrainingHubSleepRecord[] = [];

  for (const section of candidates) {
    const record = parseProseSleepSection(section, fallbackHappenDay);
    if (record) {
      records.push(record);
    }
  }

  return records;
}

function parseProseSleepSection(
  section: string,
  fallbackHappenDay?: string
): TrainingHubSleepRecord | undefined {
  const dateMatch = section.match(
    /(?:Sleep for\s+)?(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+([A-Za-z]{3})\s+(\d{1,2})/i
  );
  const monthDateMatch = section.match(/\b([A-Za-z]{3})\s+(\d{1,2}),?\s+(20\d{2})\b/i);
  const isoDateMatch = section.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  const compactDateMatch = section.match(/\b(20\d{6})\b/);
  const scoreMatch = section.match(/Sleep score:\s*(\d+(?:\.\d+)?)/i);
  const mainSleepMatch = section.match(/Main sleep:\s*([^\n]+)/i);
  const awakeMatch = section.match(/Awake time:\s*([^\n]+)/i);
  const awakePercentMatch = section.match(/Awake (?:ratio|percent(?:age)?):\s*(\d+(?:\.\d+)?)\s*%/i);
  const awakeCountMatch = section.match(/(?:Awake count|Wake-ups?|Wakeups?)\s*(?:\(?\s*>?\s*5\s*min(?:utes?)?\s*\)?)?:\s*(\d+)/i);
  const deepMatch = section.match(/Deep(?: sleep)?(?: ratio| percent(?:age)?)?:\s*(\d+(?:\.\d+)?)\s*%/i);
  const lightMatch = section.match(/Light(?: sleep)?(?: ratio| percent(?:age)?)?:\s*(\d+(?:\.\d+)?)\s*%/i);
  const remMatch = section.match(/REM(?: sleep)?(?: ratio| percent(?:age)?)?:\s*(\d+(?:\.\d+)?)\s*%/i);
  const windowLineMatch = section.match(
    /(?:Main\s+)?Sleep\s+(?:window|period|range)\s*:\s*([^\n]+)/i
  );
  const napLineMatch = section.match(/\bNaps?(?:\s+Total)?:\s*([^\n]+)/i);
  const napText = napLineMatch?.[1]?.trim();
  // COROS puts the nap's clock on a line of its own — "Nap Window: 2026-08-12
  // 07:24 - 2026-08-12 08:00" — while "Naps Total" carries only a duration.
  // Reading the duration line for a window found none, so every nap arrived
  // without the hours it happened at.
  const napWindowLineMatch = section.match(/\bNap\s+(?:window|period|range)\s*:\s*([^\n]+)/i);
  const napDurationMatch = napText?.match(
    /\b(?:none|no|zero)\b|(?:(?:\d+(?:\.\d+)?\s*h(?:ours?)?)(?:\s*\d+(?:\.\d+)?\s*m(?:in(?:utes?)?)?)?|\d+(?:\.\d+)?\s*m(?:in(?:utes?)?)?)/i
  );
  const napWindow = parseSleepWindowRange(napWindowLineMatch?.[1] ?? napText);
  const napStart = napWindow.start;
  const napEnd = napWindow.end;

  if (!scoreMatch && !mainSleepMatch) {
    return undefined;
  }

  let happenDay: string | undefined;
  if (monthDateMatch) {
    const monthNames = [
      "jan",
      "feb",
      "mar",
      "apr",
      "may",
      "jun",
      "jul",
      "aug",
      "sep",
      "oct",
      "nov",
      "dec"
    ];
    const monthIndex = monthNames.indexOf(monthDateMatch[1].slice(0, 3).toLowerCase());
    if (monthIndex >= 0) {
      const month = String(monthIndex + 1).padStart(2, "0");
      const day = String(Number(monthDateMatch[2])).padStart(2, "0");
      happenDay = `${monthDateMatch[3]}${month}${day}`;
    }
  } else if (dateMatch) {
    const monthNames = [
      "jan",
      "feb",
      "mar",
      "apr",
      "may",
      "jun",
      "jul",
      "aug",
      "sep",
      "oct",
      "nov",
      "dec"
    ];
    const monthIndex = monthNames.indexOf(dateMatch[1].slice(0, 3).toLowerCase());
    if (monthIndex >= 0) {
      const year = new Date().getFullYear();
      const month = String(monthIndex + 1).padStart(2, "0");
      const day = String(Number(dateMatch[2])).padStart(2, "0");
      happenDay = `${year}${month}${day}`;
    }
  } else if (isoDateMatch) {
    happenDay = `${isoDateMatch[1]}${isoDateMatch[2]}${isoDateMatch[3]}`;
  } else if (compactDateMatch) {
    happenDay = compactDateMatch[1];
  }

  // A prose block that names no date used to be stamped with today's, which is
  // how a night from days ago came to sit on the dashboard as last night's
  // sleep: the record claimed a day it had never been told. The only day it may
  // borrow is the one the caller asked COROS about; a range query pins nothing,
  // so an undated answer to one is dropped rather than dated by guess.
  if (!happenDay) {
    if (!fallbackHappenDay) {
      return undefined;
    }

    happenDay = fallbackHappenDay;
  }

  const totalMinutes = mainSleepMatch
    ? parseDurationMinutes(mainSleepMatch[1].trim())
    : undefined;
  const awakeMinutes = awakeMatch
    ? parseDurationMinutes(awakeMatch[1].trim())
    : undefined;
  const window = parseSleepWindowRange(windowLineMatch?.[1]);
  const sleepStart = window.start;
  const sleepEnd = window.end;
  const windowMinutes = sleepWindowDurationMinutes({
    happenDay,
    sleepStart,
    sleepEnd,
    sleepStartDay: window.startDay,
    sleepEndDay: window.endDay
  });
  const percentDenominator = windowMinutes ?? totalMinutes;
  const deepPercent = deepMatch ? Number(deepMatch[1]) : undefined;
  const lightPercent = lightMatch ? Number(lightMatch[1]) : undefined;
  const remPercent = remMatch ? Number(remMatch[1]) : undefined;
  const awakePercent =
    awakePercentMatch
      ? Number(awakePercentMatch[1])
      : awakeMinutes !== undefined && percentDenominator !== undefined
        ? Math.round((awakeMinutes / percentDenominator) * 1000) / 10
        : undefined;
  const napDurationText = napDurationMatch?.[0]?.trim();

  return finalizeSleepRecord(
    {},
    {
      happenDay,
      kind: "main",
      totalMinutes,
      score: scoreMatch ? Number(scoreMatch[1]) : undefined,
      deepMinutes:
        deepPercent !== undefined && percentDenominator !== undefined
          ? Math.round((deepPercent / 100) * percentDenominator)
          : undefined,
      lightMinutes:
        lightPercent !== undefined && percentDenominator !== undefined
          ? Math.round((lightPercent / 100) * percentDenominator)
          : undefined,
      remMinutes:
        remPercent !== undefined && percentDenominator !== undefined
          ? Math.round((remPercent / 100) * percentDenominator)
          : undefined,
      awakeMinutes,
      deepPercent,
      lightPercent,
      remPercent,
      awakePercent,
      awakeCountOverFiveMinutes: awakeCountMatch ? Number(awakeCountMatch[1]) : undefined,
      windowMinutes,
      sleepStart,
      sleepEnd,
      sleepStartDay: window.startDay,
      sleepEndDay: window.endDay,
      napMinutes: napDurationText ? parseNapDurationText(napDurationText) : undefined,
      napStart,
      napEnd
    }
  );
}

const SLEEP_BUNDLE_CHILD_KEYS = new Set([
  "mainSleep",
  "mainSleepData",
  "nightSleep",
  "main",
  "napSleep",
  "napData",
  "napInfo",
  "sleepData",
  "sleep_data"
]);

function walkForSleepRecords(value: unknown, found: Map<string, TrainingHubSleepRecord>): void {
  if (!value) {
    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      walkForSleepRecords(entry, found);
    }
    return;
  }

  if (typeof value !== "object") {
    return;
  }

  const raw = value as Record<string, unknown>;
  const bundled = parseSleepDayBundle(raw);
  if (bundled.length > 0) {
    for (const record of bundled) {
      const key = sleepRecordKey(record);
      const existing = found.get(key);
      found.set(key, existing ? mergeSleepRecord(existing, record) : record);
    }

    for (const [key, nested] of Object.entries(raw)) {
      if (!SLEEP_BUNDLE_CHILD_KEYS.has(key) && nested && typeof nested === "object") {
        walkForSleepRecords(nested, found);
      }
    }
    return;
  }

  const record = parseSleepRecord(raw);
  if (record) {
    const key = sleepRecordKey(record);
    const existing = found.get(key);
    found.set(key, existing ? mergeSleepRecord(existing, record) : record);
  }

  for (const nested of Object.values(raw)) {
    if (nested && typeof nested === "object") {
      walkForSleepRecords(nested, found);
    }
  }
}

function collectSleepRecords(payload: unknown): TrainingHubSleepRecord[] {
  const found = new Map<string, TrainingHubSleepRecord>();

  if (Array.isArray(payload)) {
    for (const entry of payload) {
      walkForSleepRecords(entry, found);
    }
  } else if (payload && typeof payload === "object") {
    walkForSleepRecords(payload, found);
  }

  return [...found.values()];
}

function unwrapProseText(value: string): string {
  let current = value.trim();

  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (!current) {
      return current;
    }

    try {
      const parsed = JSON.parse(current) as unknown;
      if (typeof parsed !== "string") {
        break;
      }
      current = parsed.trim();
    } catch {
      break;
    }
  }

  if (!current.includes("\n") && current.includes("\\n")) {
    current = current.replace(/\\n/g, "\n");
  }

  return current;
}

function collectProseTexts(payload: unknown, found: string[] = []): string[] {
  if (typeof payload === "string") {
    const text = unwrapProseText(payload);
    if (/sleep|awake|nap|rem/i.test(text)) {
      found.push(text);
    }
    return found;
  }

  if (Array.isArray(payload)) {
    for (const entry of payload) {
      collectProseTexts(entry, found);
    }
    return found;
  }

  if (payload && typeof payload === "object") {
    for (const value of Object.values(payload as Record<string, unknown>)) {
      collectProseTexts(value, found);
    }
  }

  return found;
}

function mergeCollectedSleepRecords(
  records: TrainingHubSleepRecord[]
): TrainingHubSleepRecord[] {
  const merged = new Map<string, TrainingHubSleepRecord>();

  for (const record of records) {
    const key = `${record.happenDay}:${record.kind ?? "main"}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, record);
      continue;
    }

    const preferred =
      sleepRecordCompleteness(record) >= sleepRecordCompleteness(existing)
        ? mergeSleepRecord(existing, record)
        : mergeSleepRecord(record, existing);
    merged.set(key, preferred);
  }

  return [...merged.values()].sort((left, right) =>
    left.happenDay.localeCompare(right.happenDay)
  );
}

/**
 * `fallbackHappenDay` is the day the caller asked COROS about, and it is the
 * only day an undated prose answer may be filed under. Omit it and an undated
 * answer is dropped — see the note in `parseProseSleepSection`.
 *
 * It is also a last resort. A response that dates anything at all — in its JSON
 * or in one of its prose blocks — is answering with days of its own, so an
 * undated block beside them is a leftover, not a night; borrowing the requested
 * day for it would file whatever COROS actually sent under the day we asked
 * for, which is the same lie in a politer form.
 */
export function parseSleepDataResponse(
  text: string,
  fallbackHappenDay?: string
): TrainingHubSleepRecord[] {
  const jsonPayload = extractJsonPayload(text);
  const jsonRecords = collectSleepRecords(jsonPayload);
  const proseTexts = [text, ...collectProseTexts(jsonPayload)].map(unwrapProseText);
  const dated = mergeCollectedSleepRecords([
    ...jsonRecords,
    ...proseTexts.flatMap((candidate) => parseProseSleepRecords(candidate))
  ]);

  if (dated.length > 0 || !fallbackHappenDay) {
    return dated;
  }

  return mergeCollectedSleepRecords(
    proseTexts.flatMap((candidate) =>
      parseProseSleepRecords(candidate, fallbackHappenDay)
    )
  );
}

function resolveSleepTool(tools: CorosMcpTool[]): CorosMcpTool | undefined {
  const preferred = tools.find((tool) => tool.name === PREFERRED_SLEEP_TOOL);
  if (preferred) {
    return preferred;
  }

  const fallback = tools.find((tool) => tool.name === FALLBACK_SLEEP_TOOL);
  if (fallback) {
    return fallback;
  }

  return tools.find(
    (tool) =>
      /sleep/i.test(tool.name) &&
      !/hrv|heart|stress|recovery/i.test(tool.name)
  );
}

function schemaPropertyNames(schema: Record<string, unknown>): string[] {
  const properties = schema.properties;
  if (!properties || typeof properties !== "object") {
    return [];
  }

  return Object.keys(properties as Record<string, unknown>);
}

/**
 * The date format a tool wants, read from the schema it publishes rather than
 * guessed at. COROS documents `yyyyMMdd` on every date property; a server that
 * says `yyyy-MM-dd` gets that instead.
 */
function schemaDateFormat(schema: Record<string, unknown>): "compact" | "iso" {
  const properties = schema.properties;
  if (properties && typeof properties === "object") {
    const described = Object.values(properties as Record<string, unknown>)
      .map((property) =>
        property && typeof property === "object"
          ? String((property as Record<string, unknown>).description ?? "")
          : ""
      )
      .join(" ");

    if (/yyyy-?MM-?dd/i.test(described)) {
      return /yyyy-MM-dd/i.test(described) ? "iso" : "compact";
    }
  }

  return "compact";
}

/**
 * The arguments for one sleep query.
 *
 * This used to be roughly twenty candidates fired in sequence — every spelling
 * of a date range anyone could think of — because nobody knew what the tool
 * accepted. It does say, and what it says is narrow: `startDate` and `endDate`
 * in `yyyyMMdd`, `days`, all three required, `additionalProperties: false`.
 * Nineteen of those twenty were rejected outright ("Tool call anomalies
 * detected"), each one still costing a round trip, which is what made a sleep
 * refresh cost twenty of them.
 *
 * So: one call built from the declared property names, and a short tail of
 * fallbacks for a server that publishes no schema at all. Anything the schema
 * does not name is never sent, because a schema that closes
 * `additionalProperties` will refuse the whole call over one stray key.
 */
export function buildSleepToolArgs(
  tool: CorosMcpTool,
  days: number
): Record<string, unknown>[] {
  const dateList = recentTrainingHubDateList(days);
  const startDay = dateList[dateList.length - 1];
  const endDay = dateList[0];
  const propertyNames = schemaPropertyNames(tool.inputSchema);
  const format = schemaDateFormat(tool.inputSchema);
  const asDate = (happenDay: string) =>
    format === "iso" ? happenDayToIso(happenDay) : happenDay;

  const candidates: Record<string, unknown>[] = [];

  if (propertyNames.length > 0) {
    const declared: Record<string, unknown> = {};
    const set = (name: string, value: unknown) => {
      if (propertyNames.includes(name)) {
        declared[name] = value;
      }
    };

    set("startDate", asDate(startDay));
    set("endDate", asDate(endDay));
    set("startDay", startDay);
    set("endDay", endDay);
    set("start_day", startDay);
    set("end_day", endDay);
    set("days", days);
    set("weeks", Math.max(1, Math.ceil(days / 7)));

    const timezone = getLocalTimeZone();
    if (timezone) {
      set("timezone", timezone);
    }

    if (Object.keys(declared).length > 0) {
      candidates.push(declared);
    }

  } else {
    // No schema to read. Two shapes, not twenty.
    candidates.push(
      { startDate: startDay, endDate: endDay, days },
      { startDate: happenDayToIso(startDay), endDate: happenDayToIso(endDay) }
    );
  }

  // COROS answers a bare call with its default window, which is a useful last
  // resort and the one call that cannot be rejected for its arguments.
  candidates.push({});

  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = JSON.stringify(candidate);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}


export function sleepResponseQuality(records: TrainingHubSleepRecord[]): number {
  const latest = pickLatestSleepRecord(records);
  if (!latest) {
    return records.reduce(
      (total, record) => total + sleepRecordCompleteness(record),
      0
    );
  }

  const happenDayScore = /^\d{8}$/.test(latest.happenDay)
    ? Number(latest.happenDay) - 20_000_000
    : 0;
  const completeBonus = isCompleteMainSleep(latest) ? 5_000 : 0;

  return (
    happenDayScore * 10_000 +
    completeBonus +
    sleepRecordCompleteness(latest) * 100 +
    Math.min(records.length, 30)
  );
}

/** The keys that name one day outright, in the order the args builder uses. */
const EXACT_DAY_ARG_KEYS = [
  "happenDay",
  "happen_day",
  "date",
  "sleepDate",
  "sleep_date",
  "day"
];

/**
 * The single day a set of tool args asks about, or nothing when it asks about a
 * span. An undated answer may be filed under the former and never the latter.
 */
function pinnedHappenDay(args: Record<string, unknown>): string | undefined {
  for (const key of EXACT_DAY_ARG_KEYS) {
    const day = normalizeHappenDay(args[key]);
    if (day) {
      return day;
    }
  }

  const start = normalizeHappenDay(args.startDate ?? args.startDay ?? args.start_day);
  const end = normalizeHappenDay(args.endDate ?? args.endDay ?? args.end_day);
  if (start && start === end) {
    return start;
  }

  return undefined;
}

async function fetchSleepRecords(
  sleepTool: CorosMcpTool,
  days: number
): Promise<TrainingHubSleepRecord[]> {
  const argCandidates = buildSleepToolArgs(sleepTool, days);
  let bestRecords: TrainingHubSleepRecord[] = [];
  let bestScore = -1;
  const collectedRecords: TrainingHubSleepRecord[] = [];

  for (const args of argCandidates) {
    try {
      const response = await callCorosMcpTool(sleepTool.name, args);
      const records = parseSleepDataResponse(response, pinnedHappenDay(args));
      const score = sleepResponseQuality(records);
      collectedRecords.push(...records);

      if (score > bestScore) {
        bestScore = score;
        bestRecords = records;
      }

      // The candidates are ordered best-first now that they are built from the
      // tool's own schema, so an answer with nights in it is *the* answer. The
      // rest of the list is there for a server that refused this one, and
      // asking it anyway was the other half of what made a refresh expensive.
      if (records.length > 0) {
        break;
      }
    } catch (error) {
      console.warn(
        `[sleepDataService] ${sleepTool.name} failed for args ${JSON.stringify(args)}:`,
        error
      );
    }
  }

  const mergedRecords = mergeCollectedSleepRecords(collectedRecords);
  return mergedRecords.length > 0 ? mergedRecords : bestRecords;
}

export async function getTrainingSleepData(
  days = 14
): Promise<TrainingHubSleepSummary> {
  // Silent reconnect only, using stored tokens. A background wellness
  // refresh must never pop an OAuth window on its own — the Coach view asks
  // the athlete before any interactive authorization.
  const connected = await ensureCorosMcpConnected();
  if (!connected) {
    return {
      records: [],
      mcpConnected: false
    };
  }

  try {
    await listCorosMcpTools();
  } catch {
    // fall back to cached tool list
  }

  const sleepTool = resolveSleepTool(getCorosMcpTools());
  if (!sleepTool) {
    return {
      records: [],
      mcpConnected: true
    };
  }

  try {
    const records = await fetchSleepRecords(sleepTool, days);

    return {
      latest: pickLatestSleepRecord(records),
      records,
      mcpConnected: true
    };
  } catch (error) {
    console.warn("[sleepDataService] Failed to fetch sleep data:", error);
    return {
      records: [],
      mcpConnected: true
    };
  }
}
