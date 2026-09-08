// Sending the renderer's preferences to the sync loop.
//
// The other three stores announce their own changes: `database.setSetting` and
// the row writers call into `syncBridge` at the moment they write. localStorage
// cannot, because it is written from a dozen places across the app and any hook
// would be one call site behind the next preference someone adds.
//
// So this publishes by comparison instead. It hands the main process everything
// policy allows, on a timer and whenever the window is hidden, and the main
// process works out what actually moved — see `electron/sync/localStorageSync.ts`.
// A preference declared in `syncPolicy` is covered the moment it is declared,
// with nothing else to remember.
//
// The interval is not a poll of anything expensive: it reads a handful of keys
// and compares one string. An IPC call only happens when that string changes,
// and even then the main process usually finds nothing new — a merged value
// from the other machine, for instance, is already recorded as published.

import type { CorosLinkApi } from "../coroslink-api";
import { collectSyncableLocalStorage } from "./syncLocalStorage";

/**
 * How often the renderer looks for a preference change.
 *
 * Preferences are not worth a faster loop: nobody switches theme and then
 * watches the other laptop. Long enough to be free, short enough that a change
 * made before closing the lid has gone out — and `visibilitychange` covers the
 * lid anyway.
 */
export const PUBLISH_INTERVAL_MS = 15_000;

/** A stable string for "has anything changed", so the common case costs a
 *  comparison rather than an IPC round trip. Sorted because localStorage
 *  enumerates in insertion order, which shifts as keys are added and would
 *  otherwise make an unchanged set look different. */
function fingerprint(entries: Record<string, string>): string {
  return JSON.stringify(
    Object.keys(entries)
      .sort()
      .map((key) => [key, entries[key]])
  );
}

/**
 * Start publishing renderer preferences. Returns a stop function.
 *
 * Publishes immediately on start: that first pass is what carries the
 * preferences of a machine that has been in use for months into a vault it has
 * only just joined, the localStorage half of the seed the main process does for
 * rows and settings.
 */
export function startLocalStoragePublisher(api: CorosLinkApi): () => void {
  let lastSent: string | null = null;
  let stopped = false;
  let inFlight = false;

  const publish = (): void => {
    if (stopped || inFlight) return;
    const entries = collectSyncableLocalStorage();
    const current = fingerprint(entries);
    if (current === lastSent) return;

    inFlight = true;
    void api
      .publishSyncedLocalStorage(entries)
      .then((result) => {
        // Only a machine that is actually syncing has taken delivery. With sync
        // off the answer is honest and cheap, but recording it as sent would
        // mean switching sync on later published nothing: none of these
        // preferences would have changed since, so nothing would look new.
        lastSent = result.syncing ? current : null;
      })
      .catch(() => {
        // The call failed outright. Forget what was sent so the next pass tries
        // again rather than treating a failure as delivery.
        lastSent = null;
      })
      .finally(() => {
        inFlight = false;
      });
  };

  publish();
  const timer = window.setInterval(publish, PUBLISH_INTERVAL_MS);

  // Closing the laptop or switching apps is the moment a preference change is
  // most likely to be waiting, and the moment the other machine is most likely
  // to be picked up next.
  const onVisibilityChange = (): void => {
    if (document.visibilityState === "hidden") publish();
  };
  document.addEventListener("visibilitychange", onVisibilityChange);

  return () => {
    stopped = true;
    window.clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisibilityChange);
  };
}
