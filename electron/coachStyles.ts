/**
 * How Coach sounds — chosen in Coach settings, one for every conversation.
 *
 * The base prompt deliberately says nothing about temperament
 * (`buildBaseCoachInstructions`): it states the coach's expertise, and a tone
 * written there would be a tone nobody chose. This is where one is chosen.
 * `neutral` adds nothing to the prompt at all, so it is the prompt as it was.
 *
 * A style is app-written, so it is stated as a rule rather than fenced as data
 * like the athlete's own instructions — but it is scoped to tone. It cannot
 * move a figure, soften the rule on pain and injury, or change what a tool is
 * called with, and it never reaches a card: a workout's name and description
 * are saved to COROS and shown on the watch, where "No filter" would be a
 * surprise at 6 a.m.
 *
 * Free of `node:` imports: the settings screen reads the labels from here.
 */

/**
 * In the order the picker draws them: from the warmest to the harshest, with
 * Neutral in the middle. A style saved that is no longer here (Analytical,
 * taken out) reads as Neutral through `normalizeCoachStyle`.
 */
export const COACH_STYLES = [
  "friendly",
  "motivating",
  "neutral",
  "straight",
  "unfiltered"
] as const;

export type CoachStyle = (typeof COACH_STYLES)[number];

export const DEFAULT_COACH_STYLE: CoachStyle = "neutral";

interface CoachStyleEntry {
  label: string;
  /** One sentence for the picker. */
  detail: string;
  /** What the model is told; absent for the style that changes nothing. */
  prompt?: string;
}

// Every word here is sent on every turn, so each style is one line: the tone,
// and for No filter the limits that make it safe to leave on.
const STRAIGHT_TALK = "Blunt: verdict first, unflattering facts stated plainly, excuses called out, no cushioning.";

export const COACH_STYLE_CATALOG: Record<CoachStyle, CoachStyleEntry> = {
  neutral: {
    label: "Neutral",
    detail: "Plain and even: the facts and the plan, in no particular voice."
  },
  friendly: {
    label: "Friendly",
    detail: "Warm and supportive. Notices what went well before what to fix.",
    prompt: "Warm and supportive: what went well first, a correction as the next step, praise tied to the data."
  },
  motivating: {
    label: "Motivating",
    detail: "High energy. Ties every session to your goal and pushes you toward it.",
    prompt: "Energetic: tie each session to the goal, end with a push to the next one; no hype without a figure."
  },
  straight: {
    label: "Straight talk",
    detail: "Blunt and realistic. Says what the data shows, calls out skipped sessions and excuses.",
    prompt: STRAIGHT_TALK
  },
  unfiltered: {
    label: "No filter",
    detail: "Straight talk with strong language and swearing. Hard on excuses, never on you as a person.",
    prompt:
      `${STRAIGHT_TALK} Swear freely in the athlete's language — at excuses and effort, never at the person; ` +
      "no slurs. Drop it at any mention of pain, injury, illness or distress."
  }
};

export function normalizeCoachStyle(value: unknown): CoachStyle {
  return (COACH_STYLES as readonly unknown[]).includes(value) ? (value as CoachStyle) : DEFAULT_COACH_STYLE;
}

/** The prompt block for a style, or nothing for `neutral`. */
export function coachStyleInstructions(style: CoachStyle | undefined): string | undefined {
  const entry = COACH_STYLE_CATALOG[normalizeCoachStyle(style)];
  if (!entry.prompt) return undefined;
  return (
    "## Coach style\n" +
    "Tone only: facts, advice and safety rules are unchanged, and card text (names, descriptions) stays " +
    "plain — it goes to COROS and the watch.\n" +
    entry.prompt
  );
}
