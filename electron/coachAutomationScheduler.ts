import {
  emitAutomationBindingUpdate,
  emitAutomationRunUpdate,
  isWithinQuietHours,
  parseTimeOfDay,
  runAutomationTrigger
} from "./coachAutomationService";
import {
  listActiveCoachAutomationBindings,
  listCoachAutomations,
  recordCoachAutomationRun,
  setCoachAutomationBindingSchedule
} from "./coachAutomationStore";
import {
  PLAN_ADHERENCE_LOOKBACK_DAYS,
  THRESHOLD_LOOKBACK_DAYS,
  evaluateThresholdTrigger,
  toDayKey
} from "./coachThresholdMetrics";
import type { ThresholdSnapshot } from "./coachThresholdMetrics";
import {
  listCoachDailySamples,
  listCoachThresholdLoads,
  listCoachThresholdSlots
} from "./database";
import type {
  AutomationTrigger,
  CoachAutomation,
  CoachAutomationBinding,
  CoachAutomationRun
} from "./types";

/** 3.1: the tick is a minute, not a cron — a desktop app is not always up. */
export const SCHEDULER_TICK_INTERVAL_MS = 60_000;

/**
 * 3.1: a slot missed by more than a day is written off rather than run late.
 * An overnight briefing delivered at lunchtime is worse than no briefing.
 */
export const STALE_SLOT_MS = 24 * 60 * 60_000;

/**
 * 3.3: how long a threshold binding waits before re-offering a crossing the
 * runner refused.
 *
 * The transition is not consumed by a refusal (see `evaluateThresholdBinding`),
 * so without a hold the tick would re-offer it every sixty seconds and the run
 * log would fill with one identical skip a minute — the shape section 10 built
 * the pause to stop. Fifteen minutes is the activity watcher's own poll, which
 * is the rhythm section 4 already describes for a refused trigger coming round
 * again.
 *
 * In memory rather than on the binding: it is a rate limit on retries, not a
 * fact about the athlete's coach. A restart costs one extra skip row and then
 * re-establishes it, and `next_run_at` is not free to borrow — the automation
 * card reads it as "next fires at", which a threshold rule cannot promise.
 */
export const THRESHOLD_RETRY_INTERVAL_MS = 15 * 60_000;

type ScheduleTrigger = Extract<AutomationTrigger, { kind: "schedule" }>;
type ThresholdTrigger = Extract<AutomationTrigger, { kind: "threshold" }>;

export interface CoachAutomationSchedulerDeps {
  now(): Date;
  listAutomations(): CoachAutomation[];
  /** Enabled bindings of an enabled automation, per 2.4. */
  listActiveBindings(automationId: string): CoachAutomationBinding[];
  /** Only ever a real slot: see `bookNextSlot`. */
  setBindingNextRun(bindingId: string, nextRunAt: string): void;
  recordStaleSlot(input: {
    automationId: string;
    bindingId: string;
    sessionId?: string;
  }): CoachAutomationRun;
  runTrigger(event: {
    automationId: string;
    kind: "schedule" | "threshold";
    bindingIds: string[];
  }): Promise<CoachAutomationRun[]>;
  /** 3.3: every local row the four metrics read, fetched once per tick. */
  readThresholdSnapshot(now: Date): ThresholdSnapshot;
  /** 3.3: the transition state, beside the binding's other clocks. */
  setBindingThresholdFiring(bindingId: string, firing: boolean): void;
  onError(error: unknown): void;
}

function createDefaultDeps(): CoachAutomationSchedulerDeps {
  return {
    now: () => new Date(),
    listAutomations: () => listCoachAutomations(),
    listActiveBindings: (automationId) =>
      listActiveCoachAutomationBindings(automationId),
    setBindingNextRun: (bindingId, nextRunAt) => {
      // 9.1's next-run line, which is booked on a timer with nobody watching
      // and rendered by a card that was listening for runs. Booking is rare —
      // seeding a new binding, firing a slot, writing one off as stale, or
      // deferring one out of quiet hours — so this is not chatter.
      emitAutomationBindingUpdate(
        setCoachAutomationBindingSchedule(bindingId, { nextRunAt })
      );
    },
    recordStaleSlot: ({ automationId, bindingId, sessionId }) => {
      const finishedAt = new Date().toISOString();
      const run = recordCoachAutomationRun({
        automationId,
        bindingId,
        status: "skipped",
        triggerKind: "schedule",
        skipReason: "stale-slot",
        finishedAt,
        ...(sessionId ? { sessionId } : {})
      });
      emitAutomationRunUpdate(run);
      return run;
    },
    runTrigger: (event) => runAutomationTrigger(event),
    readThresholdSnapshot: (now) => {
      const since = new Date(now);
      since.setDate(since.getDate() - THRESHOLD_LOOKBACK_DAYS);
      const slotsSince = new Date(now);
      slotsSince.setDate(slotsSince.getDate() - PLAN_ADHERENCE_LOOKBACK_DAYS);
      return {
        loads: listCoachThresholdLoads(Math.floor(since.getTime() / 1000)).map(
          (row) => ({ startTime: row.start_time, load: row.training_load })
        ),
        daily: listCoachDailySamples(toDayKey(since)).map((row) => ({
          day: row.day,
          ...(row.resting_hr === null ? {} : { restingHr: row.resting_hr }),
          ...(row.sleep_minutes === null
            ? {}
            : { sleepMinutes: row.sleep_minutes })
        })),
        planned: listCoachThresholdSlots(toDayKey(slotsSince)).map((row) => ({
          day: row.happen_day,
          matched: row.matched === 1
        }))
      };
    },
    setBindingThresholdFiring: (bindingId, firing) => {
      setCoachAutomationBindingSchedule(bindingId, { thresholdFiring: firing });
    },
    onError: (error) => {
      console.error("[coach-automation] scheduler tick failed:", error);
    }
  };
}

// ---------------------------------------------------------------------------
// Slot maths
// ---------------------------------------------------------------------------

/**
 * The first slot strictly after `after`, in the athlete's local wall clock.
 *
 * Every step is a *calendar* step (`setDate`), never `+ 86_400_000`: adding a
 * fixed span of milliseconds across a daylight-saving boundary moves the run an
 * hour off the time the athlete asked for. Returns null for a malformed
 * `timeOfDay`, which the store already rejects on the way in.
 */
export function nextScheduleSlot(
  trigger: ScheduleTrigger,
  after: Date
): Date | null {
  const minutes = parseTimeOfDay(trigger.timeOfDay);
  if (minutes === null) {
    return null;
  }
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const stepDays = trigger.cadence === "weekly" ? 7 : 1;

  const slot = new Date(after);
  slot.setHours(hour, minute, 0, 0);
  if (trigger.cadence === "weekly") {
    const wanted = trigger.dayOfWeek ?? 1;
    slot.setDate(slot.getDate() + ((wanted - slot.getDay() + 7) % 7));
    // The day step can cross a boundary; re-stating the wall clock keeps the
    // slot on the requested time rather than an hour either side of it.
    slot.setHours(hour, minute, 0, 0);
  }

  // A time that does not exist on a spring-forward day (02:30 where 02:00 goes
  // straight to 03:00) resolves forward, so the loop still terminates.
  while (slot.getTime() <= after.getTime()) {
    slot.setDate(slot.getDate() + stepDays);
    slot.setHours(hour, minute, 0, 0);
  }
  return slot;
}

/**
 * When a quiet window that is open right now closes. Reuses the daily slot
 * maths, because "the next 06:00 from here" is the same question.
 */
export function quietHoursEnd(
  now: Date,
  quietHours: { start: string; end: string }
): Date | null {
  return nextScheduleSlot(
    { kind: "schedule", cadence: "daily", timeOfDay: quietHours.end },
    now
  );
}

function parseSlot(value: string | undefined): Date | null {
  if (!value) {
    return null;
  }
  const slot = new Date(value);
  return Number.isNaN(slot.getTime()) ? null : slot;
}

// ---------------------------------------------------------------------------
// The ticker
// ---------------------------------------------------------------------------

export class CoachAutomationScheduler {
  private readonly deps: CoachAutomationSchedulerDeps;
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;
  /**
   * 3.3: binding id -> the wall clock a refused crossing may be re-offered at.
   * See `THRESHOLD_RETRY_INTERVAL_MS` for why this is in memory rather than a
   * seventh column on the binding.
   */
  private readonly retryAfter = new Map<string, number>();

  constructor(deps: Partial<CoachAutomationSchedulerDeps> = {}) {
    this.deps = { ...createDefaultDeps(), ...deps };
  }

  start(intervalMs = SCHEDULER_TICK_INTERVAL_MS): void {
    if (this.timer) {
      return;
    }
    // Tied to the app process, never to a window (decision 1): a briefing due
    // with the window closed still runs and is read later.
    this.timer = setInterval(() => {
      void this.tick();
    }, intervalMs);
    this.timer.unref?.();
    // The catch-up pass of 3.1. It is the ordinary tick — a slot that came due
    // while the app was closed is simply a slot in the past — so it runs
    // immediately rather than up to a minute after launch.
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

  /** Visible for tests; safe to call concurrently. */
  async tick(): Promise<void> {
    if (this.ticking) {
      return;
    }
    this.ticking = true;
    try {
      const automations = this.deps.listAutomations();
      // Every binding this tick considered, so a hold left behind by one that
      // has since been detached does not sit in the map for the life of the
      // process. A re-attached binding is a new row with a new id (2.4), which
      // is also why its hold cannot be inherited by the place that replaced it.
      const seen = new Set<string>();
      // Read once per tick and only when something asks for it: the four
      // metrics of 3.3 read the same local rows, and a snapshot per binding
      // would scan a month of activities five times to get one answer.
      let snapshot: ThresholdSnapshot | null = null;
      const thresholdSnapshot = (now: Date): ThresholdSnapshot =>
        (snapshot ??= this.deps.readThresholdSnapshot(now));

      for (const automation of automations) {
        if (!automation.enabled) {
          continue;
        }
        const trigger = automation.trigger;
        if (trigger.kind !== "schedule" && trigger.kind !== "threshold") {
          continue;
        }
        const bindings = this.deps.listActiveBindings(automation.id);
        if (!bindings.length) {
          continue;
        }

        // The condition is a fact about the athlete, not about a binding, so it
        // is answered once for the automation and compared per binding. One
        // `now` for both halves: two reads can straddle a midnight and answer
        // about different days.
        const now = this.deps.now();
        const firing =
          trigger.kind === "threshold"
            ? evaluateThresholdTrigger(trigger, now, thresholdSnapshot(now))
            : false;

        for (const binding of bindings) {
          seen.add(binding.id);
          // Each binding keeps its own slot and its own firing state, so one
          // that is broken, deferred or brand new cannot hold up the others
          // (3.1, per-binding independence).
          try {
            if (trigger.kind === "threshold") {
              await this.evaluateThresholdBinding(automation, firing, binding);
            } else {
              await this.evaluateBinding(automation, trigger, binding);
            }
          } catch (error) {
            this.deps.onError(error);
          }
        }
      }
      for (const bindingId of this.retryAfter.keys()) {
        if (!seen.has(bindingId)) {
          this.retryAfter.delete(bindingId);
        }
      }
    } catch (error) {
      this.deps.onError(error);
    } finally {
      this.ticking = false;
    }
  }

  /**
   * 3.3: a rule fires when its condition *becomes* true, not on every tick it
   * stays true.
   *
   * Three states, and the third is the one that matters. `undefined` means this
   * binding has never been evaluated — a coach attached this morning — and its
   * first look records the answer and says nothing. Without it, attaching a
   * "tell me when my ramp is steep" rule during a steep block would fire
   * immediately on history the athlete already knows about.
   *
   * The state is written **before** the run, for the same reason 3.1 books the
   * next slot before firing: a run takes as long as the provider does and the
   * app may be closed mid-flight, so the worst case has to be one missed
   * announcement rather than the same one re-announced on every tick.
   */
  private async evaluateThresholdBinding(
    automation: CoachAutomation,
    firing: boolean,
    binding: CoachAutomationBinding
  ): Promise<void> {
    const now = this.deps.now();
    const previous = binding.thresholdFiring;

    if (previous === undefined) {
      // Never evaluated — a coach attached this morning, or one whose trigger
      // was just edited (the store resets both together). Either way there is
      // no crossing owed, so any hold from the old question goes with it.
      this.retryAfter.delete(binding.id);
      this.deps.setBindingThresholdFiring(binding.id, firing);
      return;
    }

    // The hovering case: a metric sitting on its threshold reports the same
    // answer tick after tick, and the athlete hears about it once.
    if (firing === previous) {
      return;
    }

    // Falling back below is recorded, not announced. The rule is "tell me when
    // this becomes true", and a coach that also spoke up every time a metric
    // recovered would be twice as loud for no more information. Recorded even
    // inside quiet hours and even while a retry is held off: it announces
    // nothing, and it is what re-arms the rule.
    if (!firing) {
      this.deps.setBindingThresholdFiring(binding.id, firing);
      this.retryAfter.delete(binding.id);
      return;
    }

    // Quiet hours defer a crossing, they do not swallow it — the same rule
    // `evaluateBinding` follows for a slot (3.1), and for the same reason. The
    // state is deliberately left unwritten: the condition is still true, so the
    // first tick after the window closes sees the identical transition and
    // announces it then. Writing it here and skipping in the runner would spend
    // the crossing on a night the athlete asked not to be spoken to, and the
    // rule would never fire again until the metric recovered and re-crossed.
    const quietHours = automation.conditions.quietHours;
    if (quietHours && isWithinQuietHours(now, quietHours)) {
      return;
    }

    // A crossing the runner refused is still owed. It is re-offered on this
    // binding's own retry rhythm rather than on the tick, so a backed-off,
    // capped or burst-guarded binding does not write one skip a minute for as
    // long as the refusal lasts.
    const holdUntil = this.retryAfter.get(binding.id);
    if (holdUntil !== undefined && now.getTime() < holdUntil) {
      return;
    }

    // The state is written **before** the run, for the same reason 3.1 books
    // the next slot before firing: a run takes as long as the provider does and
    // the app may be closed mid-flight, so the worst case is one missed
    // announcement rather than the same one re-announced on every tick.
    this.deps.setBindingThresholdFiring(binding.id, firing);

    // Guard rails 1-8 belong to the runner (section 4), exactly as they do for
    // a schedule: this decides *when*, and whether it may is the runner's call.
    const runs = await this.deps.runTrigger({
      automationId: automation.id,
      kind: "threshold",
      bindingIds: [binding.id]
    });

    // ...and if the runner's answer was "not now", the crossing was never
    // announced, so it must not be recorded as though it had been. An empty
    // answer is the pause holding the trigger at the gate (10); an all-skipped
    // one is a guard rail. Both are refusals that clear on their own — a quiet
    // hour ends, a cooldown elapses, a backoff expires, a login code is
    // entered — and a rule that quietly retired itself on the first of them
    // would be a rule that never fires again until the metric recovers and
    // crosses a second time.
    //
    // A run that reached the provider is not a refusal, whatever it concluded:
    // `success` and `silent` are the coach having looked, `cancelled` is the
    // athlete deciding they did not want to hear it, and `failed` already has
    // the backoff holding its binding off — re-offering there would loop
    // against a dead provider.
    const announced = runs.some((run) => run.status !== "skipped");
    if (announced) {
      this.retryAfter.delete(binding.id);
      return;
    }
    this.deps.setBindingThresholdFiring(binding.id, previous);
    this.retryAfter.set(binding.id, now.getTime() + THRESHOLD_RETRY_INTERVAL_MS);
  }

  private async evaluateBinding(
    automation: CoachAutomation,
    trigger: ScheduleTrigger,
    binding: CoachAutomationBinding
  ): Promise<void> {
    const now = this.deps.now();
    const slot = parseSlot(binding.nextRunAt);

    // No slot booked yet — a binding attached moments ago, or one whose
    // automation had its trigger edited. Book the next one and wait for it:
    // creating a "daily at 07:00" rule at lunchtime must not fire on the spot.
    if (!slot) {
      this.bookNextSlot(binding, nextScheduleSlot(trigger, now));
      return;
    }

    if (now.getTime() < slot.getTime()) {
      return;
    }

    if (now.getTime() - slot.getTime() > STALE_SLOT_MS) {
      // Written off, and the backlog behind it with it: the next slot is
      // computed from *now*, so a fortnight with the app closed logs one skip
      // rather than fourteen runs nobody asked for.
      this.deps.recordStaleSlot({
        automationId: automation.id,
        bindingId: binding.id,
        ...(binding.sessionId ? { sessionId: binding.sessionId } : {})
      });
      this.bookNextSlot(binding, nextScheduleSlot(trigger, now));
      return;
    }

    // Quiet hours defer, they never cancel (3.1): unlike an activity, a slot
    // has nowhere to wait. Moving it to the end of the window is the deferral,
    // and the window's end is by definition outside the window, so this
    // happens once rather than every tick.
    const quietHours = automation.conditions.quietHours;
    if (quietHours && isWithinQuietHours(now, quietHours)) {
      const end = quietHoursEnd(now, quietHours);
      if (end) {
        this.deps.setBindingNextRun(binding.id, end.toISOString());
        return;
      }
    }

    // Booked before the run, not after. A run takes as long as the provider
    // does, and the app may be closed mid-flight; advancing first means the
    // worst case is one missed briefing rather than the same slot retried on
    // every tick for the rest of the day.
    //
    // Booked from `now` rather than from `slot`, which is the same answer with
    // one fewer edge: a slot is only reached here once it is already due, so
    // "the first slot after now" can never land in the past the way
    // "slot + one cadence" can for a slot that is a whole day late.
    this.bookNextSlot(binding, nextScheduleSlot(trigger, now));

    // Guard rails 1-8 belong to the runner (section 4) and are not repeated
    // here. The scheduler decides *when*; whether it may is the runner's call.
    await this.deps.runTrigger({
      automationId: automation.id,
      kind: "schedule",
      bindingIds: [binding.id]
    });
  }

  private bookNextSlot(binding: CoachAutomationBinding, slot: Date | null): void {
    // Only a malformed `timeOfDay` has no next slot, and the store rejects
    // those on the way in. Writing null anyway would re-book nothing on every
    // tick for the life of the process, so nothing is written at all.
    if (!slot) {
      return;
    }
    this.deps.setBindingNextRun(binding.id, slot.toISOString());
  }
}

let scheduler: CoachAutomationScheduler | null = null;

/** Started from `app.whenReady()`, never from `createWindow`. */
export function startCoachAutomationScheduler(
  intervalMs = SCHEDULER_TICK_INTERVAL_MS
): CoachAutomationScheduler {
  scheduler ??= new CoachAutomationScheduler();
  scheduler.start(intervalMs);
  return scheduler;
}

/** Stopped from `before-quit`, never from the window's "closed". */
export function stopCoachAutomationScheduler(): void {
  scheduler?.stop();
  scheduler = null;
}
