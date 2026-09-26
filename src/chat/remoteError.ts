/**
 * What a failed IPC call says, in its own words. Electron hands a rejected
 * `ipcRenderer.invoke` back as "Error invoking remote method 'chat:send':
 * Error: …", and the part before the colon is the plumbing, not the reason —
 * a brief refused for a missing race day read as a stack trace otherwise.
 */
export function remoteErrorMessage(caught: unknown, fallback: string): string {
  const message = caught instanceof Error ? caught.message : typeof caught === "string" ? caught : "";
  return message.replace(/^Error invoking remote method '[^']+': (?:[A-Za-z]*Error: )?/, "").trim() || fallback;
}
