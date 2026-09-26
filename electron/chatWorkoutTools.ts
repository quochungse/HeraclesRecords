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
  listChatPlanDraftVersions,
  markChatPlanDraftUploaded,
  saveChatPlanDraft,
  type ChatPlanDraftAuthor,
  type StoredChatPlanDraftRecord
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
import { planDiff } from "./planDiff";
import {
  PLAN_DAYS,
  PLAN_REVISION_OPS,
  applyPlanRevision,
  planAsDraftArgs
} from "./planRevision";
import type {
  CorosMcpTool,
  CorosTrainingPlanDraftInput,
  DeleteWorkoutResult,
  PlanArtifactVersion,
  PlanDraftPreview,
  PlanWorkoutEntryInput,
  PlanVersionConflict,
  PlanVersionSave,
  PlanVersionWritten,
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
  /** The creation this is a version of: its first version's draft id. */
  artifactId: string;
  version: number;
  parentDraftId?: string;
  author: ChatPlanDraftAuthor;
  /** What this version changed, in the words of whoever made it. */
  changeSummary?: string;
  /**
   * The plan as COROS last answered it, once it has been saved there
   * (P1.6); otherwise the document is derived from `plan` whenever it is read.
   */
  document?: TrainingPlanDocument;
}

/**
 * A version of a creation for the transcript: without each session's
 * `source`. Carried in every version's card, a plan of 45 sessions put ~50k
 * characters in the transcript per version (docs/coach-plan-canvas.md, Q5);
 * the renderer reads the steps from the draft's document instead. The row's
 * `preview_json` keeps them — a build from before versions saves a plan to
 * COROS from that preview, and would write every session without its steps.
 */
function lightPreview(preview: PlanDraftPreview): PlanDraftPreview {
  return {
    ...preview,
    entries: preview.entries.map(({ source: _source, ...entry }) => entry)
  };
}

/** A plan's workout as the preview's `source` spells it. */
function workoutSource(workout: PlanWorkoutEntry): PlanWorkoutEntryInput {
  return {
    key: workout.key,
    name: workout.name,
    ...(workout.sport ? { sport: workout.sport } : {}),
    ...(workout.sport_options ? { sport_options: workout.sport_options } : {}),
    ...(workout.description ? { description: workout.description } : {}),
    ...(workout.steps ? { steps: workout.steps as PlanWorkoutEntryInput["steps"] } : {}),
    ...(workout.distance_km !== undefined ? { distance_km: workout.distance_km } : {}),
    ...(workout.schedule_date ? { schedule_date: workout.schedule_date } : {}),
    ...(workout.sort_no !== undefined ? { sort_no: workout.sort_no } : {}),
    ...(workout.save_to_library !== undefined ? { save_to_library: workout.save_to_library } : {})
  };
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
    uploadedAt: stored.uploadedAt,
    artifactId: stored.artifactId,
    version: stored.version,
    ...(stored.parentDraftId ? { parentDraftId: stored.parentDraftId } : {}),
    author: stored.author,
    ...(stored.changeSummary ? { changeSummary: stored.changeSummary } : {}),
    documentJson: JSON.stringify(draftDocument(stored))
  });
}

function storedFromRecord(row: StoredChatPlanDraftRecord): StoredPlanDraft {
  const preview = JSON.parse(row.previewJson) as PlanDraftPreview;
  let document: TrainingPlanDocument | undefined;
  if (row.documentJson && row.author === "coros") {
    try {
      document = JSON.parse(row.documentJson) as TrainingPlanDocument;
    } catch {
      document = undefined;
    }
  }
  return {
    draftId: row.draftId,
    plan: JSON.parse(row.planJson) as CorosTrainingPlanDraft,
    preview: { ...preview, uploadedAt: row.uploadedAt ?? preview.uploadedAt },
    createdAt: row.createdAt,
    uploadedAt: row.uploadedAt,
    artifactId: row.artifactId ?? row.draftId,
    version: row.version ?? 1,
    ...(row.parentDraftId ? { parentDraftId: row.parentDraftId } : {}),
    author: row.author ?? "coach",
    ...(row.changeSummary ? { changeSummary: row.changeSummary } : {}),
    ...(document ? { document } : {})
  };
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
    const stored = storedFromRecord(row);
    draftStore.set(draftId, stored);
    return stored;
  } catch {
    return undefined;
  }
}

export const CHAT_WORKOUT_TOOL_NAMES = [
  "search_coros_exercises",
  "draft_workout",
  "draft_training_plan",
  "revise_training_plan",
  "get_plan_draft",
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
        "Nothing is saved to COROS by this or any tool: the athlete saves from the card. Returns a draftId and a short preview. " +
        "To change a plan you already drafted, use revise_training_plan; set revises only when rewriting most of it.",
      inputSchema: withRevises(buildDraftTrainingPlanInputSchema())
    },
    {
      name: "revise_training_plan",
      description:
        "Change a plan or workout you already drafted in this conversation, by listing only what changes. " +
        "The result is a new version of the same card; the old one folds away. " +
        "draft_id must be the newest version's; if it is not, the newest is returned to revise instead. " +
        "Sessions are named by their key. A single workout takes only replace_session (with the whole new workout) and rename. " +
        "The revised plan is checked like a new draft; a refusal lists every problem, and nothing is changed.",
      inputSchema: buildRevisePlanInputSchema()
    },
    {
      name: "get_plan_draft",
      description:
        "Read a plan or workout drafted in this conversation as it stands now — its newest version, whoever made it — " +
        "or an earlier version: every session by key, with its week and day or date, sport, volume and steps in brief. " +
        "Pass sessions (keys) for those sessions' whole workouts, before replacing one.",
      inputSchema: {
        type: "object",
        properties: {
          draft_id: { type: "string", description: "Any version's draft_id." },
          version: { type: "integer", minimum: 1, description: "An earlier version; omit for the newest." },
          sessions: {
            type: "array",
            items: { type: "string" },
            maxItems: 10,
            description: "Keys of sessions to return whole."
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
  if (name === "get_plan_draft") {
    return handleGetPlanDraft(args);
  }
  if (name === "revise_training_plan") {
    return handleRevisePlan(args, options?.onPlanDraft, options?.allowUpcomingWorkouts !== false, options?.unitSystem ?? "metric");
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

interface RawPlacement {
  key: string;
  name: string;
  dated: boolean;
  week?: number;
  day?: number;
  /** A week or a day was given, valid or not. */
  placed: boolean;
}

function rawPlacements(args: Record<string, unknown>): RawPlacement[] {
  const rawWorkouts = Array.isArray(args.workouts) ? args.workouts : [];
  return rawWorkouts.map((item, index) => {
    const entry = (item ?? {}) as Record<string, unknown>;
    const week = Number(entry.week);
    const day = PLAN_DAYS.indexOf(String(entry.day ?? "").toLowerCase() as (typeof PLAN_DAYS)[number]);
    return {
      key: String(entry.key ?? `workout-${index + 1}`).trim(),
      name: String(entry.name ?? `Workout ${index + 1}`).trim(),
      dated: Boolean(entry.schedule_date),
      placed: entry.week !== undefined || entry.day !== undefined,
      ...(Number.isInteger(week) && week >= 1 && week <= 52 ? { week: week - 1 } : {}),
      ...(day >= 0 ? { day } : {})
    };
  });
}

/**
 * A plan's sessions are placed one way: every one dated (sessions to use now),
 * or every one given a week and a day (a programme to start later). A mix has
 * no reading — dates count from the first date's Monday, weeks from a start not
 * yet chosen — so it is handed back rather than guessed at. Undated sessions
 * with no week and day at all are still accepted, as before.
 */
export function planPlacementErrors(args: Record<string, unknown>): string[] {
  const placements = rawPlacements(args);
  const errors: string[] = [];
  for (const item of placements) {
    if (item.dated && item.placed) {
      errors.push(`"${item.name}" has both a schedule_date and a week/day; give one.`);
    } else if (item.placed && (item.week === undefined || item.day === undefined)) {
      errors.push(`"${item.name}" needs both week (1–52) and day (mon…sun).`);
    }
  }
  const dated = placements.filter((item) => item.dated).length;
  const placed = placements.filter((item) => item.placed).length;
  if (dated > 0 && placed > 0 && !errors.length) {
    errors.push(
      "Give every session a schedule_date, or every session a week and day — not a mix."
    );
  }
  return errors;
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
  /* Week and day ride in `layout`, which the plan document already reads for
     an undated plan — without them it laid the list out one session a day. */
  const layout: NonNullable<CorosTrainingPlanDraft["layout"]> = {};
  for (const item of rawPlacements(args)) {
    if (!item.dated && item.week !== undefined && item.day !== undefined) {
      layout[item.key] = { weekIndex: item.week, dayIndex: item.day };
    }
  }
  return {
    name,
    workouts,
    ...(description ? { description } : {}),
    ...(weekStages.length ? { weekStages } : {}),
    ...(Object.keys(layout).length ? { layout } : {})
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
  scheduleDate?: string,
  /** A workout scheduled on the calendar is also kept in the library. */
  keepInLibrary = false
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
        save_to_library: keepInLibrary
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

type PreparedDraft =
  | { ok: true; draft: CorosTrainingPlanDraft; conflicts: string[] }
  | { ok: false; response: string };

/**
 * Every check a draft passes before it is kept — placement, the validator,
 * the generator's request, the exercise catalog — and the calendar's say on
 * it. A new draft and a revision go through this one path, so a revision is
 * refused for exactly what a new plan would be.
 */
async function prepareDraft(
  args: Record<string, unknown>,
  {
    allowUpcomingWorkouts,
    planRequest,
    retryTool
  }: {
    allowUpcomingWorkouts: boolean;
    planRequest?: TrainingPlanGenerationRequest;
    retryTool: string;
  }
): Promise<PreparedDraft> {
  const refuse = (body: Record<string, unknown>): PreparedDraft => ({
    ok: false,
    response: JSON.stringify({ ok: false, ...body })
  });
  const placementErrors = planPlacementErrors(args);
  if (placementErrors.length > 0) {
    return refuse({ errors: placementErrors });
  }
  const draft = toPlanDraft(args);
  const validation = validatePlanDraft(draft, {
    todayDay: formatScheduleDay(new Date())
  });
  if (!validation.ok) {
    return refuse({ errors: validation.errors });
  }
  /* Before the exercises are resolved: that can cost COROS requests, and a
     draft with the wrong number of sessions is going to be rewritten anyway. */
  if (planRequest) {
    const problems = generatedPlanProblems(draft.workouts, planRequest);
    if (problems.length > 0) {
      return refuse({
        error_code: "plan_breaks_request",
        errors: problems.slice(0, 20),
        action: "Fix every problem listed and call draft_training_plan again with the whole plan. Do not ask the athlete."
      });
    }
  }

  const exerciseResolution = await resolveTrainingPlanExercises(draft);
  if (exerciseResolution.issues.length > 0) {
    return refuse({
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
  return { ok: true, draft: resolvedDraft, conflicts };
}

async function handleDraftTrainingPlan(
  args: Record<string, unknown>,
  onPlanDraft?: (preview: PlanDraftPreview) => void,
  allowUpcomingWorkouts = true,
  unitSystem: UnitSystem = "metric",
  artifactType: "plan" | "workout" = "plan",
  planRequest?: TrainingPlanGenerationRequest
): Promise<string> {
  /* A rewrite of a plan already drafted is a version of it, not a new card;
     asked before anything is checked, since a stale id is refused anyway. */
  const revises = !planRequest && artifactType === "plan" ? String(args.revises ?? "").trim() : "";
  const target = revises ? revisionTarget(revises, "plan") : undefined;
  if (target && !target.ok) return target.response;

  const prepared = await prepareDraft(args, {
    allowUpcomingWorkouts,
    planRequest,
    retryTool: artifactType === "workout" ? "draft_workout" : "draft_training_plan"
  });
  if (!prepared.ok) return prepared.response;

  if (target?.ok) {
    return storeRevision(target.latest, prepared, unitSystem, "Rewritten by Coach.", onPlanDraft);
  }

  const draftId = crypto.randomUUID();
  const preview = buildPlanPreview(draftId, prepared.draft, {
    scheduleConflicts: prepared.conflicts,
    unitSystem,
    artifactType
  });
  preview.conflicts = prepared.conflicts;

  const stored: StoredPlanDraft = {
    draftId,
    plan: prepared.draft,
    preview,
    createdAt: Date.now(),
    artifactId: draftId,
    version: 1,
    author: "coach"
  };
  if (planRequest) {
    generatedDrafts.set(draftId, stored);
    onPlanDraft?.(preview);
    return JSON.stringify({
      ok: true,
      draft_id: draftId,
      message: "Plan accepted. Reply with a two-sentence summary of it and nothing else; the app shows it to the athlete week by week, to save, schedule or edit."
    });
  }
  persistPlanDraft(stored);

  onPlanDraft?.(lightPreview(preview));

  return JSON.stringify({
    ok: true,
    draft_id: draftId,
    preview: {
      name: preview.name,
      summary: preview.summary,
      // Without each session's `source`: the steps are what the model just
      // wrote, and echoing them back cost ~10k tokens a plan on every later
      // round of the turn.
      entries: preview.entries.map(({ source: _source, ...entry }) => entry),
      conflicts: preview.conflicts,
      warnings: preview.warnings
    },
    message: artifactType === "workout"
      ? "The workout card is shown under your reply; the athlete saves it from there. Say why this session, briefly; do not repeat its steps."
      : "The plan card is shown under your reply; the athlete saves it from there. Explain the plan's logic and its key weeks; do not list every session."
  });
}

/** The versions of a creation, oldest first, as the renderer orders them. */
function versionsOf(artifactId: string): StoredPlanDraft[] {
  return listChatPlanDraftVersions(artifactId).flatMap((row) => {
    try {
      return [storedFromRecord(row)];
    } catch {
      return [];
    }
  });
}

/** Each session in a line the model can name it by. */
function sessionLines(plan: CorosTrainingPlanDraft): string[] {
  return plan.workouts.map((workout) => {
    const placed = plan.layout?.[workout.key];
    const where = workout.schedule_date
      ? workout.schedule_date
      : placed
        ? `week ${placed.weekIndex + 1} ${PLAN_DAYS[placed.dayIndex]}`
        : "unplaced";
    return `${workout.key} · ${where} · ${workout.sport ?? "run"} · ${workout.name}`;
  });
}

type RevisionTarget =
  | { ok: true; latest: StoredPlanDraft }
  | { ok: false; response: string };

/**
 * The version a revision is written on top of. Only the newest may be: a
 * revision of an older one would drop whatever came after it — the athlete's
 * own edit, say — without anyone deciding that. A saved creation is refused
 * until changing it can update the plan on COROS rather than make a second.
 */
function revisionTarget(draftId: string, only?: "plan"): RevisionTarget {
  const refuse = (body: Record<string, unknown>): RevisionTarget => ({
    ok: false,
    response: JSON.stringify({ ok: false, ...body })
  });
  const named = loadStoredPlanDraft(draftId);
  if (!named) {
    return refuse({
      error_code: "draft_not_found",
      errors: [`No draft ${draftId} in this conversation. Draft a new one instead.`]
    });
  }
  if (only === "plan" && named.preview.artifactType === "workout") {
    return refuse({
      error_code: "draft_is_a_workout",
      errors: [`${draftId} is a single workout. Change it with revise_training_plan and replace_session.`]
    });
  }
  const versions = versionsOf(named.artifactId);
  const latest = versions[versions.length - 1] ?? named;
  if (versions.some((version) => version.uploadedAt) || named.uploadedAt) {
    return refuse({
      error_code: "draft_saved",
      errors: [
        "This is already saved to COROS, and changing it from the conversation is not available yet. " +
          "Tell the athlete what to change in the Training Library, or draft a new one if they want it."
      ]
    });
  }
  if (latest.draftId !== named.draftId) {
    return refuse({
      error_code: "not_latest_version",
      errors: [
        `${draftId} is version ${named.version}; the newest is version ${latest.version}` +
          `${latest.author === "athlete" ? ", which the athlete edited" : ""}. Revise that one.`
      ],
      latest: {
        draft_id: latest.draftId,
        version: latest.version,
        name: latest.plan.name,
        sessions: sessionLines(latest.plan)
      }
    });
  }
  return { ok: true, latest };
}

/** A new version of `latest`'s creation, kept and shown in place of it. */
function storeRevision(
  latest: StoredPlanDraft,
  prepared: Extract<PreparedDraft, { ok: true }>,
  unitSystem: UnitSystem,
  changeSummary: string,
  onPlanDraft?: (preview: PlanDraftPreview) => void
): string {
  const artifactType = latest.preview.artifactType ?? "plan";
  const draftId = crypto.randomUUID();
  const preview = buildPlanPreview(draftId, prepared.draft, {
    scheduleConflicts: prepared.conflicts,
    unitSystem,
    artifactType
  });
  preview.conflicts = prepared.conflicts;
  const stored: StoredPlanDraft = {
    draftId,
    plan: prepared.draft,
    preview,
    // Later than the version it replaces even within one millisecond, since
    // the order of two versions of one number is decided by this.
    createdAt: Math.max(Date.now(), latest.createdAt + 1),
    artifactId: latest.artifactId,
    version: latest.version + 1,
    parentDraftId: latest.draftId,
    author: "coach",
    changeSummary
  };
  persistPlanDraft(stored);
  onPlanDraft?.(lightPreview(preview));
  return JSON.stringify({
    ok: true,
    draft_id: draftId,
    version: stored.version,
    preview: {
      name: preview.name,
      summary: preview.summary,
      conflicts: preview.conflicts,
      warnings: preview.warnings
    },
    message:
      `Version ${stored.version} is shown under your reply in place of version ${latest.version}. ` +
      "Say what changed and why in a sentence or two; do not list the sessions."
  });
}

/**
 * A creation as the coach reads it back: the newest version unless an older
 * one is asked for, since the athlete may have changed it since the coach
 * last looked. Steps in brief for every session, whole for the ones named.
 */
function handleGetPlanDraft(args: Record<string, unknown>): string {
  const draftId = String(args.draft_id ?? "").trim();
  const named = draftId ? loadStoredPlanDraft(draftId) : undefined;
  if (!named) {
    return JSON.stringify({
      ok: false,
      error_code: "draft_not_found",
      errors: [`No draft ${draftId} in this conversation.`]
    });
  }
  const versions = versionsOf(named.artifactId);
  const newest = versions[versions.length - 1] ?? named;
  const asked = Number(args.version);
  const chosen = Number.isInteger(asked)
    ? [...versions].reverse().find((version) => version.version === asked)
    : newest;
  if (!chosen) {
    return JSON.stringify({
      ok: false,
      error_code: "version_not_found",
      errors: [`There is no version ${asked}; the newest is version ${newest.version}.`]
    });
  }
  const plan = chosen.plan;
  const byKey = new Map(chosen.preview.entries.map((entry) => [entry.key, entry]));
  const wanted = new Set(
    (Array.isArray(args.sessions) ? args.sessions : []).map((key) => String(key ?? "").trim())
  );
  const whole = plan.workouts.filter((workout) => wanted.has(workout.key));
  return JSON.stringify({
    ok: true,
    draft_id: chosen.draftId,
    version: chosen.version,
    ...(chosen.draftId !== newest.draftId
      ? { newest: { draft_id: newest.draftId, version: newest.version } }
      : {}),
    made_by: chosen.author === "coach" ? "you" : chosen.author === "athlete" ? "the athlete" : "a change in the Library",
    ...(chosen.preview.editedAt ? { edited_by_athlete: true } : {}),
    ...(chosen.changeSummary ? { change: chosen.changeSummary } : {}),
    type: chosen.preview.artifactType ?? "plan",
    name: plan.name,
    ...(plan.description ? { description: plan.description } : {}),
    saved: Boolean(versions.some((version) => version.uploadedAt)),
    ...(plan.weekStages?.length
      ? {
          week_stages: plan.weekStages.map((item) => ({
            week: item.weekIndex + 1,
            stage: COROS_WEEK_STAGES.find((stage) => stage.value === item.stage)?.slug
          }))
        }
      : {}),
    sessions: sessionLines(plan).map((line, index) => {
      const entry = byKey.get(plan.workouts[index].key);
      const facts = [entry?.volume, entry?.stepsSummary].filter(Boolean).join(" · ");
      return facts ? `${line} — ${facts}` : line;
    }),
    ...(whole.length ? { workouts: whole.map(workoutSource) } : {})
  });
}

async function handleRevisePlan(
  args: Record<string, unknown>,
  onPlanDraft: ((preview: PlanDraftPreview) => void) | undefined,
  allowUpcomingWorkouts: boolean,
  unitSystem: UnitSystem
): Promise<string> {
  const draftId = String(args.draft_id ?? "").trim();
  const summary = String(args.summary ?? "").trim();
  if (!draftId || !summary) {
    return JSON.stringify({ ok: false, errors: ["draft_id, ops and summary are required."] });
  }
  const target = revisionTarget(draftId);
  if (!target.ok) return target.response;
  const artifactType = target.latest.preview.artifactType ?? "plan";
  const applied = applyPlanRevision(planAsDraftArgs(target.latest.plan), args.ops, artifactType);
  if (!applied.ok) {
    return JSON.stringify({
      ok: false,
      error_code: "revision_not_applied",
      errors: applied.errors,
      sessions: sessionLines(target.latest.plan)
    });
  }
  const prepared = await prepareDraft(applied.args, {
    allowUpcomingWorkouts,
    retryTool: "revise_training_plan"
  });
  if (!prepared.ok) return prepared.response;
  return storeRevision(target.latest, prepared, unitSystem, summary.slice(0, 200), onPlanDraft);
}

/** `draft_training_plan`'s schema, with the one field a rewrite adds. */
function withRevises(schema: Record<string, unknown>): Record<string, unknown> {
  const properties = (schema.properties ?? {}) as Record<string, unknown>;
  return {
    ...schema,
    properties: {
      ...properties,
      revises: {
        type: "string",
        description:
          "Only when rewriting most of a plan you already drafted here: its newest draft_id. The result is its next version. For smaller changes use revise_training_plan."
      }
    }
  };
}

export function buildRevisePlanInputSchema(): Record<string, unknown> {
  const workout = (buildDraftWorkoutInputSchema() as { properties: { workout: Record<string, unknown> } })
    .properties.workout;
  return {
    type: "object",
    properties: {
      draft_id: { type: "string", description: "The newest version's draft_id." },
      summary: {
        type: "string",
        description: "One short sentence for the athlete saying what changed, e.g. \"Long run moved to Sunday\"."
      },
      ops: {
        type: "array",
        minItems: 1,
        description:
          "Changes in order. move_session {key, week, day}; replace_session {key, workout}; remove_session {key}; " +
          "add_session {week, day, workout}; set_week_stage {week, stage}; rename {name}; set_description {description}. " +
          "On a dated plan a session may take schedule_date instead of week and day; week 1 is the week of its first session.",
        items: {
          type: "object",
          properties: {
            op: { type: "string", enum: [...PLAN_REVISION_OPS] },
            key: { type: "string", description: "The session's key." },
            week: { type: "integer", minimum: 1, maximum: 52 },
            day: { type: "string", enum: [...PLAN_DAYS] },
            schedule_date: { type: "string", pattern: "^\\d{8}$" },
            workout: { ...workout, description: "The whole new workout; its key is kept from the session it replaces." },
            stage: { type: "string", enum: COROS_WEEK_STAGES.map((stage) => stage.slug) },
            name: { type: "string" },
            description: { type: "string" }
          },
          required: ["op"]
        }
      }
    },
    required: ["draft_id", "summary", "ops"]
  };
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
    // Delete requests live in memory only, so a card from before a restart
    // reaches here. Nothing was deleted, and the coach can stage it again.
    throw new Error("This delete request has expired, and nothing was deleted. Ask Coach again.");
  }
  if (stored.executedAt) {
    throw new Error("This workout was already deleted.");
  }

  const result = await deleteWorkout(stored.params);
  stored.executedAt = Date.now();
  return result;
}

/** The sessions a calendar save would put on a day before `today` (both `yyyyMMdd`). */
export function pastCalendarSessions<T extends { schedule_date?: string }>(
  workouts: readonly T[],
  today: string
): T[] {
  return workouts.filter((workout) => Boolean(workout.schedule_date) && workout.schedule_date! < today);
}

export async function uploadPlanDraftById(
  draftId: string,
  unitSystem: UnitSystem = "metric",
  destination: TrainingPlanDestination = "workoutLibrary",
  scheduleDate?: string,
  keepInLibrary = false
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
    scheduleDate,
    keepInLibrary
  );
  if (destination === "calendar") {
    // Said here, by name, before anything is written: COROS refuses a past day
    // one workout at a time, after the ones before it have gone through. An
    // edit in the plan editor is not held to today, so this is where it shows.
    const past = pastCalendarSessions(input.workouts, formatScheduleDay(new Date()));
    if (past.length > 0) {
      throw new Error(
        `${past.map((workout) => `"${workout.name}"`).join(", ")} ${
          past.length === 1 ? "is" : "are"
        } on a day that has gone by. Move ${past.length === 1 ? "it" : "them"} in Edit, or save the plan to COROS instead.`
      );
    }
  }
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

/**
 * The plan a version is, as the library reads it: the one COROS answered once
 * it has been saved there, otherwise built from the draft's own workouts —
 * not from the preview, which no longer carries them.
 */
function draftDocument(stored: StoredPlanDraft): TrainingPlanDocument {
  return stored.document ?? coachDraftDocument(stored);
}

/** The coach's plan as the plan editor and a COROS save read it. */
function coachDraftDocument(stored: StoredPlanDraft): TrainingPlanDocument {
  const workouts = new Map(stored.plan.workouts.map((workout) => [workout.key, workout]));
  const full: PlanDraftPreview = {
    ...stored.preview,
    entries: stored.preview.entries.map((entry) => {
      const workout = workouts.get(entry.key);
      return entry.source || !workout ? entry : { ...entry, source: workoutSource(workout) };
    })
  };
  return trainingPlanFromCoachDraftPreview(full, {
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

/**
 * Every version of the creations these drafts belong to. Read from the table,
 * not the in-memory store, so a version written on another machine and synced
 * in since is listed too.
 */
export function planArtifacts(draftIds: readonly string[]): PlanArtifactVersion[] {
  const artifacts = new Set<string>();
  for (const draftId of draftIds) {
    const row = getChatPlanDraft(draftId);
    if (row) artifacts.add(row.artifactId ?? row.draftId);
  }
  return [...artifacts].flatMap((artifactId) =>
    listChatPlanDraftVersions(artifactId).flatMap((row): PlanArtifactVersion[] => {
      try {
        const stored = storedFromRecord(row);
        return [
          {
            draftId: stored.draftId,
            artifactId: stored.artifactId,
            version: stored.version,
            author: stored.author,
            name: stored.preview.name,
            createdAt: stored.createdAt,
            ...(stored.parentDraftId ? { parentDraftId: stored.parentDraftId } : {}),
            ...(stored.uploadedAt ? { uploadedAt: stored.uploadedAt } : {}),
            ...(stored.preview.editedAt ? { editedAt: stored.preview.editedAt } : {}),
            ...(stored.changeSummary ? { changeSummary: stored.changeSummary } : {})
          }
        ];
      } catch {
        return [];
      }
    })
  );
}

/** A version's plan — a workout's too, as a plan of one session. */
export function planDraftDocument(draftId: string): TrainingPlanDocument {
  const stored = loadStoredPlanDraft(draftId);
  if (!stored) {
    throw new Error("Training plan draft not found. Ask the coach to write the plan again.");
  }
  return draftDocument(stored);
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
  unitSystem: UnitSystem = "metric",
  replaceNewer = false
): Promise<PlanVersionSave> {
  const stored = requirePlanDraft(draftId);
  if (stored.uploadedAt) {
    throw new Error("This plan has already been saved, so the Coach card can no longer be edited.");
  }
  const newer = newerVersion(stored, replaceNewer);
  if (newer) return newer;
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
  return writeVersion(stored, next, { unitSystem, conflicts, author: "athlete" });
}

/**
 * The athlete's version of a one-off workout the coach drafted, from the
 * builder. The key, the day the coach suggested and whether it goes to the
 * library stay the coach's; the workout itself is the athlete's. Same draft id,
 * so the card is replaced in place, and `editedAt` restates it to the coach.
 */
export function saveWorkoutDraftEdit(
  draftId: string,
  workout: PlanWorkoutEntryInput,
  unitSystem: UnitSystem = "metric",
  replaceNewer = false
): PlanVersionSave {
  const stored = loadStoredPlanDraft(draftId);
  if (!stored) {
    throw new Error("Workout draft not found. Ask the coach to write it again.");
  }
  if (stored.preview.artifactType !== "workout") {
    throw new Error("This is a plan, not a single workout.");
  }
  if (stored.uploadedAt) {
    throw new Error("This workout has already been saved, so the Coach card can no longer be edited.");
  }
  const newer = newerVersion(stored, replaceNewer);
  if (newer) return newer;
  const original = stored.plan.workouts[0];
  if (!original) throw new Error("This workout draft holds no workout.");
  const {
    key: _key,
    schedule_date: _date,
    sort_no: _sort,
    save_to_library: _library,
    ...edited
  } = structuredClone(workout);
  const name = workout.name.trim() || original.name;
  const next: CorosTrainingPlanDraft = {
    ...stored.plan,
    name,
    workouts: [
      {
        ...edited,
        key: original.key,
        name,
        ...(original.sort_no !== undefined ? { sort_no: original.sort_no } : {}),
        ...(original.schedule_date ? { schedule_date: original.schedule_date } : {}),
        ...(original.save_to_library !== undefined ? { save_to_library: original.save_to_library } : {})
      } as PlanWorkoutEntry
    ]
  };
  const validation = validatePlanDraft(next, { todayDay: "00000000" });
  if (!validation.ok) throw new Error(validation.errors.join(" "));
  return writeVersion(stored, next, { unitSystem, conflicts: [], author: "athlete" });
}

/**
 * An older version made the newest again, by the athlete: a new version with
 * the old one's content, so nothing in between is lost and the step can be
 * undone the same way (docs/coach-plan-canvas.md, P1.4). Refused on a saved
 * creation, for the reason a revision is.
 */
export function restorePlanDraftVersion(
  draftId: string,
  unitSystem: UnitSystem = "metric"
): PlanVersionWritten {
  const older = loadStoredPlanDraft(draftId);
  if (!older) throw new Error("That version is no longer here.");
  const versions = versionsOf(older.artifactId);
  const latest = versions[versions.length - 1] ?? older;
  if (latest.draftId === older.draftId) {
    throw new Error("This is already the newest version.");
  }
  return writeVersion(latest, structuredClone(older.plan), {
    unitSystem,
    conflicts: [],
    author: "athlete",
    changeSummary: `Restored version ${older.version}`,
    // Written on top of the newest, whatever the athlete had open.
    edited: false
  });
}

/**
 * The newest version, when it is not `base` and the athlete has not chosen to
 * replace it: an edit begun on a version Coach has since revised would
 * otherwise drop that revision without anyone deciding to.
 */
function newerVersion(base: StoredPlanDraft, replaceNewer: boolean): PlanVersionConflict | undefined {
  if (replaceNewer) return undefined;
  const versions = versionsOf(base.artifactId);
  const latest = versions[versions.length - 1];
  if (!latest || latest.draftId === base.draftId) return undefined;
  return {
    kind: "conflict",
    newest: { draftId: latest.draftId, version: latest.version, author: latest.author }
  };
}

/**
 * The next version of `base`'s creation, with `plan` as its content. Always
 * written on top of the newest — which is `base` unless the athlete chose to
 * replace a newer one — so versions stay a line and "what changed" is read
 * against what the new one replaced.
 */
function writeVersion(
  base: StoredPlanDraft,
  plan: CorosTrainingPlanDraft,
  options: {
    unitSystem: UnitSystem;
    conflicts: string[];
    author: ChatPlanDraftAuthor;
    changeSummary?: string;
    /** Marks the card as the athlete's edit; a restore is not one. */
    edited?: boolean;
  }
): PlanVersionWritten {
  const versions = versionsOf(base.artifactId);
  if (versions.some((version) => version.uploadedAt) || base.uploadedAt) {
    throw new Error("This is already saved to COROS, so the Coach card can no longer be changed from here.");
  }
  const latest = versions[versions.length - 1] ?? base;
  const artifactType = base.preview.artifactType ?? "plan";
  const draftId = crypto.randomUUID();
  const preview = buildPlanPreview(draftId, plan, {
    scheduleConflicts: options.conflicts,
    unitSystem: options.unitSystem,
    artifactType
  });
  preview.conflicts = options.conflicts;
  // An existing field, and what the card's status and Coach's index read as
  // "edited by the athlete".
  if (options.edited !== false) preview.editedAt = Date.now();
  const stored: StoredPlanDraft = {
    draftId,
    plan,
    preview,
    createdAt: Math.max(Date.now(), latest.createdAt + 1),
    artifactId: latest.artifactId,
    version: latest.version + 1,
    parentDraftId: latest.draftId,
    author: options.author,
    ...(options.changeSummary ? { changeSummary: options.changeSummary } : {})
  };
  persistPlanDraft(stored);
  return {
    kind: "written",
    preview: lightPreview(preview),
    artifactId: stored.artifactId,
    fromVersion: latest.version,
    toVersion: stored.version,
    changes: planDiff(draftDocument(latest), draftDocument(stored)).map((change) => change.text)
  };
}

/**
 * A creation the athlete removed from the conversation before saving it: the
 * drafts go too — every version, or removing the newest would bring the one
 * before it back — rather than staying in the table for as long as the
 * conversation does. A saved one is refused — it is only hidden, because the
 * plan on COROS names its draft (`coach.draftId`).
 */
export function discardPlanDraft(draftId: string): void {
  const stored = loadStoredPlanDraft(draftId);
  if (!stored) return;
  const versions = versionsOf(stored.artifactId);
  if (stored.uploadedAt || versions.some((version) => version.uploadedAt)) {
    throw new Error("A saved creation is hidden, not removed.");
  }
  deletePlanDraftsOf([...new Set([draftId, ...versions.map((version) => version.draftId)])]);
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
