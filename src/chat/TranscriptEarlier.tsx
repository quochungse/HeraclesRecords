import { useEffect, useRef, type RefObject } from "react";
import { t } from "../i18n/core";

/** How far above the transcript's visible part the earlier entries are fetched in. */
const LOOKAHEAD = "600px 0px";

/**
 * The top of a transcript that is drawn from its tail (`TRANSCRIPT_TAIL` in
 * ChatView): earlier entries come in as it is scrolled towards, and a press
 * brings them at once.
 *
 * Observed again every time `hidden` changes, not only when it first scrolls
 * into reach: a batch that comes in shorter than the lookahead leaves this
 * where it was, and an observer only speaks when the intersection *changes*,
 * so without a fresh one the reader would stop there until they scrolled away
 * and back.
 *
 * `overflow-anchor: none` (in the stylesheet) keeps the browser from choosing
 * this as the scroll anchor — it sits above what is added, so anchoring on it
 * would push the page the reader is on down by everything that came in.
 */
export function TranscriptEarlier({
  hidden,
  onReveal,
  scrollRef
}: {
  /** How many entries are not drawn yet. */
  hidden: number;
  onReveal: () => void;
  scrollRef: RefObject<HTMLDivElement | null>;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const revealRef = useRef(onReveal);
  revealRef.current = onReveal;

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          revealRef.current();
        }
      },
      { root: scrollRef.current, rootMargin: LOOKAHEAD }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hidden, scrollRef]);

  return (
    <button ref={ref} type="button" className="chat-transcript-earlier" onClick={onReveal}>
      {t("chat.earlier")}
    </button>
  );
}
