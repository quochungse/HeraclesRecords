/**
 * A process-wide way to raise one of the app's existing toasts from anywhere in
 * the tree.
 *
 * The toast stack is driven by App's `message`/`error` state, which suits the
 * screens App itself owns. Views nested several levels down — the coach
 * automation panels, for instance — have no path to that state and should not
 * have to thread a callback through every layer to say one sentence. A module
 * scoped emitter keeps the single `Toaster` as the only renderer.
 */
export type ToastKind = "success" | "error";

type ToastListener = (kind: ToastKind, text: string) => void;

const listeners = new Set<ToastListener>();

export function showToast(text: string, kind: ToastKind = "success"): void {
  for (const listener of [...listeners]) {
    listener(kind, text);
  }
}

/** Returns the unsubscribe, so it can be handed straight back from an effect. */
export function subscribeToToasts(listener: ToastListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
