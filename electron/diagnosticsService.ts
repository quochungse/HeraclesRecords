import { app, clipboard, ipcMain, type BrowserWindow } from "electron";
import os from "node:os";
import path from "node:path";
import { DiagnosticsLog, withDiagnosticLogging } from "./diagnosticsLog";
import type {
  DiagnosticsSnapshot,
  RendererDiagnosticError
} from "./diagnosticsTypes";

// The error log behind Settings → Error logs (from upstream CorosLink 0.1.34).
// It stays on this machine — `<userData>/diagnostics/errors.json`, no setting
// and no localStorage key, so sync never sees it — and is redacted before it is
// written, not only before it is copied.

let log: DiagnosticsLog | undefined;
let getWindow: () => BrowserWindow | undefined = () => undefined;

function getLog(): DiagnosticsLog {
  return log ??= new DiagnosticsLog(
    path.join(app.getPath("userData"), "diagnostics", "errors.json"),
    {
      appVersion: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      osVersion: os.release(),
      electronVersion: process.versions.electron,
      nodeVersion: process.versions.node,
      chromeVersion: process.versions.chrome
    },
    [app.getPath("userData"), app.getAppPath(), os.homedir()]
  );
}

export function recordDiagnosticError(source: string, error: unknown): void {
  try { getLog().record(source, error); } catch { /* Diagnostics are best effort. */ }
}

/**
 * main.ts registers every handler through this instead of Electron's
 * `ipcMain`, so a failure is logged with its `cause` chain intact — Electron
 * flattens the error to a message on its way to the renderer.
 */
export const diagnosticIpcMain = {
  handle(channel: string, listener: Parameters<typeof ipcMain.handle>[1]): void {
    ipcMain.handle(
      channel,
      withDiagnosticLogging({ record: recordDiagnosticError }, channel, listener)
    );
  }
};

function assertMainWindow(
  event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent
): void {
  const contents = getWindow()?.webContents;
  if (!contents || event.sender !== contents || event.senderFrame !== contents.mainFrame) {
    throw new Error("Error logs are only available in the main window.");
  }
}

export function getDiagnostics(event: Electron.IpcMainInvokeEvent): DiagnosticsSnapshot {
  assertMainWindow(event);
  return getLog().snapshot();
}

export function clearDiagnostics(event: Electron.IpcMainInvokeEvent): DiagnosticsSnapshot {
  assertMainWindow(event);
  return getLog().clear();
}

export function copyDiagnostics(event: Electron.IpcMainInvokeEvent): DiagnosticsSnapshot {
  assertMainWindow(event);
  const snapshot = getLog().snapshot();
  clipboard.writeText(snapshot.report);
  return snapshot;
}

export function initializeDiagnostics(window: () => BrowserWindow | undefined): void {
  getWindow = window;
  getLog();
  // A fire-and-forget send, not a handled channel: the renderer's error
  // listener must not wait on, or fail because of, the log.
  ipcMain.on("diagnostics:rendererError", (event, input: RendererDiagnosticError) => {
    try { assertMainWindow(event); } catch { return; }
    if (!input || (input.kind !== "error" && input.kind !== "unhandledrejection") ||
      typeof input.name !== "string" || input.name.length > 160 || typeof input.message !== "string" ||
      input.message.length > 32_000 || (input.stack !== undefined &&
        (typeof input.stack !== "string" || input.stack.length > 32_000))) return;
    recordDiagnosticError(`renderer:${input.kind}`, {
      name: input.name,
      message: input.message,
      stack: input.stack
    });
  });
  // Observes a fatal error without changing how Node terminates on one.
  process.on("uncaughtExceptionMonitor", (error, origin) => recordDiagnosticError(`main:${origin}`, error));
}

export function observeDiagnosticWindow(window: BrowserWindow): void {
  window.webContents.on("render-process-gone", (_event, details) => {
    if (details.reason !== "clean-exit") {
      recordDiagnosticError("renderer:processGone", new Error(`${details.reason} (exit ${details.exitCode})`));
    }
  });
  window.webContents.on("did-fail-load", (_event, code, description, _url, isMainFrame) => {
    if (isMainFrame && code !== -3) {
      recordDiagnosticError("renderer:load", Object.assign(new Error(description), { code: String(code) }));
    }
  });
}
