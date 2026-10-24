import { useI18n } from "../../i18n/useI18n";
import { feltLabel } from "../useActivityFeelTypes";

/**
 * COROS's five end-of-activity faces, as the system's own emoji: very easy to
 * very hard, the same order the COROS app asks the question in.
 */
const FEEL_EMOJI: Readonly<Record<number, string>> = {
  1: "😄",
  2: "🙂",
  3: "😐",
  4: "😣",
  5: "😫"
};

/**
 * How the session felt, as the athlete rated it in the COROS app, under the
 * session's name: the face and the words, "😣 Felt hard".
 *
 * It was a line-drawn smiley at the end of every rated row in the list, in one
 * of five colours, and read as one more hue in a list already wearing the
 * sports'. One tag on the session open says it once, and the words say it
 * outright, so the face only has to agree with them.
 */
export function ActivityFeelTag({ rating }: { rating: number }) {
  useI18n();
  const label = feltLabel(rating);
  const emoji = FEEL_EMOJI[rating];
  if (!label || !emoji) {
    return null;
  }

  return (
    <span className="activity-feel-tag">
      <span className="activity-feel-emoji" aria-hidden="true">
        {emoji}
      </span>
      {label}
    </span>
  );
}
