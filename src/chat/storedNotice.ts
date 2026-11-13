// The notice a turn leaves under its answer when it broke after answering:
// "Mentor stopped before finishing: …" ("Coach …" in transcripts stored before
// the rename, which are read the same way).
//
// It is saved with the transcript as an assistant message, which syncs to the
// athlete's other machines and goes back to the model on the next turn, so it
// is stored in English like every other stored sentence (docs/i18n-plan.md)
// and said again in the language on screen when it is drawn.

import { english, interpolate, screenSentence, t } from "../i18n/core";

const STOPPED_EARLY = english("chat.stoppedEarly");
const STOPPED_EARLY_PREFIX = STOPPED_EARLY.slice(0, STOPPED_EARLY.indexOf("{message}"));
const LEGACY_STOPPED_EARLY_PREFIX = STOPPED_EARLY_PREFIX.replace("Mentor", "Coach");
const NO_WORDS = english("chat.fail.noWords");

function stoppedEarlyPrefixOf(content: string): string | undefined {
  if (content.startsWith(STOPPED_EARLY_PREFIX)) return STOPPED_EARLY_PREFIX;
  if (content.startsWith(LEGACY_STOPPED_EARLY_PREFIX)) return LEGACY_STOPPED_EARLY_PREFIX;
  return undefined;
}

/** The notice as it is stored, with the reason the turn ended. */
export function stoppedEarlyNotice(reason: string): string {
  return interpolate(STOPPED_EARLY, { message: reason });
}

/** The notice under a turn that ended on its charts or cards without a word. */
export function noWordsNotice(): string {
  return stoppedEarlyNotice(NO_WORDS);
}

/** A stored reason in the language on screen: the app's own sentences are said again, the rest as written. */
export function stoppedReasonOnScreen(reason: string): string {
  return reason === NO_WORDS ? t("chat.fail.noWords") : screenSentence(reason);
}

/**
 * Stored text as the screen draws it: the notice above, and a fixed sentence
 * of the main process's (`screenSentence`), in the language on screen; any
 * other text — an answer, COROS's own words — as written.
 */
export function displayStoredNotice(content: string): string {
  const prefix = stoppedEarlyPrefixOf(content);
  if (prefix) {
    return t("chat.stoppedEarly", {
      message: stoppedReasonOnScreen(content.slice(prefix.length))
    });
  }
  return screenSentence(content);
}

/** The reason a stored stopped-early notice gives, or undefined for any other text. */
export function stoppedEarlyReason(content: string): string | undefined {
  const prefix = stoppedEarlyPrefixOf(content);
  return prefix ? content.slice(prefix.length) : undefined;
}
