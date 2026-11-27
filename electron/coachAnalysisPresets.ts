/**
 * The starting points offered when the athlete creates an analysis (9.1).
 *
 * Plain data, and it lives beside the store rather than in the renderer so the
 * store's own normalizers can be run over it: a preset with a malformed trigger
 * degrades silently to "manual" on the way in, which is exactly the kind of
 * typo a gallery of hand-written definitions invites.
 *
 * **A preset's trigger is a suggestion, pre-filled and editable, not something
 * it asserts.** Creating one happens inside a conversation, so unlike the
 * shape before it there *is* somewhere for a trigger to fire — but the athlete
 * sees the 07:00 on the form and can change it or drop it before anything is
 * saved. A preset teaches what a trigger is for; it does not decide.
 */
import type {
  AnalysisConditions,
  AnalysisTrigger,
  CoachAnalysisInput
} from "./types";

export interface CoachAnalysisPreset {
  id: string;
  label: string;
  description: string;
  /**
   * Everything but the conversation. The screen that creates from a preset is
   * inside one and fills `sessionId` in; a preset cannot know it.
   */
  definition: Omit<CoachAnalysisInput, "sessionId">;
  /** Pre-filled on the attach screen. The athlete can change or drop it. */
  suggestedTrigger?: AnalysisTrigger;
  suggestedConditions?: Partial<AnalysisConditions>;
}

/**
 * The gallery is a menu of starting points, so each preset earns its place by
 * teaching something different about what an analysis can be — a job, and the
 * kind of trigger that job suggests — rather than by being a variation on the
 * last one. Four entries, in the order an athlete meets them.
 *
 * Effort is left unset wherever `low` is right, because that is now the
 * documented default (section 7); only the two that genuinely want more say so.
 *
 * **A playbook says what the analysis is for, in one sentence.** The runner
 * already hands a run its subject — the activity, the 72 hours before it, the
 * sessions like it, what the calendar held — and the conversation carries
 * everything the coach has set. In a blind replay (2026-11-27) a checklist
 * with coaching rules did no better than one sentence or none, and its "only
 * raise something if it is materially different" kept a debrief silent 3 times
 * out of 3 on a session with a fault to name. Variables an activity fills stay
 * out too: a manual run on a machine without the trigger has no activity, and
 * they rendered "()".
 */

/**
 * A debrief is the cheapest rule to trust: it fires on something the athlete
 * just did, so they can judge the answer immediately. It shipped alone in
 * phase 1 for exactly that reason.
 */
const POST_ACTIVITY_DEBRIEF: CoachAnalysisPreset = {
  id: "post-activity-debrief",
  label: "Post-activity debrief",
  description:
    "After every activity over 20 minutes, review how it went against recent training and flag anything worth acting on.",
  definition: {
    name: "Post-activity debrief",
    presetId: "post-activity-debrief",
    playbook: "Debrief this session.",
    runtime: {}
  },
  suggestedTrigger: { kind: "activity", sportTypes: [], minDurationSec: 1200 },
  suggestedConditions: { cooldownMin: 120, maxRunsPerDay: 3 }
};

/**
 * The schedule counterpart: it speaks whether or not the athlete trained.
 * Attaching it to a conversation it keeps coming back to matters more here than
 * anywhere else — a briefing that cannot see what it said yesterday repeats
 * itself, and an analysis lives in exactly that kind of conversation.
 */
const MORNING_BRIEFING: CoachAnalysisPreset = {
  id: "morning-briefing",
  label: "Morning briefing",
  description:
    "Every morning at 07:00, say what today should look like given the last few days and what is on the calendar.",
  definition: {
    name: "Morning briefing",
    presetId: "morning-briefing",
    playbook: "Say what today's training should be.",
    runtime: {}
  },
  suggestedTrigger: { kind: "schedule", cadence: "daily", timeOfDay: "07:00" },
  // A briefing that fires once a day does not need a cooldown fighting it,
  // and quiet hours keep it from arriving in the middle of the night if the
  // laptop was closed at 07:00 and opened at 02:00.
  suggestedConditions: {
    cooldownMin: 0,
    maxRunsPerDay: 1,
    quietHours: { start: "22:00", end: "06:00" }
  }
};

/**
 * The first preset whose job is analysis rather than reaction, which is why it
 * is also the first to ask for more effort than the default: it runs once a
 * week and reads a week of training, so `medium` is cheap in absolute terms.
 */
const WEEKLY_REVIEW: CoachAnalysisPreset = {
  id: "weekly-review",
  label: "Weekly review",
  description:
    "Every Sunday evening, look back at the week as a whole — what held, what slipped, and what it means for the next one.",
  definition: {
    name: "Weekly review",
    presetId: "weekly-review",
    playbook: "Review the training week of {{week.range}} as a whole.",
    runtime: { effort: "medium" }
  },
  suggestedTrigger: {
    kind: "schedule",
    cadence: "weekly",
    dayOfWeek: 0,
    timeOfDay: "18:00"
  },
  suggestedConditions: { cooldownMin: 0, maxRunsPerDay: 1 }
};

/**
 * The only preset that proposes work rather than describing it. Decision 3
 * holds: it drafts, and the draft waits in the conversation as a card the
 * athlete confirms. Worth a place in the gallery because nothing else shows
 * that an analysis can do more than talk.
 */
const WEEK_AHEAD_PLAN: CoachAnalysisPreset = {
  id: "week-ahead-plan",
  label: "Next week's plan",
  description:
    "Every Monday morning, draft the week's sessions from recent training. The draft waits for you to approve it — nothing is written to COROS on its own.",
  definition: {
    name: "Next week's plan",
    presetId: "week-ahead-plan",
    playbook: "Draft the training week starting {{date}} as a plan the athlete can approve.",
    runtime: { effort: "medium" }
  },
  suggestedTrigger: {
    kind: "schedule",
    cadence: "weekly",
    dayOfWeek: 1,
    timeOfDay: "06:30"
  },
  suggestedConditions: { cooldownMin: 0, maxRunsPerDay: 1 }
};

export const COACH_ANALYSIS_PRESETS: CoachAnalysisPreset[] = [
  POST_ACTIVITY_DEBRIEF,
  MORNING_BRIEFING,
  WEEKLY_REVIEW,
  WEEK_AHEAD_PLAN
];
