/**
 * What a surface says when the COROS MCP server cannot serve it.
 *
 * Sleep, overnight HRV/stress, steps and calories are the only data that reach
 * this app through MCP, so they are the only empties with this cause — which
 * they used to blame the watch for, or point at Coach settings over.
 *
 * Each surface reads `mcpConnected` off the payload it already receives; the
 * services stamp it, cache hits included. Nothing here asks for a status.
 */

/** Keep in step with SettingsView; `test:mcp-notice` checks that it is. */
export const MCP_CONNECT_LOCATION = "Settings → Connections → MCP Servers";

export const MCP_CONNECT_HINT = `Please connect it in ${MCP_CONNECT_LOCATION}.`;

const fromMcp = (subject: string) =>
  `${subject} the COROS MCP server, which is not connected. ${MCP_CONNECT_HINT}`;

export const MCP_SLEEP_NOTICE = fromMcp("Sleep data comes from");
export const MCP_SLEEP_TREND_NOTICE = fromMcp("A sleep trend needs");
export const MCP_DAILY_HEALTH_NOTICE = fromMcp("Steps and calories come from");

/**
 * For empties *inside* a screen whose banner already gave the directions — the
 * Sleep screen has four, and repeating the full sentence in each turned one
 * problem into four paragraphs of the same advice.
 */
export const MCP_UNAVAILABLE_SHORT = "The COROS MCP server is not connected.";

/** A stat tile's one short line. The sentence it abbreviates sits below it. */
export const MCP_DAILY_HEALTH_TILE_DETAIL = "needs COROS MCP";

/** `false` is a service saying so; `undefined` is nothing having answered yet. */
export type McpConnectionState = boolean | undefined;

/**
 * The notice, or the copy that was there before it. `=== false` rather than
 * falsy, said once here instead of at each surface: an unanswered status must
 * not tell anyone to connect a server they already have.
 */
export function mcpTextOr(
  state: McpConnectionState,
  notice: string,
  fallback: string
): string {
  return state === false ? notice : fallback;
}
