/**
 * The starting points offered when the athlete creates a coach (9.1).
 *
 * Plain data, and it lives beside the store rather than in the renderer so the
 * store's own normalizers can be run over it: a preset with a malformed trigger
 * degrades silently to "manual" on the way in, which is exactly the kind of
 * typo a gallery of hand-written definitions invites.
 */
import type { AutomationBindingMode, CoachAutomationInput } from "./types";

export interface CoachAutomationPreset {
  id: string;
  label: string;
  description: string;
  definition: CoachAutomationInput;
  /** How the preset suggests attaching itself on the "where it runs" tab. */
  suggestedBinding: { mode: AutomationBindingMode; titleTemplate?: string };
}

/**
 * The gallery is a menu of starting points, so each preset earns its place by
 * teaching something different about what an automation can be — a trigger
 * kind, a binding mode, a job — rather than by being a variation on the last
 * one. Four entries, in the order an athlete meets them.
 *
 * Effort is left unset wherever `low` is right, because that is now the
 * documented default (section 7); only the two that genuinely want more say so.
 */

/**
 * A debrief is the cheapest rule to trust: it fires on something the athlete
 * just did, so they can judge the answer immediately. It shipped alone in
 * phase 1 for exactly that reason.
 */
const POST_ACTIVITY_DEBRIEF: CoachAutomationPreset = {
  id: "post-activity-debrief",
  label: "Post-activity debrief",
  description:
    "After every activity over 20 minutes, review how it went against recent training and flag anything worth acting on.",
  definition: {
    name: "Post-activity debrief",
    presetId: "post-activity-debrief",
    role:
      "You are the athlete's endurance coach reviewing a session that has just finished. " +
      "Injury prevention and consistency come before chasing numbers. Be concrete and brief.",
    playbook:
      "A new activity has just synced: {{activity.name}} ({{activity.sport}}) on {{date}}.\n\n" +
      "Look at the activity against the athlete's recent training:\n" +
      "- How it compares with similar recent sessions (pace, heart rate, load, duration).\n" +
      "- Whether it fits the week's pattern, or breaks it.\n" +
      "- Anything in recovery or accumulated load that this session changes.\n\n" +
      "Only raise something if it is materially different from recent history.",
    trigger: { kind: "activity", sportTypes: [], minDurationSec: 1200 },
    runtime: {},
    conditions: { batchWindowMin: 20, cooldownMin: 120, maxRunsPerDay: 3 }
  },
  suggestedBinding: {
    mode: "per-run",
    titleTemplate: "{{rule.name}} · {{activity.name}} · {{date}}"
  }
};

/**
 * The schedule counterpart: it speaks whether or not the athlete trained. A
 * `dedicated` conversation matters more here than anywhere else — a briefing
 * that cannot see what it said yesterday repeats itself.
 */
const MORNING_BRIEFING: CoachAutomationPreset = {
  id: "morning-briefing",
  label: "Morning briefing",
  description:
    "Every morning at 07:00, say what today should look like given the last few days and what is on the calendar.",
  definition: {
    name: "Morning briefing",
    presetId: "morning-briefing",
    role:
      "You are the athlete's endurance coach, writing the first thing they read today. " +
      "Short, concrete, and about today — not a lecture. Injury prevention and consistency come first.",
    playbook:
      "Good morning. It is {{date}}.\n\n" +
      "Look at what is scheduled for today and what the last few days of training actually were, then say:\n" +
      "- What today should be, and why that follows from the last few days.\n" +
      "- Anything in recovery or accumulated load that changes it.\n\n" +
      "If today is a rest day and nothing is off, say so and stop. Only raise something if it is materially different from recent history.",
    trigger: { kind: "schedule", cadence: "daily", timeOfDay: "07:00" },
    runtime: {},
    // A briefing that fires once a day does not need a cooldown fighting it,
    // and quiet hours keep it from arriving in the middle of the night if the
    // laptop was closed at 07:00 and opened at 02:00.
    conditions: {
      batchWindowMin: 0,
      cooldownMin: 0,
      maxRunsPerDay: 1,
      quietHours: { start: "22:00", end: "06:00" }
    }
  },
  suggestedBinding: { mode: "dedicated" }
};

/**
 * The first preset whose job is analysis rather than reaction, which is why it
 * is also the first to ask for more effort than the default: it runs once a
 * week and reads a week of training, so `medium` is cheap in absolute terms.
 */
const WEEKLY_REVIEW: CoachAutomationPreset = {
  id: "weekly-review",
  label: "Weekly review",
  description:
    "Every Sunday evening, look back at the week as a whole — what held, what slipped, and what it means for the next one.",
  definition: {
    name: "Weekly review",
    presetId: "weekly-review",
    role:
      "You are the athlete's endurance coach closing out a training week. " +
      "Judge the week as a block rather than session by session, and be honest about what did not happen.",
    playbook:
      "Review the training week of {{week.range}}.\n\n" +
      "- What the week actually was: volume, intensity distribution, how it compares with the weeks before it.\n" +
      "- What was scheduled and did not happen, and whether that matters.\n" +
      "- The one thing that should change next week, if anything should.\n\n" +
      "A week that went to plan is a finding too — say so briefly rather than inventing concerns.",
    trigger: {
      kind: "schedule",
      cadence: "weekly",
      dayOfWeek: 0,
      timeOfDay: "18:00"
    },
    runtime: { effort: "medium" },
    conditions: { batchWindowMin: 0, cooldownMin: 0, maxRunsPerDay: 1 }
  },
  suggestedBinding: { mode: "dedicated" }
};

/**
 * The only preset that proposes work rather than describing it. Decision 3
 * holds: it drafts, and the draft waits in the conversation as a card the
 * athlete confirms. Worth a place in the gallery because nothing else shows
 * that an automation can do more than talk.
 */
const WEEK_AHEAD_PLAN: CoachAutomationPreset = {
  id: "week-ahead-plan",
  label: "Next week's plan",
  description:
    "Every Monday morning, draft the week's sessions from recent training. The draft waits for you to approve it — nothing is written to COROS on its own.",
  definition: {
    name: "Next week's plan",
    presetId: "week-ahead-plan",
    role:
      "You are the athlete's endurance coach planning the week that is starting. " +
      "Build from what they have actually been doing, not from an ideal template. Progress load gradually.",
    playbook:
      "Draft the training week starting {{date}}.\n\n" +
      "Base it on the last two or three weeks of actual training and anything already on the calendar. " +
      "Progress from where they are rather than where a plan says they should be.\n\n" +
      "Draft the week as a training plan so it can be reviewed and approved, then say in one line what the week is for.",
    trigger: {
      kind: "schedule",
      cadence: "weekly",
      dayOfWeek: 1,
      timeOfDay: "06:30"
    },
    runtime: { effort: "medium" },
    conditions: { batchWindowMin: 0, cooldownMin: 0, maxRunsPerDay: 1 }
  },
  suggestedBinding: { mode: "dedicated" }
};

export const COACH_AUTOMATION_PRESETS: CoachAutomationPreset[] = [
  POST_ACTIVITY_DEBRIEF,
  MORNING_BRIEFING,
  WEEKLY_REVIEW,
  WEEK_AHEAD_PLAN
];
