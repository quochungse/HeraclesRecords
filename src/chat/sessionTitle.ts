// A conversation's name as stored, and as shown.
//
// The defaults a conversation is given before it has a name of its own are
// written to SQLite and synced, so they stay English whatever the language
// (`DEFAULT_SESSION_TITLE` in electron/chatHistoryStore.ts writes "New chat").
// The screen names them in the language on screen; any other title is the
// athlete's or Coach's words and is drawn as written.

import { t } from "../i18n/core";

/** What a conversation AI Plan opened is called until its brief has a goal (P2.5). */
export const NEW_PLAN_TITLE = "New plan"; // i18n-ignore

const NEW_CHAT_TITLE = "New chat"; // i18n-ignore

export function displaySessionTitle(title: string | undefined | null): string {
  if (!title || title === NEW_CHAT_TITLE) return t("chat.newChat");
  if (title === NEW_PLAN_TITLE) return t("chat.newPlan");
  return title;
}
