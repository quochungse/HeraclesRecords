import { t } from "../i18n/core";
import { useI18n } from "../i18n/useI18n";

export interface RailQuestion {
  /** The question's entry index, which is what a jump goes to. */
  index: number;
  text: string;
  hidden: boolean;
}

/** Below this many questions a conversation is short enough to scroll by eye. */
const RAIL_MIN_QUESTIONS = 3;

/**
 * The athlete's questions as a column of marks beside the transcript: hovered,
 * a mark says its question; pressed, the transcript goes to it. Answers and
 * cards take most of a long conversation's height, so the questions are what
 * a reader looks for when going back. A turn hidden from Coach is a hollow
 * mark. Alt + ↑ and ↓ step through the same list.
 */
export function QuestionRail({
  questions,
  active,
  onJump
}: {
  questions: RailQuestion[];
  /** The question whose turn is at the top of the transcript. */
  active: number | null;
  onJump: (index: number) => void;
}) {
  useI18n();
  if (questions.length < RAIL_MIN_QUESTIONS) return null;
  return (
    <nav className="chat-question-rail" aria-label={t("chat.rail.label")}>
      {questions.map((question, position) => (
        <button
          key={question.index}
          type="button"
          className={[
            "chat-question-tick",
            question.index === active ? "is-active" : "",
            question.hidden ? "is-hidden" : ""
          ]
            .filter(Boolean)
            .join(" ")}
          data-question={question.text}
          aria-label={t("chat.rail.question", { n: position + 1, text: question.text })}
          aria-current={question.index === active ? "true" : undefined}
          onClick={() => onJump(question.index)}
        >
          <i aria-hidden="true" />
        </button>
      ))}
    </nav>
  );
}

/** The question a reader at `scrollTop` is in: the last one whose row starts above the reading line. */
export function questionAtScroll(
  questions: readonly RailQuestion[],
  rowTop: (index: number) => number | undefined,
  readingLine: number
): number | null {
  let active: number | null = questions[0]?.index ?? null;
  for (const question of questions) {
    const top = rowTop(question.index);
    if (top !== undefined && top <= readingLine) active = question.index;
  }
  return active;
}
