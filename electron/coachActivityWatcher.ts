import {
  getSetting,
  listUnseenCoachActivityRows,
  markAllCoachActivitiesSeen,
  markCoachActivitiesSeen,
  setSetting,
  upsertCoachDailySamples
} from "./database";
import type { CoachDailySampleRow, CoachUnseenActivityRow } from "./database";
import { getCorosMcpStatus } from "./corosMcpService";
import { getTrainingSleepData } from "./sleepDataService";
import { listCoachAutomations } from "./coachAutomationStore";
import {
  activityMatchesAutomation,
  runAutomationTrigger
} from "./coachAutomationService";
import {
  getDailyMetrics,
  getTrainingHubStatus,
  listTrainingHubActivities
} from "./trainingHubService";
import type { CoachAutomation, CoachAutomationRun } from "./types";

/** 3.2: the watcher polls this often for as long as the process is alive. */
export const ACTIVITY_POLL_INTERVAL_MS = 15 * 60_000;

/** How far back page 1 of the activity index is fetched. */
export const ACTIVITY_LOOKBACK_DAYS = 7;

const INITIALIZED_SETTING = "coachAutomation.activityWatcherInitializedAt";

/**
 * 3.3: the two series COROS owns rather than the app — resting HR and sleep —
 * snapshotted into `coach_daily_samples` so the scheduler's 60-second tick can
 * evaluate a threshold without a request of its own.
 *
 * It lives here because this is already the thing that talks to COROS on a slow
 * cadence, and at six hours it is slower still: the metrics it feeds are 7-,
 * 28- and 30-day windows, which do not move in an afternoon.
 */
const DAILY_SAMPLE_SETTING = "coachAutomation.dailySamplesCapturedAt";
export const DAILY_SAMPLE_INTERVAL_MS = 6 * 60 * 60_000;

/** Enough history for the widest window a metric reads (30 days), plus slack. */
export const DAILY_SAMPLE_LOOKBACK_DAYS = 35;

/**
 * A snapshot is best-effort and must never hold the watcher. Neither COROS call
 * on this path carries a deadline of its own, and one of them can reach an MCP
 * connect — the shape section 10 already paid for once.
 */
export const DAILY_SAMPLE_TIMEOUT_MS = 60_000;

export interface CoachActivityWatcherDeps {
  now(): Date;
  /** Pulls page 1 of the index; persisting into `training_activities` is its
   * documented side effect, which is exactly what the watcher diffs against. */
  refreshActivityIndex(startDay: string, endDay: string): Promise<void>;
  listUnseenActivities(sinceEpochSeconds?: number): CoachUnseenActivityRow[];
  markSeen(activityIds: string[]): void;
  markAllSeen(): number;
  listAutomations(): CoachAutomation[];
  isCorosAuthenticated(): boolean;
  getSetting(key: string): string | undefined;
  setSetting(key: string, value: string): void;
  runTrigger(event: {
    automationId: string;
    kind: "activity";
  }): Promise<CoachAutomationRun[]>;
  /** 3.3's local cache: what COROS says about these days, or [] if it cannot. */
  readDailySamples(startDay: string, endDay: string): Promise<CoachDailySampleRow[]>;
  writeDailySamples(rows: CoachDailySampleRow[], capturedAt: string): void;
  /** How long a snapshot may take before the watcher stops waiting on it. */
  dailySampleTimeoutMs: number;
  onError(error: unknown): void;
}

function happenDay(value: Date): string {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, "0");
  const day = `${value.getDate()}`.padStart(2, "0");
  return `${year}${month}${day}`;
}

function createDefaultDeps(): CoachActivityWatcherDeps {
  return {
    now: () => new Date(),
    refreshActivityIndex: async (startDay, endDay) => {
      await listTrainingHubActivities(1, 50, startDay, endDay);
    },
    listUnseenActivities: (since) => listUnseenCoachActivityRows(since),
    markSeen: (ids) => markCoachActivitiesSeen(ids),
    markAllSeen: () => markAllCoachActivitiesSeen(),
    listAutomations: () => listCoachAutomations(),
    isCorosAuthenticated: () => getTrainingHubStatus().authenticated,
    getSetting: (key) => getSetting(key),
    setSetting: (key, value) => setSetting(key, value),
    runTrigger: (event) => runAutomationTrigger(event),
    readDailySamples: async (startDay, endDay) => {
      const byDay = new Map<string, CoachDailySampleRow>();
      const row = (day: string): CoachDailySampleRow => {
        let existing = byDay.get(day);
        if (!existing) {
          existing = { day, resting_hr: null, sleep_minutes: null };
          byDay.set(day, existing);
        }
        return existing;
      };

      const metrics = await getDailyMetrics([startDay, endDay]);
      for (const entry of metrics.dayList) {
        if (typeof entry.rhr === "number" && Number.isFinite(entry.rhr)) {
          row(entry.happenDay).resting_hr = entry.rhr;
        }
      }

      // Sleep comes through the COROS MCP server. getTrainingSleepData only
      // ever reconnects silently from stored tokens now, so it cannot raise a
      // window on this unattended path; the status check just skips the work
      // when there is no session. Either way the cache keeps yesterday's
      // answer rather than writing a hole into the samples.
      if (getCorosMcpStatus().connected) {
        const sleep = await getTrainingSleepData(DAILY_SAMPLE_LOOKBACK_DAYS);
        for (const record of sleep.records) {
          if (record.kind === "nap") continue;
          if (
            typeof record.totalMinutes === "number" &&
            Number.isFinite(record.totalMinutes)
          ) {
            row(record.happenDay).sleep_minutes = record.totalMinutes;
          }
        }
      }

      return [...byDay.values()];
    },
    writeDailySamples: (rows, capturedAt) => {
      upsertCoachDailySamples(rows, capturedAt);
    },
    dailySampleTimeoutMs: DAILY_SAMPLE_TIMEOUT_MS,
    onError: (error) => {
      console.error("[coach-automation] activity watcher tick failed:", error);
    }
  };
}

// The matcher lives with the runner, which now owns activity selection too;
// re-exported here because this is where callers expect to find it.
export { activityMatchesAutomation };

const TIMED_OUT = Symbol("timed-out");

/** Resolves to `TIMED_OUT` rather than rejecting: a slow COROS is not an error. */
async function withDeadline<T>(
  work: Promise<T>,
  ms: number
): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<typeof TIMED_OUT>((resolve) => {
        timer = setTimeout(() => resolve(TIMED_OUT), ms);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export class CoachActivityWatcher {
  private readonly deps: CoachActivityWatcherDeps;
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;

  constructor(deps: Partial<CoachActivityWatcherDeps> = {}) {
    this.deps = { ...createDefaultDeps(), ...deps };
  }

  start(intervalMs = ACTIVITY_POLL_INTERVAL_MS): void {
    if (this.timer) {
      return;
    }
    // Tied to the app process, never to a window: a run started with the
    // window closed still completes and persists (Execution lifetime).
    this.timer = setInterval(() => {
      void this.tick();
    }, intervalMs);
    this.timer.unref?.();
    void this.tick();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  isRunning(): boolean {
    return this.timer !== null;
  }

  /** Visible for the scheduler and for tests; safe to call concurrently. */
  async tick(): Promise<void> {
    if (this.ticking) {
      return;
    }
    this.ticking = true;
    // Hoisted above both try blocks: the snapshot below runs whatever the
    // activity half did, so it needs the same two reads and must not repeat
    // them. Defaults cover the read itself throwing, in which case the snapshot
    // has nothing to act on either.
    let automations: CoachAutomation[] = [];
    let connected = false;
    try {
      // Read once and passed down. Three separate reads of the same list per
      // tick — poll, the catch-up and the snapshot — is three full
      // `listCoachAutomations()` calls, each of which parses and normalises
      // every stored definition. The list cannot change inside one tick: this
      // is the main process and nothing here awaits an IPC handler.
      automations = this.deps.listAutomations();
      connected = this.deps.isCorosAuthenticated();
      const { coldStart, fired } = await this.poll(automations, connected);
      if (!coldStart) {
        await this.offerOwedActivities(fired, automations, connected);
      }
    } catch (error) {
      this.deps.onError(error);
    }
    try {
      // Last, and outside the work above: activities are the time-sensitive
      // half of this tick — a run the athlete is waiting for — and a slow COROS
      // asked about a 30-day baseline must not stand in front of them.
      await this.snapshotDailySamples(this.deps.now(), automations, connected);
    } catch (error) {
      this.deps.onError(error);
    } finally {
      this.ticking = false;
    }
  }

  /**
   * Fires one payload-free trigger per matching automation, and reports which
   * ones — the catch-up below must not ask a second time for an automation this
   * poll already fired.
   *
   * `coldStart` is true on the tick that stamped the back catalogue.
   */
  private async poll(
    all: CoachAutomation[],
    connected: boolean
  ): Promise<{ coldStart: boolean; fired: Set<string> }> {
    const fired = new Set<string>();
    const automations = all.filter(
      (automation) => automation.enabled && automation.trigger.kind === "activity"
    );

    // The cold-start stamp still has to happen with no automations configured,
    // otherwise the athlete's whole history is "new" the day they add one.
    const firstRun = !this.deps.getSetting(INITIALIZED_SETTING);

    if (!connected) {
      return { coldStart: false, fired };
    }

    const now = this.deps.now();
    const start = new Date(now);
    start.setDate(start.getDate() - ACTIVITY_LOOKBACK_DAYS);
    await this.deps.refreshActivityIndex(happenDay(start), happenDay(now));

    if (firstRun) {
      this.deps.markAllSeen();
      this.deps.setSetting(INITIALIZED_SETTING, now.toISOString());
      return { coldStart: true, fired };
    }

    if (!automations.length) {
      // Nothing is listening, so keep the marker moving; otherwise a rule added
      // next week would fire for everything that landed in the meantime.
      const unseen = this.deps.listUnseenActivities();
      this.deps.markSeen(unseen.map((activity) => activity.activity_id));
      return { coldStart: false, fired };
    }

    const lookbackStart = Math.floor(start.getTime() / 1000);
    const unseen = this.deps.listUnseenActivities(lookbackStart);
    if (!unseen.length) {
      return { coldStart: false, fired };
    }

    const matched = automations.filter((automation) =>
      unseen.some((activity) => activityMatchesAutomation(activity, automation))
    );

    // Rows are stamped once every automation has had its look, whether or not
    // any of them matched. An unmatched activity is genuinely handled, and a
    // matched one is stamped before the trigger goes out: the flag means "the
    // watcher has looked at this", and it has. What each binding still owes is
    // the runner's answer from that binding's own watermark, and a run the
    // stamp outlived is re-offered by the catch-up below.
    this.deps.markSeen(unseen.map((activity) => activity.activity_id));

    // Several activities landing between two polls produce one trigger per
    // automation, not one per activity: the trigger says *look*, and the runner
    // selects the activities and fills in each run's payload itself.
    for (const automation of matched) {
      fired.add(automation.id);
      await this.deps.runTrigger({ automationId: automation.id, kind: "activity" });
    }
    return { coldStart: false, fired };
  }

  /**
   * Section 4's promise, which nothing was keeping: *"the next poll will find it
   * still unanalysed because the watermark did not move."*
   *
   * It did not. `coach_seen_at` is stamped as the poll fires, before the runner
   * has answered and whatever it answers — which is right, because the flag means
   * "the watcher has looked at this" and the watcher did. But the watcher's
   * *firing* condition was "there are unseen rows", so once a row was stamped
   * the trigger never came round again. A run refused for any reason — quiet
   * hours, a cooldown, a backoff, either pause, a signed-out provider — left
   * the activity owed by the binding's watermark and asked for by nobody. With
   * `multiActivity` off, which is the default, the next activity to arrive then
   * replaced it and it was never analysed at all.
   *
   * So the tick asks again. The split of 3.2 is untouched: this says *look
   * again*, and the runner still decides what is owed. A binding with nothing
   * pending produces an empty plan, which a non-manual trigger logs nothing for,
   * so the only automations this costs anything are the ones genuinely waiting.
   */
  private async offerOwedActivities(
    fired: Set<string>,
    all: CoachAutomation[],
    connected: boolean
  ): Promise<void> {
    // Behind the same gate `poll` uses, so the watcher keeps its one rule: it
    // does no work of any kind while COROS is disconnected. The runner's own
    // COROS check would try a reconnect on every one of these, and the tick
    // that finds the connection back re-offers everything anyway — nothing is
    // lost by waiting for it, which is the whole point of this method.
    if (!connected) {
      return;
    }
    for (const automation of all) {
      if (!automation.enabled || automation.trigger.kind !== "activity") {
        continue;
      }
      if (fired.has(automation.id)) {
        // Already asked this tick, by the poll that just found new activity.
        continue;
      }
      await this.deps.runTrigger({ automationId: automation.id, kind: "activity" });
    }
  }

  /**
   * 3.3's local cache, topped up at most every six hours and never allowed to
   * hold the watcher. A snapshot that fails leaves the cache exactly as it was,
   * which is the right answer: the metrics read multi-week windows, so one
   * missed top-up changes nothing, and a threshold that fired on a *cache* gap
   * rather than on the athlete's data would be worse than one that waited.
   */
  private async snapshotDailySamples(
    now: Date,
    all: CoachAutomation[],
    connected: boolean
  ): Promise<void> {
    // Deliberately not behind the "is anything listening for activities" check
    // in `poll`: a threshold rule has no activity trigger, so gating on *that*
    // would starve exactly the feature this cache exists for.
    //
    // It is gated on a threshold rule existing, though. This cache feeds
    // nothing else, and most athletes never write one — buying them a COROS
    // request every six hours forever to fill a table nobody reads is the kind
    // of cost section 13 exists to notice. A rule created later finds the cache
    // empty for one tick and then full, and its first evaluation only seeds
    // (3.3), so nothing is missed by waiting.
    if (!connected) {
      return;
    }
    const wanted = all.some(
      (automation) =>
        automation.enabled && automation.trigger.kind === "threshold"
    );
    if (!wanted) {
      return;
    }
    const last = this.deps.getSetting(DAILY_SAMPLE_SETTING);
    const lastAt = last ? Date.parse(last) : Number.NaN;
    if (
      Number.isFinite(lastAt) &&
      now.getTime() - lastAt < DAILY_SAMPLE_INTERVAL_MS
    ) {
      return;
    }

    const start = new Date(now);
    start.setDate(start.getDate() - DAILY_SAMPLE_LOOKBACK_DAYS);

    try {
      const rows = await withDeadline(
        this.deps.readDailySamples(happenDay(start), happenDay(now)),
        this.deps.dailySampleTimeoutMs
      );
      if (rows === TIMED_OUT) {
        // Deliberately not stamped: a call that never answered has not had its
        // turn, and stamping would hide the problem for six hours.
        this.deps.onError(new Error("Daily sample snapshot timed out."));
        return;
      }
      this.deps.writeDailySamples(rows, now.toISOString());
      this.deps.setSetting(DAILY_SAMPLE_SETTING, now.toISOString());
    } catch (error) {
      this.deps.onError(error);
    }
  }
}

let watcher: CoachActivityWatcher | null = null;

/** Started from `app.whenReady()`, never from `createWindow`. */
export function startCoachActivityWatcher(
  intervalMs = ACTIVITY_POLL_INTERVAL_MS
): CoachActivityWatcher {
  watcher ??= new CoachActivityWatcher();
  watcher.start(intervalMs);
  return watcher;
}

/** Stopped from `before-quit`, never from the window's "closed". */
export function stopCoachActivityWatcher(): void {
  watcher?.stop();
  watcher = null;
}
