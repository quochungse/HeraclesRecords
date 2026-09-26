import crypto from "node:crypto";
import { handleRequestPlanBrief } from "./chatPlanBriefs";
import { PLAN_BRIEF_TOOL_DEFINITION } from "./planBrief";
import {
  buildPlanPreview,
  formatScheduleDay,
  validatePlanDraft,
  type CorosTrainingPlanDraft,
  type PlanWorkoutEntry
} from "./corosWorkoutBuilder";
import {
  listLibraryWorkouts,
  invalidateLibraryWorkoutPrograms,
  formatScheduledExercisesForChat,
  getTrainingHubStatus,
  listScheduledWorkoutEntries,
  resolveTrainingPlanExercises,
  searchWorkoutExercises,
  uploadTrainingPlan,
  PartialUploadError
} from "./trainingHubService";
import {
  deleteChatPlanDraft,
  findCachedRunningCorosPlan,
  findChatSessionMentioning,
  getChatPlanDraft,
  getCorosPlanCache,
  listTrainingActivityMatches,
  listChatPlanDraftVersions,
  markChatPlanDraftUploaded,
  saveChatPlanDraft,
  type ChatPlanDraftAuthor,
  type StoredChatPlanDraftRecord
} from "./database";
import { getNativeTrainingPlan, savePlanToCoros, setChatPlanReader } from "./trainingLibraryService";
import { isDeletedNativePlan, readNativeCorosPlanRaw } from "./corosTrainingPlanAdapter";
import {
  COROS_WEEK_STAGES,
  formatPlanDay,
  mondayOf,
  parsePlanDay,
  trainingPlanFromCoachDraftPreview
} from "./trainingPlanDomain";
import { generatedPlanProblems } from "./trainingPlanGeneration";
import { createScheduleChangeSet, type NewScheduleChangeLine } from "./chatScheduleChanges";
import { CHAT_PLAN_TOOL_NAMES, getChatPlanTools, handleChatPlanTool, isChatPlanTool } from "./chatPlanTools";
import { planDiff, sameWorkoutInput } from "./planDiff";
import {
  PLAN_DAYS,
  PLAN_REVISION_OPS,
  applyPlanRevision,
  planAsDraftArgs
} from "./planRevision";
import type {
  CorosMcpTool,
  CorosTrainingPlanDraftInput,
  PlanArtifactVersion,
  PlanCalendarState,
  PlanCorosSync,
  PlanDraftPreview,
  PlanDraftSaveOptions,
  PlanBrief,
  PlanEvent,
  PlanWorkoutEntryInput,
  PlanVersionConflict,
  PlanVersionSave,
  PlanVersionWritten,
  TrainingPlanDestination,
  TrainingPlanDocument,
  TrainingPlanEntry,
  TrainingPlanGenerationRequest,
  TrainingPlanWeekStage,
  UploadPlanResult,
  ScheduleChangeSet,
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
  /** Follow-ups Coach offered with this version, as chips (P1.8). */
  refinements?: string[];
  /**
   * The plan with its COROS identity — the plan id and version, and each
   * session's `idInPlan` and untouched program — once the creation is on
   * COROS (P1.6). Otherwise the document is derived from `plan` whenever it
   * is read.
   */
  document?: TrainingPlanDocument;
  /** `plan` as it was when `document` was written; see `draftDocument`. */
  documentPlanHash?: string;
}

/**
 * Coach's follow-ups for a version (P1.8): two to four, each short enough to
 * be a chip, none repeated. Anything else is left out rather than trimmed into
 * something Coach did not say.
 */
export function refinementsFrom(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const seen = new Set<string>();
  const chips = value.flatMap((item) => {
    const text = typeof item === "string" ? item.trim().replace(/\s+/g, " ") : "";
    if (!text || text.length > 40 || seen.has(text.toLowerCase())) return [];
    seen.add(text.toLowerCase());
    return [text];
  });
  return chips.length >= 2 ? chips.slice(0, 4) : undefined;
}

function refinementsOf(json: string | undefined): string[] | undefined {
  if (!json) return undefined;
  try {
    return refinementsFrom(JSON.parse(json));
  } catch {
    return undefined;
  }
}

/** A fingerprint of a stored plan, to tell whether `document` still describes it. */
function planHash(plan: CorosTrainingPlanDraft): string {
  return crypto.createHash("sha256").update(JSON.stringify(plan)).digest("hex").slice(0, 16);
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

interface DeleteWorkoutParams {
  target: "scheduled" | "library" | "both";
  schedule_date?: string;
  workout_name?: string;
  program_id?: string;
  plan_id?: string;
  id_in_plan?: string;
  plan_program_id?: string;
}

/**
 * Creations with a save to COROS in flight. The "already saved" check reads
 * the row, and two saves begun before either writes both pass it — a
 * double press, or the card and the canvas at once — and would each `plan/add`
 * a plan. Keyed by creation, since every version of one saves the same plan.
 */
const savingArtifacts = new Set<string>();

/** What a save COROS stopped part-way through had already written, by draft. */
const partialWrites = new Map<
  string,
  { entries: UploadPlanResult["entries"]; workoutsCreated: number; workoutsScheduled: number }
>();

function persistPlanDraft(stored: StoredPlanDraft): void {
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
    ...(stored.refinements?.length ? { refinementsJson: JSON.stringify(stored.refinements) } : {}),
    documentJson: JSON.stringify({
      planHash: stored.document ? stored.documentPlanHash ?? planHash(stored.plan) : planHash(stored.plan),
      document: draftDocument(stored)
    })
  });
}

function storedFromRecord(row: StoredChatPlanDraftRecord): StoredPlanDraft {
  const preview = JSON.parse(row.previewJson) as PlanDraftPreview;
  // Kept only when it carries a COROS identity: a document derived from the
  // plan is derived again on every read, which is what lets an older build's
  // in-place edit of `plan_json` show.
  let document: TrainingPlanDocument | undefined;
  let documentPlanHash: string | undefined;
  if (row.documentJson) {
    try {
      const parsed = JSON.parse(row.documentJson) as
        | { planHash?: string; document?: TrainingPlanDocument }
        | TrainingPlanDocument;
      const candidate = "document" in parsed && parsed.document ? parsed.document : (parsed as TrainingPlanDocument);
      if (candidate?.remoteId || row.author === "coros") {
        document = candidate;
        documentPlanHash = "planHash" in parsed ? parsed.planHash : undefined;
      }
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
    ...(refinementsOf(row.refinementsJson) ? { refinements: refinementsOf(row.refinementsJson) } : {}),
    ...(document ? { document } : {}),
    ...(documentPlanHash ? { documentPlanHash } : {})
  };
}

/**
 * A draft as its row holds it now. Read every time, never from a copy held in
 * memory: a row changes behind this process's back — another machine saves
 * the creation to COROS and the pull marks it uploaded — and a copy taken
 * before would let this machine save it again as a second plan.
 */
function loadStoredPlanDraft(draftId: string): StoredPlanDraft | undefined {
  const row = getChatPlanDraft(draftId);
  if (!row) {
    return undefined;
  }
  try {
    return storedFromRecord(row);
  } catch {
    return undefined;
  }
}

// A Coach creation is read by the Library's calendar preview as `chat:<draftId>`.
setChatPlanReader((draftId) => planDraftDocument(draftId));

export const CHAT_WORKOUT_TOOL_NAMES = [
  "search_coros_exercises",
  "draft_workout",
  "draft_training_plan",
  "revise_training_plan",
  "get_plan_draft",
  "request_plan_brief",
  "list_scheduled_workouts",
  "delete_workout",
  "propose_schedule_changes",
  ...CHAT_PLAN_TOOL_NAMES
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
      inputSchema: withRefinements(buildDraftWorkoutInputSchema())
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
      inputSchema: buildRevisePlanToolSchema()
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
        "Stage a workout deletion for the athlete to apply. " +
        "Shows a card with a Remove or Delete button under your reply — never deletes directly. " +
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

    },
    {
      name: "propose_schedule_changes",
      description:
        "Propose changes to the athlete's calendar for them to apply: move a session to another day, replace its workout, " +
        "remove it, or add a new one — several at once, e.g. to rearrange a week. Nothing is written: the athlete applies " +
        "each line, or all of them, from the card under your reply. Name sessions by plan_id, id_in_plan and date from " +
        "list_scheduled_workouts (or calendar_plan_id from get_training_plan). A session of a plan on the calendar stays " +
        "in its plan when moved or replaced. Every line is checked now; a refusal lists every problem and nothing is kept.",
      inputSchema: {
        type: "object",
        properties: {
          summary: { type: "string", description: "What the changes are for, in a few words (the card's title)." },
          changes: {
            type: "array",
            minItems: 1,
            maxItems: MAX_SCHEDULE_CHANGES,
            items: {
              type: "object",
              properties: {
                op: { type: "string", enum: ["move", "replace", "remove", "add"] },
                session: {
                  type: "object",
                  description: "The session a move, replace or remove acts on.",
                  properties: {
                    plan_id: { type: "string" },
                    id_in_plan: { type: "string" },
                    date: { type: "string", description: "YYYYMMDD, the day it is on now." }
                  },
                  required: ["plan_id", "id_in_plan", "date"]
                },
                to_date: { type: "string", description: "YYYYMMDD: where a move goes, or the day an add lands on." },
                workout: {
                  type: "object",
                  description:
                    "For replace and add: one workout in draft_workout's workout shape (name, sport, steps …). " +
                    "Strength and Hybrid Fitness need exact COROS exercise ids from search_coros_exercises."
                }
              },
              required: ["op"]
            }
          }
        },
        required: ["summary", "changes"]
      }
    },
    PLAN_BRIEF_TOOL_DEFINITION,
    ...getChatPlanTools()
  ];
}

export async function handleChatWorkoutTool(
  name: ChatWorkoutToolName,
  args: Record<string, unknown>,
  options?: {
    onPlanDraft?: (preview: PlanDraftPreview) => void;
    /** A creation changed on COROS was read in before Coach changed it (P1.6). */
    onPlanEvent?: (event: PlanEvent) => void;
    /** Coach set out a brief (P2.1). */
    onPlanBrief?: (brief: PlanBrief) => void;
    /** The conversation the turn is in, which a brief belongs to. */
    sessionId?: string;
    /** Coach staged a change to the calendar or the library (P3.2). */
    onScheduleChange?: (changeSet: ScheduleChangeSet) => void;
    allowUpcomingWorkouts?: boolean;
    unitSystem?: UnitSystem;
    /**
     * Set while a conversation's sessions step runs (P2.3): a draft is checked
     * against the brief and its outline and handed back to the model when it
     * departs from them, and one that passes is written as the first version
     * of the brief's artifact, `planArtifactId`.
     */
    planRequest?: TrainingPlanGenerationRequest;
    planArtifactId?: string;
    /** False when the conversation has not shared the athlete's activities (P3.1). */
    progress?: boolean;
  }
): Promise<string> {
  if (isChatPlanTool(name)) {
    return handleChatPlanTool(name, args, {
      progress: options?.progress,
      sessionId: options?.sessionId,
      unitSystem: options?.unitSystem
    });
  }
  if (name === "draft_training_plan") {
    return handleDraftTrainingPlan(
      args,
      options?.onPlanDraft,
      options?.allowUpcomingWorkouts !== false,
      options?.unitSystem ?? "metric",
      "plan",
      options?.planRequest,
      options?.onPlanEvent,
      options?.planArtifactId
    );
  }
  if (name === "request_plan_brief") {
    return handleRequestPlanBrief(args, options?.sessionId, options?.onPlanBrief);
  }
  if (name === "get_plan_draft") {
    return handleGetPlanDraft(args);
  }
  if (name === "revise_training_plan") {
    return handleRevisePlan(
      args,
      options?.onPlanDraft,
      options?.allowUpcomingWorkouts !== false,
      options?.unitSystem ?? "metric",
      options?.onPlanEvent
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
  if (name === "list_scheduled_workouts") {
    return handleListScheduledWorkouts(args, options?.unitSystem ?? "metric");
  }
  if (name === "propose_schedule_changes") {
    return handleProposeScheduleChanges(args, options?.sessionId, options?.unitSystem ?? "metric", options?.onScheduleChange);
  }
  return handleDeleteWorkout(args, options?.sessionId, options?.onScheduleChange);
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
      }],
      ...(args.suggested_refinements ? { suggested_refinements: args.suggested_refinements } : {})
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
  planRequest?: TrainingPlanGenerationRequest,
  onPlanEvent?: (event: PlanEvent) => void,
  planArtifactId?: string
): Promise<string> {
  /* A rewrite of a plan already drafted is a version of it, not a new card;
     asked before anything is checked, since a stale id is refused anyway. */
  const revises = !planRequest && artifactType === "plan" ? String(args.revises ?? "").trim() : "";
  const synced = revises ? await syncForRevision(revises, unitSystem, onPlanDraft, onPlanEvent) : undefined;
  const target = revises ? revisionTarget(synced ?? revises, "plan") : undefined;
  if (target && !target.ok) return target.response;

  const prepared = await prepareDraft(args, {
    allowUpcomingWorkouts,
    planRequest,
    retryTool: artifactType === "workout" ? "draft_workout" : "draft_training_plan"
  });
  if (!prepared.ok) return prepared.response;

  const refinements = refinementsFrom(args.suggested_refinements);
  if (target?.ok) {
    return storeRevision(target.latest, prepared, unitSystem, "Rewritten by Coach.", onPlanDraft, refinements);
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
    author: "coach",
    ...(refinements ? { refinements } : {})
  };
  if (planRequest) {
    // The sessions step (P2.3): version 1 of the brief's artifact. The step
    // starts only on a brief with no version, so one already here is this
    // turn's own earlier hand-over, and a second accepted draft replaces it.
    // The outline the athlete accepted states each week's stage.
    const artifactId = planArtifactId ?? draftId;
    const earlier = versionsOf(artifactId).at(-1);
    stored.draftId = earlier?.draftId ?? draftId;
    stored.preview = { ...preview, draftId: stored.draftId };
    stored.artifactId = artifactId;
    if (planRequest.outline) {
      stored.plan = {
        ...stored.plan,
        weekStages: planRequest.outline.weeks.flatMap((week, weekIndex) =>
          week.stage > 0 ? [{ weekIndex, stage: week.stage }] : []
        )
      };
    }
    persistPlanDraft(stored);
    onPlanDraft?.(lightPreview(stored.preview));
    return JSON.stringify({
      ok: true,
      draft_id: stored.draftId,
      message:
        "Plan accepted and shown to the athlete as a card, week by week, to read, edit, save or put on the calendar. Reply with a two-sentence summary of it and nothing else; do not list the sessions."
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

/**
 * A new version of a creation on COROS keeps the plan's identity, so saving it
 * updates that plan. Nothing is done for one that is not there.
 */
function withCorosIdentityOf(stored: StoredPlanDraft, base: StoredPlanDraft, edited?: TrainingPlanDocument): void {
  const baseDocument = draftDocument(base);
  if (!baseDocument.remoteId) return;
  const baseWorkouts = new Map<string, PlanWorkoutEntryInput>(
    base.plan.workouts.map((workout) => [workout.key, workoutSource(workout)])
  );
  stored.document = edited
    ? // A document read from COROS is its own authority on the plan's version.
      edited.remoteId === baseDocument.remoteId && (edited.remoteVersion ?? -1) > (baseDocument.remoteVersion ?? -1)
      ? edited
      : { ...carryCorosIdentity(edited, baseDocument), entries: edited.entries }
    : carryCorosIdentity(coachDraftDocument(stored), baseDocument, baseWorkouts);
  stored.documentPlanHash = planHash(stored.plan);
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
  // A plan on COROS is revised into a version that updates it (P1.6); a
  // workout saved to the library or the calendar has nothing to update, so a
  // change to it would be a second workout.
  if (named.preview.artifactType === "workout" && versions.some((version) => version.uploadedAt)) {
    return refuse({
      error_code: "draft_saved",
      errors: [
        "This workout is already saved to COROS. Draft a new one with draft_workout if the athlete wants a different session."
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
  onPlanDraft?: (preview: PlanDraftPreview) => void,
  refinements?: string[]
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
    changeSummary,
    ...(refinements ? { refinements } : {})
  };
  withCorosIdentityOf(stored, latest);
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
  unitSystem: UnitSystem,
  onPlanEvent?: (event: PlanEvent) => void
): Promise<string> {
  const draftId = String(args.draft_id ?? "").trim();
  const summary = String(args.summary ?? "").trim();
  if (!draftId || !summary) {
    return JSON.stringify({ ok: false, errors: ["draft_id, ops and summary are required."] });
  }
  const synced = await syncForRevision(draftId, unitSystem, onPlanDraft, onPlanEvent);
  const target = revisionTarget(synced ?? draftId);
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
  const answer = storeRevision(
    target.latest,
    prepared,
    unitSystem,
    summary.slice(0, 200),
    onPlanDraft,
    refinementsFrom(args.suggested_refinements)
  );
  if (!synced) return answer;
  // Said to the model, which named the version before COROS's: its changes
  // went onto what the athlete has on COROS now.
  return JSON.stringify({
    ...JSON.parse(answer),
    note: "The plan had changed on COROS since you last read it; that version was brought in first, and your changes were applied to it. Mention this."
  });
}

/**
 * Before Coach changes a creation on COROS, the creation is read against
 * COROS (D12): a change made there becomes its newest version, shown to the
 * athlete as a line and a card, and Coach's change goes on top of it. Answers
 * the new version's id when there is one. A COROS that cannot be reached
 * changes nothing here — the update is checked against COROS again when it is
 * saved.
 */
async function syncForRevision(
  draftId: string,
  unitSystem: UnitSystem,
  onPlanDraft?: (preview: PlanDraftPreview) => void,
  onPlanEvent?: (event: PlanEvent) => void
): Promise<string | undefined> {
  let sync: PlanCorosSync;
  try {
    const named = loadStoredPlanDraft(draftId);
    if (!named) return undefined;
    const versions = versionsOf(named.artifactId);
    if ((versions[versions.length - 1]?.draftId ?? named.draftId) !== named.draftId) return undefined;
    sync = await syncPlanDraftFromCoros(draftId, unitSystem);
  } catch {
    return undefined;
  }
  if (sync.kind === "current") return undefined;
  onPlanEvent?.(corosEvent(sync.kind === "imported" ? "imported" : "removedOnCoros", sync.written));
  onPlanDraft?.(sync.written.preview);
  return sync.written.preview.draftId;
}

/** The line a change found on COROS leaves in the conversation. */
export function corosEvent(action: "imported" | "removedOnCoros", written: PlanVersionWritten): PlanEvent {
  return {
    eventId: crypto.randomUUID(),
    artifactId: written.artifactId,
    draftId: written.preview.draftId,
    action,
    author: "coros",
    name: written.preview.name,
    artifactType: written.preview.artifactType === "workout" ? "workout" : "plan",
    fromVersion: written.fromVersion,
    toVersion: written.toVersion,
    ...(written.changes.length ? { changes: written.changes } : {}),
    at: Date.now()
  };
}

/**
 * A creation on COROS read against COROS (P1.6, D12). Only when its newest
 * version is the one saved there: a newer version not saved yet is a change
 * the athlete has not sent, and it is checked against COROS when it is sent —
 * bringing COROS's copy in on top of it here would put it out of sight.
 *
 * `cacheOnly` asks the plan cache instead, which costs nothing: what the
 * canvas does on opening. Otherwise it is one request (the raw detail and its
 * version), and a second only when COROS is newer, to read it as a plan.
 */
/**
 * Reads against COROS in flight, by creation. The canvas opening and an edit
 * begun at the same moment both ask, and two reads that each find COROS newer
 * would each write the same "Changed in the Library" version; the second
 * caller shares the first one's answer instead.
 */
const corosSyncsInFlight = new Map<string, Promise<PlanCorosSync>>();

export async function syncPlanDraftFromCoros(
  draftId: string,
  unitSystem: UnitSystem = "metric",
  options: { cacheOnly?: boolean } = {}
): Promise<PlanCorosSync> {
  const named = loadStoredPlanDraft(draftId);
  if (!named || named.preview.artifactType === "workout") return { kind: "current" };
  const running = corosSyncsInFlight.get(named.artifactId);
  if (running) return running;
  const sync = readPlanDraftFromCoros(named, unitSystem, options).finally(() => {
    corosSyncsInFlight.delete(named.artifactId);
  });
  corosSyncsInFlight.set(named.artifactId, sync);
  return sync;
}

async function readPlanDraftFromCoros(
  named: StoredPlanDraft,
  unitSystem: UnitSystem,
  { cacheOnly = false }: { cacheOnly?: boolean }
): Promise<PlanCorosSync> {
  const versions = versionsOf(named.artifactId);
  const latest = versions[versions.length - 1] ?? named;
  if (!latest.uploadedAt) return { kind: "current" };
  const held = draftDocument(latest);
  if (!held.remoteId) return { kind: "current" };
  const heldVersion = held.remoteVersion ?? -1;

  if (cacheOnly) {
    const cached = getCorosPlanCache(held.remoteId);
    if (!cached || (cached.remoteVersion ?? -1) <= heldVersion) return { kind: "current" };
  }
  const raw = await readNativeCorosPlanRaw(held.remoteId);
  if (isDeletedNativePlan(raw)) {
    return {
      kind: "removedOnCoros",
      written: writeVersion(latest, structuredClone(latest.plan), {
        unitSystem,
        conflicts: [],
        author: "coros",
        changeSummary: "Deleted on COROS",
        edited: false,
        detach: true
      })
    };
  }
  const remoteVersion = Number((raw as Record<string, unknown>).version);
  if (!Number.isFinite(remoteVersion) || remoteVersion <= heldVersion) return { kind: "current" };

  const imported = keyedAsSent(await getNativeTrainingPlan(held.remoteId), held);
  const { next } = planFromDocument(imported, latest);
  return {
    kind: "imported",
    written: writeVersion(latest, next, {
      unitSystem,
      conflicts: [],
      author: "coros",
      changeSummary: "Changed in the Library",
      edited: false,
      document: imported,
      savedAs: {
        planName: imported.name,
        workoutsCreated: imported.entries.length,
        workoutsScheduled: 0,
        entries: [],
        destination: "nativePlan",
        planId: `coros:${held.remoteId}`
      }
    })
  };
}

/** `draft_training_plan`'s schema, with the one field a rewrite adds. */
/** The optional follow-ups field (P1.8), the same on every tool that makes a version. */
const SUGGESTED_REFINEMENTS = {
  type: "array",
  minItems: 2,
  maxItems: 4,
  items: { type: "string", maxLength: 40 },
  description:
    "Optional: 2–4 short follow-ups the athlete might want next, each under 40 characters and in the athlete's words (e.g. \"Lighter week 3\", \"Long run on Sunday\"). Shown as buttons under the card."
};

function withRefinements(schema: Record<string, unknown>): Record<string, unknown> {
  return {
    ...schema,
    properties: { ...((schema.properties ?? {}) as Record<string, unknown>), suggested_refinements: SUGGESTED_REFINEMENTS }
  };
}

function withRevises(schema: Record<string, unknown>): Record<string, unknown> {
  const properties = (schema.properties ?? {}) as Record<string, unknown>;
  return {
    ...schema,
    properties: {
      ...properties,
      suggested_refinements: SUGGESTED_REFINEMENTS,
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

export function buildRevisePlanToolSchema(): Record<string, unknown> {
  return withRefinements(buildRevisePlanInputSchema());
}

async function handleListScheduledWorkouts(
  args: Record<string, unknown>,
  unitSystem: UnitSystem
): Promise<string> {
  const planNames = runningPlanNames();
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
      // A session of a plan running on the calendar, as the Library last read it (P3.3).
      ...(planNames(entry.planId) ? { in_plan: planNames(entry.planId) } : {}),
      plan_program_id: entry.planProgramId,
      program_id: entry.programId,
      sort_no: entry.sortNo
    }))
  });
}

/** A running plan's name by calendar `planId`, each plan read from the cache once per call. */
function runningPlanNames(): (planId: string) => string | undefined {
  const names = new Map<string, string | undefined>();
  return (planId) => {
    if (!names.has(planId)) {
      const plan = getCorosPlanCache(planId);
      names.set(planId, plan?.calendar === "running" ? plan.name : undefined);
    }
    return names.get(planId);
  };
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

/**
 * A deletion Coach stages is a change set of its own (P3.2): a line for the
 * calendar session, a line for the library workout, or both — kept in
 * `chat_schedule_changes`, so the card outlives a restart and is applied from
 * either machine, each line checked against COROS again first.
 */
async function handleDeleteWorkout(
  args: Record<string, unknown>,
  sessionId: string | undefined,
  onScheduleChange?: (changeSet: ScheduleChangeSet) => void
): Promise<string> {
  try {
    const params = parseDeleteWorkoutParams(args);
    const lines = await deleteLines(params);
    const changeSet = createScheduleChangeSet({
      ...(sessionId ? { sessionId } : {}),
      summary: lines.length === 1 ? lines[0].label : "Delete a workout",
      lines
    });
    onScheduleChange?.(changeSet);
    return JSON.stringify({
      ok: true,
      change_set_id: changeSet.changeSetId,
      lines: changeSet.lines.map((line) => line.label),
      message:
        "Staged for the athlete: the card under your reply has an Apply button. " +
        "Nothing is deleted until they apply it; do not say it was removed."
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

const MAX_SCHEDULE_CHANGES = 20;
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** `Sat 27 Sep`, as a card line reads. */
function cardDay(day: string): string {
  const date = parsePlanDay(day);
  return date ? `${DAY_NAMES[date.getDay()]} ${date.getDate()} ${MONTH_NAMES[date.getMonth()]}` : day;
}

function normalizedDay(value: unknown): string | undefined {
  const day = typeof value === "string" ? value.replace(/-/g, "").trim() : "";
  return /^\d{8}$/.test(day) && parsePlanDay(day) ? day : undefined;
}

/**
 * Coach's proposal to rearrange the calendar (P3.3): checked line by line now
 * — the session is there, no day has passed, a workout is one COROS takes —
 * and kept as a change set for the athlete to apply. The checks are handed
 * back to the model as the draft tools hand theirs, every problem at once.
 */
async function handleProposeScheduleChanges(
  args: Record<string, unknown>,
  sessionId: string | undefined,
  unitSystem: UnitSystem,
  onScheduleChange?: (changeSet: ScheduleChangeSet) => void
): Promise<string> {
  const summary = String(args.summary ?? "").trim();
  const raw = Array.isArray(args.changes) ? args.changes : [];
  const refuse = (errors: string[]) =>
    JSON.stringify({
      ok: false,
      errors,
      action: "Fix every problem listed and call propose_schedule_changes again with all the changes. Nothing was kept."
    });
  if (!summary) return refuse(["summary is required."]);
  if (!raw.length) return refuse(["changes needs at least one change."]);
  if (raw.length > MAX_SCHEDULE_CHANGES) return refuse([`At most ${MAX_SCHEDULE_CHANGES} changes at once.`]);

  const today = formatScheduleDay(new Date());
  const errors: string[] = [];
  const changes = raw.map((item) => (item && typeof item === "object" ? (item as Record<string, unknown>) : {}));

  // The calendar is read once, over every day a change names: a session's
  // day, and the day an addition lands on.
  const sessionDays = changes.flatMap((change) => {
    const day = normalizedDay((change.session as Record<string, unknown> | undefined)?.date);
    const addDay = change.op === "add" ? normalizedDay(change.to_date) : undefined;
    return [day, addDay].filter((item): item is string => Boolean(item));
  });
  let calendar: Awaited<ReturnType<typeof listScheduledWorkoutEntries>> = [];
  if (sessionDays.length) {
    const sorted = [...sessionDays].sort();
    try {
      calendar = await listScheduledWorkoutEntries(sorted[0], sorted[sorted.length - 1]);
    } catch (caught) {
      return JSON.stringify({
        ok: false,
        errors: [`The calendar could not be read: ${caught instanceof Error ? caught.message : String(caught)}`]
      });
    }
  }

  const seen = new Set<string>();
  const lines: NewScheduleChangeLine[] = [];
  for (const [index, change] of changes.entries()) {
    const at = `changes[${index}]`;
    const op = String(change.op ?? "");
    if (!["move", "replace", "remove", "add"].includes(op)) {
      errors.push(`${at}: op must be move, replace, remove or add.`);
      continue;
    }

    let entry: (typeof calendar)[number] | undefined;
    let sessionKey: string | undefined;
    if (op !== "add") {
      const ref = (change.session ?? {}) as Record<string, unknown>;
      const planId = String(ref.plan_id ?? "").trim();
      const idInPlan = String(ref.id_in_plan ?? "").trim();
      const day = normalizedDay(ref.date);
      if (!planId || !idInPlan || !day) {
        errors.push(`${at}: session needs plan_id, id_in_plan and date (YYYYMMDD).`);
        continue;
      }
      entry = calendar.find((candidate) => candidate.planId === planId && candidate.idInPlan === idInPlan && candidate.happenDay === day);
      if (!entry) {
        errors.push(`${at}: no session #${idInPlan} of plan ${planId} on ${day}. Read it with list_scheduled_workouts.`);
        continue;
      }
      if (day < today) {
        errors.push(`${at}: "${entry.name}" was on ${day}, which has passed.`);
        continue;
      }
      sessionKey = `${planId}:${idInPlan}`;
      if (seen.has(sessionKey)) {
        errors.push(`${at}: "${entry.name}" is already changed by another line; one change per session.`);
        continue;
      }
    }

    let toDay: string | undefined;
    if (op === "move" || op === "add") {
      toDay = normalizedDay(change.to_date);
      if (!toDay) {
        errors.push(`${at}: to_date (YYYYMMDD) is required for ${op}.`);
        continue;
      }
      if (toDay < today) {
        errors.push(`${at}: ${toDay} has passed; COROS takes no workout before today.`);
        continue;
      }
      if (op === "move" && toDay === entry!.happenDay) {
        errors.push(`${at}: "${entry!.name}" is already on ${toDay}.`);
        continue;
      }
      // A plan's session moves inside its running copy, which counts from its first Monday.
      const copy = op === "move" ? getCorosPlanCache(entry!.planId) : undefined;
      const firstMonday = copy?.calendar === "running" ? copy.startDate?.replace(/-/g, "") : undefined;
      if (firstMonday && toDay < firstMonday) {
        errors.push(`${at}: "${entry!.name}" is a session of "${copy!.name}", which starts on ${firstMonday}; it cannot move before that.`);
        continue;
      }
    }

    let workout: PlanWorkoutEntryInput | undefined;
    if (op === "replace" || op === "add") {
      const checked = await checkedWorkout(change.workout, toDay ?? entry!.happenDay);
      if (!checked.ok) {
        errors.push(...checked.errors.map((error) => `${at}: ${error}`));
        continue;
      }
      workout = checked.workout;
    }

    if (sessionKey) seen.add(sessionKey);
    const plan = entry ? getCorosPlanCache(entry.planId) : undefined;
    const inPlan = plan?.calendar === "running" ? ` (${plan.name})` : "";
    const session = entry
      ? {
          planId: entry.planId,
          idInPlan: entry.idInPlan,
          happenDay: entry.happenDay,
          name: entry.name,
          ...(entry.planProgramId ? { planProgramId: entry.planProgramId } : {}),
          ...(entry.programId ? { programId: entry.programId } : {}),
          ...(entry.sportType !== undefined ? { sportType: entry.sportType } : {})
        }
      : undefined;
    if (op === "move") {
      lines.push({ op, label: `Move "${entry!.name}"${inPlan} from ${cardDay(entry!.happenDay)} to ${cardDay(toDay!)}`, session, toDay });
    } else if (op === "replace") {
      lines.push({ op, label: `Replace "${entry!.name}"${inPlan} on ${cardDay(entry!.happenDay)} with "${workout!.name}"`, session, workout });
    } else if (op === "remove") {
      lines.push({ op, label: `Remove "${entry!.name}"${inPlan} from ${cardDay(entry!.happenDay)}`, session });
    } else {
      // How many sessions of this name the day holds already, so applying can
      // tell the line landing elsewhere from an ordinary double day.
      const sameName = calendar.filter((item) => item.happenDay === toDay && item.name === workout!.name).length;
      lines.push({ op: "add", label: `Add "${workout!.name}" on ${cardDay(toDay!)}`, toDay, workout, sameNameOnDay: sameName });
    }
  }
  if (errors.length) return refuse(errors.slice(0, 20));

  const changeSet = createScheduleChangeSet({
    ...(sessionId ? { sessionId } : {}),
    summary,
    lines,
    unitSystem
  });
  onScheduleChange?.(changeSet);
  return JSON.stringify({
    ok: true,
    change_set_id: changeSet.changeSetId,
    lines: changeSet.lines.map((line) => line.label),
    message:
      "Proposed to the athlete: the card under your reply lets them apply each change or all of them. " +
      "Nothing has changed on the calendar yet; do not say it has."
  });
}

/** One workout checked as draft_workout checks it, with its exercises resolved to COROS's ids. */
async function checkedWorkout(
  value: unknown,
  day: string
): Promise<{ ok: true; workout: PlanWorkoutEntryInput } | { ok: false; errors: string[] }> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, errors: ["workout is required for replace and add."] };
  }
  const input = value as Record<string, unknown>;
  const draft = toPlanDraft({
    name: String(input.name ?? "").trim() || "Workout",
    workouts: [{ ...input, key: "w1", schedule_date: day, save_to_library: false }]
  });
  const validation = validatePlanDraft(draft, { todayDay: formatScheduleDay(new Date()) });
  if (!validation.ok) return { ok: false, errors: validation.errors };
  const resolution = await resolveTrainingPlanExercises(draft);
  if (resolution.issues.length) {
    return {
      ok: false,
      errors: resolution.issues.map(
        (issue) =>
          `${issue.message}${issue.candidates.length ? ` Candidates: ${issue.candidates.join("; ")}.` : " Call search_coros_exercises."}`
      )
    };
  }
  const { schedule_date: _day, key: _key, ...workout } = workoutSource(resolution.draft.workouts[0]!);
  return { ok: true, workout: { ...workout, key: "w1" } };
}

/** The lines a deletion comes to, each naming what it acts on as COROS holds it now. */
async function deleteLines(params: DeleteWorkoutParams): Promise<NewScheduleChangeLine[]> {
  const lines: NewScheduleChangeLine[] = [];
  let scheduledName: string | undefined;

  if (params.target === "scheduled" || params.target === "both") {
    let scheduleEntry: Awaited<ReturnType<typeof listScheduledWorkoutEntries>>[number] | undefined;
    const scheduleDate = params.schedule_date;
    if (params.plan_id && params.id_in_plan) {
      const entries = scheduleDate
        ? await listScheduledWorkoutEntries(scheduleDate, scheduleDate)
        : await listScheduledWorkoutEntries(
            formatScheduleDay(new Date()),
            formatScheduleDay(new Date(Date.now() + 365 * 24 * 60 * 60 * 1000))
          );
      scheduleEntry = entries.find(
        (entry) => entry.planId === params.plan_id && entry.idInPlan === params.id_in_plan
      );
    } else if (scheduleDate && params.workout_name) {
      const entries = await listScheduledWorkoutEntries(scheduleDate, scheduleDate);
      const matches = entries.filter((entry) => entry.name === params.workout_name);
      if (matches.length > 1) {
        throw new Error(
          `Multiple scheduled workouts named "${params.workout_name}" on ${scheduleDate}. ` +
            "Use plan_id and id_in_plan to disambiguate."
        );
      }
      scheduleEntry = matches[0];
    }
    if (!scheduleEntry) {
      throw new Error("Scheduled workout not found on COROS calendar.");
    }
    scheduledName = scheduleEntry.name;
    lines.push({
      op: "remove",
      label: `Remove "${scheduleEntry.name}" from the calendar on ${formatDisplayScheduleDate(scheduleEntry.happenDay)}`,
      session: {
        planId: scheduleEntry.planId,
        idInPlan: scheduleEntry.idInPlan,
        happenDay: scheduleEntry.happenDay,
        name: scheduleEntry.name,
        ...(scheduleEntry.planProgramId ? { planProgramId: scheduleEntry.planProgramId } : {}),
        ...(scheduleEntry.programId ? { programId: scheduleEntry.programId } : {}),
        ...(scheduleEntry.sportType !== undefined ? { sportType: scheduleEntry.sportType } : {})
      }
    });
  }

  if (params.target === "library" || params.target === "both") {
    // Read afresh: the list is cached for minutes, and a workout saved since is what Coach may name.
    invalidateLibraryWorkoutPrograms();
    const library = await listLibraryWorkouts();
    const name = params.workout_name ?? scheduledName;
    let found = params.program_id ? library.find((workout) => workout.id === params.program_id) : undefined;
    if (!found && name) {
      const named = library.filter((workout) => workout.name.trim().toLowerCase() === name.trim().toLowerCase());
      if (named.length > 1) {
        throw new Error(`Several library workouts are named "${name}". Pass program_id to say which.`);
      }
      found = named[0];
    }
    if (found) {
      lines.push({
        op: "deleteWorkout",
        label: `Delete "${found.name}" from the workout library`,
        program: { id: found.id, name: found.name }
      });
    } else if (params.target === "library") {
      throw new Error("Library workout not found.");
    }
  }
  return lines;
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
  keepInLibrary = false,
  options: PlanDraftSaveOptions = {}
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
  if (savingArtifacts.has(stored.artifactId)) {
    throw new Error("This creation is already being saved to COROS.");
  }
  savingArtifacts.add(stored.artifactId);
  try {
    return await saveDraftTo(stored, unitSystem, destination, scheduleDate, keepInLibrary, options);
  } finally {
    savingArtifacts.delete(stored.artifactId);
  }
}

async function saveDraftTo(
  stored: StoredPlanDraft,
  unitSystem: UnitSystem,
  destination: TrainingPlanDestination,
  scheduleDate: string | undefined,
  keepInLibrary: boolean,
  options: PlanDraftSaveOptions
): Promise<UploadPlanResult> {
  if (destination === "nativePlan") {
    return savePlanDraftAsCorosPlan(stored, unitSystem, options);
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
  // Sessions an earlier attempt wrote before COROS stopped are not written
  // again: that attempt told the athlete they were there, and a retry adds
  // only the rest. Held for this run of the app; the message said what landed.
  const earlier = partialWrites.get(stored.draftId);
  const remaining = earlier
    ? { ...input, workouts: input.workouts.filter((workout) => !earlier.entries.some((entry) => entry.key === workout.key)) }
    : input;
  let uploaded: UploadPlanResult;
  try {
    uploaded = await uploadTrainingPlan(remaining, unitSystem);
  } catch (cause) {
    if (!(cause instanceof PartialUploadError)) throw cause;
    const held = {
      entries: [...(earlier?.entries ?? []), ...cause.written],
      workoutsCreated: (earlier?.workoutsCreated ?? 0) + cause.workoutsCreated,
      workoutsScheduled: (earlier?.workoutsScheduled ?? 0) + cause.workoutsScheduled
    };
    partialWrites.set(stored.draftId, held);
    const names = cause.written.map((entry) => `"${entry.name}"`).join(", ");
    throw new Error(
      `COROS stopped part-way: ${names} ${cause.written.length === 1 ? "was" : "were"} saved and stay${cause.written.length === 1 ? "s" : ""} there; ` +
        `the rest were not (${cause.message}). Saving again adds only the rest.`
    );
  }
  if (earlier) {
    uploaded = {
      ...uploaded,
      entries: [...earlier.entries, ...uploaded.entries],
      workoutsCreated: earlier.workoutsCreated + uploaded.workoutsCreated,
      workoutsScheduled: earlier.workoutsScheduled + uploaded.workoutsScheduled
    };
    partialWrites.delete(stored.draftId);
  }
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
 * The plan a version is, as the library reads it: the one with its COROS
 * identity once the creation is on COROS, otherwise built from the draft's
 * own workouts. A document whose plan has changed since it was written — an
 * older build edits `plan_json` in place and knows nothing of the document —
 * is built again from the plan and given back its COROS identity, so the edit
 * shows and an update still finds the plan and its sessions.
 */
function draftDocument(stored: StoredPlanDraft): TrainingPlanDocument {
  if (!stored.document) return coachDraftDocument(stored);
  if (!stored.documentPlanHash || stored.documentPlanHash === planHash(stored.plan)) {
    return stored.document;
  }
  return carryCorosIdentity(coachDraftDocument(stored), stored.document);
}

/**
 * `next` with `base`'s COROS identity: the plan's id, version and calendar
 * state, and — session by session, matched by key — its `idInPlan`, and its
 * program exactly as COROS sent it where the workout is unchanged. A session
 * that is new, or whose workout changed, is built afresh on the next save;
 * one that kept its `idInPlan` is updated in place rather than replaced, which
 * is what keeps its history on a calendar running the plan.
 *
 * "Unchanged" is asked of `baseWorkouts`, the workouts as the base version's
 * own plan holds them — the form `next` is written in. Without them nothing
 * counts as unchanged, since `base`'s workouts are rebuilt from COROS's
 * programs, and every session is written afresh: correct, only not byte for
 * byte.
 */
function carryCorosIdentity(
  next: TrainingPlanDocument,
  base: TrainingPlanDocument,
  baseWorkouts?: ReadonlyMap<string, PlanWorkoutEntryInput>
): TrainingPlanDocument {
  if (!base.remoteId) return next;
  const byKey = new Map(base.entries.map((entry) => [entry.workout.key || entry.id, entry]));
  return {
    ...next,
    id: base.id,
    remoteId: base.remoteId,
    ...(base.remoteVersion !== undefined ? { remoteVersion: base.remoteVersion } : {}),
    calendar: base.calendar,
    ...(base.startDate ? { startDate: base.startDate } : {}),
    ...(base.runningInstanceId ? { runningInstanceId: base.runningInstanceId } : {}),
    ...(base.sourcePlanId ? { sourcePlanId: base.sourcePlanId } : {}),
    entries: next.entries.map((entry) => {
      const was = byKey.get(entry.workout.key || entry.id);
      if (!was?.idInPlan) return entry;
      const { corosProgram: _program, ...rest } = entry;
      const before = baseWorkouts?.get(entry.workout.key || entry.id);
      return {
        ...rest,
        idInPlan: was.idInPlan,
        ...(was.corosProgram && before && sameWorkoutInput(before, entry.workout)
          ? { corosProgram: was.corosProgram }
          : {})
      };
    })
  };
}

/**
 * The plan as COROS read it back after a save, keyed as it was sent. COROS
 * names each session `coros:<plan>:<idInPlan>`; the version's own plan names
 * them by the coach's keys, and every later revision and diff matches
 * sessions by those. A session COROS already knew is matched by its
 * `idInPlan`, and the rest in the order they fall in the plan — the save
 * checked the counts agree.
 */
function keyedAsSent(readBack: TrainingPlanDocument, sent: TrainingPlanDocument): TrainingPlanDocument {
  const order = (left: TrainingPlanEntry, right: TrainingPlanEntry) =>
    left.weekIndex - right.weekIndex || left.dayIndex - right.dayIndex || left.sortOrder - right.sortOrder;
  const sentById = new Map(sent.entries.filter((entry) => entry.idInPlan).map((entry) => [entry.idInPlan!, entry]));
  const unmatchedSent = [...sent.entries].filter((entry) => !entry.idInPlan).sort(order);
  const keyOf = new Map<string, string>();
  const rest: TrainingPlanEntry[] = [];
  for (const entry of [...readBack.entries].sort(order)) {
    const known = entry.idInPlan ? sentById.get(entry.idInPlan) : undefined;
    if (known) keyOf.set(entry.id, known.workout.key || known.id);
    else rest.push(entry);
  }
  rest.forEach((entry, index) => {
    const match = unmatchedSent[index];
    if (match) keyOf.set(entry.id, match.workout.key || match.id);
  });
  return {
    ...readBack,
    coach: sent.coach ?? readBack.coach,
    entries: readBack.entries.map((entry) => {
      const key = keyOf.get(entry.id);
      return key ? { ...entry, workout: { ...entry.workout, key } } : entry;
    })
  };
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
  unitSystem: UnitSystem,
  options: PlanDraftSaveOptions = {}
): Promise<UploadPlanResult> {
  if (stored.preview.artifactType === "workout") {
    throw new Error("A single workout is saved to the library or the calendar, not as a plan.");
  }
  // A version of a creation already on COROS carries the plan's identity, so
  // this is an update of that plan (D5) unless the athlete asked for a new
  // one — checked against the version it was made from, as the Library's
  // saves are.
  const sent = draftDocument(stored);
  const updating = Boolean(sent.remoteId) && !options.asNew;
  const saved = await savePlanToCoros({
    plan: sent,
    unitSystem,
    origin: "coach",
    coach: { draftId: stored.draftId },
    ...(options.asNew ? { asNew: true } : {}),
    ...(updating && sent.remoteVersion !== undefined ? { expectedVersion: sent.remoteVersion } : {}),
    ...(options.overwrite ? { overwrite: true } : {})
  });
  if (!saved.ok) {
    return {
      planName: sent.name,
      workoutsCreated: 0,
      workoutsScheduled: 0,
      entries: [],
      destination: "nativePlan",
      ...(sent.remoteId ? { planId: `coros:${sent.remoteId}` } : {}),
      conflict: saved.conflict
    };
  }
  const updated = updating && saved.plan.remoteId === sent.remoteId;
  const result: UploadPlanResult = {
    planName: saved.plan.name,
    workoutsCreated: saved.plan.entries.length,
    workoutsScheduled: 0,
    entries: [],
    destination: "nativePlan",
    planId: saved.plan.id,
    remoteWrites: [`${updated ? "Update" : "Create"} plan ${saved.plan.name}`]
  };
  stored.document = keyedAsSent(saved.plan, sent);
  stored.documentPlanHash = planHash(stored.plan);
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
            ...(stored.changeSummary ? { changeSummary: stored.changeSummary } : {}),
            ...(stored.preview.uploadResult?.planId ? { remotePlanId: stored.preview.uploadResult.planId } : {}),
            ...(stored.author === "coros" && !draftDocument(stored).remoteId ? { detached: true } : {}),
            ...(stored.refinements?.length ? { refinements: stored.refinements } : {})
          }
        ];
      } catch {
        return [];
      }
    })
  );
}

/**
 * Where each Coach plan on COROS stands on the calendar, for the cards: its
 * newest saved version's plan, the running copy the plan cache holds of it,
 * and what was done against that copy. Nothing is asked of COROS.
 */
export function planCalendarStates(draftIds: readonly string[]): PlanCalendarState[] {
  const artifacts = new Set<string>();
  for (const draftId of draftIds) {
    const row = getChatPlanDraft(draftId);
    if (row) artifacts.add(row.artifactId ?? row.draftId);
  }
  let matches: ReturnType<typeof listTrainingActivityMatches> | undefined;
  return [...artifacts].flatMap((artifactId): PlanCalendarState[] => {
    const versions = versionsOf(artifactId);
    const saved = [...versions].reverse().find((version) => version.uploadedAt && draftDocument(version).remoteId);
    if (!saved || saved.preview.artifactType === "workout") return [];
    const remoteId = draftDocument(saved).remoteId!;
    const runningId = findCachedRunningCorosPlan(remoteId);
    const running = runningId ? getCorosPlanCache(runningId) : undefined;
    matches ??= listTrainingActivityMatches();
    return [
      {
        artifactId,
        remotePlanId: `coros:${remoteId}`,
        ...(running ? { running } : {}),
        matches: running ? matches.filter((match) => match.schedulePlanId === running.remoteId) : []
      }
    ];
  });
}

/**
 * The conversation a Coach plan came from, found from the draft id its COROS
 * plan names (P1.7) — which may be any version's, so every version is looked
 * for. Undefined when no conversation holds it any more.
 */
export function chatSessionForDraft(draftId: string): string | undefined {
  const row = getChatPlanDraft(draftId);
  const ids = row ? versionsOf(row.artifactId ?? row.draftId).map((version) => version.draftId) : [];
  return findChatSessionMentioning([...new Set([draftId, ...ids])]);
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
 * The athlete's edit of a coach plan, as the creation's next version (P1.5) —
 * not a plan draft of the library's. The version it replaced is left as it
 * was; `editedAt` on the new card, and the `planEvent` the renderer leaves,
 * are what put it in front of the coach.
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
  const newer = newerVersion(stored, replaceNewer);
  if (newer) return newer;
  const { next, keyed, anchor } = planFromDocument(plan, stored);
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
  return writeVersion(stored, next, {
    unitSystem,
    conflicts,
    author: "athlete",
    // The editor's own document, sessions keyed as the plan now keys them:
    // it knows which sessions were edited, and keeps the rest's programs.
    document: { ...plan, entries: keyed }
  });
}

/**
 * A plan document as the draft's own plan holds it: dated from the Monday the
 * coach's first dated session fell in, at the week and day each session is on
 * now, or — for a plan the coach wrote undated — with the arrangement kept
 * beside it as `layout`. Sessions are keyed by their workout's key, made
 * unique; `keyed` is the document's sessions under those keys.
 */
function planFromDocument(
  plan: TrainingPlanDocument,
  stored: StoredPlanDraft
): { next: CorosTrainingPlanDraft; keyed: TrainingPlanEntry[]; anchor?: Date } {
  const dates = stored.plan.workouts
    .map((workout) => parsePlanDay(workout.schedule_date))
    .filter((date): date is Date => Boolean(date))
    .sort((left, right) => left.valueOf() - right.valueOf());
  const anchor = dates[0] ? mondayOf(dates[0]) : undefined;
  const originals = new Map(stored.plan.workouts.map((workout) => [workout.key, workout]));
  const keys = new Set<string>();
  const layout: NonNullable<CorosTrainingPlanDraft["layout"]> = {};

  const keyed: TrainingPlanEntry[] = [];
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
      keyed.push({ ...entry, workout: { ...entry.workout, key } });
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
    ...(plan.description?.trim() ? { description: plan.description.trim() } : {}),
    ...(plan.weekStages.length ? { weekStages: plan.weekStages.map((stage) => ({ ...stage })) } : {}),
    ...(anchor ? {} : { layout })
  };
  return { next, keyed, ...(anchor ? { anchor } : {}) };
}

/**
 * The athlete's version of a one-off workout the coach drafted, from the
 * builder. The key, the day the coach suggested and whether it goes to the
 * library stay the coach's; the workout itself is the athlete's. Written as
 * the workout's next version (P1.5).
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
  if (versionsOf(stored.artifactId).some((version) => version.uploadedAt) || stored.uploadedAt) {
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
 * undone the same way (docs/coach-plan-canvas.md, P1.4). A saved plan's
 * restore carries its COROS identity like any version (P1.6); a saved
 * workout's is refused by `writeVersion`.
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
    // No document of its own: the old content is given the newest version's
    // COROS identity session by session, as a revision is. The old version's
    // own `idInPlan`s are what COROS held back then, and a session removed
    // on COROS since would be sent under an id that is no longer there —
    // restored, it is a new session to COROS.
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
    /** The editor's document, when the version was made in one. */
    document?: TrainingPlanDocument;
    /** The plan was deleted on COROS: this version has no plan there. */
    detach?: boolean;
    /** The version is what COROS holds already — read from it — so it is saved there. */
    savedAs?: UploadPlanResult;
  }
): PlanVersionWritten {
  const versions = versionsOf(base.artifactId);
  const latest = versions[versions.length - 1] ?? base;
  if ((base.preview.artifactType ?? "plan") === "workout" && versions.some((version) => version.uploadedAt)) {
    throw new Error("This workout is already saved to COROS, so the Coach card can no longer be changed from here.");
  }
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
  if (!options.detach) withCorosIdentityOf(stored, latest, options.document);
  persistPlanDraft(stored);
  if (options.savedAs) markDraftSaved(stored, options.savedAs);
  return {
    kind: "written",
    preview: lightPreview(stored.preview),
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
  for (const draftId of draftIds) deleteChatPlanDraft(draftId);
}
