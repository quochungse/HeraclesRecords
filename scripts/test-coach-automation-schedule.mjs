// Section 3.1: the schedule trigger. Slot maths, missed slots, DST boundaries
// and per-binding independence.
//
// Every assertion here is about the athlete's *local wall clock*, so the whole
// file runs in one fixed zone. America/New_York is chosen because 2026 gives it
// both boundaries: 8 March springs 02:00 -> 03:00, 1 November falls back.
process.env.TZ = "America/New_York";

import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Module = require("node:module");
const repoRoot = path.resolve(import.meta.dirname, "..");

// The scheduler reaches the runner and the store, which pull in electron and
// the better-sqlite3 native binding at require time. Every collaborator is
// injected per instance, so the stubs only exist to get the module loaded.
const fakeElectron = {
  BrowserWindow: Object.assign(class {}, { getAllWindows: () => [] }),
  app: { getPath: () => "/tmp", on: () => {}, whenReady: () => Promise.resolve() },
  safeStorage: { isEncryptionAvailable: () => false },
  shell: { openExternal: () => {} },
  net: { request: () => {} },
  session: { defaultSession: {} }
};
const originalLoad = Module._load;
Module._load = function patchedLoad(request, ...rest) {
  if (request === "electron") return fakeElectron;
  if (request === "better-sqlite3") return class FakeDatabase {};
  return originalLoad.call(this, request, ...rest);
};

const {
  CoachAutomationScheduler,
  SCHEDULER_TICK_INTERVAL_MS,
  STALE_SLOT_MS,
  nextScheduleSlot,
  quietHoursEnd
} = require(path.join(repoRoot, "dist-electron", "coachAutomationScheduler.js"));

assert.equal(SCHEDULER_TICK_INTERVAL_MS, 60_000, "3.1: the tick is 60 seconds");
assert.equal(STALE_SLOT_MS, 24 * 60 * 60_000, "3.1: a slot goes stale after a day");

const HOUR = 3_600_000;

/** Local wall clock, which is the only clock this feature has. */
const at = (year, month, day, hour, minute = 0) =>
  new Date(year, month - 1, day, hour, minute, 0, 0);

const daily = (timeOfDay) => ({ kind: "schedule", cadence: "daily", timeOfDay });
const weekly = (dayOfWeek, timeOfDay) => ({
  kind: "schedule",
  cadence: "weekly",
  dayOfWeek,
  timeOfDay
});

// ---------------------------------------------------------------------------
// Next-slot maths
// ---------------------------------------------------------------------------

assert.deepEqual(
  nextScheduleSlot(daily("07:00"), at(2026, 8, 20, 5, 30)),
  at(2026, 8, 20, 7, 0),
  "before today's time, the slot is today"
);

assert.deepEqual(
  nextScheduleSlot(daily("07:00"), at(2026, 8, 20, 9, 15)),
  at(2026, 8, 21, 7, 0),
  "after today's time, the slot is tomorrow"
);

// Strictly after, not "at or after": a slot that just ran must not be handed
// back as the next one, which would fire it again on the following tick.
assert.deepEqual(
  nextScheduleSlot(daily("07:00"), at(2026, 8, 20, 7, 0)),
  at(2026, 8, 21, 7, 0),
  "standing exactly on a slot yields the next one, never the same one"
);

// 20 August 2026 is a Thursday; 2 is Tuesday.
assert.equal(at(2026, 8, 20, 12).getDay(), 4, "fixture sanity: 20 Aug 2026 is a Thursday");
assert.deepEqual(
  nextScheduleSlot(weekly(2, "07:00"), at(2026, 8, 20, 12)),
  at(2026, 8, 25, 7, 0),
  "weekly rolls forward to the next matching weekday"
);
assert.deepEqual(
  nextScheduleSlot(weekly(4, "18:00"), at(2026, 8, 20, 12)),
  at(2026, 8, 20, 18, 0),
  "the matching weekday counts as today when the time has not passed"
);
assert.deepEqual(
  nextScheduleSlot(weekly(4, "18:00"), at(2026, 8, 20, 18, 0)),
  at(2026, 8, 27, 18, 0),
  "a weekly slot standing on its own time advances a whole week"
);

assert.equal(
  nextScheduleSlot(daily("nonsense"), at(2026, 8, 20, 12)),
  null,
  "a malformed time has no slot rather than a wrong one"
);

// ---------------------------------------------------------------------------
// Daylight saving
// ---------------------------------------------------------------------------

// 8 March 2026, 02:00 -> 03:00. The day is 23 real hours long, so a scheduler
// that advanced by a fixed 86_400_000 ms would deliver the 07:00 briefing at
// 08:00 — an hour late, every day, until the next boundary.
{
  const before = at(2026, 3, 7, 8, 0);
  const slot = nextScheduleSlot(daily("07:00"), before);
  assert.equal(slot.getHours(), 7, "spring forward: still 07:00 on the wall clock");
  assert.deepEqual(slot, at(2026, 3, 8, 7, 0));
  assert.equal(
    slot.getTime() - at(2026, 3, 7, 7, 0).getTime(),
    23 * HOUR,
    "spring forward: 23 real hours between two 07:00 slots"
  );
}

// 1 November 2026, 02:00 -> 01:00. The mirror image: 25 real hours.
{
  const slot = nextScheduleSlot(daily("07:00"), at(2026, 10, 31, 8, 0));
  assert.equal(slot.getHours(), 7, "fall back: still 07:00 on the wall clock");
  assert.equal(
    slot.getTime() - at(2026, 10, 31, 7, 0).getTime(),
    25 * HOUR,
    "fall back: 25 real hours between two 07:00 slots"
  );
}

// 02:30 does not exist on 8 March. The slot resolves to the moment the clock
// passes it rather than vanishing, and above all the search terminates.
{
  const slot = nextScheduleSlot(daily("02:30"), at(2026, 3, 8, 0, 30));
  assert.ok(
    slot.getTime() > at(2026, 3, 8, 0, 30).getTime(),
    "a time the clock skips still yields a slot in the future"
  );
  assert.equal(slot.getDate(), 8, "and it stays on the day it was due");
}

// A weekly slot crossing the same boundary keeps its hour too.
{
  const slot = nextScheduleSlot(weekly(0, "07:00"), at(2026, 3, 1, 8, 0));
  assert.deepEqual(slot, at(2026, 3, 8, 7, 0));
  assert.equal(slot.getHours(), 7, "weekly across DST: still 07:00");
}

// ---------------------------------------------------------------------------
// Quiet-window end
// ---------------------------------------------------------------------------

assert.deepEqual(
  quietHoursEnd(at(2026, 8, 20, 23, 30), { start: "22:00", end: "06:00" }),
  at(2026, 8, 21, 6, 0),
  "a window that wraps midnight ends tomorrow morning"
);
assert.deepEqual(
  quietHoursEnd(at(2026, 8, 21, 2, 0), { start: "22:00", end: "06:00" }),
  at(2026, 8, 21, 6, 0),
  "and from the far side of midnight, the same morning"
);

// ---------------------------------------------------------------------------
// The ticker
// ---------------------------------------------------------------------------

function harness({ automations, bindings, now }) {
  const clock = { value: now };
  const rows = new Map(bindings.map((binding) => [binding.id, { ...binding }]));
  const bookings = [];
  const staleSkips = [];
  const triggers = [];
  const errors = [];

  const deps = {
    now: () => clock.value,
    listAutomations: () => automations,
    listActiveBindings: (automationId) =>
      [...rows.values()].filter(
        (row) => row.automationId === automationId && row.enabled !== false
      ),
    setBindingNextRun: (bindingId, nextRunAt) => {
      bookings.push({ bindingId, nextRunAt });
      const row = rows.get(bindingId);
      if (!row) return;
      if (nextRunAt === null) delete row.nextRunAt;
      else row.nextRunAt = nextRunAt;
    },
    recordStaleSlot: (input) => {
      staleSkips.push(input);
      return { id: `skip-${staleSkips.length}`, status: "skipped", ...input };
    },
    runTrigger: async (event) => {
      triggers.push(event);
      return [];
    },
    onError: (error) => {
      errors.push(error);
    }
  };

  return {
    clock,
    rows,
    bookings,
    staleSkips,
    triggers,
    errors,
    deps,
    scheduler: new CoachAutomationScheduler(deps)
  };
}

const briefing = (patch = {}) => ({
  id: "auto-1",
  name: "Daily briefing",
  playbook: "Brief me.",
  enabled: true,
  trigger: daily("07:00"),
  conditions: { batchWindowMin: 20, cooldownMin: 120, maxRunsPerDay: 3 },
  runtime: {},
  ...patch
});

const binding = (patch = {}) => ({
  id: "bind-1",
  automationId: "auto-1",
  mode: "dedicated",
  sessionId: "sess-1",
  enabled: true,
  sortOrder: 0,
  createdAt: at(2026, 8, 1, 9).toISOString(),
  ...patch
});

// A binding the scheduler has never seen books its first slot and waits. Firing
// on sight would mean creating a "daily at 07:00" rule at lunchtime and getting
// the briefing immediately — which is not what "daily at 07:00" says.
{
  const h = harness({
    automations: [briefing()],
    bindings: [binding()],
    now: at(2026, 8, 20, 12, 0)
  });
  await h.scheduler.tick();
  assert.equal(h.triggers.length, 0, "a freshly seeded binding does not run");
  assert.deepEqual(h.bookings, [
    { bindingId: "bind-1", nextRunAt: at(2026, 8, 21, 7, 0).toISOString() }
  ]);
}

// Not due yet: nothing happens at all, including no rewrite of the booking.
{
  const h = harness({
    automations: [briefing()],
    bindings: [binding({ nextRunAt: at(2026, 8, 21, 7, 0).toISOString() })],
    now: at(2026, 8, 20, 12, 0)
  });
  await h.scheduler.tick();
  assert.deepEqual(h.triggers, []);
  assert.deepEqual(h.bookings, [], "an undue slot is left untouched");
}

// Due: the next slot is booked *before* the run, so a process that dies
// mid-answer loses one briefing rather than retrying the same slot all day.
{
  const h = harness({
    automations: [briefing()],
    bindings: [binding({ nextRunAt: at(2026, 8, 20, 7, 0).toISOString() })],
    now: at(2026, 8, 20, 7, 0, 30)
  });
  const order = [];
  const bookOriginal = h.deps.setBindingNextRun;
  h.deps.setBindingNextRun = (...args) => {
    order.push("book");
    bookOriginal(...args);
  };
  const runOriginal = h.deps.runTrigger;
  h.deps.runTrigger = async (...args) => {
    order.push("run");
    return runOriginal(...args);
  };
  await new CoachAutomationScheduler(h.deps).tick();

  assert.deepEqual(order, ["book", "run"], "the slot is booked before the run");
  assert.deepEqual(h.triggers, [
    { automationId: "auto-1", kind: "schedule", bindingIds: ["bind-1"] }
  ]);
  assert.equal(
    h.bookings[0].nextRunAt,
    at(2026, 8, 21, 7, 0).toISOString(),
    "and the next slot is tomorrow's, not today's again"
  );
}

// A slot missed by more than a day is written off, and the whole backlog behind
// it with it: one skip in the log, one slot booked, no runs. An overnight
// briefing delivered a week late is worse than no briefing.
{
  const h = harness({
    automations: [briefing()],
    bindings: [binding({ nextRunAt: at(2026, 8, 15, 7, 0).toISOString() })],
    now: at(2026, 8, 20, 12, 0)
  });
  await h.scheduler.tick();
  assert.deepEqual(h.triggers, [], "a stale slot never runs");
  assert.deepEqual(h.staleSkips, [
    { automationId: "auto-1", bindingId: "bind-1", sessionId: "sess-1" }
  ]);
  assert.equal(
    h.staleSkips.length,
    1,
    "five missed days are one skip, not five runs"
  );
  assert.equal(h.bookings[0].nextRunAt, at(2026, 8, 21, 7, 0).toISOString());
}

// Exactly on the 24h line is still late, not stale — the rule is "more than".
{
  const h = harness({
    automations: [briefing()],
    bindings: [binding({ nextRunAt: at(2026, 8, 19, 7, 0).toISOString() })],
    now: at(2026, 8, 20, 7, 0)
  });
  await h.scheduler.tick();
  assert.deepEqual(h.staleSkips, [], "a slot exactly a day late is still run");
  assert.equal(h.triggers.length, 1);
  assert.equal(
    h.bookings[0].nextRunAt,
    at(2026, 8, 21, 7, 0).toISOString(),
    "booked from now, so the run does not repeat on the next tick"
  );
}

// Quiet hours defer, they never cancel. Unlike an activity, a slot has nowhere
// to wait: dropping it loses the briefing outright.
{
  const quiet = briefing({
    trigger: daily("23:00"),
    conditions: {
      batchWindowMin: 20,
      cooldownMin: 120,
      maxRunsPerDay: 3,
      quietHours: { start: "22:00", end: "06:00" }
    }
  });
  const h = harness({
    automations: [quiet],
    bindings: [binding({ nextRunAt: at(2026, 8, 20, 23, 0).toISOString() })],
    now: at(2026, 8, 20, 23, 0, 30)
  });

  await h.scheduler.tick();
  assert.deepEqual(h.triggers, [], "nothing runs inside the window");
  assert.deepEqual(h.staleSkips, [], "and nothing is written off either");
  assert.equal(
    h.rows.get("bind-1").nextRunAt,
    at(2026, 8, 21, 6, 0).toISOString(),
    "the slot moves to the end of the window"
  );

  // The end of a window is by definition outside it, so the deferral happens
  // once rather than walking forward on every tick.
  h.clock.value = at(2026, 8, 21, 6, 0, 30);
  await h.scheduler.tick();
  assert.deepEqual(h.triggers, [
    { automationId: "auto-1", kind: "schedule", bindingIds: ["bind-1"] }
  ]);
  assert.equal(
    h.rows.get("bind-1").nextRunAt,
    at(2026, 8, 21, 23, 0).toISOString(),
    "and the cadence picks up again from the trigger, not from the deferral"
  );
}

// Per-binding independence (3.1): one definition, two conversations, two
// clocks. Attaching the coach somewhere new must not reset the first.
{
  const h = harness({
    automations: [briefing()],
    bindings: [
      binding({
        id: "bind-a",
        sessionId: "sess-a",
        nextRunAt: at(2026, 8, 20, 7, 0).toISOString()
      }),
      binding({
        id: "bind-b",
        sessionId: "sess-b",
        sortOrder: 1,
        nextRunAt: at(2026, 8, 21, 7, 0).toISOString()
      }),
      binding({ id: "bind-c", sessionId: "sess-c", sortOrder: 2 })
    ],
    now: at(2026, 8, 20, 7, 30)
  });
  await h.scheduler.tick();

  assert.deepEqual(
    h.triggers,
    [{ automationId: "auto-1", kind: "schedule", bindingIds: ["bind-a"] }],
    "only the due binding runs, and it runs alone"
  );
  assert.equal(
    h.rows.get("bind-b").nextRunAt,
    at(2026, 8, 21, 7, 0).toISOString(),
    "the binding that was not due keeps its own slot"
  );
  assert.equal(
    h.rows.get("bind-c").nextRunAt,
    at(2026, 8, 21, 7, 0).toISOString(),
    "and the new binding is seeded without borrowing anyone else's"
  );
}

// One broken binding must not strand the ones behind it in the loop.
{
  const h = harness({
    automations: [briefing()],
    bindings: [
      binding({ id: "bind-a", nextRunAt: at(2026, 8, 20, 7, 0).toISOString() }),
      binding({
        id: "bind-b",
        sortOrder: 1,
        nextRunAt: at(2026, 8, 20, 7, 0).toISOString()
      })
    ],
    now: at(2026, 8, 20, 7, 30)
  });
  h.deps.runTrigger = async (event) => {
    if (event.bindingIds[0] === "bind-a") throw new Error("provider exploded");
    h.triggers.push(event);
    return [];
  };
  await new CoachAutomationScheduler(h.deps).tick();

  assert.equal(h.errors.length, 1, "the failure is reported, not swallowed");
  assert.deepEqual(
    h.triggers,
    [{ automationId: "auto-1", kind: "schedule", bindingIds: ["bind-b"] }],
    "and the next binding still gets its turn"
  );
}

// Only schedule triggers, and only enabled ones.
{
  const h = harness({
    automations: [
      briefing({ id: "auto-off", enabled: false }),
      briefing({ id: "auto-activity", trigger: { kind: "activity", sportTypes: [] } })
    ],
    bindings: [
      binding({ id: "bind-off", automationId: "auto-off" }),
      binding({ id: "bind-activity", automationId: "auto-activity" })
    ],
    now: at(2026, 8, 20, 12, 0)
  });
  await h.scheduler.tick();
  assert.deepEqual(h.triggers, []);
  assert.deepEqual(
    h.bookings,
    [],
    "a disabled or non-schedule automation is not even given a slot"
  );
}

// A disabled binding is filtered out by the store's active-bindings query, so
// it is neither run nor seeded.
{
  const h = harness({
    automations: [briefing()],
    bindings: [binding({ enabled: false })],
    now: at(2026, 8, 20, 12, 0)
  });
  await h.scheduler.tick();
  assert.deepEqual(h.bookings, []);
}

// start() ticks immediately: the catch-up pass of 3.1. A slot that came due
// while the app was closed is handled at launch, not up to a minute later.
{
  const h = harness({
    automations: [briefing()],
    bindings: [binding({ nextRunAt: at(2026, 8, 20, 7, 0).toISOString() })],
    now: at(2026, 8, 20, 9, 0)
  });
  const scheduler = new CoachAutomationScheduler(h.deps);
  scheduler.start(60_000);
  assert.ok(scheduler.isRunning());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.triggers.length, 1, "the catch-up pass runs at startup");
  scheduler.stop();
  assert.equal(scheduler.isRunning(), false);
}

// Overlapping ticks. A run outlives its minute — the provider takes as long as
// it takes — and the next tick arrives with the rest of the bindings still
// unvisited. Without the guard it would start them alongside the one in flight.
{
  const h = harness({
    automations: [briefing()],
    bindings: [
      binding({ id: "bind-a", nextRunAt: at(2026, 8, 20, 7, 0).toISOString() }),
      binding({
        id: "bind-b",
        sortOrder: 1,
        nextRunAt: at(2026, 8, 20, 7, 0).toISOString()
      })
    ],
    now: at(2026, 8, 20, 9, 0)
  });
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  h.deps.runTrigger = async (event) => {
    h.triggers.push(event);
    await gate;
    return [];
  };
  const scheduler = new CoachAutomationScheduler(h.deps);
  const first = scheduler.tick();
  await scheduler.tick();
  assert.deepEqual(
    h.triggers.map((event) => event.bindingIds[0]),
    ["bind-a"],
    "the second tick is a no-op while the first is still working"
  );

  release();
  await first;
  assert.deepEqual(
    h.triggers.map((event) => event.bindingIds[0]),
    ["bind-a", "bind-b"],
    "and the waiting binding is reached by the tick that owns it, not skipped"
  );
}

console.log("PASS coach automation schedule");
