import type { BrowserWindow } from "electron";
import { corosMcpUrl, isCorosMcpUrl } from "./corosMcpRegions";
import {
  callMcpTool,
  connectMcpServer,
  disconnectMcpServer,
  ensureMcpServerConnected,
  getMcpServerCachedTools,
  getMcpServerStatus,
  getMcpServerTools
} from "./mcpClientManager";
import { getMcpServer } from "./mcpServersStore";
import { prefixToolName } from "./mcpToolNames";
import type {
  CorosMcpAccount,
  CorosMcpStatus,
  CorosMcpTool,
  McpAvailability,
  McpServerStatus
} from "./types";
import { ScreenError } from "./screenText";

// Back-compat shim: COROS is now the built-in "coros" entry of the generic MCP
// registry (electron/mcpClientManager.ts). These wrappers keep the original
// signatures so sleepDataService, dailyHealthDataService, and the chatMcp:*
// IPC handlers keep working unchanged.

const COROS = "coros";

// main.ts hands in the Training Hub account, so this module (which the sleep
// and health services import) stays free of trainingHubService.
let corosAccount: () => CorosMcpAccount = () => ({});

/** Supplies the COROS account the app is signed in with. */
export function setCorosMcpAccountSource(source: () => CorosMcpAccount): void {
  corosAccount = source;
}

/**
 * Connects a registered server. A COROS MCP server signs in with the account
 * the app already knows: its email is filled in on COROS's sign-in page, and
 * the built-in server moves to the account's regional endpoint before it is
 * first authorized — an EU account used to need an mcpeu server added by hand.
 * COROS's sign-in form takes the plaintext password, which is never stored
 * here, so it is still asked for there, once.
 */
export async function connectMcpServerWithCorosAccount(
  id: string,
  interactive = true,
  parentWindow: BrowserWindow | null = null
): Promise<McpServerStatus> {
  const server = getMcpServer(id);
  if (!interactive || !server || !isCorosMcpUrl(server.url)) {
    return connectMcpServer(id, interactive, parentWindow);
  }
  const account = readCorosAccount();
  return connectMcpServer(id, interactive, parentWindow, {
    loginHint: account.email,
    preferredUrl:
      server.builtin && account.region ? corosMcpUrl(account.region) : undefined
  });
}

function readCorosAccount(): CorosMcpAccount {
  try {
    return corosAccount();
  } catch {
    // Without the account the connection still works; the athlete types it in.
    return {};
  }
}

/**
 * Whether COROS data can be served — an open client *or* the means to open one.
 *
 * Not `status.connected` alone: that is `rt.client !== null`, false for the
 * whole of every launch until something calls `ensureCorosMcpConnected()`, so a
 * surface reading it would tell every cold start to connect a server whose
 * tokens are sitting right there. A token COROS has since rejected shows up
 * only when something tries, which is why an attempt overwrites this.
 */
export function isCorosMcpUsable(): boolean {
  const status = getMcpServerStatus(COROS);
  if (!status?.enabled) {
    return false;
  }

  return status.connected || status.authenticated;
}

/**
 * Which of the two failures a caller is looking at, once an attempt has come
 * back empty-handed.
 *
 * A server that is enabled and holds credentials was *meant* to work: it did
 * not answer this time, which is `"unreachable"` and needs no trip to Settings.
 * Anything else — no entry, disabled, never authorized — is `"disconnected"`,
 * and connecting it is the whole of the fix. Collapsing the two onto one
 * boolean sent every failed fetch to the same "please connect it" copy, on a
 * screen where the server was plainly connected.
 */
export function corosMcpFailureState(): Exclude<McpAvailability, "ready"> {
  const status = getMcpServerStatus(COROS);
  if (!status?.enabled || !status.authenticated) {
    return "disconnected";
  }
  return "unreachable";
}

/**
 * The same question as `isCorosMcpUsable`, answered so that a caller passing it
 * straight into a payload does not have to re-derive *why* it is unusable.
 */
export function corosMcpAvailability(): McpAvailability {
  return isCorosMcpUsable() ? "ready" : corosMcpFailureState();
}

export function getCorosMcpStatus(): CorosMcpStatus {
  const status = getMcpServerStatus(COROS);
  return {
    connected: status?.connected ?? false,
    authorized: status?.authenticated ?? false,
    tools: getMcpServerCachedTools(COROS)
  };
}

export async function connectCorosMcp(
  mainWindow?: BrowserWindow | null,
  interactive = true
): Promise<CorosMcpStatus> {
  await connectMcpServerWithCorosAccount(COROS, interactive, mainWindow ?? null);
  return getCorosMcpStatus();
}

export async function ensureCorosMcpConnected(): Promise<boolean> {
  return ensureMcpServerConnected(COROS);
}

export async function disconnectCorosMcp(): Promise<CorosMcpStatus> {
  await disconnectMcpServer(COROS);
  return getCorosMcpStatus();
}

export async function listCorosMcpTools(): Promise<CorosMcpTool[]> {
  if (!getMcpServerStatus(COROS)?.connected) {
    throw new ScreenError("main.coros.mcpNotConnected");
  }
  return getMcpServerTools(COROS);
}

export function getCorosMcpTools(): CorosMcpTool[] {
  return getMcpServerCachedTools(COROS);
}

/**
 * The COROS tool list, asked of the server again only when the list held
 * lacks what the caller needs. It is read on every connect, and a
 * `tools/list` is ~185 KB since the server grew to 34 tools — which every
 * sleep fill, daily-health read and night series used to pay, three times on
 * one visit to the Sleep screen.
 */
export async function corosMcpToolsHaving(
  has: (tools: CorosMcpTool[]) => boolean
): Promise<CorosMcpTool[]> {
  const cached = getCorosMcpTools();
  if (has(cached)) {
    return cached;
  }
  try {
    return await listCorosMcpTools();
  } catch {
    return cached;
  }
}

export async function callCorosMcpTool(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  return callMcpTool(prefixToolName(COROS, name), args);
}
