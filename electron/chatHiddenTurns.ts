import { HIDDEN_TURN_PLACEHOLDER, maskHiddenTurns } from "./chatTurns";
import { listChatHiddenTurns } from "./database";
import type { PersistedChatEntry } from "./types";

/**
 * The transcript as Coach reads it: the turns the athlete hid put out of
 * sight, every position kept (`maskHiddenTurns`). Everything that sends a
 * stored transcript to a model reads it through here — an analysis, the
 * summariser, recall, the compaction a conversation's menu runs; the window
 * masks its own copy the same way before a turn.
 *
 * Its own module so the services that read a transcript can import it
 * without importing each other.
 */
export function coachTranscript(sessionId: string, entries: readonly PersistedChatEntry[]): PersistedChatEntry[] {
  return maskHiddenTurns(entries, new Set(listChatHiddenTurns(sessionId)), () => ({
    ...HIDDEN_TURN_PLACEHOLDER,
    raw: { ...HIDDEN_TURN_PLACEHOLDER.raw }
  }));
}
