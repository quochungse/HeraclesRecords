import type {
  ChatMessage,
  ChatTokenUsage,
  CompactContextSettings,
  PersistedChatEntry
} from "./types";

/**
 * Context compaction — the rolling summary that stands in for the head of a
 * long transcript, shared by the interactive chat and by automation runs.
 *
 * It started as section 5.7 of the coach-automations design, where only
 * headless runs used it. Nothing about it was ever automation-specific: an
 * athlete who chats daily in one conversation pays the same growing bill as a
 * daily briefing thread does, and the summary is stored on the *conversation*
 * (`chat_sessions.coach_summary`), so a conversation with both a coach and an
 * athlete talking in it has one summary that either can roll and both benefit
 * from.
 *
 * Everything here is pure. The roll itself is a model call and the storage is
 * SQLite; both arrive as callbacks, which is what lets the automation runner
 * keep its injected test seams while sharing this code.
 */

// ---------------------------------------------------------------------------
// The window
// ---------------------------------------------------------------------------

/**
 * How far a transcript may run past what the summary already covers before it
 * is rolled forward.
 *
 * The count is measured from the summary, not from the start of the
 * conversation, and that is the difference between this and a fixed window. A
 * fixed "always send the last 20" would need the summary re-rolled on **every**
 * turn, because every turn adds two entries to the head. Rolling once every
 * `limit - keep` turns instead is cheaper — a turn is a model call and so is a
 * roll — and, more importantly, less lossy: a summary re-summarised forty times
 * a year is forty rounds of compression, and what survives is whatever
 * happened to be in the last one.
 */
export const DEFAULT_CONTEXT_LIMIT = 60;

/** How many recent entries survive a roll and go to the model verbatim. */
export const DEFAULT_CONTEXT_KEEP = 20;

/**
 * A tail of one is a conversation with no context at all, and a `keep` of zero
 * would send the summary alone — the athlete's own last question included in
 * the compression. Two is the smallest tail that still carries a question and
 * its answer.
 */
export const MIN_CONTEXT_KEEP = 2;

/**
 * Nothing enforces a provider's context length here, so the ceiling is a
 * sanity bound rather than a promise: past this a "compacted" conversation is
 * not compact by any reading, and the setting has stopped meaning anything.
 */
export const MAX_CONTEXT_LIMIT = 400;

/**
 * The limit has to sit far enough above `keep` that a roll buys something. At
 * a gap of one, every single turn after the first roll trips the next one —
 * which is the per-turn re-summarisation this design exists to avoid.
 */
export const MIN_CONTEXT_GAP = 4;

/** What a transcript is trimmed to, and when. */
export interface ContextWindow {
  limit: number;
  keep: number;
}

export const DEFAULT_CONTEXT_WINDOW: ContextWindow = {
  limit: DEFAULT_CONTEXT_LIMIT,
  keep: DEFAULT_CONTEXT_KEEP
};

/**
 * What the settings look like before the athlete has touched them, for the
 * renderer's optimistic default while the real ones load.
 */
export const DEFAULT_COMPACT_CONTEXT: CompactContextSettings = {
  enabled: true,
  ...DEFAULT_CONTEXT_WINDOW
};

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/**
 * Reads a stored or hand-typed pair as a usable window. Both halves are
 * settings the athlete can type, so neither can be trusted to be a number, to
 * be whole, or to be in the right order relative to the other.
 *
 * `keep` is resolved first and `limit` is then floored against it, so a pair
 * that disagrees loses the *limit* rather than the tail: sending fewer recent
 * turns verbatim than the athlete asked for is the change they would notice,
 * and rolling more often than they asked for is the one they would not.
 */
export function normalizeContextWindow(
  raw?: Partial<ContextWindow> | null
): ContextWindow {
  const keepRaw = Number(raw?.keep);
  const limitRaw = Number(raw?.limit);
  const keep = Number.isFinite(keepRaw)
    ? clamp(Math.round(keepRaw), MIN_CONTEXT_KEEP, MAX_CONTEXT_LIMIT - MIN_CONTEXT_GAP)
    : DEFAULT_CONTEXT_KEEP;
  const limit = Number.isFinite(limitRaw)
    ? clamp(Math.round(limitRaw), keep + MIN_CONTEXT_GAP, MAX_CONTEXT_LIMIT)
    : Math.max(DEFAULT_CONTEXT_LIMIT, keep + MIN_CONTEXT_GAP);
  return { limit, keep };
}

// ---------------------------------------------------------------------------
// Transcript → wire
// ---------------------------------------------------------------------------

/**
 * The transcript as the model sees it.
 *
 * Only entries that carry words survive. The visual cards — plan drafts,
 * activity charts, zone summaries — are renderings of tool output the model
 * already produced and already narrated in its own answer; replaying them as
 * text would be the same facts twice, in a worse form.
 *
 * A `coachPrompt` is the exception and is expanded rather than dropped: the
 * question and the athlete's answer to it are a turn of the conversation, and
 * a coach that cannot see what it asked (or what it was told) re-asks.
 */
export function toWireMessages(entries: PersistedChatEntry[]): ChatMessage[] {
  return entries.flatMap((entry): ChatMessage[] => {
    if (entry.kind === "message") {
      return entry.content.trim()
        ? [{ role: entry.role, content: entry.content }]
        : [];
    }
    if (entry.kind === "coachPrompt") {
      const choices = entry.prompt.choices
        .map((choice) => `- ${choice.label}`)
        .join("\n");
      const question: ChatMessage = {
        role: "assistant",
        content: `I need the athlete's answer before continuing:\n${entry.prompt.question}\n${choices}`
      };
      return entry.prompt.answer
        ? [question, { role: "user", content: entry.prompt.answer }]
        : [question];
    }
    return [];
  });
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

/** What is stored about a conversation's summary, if anything. */
export interface StoredTranscriptSummary {
  summary?: string;
  /** Entries at the head of the transcript the summary accounts for. */
  through: number;
}

export interface TranscriptContextPlan {
  /** Sent ahead of the tail, standing in for everything before it. */
  summary?: string;
  /** Sent verbatim. */
  tail: PersistedChatEntry[];
  /** Entries that have to be folded into the summary first; usually empty. */
  toSummarise: PersistedChatEntry[];
  /** What `through` becomes once they are folded in. */
  through: number;
}

export interface PlanTranscriptOptions {
  /**
   * Roll now, whatever the limit says — "Compact context" from the
   * conversation menu. The tail is still `keep` entries, so a forced compact
   * and one the window triggered leave the conversation in the same shape.
   */
  force?: boolean;
}

/**
 * What of a transcript this turn should send, and what has to be folded into
 * the summary first. Pure: the folding itself is a model call and belongs to
 * the caller.
 *
 * A `through` past the end of the transcript describes a conversation that is
 * no longer there, so the summary is abandoned rather than trusted. It should
 * not happen — the window's saves merge rather than truncate, and a deleted
 * conversation takes its row with it — but a summary that claims to cover
 * entries nobody can see is the one failure here that cannot be noticed by
 * reading the result.
 */
export function planTranscriptContext(
  entries: PersistedChatEntry[],
  stored: StoredTranscriptSummary,
  window: ContextWindow = DEFAULT_CONTEXT_WINDOW,
  options: PlanTranscriptOptions = {}
): TranscriptContextPlan {
  // A count past the end describes a conversation that is no longer there, and
  // a summary with no count at all — or a count of zero — describes nothing.
  // Either way the pair is half-written, and the two are one fact. The safe
  // reading is *no summary*, the same way a half-written pause reads as *not
  // paused*: trusting it would send a summary of turns the model is also about
  // to read in full, and nothing downstream could notice.
  const valid =
    stored.through > 0 &&
    stored.through <= entries.length &&
    Boolean(stored.summary);
  const through = valid ? stored.through : 0;
  const summary = valid ? stored.summary : undefined;

  const live = entries.length - through;
  // A forced compact still has a floor: below `keep` there is nothing the roll
  // could remove, and rolling anyway would spend a model call to summarise
  // turns it then sends in full anyway.
  const ceiling = options.force ? window.keep : window.limit;
  if (live <= ceiling) {
    return {
      ...(summary ? { summary } : {}),
      tail: entries.slice(through),
      toSummarise: [],
      through
    };
  }

  const nextThrough = entries.length - window.keep;
  return {
    ...(summary ? { summary } : {}),
    tail: entries.slice(nextThrough),
    toSummarise: entries.slice(through, nextThrough),
    through: nextThrough
  };
}

/**
 * How the summary reaches the model. A plain user turn, labelled, rather than
 * anything provider-specific: it has to read the same way to four providers,
 * and it has to be obvious to the model that this is a compression of the
 * conversation rather than something the athlete just said.
 */
export function summaryContextMessage(summary: string): ChatMessage {
  return {
    role: "user",
    content: [
      "[Earlier in this conversation, summarised]",
      summary,
      "[End of summary. The messages that follow are the recent turns in full.]"
    ].join("\n\n")
  };
}

/** The turn that folds new entries into the running summary. */
export function buildRollingSummaryTurn(
  previous: string | undefined,
  entries: PersistedChatEntry[]
): string {
  const transcript = toWireMessages(entries)
    .map((message) => `${message.role === "user" ? "Athlete" : "Coach"}: ${message.content}`)
    .join("\n\n");
  return [
    previous
      ? "Here is the running summary of a coaching conversation so far, followed by the turns that have happened since it was written."
      : "Here are the opening turns of a coaching conversation.",
    ...(previous ? ["", "--- Running summary ---", previous] : []),
    "",
    "--- Newer turns ---",
    transcript,
    "",
    "Rewrite the running summary so it covers everything above, including the",
    "newer turns. It is the only record of these turns the coach will have on",
    "future runs, so keep what a coach would need: the athlete's goals, races,",
    "injuries and constraints, decisions taken, and how the training has",
    "actually gone. Drop pleasantries and anything already superseded. Write it",
    "as notes, not as a letter, and reply with the summary and nothing else."
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Applying a plan
// ---------------------------------------------------------------------------

export interface TranscriptContextResult {
  /** Sent ahead of the tail, when there is one. */
  summary?: string;
  /** Sent verbatim. */
  tail: PersistedChatEntry[];
  /** Index into `entries` where `tail` begins, for callers that slice again. */
  tailStart: number;
  /** What the stored count is now — unchanged unless a roll landed. */
  through: number;
  /** Whether a summariser turn actually ran. */
  rolled: boolean;
  /** A roll ran and produced nothing; the untrimmed tail is being sent. */
  failed: boolean;
  /**
   * Why it produced nothing. Carried rather than swallowed because a roll is
   * best-effort in two very different situations: the automatic pass, where
   * silence is right and the next turn tries again, and the athlete pressing
   * "Compact context", where silence is a dead button. The same code serves
   * both, so the reason has to survive the trip and let the caller decide
   * whether to show it.
   */
  failureReason?: string;
  /** What the roll cost, when it reported anything. */
  usage?: ChatTokenUsage;
}

export interface ApplyTranscriptContextParams {
  entries: PersistedChatEntry[];
  stored: StoredTranscriptSummary;
  window?: ContextWindow;
  force?: boolean;
  /**
   * Folds entries into the running summary. A null `summary` means it could
   * not — a roll is best-effort, and the turn it is preparing for still has to
   * happen.
   *
   * `usage` comes back separately because a roll is a full provider turn and
   * every one of them is counted. It is reported whether or not the roll
   * produced anything: a summariser that spent its tokens and then declined
   * still spent them, and a budget that could not see the one feature built to
   * make long conversations affordable would under-report exactly where it
   * matters most.
   */
  roll(
    previous: string | undefined,
    entries: PersistedChatEntry[]
  ): Promise<{
    summary: string | null;
    usage?: ChatTokenUsage;
    /** Why it produced nothing, in words fit to show someone. */
    reason?: string;
  }>;
  /** Persists the pair. Called only when a roll produced a summary. */
  store(summary: string, through: number): void;
}

/**
 * Plans, rolls when the plan asks for one, and reports what to send.
 *
 * **A roll is best-effort.** If it fails — a provider that declined, or went
 * quiet — the turn does **not** fail and the middle of the conversation is
 * **not** dropped. It sends what it would have sent before the roll:
 * everything the stored summary does not already cover. That costs more this
 * once, and the next turn rolls again. The alternative, trimming to the tail
 * without a summary to stand in for the head, would quietly delete a year of
 * context and produce an answer that reads perfectly well.
 */
export async function applyTranscriptContext(
  params: ApplyTranscriptContextParams
): Promise<TranscriptContextResult> {
  const plan = planTranscriptContext(
    params.entries,
    params.stored,
    params.window ?? DEFAULT_CONTEXT_WINDOW,
    params.force ? { force: true } : {}
  );
  if (!plan.toSummarise.length) {
    return {
      ...(plan.summary ? { summary: plan.summary } : {}),
      tail: plan.tail,
      tailStart: params.entries.length - plan.tail.length,
      through: plan.through,
      rolled: false,
      failed: false
    };
  }

  const rolled = await params.roll(plan.summary, plan.toSummarise);
  if (!rolled.summary) {
    const tail = [...plan.toSummarise, ...plan.tail];
    return {
      ...(plan.summary ? { summary: plan.summary } : {}),
      tail,
      tailStart: params.entries.length - tail.length,
      through: params.stored.through,
      rolled: true,
      failed: true,
      ...(rolled.reason ? { failureReason: rolled.reason } : {}),
      ...(rolled.usage ? { usage: rolled.usage } : {})
    };
  }

  params.store(rolled.summary, plan.through);
  return {
    summary: rolled.summary,
    tail: plan.tail,
    tailStart: params.entries.length - plan.tail.length,
    through: plan.through,
    rolled: true,
    failed: false,
    ...(rolled.usage ? { usage: rolled.usage } : {})
  };
}

/** The messages a resolved context becomes: the summary, then the tail. */
export function contextMessages(
  result: Pick<TranscriptContextResult, "summary" | "tail">
): ChatMessage[] {
  return [
    ...(result.summary ? [summaryContextMessage(result.summary)] : []),
    ...toWireMessages(result.tail)
  ];
}
