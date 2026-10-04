import type { McpAvailability } from "../../electron/types";
import { t } from "../i18n/core.ts";

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

/**
 * Where the server is connected, in the screens' own words: the rail's
 * Settings, then the Connections card, then its MCP Servers row. Built from
 * those labels, so it cannot drift from them in any language;
 * `test:mcp-notice` checks the English route against the screens.
 */
export function mcpConnectLocation(): string {
  return `${t("nav.settings")} → ${t("settings.connections.title")} → ${t("settings.mcp.title")}`;
}

export function mcpConnectHint(): string {
  return t("app.mcp.hint.connect", { location: mcpConnectLocation() });
}

/** For a server that *is* connected here — nothing to add, something to renew. */
export function mcpRetryHint(): string {
  return t("app.mcp.hint.retry", { location: mcpConnectLocation() });
}

/**
 * What a surface's data is. The sentence is whole per subject and per way the
 * server failed: built from an opening and an ending, it read in English only.
 */
export type McpSubject = "sleep" | "sleepTrend" | "dailyHealth";
export const MCP_SLEEP_SUBJECT: McpSubject = "sleep";
export const MCP_SLEEP_TREND_SUBJECT: McpSubject = "sleepTrend";
export const MCP_DAILY_HEALTH_SUBJECT: McpSubject = "dailyHealth";

/**
 * For empties *inside* a screen whose banner already gave the directions — the
 * Sleep screen has four, and repeating the full sentence in each turned one
 * problem into four paragraphs of the same advice.
 */
export function mcpUnavailableShort(): string {
  return t("app.mcp.short.disconnected");
}
export function mcpUnreachableShort(): string {
  return t("app.mcp.short.unreachable");
}

/** A stat tile's one short line. The sentence it abbreviates sits below it. */
export function mcpDailyHealthTileDetail(): string {
  return t("app.mcp.tileDetail");
}

/**
 * The same room, for a server that is there and did not answer: a stat tile's
 * line and a panel heading. One message because it is one piece of news —
 * "connect it" is what differs per surface, not this.
 */
export function mcpUnreachableLabel(): string {
  return t("app.mcp.unreachableLabel");
}

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
  subject: McpSubject,
  state: McpConnectionState
): string | null {
  if (state === "disconnected") {
    return t(`app.mcp.${subject}.disconnected` as const, { hint: mcpConnectHint() });
  }
  if (state === "unreachable") {
    return t(`app.mcp.${subject}.unreachable` as const, { hint: mcpRetryHint() });
  }
  return null;
}

/** The notice, or the copy that was there before it. */
export function mcpTextOr(
  state: McpConnectionState,
  subject: McpSubject,
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
  if (state === "disconnected") return `${lead} ${mcpUnavailableShort()}`;
  if (state === "unreachable") return `${lead} ${mcpUnreachableShort()}`;
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
  if (state === "unreachable") return mcpUnreachableLabel();
  return fallback;
}
