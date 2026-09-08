// The lease, and the thing it protects.
//
// Exclusivity is needed in exactly one place: a scheduled automation that
// exists on three machines because automations sync must run on one of them.
// Everything here is about that — one winner, fencing on takeover, and a
// failure that never leaves the automation locked for everybody.
//
// Runs under plain node: nothing in this path touches SQLite.
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const bust = `?cacheBust=${Date.now()}`;
const load = (file) =>
  import(
    `${pathToFileURL(path.join(repoRoot, "dist-electron", "sync", file)).href}${bust}`
  );

const { LocalFolderProvider } = await load("localFolderProvider.js");
const { Lease, isExpired, leasePath, DEFAULT_LEASE_TTL_MS } = await load(
  "lease.js"
);
const { attachAutomationLeases, runExclusively } = await load(
  "automationLease.js"
);

const roots = [];
const tempRoot = (label) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `heracles-${label}-`));
  roots.push(dir);
  return dir;
};

const providerFor = (root) => () => new LocalFolderProvider({ root });

// ===========================================================================
// The lease itself
// ===========================================================================

{
  const root = tempRoot("lease");
  let clock = 1_000_000;
  const depsFor = (device) => ({
    provider: providerFor(root),
    deviceId: () => device,
    now: () => clock,
    ttlMs: 60_000
  });

  const a = new Lease("thing", depsFor("device-a"));
  const b = new Lease("thing", depsFor("device-b"));

  assert.equal(a.path, leasePath("thing"));
  assert.equal(await a.read(), null, "nobody holds it to begin with");

  const held = await a.acquire();
  assert.ok(held, "the first claimant gets it");
  assert.equal(held.record.holder, "device-a");
  assert.equal(held.record.fencingToken, 1);

  assert.equal(await b.acquire(), null, "the second is refused while it is live");
  assert.equal((await b.read()).record.holder, "device-a", "and can see who has it");

  // Re-acquiring your own live lease renews rather than fails: a process that
  // restarted with time left should carry on.
  const again = await a.acquire();
  assert.ok(again, "the holder may re-acquire its own lease");
  assert.equal(again.record.holder, "device-a");

  // Expiry hands it over, and the fencing token moves.
  clock += 60_001;
  assert.equal(
    isExpired((await b.read()).record, clock),
    true,
    "the record reads as expired"
  );
  const takenOver = await b.acquire();
  assert.ok(takenOver, "an expired lease can be taken over");
  assert.equal(takenOver.record.holder, "device-b");
  assert.equal(
    takenOver.record.fencingToken,
    2,
    "and the fencing token advances, so the old holder can tell it was fenced"
  );

  // The fenced-out holder must not be able to write as if it were in charge.
  assert.equal(
    await a.renew(again),
    null,
    "a renewal from the fenced-out holder is refused"
  );

  await b.release(takenOver);
  assert.equal(await b.read(), null, "releasing clears it");
}

// Two devices both seeing an expired lease: still exactly one takeover.
{
  const root = tempRoot("takeover");
  let clock = 1_000_000;
  const make = (device) =>
    new Lease("contended", {
      provider: providerFor(root),
      deviceId: () => device,
      now: () => clock,
      ttlMs: 10_000
    });

  const first = await make("device-a").acquire();
  assert.ok(first);
  clock += 10_001;

  const contenders = ["b", "c", "d", "e"].map((suffix) =>
    make(`device-${suffix}`)
      .acquire()
      .then((handle) => (handle ? `device-${suffix}` : null))
  );
  const winners = (await Promise.all(contenders)).filter(Boolean);
  assert.equal(
    winners.length,
    1,
    "four devices all saw it expired; exactly one may take it"
  );
}

// Many claimants on a fresh lease: one winner.
{
  const root = tempRoot("race");
  const clock = 1_000_000;
  const attempts = Array.from({ length: 8 }, (_, i) =>
    new Lease("fresh", {
      provider: providerFor(root),
      deviceId: () => `device-${i}`,
      now: () => clock
    })
      .acquire()
      .then((handle) => (handle ? i : null))
  );
  const winners = (await Promise.all(attempts)).filter((v) => v !== null);
  assert.equal(winners.length, 1, "exactly one of eight wins a fresh lease");
}

// withLease reports a loss rather than raising: two machines out of three lose
// every time, and that is not a failure.
{
  const root = tempRoot("withlease");
  const clock = 1_000_000;
  const deps = (device) => ({
    provider: providerFor(root),
    deviceId: () => device,
    now: () => clock
  });

  const blocker = await new Lease("job", deps("device-a")).acquire();
  assert.ok(blocker);

  const outcome = await new Lease("job", deps("device-b")).withLease(async () => {
    assert.fail("the work must not run while another device holds the lease");
  });
  assert.deepEqual(outcome, { ran: false });

  await new Lease("job", deps("device-a")).release(blocker);
  const second = await new Lease("job", deps("device-b")).withLease(
    async () => "done"
  );
  assert.deepEqual(second, { ran: true, result: "done" });
  assert.equal(
    await new Lease("job", deps("device-b")).read(),
    null,
    "and the lease is released afterwards"
  );
}

// ===========================================================================
// Automation leases
// ===========================================================================

{
  attachAutomationLeases(null);
  let ran = 0;
  const outcome = await runExclusively("auto-1", async () => {
    ran += 1;
    return "done";
  });
  assert.deepEqual(outcome, { ran: true, result: "done" });
  assert.equal(ran, 1, "with leasing off every machine simply runs its own");
}

// Two schedulers, one automation due: exactly one run.
{
  const root = tempRoot("automation");
  const skipped = [];
  const attach = (device) =>
    attachAutomationLeases({
      enabled: () => true,
      provider: providerFor(root),
      deviceId: () => device,
      now: () => Date.now(),
      ttlMs: 60_000,
      onSkipped: (id, holder) => skipped.push({ device, id, holder })
    });

  let runs = 0;
  // device-a starts and is still working when device-b comes due.
  const held = await new Lease("automation-morning", {
    provider: providerFor(root),
    deviceId: () => "device-a",
    now: () => Date.now(),
    ttlMs: 60_000
  }).acquire();
  assert.ok(held, "device-a is running the morning automation");

  attach("device-b");
  const outcome = await runExclusively("morning", async () => {
    runs += 1;
    return "should not happen";
  });

  assert.deepEqual(
    outcome,
    { ran: false, holder: "device-a" },
    "the second scheduler stands down and says who is running it"
  );
  assert.equal(runs, 0, "and does not run the automation a second time");
  assert.equal(skipped.length, 1, "the skip is reported, not swallowed");

  // Once the first finishes, the next machine may run it.
  await new Lease("automation-morning", {
    provider: providerFor(root),
    deviceId: () => "device-a",
    now: () => Date.now()
  }).release(held);

  const later = await runExclusively("morning", async () => {
    runs += 1;
    return "ran";
  });
  assert.deepEqual(later, { ran: true, result: "ran" });
  assert.equal(runs, 1);
}

// Different automations do not block each other.
{
  const root = tempRoot("parallel");
  attachAutomationLeases({
    enabled: () => true,
    provider: providerFor(root),
    deviceId: () => "device-a",
    now: () => Date.now(),
    ttlMs: 60_000
  });

  const first = await runExclusively("morning", async () => "a");
  const second = await runExclusively("evening", async () => "b");
  assert.deepEqual(first, { ran: true, result: "a" });
  assert.deepEqual(
    second,
    { ran: true, result: "b" },
    "a lease is per automation, so a second one is not blocked by the first"
  );
}

// A run longer than the TTL keeps the lease, and a fenced-out holder is told.
//
// Without renewal the next device took the lease over mid-run and ran the same
// automation again — double the tokens, two identical approval cards.
{
  const root = tempRoot("automation-renew");
  const ttlMs = 3_000;
  let renewals = 0;
  const lost = [];
  let fire = null;

  attachAutomationLeases({
    enabled: () => true,
    provider: providerFor(root),
    deviceId: () => "device-a",
    now: () => Date.now(),
    ttlMs,
    // Held rather than scheduled, so the test decides when a heartbeat fires.
    setTimer: (fn) => {
      fire = fn;
      return 1;
    },
    clearTimer: () => {
      fire = null;
    },
    onLeaseLost: (id) => lost.push(id)
  });

  const before = await new Lease("automation-slow", {
    provider: providerFor(root),
    deviceId: () => "device-b",
    now: () => Date.now()
  }).read();
  assert.equal(before, null, "nobody holds it to begin with");

  const outcome = await runExclusively("slow", async () => {
    const first = await new Lease("automation-slow", {
      provider: providerFor(root),
      deviceId: () => "device-b",
      now: () => Date.now()
    }).read();
    const expiresAt = first.record.expiresAt;

    // A heartbeat, as the timer would deliver it.
    fire();
    await new Promise((resolve) => setImmediate(resolve));
    renewals += 1;

    const renewed = await new Lease("automation-slow", {
      provider: providerFor(root),
      deviceId: () => "device-b",
      now: () => Date.now()
    }).read();
    assert.ok(
      renewed.record.expiresAt >= expiresAt,
      "a heartbeat pushes the expiry out rather than leaving it to lapse"
    );
    assert.equal(
      renewed.record.holder,
      "device-a",
      "and the holder is unchanged"
    );
    return "finished";
  });

  assert.deepEqual(outcome, { ran: true, result: "finished" });
  assert.equal(renewals, 1);
  assert.deepEqual(lost, [], "the holder was never fenced out");
  assert.equal(
    await new Lease("automation-slow", {
      provider: providerFor(root),
      deviceId: () => "device-b",
      now: () => Date.now()
    }).read(),
    null,
    "and the lease is released once the run ends, renewals notwithstanding"
  );
}

// A holder fenced out mid-run learns about it instead of clobbering the winner.
{
  const root = tempRoot("automation-fenced");
  const lost = [];
  let fire = null;

  attachAutomationLeases({
    enabled: () => true,
    provider: providerFor(root),
    deviceId: () => "device-a",
    now: () => Date.now(),
    ttlMs: 3_000,
    setTimer: (fn) => {
      fire = fn;
      return 1;
    },
    clearTimer: () => {
      fire = null;
    },
    onLeaseLost: (id) => lost.push(id)
  });

  await runExclusively("stolen", async () => {
    // Another device takes it over — as it would after this one suspended past
    // the TTL — which invalidates the revision this holder renews against.
    await new LocalFolderProvider({ root }).put(
      leasePath("automation-stolen"),
      Buffer.from(
        JSON.stringify({
          holder: "device-b",
          expiresAt: Date.now() + 60_000,
          fencingToken: 99
        }),
        "utf8"
      )
    );
    fire();
    await new Promise((resolve) => setImmediate(resolve));
  });

  assert.deepEqual(
    lost,
    ["stolen"],
    "a renewal that loses the race reports it rather than throwing"
  );
  const after = await new Lease("automation-stolen", {
    provider: providerFor(root),
    deviceId: () => "device-c",
    now: () => Date.now()
  }).read();
  assert.equal(
    after.record.holder,
    "device-b",
    "and the fenced-out holder does not delete the winner's lease"
  );
}

// The lease is released even when the work throws.
{
  const root = tempRoot("throwing");
  attachAutomationLeases({
    enabled: () => true,
    provider: providerFor(root),
    deviceId: () => "device-a",
    now: () => Date.now(),
    ttlMs: 60_000
  });

  await assert.rejects(
    runExclusively("fragile", async () => {
      throw new Error("the run blew up");
    }),
    /the run blew up/
  );

  const after = await new Lease("automation-fragile", {
    provider: providerFor(root),
    deviceId: () => "device-b",
    now: () => Date.now()
  }).read();
  assert.equal(
    after,
    null,
    "a failed run must not leave the automation locked for everyone else"
  );
}

attachAutomationLeases(null);
await Promise.all(
  roots.map((root) => fsp.rm(root, { recursive: true, force: true }))
);

console.log(
  `lease OK — one winner per lease, fencing on takeover, ` +
    `automations run once across devices, a long run renews rather than ` +
    `lapsing, a fenced-out holder stands down, and a failed run releases`
);
void DEFAULT_LEASE_TTL_MS;
