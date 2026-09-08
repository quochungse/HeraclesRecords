// Publishing this machine's whole state, in uploadable pieces.
//
// `publishFullState` is what seeds a vault on first join and what makes a
// restore visible to the other machines, and both callers mark the vault seeded
// on the strength of what it returns. So the one property worth a suite is that
// it never reports success over a batch that did not leave the machine: the
// queue is in memory, and a vault marked seeded over an unsent publish is
// months of history stranded with a flag saying it was sent.
//
// Only the sink is exercised. `collectFullStateEntries` and
// `captureSyncableState` read the live database, which is `test-sync-twoway`'s
// and `test-backup-restore`'s ground; this file needs no database at all.

import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const distUrl = pathToFileURL(
  path.resolve(import.meta.dirname, "../dist-electron/sync/fullState.js")
);
const { publishFullState, PUBLISH_CHUNK_SIZE } = await import(
  `${distUrl.href}?cacheBust=${Date.now()}`
);

/** An entry only needs to be an object here: the sink never inspects one. */
function entries(count) {
  return Array.from({ length: count }, (_, index) => ({
    op: "set",
    scope: "setting",
    key: `k${index}`,
    payload: { value: String(index) },
    hlc: `${String(index).padStart(12, "0")}-0000-dev`
  }));
}

/**
 * A sink that pushes whatever is queued, until the batch named by `failAt`.
 *
 * Modelled on `SyncLoop`: a failed flush keeps the queue rather than dropping
 * it, which is exactly why a caller cannot tell an upload from a refusal by
 * looking at the entries it handed over.
 */
function fakeSink({ failAt = null } = {}) {
  const uploaded = [];
  let queue = [];
  let flushes = 0;
  return {
    uploaded,
    get queued() {
      return queue.length;
    },
    get flushes() {
      return flushes;
    },
    enqueue: (batch) => {
      queue.push(...batch);
    },
    flush: async () => {
      flushes += 1;
      if (failAt !== null && flushes >= failAt) {
        // The queue is kept, as the real loop keeps it.
        return { pushed: 0 };
      }
      const pushed = queue.length;
      uploaded.push([...queue]);
      queue = [];
      return { pushed };
    }
  };
}

// --- Nothing to publish ------------------------------------------------------

{
  const sink = fakeSink();
  const result = await publishFullState(sink, []);
  assert.deepEqual(result, { entries: 0, batches: 0 });
  assert.equal(sink.flushes, 0, "an empty publish touches the network at all");
}

// --- One batch ---------------------------------------------------------------

{
  const sink = fakeSink();
  const result = await publishFullState(sink, entries(5));
  assert.deepEqual(result, { entries: 5, batches: 1 });
  assert.equal(sink.uploaded.length, 1);
  assert.equal(sink.uploaded[0].length, 5);
}

// --- Chunking ----------------------------------------------------------------

{
  const total = PUBLISH_CHUNK_SIZE * 2 + 7;
  const sink = fakeSink();
  const result = await publishFullState(sink, entries(total));
  assert.deepEqual(
    result,
    { entries: total, batches: 3 },
    "a publish is split into chunks of PUBLISH_CHUNK_SIZE"
  );
  assert.deepEqual(
    sink.uploaded.map((batch) => batch.length),
    [PUBLISH_CHUNK_SIZE, PUBLISH_CHUNK_SIZE, 7],
    "each chunk is flushed on its own rather than piling into one upload"
  );
}

// --- A batch that does not go out --------------------------------------------
//
// The whole reason this file exists. Returning normally here is what let
// `seedVaultIfNeeded` and `republishAfterRestore` call `markSeeded()` over a
// publish that never happened.

{
  const total = PUBLISH_CHUNK_SIZE * 3;
  const sink = fakeSink({ failAt: 2 });
  await assert.rejects(
    () => publishFullState(sink, entries(total)),
    /stopped after 1 of 3 batches/,
    "an unsent batch has to reach the caller as a failure"
  );
  assert.equal(
    sink.uploaded.length,
    1,
    "only the batch that actually went is counted as uploaded"
  );
  assert.equal(
    sink.flushes,
    2,
    "it stops at the refusal rather than piling the rest onto the same queue"
  );
  assert.equal(
    sink.queued,
    PUBLISH_CHUNK_SIZE,
    "the entries stay queued, so the loop can retry them"
  );
}

// --- Offline from the first batch --------------------------------------------

{
  const sink = fakeSink({ failAt: 1 });
  await assert.rejects(
    () => publishFullState(sink, entries(3)),
    /stopped after 0 of 1 batches/,
    "a machine that was offline throughout must not read as published"
  );
  assert.equal(sink.uploaded.length, 0);
}

console.log("sync full-state publish: all assertions passed");
