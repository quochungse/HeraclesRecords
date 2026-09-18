import type { McpAvailability } from "../../electron/types";

/**
 * What a surface says when the COROS MCP server cannot serve it.
 *
 * Sleep, overnight HRV/stress, steps and calories are the only data that reach
 * this app through MCP, so they are the only empties with this cause — which
 * they used to blame the watch for, or point at Coach settings over.
 *
 * Each surface reads `mcpState` off the payload it already receives; the
 * services stamp it, cache hits included. Nothing here asks for a status.
 *
 * **"Not connected" and "could not be reached" are different things, and one
 * copy for both sent people the wrong way.** A server the athlete has never
 * set up needs connecting; one that is set up and answering nothing needs
 * nothing done in Settings at all — it is offline, or its authorization has
 * lapsed, and telling someone to connect a server that is sitting right there
 * in the list reads as the app not knowing its own state. `McpAvailability`
 * carries the two apart from the service that learned which it was; every
 * helper here takes that state rather than a boolean, and `undefined` — nothing
 * having answered yet — must say neither.
 */

/** Keep in step with SettingsView; `test:mcp-notice` checks that it is. */
export const MCP_CONNECT_LOCATION = "Settings → Connections → MCP Servers";

export const MCP_CONNECT_HINT = `Please connect it in ${MCP_CONNECT_LOCATION}.`;

/** For a server that *is* connected here — nothing to add, something to renew. */
export const MCP_RETRY_HINT =
  `It may be offline, or its connection may need renewing in ${MCP_CONNECT_LOCATION}.`;

/**
 * What a surface's data comes from, as the opening of a sentence. The rest of
 * the sentence depends on which way the server failed, so it is built rather
 * than written out.
 */
export const MCP_SLEEP_SUBJECT = "Sleep data comes from";
export const MCP_SLEEP_TREND_SUBJECT = "A sleep trend needs";
export const MCP_DAILY_HEALTH_SUBJECT = "Steps and calories come from";

/**
 * For empties *inside* a screen whose banner already gave the directions — the
 * Sleep screen has four, and repeating the full sentence in each turned one
 * problem into four paragraphs of the same advice.
 */
export const MCP_UNAVAILABLE_SHORT = "The COROS MCP server is not connected.";
export const MCP_UNREACHABLE_SHORT = "The COROS MCP server could not be reached.";

/** A stat tile's one short line. The sentence it abbreviates sits below it. */
export const MCP_DAILY_HEALTH_TILE_DETAIL = "needs COROS MCP";

/**
 * The same room, for a server that is there and did not answer: a stat tile's
 * line and a panel heading. One constant because it is one piece of news —
 * "connect it" is what differs per surface, not this.
 */
export const MCP_UNREACHABLE_LABEL = "COROS MCP unreachable";

/**
 * `"ready"` is a server that answered (the data may still be empty);
 * `undefined` is nothing having answered yet.
 */
export type McpConnectionState = McpAvailability | undefined;

/** Whether this state is the server's fault rather than the data's. */
export function isMcpFailure(state: McpConnectionState): boolean {
  return state === "disconnected" || state === "unreachable";
}

/**
 * The whole sentence, or `null` when the server is not what went wrong. Said
 * once here instead of at each surface: an unanswered status must not tell
 * anyone to connect a server they already have.
 */
export function mcpNotice(
  subject: string,
  state: McpConnectionState
): string | null {
  if (state === "disconnected") {
    return `${subject} the COROS MCP server, which is not connected. ${MCP_CONNECT_HINT}`;
  }
  if (state === "unreachable") {
    return `${subject} the COROS MCP server, which could not be reached. ${MCP_RETRY_HINT}`;
  }
  return null;
}

/** The notice, or the copy that was there before it. */
export function mcpTextOr(
  state: McpConnectionState,
  subject: string,
  fallback: string
): string {
  return mcpNotice(subject, state) ?? fallback;
}

/**
 * The short form, behind whatever the surface itself has to say — "No nights
 * to trend." plus the cause, rather than a second paragraph of directions.
 */
export function mcpShortTextOr(
  state: McpConnectionState,
  lead: string,
  fallback: string
): string {
  if (state === "disconnected") return `${lead} ${MCP_UNAVAILABLE_SHORT}`;
  if (state === "unreachable") return `${lead} ${MCP_UNREACHABLE_SHORT}`;
  return fallback;
}

/**
 * A heading, which has room for neither a hint nor a subject.
 *
 * Only the `disconnected` title is the caller's, because only that one has
 * anything to say about *their* data ("Sleep needs MCP"). A server that is
 * there and silent is the same news on every screen, so it reads the same.
 */
export function mcpTitleOr(
  state: McpConnectionState,
  disconnected: string,
  fallback: string
): string {
  if (state === "disconnected") return disconnected;
  if (state === "unreachable") return MCP_UNREACHABLE_LABEL;
  return fallback;
}
