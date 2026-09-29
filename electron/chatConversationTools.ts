import { getChatSessionCoachSummaryRow } from "./database";
import { getChatSession } from "./chatHistoryStore";
import { DEFAULT_RECALLED, MAX_RECALLED, recallEarlierTurns } from "./chatRecall";
import type { CorosMcpTool } from "./types";

/**
 * The conversation's own past, read back verbatim.
 *
 * Compaction folds the head of a long conversation into a summary, and a
 * summary keeps what its writer thought mattered — which is not always what the
 * athlete asks about three weeks later ("what easy pace did you give me?"). So
 * what a roll folds away stays reachable: the coach searches the part of the
 * transcript the summary stands in for and reads the exchanges that match,
 * rather than guessing from the summary or asking the athlete to repeat
 * themselves. That is what lets the budget in `chatContextCompaction.ts` be
 * tight without the conversation losing anything for good.
 *
 * Offered only to a turn whose conversation has a summary (`toolsForRun` in
 * `chatService.ts`): before the first roll every turn is already on the wire,
 * and the schema would be paid for on every round for nothing.
 */
export const RECALL_CONVERSATION_TOOL = "recall_conversation";

export const CHAT_CONVERSATION_TOOL_NAMES = [RECALL_CONVERSATION_TOOL] as const;

export type ChatConversationToolName = (typeof CHAT_CONVERSATION_TOOL_NAMES)[number];

export function isChatConversationTool(name: string): name is ChatConversationToolName {
  return (CHAT_CONVERSATION_TOOL_NAMES as readonly string[]).includes(name);
}

export function getChatConversationTools(): CorosMcpTool[] {
  return [
    {
      name: RECALL_CONVERSATION_TOOL,
      description:
        "Search the earlier part of this conversation — the turns the summary stands in for — and read " +
        "the matching exchanges word for word, dated. For a figure, a prescription or something the " +
        "athlete said that the summary does not hold.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "Words the exchange would contain, in the conversation's language (accents optional)."
          },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: MAX_RECALLED,
            description: `Exchanges to return, best matches first. Default ${DEFAULT_RECALLED}.`
          }
        },
        required: ["query"]
      }
    }
  ];
}

/** How far into a conversation its summary reaches; 0 when it has none. */
export function summarisedThrough(sessionId: string | undefined): number {
  if (!sessionId) return 0;
  const row = getChatSessionCoachSummaryRow(sessionId);
  const through = row?.coach_summary_through;
  return row?.coach_summary?.trim() && typeof through === "number" && Number.isFinite(through) && through > 0
    ? through
    : 0;
}

export function handleChatConversationTool(
  _name: ChatConversationToolName,
  args: Record<string, unknown>,
  { sessionId }: { sessionId?: string }
): string {
  if (!sessionId) {
    throw new Error("recall_conversation needs the conversation this turn belongs to.");
  }
  const query = typeof args.query === "string" ? args.query.trim() : "";
  const limit = typeof args.limit === "number" && Number.isFinite(args.limit) ? args.limit : DEFAULT_RECALLED;
  // Only the part the summary stands in for: the tail is on the wire already.
  const earlier = getChatSession(sessionId).slice(0, summarisedThrough(sessionId));
  return recallEarlierTurns(earlier, query, limit);
}
