// The notice a turn leaves under its answer when it broke after answering:
// "Coach stopped before finishing: …".
//
// It is saved with the transcript as an assistant message, which syncs to the
// athlete's other machines and goes back to the model on the next turn, so it
// is stored in English like every other stored sentence (docs/i18n-plan.md)
// and said again in the language on screen when it is drawn.

import { english, interpolate, screenSentence, t } from "../i18n/core";

const STOPPED_EARLY = english("chat.stoppedEarly");
const STOPPED_EARLY_PREFIX = STOPPED_EARLY.slice(0, STOPPED_EARLY.indexOf("{message}"));

/** The notice as it is stored, with the reason the turn ended. */
export function stoppedEarlyNotice(reason: string): string {
  return interpolate(STOPPED_EARLY, { message: reason });
}

/**
 * Stored text as the screen draws it: the notice above, and a fixed sentence
 * of the main process's (`screenSentence`), in the language on screen; any
 * other text — an answer, COROS's own words — as written.
 */
export function displayStoredNotice(content: string): string {
  if (content.startsWith(STOPPED_EARLY_PREFIX)) {
    return t("chat.stoppedEarly", {
      message: screenSentence(content.slice(STOPPED_EARLY_PREFIX.length))
    });
  }
  return screenSentence(content);
}
