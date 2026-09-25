import crypto from "node:crypto";
import {
  buildPlanPreview,
  formatScheduleDay,
  validatePlanDraft,
  type CorosTrainingPlanDraft,
  type PlanWorkoutEntry
} from "./corosWorkoutBuilder";
import {
  deleteWorkout,
  formatScheduledExercisesForChat,
  getTrainingHubStatus,
  listScheduledWorkoutEntries,
  resolveTrainingPlanExercises,
  searchWorkoutExercises,
  uploadTrainingPlan
} from "./trainingHubService";
import {
  deleteChatPlanDraft,
  getChatPlanDraft,
  listChatPlanDrafts,
  markChatPlanDraftUploaded,
  saveChatPlanDraft
} from "./database";
import { savePlanToCoros } from "./trainingLibraryService";
import {
  COROS_WEEK_STAGES,
  formatPlanDay,
  mondayOf,
  parsePlanDay,
  trainingPlanFromCoachDraftPreview
} from "./trainingPlanDomain";
import { generatedPlanProblems } from "./trainingPlanGeneration";
import type {
  CorosMcpTool,
  CorosTrainingPlanDraftInput,
  DeleteWorkoutResult,
  PlanDraftPreview,
  PlanWorkoutEntryInput,
  TrainingPlanDestination,
  TrainingPlanDocument,
  TrainingPlanGenerationRequest,
  TrainingPlanWeekStage,
  UploadPlanResult,
  WorkoutDeletePreview,
  UnitSystem
} from "./types";
import {
  buildDraftTrainingPlanInputSchema,
  buildDraftWorkoutInputSchema
} from "./workoutCapabilities";
import { formatDistanceValue } from "./unitSystem.js";
import {
  EXERCISE_SEARCH_EQUIPMENT,
  EXERCISE_SEARCH_MOVEMENTS,
  EXERCISE_SEARCH_MUSCLES,
  type ExerciseSearchEquipment,
  type ExerciseSearchMovement,
  type ExerciseSearchMuscle,
  type WorkoutExerciseSearchResult
} from "./exerciseCatalogSearch";

interface StoredPlanDraft {
  draftId: string;
  plan: CorosTrainingPlanDraft;
  preview: PlanDraftPreview;
  createdAt: number;
  uploadedAt?: number;
}

interface StoredDeleteRequest {
  requestId: string;
  params: DeleteWorkoutParams;
  preview: WorkoutDeletePreview;
  createdAt: number;
  executedAt?: number;
}

interface DeleteWorkoutParams {
  target: "scheduled" | "library" | "both";
  schedule_date?: string;
  workout_name?: string;
  program_id?: string;
  plan_id?: string;
  id_in_plan?: string;
  plan_program_id?: string;
}

const draftStore = new Map<string, StoredPlanDraft>();
/**
 * Drafts written during a plan generation. Never persisted: `chat_plan_drafts`
 * is `personal` tier and a draft there lives as long as the conversation card
 * that holds it — a generation has no conversation, so every one it wrote used
 * to stay in that table for good and travel to every machine on the vault.
 */
const generatedDrafts = new Map<string, StoredPlanDraft>();

/** A draft the plan generator's run accepted, for it to build the plan from. */
export function generatedPlanDraft(draftId: string): { plan: CorosTrainingPlanDraft; preview: PlanDraftPreview } | undefined {
  const stored = generatedDrafts.get(draftId);
  return stored ? { plan: stored.plan, preview: stored.preview } : undefined;
}

/** Lets go of a finished generation's drafts. */
export function forgetGeneratedPlanDrafts(draftIds: readonly string[]): void {
  for (const draftId of draftIds) generatedDrafts.delete(draftId);
}
const deleteRequestStore = new Map<string, StoredDeleteRequest>();

function persistPlanDraft(stored: StoredPlanDraft): void {
  draftStore.set(stored.draftId, stored);
  saveChatPlanDraft({
    draftId: stored.draftId,
    planJson: JSON.stringify(stored.plan),
    previewJson: JSON.stringify(stored.preview),
    createdAt: stored.createdAt,
    uploadedAt: stored.uploadedAt
  });
}

function loadStoredPlanDraft(draftId: string): StoredPlanDraft | undefined {
  const cached = draftStore.get(draftId);
  if (cached) {
    return cached;
  }

  const row = getChatPlanDraft(draftId);
  if (!row) {
    return undefined;
  }

  try {
    const plan = JSON.parse(row.planJson) as CorosTrainingPlanDraft;
    const preview = JSON.parse(row.previewJson) as PlanDraftPreview;
    const stored: StoredPlanDraft = {
      draftId: row.draftId,
      plan,
      preview: {
        ...preview,
        uploadedAt: row.uploadedAt ?? preview.uploadedAt
      },
      createdAt: row.createdAt,
      uploadedAt: row.uploadedAt
    };
    draftStore.set(draftId, stored);
    return stored;
  } catch {
    return undefined;
  }
}

export function hydratePlanDraftStoreFromDatabase(): void {
  for (const row of listChatPlanDrafts()) {
    if (draftStore.has(row.draftId)) {
      continue;
    }
    try {
      draftStore.set(row.draftId, {
        draftId: row.draftId,
        plan: JSON.parse(row.planJson) as CorosTrainingPlanDraft,
        preview: JSON.parse(row.previewJson) as PlanDraftPreview,
        createdAt: row.createdAt,
        uploadedAt: row.uploadedAt
      });
    } catch {
      // Skip corrupted rows.
    }
  }
}

export const CHAT_WORKOUT_TOOL_NAMES = [
  "search_coros_exercises",
  "draft_workout",
  "draft_training_plan",
  "upload_training_plan",
  "list_scheduled_workouts",
  "delete_workout"
] as const;

export type ChatWorkoutToolName = (typeof CHAT_WORKOUT_TOOL_NAMES)[number];

export function isChatWorkoutTool(name: string): name is ChatWorkoutToolName {
  return (CHAT_WORKOUT_TOOL_NAMES as readonly string[]).includes(name);
}

export function getChatWorkoutTools(): CorosMcpTool[] {
  const hubStatus = getTrainingHubStatus();
  if (!hubStatus.authenticated) {
    return [];
  }

  return [
    {
      name: "search_coros_exercises",
      description:
        "Search the athlete's live COROS Strength/Hybrid Fitness exercise catalog and return exact exercise IDs and names. " +
        "Call this before drafting strength or Hybrid Fitness workouts whenever exact COROS exercise IDs are not already known. " +
        "Search several intended movements in one call with queries, or discover exercises by target muscles, movement patterns, and available equipment. " +
        "Use returned exercise_id and exercise_name values in whichever draft tool matches the request. Catalog naming differences are not a reason to ask the athlete.",
      inputSchema: {
        type: "object",
        properties: {
          sport: {
            type: "string",
            enum: ["strength", "hyrox"],
            description: "Catalog context. Hybrid Fitness functional stations use the COROS Strength catalog. Default strength."
          },
          query: {
            type: "string",
            description: "One intended exercise or natural-language movement, such as 'machine chest press'."
          },
          queries: {
            type: "array",
            minItems: 1,
            maxItems: 8,
            items: { type: "string" },
            description: "Several intended exercises to resolve in one tool call."
          },
          target_muscles: {
            type: "array",
            uniqueItems: true,
            items: { type: "string", enum: [...EXERCISE_SEARCH_MUSCLES] },
            description: "Accept exercises targeting any of these muscles."
          },
          movement_patterns: {
            type: "array",
            uniqueItems: true,
            items: { type: "string", enum: [...EXERCISE_SEARCH_MOVEMENTS] },
            description: "Accept exercises matching any of these movement patterns."
          },
          equipment: {
            type: "array",
            uniqueItems: true,
            items: { type: "string", enum: [...EXERCISE_SEARCH_EQUIPMENT] },
            description: "Accept exercises using any of this available equipment. Omit when equipment is unrestricted."
          },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 12,
            description: "Maximum results per query, or for the filtered discovery search. Default 5 for queries and 10 otherwise."
          }
        }
      }
    },
    {
      name: "draft_workout",
      description:
        "Validate and store one standalone workout for athlete review. " +
        "Use this for one-off requests such as today's run, a single gym session, or one workout to reuse later; " +
        "do not wrap a one-off workout in draft_training_plan. Set calendar_date only when the athlete names a date. " +
        "Put prescribed HR, pace, power, cadence, stroke, weight, RPE, or grade in each step's typed intensity field. " +
        "For Strength and Hybrid Fitness, call search_coros_exercises first and pass its exact exercise IDs and names. " +
        "Returns a workout card where the athlete can choose Workout Library or Calendar and confirm.",
      inputSchema: buildDraftWorkoutInputSchema()
    },
    {
      name: "draft_training_plan",
      description:
        "Validate and store a multi-day or multi-week sport-aware training plan draft for athlete review. " +
        "Use draft_workout instead when the athlete asks for only one standalone workout. " +
        "Put prescribed HR, pace, power, cadence, stroke, weight, RPE, or grade in each step's typed intensity field. " +
        "Strength and Hybrid Fitness exercise names are checked against the COROS catalog; use search_coros_exercises first " +
        "and pass its exact IDs and names. If candidates are returned, revise the affected steps and call this tool again. " +
        "Always call this before upload. Returns a draftId and human-readable preview.",
      inputSchema: buildDraftTrainingPlanInputSchema()
    },
    {
      name: "upload_training_plan",
      description:
        "Compatibility guard for plan uploads. Plan writes can only be initiated by the athlete " +
        "from the confirmation card; this tool never performs a remote write.",
      inputSchema: {
        type: "object",
        properties: {
          draft_id: { type: "string", description: "draftId from a workout or plan draft tool" },
          confirmed: {
            type: "boolean",
            description: "Must be true only after explicit athlete confirmation"
          }
        },
        required: ["draft_id"]
      }
    },
    {
      name: "list_scheduled_workouts",
      description:
        "List workouts on the COROS training calendar for a date range. " +
        "Use before delete_workout to get plan_id and id_in_plan when needed.",
      inputSchema: {
        type: "object",
        properties: {
          start_date: {
            type: "string",
            description: "Start date YYYYMMDD (defaults to today)"
          },
          end_date: {
            type: "string",
            description: "End date YYYYMMDD (defaults to 14 days from start)"
          }
        }
      }
    },
    {
      name: "delete_workout",
      description:
        "Stage a workout deletion for the athlete to confirm. " +
        "Shows a Delete from COROS button in chat — never deletes directly. " +
        "For calendar: provide schedule_date + workout_name, or plan_id + id_in_plan. " +
        "For library: provide program_id or workout_name with target library/both.",
      inputSchema: {
        type: "object",
        properties: {
          target: {
            type: "string",
            enum: ["scheduled", "library", "both"],
            description: "Where to delete from"
          },
          schedule_date: {
            type: "string",
            description: "YYYYMMDD for calendar delete"
          },
          workout_name: {
            type: "string",
            description: "Workout name to match"
          },
          program_id: {
            type: "string",
            description: "Library program ID"
          },
          plan_id: { type: "string", description: "Schedule plan ID" },
          id_in_plan: { type: "string", description: "Schedule idInPlan" },
          plan_program_id: {
            type: "string",
            description: "Optional schedule planProgramId"
          }
        },
        required: ["target"]
      }
    }
  ];
}

export async function handleChatWorkoutTool(
  name: ChatWorkoutToolName,
  args: Record<string, unknown>,
  options?: {
    onPlanDraft?: (preview: PlanDraftPreview) => void;
    onWorkoutDelete?: (preview: WorkoutDeletePreview) => void;
    allowUpcomingWorkouts?: boolean;
    unitSystem?: UnitSystem;
    /**
     * Set while the plan generator runs: a draft is checked against what the
     * athlete asked for and handed back to the model when it departs from it,
     * and one that passes is kept in memory for the generator to collect
     * rather than written to `chat_plan_drafts` (see `generatedPlanDraft`).
     */
    planRequest?: TrainingPlanGenerationRequest;
  }
): Promise<string> {
  if (name === "draft_training_plan") {
    return handleDraftTrainingPlan(
      args,
      options?.onPlanDraft,
      options?.allowUpcomingWorkouts !== false,
      options?.unitSystem ?? "metric",
      "plan",
      options?.planRequest
    );
  }
  if (name === "draft_workout") {
    return handleDraftWorkout(
      args,
      options?.onPlanDraft,
      options?.allowUpcomingWorkouts !== false,
      options?.unitSystem ?? "metric"
    );
  }
  if (name === "search_coros_exercises") {
    return handleSearchCorosExercises(args);
  }
  if (name === "upload_training_plan") {
    return handleUploadTrainingPlan(args, options?.unitSystem ?? "metric");
  }
  if (name === "list_scheduled_workouts") {
    return handleListScheduledWorkouts(args, options?.unitSystem ?? "metric");
  }
  return handleDeleteWorkout(args, options?.onWorkoutDelete);
}

function allowedStringList<T extends string>(
  value: unknown,
  allowed: readonly T[]
): T[] {
  const allowedValues = new Set<string>(allowed);
  return [...new Set(
    (Array.isArray(value) ? value : [])
      .map((entry) => String(entry ?? "").trim())
      .filter((entry): entry is T => allowedValues.has(entry))
  )];
}

function exerciseSearchResultForChat(result: WorkoutExerciseSearchResult) {
  return {
    exercise_id: result.id,
    exercise_name: result.name,
    target_muscles: result.targetMuscles,
    movement_patterns: result.movementPatterns,
    equipment: result.equipment,
    match_reasons: result.matchReasons
  };
}

async function handleSearchCorosExercises(
  args: Record<string, unknown>
): Promise<string> {
  const sport = args.sport === "hyrox" ? "hyrox" : "strength";
  const singleQuery = typeof args.query === "string" ? args.query.trim() : "";
  const queries = [...new Set([
    ...(singleQuery ? [singleQuery] : []),
    ...(Array.isArray(args.queries)
      ? args.queries.map((entry) => String(entry ?? "").trim()).filter(Boolean)
      : [])
  ])].slice(0, 8);
  const targetMuscles = allowedStringList<ExerciseSearchMuscle>(
    args.target_muscles,
    EXERCISE_SEARCH_MUSCLES
  );
  const movementPatterns = allowedStringList<ExerciseSearchMovement>(
    args.movement_patterns,
    EXERCISE_SEARCH_MOVEMENTS
  );
  const equipment = allowedStringList<ExerciseSearchEquipment>(
    args.equipment,
    EXERCISE_SEARCH_EQUIPMENT
  );
  const requestedLimit = Number(args.limit);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(12, Math.max(1, Math.round(requestedLimit)))
    : queries.length > 0
      ? 5
      : 10;

  if (
    queries.length === 0 &&
    targetMuscles.length === 0 &&
    movementPatterns.length === 0 &&
    equipment.length === 0
  ) {
    return JSON.stringify({
      ok: false,
      error_code: "exercise_search_intent_required",
      action:
        "Call again with query/queries or at least one target_muscles, movement_patterns, or equipment filter."
    });
  }

  const sharedInput = { targetMuscles, movementPatterns, equipment, limit };
  if (queries.length > 0) {
    const searches = [];
    // Keep these sequential: the first call fills the short-lived live-catalog
    // cache, so resolving several movements still performs one COROS request.
    for (const query of queries) {
      const results = await searchWorkoutExercises(sport, { ...sharedInput, query });
      searches.push({
        query,
        results: results.map(exerciseSearchResultForChat)
      });
    }
    return JSON.stringify({
      ok: true,
      sport,
      searches,
      action:
        "Choose the closest result for each intended movement and use its exact exercise_id and exercise_name in the matching draft tool. Ask the athlete only if the available movement or equipment would materially change the workout."
    });
  }

  const results = await searchWorkoutExercises(sport, sharedInput);
  return JSON.stringify({
    ok: true,
    sport,
    results: results.map(exerciseSearchResultForChat),
    action:
      "Use exact exercise_id and exercise_name values from these results in the matching draft tool. Refine the search if a needed movement is not represented."
  });
}

function toPlanDraft(args: Record<string, unknown>): CorosTrainingPlanDraft {
  const name = String(args.name ?? "").trim();
  const rawWorkouts = Array.isArray(args.workouts) ? args.workouts : [];
  const workouts: PlanWorkoutEntry[] = rawWorkouts.map((item, index) => {
    const entry = (item ?? {}) as PlanWorkoutEntryInput;
    return {
      key: String(entry.key ?? `workout-${index + 1}`).trim(),
      name: String(entry.name ?? `Workout ${index + 1}`).trim(),
      description: entry.description?.trim(),
      sport: entry.sport ?? "run",
      sport_options: entry.sport_options,
      steps: entry.steps as PlanWorkoutEntry["steps"],
      distance_km: entry.distance_km,
      schedule_date: entry.schedule_date
        ? String(entry.schedule_date).replace(/-/g, "")
        : undefined,
      sort_no: entry.sort_no,
      save_to_library: entry.save_to_library
    };
  });
  const description = typeof args.description === "string" ? args.description.trim() : "";
  const weekStages = (Array.isArray(args.week_stages) ? args.week_stages : []).flatMap((item) => {
    const record = (item ?? {}) as Record<string, unknown>;
    const week = Number(record.week);
    const stage = COROS_WEEK_STAGES.find((candidate) => candidate.slug === record.stage);
    return Number.isInteger(week) && week >= 1 && stage && stage.value > 0
      ? [{ weekIndex: week - 1, stage: stage.value as TrainingPlanWeekStage }]
      : [];
  });
  return {
    name,
    workouts,
    ...(description ? { description } : {}),
    ...(weekStages.length ? { weekStages } : {})
  };
}

function handleDraftWorkout(
  args: Record<string, unknown>,
  onPlanDraft?: (preview: PlanDraftPreview) => void,
  allowUpcomingWorkouts = true,
  unitSystem: UnitSystem = "metric"
): Promise<string> {
  const rawWorkout = args.workout;
  if (!rawWorkout || typeof rawWorkout !== "object" || Array.isArray(rawWorkout)) {
    return Promise.resolve(JSON.stringify({
      ok: false,
      errors: ["workout is required."]
    }));
  }

  const workout = rawWorkout as Record<string, unknown>;
  const workoutName = String(workout.name ?? "").trim();
  const calendarDate = args.calendar_date
    ? String(args.calendar_date).replace(/-/g, "").trim()
    : undefined;
  return handleDraftTrainingPlan(
    {
      name: workoutName,
      workouts: [{
        ...workout,
        schedule_date: calendarDate,
        save_to_library: true
      }]
    },
    onPlanDraft,
    allowUpcomingWorkouts,
    unitSystem,
    "workout"
  );
}

export function buildTrainingPlanUploadInput(
  plan: CorosTrainingPlanDraft
): CorosTrainingPlanDraftInput {
  return {
    name: plan.name,
    workouts: plan.workouts.map((entry) => ({
      key: entry.key,
      name: entry.name,
      description: entry.description,
      sport: entry.sport ?? "run",
      sport_options: entry.sport_options,
      steps: entry.steps,
      distance_km: entry.distance_km,
      schedule_date: entry.schedule_date,
      sort_no: entry.sort_no,
      save_to_library: entry.save_to_library
    }))
  };
}

export function buildTrainingPlanDestinationInput(
  plan: CorosTrainingPlanDraft,
  destination: TrainingPlanDestination,
  scheduleDate?: string
): CorosTrainingPlanDraftInput {
  const input = buildTrainingPlanUploadInput(plan);
  if (destination === "workoutLibrary") {
    return {
      ...input,
      workouts: input.workouts.map((workout) => ({
        ...workout,
        schedule_date: undefined,
        save_to_library: true
      }))
    };
  }
  if (destination === "calendar") {
    const normalizedDate = scheduleDate?.replace(/-/g, "").trim();
    if (normalizedDate && input.workouts.length !== 1) {
      throw new Error("A calendar date override is only supported for one-off workouts.");
    }
    const calendarWorkouts = input.workouts.map((workout) => ({
      ...workout,
      schedule_date: normalizedDate || workout.schedule_date
    }));
    const unscheduled = calendarWorkouts.filter((workout) => !workout.schedule_date);
    if (unscheduled.length > 0) {
      throw new Error(
        `${unscheduled.length} workout${unscheduled.length === 1 ? " is" : "s are"} missing a date. Add dates before choosing Calendar.`
      );
    }
    return {
      ...input,
      workouts: calendarWorkouts.map((workout) => ({
        ...workout,
        save_to_library: false
      }))
    };
  }
  return input;
}

async function detectScheduleConflicts(
  draft: CorosTrainingPlanDraft
): Promise<string[]> {
  const scheduledDates = [
    ...new Set(
      draft.workouts
        .map((entry) => entry.schedule_date)
        .filter((day): day is string => Boolean(day))
    )
  ];
  if (scheduledDates.length === 0) {
    return [];
  }

  scheduledDates.sort();
  const upcoming = await listScheduledWorkoutEntries(
    scheduledDates[0]!,
    scheduledDates[scheduledDates.length - 1]!
  );
  const conflicts: string[] = [];

  for (const entry of draft.workouts) {
    if (!entry.schedule_date) {
      continue;
    }
    const existing = upcoming.filter(
      (workout) => workout.happenDay === entry.schedule_date
    );
    if (existing.length > 0) {
      const names = existing.map((workout) => workout.name).join(", ");
      conflicts.push(
        `${entry.schedule_date}: already has ${names} — adding "${entry.name}"`
      );
    }
  }

  return conflicts;
}

async function handleDraftTrainingPlan(
  args: Record<string, unknown>,
  onPlanDraft?: (preview: PlanDraftPreview) => void,
  allowUpcomingWorkouts = true,
  unitSystem: UnitSystem = "metric",
  artifactType: "plan" | "workout" = "plan",
  planRequest?: TrainingPlanGenerationRequest
): Promise<string> {
  const draft = toPlanDraft(args);
  const validation = validatePlanDraft(draft, {
    todayDay: formatScheduleDay(new Date())
  });
  if (!validation.ok) {
    return JSON.stringify({ ok: false, errors: validation.errors });
  }
  /* Before the exercises are resolved: that can cost COROS requests, and a
     draft with the wrong number of sessions is going to be rewritten anyway. */
  if (planRequest) {
    const problems = generatedPlanProblems(draft.workouts, planRequest);
    if (problems.length > 0) {
      return JSON.stringify({
        ok: false,
        error_code: "plan_breaks_request",
        errors: problems.slice(0, 20),
        action: "Fix every problem listed and call draft_training_plan again with the whole plan. Do not ask the athlete."
      });
    }
  }

  const exerciseResolution = await resolveTrainingPlanExercises(draft);
  if (exerciseResolution.issues.length > 0) {
    const retryTool = artifactType === "workout"
      ? "draft_workout"
      : "draft_training_plan";
    return JSON.stringify({
      ok: false,
      error_code: "exercise_resolution_required",
      issues: exerciseResolution.issues.map((issue) => ({
        workout_key: issue.workoutKey,
        workout_name: issue.workoutName,
        sport: issue.sport,
        exercise_name: issue.exerciseName,
        reason: issue.reason,
        candidates: issue.candidates,
        message: issue.message
      })),
      action: exerciseResolution.issues.every((issue) => issue.candidates.length > 0)
        ? `Update each affected step to the exact best-matching candidate and call ${retryTool} again now. If the candidates materially change the intended movement, call request_coach_input with the exact candidates as clickable choices.`
        : `At least one exercise name is unavailable. Call search_coros_exercises now using the intended movement, target muscles, and known equipment; use an exact returned ID/name and call ${retryTool} again. Ask the athlete only if the available movement or equipment would materially change the workout.`
    });
  }
  const resolvedDraft = exerciseResolution.draft;

  /* A generated plan is not scheduled — it opens in the plan editor — so the
     calendar has nothing to say about it and is not asked. */
  const conflicts = allowUpcomingWorkouts && !planRequest
    ? await detectScheduleConflicts(resolvedDraft)
    : [];
  const draftId = crypto.randomUUID();
  const preview = buildPlanPreview(draftId, resolvedDraft, {
    scheduleConflicts: conflicts,
    unitSystem,
    artifactType
  });
  preview.conflicts = conflicts;

  const stored: StoredPlanDraft = {
    draftId,
    plan: resolvedDraft,
    preview,
    createdAt: Date.now()
  };
  if (planRequest) {
    generatedDrafts.set(draftId, stored);
    onPlanDraft?.(preview);
    return JSON.stringify({
      ok: true,
      draft_id: draftId,
      message: "Plan accepted. Reply with a two-sentence summary of it and nothing else; the app opens it in the athlete's plan editor."
    });
  }
  draftStore.set(draftId, stored);
  persistPlanDraft(stored);

  onPlanDraft?.(preview);

  return JSON.stringify({
    ok: true,
    draft_id: draftId,
    preview: {
      name: preview.name,
      summary: preview.summary,
      entries: preview.entries,
      conflicts: preview.conflicts,
      warnings: preview.warnings
    },
    message: artifactType === "workout"
      ? "Workout draft saved. Tell the athlete to review it, choose Workout Library or Calendar, and confirm. The workout is not a training plan."
      : "Draft saved. Tell the athlete to review the plan card: they can edit it first, save it to COROS as a plan, or explicitly choose individual COROS workouts or Calendar. Do not call upload_training_plan; the athlete confirms from the card."
  });
}

async function handleUploadTrainingPlan(
  args: Record<string, unknown>,
  _unitSystem: UnitSystem
): Promise<string> {
  const draftId = String(args.draft_id ?? args.draftId ?? "").trim();
  if (!draftId) {
    return JSON.stringify({ ok: false, error: "draft_id is required." });
  }

  const stored = loadStoredPlanDraft(draftId);
  if (!stored) {
    return JSON.stringify({
      ok: false,
      error:
        "Draft not found or expired. Ask the athlete to ask you to regenerate this training plan."
    });
  }

  if (stored.uploadedAt) {
    return JSON.stringify({
      ok: false,
      error: "This draft was already uploaded.",
      uploaded_at: stored.uploadedAt
    });
  }

  return JSON.stringify({
    ok: false,
    confirmation_required: true,
    error:
      "Plan writes cannot run from an AI tool call. Ask the athlete to choose a destination and confirm the plan card."
  });
}

async function handleListScheduledWorkouts(
  args: Record<string, unknown>,
  unitSystem: UnitSystem
): Promise<string> {
  const today = formatScheduleDay(new Date());
  const startDate = String(args.start_date ?? args.startDate ?? today)
    .replace(/-/g, "")
    .trim();
  let endDate = String(args.end_date ?? args.endDate ?? "").replace(/-/g, "").trim();

  if (!/^\d{8}$/.test(startDate)) {
    return JSON.stringify({ ok: false, error: "start_date must be YYYYMMDD." });
  }

  if (!endDate) {
    const end = new Date(
      Number(startDate.slice(0, 4)),
      Number(startDate.slice(4, 6)) - 1,
      Number(startDate.slice(6, 8))
    );
    end.setDate(end.getDate() + 13);
    endDate = formatScheduleDay(end);
  }

  if (!/^\d{8}$/.test(endDate)) {
    return JSON.stringify({ ok: false, error: "end_date must be YYYYMMDD." });
  }

  const entries = await listScheduledWorkoutEntries(startDate, endDate);
  return JSON.stringify({
    ok: true,
    count: entries.length,
    workouts: entries.map((entry) => ({
      schedule_date: entry.happenDay,
      name: entry.name,
      volume: formatScheduledVolume(entry.volume, unitSystem),
      training_load: entry.trainingLoad,
      exercises: entry.exercises?.length
        ? formatScheduledExercisesForChat(
            entry.exercises,
            unitSystem,
            Number(entry.sportType) === 3
          )
        : undefined,
      plan_id: entry.planId,
      id_in_plan: entry.idInPlan,
      plan_program_id: entry.planProgramId,
      program_id: entry.programId,
      sort_no: entry.sortNo
    }))
  });
}

function formatScheduledVolume(
  volume: string | undefined,
  unitSystem: UnitSystem
): string | undefined {
  const value = volume?.trim();
  if (!value) return volume;
  const match = value.match(/^([\d.]+)\s*(km|m)$/i);
  if (!match) return volume;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return volume;
  const swim = match[2]?.toLowerCase() === "m";
  return formatDistanceValue(amount * (swim ? 1 : 1_000), unitSystem, { swim });
}

async function handleDeleteWorkout(
  args: Record<string, unknown>,
  onWorkoutDelete?: (preview: WorkoutDeletePreview) => void
): Promise<string> {
  let params: DeleteWorkoutParams;
  try {
    params = parseDeleteWorkoutParams(args);
  } catch (caught) {
    return JSON.stringify({
      ok: false,
      error: caught instanceof Error ? caught.message : String(caught)
    });
  }

  try {
    const preview = await buildWorkoutDeletePreview(params);
    deleteRequestStore.set(preview.requestId, {
      requestId: preview.requestId,
      params,
      preview,
      createdAt: Date.now()
    });
    onWorkoutDelete?.(preview);

    return JSON.stringify({
      ok: true,
      request_id: preview.requestId,
      preview,
      message:
        "Delete request staged. Tell the athlete to review the confirmation card " +
        "and click Delete from COROS when ready. Do not claim the workout was removed until they confirm."
    });
  } catch (caught) {
    return JSON.stringify({
      ok: false,
      error: caught instanceof Error ? caught.message : String(caught)
    });
  }
}

function parseDeleteWorkoutParams(
  args: Record<string, unknown>
): DeleteWorkoutParams {
  const target = String(args.target ?? "").trim() as DeleteWorkoutParams["target"];
  if (!["scheduled", "library", "both"].includes(target)) {
    throw new Error("target must be scheduled, library, or both.");
  }

  const scheduleDate = args.schedule_date
    ? String(args.schedule_date).replace(/-/g, "").trim()
    : args.scheduleDate
      ? String(args.scheduleDate).replace(/-/g, "").trim()
      : undefined;

  if (scheduleDate && !/^\d{8}$/.test(scheduleDate)) {
    throw new Error("schedule_date must be YYYYMMDD.");
  }

  const params: DeleteWorkoutParams = {
    target,
    schedule_date: scheduleDate,
    workout_name: args.workout_name
      ? String(args.workout_name).trim()
      : args.workoutName
        ? String(args.workoutName).trim()
        : undefined,
    program_id: args.program_id
      ? String(args.program_id).trim()
      : args.programId
        ? String(args.programId).trim()
        : undefined,
    plan_id: args.plan_id ? String(args.plan_id).trim() : undefined,
    id_in_plan: args.id_in_plan ? String(args.id_in_plan).trim() : undefined,
    plan_program_id: args.plan_program_id
      ? String(args.plan_program_id).trim()
      : undefined
  };

  if (target === "scheduled" || target === "both") {
    const hasScheduleIds = params.plan_id && params.id_in_plan;
    const hasScheduleLookup = params.schedule_date && params.workout_name;
    if (!hasScheduleIds && !hasScheduleLookup) {
      throw new Error(
        "Scheduled delete requires schedule_date + workout_name, or plan_id + id_in_plan."
      );
    }
  }

  if (target === "library" || target === "both") {
    if (!params.program_id && !params.workout_name) {
      throw new Error(
        "Library delete requires program_id or workout_name."
      );
    }
  }

  return params;
}

function formatDisplayScheduleDate(value?: string): string | undefined {
  if (!value) return undefined;
  const normalized = value.replace(/-/g, "");
  if (!/^\d{8}$/.test(normalized)) return value;
  return `${normalized.slice(0, 4)}-${normalized.slice(4, 6)}-${normalized.slice(6, 8)}`;
}

function buildDeleteSummary(params: DeleteWorkoutParams): string {
  const parts: string[] = [];
  const name = params.workout_name;
  const date = formatDisplayScheduleDate(params.schedule_date);

  if (params.target === "scheduled" || params.target === "both") {
    if (name && date) {
      parts.push(`Remove "${name}" from your calendar on ${date}`);
    } else if (params.plan_id && params.id_in_plan) {
      parts.push("Remove the scheduled workout from your calendar");
    } else {
      parts.push("Remove from calendar");
    }
  }

  if (params.target === "library" || params.target === "both") {
    if (name) {
      parts.push(`Delete "${name}" from your workout library`);
    } else if (params.program_id) {
      parts.push("Delete the workout from your library");
    } else {
      parts.push("Delete from workout library");
    }
  }

  return parts.join(". ");
}

async function buildWorkoutDeletePreview(
  params: DeleteWorkoutParams
): Promise<WorkoutDeletePreview> {
  let workoutName = params.workout_name;
  let scheduleDate = params.schedule_date;
  let programId = params.program_id;

  if (params.target === "scheduled" || params.target === "both") {
    let scheduleEntry:
      | Awaited<ReturnType<typeof listScheduledWorkoutEntries>>[number]
      | undefined;

    if (params.plan_id && params.id_in_plan) {
      const entries = scheduleDate
        ? await listScheduledWorkoutEntries(scheduleDate, scheduleDate)
        : await listScheduledWorkoutEntries(
            formatScheduleDay(new Date()),
            formatScheduleDay(new Date(Date.now() + 365 * 24 * 60 * 60 * 1000))
          );
      scheduleEntry = entries.find(
        (entry) =>
          entry.planId === params.plan_id &&
          entry.idInPlan === params.id_in_plan
      );
    } else if (scheduleDate && workoutName) {
      const entries = await listScheduledWorkoutEntries(
        scheduleDate,
        scheduleDate
      );
      const matches = entries.filter((entry) => entry.name === workoutName);
      if (matches.length > 1) {
        throw new Error(
          `Multiple scheduled workouts named "${workoutName}" on ${scheduleDate}. ` +
            "Use plan_id and id_in_plan to disambiguate."
        );
      }
      scheduleEntry = matches[0];
    }

    if (!scheduleEntry) {
      throw new Error("Scheduled workout not found on COROS calendar.");
    }

    workoutName = workoutName ?? scheduleEntry.name;
    scheduleDate = scheduleEntry.happenDay;
    programId = programId ?? scheduleEntry.programId;
  }

  const requestId = crypto.randomUUID();
  const enriched: DeleteWorkoutParams = {
    ...params,
    workout_name: workoutName,
    schedule_date: scheduleDate,
    program_id: programId
  };

  return {
    requestId,
    target: params.target,
    workoutName,
    scheduleDate: formatDisplayScheduleDate(scheduleDate),
    programId,
    summary: buildDeleteSummary(enriched)
  };
}

export async function confirmWorkoutDeleteById(
  requestId: string
): Promise<DeleteWorkoutResult> {
  const stored = deleteRequestStore.get(requestId);
  if (!stored) {
    throw new Error("Workout delete request not found or expired.");
  }
  if (stored.executedAt) {
    throw new Error("This workout was already deleted.");
  }

  const result = await deleteWorkout(stored.params);
  stored.executedAt = Date.now();
  return result;
}

export async function uploadPlanDraftById(
  draftId: string,
  unitSystem: UnitSystem = "metric",
  destination: TrainingPlanDestination = "workoutLibrary",
  scheduleDate?: string
): Promise<UploadPlanResult> {
  const stored = loadStoredPlanDraft(draftId);
  if (!stored) {
    throw new Error(
      "Training plan draft not found or expired. Ask the coach to regenerate this plan."
    );
  }
  if (stored.uploadedAt) {
    throw new Error("This training plan was already uploaded.");
  }

  if (destination === "nativePlan") {
    return savePlanDraftAsCorosPlan(stored, unitSystem);
  }
  if (destination !== "workoutLibrary" && destination !== "calendar") {
    throw new Error("Save the plan to COROS as a plan, as individual workouts, or on the calendar.");
  }

  if (scheduleDate && stored.preview.artifactType !== "workout") {
    throw new Error("A calendar date can only override a one-off workout draft.");
  }
  const input = buildTrainingPlanDestinationInput(
    stored.plan,
    destination,
    scheduleDate
  );
  const uploaded = await uploadTrainingPlan(input, unitSystem);
  const result: UploadPlanResult = {
    ...uploaded,
    destination,
    remoteWrites: destination === "calendar"
      ? input.workouts.map((workout) => `Schedule ${workout.name} on ${workout.schedule_date}`)
      : input.workouts.map((workout) => `Create workout ${workout.name}`)
  };
  markDraftSaved(stored, result);
  return result;
}

function markDraftSaved(stored: StoredPlanDraft, result: UploadPlanResult): void {
  stored.uploadedAt = Date.now();
  stored.preview.uploadedAt = stored.uploadedAt;
  stored.preview.uploadResult = {
    workoutsScheduled: result.workoutsScheduled,
    workoutsCreated: result.workoutsCreated,
    destination: result.destination,
    ...(result.planId ? { planId: result.planId } : {})
  };
  persistPlanDraft(stored);
  markChatPlanDraftUploaded(stored.draftId, stored.uploadedAt);
}

function requirePlanDraft(draftId: string): StoredPlanDraft {
  const stored = loadStoredPlanDraft(draftId);
  if (!stored) {
    throw new Error("Training plan draft not found. Ask the coach to write the plan again.");
  }
  if (stored.preview.artifactType === "workout") {
    throw new Error("This is a single workout, not a plan.");
  }
  return stored;
}

/** The coach's plan as the plan editor and a COROS save read it. */
function coachDraftDocument(stored: StoredPlanDraft): TrainingPlanDocument {
  return trainingPlanFromCoachDraftPreview(stored.preview, {
    description: stored.plan.description,
    weekStages: stored.plan.weekStages,
    layout: stored.plan.layout
  });
}

/**
 * A plan the coach wrote, saved to COROS whole. It is a COROS plan from here
 * on — listed with the athlete's other plans, marked as the coach's — and the
 * card says where it went.
 */
async function savePlanDraftAsCorosPlan(
  stored: StoredPlanDraft,
  unitSystem: UnitSystem
): Promise<UploadPlanResult> {
  if (stored.preview.artifactType === "workout") {
    throw new Error("A single workout is saved to the library or the calendar, not as a plan.");
  }
  const saved = await savePlanToCoros({
    plan: coachDraftDocument(stored),
    unitSystem,
    origin: "coach",
    coach: { draftId: stored.draftId }
  });
  if (!saved.ok) throw new Error("COROS did not take the plan. Try again.");
  const result: UploadPlanResult = {
    planName: saved.plan.name,
    workoutsCreated: saved.plan.entries.length,
    workoutsScheduled: 0,
    entries: [],
    destination: "nativePlan",
    planId: saved.plan.id,
    remoteWrites: [`Create plan ${saved.plan.name}`]
  };
  markDraftSaved(stored, result);
  return result;
}

/** The plan behind a Coach card, for the editor "Edit plan first" opens. */
export function planDraftDocument(draftId: string): TrainingPlanDocument {
  return coachDraftDocument(requirePlanDraft(draftId));
}

/**
 * The athlete's edit of a coach plan, written back into the coach's own draft
 * — not a plan draft of the library's, and not a new card. The draft keeps
 * its id, so the card, the coach's tools and a later save all read the edited
 * version, and `editedAt` is what puts that version in front of the coach on
 * its next turn.
 *
 * Dates are kept where the coach gave them: a session is dated from the
 * Monday the coach's first dated session fell in, at the week and day the
 * athlete left it on. A plan the coach wrote undated stays undated, with the
 * arrangement kept beside it as `layout`.
 */
export async function savePlanDraftEdit(
  draftId: string,
  plan: TrainingPlanDocument,
  unitSystem: UnitSystem = "metric"
): Promise<PlanDraftPreview> {
  const stored = requirePlanDraft(draftId);
  if (stored.uploadedAt) {
    throw new Error("This plan has already been saved, so the Coach card can no longer be edited.");
  }
  const dates = stored.plan.workouts
    .map((workout) => parsePlanDay(workout.schedule_date))
    .filter((date): date is Date => Boolean(date))
    .sort((left, right) => left.valueOf() - right.valueOf());
  const anchor = dates[0] ? mondayOf(dates[0]) : undefined;
  const originals = new Map(stored.plan.workouts.map((workout) => [workout.key, workout]));
  const keys = new Set<string>();
  const layout: NonNullable<CorosTrainingPlanDraft["layout"]> = {};

  const workouts = [...plan.entries]
    .sort(
      (left, right) =>
        left.weekIndex - right.weekIndex ||
        left.dayIndex - right.dayIndex ||
        left.sortOrder - right.sortOrder
    )
    .map((entry, index): PlanWorkoutEntry => {
      let key = (entry.workout.key || entry.id).trim();
      while (keys.has(key)) key = `${key}-${index + 1}`;
      keys.add(key);
      const day = anchor ? new Date(anchor) : undefined;
      day?.setDate(day.getDate() + entry.weekIndex * 7 + entry.dayIndex);
      if (!day) layout[key] = { weekIndex: entry.weekIndex, dayIndex: entry.dayIndex };
      const { schedule_date: _date, sort_no: _sort, save_to_library: _library, ...workout } = structuredClone(entry.workout);
      const original = originals.get(key);
      return {
        ...workout,
        key,
        name: entry.title.trim() || workout.name,
        sort_no: index + 1,
        ...(day ? { schedule_date: formatPlanDay(day, false) } : {}),
        ...(original?.save_to_library !== undefined ? { save_to_library: original.save_to_library } : {})
      } as PlanWorkoutEntry;
    });

  const next: CorosTrainingPlanDraft = {
    name: plan.name.trim(),
    workouts,
    ...(plan.description.trim() ? { description: plan.description.trim() } : {}),
    ...(plan.weekStages.length ? { weekStages: plan.weekStages.map((stage) => ({ ...stage })) } : {}),
    ...(anchor ? {} : { layout })
  };
  const validation = validatePlanDraft(next, { todayDay: "00000000" });
  if (!validation.ok) throw new Error(validation.errors.join(" "));

  let conflicts: string[] = [];
  if (anchor) {
    try {
      conflicts = await detectScheduleConflicts(next);
    } catch {
      /* The calendar is only consulted to warn; offline, the card says nothing. */
    }
  }
  const preview = buildPlanPreview(draftId, next, {
    scheduleConflicts: conflicts,
    unitSystem,
    artifactType: "plan"
  });
  preview.editedAt = Date.now();
  stored.plan = next;
  stored.preview = preview;
  persistPlanDraft(stored);
  return preview;
}

/**
 * A conversation's drafts go with it. They used to be pruned a day after they
 * were written, which left a card in the transcript whose Save could only
 * answer "draft not found"; now a draft lives exactly as long as the card.
 */
export function deletePlanDraftsOf(draftIds: readonly string[]): void {
  for (const draftId of draftIds) {
    draftStore.delete(draftId);
    deleteChatPlanDraft(draftId);
  }
}

/** Remove delete requests older than 24 hours */
export function pruneDeleteRequestStore(): void {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [id, request] of deleteRequestStore) {
    if (request.createdAt < cutoff) {
      deleteRequestStore.delete(id);
    }
  }
}
