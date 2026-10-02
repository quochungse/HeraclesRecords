import type { HeraclesRecordsApi } from "./heraclesrecords-api";

/** Hands an uncaught renderer error to the main process's error log. */
export function installRendererDiagnostics(api: HeraclesRecordsApi | undefined): void {
  if (!api?.reportRendererError) return;
  function report(kind: "error" | "unhandledrejection", value: unknown) {
    // A small, explicit shape; a rejected value of any other kind is never
    // serialised, since it could hold anything.
    try {
      const error = value instanceof Error ? value : null;
      api!.reportRendererError({
        kind,
        name: error?.name ?? "Error",
        message: (error?.message ?? (typeof value === "string" ? value : "Unknown renderer error")).slice(0, 32_000),
        stack: error?.stack?.slice(0, 32_000)
      });
    } catch { /* Reporting must not cause another unhandled error. */ }
  }
  window.addEventListener("error", (event) => report("error", event.error ?? event.message));
  window.addEventListener("unhandledrejection", (event) => report("unhandledrejection", event.reason));
}
