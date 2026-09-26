import type {
  ActivityVisualPreview,
  ChatEntryAnalysisMarker,
  ChatMessage,
  ChatTokenUsage,
  CoachInputPrompt,
  FitnessTrendPreview,
  HrZonePreview,
  PersistedChatEntry,
  PlanDraftPreview,
  PlanEvent,
  WorkoutDeletePreview
} from "../../electron/types";

/** Where an assistant answer's data came from, for the source indicator. */
export interface SourceInfo {
  snapshotIncluded: boolean;
  mcpEnabled: boolean;
  mcpUsed: boolean;
  mcpTools: string[];
  mcpError?: string;
}

export interface ChatMessageEntry {
  kind: "message";
  role: ChatMessage["role"];
  content: string;
  source?: SourceInfo;
  reasoningSummary?: string;
  /**
   * Set when an analysis wrote this entry. The key keeps its stored spelling —
   * see `ChatEntryAnalysisMarker`. Both converters below have to
   * carry it: they rebuild entries field by field, so an unlisted field is
   * dropped — and `toPersistedEntries` runs whenever the athlete replies in the
   * conversation, which would silently strip attribution off the run's own
   * messages.
   */
  automation?: ChatEntryAnalysisMarker;
  /**
   * What this answer cost and which model wrote it, for the footer under it.
   * Both converters below carry them for the reason stated above: an unlisted
   * field is dropped, and the drop is invisible until a reload.
   */
  usage?: ChatTokenUsage;
  model?: string;
}

export interface ChatPlanDraftEntry {
  kind: "planDraft";
  draft: PlanDraftPreview;
}

export interface ChatCoachPromptEntry {
  kind: "coachPrompt";
  prompt: CoachInputPrompt;
}

export interface ChatWorkoutDeleteEntry {
  kind: "workoutDelete";
  preview: WorkoutDeletePreview;
}

export interface ChatActivityVisualEntry {
  kind: "activityVisual";
  preview: ActivityVisualPreview;
}

export interface ChatFitnessTrendEntry {
  kind: "fitnessTrend";
  preview: FitnessTrendPreview;
}

export interface ChatHrZoneEntry {
  kind: "hrZoneSummary";
  preview: HrZonePreview;
}

/** An analysis looked and found nothing worth saying (5.5). */
export interface ChatAnalysisSilentEntry {
  kind: "automationSilent";
  automation: ChatEntryAnalysisMarker;
  /** Epoch milliseconds. */
  at: number;
}

export interface ChatToolNoticeEntry {
  kind: "toolNotice";
  message: string;
}

/** The athlete or COROS changed a coach's creation (P1.3); an anchor. */
export interface ChatPlanEventEntry {
  kind: "planEvent";
  event: PlanEvent;
}

/**
 * An entry a newer build wrote, of a kind this one cannot draw. It keeps its
 * place in the timeline and goes back to the store untouched, so this window's
 * save does not take it out of the conversation.
 */
export interface ChatOpaqueEntry {
  kind: "opaque";
  raw: Record<string, unknown>;
}

export type ChatEntry = (
  | ChatMessageEntry
  | ChatCoachPromptEntry
  | ChatPlanDraftEntry
  | ChatPlanEventEntry
  | ChatWorkoutDeleteEntry
  | ChatActivityVisualEntry
  | ChatFitnessTrendEntry
  | ChatHrZoneEntry
  | ChatAnalysisSilentEntry
  | ChatToolNoticeEntry
  | ChatOpaqueEntry
) & {
  /**
   * Top-level fields a newer build stored on this entry that this one does
   * not know. Both converters below rebuild entries field by field, so without
   * this they would be dropped on the first save.
   */
  extra?: Record<string, unknown>;
};

export function isChatVisualEntry(
  entry: ChatEntry
): entry is ChatActivityVisualEntry | ChatFitnessTrendEntry | ChatHrZoneEntry {
  return (
    entry.kind === "activityVisual" ||
    entry.kind === "fitnessTrend" ||
    entry.kind === "hrZoneSummary"
  );
}

/**
 * A finished turn's answer, put where the turn began.
 *
 * The cards a turn produces (a plan, a chart) arrive while it runs and are
 * appended as they come; the answer arrives last. Appended too, it read below
 * the plan it introduces. `turnStart` is the timeline's length when the turn
 * was sent, so everything from there on is this turn's, and `closing` goes in
 * front of it. Clamped, so a timeline replaced mid-turn cannot throw.
 */
export function settleTurnEntries(
  timeline: ChatEntry[],
  turnStart: number,
  closing: ChatEntry[]
): ChatEntry[] {
  const at = Math.min(Math.max(0, Math.floor(turnStart)), timeline.length);
  return [...timeline.slice(0, at), ...closing, ...timeline.slice(at)];
}

/** A replacement keeps what a newer build stored beside the entry it replaces. */
function keepExtra(entry: ChatEntry): { extra?: Record<string, unknown> } {
  return entry.extra ? { extra: entry.extra } : {};
}

export function upsertPlanDraftEntry(
  entries: ChatEntry[],
  draft: PlanDraftPreview
): ChatEntry[] {
  const index = entries.findIndex(
    (entry) =>
      entry.kind === "planDraft" && entry.draft.draftId === draft.draftId
  );
  if (index >= 0) {
    const next = [...entries];
    next[index] = { kind: "planDraft", draft, ...keepExtra(entries[index]) };
    return next;
  }
  return [...entries, { kind: "planDraft", draft }];
}

export function upsertCoachPromptEntry(
  entries: ChatEntry[],
  prompt: CoachInputPrompt
): ChatEntry[] {
  const index = entries.findIndex(
    (entry) =>
      entry.kind === "coachPrompt" && entry.prompt.promptId === prompt.promptId
  );
  if (index >= 0) {
    const next = [...entries];
    next[index] = { kind: "coachPrompt", prompt, ...keepExtra(entries[index]) };
    return next;
  }
  return [...entries, { kind: "coachPrompt", prompt }];
}

export function upsertWorkoutDeleteEntry(
  entries: ChatEntry[],
  preview: WorkoutDeletePreview
): ChatEntry[] {
  const index = entries.findIndex(
    (entry) =>
      entry.kind === "workoutDelete" &&
      entry.preview.requestId === preview.requestId
  );
  if (index >= 0) {
    const next = [...entries];
    next[index] = { kind: "workoutDelete", preview, ...keepExtra(entries[index]) };
    return next;
  }
  return [...entries, { kind: "workoutDelete", preview }];
}

export function upsertActivityVisualEntry(
  entries: ChatEntry[],
  preview: ActivityVisualPreview
): ChatEntry[] {
  const index = entries.findIndex(
    (entry) =>
      entry.kind === "activityVisual" &&
      entry.preview.previewId === preview.previewId
  );
  if (index >= 0) {
    const next = [...entries];
    next[index] = { kind: "activityVisual", preview, ...keepExtra(entries[index]) };
    return next;
  }
  return [...entries, { kind: "activityVisual", preview }];
}

export function upsertFitnessTrendEntry(
  entries: ChatEntry[],
  preview: FitnessTrendPreview
): ChatEntry[] {
  const index = entries.findIndex(
    (entry) =>
      entry.kind === "fitnessTrend" &&
      entry.preview.previewId === preview.previewId
  );
  if (index >= 0) {
    const next = [...entries];
    next[index] = { kind: "fitnessTrend", preview, ...keepExtra(entries[index]) };
    return next;
  }
  return [...entries, { kind: "fitnessTrend", preview }];
}

export function upsertHrZoneEntry(
  entries: ChatEntry[],
  preview: HrZonePreview
): ChatEntry[] {
  const index = entries.findIndex(
    (entry) =>
      entry.kind === "hrZoneSummary" &&
      entry.preview.previewId === preview.previewId
  );
  if (index >= 0) {
    const next = [...entries];
    next[index] = { kind: "hrZoneSummary", preview, ...keepExtra(entries[index]) };
    return next;
  }
  return [...entries, { kind: "hrZoneSummary", preview }];
}

/*
 * The transcript as the model sees it used to be built here, from `ChatEntry`.
 * It now lives in `electron/chatContextCompaction.ts` and runs on
 * `PersistedChatEntry` instead, because the rolling summary counts entries and
 * has to count the same ones the main process stored. Two functions that
 * flattened two nearly-identical shapes had already drifted apart: this one
 * expanded a `coachPrompt` into the question and its answer, the main-process
 * one dropped it, and an analysis therefore could not see what it had asked.
 */

/** The top-level keys each kind's converters handle; `mid`/`mrev` are the store's. */
const HANDLED_KEYS: Record<string, readonly string[]> = {
  message: ["role", "content", "source", "reasoningSummary", "usage", "model", "automation"],
  coachPrompt: ["prompt"],
  planDraft: ["draft"],
  planEvent: ["event"],
  workoutDelete: ["preview"],
  activityVisual: ["preview"],
  activityHrTrend: ["preview"],
  fitnessTrend: ["preview"],
  hrZoneSummary: ["preview"],
  automationSilent: ["automation", "at"],
  opaque: ["raw"]
};

function extraOf(entry: PersistedChatEntry): { extra?: Record<string, unknown> } {
  const handled = HANDLED_KEYS[entry.kind] ?? [];
  let extra: Record<string, unknown> | undefined;
  for (const [key, value] of Object.entries(entry)) {
    if (key === "kind" || key === "mid" || key === "mrev" || value === undefined) continue;
    if (handled.includes(key)) continue;
    (extra ??= {})[key] = value;
  }
  return extra ? { extra } : {};
}

function persistVisualEntry(entry: ChatEntry): PersistedChatEntry | null {
  const persisted = persistKnownEntry(entry);
  return persisted && entry.extra ? { ...persisted, ...entry.extra } : persisted;
}

function persistKnownEntry(entry: ChatEntry): PersistedChatEntry | null {
  if (entry.kind === "opaque") {
    return { kind: "opaque", raw: entry.raw };
  }
  if (entry.kind === "coachPrompt") {
    return { kind: "coachPrompt", prompt: entry.prompt };
  }
  if (entry.kind === "planDraft") {
    return { kind: "planDraft", draft: entry.draft };
  }
  if (entry.kind === "planEvent") {
    return { kind: "planEvent", event: entry.event };
  }
  if (entry.kind === "workoutDelete") {
    return { kind: "workoutDelete", preview: entry.preview };
  }
  if (entry.kind === "activityVisual") {
    return { kind: "activityVisual", preview: entry.preview };
  }
  if (entry.kind === "fitnessTrend") {
    return { kind: "fitnessTrend", preview: entry.preview };
  }
  if (entry.kind === "hrZoneSummary") {
    return { kind: "hrZoneSummary", preview: entry.preview };
  }
  if (entry.kind === "automationSilent") {
    return {
      kind: "automationSilent",
      automation: entry.automation,
      at: entry.at
    };
  }
  if (entry.kind === "toolNotice") {
    return {
      kind: "message",
      role: "assistant",
      content: entry.message
    };
  }
  if (entry.kind === "message") {
    return {
      kind: "message",
      role: entry.role,
      content: entry.content,
      ...(entry.source ? { source: entry.source } : {}),
      ...(entry.reasoningSummary
        ? { reasoningSummary: entry.reasoningSummary }
        : {}),
      ...(entry.usage ? { usage: entry.usage } : {}),
      ...(entry.model ? { model: entry.model } : {}),
      ...(entry.automation ? { automation: entry.automation } : {})
    };
  }
  return null;
}

export function toPersistedEntries(entries: ChatEntry[]): PersistedChatEntry[] {
  return entries
    .map((entry) => persistVisualEntry(entry))
    .filter((entry): entry is PersistedChatEntry => entry !== null);
}

export function fromPersistedEntries(entries: PersistedChatEntry[]): ChatEntry[] {
  return entries.map((entry) => ({ ...fromPersistedEntry(entry), ...extraOf(entry) }));
}

function fromPersistedEntry(entry: PersistedChatEntry): ChatEntry {
  if (entry.kind === "opaque") {
    return { kind: "opaque", raw: entry.raw };
  }
  if (entry.kind === "coachPrompt") {
    return { kind: "coachPrompt", prompt: entry.prompt };
  }
  if (entry.kind === "planDraft") {
    return { kind: "planDraft", draft: entry.draft };
  }
  if (entry.kind === "planEvent") {
    return { kind: "planEvent", event: entry.event };
  }
  if (entry.kind === "workoutDelete") {
    return { kind: "workoutDelete", preview: entry.preview };
  }
  if (entry.kind === "activityVisual") {
    return { kind: "activityVisual", preview: entry.preview };
  }
  if (entry.kind === "activityHrTrend") {
    return {
      kind: "activityVisual",
      preview: {
        previewId: entry.preview.previewId,
        activityId: entry.preview.activityId,
        name: entry.preview.name,
        startTime: entry.preview.startTime,
        avgHr: entry.preview.avgHr,
        maxHr: entry.preview.maxHr,
        sections: {
          hr: {
            chartKind: entry.preview.chartKind,
            series: entry.preview.series,
            laps: entry.preview.laps
          }
        }
      }
    };
  }
  if (entry.kind === "fitnessTrend") {
    return { kind: "fitnessTrend", preview: entry.preview };
  }
  if (entry.kind === "hrZoneSummary") {
    return { kind: "hrZoneSummary", preview: entry.preview };
  }
  if (entry.kind === "automationSilent") {
    return {
      kind: "automationSilent",
      automation: entry.automation,
      at: entry.at
    };
  }
  return {
    kind: "message",
    role: entry.role,
    content: entry.content,
    ...(entry.source ? { source: entry.source } : {}),
    ...(entry.reasoningSummary
      ? { reasoningSummary: entry.reasoningSummary }
      : {}),
    ...(entry.usage ? { usage: entry.usage } : {}),
    ...(entry.model ? { model: entry.model } : {}),
    ...(entry.automation ? { automation: entry.automation } : {})
  };
}
