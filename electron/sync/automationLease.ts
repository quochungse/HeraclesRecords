// One machine runs a scheduled analysis. Not three.
//
// coachAutomationScheduler is tied to the `app` lifecycle rather than to a
// window, so every machine that is switched on runs its own copy. Before sync
// that was correct — each install had its own analyses. Once the analyses
// themselves sync, the same 6am job exists on all three, and without a lease all
// three fire it: three times the tokens, three COROS fetches, and three
// identical approval cards for the person to dismiss.
//
// coachActivityWatcher has the same shape. It notices a new activity and
// triggers work; three machines notice the same activity.
//
// The lease is per analysis, not global. Two different analyses coming due
// at the same moment on two machines is fine and even desirable — what must not
// happen is the *same* one running twice.

import { Lease, type LeaseDeps, type LeaseHandle } from "./lease";

/** A run is short, but a coach turn can take a while and a slow model longer
 *  still. The TTL is not what makes a long run safe — `runExclusively` renews
 *  while the work is in flight — it is how long a *crashed* holder blocks the
 *  others. */
export const AUTOMATION_LEASE_TTL_MS = 10 * 60 * 1000;

/** How long a run waits on `catchUp` before going ahead on what this machine
 *  has. A pull after a long time away reads the snapshot, so a large vault on
 *  a slow link takes a while — but a vault that neither answers nor fails must
 *  not hold the run queue behind it for good. */
export const CATCH_UP_TIMEOUT_MS = 2 * 60 * 1000;

export interface AnalysisLeaseDeps
  extends Omit<LeaseDeps, "ttlMs"> {
  /** False when sync is off, in which case there is only one machine as far as
   *  anyone can tell and every run should simply proceed. */
  readonly enabled: () => boolean;
  readonly ttlMs?: number;
  readonly onSkipped?: (analysisId: string, holder: string) => void;
  /** Injected so the suite renews on demand instead of waiting out minutes. */
  readonly setTimer?: (fn: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
  /** Called when a renewal finds this device has been fenced out. The run is
   *  already past the point where it can be stopped, so this is a report. */
  readonly onLeaseLost?: (analysisId: string) => void;
  /** Brings this machine up to what the vault holds, once the lease is ours
   *  and before the work starts. The lease says nobody else is running this
   *  analysis *now*; it says nothing about a run another machine finished an
   *  hour ago, whose answer and watermark may still be on their way here.
   *  Pulled first, the run's own guards read them and stand down. The caller
   *  decides whether a pull is owed at all, and returns at once when not. */
  readonly catchUp?: () => Promise<void>;
  readonly catchUpTimeoutMs?: number;
  readonly onCatchUpFailed?: (analysisId: string, error: unknown) => void;
}

let deps: AnalysisLeaseDeps | null = null;

export function attachAnalysisLeases(next: AnalysisLeaseDeps | null): void {
  deps = next;
}

export function analysisLeaseName(analysisId: string): string {
  return `analysis-${analysisId}`;
}

/**
 * Run `work` on exactly one machine.
 *
 * With sync off — or before the vault is unlocked — this runs the work
 * unconditionally, which is both the old behaviour and the right one: there is
 * no shared vault to coordinate through, so there is nothing to coordinate.
 *
 * Returns `{ ran: false }` when another device holds the lease. That is a
 * normal outcome for two machines out of three and is not an error; the caller
 * records a skip rather than a failure.
 */
export async function runExclusively<T>(
  analysisId: string,
  work: () => Promise<T>
): Promise<{ ran: true; result: T } | { ran: false; holder?: string }> {
  const active = deps;
  if (!active?.enabled()) {
    return { ran: true, result: await work() };
  }

  const lease = new Lease(analysisLeaseName(analysisId), {
    provider: active.provider,
    deviceId: active.deviceId,
    now: active.now,
    ttlMs: active.ttlMs ?? AUTOMATION_LEASE_TTL_MS
  });

  const handle = await lease.acquire();
  if (!handle) {
    const held = await lease.read();
    const holder = held?.record.holder ?? "another device";
    active.onSkipped?.(analysisId, holder);
    return { ran: false, holder };
  }

  // Renewed while the work runs, at a third of the TTL so two renewals can fail
  // before the lease lapses. Without this a run slower than the TTL — a slow
  // model, a long tool fan-out, a laptop that suspended mid-run — let the next
  // device take the lease over and run the same analysis again: double the
  // tokens and two identical approval cards, the exact outcome this module
  // exists to prevent.
  const ttlMs = active.ttlMs ?? AUTOMATION_LEASE_TTL_MS;
  const setTimer = active.setTimer ?? ((fn, ms) => setInterval(fn, ms));
  const clearTimer =
    active.clearTimer ?? ((timer) => clearInterval(timer as NodeJS.Timeout));

  let held: LeaseHandle | null = handle;
  let renewing: Promise<void> = Promise.resolve();
  const heartbeat = setTimer(() => {
    // Serialised behind the previous renewal: two conditional writes racing on
    // one revision would fence this device out against itself.
    renewing = renewing.then(async () => {
      if (!held) return;
      try {
        held = await lease.renew(held);
        if (!held) active.onLeaseLost?.(analysisId);
      } catch {
        // A vault that cannot be reached is not a reason to abandon a run that
        // is already under way. The next tick tries again.
      }
    });
  }, Math.max(Math.floor(ttlMs / 3), 1_000));

  try {
    // Inside the heartbeat: a slow pull must not let the lease lapse under it.
    await catchUp(active, analysisId);
    return { ran: true, result: await work() };
  } finally {
    clearTimer(heartbeat);
    // The in-flight renewal has to settle before the release, or it would
    // rewrite the record this is about to delete and leave the lease behind
    // until it expired.
    await renewing;
    if (held) await lease.release(held);
  }
}

/**
 * The pull before a run. Never a reason not to run: an unreachable vault is a
 * sync problem, and the analysis goes ahead on what this machine has — as it
 * does with sync off. A pull that lands later during the run is still covered,
 * because a run whose conversation it changes is stopped.
 */
async function catchUp(active: AnalysisLeaseDeps, analysisId: string): Promise<void> {
  if (!active.catchUp) return;
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      active.catchUp(),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, active.catchUpTimeoutMs ?? CATCH_UP_TIMEOUT_MS);
      })
    ]);
  } catch (error) {
    active.onCatchUpFailed?.(analysisId, error);
  } finally {
    clearTimeout(timer);
  }
}
