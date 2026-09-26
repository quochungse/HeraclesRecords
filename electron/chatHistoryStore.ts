import crypto from "node:crypto";
import {
  deleteChatSessionRow,
  getChatPlanDraft,
  getChatSessionRow,
  insertChatSessionRow,
  listChatSessionRows,
  setChatSessionPinnedRow,
  setChatSessionTitleRow,
  updateChatSessionRow
} from "./database";
import type {
  ActivityHrTrendPreview,
  ActivityVisualChannelSection,
  ActivityVisualLapPoint,
  ActivityVisualPreview,
  ChatEntryAnalysisMarker,
  ChatProvider,
  ChatSessionSummary,
  ChatTokenUsage,
  CoachInputChoice,
  CoachInputPrompt,
  FitnessTrendPreview,
  HrZoneEntry,
  HrZonePreview,
  PersistedChatEntry,
  PersistedChatMessageEntry,
  PersistedChatSource,
  PlanDraftPreview,
  PlanEvent,
  PlanDraftPreviewEntry,
  PlanWorkoutEntryInput,
  SaveChatSessionOptions,
  TrainingHubActivitySeriesPoint,
  TrainingHubThresholdZone,
  TrainingHubTrackPoint,
  TrainingTrendPoint,
  WorkoutDeletePreview
} from "./types";
import { migrateActivityHrTrendPreview } from "./chatActivityTools";
import { deviceId } from "./sync/deviceIdentity";
import { contentKey, transcriptEntryId } from "./sync/rowMergers";

export interface ChatSessionRow {
  id: string;
  provider: string;
  title: string;
  messages_json: string;
  created_at: string;
  updated_at: string;
  pinned_at?: string | null;
}

export interface ChatSessionDatabase {
  listSessions(provider: ChatProvider): ChatSessionRow[];
  getSession(id: string): ChatSessionRow | undefined;
  insertSession(
    id: string,
    provider: ChatProvider,
    title: string,
    messagesJson: string,
    createdAt: string,
    updatedAt: string
  ): void;
  updateSession(
    id: string,
    title: string,
    messagesJson: string,
    updatedAt: string
  ): void;
  setSessionPinned(id: string, pinnedAt: string | null): void;
  setSessionTitle(id: string, title: string): void;
  deleteSession(id: string): void;
}

function createSqliteSessionDatabase(): ChatSessionDatabase {
  return {
    listSessions: (provider) => listChatSessionRows(provider),
    getSession: (id) => getChatSessionRow(id),
    insertSession: (id, provider, title, messagesJson, createdAt, updatedAt) =>
      insertChatSessionRow(
        id,
        provider,
        title,
        messagesJson,
        createdAt,
        updatedAt
      ),
    updateSession: (id, title, messagesJson, updatedAt) =>
      updateChatSessionRow(id, title, messagesJson, updatedAt),
    setSessionPinned: (id, pinnedAt) => setChatSessionPinnedRow(id, pinnedAt),
    setSessionTitle: (id, title) => setChatSessionTitleRow(id, title),
    deleteSession: (id) => deleteChatSessionRow(id)
  };
}

const defaultDatabase = createSqliteSessionDatabase();

const DEFAULT_SESSION_TITLE = "New chat";
const SESSION_TITLE_MAX = 48;

function normalizeProvider(value: unknown): ChatProvider {
  if (
    value === "local" ||
    value === "claude-code" ||
    value === "claude-api" ||
    value === "openrouter"
  ) {
    return value;
  }
  return "chatgpt";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Keys a newer build wrote that this one has no parser for, put back on what
 * this one rebuilt. Every object below is reconstructed field by field, which
 * validates the fields it names — and used to drop every other one in silence,
 * so a save here could strip what a newer build on another machine stored.
 *
 * `handled` is what the parser reads, valid or not: a known field it rejected
 * must stay rejected rather than come back from the raw value. Unknown keys go
 * after the rebuilt ones, so an entry without any serializes exactly as before
 * and an unchanged save still leaves the row untouched.
 */
function keepUnknownKeys<T extends object>(
  parsed: T,
  raw: Record<string, unknown>,
  handled: readonly string[]
): T {
  let unknown: Record<string, unknown> | undefined;
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined || handled.includes(key)) continue;
    (unknown ??= {})[key] = value;
  }
  return unknown ? { ...parsed, ...unknown } : parsed;
}

function parseSource(value: unknown): PersistedChatSource | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  if (
    typeof value.snapshotIncluded !== "boolean" ||
    typeof value.mcpEnabled !== "boolean" ||
    typeof value.mcpUsed !== "boolean" ||
    !Array.isArray(value.mcpTools) ||
    !value.mcpTools.every((entry) => typeof entry === "string")
  ) {
    return undefined;
  }

  const source: PersistedChatSource = {
    snapshotIncluded: value.snapshotIncluded,
    mcpEnabled: value.mcpEnabled,
    mcpUsed: value.mcpUsed,
    mcpTools: value.mcpTools
  };
  if (typeof value.mcpError === "string" && value.mcpError.trim()) {
    source.mcpError = value.mcpError;
  }
  return keepUnknownKeys(source, value, [
    "snapshotIncluded",
    "mcpEnabled",
    "mcpUsed",
    "mcpTools",
    "mcpError"
  ]);
}

const PLAN_EVENT_ACTIONS = ["edited", "restored", "imported", "removedOnCoros"] as const;

function parsePlanEvent(value: unknown): PlanEvent | null {
  if (
    !isRecord(value) ||
    typeof value.eventId !== "string" ||
    typeof value.artifactId !== "string" ||
    typeof value.draftId !== "string" ||
    typeof value.name !== "string" ||
    typeof value.at !== "number" ||
    !Number.isFinite(value.at) ||
    !(PLAN_EVENT_ACTIONS as readonly unknown[]).includes(value.action)
  ) {
    return null;
  }
  const version = (raw: unknown) =>
    typeof raw === "number" && Number.isInteger(raw) && raw > 0 ? raw : undefined;
  const fromVersion = version(value.fromVersion);
  const toVersion = version(value.toVersion);
  const changes = Array.isArray(value.changes)
    ? value.changes.filter((line): line is string => typeof line === "string")
    : undefined;
  return keepUnknownKeys<PlanEvent>(
    {
      eventId: value.eventId,
      artifactId: value.artifactId,
      draftId: value.draftId,
      action: value.action as PlanEvent["action"],
      author: value.author === "coros" ? "coros" : "athlete",
      name: value.name,
      artifactType: value.artifactType === "workout" ? "workout" : "plan",
      ...(fromVersion ? { fromVersion } : {}),
      ...(toVersion ? { toVersion } : {}),
      ...(changes ? { changes } : {}),
      at: value.at
    },
    value,
    [
      "eventId",
      "artifactId",
      "draftId",
      "action",
      "author",
      "name",
      "artifactType",
      "fromVersion",
      "toVersion",
      "changes",
      "at"
    ]
  );
}

function parseCoachInputPrompt(value: unknown): CoachInputPrompt | null {
  if (
    !isRecord(value) ||
    typeof value.promptId !== "string" ||
    typeof value.question !== "string" ||
    typeof value.allowCustom !== "boolean" ||
    !Array.isArray(value.choices)
  ) {
    return null;
  }

  const choices = value.choices
    .map((choice): CoachInputChoice | null => {
      if (
        !isRecord(choice) ||
        typeof choice.id !== "string" ||
        typeof choice.label !== "string" ||
        typeof choice.response !== "string"
      ) {
        return null;
      }
      return keepUnknownKeys(
        {
          id: choice.id,
          label: choice.label,
          response: choice.response,
          ...(typeof choice.description === "string"
            ? { description: choice.description }
            : {})
        },
        choice,
        ["id", "label", "response", "description"]
      );
    })
    .filter((choice): choice is CoachInputChoice => choice !== null);

  if (choices.length !== value.choices.length || choices.length < 2) {
    return null;
  }

  return keepUnknownKeys(
    {
      promptId: value.promptId,
      question: value.question,
      choices,
      allowCustom: value.allowCustom,
      ...(typeof value.answer === "string" ? { answer: value.answer } : {}),
      ...(typeof value.selectedChoiceId === "string"
        ? { selectedChoiceId: value.selectedChoiceId }
        : {}),
      ...(typeof value.answeredAt === "number"
        ? { answeredAt: value.answeredAt }
        : {})
    },
    value,
    ["promptId", "question", "choices", "allowCustom", "answer", "selectedChoiceId", "answeredAt"]
  );
}

const PERSISTED_WORKOUT_SPORTS = new Set([
  "run",
  "trailRun",
  "bike",
  "swim",
  "strength",
  "xcSki",
  "indoorClimb",
  "bouldering",
  "hyrox"
]);

type PersistedPlanStep = NonNullable<PlanWorkoutEntryInput["steps"]>[number];

function parsePersistedPlanStep(value: unknown): PersistedPlanStep | null {
  if (!isRecord(value)) return null;

  if (typeof value.repeat === "number") {
    if (!Array.isArray(value.steps)) return null;
    const children = value.steps.filter(
      (step): step is Record<string, unknown> =>
        isRecord(step) && typeof step.kind === "string"
    );
    if (children.length !== value.steps.length) return null;
    return {
      ...value,
      steps: children.map((step) => ({ ...step }))
    } as unknown as PersistedPlanStep;
  }

  if (typeof value.kind !== "string") return null;
  return { ...value } as unknown as PersistedPlanStep;
}

function parsePlanWorkoutSource(
  value: unknown
): PlanWorkoutEntryInput | undefined {
  if (
    !isRecord(value) ||
    typeof value.key !== "string" ||
    typeof value.name !== "string"
  ) {
    return undefined;
  }

  const parsedSteps = Array.isArray(value.steps)
    ? value.steps.map(parsePersistedPlanStep)
    : undefined;
  const steps = parsedSteps?.every(
    (step): step is PersistedPlanStep => step !== null
  )
    ? parsedSteps
    : undefined;
  const sport =
    typeof value.sport === "string" && PERSISTED_WORKOUT_SPORTS.has(value.sport)
      ? value.sport as PlanWorkoutEntryInput["sport"]
      : undefined;

  return keepUnknownKeys(
    {
      key: value.key,
      name: value.name,
      ...(typeof value.description === "string"
        ? { description: value.description }
        : {}),
      ...(sport ? { sport } : {}),
      ...(isRecord(value.sport_options)
        ? {
            sport_options: {
              ...value.sport_options
            } as PlanWorkoutEntryInput["sport_options"]
          }
        : {}),
      ...(steps ? { steps } : {}),
      ...(typeof value.distance_km === "number"
        ? { distance_km: value.distance_km }
        : {}),
      ...(typeof value.schedule_date === "string"
        ? { schedule_date: value.schedule_date }
        : {}),
      ...(typeof value.sort_no === "number" ? { sort_no: value.sort_no } : {}),
      ...(typeof value.save_to_library === "boolean"
        ? { save_to_library: value.save_to_library }
        : {})
    },
    value,
    [
      "key",
      "name",
      "description",
      "sport",
      "sport_options",
      "steps",
      "distance_km",
      "schedule_date",
      "sort_no",
      "save_to_library"
    ]
  );
}

function parsePlanDraftEntry(value: unknown): PlanDraftPreviewEntry | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    typeof value.key !== "string" ||
    typeof value.name !== "string" ||
    typeof value.saveToLibrary !== "boolean" ||
    typeof value.workoutType !== "string"
  ) {
    return null;
  }

  const source = parsePlanWorkoutSource(value.source);
  return keepUnknownKeys(
    {
      key: value.key,
      name: value.name,
      sport: typeof value.sport === "string"
        ? value.sport as PlanDraftPreviewEntry["sport"]
        : undefined,
      scheduleDate:
        typeof value.scheduleDate === "string" ? value.scheduleDate : undefined,
      volume: typeof value.volume === "string" ? value.volume : undefined,
      saveToLibrary: value.saveToLibrary,
      workoutType: value.workoutType,
      stepsSummary:
        typeof value.stepsSummary === "string" ? value.stepsSummary : undefined,
      ...(source ? { source } : {})
    },
    value,
    [
      "key",
      "name",
      "sport",
      "scheduleDate",
      "volume",
      "saveToLibrary",
      "workoutType",
      "stepsSummary",
      "source"
    ]
  );
}

function parsePlanDraft(value: unknown): PlanDraftPreview | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    typeof value.draftId !== "string" ||
    typeof value.name !== "string" ||
    typeof value.summary !== "string" ||
    !Array.isArray(value.entries) ||
    !Array.isArray(value.conflicts) ||
    !Array.isArray(value.warnings)
  ) {
    return null;
  }

  const entries = value.entries
    .map((entry) => parsePlanDraftEntry(entry))
    .filter((entry): entry is PlanDraftPreviewEntry => entry !== null);
  if (entries.length !== value.entries.length) {
    return null;
  }

  if (
    !value.conflicts.every((entry) => typeof entry === "string") ||
    !value.warnings.every((entry) => typeof entry === "string")
  ) {
    return null;
  }

  return keepUnknownKeys<PlanDraftPreview>(
    {
      draftId: value.draftId,
      artifactType: value.artifactType === "workout" ? "workout" : "plan",
      name: value.name,
      summary: value.summary,
      entries,
      conflicts: value.conflicts,
      warnings: value.warnings,
      uploadedAt:
        typeof value.uploadedAt === "number" ? value.uploadedAt : undefined,
      // Both are read as timestamps (a removed card is hidden, an edited one is
      // restated to the coach), so they are typed here, not passed through.
      removedAt:
        typeof value.removedAt === "number" ? value.removedAt : undefined,
      editedAt:
        typeof value.editedAt === "number" ? value.editedAt : undefined,
      uploadResult:
        isRecord(value.uploadResult) &&
        typeof value.uploadResult.workoutsScheduled === "number" &&
        typeof value.uploadResult.workoutsCreated === "number"
          ? keepUnknownKeys<NonNullable<PlanDraftPreview["uploadResult"]>>(
              {
                workoutsScheduled: value.uploadResult.workoutsScheduled,
                workoutsCreated: value.uploadResult.workoutsCreated,
                destination:
                  value.uploadResult.destination === "workoutLibrary" ||
                  value.uploadResult.destination === "calendar" ||
                  value.uploadResult.destination === "localPlan" ||
                  value.uploadResult.destination === "nativePlan" ||
                  value.uploadResult.destination === "localTemplate" ||
                  value.uploadResult.destination === "nativePlanAndCalendar"
                    ? value.uploadResult.destination
                    : undefined,
                planId:
                  typeof value.uploadResult.planId === "string"
                    ? value.uploadResult.planId
                    : undefined
              },
              value.uploadResult,
              ["workoutsScheduled", "workoutsCreated", "destination", "planId"]
            )
          : undefined
    },
    value,
    [
      "draftId",
      "artifactType",
      "name",
      "summary",
      "entries",
      "conflicts",
      "warnings",
      "uploadedAt",
      "removedAt",
      "editedAt",
      "uploadResult"
    ]
  );
}

function parseWorkoutDeletePreview(value: unknown): WorkoutDeletePreview | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    typeof value.requestId !== "string" ||
    (value.target !== "scheduled" &&
      value.target !== "library" &&
      value.target !== "both") ||
    typeof value.summary !== "string"
  ) {
    return null;
  }

  return keepUnknownKeys<WorkoutDeletePreview>(
    {
      requestId: value.requestId,
      target: value.target,
      workoutName:
        typeof value.workoutName === "string" ? value.workoutName : undefined,
      scheduleDate:
        typeof value.scheduleDate === "string" ? value.scheduleDate : undefined,
      programId: typeof value.programId === "string" ? value.programId : undefined,
      summary: value.summary
    },
    value,
    ["requestId", "target", "workoutName", "scheduleDate", "programId", "summary"]
  );
}

function parseSeriesPoint(value: unknown): TrainingHubActivitySeriesPoint | null {
  if (!isRecord(value)) {
    return null;
  }

  // Every channel the sample can carry, so a reloaded conversation draws the
  // same charts it drew when the tool ran. A channel missing here is a channel
  // that silently empties out on the next session restore.
  const point: TrainingHubActivitySeriesPoint = {};
  for (const channel of SERIES_POINT_CHANNELS) {
    const sample = value[channel];
    if (typeof sample === "number") {
      point[channel] = sample;
    }
  }

  return Object.keys(point).length > 0
    ? keepUnknownKeys(point, value, SERIES_POINT_CHANNELS)
    : null;
}

const SERIES_POINT_CHANNELS = [
  "elapsed",
  "distance",
  "hr",
  "pace",
  "power",
  "altitude",
  "cadence",
  "strideLength",
  "groundTime",
  "verticalOscillation",
  "verticalRatio"
] as const satisfies readonly (keyof TrainingHubActivitySeriesPoint)[];

function parseTrackPoint(value: unknown): TrainingHubTrackPoint | null {
  if (!isRecord(value)) {
    return null;
  }

  const point: TrainingHubTrackPoint = {};
  if (typeof value.lat === "number") point.lat = value.lat;
  if (typeof value.lon === "number") point.lon = value.lon;
  if (typeof value.elevation === "number") point.elevation = value.elevation;
  if (typeof value.distance === "number") point.distance = value.distance;
  return Object.keys(point).length > 0
    ? keepUnknownKeys(point, value, ["lat", "lon", "elevation", "distance"])
    : null;
}

function parseVisualLapPoint(value: unknown): ActivityVisualLapPoint | null {
  if (!isRecord(value) || typeof value.index !== "number") {
    return null;
  }

  return keepUnknownKeys(
    {
      index: value.index,
      avgHr: typeof value.avgHr === "number" ? value.avgHr : undefined,
      maxHr: typeof value.maxHr === "number" ? value.maxHr : undefined,
      distance: typeof value.distance === "number" ? value.distance : undefined,
      duration: typeof value.duration === "number" ? value.duration : undefined,
      pace: typeof value.pace === "number" ? value.pace : undefined,
      avgCadence: typeof value.avgCadence === "number" ? value.avgCadence : undefined
    },
    value,
    ["index", "avgHr", "maxHr", "distance", "duration", "pace", "avgCadence"]
  );
}

function parseChannelSection(value: unknown): ActivityVisualChannelSection | null {
  if (!isRecord(value)) {
    return null;
  }
  if (value.chartKind !== "series" && value.chartKind !== "laps") {
    return null;
  }

  let series: TrainingHubActivitySeriesPoint[] | undefined;
  if (Array.isArray(value.series)) {
    const parsed = value.series
      .map((point) => parseSeriesPoint(point))
      .filter((point): point is TrainingHubActivitySeriesPoint => point !== null);
    if (parsed.length !== value.series.length) {
      return null;
    }
    series = parsed.length > 0 ? parsed : undefined;
  }

  let laps: ActivityVisualLapPoint[] | undefined;
  if (Array.isArray(value.laps)) {
    const parsed = value.laps
      .map((lap) => parseVisualLapPoint(lap))
      .filter((lap): lap is ActivityVisualLapPoint => lap !== null);
    if (parsed.length !== value.laps.length) {
      return null;
    }
    laps = parsed.length > 0 ? parsed : undefined;
  }

  return keepUnknownKeys<ActivityVisualChannelSection>(
    {
      chartKind: value.chartKind,
      series,
      laps
    },
    value,
    ["chartKind", "series", "laps"]
  );
}

function parseActivityVisualPreview(value: unknown): ActivityVisualPreview | null {
  if (!isRecord(value)) {
    return null;
  }

  if (typeof value.previewId !== "string" || typeof value.activityId !== "string") {
    return null;
  }

  if (!isRecord(value.sections)) {
    return null;
  }

  const sections: ActivityVisualPreview["sections"] = {};
  if (value.sections.hr !== undefined) {
    const hr = parseChannelSection(value.sections.hr);
    if (!hr) {
      return null;
    }
    sections.hr = hr;
  }

  if (value.sections.cadence !== undefined) {
    const cadence = parseChannelSection(value.sections.cadence);
    if (!cadence) {
      return null;
    }
    sections.cadence = cadence;
  }

  if (value.sections.pace !== undefined) {
    if (!isRecord(value.sections.pace) || !Array.isArray(value.sections.pace.series)) {
      return null;
    }
    const series = value.sections.pace.series
      .map((point) => parseSeriesPoint(point))
      .filter((point): point is TrainingHubActivitySeriesPoint => point !== null);
    if (series.length !== value.sections.pace.series.length) {
      return null;
    }
    sections.pace = keepUnknownKeys({ series }, value.sections.pace, ["series"]);
  }

  if (value.sections.power !== undefined) {
    if (!isRecord(value.sections.power) || !Array.isArray(value.sections.power.series)) {
      return null;
    }
    const series = value.sections.power.series
      .map((point) => parseSeriesPoint(point))
      .filter((point): point is TrainingHubActivitySeriesPoint => point !== null);
    if (series.length !== value.sections.power.series.length) {
      return null;
    }
    sections.power = keepUnknownKeys({ series }, value.sections.power, ["series"]);
  }

  if (value.sections.elevation !== undefined) {
    if (
      !isRecord(value.sections.elevation) ||
      !Array.isArray(value.sections.elevation.points)
    ) {
      return null;
    }
    const points = value.sections.elevation.points
      .map((point) => parseTrackPoint(point))
      .filter((point): point is TrainingHubTrackPoint => point !== null);
    if (points.length !== value.sections.elevation.points.length) {
      return null;
    }
    sections.elevation = keepUnknownKeys({ points }, value.sections.elevation, ["points"]);
  }

  if (Array.isArray(value.sections.laps)) {
    const laps = value.sections.laps
      .map((lap) => parseVisualLapPoint(lap))
      .filter((lap): lap is ActivityVisualLapPoint => lap !== null);
    if (laps.length !== value.sections.laps.length) {
      return null;
    }
    sections.laps = laps;
  }

  return keepUnknownKeys(
    {
      previewId: value.previewId,
      activityId: value.activityId,
      sportType: typeof value.sportType === "number" ? value.sportType : undefined,
      name: typeof value.name === "string" ? value.name : undefined,
      startTime: typeof value.startTime === "string" ? value.startTime : undefined,
      avgHr: typeof value.avgHr === "number" ? value.avgHr : undefined,
      maxHr: typeof value.maxHr === "number" ? value.maxHr : undefined,
      sections: keepUnknownKeys(sections, value.sections, [
        "hr",
        "cadence",
        "pace",
        "power",
        "elevation",
        "laps"
      ])
    },
    value,
    ["previewId", "activityId", "sportType", "name", "startTime", "avgHr", "maxHr", "sections"]
  );
}

function parseHrTrendLapPoint(value: unknown): ActivityVisualLapPoint | null {
  return parseVisualLapPoint(value);
}

function parseHrTrendPreview(value: unknown): ActivityHrTrendPreview | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    typeof value.previewId !== "string" ||
    typeof value.activityId !== "string" ||
    (value.chartKind !== "series" && value.chartKind !== "laps")
  ) {
    return null;
  }

  let series: TrainingHubActivitySeriesPoint[] | undefined;
  if (Array.isArray(value.series)) {
    const parsed = value.series
      .map((point) => parseSeriesPoint(point))
      .filter((point): point is TrainingHubActivitySeriesPoint => point !== null);
    if (parsed.length !== value.series.length) {
      return null;
    }
    series = parsed.length > 0 ? parsed : undefined;
  }

  let laps: ActivityVisualLapPoint[] | undefined;
  if (Array.isArray(value.laps)) {
    const parsed = value.laps
      .map((lap) => parseHrTrendLapPoint(lap))
      .filter((lap): lap is ActivityVisualLapPoint => lap !== null);
    if (parsed.length !== value.laps.length) {
      return null;
    }
    laps = parsed.length > 0 ? parsed : undefined;
  }

  return {
    previewId: value.previewId,
    activityId: value.activityId,
    name: typeof value.name === "string" ? value.name : undefined,
    startTime: typeof value.startTime === "string" ? value.startTime : undefined,
    avgHr: typeof value.avgHr === "number" ? value.avgHr : undefined,
    maxHr: typeof value.maxHr === "number" ? value.maxHr : undefined,
    chartKind: value.chartKind,
    series,
    laps
  };
}

function parseTrendPoint(value: unknown): TrainingTrendPoint | null {
  if (!isRecord(value) || typeof value.date !== "string" || typeof value.label !== "string") {
    return null;
  }

  return keepUnknownKeys(
    {
      date: value.date,
      label: value.label,
      trainingLoad:
        typeof value.trainingLoad === "number" ? value.trainingLoad : undefined,
      avgSleepHrv:
        typeof value.avgSleepHrv === "number" ? value.avgSleepHrv : undefined,
      sleepHrvBase:
        typeof value.sleepHrvBase === "number" ? value.sleepHrvBase : undefined,
      rhr: typeof value.rhr === "number" ? value.rhr : undefined
    },
    value,
    ["date", "label", "trainingLoad", "avgSleepHrv", "sleepHrvBase", "rhr"]
  );
}

function parseFitnessTrendPreview(value: unknown): FitnessTrendPreview | null {
  if (!isRecord(value) || typeof value.previewId !== "string") {
    return null;
  }
  if (!Array.isArray(value.trendPoints)) {
    return null;
  }

  const trendPoints = value.trendPoints
    .map((point) => parseTrendPoint(point))
    .filter((point): point is TrainingTrendPoint => point !== null);
  if (trendPoints.length !== value.trendPoints.length) {
    return null;
  }

  return keepUnknownKeys({ previewId: value.previewId, trendPoints }, value, [
    "previewId",
    "trendPoints"
  ]);
}

function parseThresholdZone(value: unknown): TrainingHubThresholdZone | null {
  if (!isRecord(value) || typeof value.index !== "number") {
    return null;
  }

  return keepUnknownKeys(
    {
      index: value.index,
      hr: typeof value.hr === "number" ? value.hr : undefined,
      pace: typeof value.pace === "number" ? value.pace : undefined,
      ratio: typeof value.ratio === "number" ? value.ratio : undefined
    },
    value,
    ["index", "hr", "pace", "ratio"]
  );
}

function parseHrZoneEntry(value: unknown): HrZoneEntry | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    typeof value.index !== "number" ||
    typeof value.label !== "string" ||
    typeof value.percent !== "number" ||
    typeof value.value !== "number"
  ) {
    return null;
  }

  return keepUnknownKeys(
    {
      index: value.index,
      label: value.label,
      percent: value.percent,
      value: value.value
    },
    value,
    ["index", "label", "percent", "value"]
  );
}

function parseHrZonePreview(value: unknown): HrZonePreview | null {
  if (!isRecord(value) || typeof value.previewId !== "string") {
    return null;
  }
  if (
    value.metric !== "time" &&
    value.metric !== "distance" &&
    value.metric !== "trainingLoad"
  ) {
    return null;
  }
  if (!Array.isArray(value.zones) || !Array.isArray(value.lthrZones)) {
    return null;
  }

  const zones = value.zones
    .map((zone) => parseHrZoneEntry(zone))
    .filter((zone): zone is HrZoneEntry => zone !== null);
  const lthrZones = value.lthrZones
    .map((zone) => parseThresholdZone(zone))
    .filter((zone): zone is TrainingHubThresholdZone => zone !== null);
  if (zones.length !== value.zones.length || lthrZones.length !== value.lthrZones.length) {
    return null;
  }

  return keepUnknownKeys<HrZonePreview>(
    {
      previewId: value.previewId,
      metric: value.metric,
      zones,
      lthrZones
    },
    value,
    ["previewId", "metric", "zones", "lthrZones"]
  );
}

/**
 * Attribution is rebuilt field by field like everything else here: a marker
 * missing any of the four fields an analysis actually carries is dropped rather
 * than half-restored, so the UI never renders an analysis chip it cannot
 * attribute.
 *
 * **`bindingId` is optional, and it has to be.** It named an attachment, which
 * no longer exists — `runAnalysis` deliberately stops writing it, and
 * `ChatEntryAnalysisMarker` has declared it optional ever since. This parser
 * went on demanding it, and every entry is rebuilt through here on the way both
 * in and out (`normalizeEntries` runs on every save), so a run's own answer lost
 * its marker in the same statement that stored it: the chip never appeared, and
 * the synthetic playbook turn that opens a run rendered as the athlete saying
 * "Một hoạt động mới vừa được đồng bộ…" in their own bubble. Entries written
 * while attachments existed still carry one and still parse.
 */
function parseAnalysisMarker(
  value: unknown
): ChatEntryAnalysisMarker | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  // `bindingId` keeps its old position rather than being appended last, because
  // `foreignTail` compares entries as `JSON.stringify` of what this parser
  // built and `saveChatSession` skips a write when the serialized row is
  // unchanged. Reordering a key would make every transcript holding one look
  // rewritten on its next save.
  const optional = new Set(["bindingId"]);
  const fields = ["runId", "automationId", "bindingId", "name", "triggerLabel"] as const;
  const marker: Record<string, string> = {};
  for (const field of fields) {
    const entry = value[field];
    if (typeof entry !== "string" || !entry.trim()) {
      if (optional.has(field)) continue;
      return undefined;
    }
    marker[field] = entry;
  }
  return keepUnknownKeys(marker, value, fields) as unknown as ChatEntryAnalysisMarker;
}

/**
 * What the answer cost, restored for the footer under it. Rebuilt field by
 * field like everything else in this file, which is the reason it has to exist
 * at all: an entry is reassembled from the fields named here, so a stored count
 * nothing reads back is a count the athlete sees once and never again.
 *
 * A half-reported pair is dropped rather than half-restored. Zero is kept — a
 * provider that reported nothing leaves this undefined, so a zero that got here
 * is a turn someone actually counted as free.
 */
function parseTokenUsage(value: unknown): ChatTokenUsage | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const count = (field: "inputTokens" | "outputTokens"): number | null => {
    const entry = value[field];
    return typeof entry === "number" && Number.isFinite(entry) && entry >= 0
      ? entry
      : null;
  };
  const inputTokens = count("inputTokens");
  const outputTokens = count("outputTokens");
  return inputTokens === null || outputTokens === null
    ? undefined
    : keepUnknownKeys({ inputTokens, outputTokens }, value, ["inputTokens", "outputTokens"]);
}

function parseMessageEntry(value: unknown): PersistedChatMessageEntry | null {
  if (!isRecord(value)) {
    return null;
  }

  const role =
    value.role === "assistant" ? "assistant" : value.role === "user" ? "user" : null;
  if (!role || typeof value.content !== "string") {
    return null;
  }

  const source = parseSource(value.source);
  const reasoningSummary =
    typeof value.reasoningSummary === "string" && value.reasoningSummary.trim()
      ? value.reasoningSummary
      : undefined;
  const automation = parseAnalysisMarker(value.automation);
  const usage = parseTokenUsage(value.usage);
  const model =
    typeof value.model === "string" && value.model.trim()
      ? value.model.trim()
      : undefined;
  return keepUnknownKeys<PersistedChatMessageEntry>(
    {
      kind: "message",
      role,
      content: value.content,
      ...(source ? { source } : {}),
      ...(reasoningSummary ? { reasoningSummary } : {}),
      ...(usage ? { usage } : {}),
      ...(model ? { model } : {}),
      ...(automation ? { automation } : {})
    },
    value,
    [...ENTRY_META_KEYS, "role", "content", "source", "reasoningSummary", "usage", "model", "automation"]
  );
}

/** On every entry; `mid`/`mrev` are carried by `withMergeMeta`, not passed through. */
const ENTRY_META_KEYS = ["kind", "mid", "mrev"] as const;

/** Every kind this build parses. Anything else is a newer build's, kept verbatim. */
const KNOWN_ENTRY_KINDS = new Set([
  "message",
  "planDraft",
  "planEvent",
  "coachPrompt",
  "workoutDelete",
  "activityVisual",
  "activityHrTrend",
  "fitnessTrend",
  "hrZoneSummary",
  "automationSilent"
]);

function opaqueEntry(
  raw: Record<string, unknown>,
  meta: Record<string, unknown>
): PersistedChatEntry {
  const { mid: _mid, mrev: _mrev, ...rest } = raw;
  return withMergeMeta({ kind: "opaque", raw: rest }, meta);
}

/** What the row stores for an entry: an opaque one is its raw object again. */
function toStoredEntry(entry: PersistedChatEntry): unknown {
  if (entry.kind !== "opaque") return entry;
  const { raw, mid, mrev } = entry;
  return { ...raw, ...(mid ? { mid } : {}), ...(mrev ? { mrev } : {}) };
}

function serializeEntries(entries: PersistedChatEntry[]): string {
  return JSON.stringify(entries.map(toStoredEntry));
}

/**
 * Copy an entry's merge metadata onto the value `parseEntry` rebuilt.
 *
 * One place rather than nine. Every kind is reconstructed field by field, which
 * is what makes an unlisted field vanish in silence — the trap this file is
 * already known for — and `mid` vanishing would be worse than a missing field:
 * the entry would look new to the next merge and be unioned in beside itself.
 */
function withMergeMeta(
  entry: PersistedChatEntry,
  source: Record<string, unknown>
): PersistedChatEntry {
  const mid = typeof source.mid === "string" && source.mid ? source.mid : undefined;
  const mrev =
    typeof source.mrev === "string" && source.mrev ? source.mrev : undefined;
  if (!mid && !mrev) return entry;
  return { ...entry, ...(mid ? { mid } : {}), ...(mrev ? { mrev } : {}) };
}

function parseEntry(value: unknown): PersistedChatEntry | null {
  if (!isRecord(value)) {
    return null;
  }
  // The wrapper coming back from the renderer, which holds it as it was sent.
  if (value.kind === "opaque") {
    return isRecord(value.raw) ? opaqueEntry(value.raw, value) : null;
  }
  if (typeof value.kind === "string" && !KNOWN_ENTRY_KINDS.has(value.kind)) {
    return opaqueEntry(value, value);
  }
  const parsed = parseEntryShape(value);
  return parsed ? withMergeMeta(parsed, value) : null;
}

/** A card kind whose payload sits under one key. */
function cardEntry<T extends PersistedChatEntry>(
  entry: T,
  value: Record<string, unknown>,
  payloadKey: string
): T {
  return keepUnknownKeys(entry, value, [...ENTRY_META_KEYS, payloadKey]);
}

function parseEntryShape(value: Record<string, unknown>): PersistedChatEntry | null {

  if (value.kind === "planDraft") {
    const draft = parsePlanDraft(value.draft);
    return draft ? cardEntry({ kind: "planDraft", draft }, value, "draft") : null;
  }

  if (value.kind === "planEvent") {
    const event = parsePlanEvent(value.event);
    return event ? cardEntry({ kind: "planEvent", event }, value, "event") : null;
  }

  if (value.kind === "coachPrompt") {
    const prompt = parseCoachInputPrompt(value.prompt);
    return prompt ? cardEntry({ kind: "coachPrompt", prompt }, value, "prompt") : null;
  }

  if (value.kind === "workoutDelete") {
    const preview = parseWorkoutDeletePreview(value.preview);
    return preview ? cardEntry({ kind: "workoutDelete", preview }, value, "preview") : null;
  }

  if (value.kind === "activityVisual") {
    const preview = parseActivityVisualPreview(value.preview);
    return preview ? cardEntry({ kind: "activityVisual", preview }, value, "preview") : null;
  }

  if (value.kind === "activityHrTrend") {
    const legacy = parseHrTrendPreview(value.preview);
    return legacy
      ? { kind: "activityVisual", preview: migrateActivityHrTrendPreview(legacy) }
      : null;
  }

  if (value.kind === "fitnessTrend") {
    const preview = parseFitnessTrendPreview(value.preview);
    return preview ? cardEntry({ kind: "fitnessTrend", preview }, value, "preview") : null;
  }

  if (value.kind === "hrZoneSummary") {
    const preview = parseHrZonePreview(value.preview);
    return preview ? cardEntry({ kind: "hrZoneSummary", preview }, value, "preview") : null;
  }

  if (value.kind === "automationSilent") {
    // Both halves are required. The marker is who looked and the timestamp is
    // when; a chip that can answer neither is not worth restoring, and this
    // entry is only ever written by the runner, so half of one means the row
    // came from somewhere unexpected.
    const automation = parseAnalysisMarker(value.automation);
    const at =
      typeof value.at === "number" && Number.isFinite(value.at)
        ? value.at
        : null;
    return automation && at !== null
      ? keepUnknownKeys({ kind: "automationSilent" as const, automation, at }, value, [
          ...ENTRY_META_KEYS,
          "automation",
          "at"
        ])
      : null;
  }

  return parseMessageEntry(value);
}

export function parseChatTranscriptJson(raw: string): PersistedChatEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed
    .map((entry) => parseEntry(entry))
    .filter((entry): entry is PersistedChatEntry => entry !== null);
}

/**
 * Older chat rows were normalized without each preview entry's canonical
 * workout source. The separate Coach draft store retained that full preview,
 * so use it to restore structured cards without replacing chat-local upload
 * state or destination choices.
 *
 * `sources: false` restores only what kind of creation a card is. The
 * conversation is opened that way since cards read their steps from the
 * draft's document (docs/coach-plan-canvas.md, P1.1): put back into the
 * entries, the steps would be written into the transcript on its next save.
 */
export function restoreChatPlanDraftSources(
  entries: PersistedChatEntry[],
  loadPreviewJson: (draftId: string) => string | undefined,
  { sources = true }: { sources?: boolean } = {}
): PersistedChatEntry[] {
  return entries.map((entry) => {
    if (
      entry.kind !== "planDraft" ||
      (sources && entry.draft.entries.every((draftEntry) => draftEntry.source))
    ) {
      return entry;
    }

    const rawPreview = loadPreviewJson(entry.draft.draftId);
    if (!rawPreview) return entry;

    let recovered: PlanDraftPreview | null = null;
    try {
      recovered = parsePlanDraft(JSON.parse(rawPreview));
    } catch {
      return entry;
    }
    if (!recovered) return entry;

    const recoveredByKey = new Map(
      recovered.entries.map((draftEntry) => [draftEntry.key, draftEntry])
    );
    // `...entry` first, so the entry keeps its merge identity. Rebuilding the
    // object without it would hand the runner's `readBack()` a draft with no
    // `mid`, and the next save would have to recover one from the card's id —
    // bumping `mrev` every time a conversation holding a draft is saved, which
    // would win last-writer-wins against edits made on another machine that
    // this one never saw.
    return {
      ...entry,
      kind: "planDraft",
      draft: {
        ...entry.draft,
        artifactType: recovered.artifactType ?? entry.draft.artifactType,
        entries: sources
          ? entry.draft.entries.map((draftEntry) => ({
              ...draftEntry,
              source:
                draftEntry.source ?? recoveredByKey.get(draftEntry.key)?.source
            }))
          : entry.draft.entries
      }
    };
  });
}

function normalizeEntries(entries: PersistedChatEntry[]): PersistedChatEntry[] {
  return entries
    .map((entry) => parseEntry(entry))
    .filter((entry): entry is PersistedChatEntry => entry !== null);
}

function truncateTitle(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return DEFAULT_SESSION_TITLE;
  }
  return trimmed.length > SESSION_TITLE_MAX
    ? `${trimmed.slice(0, SESSION_TITLE_MAX)}…`
    : trimmed;
}

export function deriveSessionTitleFromEntries(
  entries: PersistedChatEntry[]
): string {
  for (const entry of entries) {
    if (entry.kind === "message" && entry.role === "user" && entry.content.trim()) {
      return truncateTitle(entry.content);
    }
  }
  return DEFAULT_SESSION_TITLE;
}

function derivePreviewFromEntries(entries: PersistedChatEntry[]): string {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry.kind === "message" && entry.content.trim()) {
      const preview = entry.content.trim().replace(/\s+/g, " ");
      return preview.length > 80 ? `${preview.slice(0, 80)}…` : preview;
    }
    if (entry.kind === "planDraft") {
      // A removed creation is not what the conversation is about any more.
      if (entry.draft.removedAt) continue;
      return entry.draft.summary || entry.draft.name;
    }
    if (entry.kind === "coachPrompt") {
      return entry.prompt.answeredAt
        ? entry.prompt.question
        : `Waiting for your answer: ${entry.prompt.question}`;
    }
    if (entry.kind === "workoutDelete") {
      return entry.preview.summary;
    }
    if (entry.kind === "activityVisual") {
      const label = entry.preview.name ?? "Activity";
      return `${label} activity visuals`;
    }
    if (entry.kind === "activityHrTrend") {
      const label = entry.preview.name ?? "Activity";
      return `${label} heart rate trend`;
    }
    if (entry.kind === "fitnessTrend") {
      return "Fitness trends";
    }
    if (entry.kind === "hrZoneSummary") {
      return "Heart rate zone summary";
    }
  }
  return "";
}

function countMessages(entries: PersistedChatEntry[]): number {
  return entries.filter((entry) => entry.kind === "message").length;
}

function toSessionSummary(row: ChatSessionRow): ChatSessionSummary {
  const entries = parseChatTranscriptJson(row.messages_json);
  return {
    id: row.id,
    provider: normalizeProvider(row.provider),
    title: row.title,
    preview: derivePreviewFromEntries(entries),
    updatedAt: row.updated_at,
    createdAt: row.created_at,
    messageCount: countMessages(entries),
    pinnedAt: row.pinned_at ?? null
  };
}

export function listChatSessions(
  provider: ChatProvider,
  database: ChatSessionDatabase = defaultDatabase
): ChatSessionSummary[] {
  return database
    .listSessions(normalizeProvider(provider))
    .map((row) => toSessionSummary(row));
}

export function getChatSession(
  id: string,
  database: ChatSessionDatabase = defaultDatabase
): PersistedChatEntry[] {
  const row = database.getSession(id);
  if (!row) {
    return [];
  }
  const entries = parseChatTranscriptJson(row.messages_json);
  if (database !== defaultDatabase) return entries;
  return restoreChatPlanDraftSources(
    entries,
    (draftId) => getChatPlanDraft(draftId)?.previewJson,
    { sources: false }
  );
}

export function createChatSession(
  provider: ChatProvider,
  database: ChatSessionDatabase = defaultDatabase
): ChatSessionSummary {
  const normalizedProvider = normalizeProvider(provider);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  database.insertSession(
    id,
    normalizedProvider,
    DEFAULT_SESSION_TITLE,
    "[]",
    now,
    now
  );
  const row = database.getSession(id);
  if (!row) {
    throw new Error("Failed to create chat session.");
  }
  return toSessionSummary(row);
}

/**
 * The entries a save would silently destroy: everything the row holds past the
 * point the caller knows about and is not itself sending. Position finds the
 * candidates — the analysis runner only ever appends, so a foreign write is
 * always a tail — and content rules out the ones the caller already holds.
 *
 * A caller that knows nothing (0) therefore keeps everything, which is the
 * safe direction for the accident this guards against.
 */
function foreignTail(
  stored: PersistedChatEntry[],
  knownEntryCount: number | undefined,
  incoming: PersistedChatEntry[]
): PersistedChatEntry[] {
  if (knownEntryCount === undefined || !Number.isFinite(knownEntryCount)) {
    return [];
  }
  // Clamped to what the caller actually sent. The count says "my array accounts
  // for this many of the row's entries", so a caller claiming more than it sent
  // is asserting a deletion — and nothing deletes entries: the window only ever
  // appends to its own timeline or rewrites it in place. Honouring the claim
  // would drop the entries between the two numbers with nothing to notice it,
  // which is the wrong direction for a guard whose whole point is that the
  // accident fails harmlessly.
  const claimed = Math.max(0, Math.floor(knownEntryCount));
  const known = Math.min(claimed, incoming.length);
  if (stored.length <= known) {
    return [];
  }
  const tail = stored.slice(known);

  // The count can understate what the caller holds — a save that never fired
  // leaves it behind while the timeline keeps growing — and then the "foreign"
  // tail is not foreign at all: the caller is sending those very entries. The
  // guard used to append them anyway, which is how one conversation ended up
  // with eight entries written twice, a repeated stretch of its own history,
  // and two chart cards sharing a `previewId` — the duplicate React key that
  // surfaced it.
  //
  // So the position test stands, and the content settles it: the longest head
  // of the tail the caller's array holds anywhere past the entries it accounts
  // for is dropped. Only an identical run of entries in the same order matches,
  // so a run's genuine append — a playbook turn and an answer nothing else
  // wrote — is still kept.
  //
  // Anywhere past, not only at the very end: a stale count is followed by more
  // turns, so the array usually holds the row's entries *and* the new ones
  // after them. An ends-with test finds no overlap there and appends the whole
  // tail again — the same duplication, one turn later.
  //
  // Compared as they will be stored, not as they were sent: an entry the store
  // rejects never reaches the row, so leaving it in would put a hole in the
  // caller's array that no stored entry can match — and the overlap would read
  // as none.
  // Content, with `mid` and `mrev` taken off. A stored entry carries them and
  // the caller's copy of that same entry does not — the renderer rebuilds
  // entries field by field on the way out — so comparing the raw JSON would
  // find no overlap at all and append the tail the caller is already sending.
  const canonical = (entry: PersistedChatEntry | null): string =>
    entry === null ? "null" : contentKey(entry);
  const accepted = incoming.map((entry) => parseEntry(entry));
  const start = accepted.slice(0, known).filter((entry) => entry !== null).length;
  const incomingText = accepted
    .filter((entry): entry is PersistedChatEntry => entry !== null)
    .map(canonical);
  // `tail` comes from `parseChatTranscriptJson`, so it is already what the
  // store accepts; only `incoming` still needs putting through the parser.
  const tailText = tail.map((entry) => canonical(entry));
  let held = 0;
  for (
    let offset = start;
    offset < incomingText.length && held < tailText.length;
    offset++
  ) {
    let length = 0;
    while (
      length < tailText.length &&
      offset + length < incomingText.length &&
      incomingText[offset + length] === tailText[length]
    ) {
      length++;
    }
    held = Math.max(held, length);
  }
  return tail.slice(held);
}

/**
 * `options` sits after the injectable database rather than before it, against
 * this file's usual "seam goes last" shape. Deliberate: every caller that
 * passes a database is a test, and moving the seam would put an `undefined`
 * placeholder in a dozen of them to spare one production call site.
 */
/**
 * A timestamp for `mid` and `mrev`: monotonic, unique to this machine, and
 * lexicographically ordered.
 *
 * Same construction as an HLC, and for the first of the same two reasons — a
 * clock that steps backwards must not hand out an identifier that sorts before
 * one already in use. It is deliberately *not* the sync clock: transcripts are
 * written whether or not sync is configured, and an id minted only when it
 * happens to be on would leave exactly the entries that need identifying
 * without one.
 */
let stampMillis = 0;
let stampCounter = 0;
let stampDevice: string | null = null;

function mergeStampDevice(): string {
  if (stampDevice) return stampDevice;
  try {
    stampDevice = deviceId();
  } catch {
    // No database behind this call — a suite with an injected one. A random id
    // is still unique, which is all this needs.
    stampDevice = crypto.randomBytes(8).toString("hex");
  }
  return stampDevice;
}

function nextMergeStamp(): string {
  const millis = Math.max(Date.now(), stampMillis);
  stampCounter = millis === stampMillis ? stampCounter + 1 : 0;
  stampMillis = millis;
  // The leading `1-` sorts every minted id after every backfilled one, which
  // are `0-<index>`. A conversation that predates this therefore keeps its
  // order and everything new lands after it. See `transcriptEntryId`.
  return (
    `1-${millis.toString(16).padStart(12, "0")}` +
    `-${stampCounter.toString(16).padStart(4, "0")}-${mergeStampDevice()}`
  );
}

/**
 * What an entry *is*, for the entries that can say.
 *
 * Every card kind carries an id of its own already, and that is what makes
 * "this is the entry that changed" answerable without guessing. A coach prompt
 * being answered is the edit-in-place that actually happens, and it keeps its
 * `promptId` through it.
 *
 * Messages return nothing, deliberately. They carry no id, and a message is
 * written once — the question at send time, the answer when the turn ends — so
 * there is nothing to recognise and nothing that needs recognising. Guessing
 * from position was the alternative and it is worse than useless: a save whose
 * array is shorter than the row would read an unrelated entry at the same index
 * as an edit of it, quietly take over its identity, and the other machine's copy
 * would then lose last-writer-wins against a turn that was never the same turn.
 */
function logicalKey(entry: PersistedChatEntry): string | undefined {
  switch (entry.kind) {
    case "coachPrompt":
      return `coachPrompt:${entry.prompt.promptId}`;
    case "planDraft":
      return `planDraft:${entry.draft.draftId}`;
    case "workoutDelete":
      return `workoutDelete:${entry.preview.requestId}`;
    case "activityVisual":
    case "activityHrTrend":
    case "fitnessTrend":
    case "hrZoneSummary":
      return `${entry.kind}:${entry.preview.previewId}`;
    default:
      return undefined;
  }
}

/**
 * Give every entry a stable identity, so a merge can union two transcripts
 * instead of choosing between them. See `sync/rowMergers.ts`.
 *
 * The renderer strips both fields — it rebuilds entries field by field on the
 * way through `toPersistedEntries` — so almost every save arrives with them
 * missing and they have to be recovered rather than trusted. Two rules do it,
 * in this order, because each covers what the other cannot:
 *
 *   * **by content**, which survives the entries moving. A merge can land a
 *     foreign entry anywhere in the list, so position is not dependable;
 *   * **by the card's own id**, for an entry whose content was edited in place
 *     and so matches nothing — an answered coach prompt. The identity is kept
 *     and `mrev` bumped, which is what makes the edit outrank the copy the
 *     other machine still holds.
 *
 * Anything left is genuinely new and is minted. Note that an unchanged save
 * therefore produces byte-identical JSON, which is what keeps `saveChatSession`
 * from touching the row every time a conversation is opened.
 */
function stampEntries(
  incoming: PersistedChatEntry[],
  stored: PersistedChatEntry[]
): PersistedChatEntry[] {
  const storedById = new Map<string, PersistedChatEntry>();
  const byContent = new Map<string, number[]>();
  const byLogical = new Map<string, number[]>();
  const push = (map: Map<string, number[]>, key: string, index: number): void => {
    const held = map.get(key);
    if (held) held.push(index);
    else map.set(key, [index]);
  };
  stored.forEach((entry, index) => {
    if (entry.mid) storedById.set(entry.mid, entry);
    push(byContent, contentKey(entry), index);
    const logical = logicalKey(entry);
    if (logical) push(byLogical, logical, index);
  });

  const claimed = new Set<number>();
  const take = (map: Map<string, number[]>, key: string | undefined) => {
    if (!key) return undefined;
    const queue = map.get(key);
    while (queue && queue.length > 0) {
      const index = queue.shift() as number;
      if (!claimed.has(index)) return index;
    }
    return undefined;
  };

  // Content first for every entry, before any identity is claimed: an entry
  // that merely moved must not have its identity taken by one that was edited.
  const byContentMatch = incoming.map((entry) =>
    entry.mid ? undefined : take(byContent, contentKey(entry))
  );
  byContentMatch.forEach((index) => {
    if (index !== undefined) claimed.add(index);
  });

  return incoming.map((entry, index) => {
    if (entry.mid) {
      const previous = storedById.get(entry.mid);
      const changed = previous ? contentKey(previous) !== contentKey(entry) : false;
      return changed ? { ...entry, mrev: nextMergeStamp() } : entry;
    }

    const exact = byContentMatch[index];
    if (exact !== undefined) {
      const previous = stored[exact];
      return {
        ...entry,
        mid: transcriptEntryId(previous, exact),
        ...(previous.mrev ? { mrev: previous.mrev } : {})
      };
    }

    const edited = take(byLogical, logicalKey(entry));
    if (edited !== undefined) {
      claimed.add(edited);
      const previous = stored[edited];
      return {
        ...entry,
        mid: transcriptEntryId(previous, edited),
        mrev: nextMergeStamp()
      };
    }

    const stamp = nextMergeStamp();
    return { ...entry, mid: stamp, mrev: stamp };
  });
}

export function saveChatSession(
  id: string,
  entries: PersistedChatEntry[],
  database: ChatSessionDatabase = defaultDatabase,
  options: SaveChatSessionOptions = {}
): ChatSessionSummary | null {
  const row = database.getSession(id);
  if (!row) {
    return null;
  }

  // Parsed once and handed to both. Each entry is rebuilt field by field on the
  // way through `parseEntry`, and a transcript carrying chart cards runs to
  // hundreds of kilobytes — measured at 480 kB on a real conversation — so the
  // second parse was pure waste on the hot path of every finished turn.
  const stored = parseChatTranscriptJson(row.messages_json);
  const normalizedEntries = stampEntries(
    normalizeEntries([
      ...entries,
      ...foreignTail(stored, options.knownEntryCount, entries)
    ]),
    stored
  );
  const title =
    row.title === DEFAULT_SESSION_TITLE
      ? deriveSessionTitleFromEntries(normalizedEntries)
      : row.title;
  const messagesJson = serializeEntries(normalizedEntries);

  // Opening a conversation replays its transcript back through this path, so
  // without this guard simply reading a chat would give it a fresh updatedAt
  // and jump it to the top of the sidebar. Both sides are normalized before
  // serializing, so the comparison sees canonical key order.
  if (messagesJson === row.messages_json && title === row.title) {
    return toSessionSummary(row);
  }

  const updatedAt = new Date().toISOString();
  database.updateSession(id, title, messagesJson, updatedAt);
  // The row writer tells the sync loop; the guard above is what keeps that to
  // one entry per finished turn rather than one per streamed token.
  const nextRow = database.getSession(id);
  return nextRow ? toSessionSummary(nextRow) : null;
}

export function setChatSessionPinned(
  id: string,
  pinned: boolean,
  database: ChatSessionDatabase = defaultDatabase
): ChatSessionSummary | null {
  const row = database.getSession(id);
  if (!row) {
    return null;
  }

  // Keep an existing pin timestamp so re-pinning does not reshuffle the list.
  const pinnedAt = pinned ? row.pinned_at ?? new Date().toISOString() : null;
  database.setSessionPinned(id, pinnedAt);
  const nextRow = database.getSession(id);
  return nextRow ? toSessionSummary(nextRow) : null;
}

/**
 * Renames a conversation. Automations need this for both the `dedicated`
 * conversation they create up front and the `titleTemplate` of a `per-run`
 * binding: `saveChatSession` only ever derives a title while the stored one is
 * still the default, which would otherwise name an analysis's conversation
 * after its own playbook text.
 *
 * Renaming deliberately leaves `updatedAt` alone so it does not jump the
 * conversation to the top of the sidebar.
 */
export function setChatSessionTitle(
  id: string,
  title: string,
  database: ChatSessionDatabase = defaultDatabase
): ChatSessionSummary | null {
  const row = database.getSession(id);
  if (!row) {
    return null;
  }

  const nextTitle = truncateTitle(title);
  if (nextTitle === row.title) {
    return toSessionSummary(row);
  }

  database.setSessionTitle(id, nextTitle);
  const nextRow = database.getSession(id);
  return nextRow ? toSessionSummary(nextRow) : null;
}

/**
 * Whether the conversation row still exists. `getChatSession` returns `[]` for
 * both an empty transcript and a deleted one, which an analysis has
 * to tell apart (2.4).
 */
export function chatSessionExists(
  id: string,
  database: ChatSessionDatabase = defaultDatabase
): boolean {
  return database.getSession(id) !== undefined;
}

/** The conversation's current title, or null when it no longer exists. */
export function getChatSessionTitle(
  id: string,
  database: ChatSessionDatabase = defaultDatabase
): string | null {
  return database.getSession(id)?.title ?? null;
}

export function deleteChatSession(
  id: string,
  database: ChatSessionDatabase = defaultDatabase
): void {
  database.deleteSession(id);
}

/** @deprecated Test helper for legacy transcript migration shape. */
export function migrateLegacyTranscriptRow(
  provider: ChatProvider,
  messagesJson: string,
  updatedAt: string,
  database: ChatSessionDatabase = defaultDatabase
): ChatSessionSummary {
  const entries = parseChatTranscriptJson(messagesJson);
  const id = crypto.randomUUID();
  const title = deriveSessionTitleFromEntries(entries);
  database.insertSession(
    id,
    normalizeProvider(provider),
    title,
    serializeEntries(entries),
    updatedAt,
    updatedAt
  );
  const row = database.getSession(id);
  if (!row) {
    throw new Error("Failed to migrate legacy transcript.");
  }
  return toSessionSummary(row);
}
