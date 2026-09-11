import type { BrowserWindow } from "electron";
import {
  callMcpTool,
  connectMcpServer,
  disconnectMcpServer,
  ensureMcpServerConnected,
  getMcpServerCachedTools,
  getMcpServerStatus,
  getMcpServerTools
} from "./mcpClientManager";
import { prefixToolName } from "./mcpToolNames";
import type { CorosMcpStatus, CorosMcpTool } from "./types";

// Back-compat shim: COROS is now the built-in "coros" entry of the generic MCP
// registry (electron/mcpClientManager.ts). These wrappers keep the original
// signatures so sleepDataService, dailyHealthDataService, and the chatMcp:*
// IPC handlers keep working unchanged.

const COROS = "coros";

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
  await connectMcpServer(COROS, interactive, mainWindow ?? null);
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
    throw new Error("COROS MCP is not connected.");
  }
  return getMcpServerTools(COROS);
}

export function getCorosMcpTools(): CorosMcpTool[] {
  return getMcpServerCachedTools(COROS);
}

export async function callCorosMcpTool(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  return callMcpTool(prefixToolName(COROS, name), args);
}
