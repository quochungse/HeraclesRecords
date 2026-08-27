import type {
  ActivityVisualPreview,
  ChatEntryAutomationMarker,
  ChatMessage,
  CoachInputPrompt,
  FitnessTrendPreview,
  HrZonePreview,
  PersistedChatEntry,
  PlanDraftPreview,
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
   * Set when a coach automation wrote this entry. Both converters below have to
   * carry it: they rebuild entries field by field, so an unlisted field is
   * dropped — and `toPersistedEntries` runs whenever the athlete replies in the
   * conversation, which would silently strip attribution off the run's own
   * messages.
   */
  automation?: ChatEntryAutomationMarker;
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

/** An automation looked and found nothing worth saying (5.5). */
export interface ChatAutomationSilentEntry {
  kind: "automationSilent";
  automation: ChatEntryAutomationMarker;
  /** Epoch milliseconds. */
  at: number;
}

export interface ChatToolNoticeEntry {
  kind: "toolNotice";
  message: string;
}

export type ChatEntry =
  | ChatMessageEntry
  | ChatCoachPromptEntry
  | ChatPlanDraftEntry
  | ChatWorkoutDeleteEntry
  | ChatActivityVisualEntry
  | ChatFitnessTrendEntry
  | ChatHrZoneEntry
  | ChatAutomationSilentEntry
  | ChatToolNoticeEntry;

export function isChatVisualEntry(
  entry: ChatEntry
): entry is ChatActivityVisualEntry | ChatFitnessTrendEntry | ChatHrZoneEntry {
  return (
    entry.kind === "activityVisual" ||
    entry.kind === "fitnessTrend" ||
    entry.kind === "hrZoneSummary"
  );
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
    next[index] = { kind: "planDraft", draft };
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
    next[index] = { kind: "coachPrompt", prompt };
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
    next[index] = { kind: "workoutDelete", preview };
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
    next[index] = { kind: "activityVisual", preview };
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
    next[index] = { kind: "fitnessTrend", preview };
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
    next[index] = { kind: "hrZoneSummary", preview };
    return next;
  }
  return [...entries, { kind: "hrZoneSummary", preview }];
}

export function toWireMessages(entries: ChatEntry[]): ChatMessage[] {
  return entries.flatMap((entry): ChatMessage[] => {
    if (entry.kind === "message") {
      return [{ role: entry.role, content: entry.content }];
    }
    if (entry.kind === "coachPrompt") {
      const choices = entry.prompt.choices
        .map((choice) => `- ${choice.label}`)
        .join("\n");
      const promptMessage: ChatMessage =
        {
          role: "assistant",
          content: `I need the athlete's answer before continuing:\n${entry.prompt.question}\n${choices}`
        };
      return entry.prompt.answer
        ? [
            promptMessage,
            { role: "user", content: entry.prompt.answer }
          ]
        : [promptMessage];
    }
    return [];
  });
}

function persistVisualEntry(entry: ChatEntry): PersistedChatEntry | null {
  if (entry.kind === "coachPrompt") {
    return { kind: "coachPrompt", prompt: entry.prompt };
  }
  if (entry.kind === "planDraft") {
    return { kind: "planDraft", draft: entry.draft };
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
  const result: ChatEntry[] = [];

  for (const entry of entries) {
    if (entry.kind === "coachPrompt") {
      result.push({ kind: "coachPrompt", prompt: entry.prompt });
      continue;
    }
    if (entry.kind === "planDraft") {
      result.push({ kind: "planDraft", draft: entry.draft });
      continue;
    }
    if (entry.kind === "workoutDelete") {
      result.push({ kind: "workoutDelete", preview: entry.preview });
      continue;
    }
    if (entry.kind === "activityVisual") {
      result.push({ kind: "activityVisual", preview: entry.preview });
      continue;
    }
    if (entry.kind === "activityHrTrend") {
      result.push({
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
      });
      continue;
    }
    if (entry.kind === "fitnessTrend") {
      result.push({ kind: "fitnessTrend", preview: entry.preview });
      continue;
    }
    if (entry.kind === "hrZoneSummary") {
      result.push({ kind: "hrZoneSummary", preview: entry.preview });
      continue;
    }
    if (entry.kind === "automationSilent") {
      result.push({
        kind: "automationSilent",
        automation: entry.automation,
        at: entry.at
      });
      continue;
    }
    result.push({
      kind: "message",
      role: entry.role,
      content: entry.content,
      ...(entry.source ? { source: entry.source } : {}),
      ...(entry.reasoningSummary
        ? { reasoningSummary: entry.reasoningSummary }
        : {}),
      ...(entry.automation ? { automation: entry.automation } : {})
    });
  }

  return result;
}
