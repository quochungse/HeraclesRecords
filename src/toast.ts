import type { LucideIcon } from "lucide-react";

/**
 * A process-wide way to raise one of the app's existing toasts from anywhere in
 * the tree.
 *
 * The toast stack is driven by App's `message`/`error` state, which suits the
 * screens App itself owns. Views nested several levels down — the coach
 * analysis panels, for instance — have no path to that state and should not
 * have to thread a callback through every layer to say one sentence. A module
 * scoped emitter keeps the single `Toaster` as the only renderer.
 *
 * `info` is a thing done that needs no colour (a turn deleted, a setting
 * saved); `warning` something done with a consequence the athlete should
 * know; `error` something not done.
 */
export type ToastKind = "info" | "warning" | "error";

/**
 * Where a toast appears. What the athlete just did is answered at the bottom,
 * next to where they did it — the default. What the app says unasked (a labour
 * reached, a background load that failed, an update that would not download)
 * comes in at the top, so it never lands on top of the work.
 */
export type ToastPlacement = "top" | "bottom";

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface ToastOptions {
  placement?: ToastPlacement;
  /** A second, quieter line: the reason or the consequence. */
  detail?: string;
  /** What just happened, drawn in place of the kind's own mark. */
  icon?: LucideIcon;
  action?: ToastAction;
}

export interface ToastRequest extends ToastOptions {
  kind: ToastKind;
  text: string;
}

type ToastListener = (request: ToastRequest) => void;

const listeners = new Set<ToastListener>();

export function showToast(text: string, kind: ToastKind = "info", options: ToastOptions = {}): void {
  for (const listener of [...listeners]) {
    listener({ ...options, kind, text });
  }
}

/** Returns the unsubscribe, so it can be handed straight back from an effect. */
export function subscribeToToasts(listener: ToastListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
