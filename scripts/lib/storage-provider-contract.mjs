// The behaviour every StorageProvider owes the sync engine.
//
// Extracted so both backends run the *same* assertions rather than two
// hand-written suites that drift apart. If a change here makes Google Drive
// fail while the local folder still passes, the interface has grown a
// filesystem assumption — and the fix belongs in storageProvider.ts, not in a
// backend-specific carve-out.
//
// Backend-specific checks (a temp file on disk, an emptied directory, Drive's
// duplicate-name race) stay in each backend's own suite.

import assert from "node:assert/strict";

export const bytes = (text) => Buffer.from(text, "utf8");

/**
 * @param {object} options
 * @param {string} options.label                Backend name, for messages.
 * @param {() => Promise<{open: () => object}>} options.newStore
 *   Creates an empty store and returns a handle whose `open()` yields a
 *   provider over it. Calling `open()` twice models two devices sharing one
 *   store.
 * @param {object} options.errors               { StorageConflictError, StoragePathError }
 */
export async function runStorageProviderContract({ label, newStore, errors }) {
  const { StorageConflictError, StoragePathError } = errors;
  let checks = 0;
  const count = () => (checks += 1);

  async function rejectsConflict(promise, what, expectations = {}) {
    count();
    await assert.rejects(
      promise,
      (error) => {
        assert.ok(
          error instanceof StorageConflictError,
          `${label}: ${what} — expected a conflict, got ${error?.name}: ${error?.message}`
        );
        assert.equal(error.code, "conflict", `${label}: ${what}`);
        for (const [key, value] of Object.entries(expectations)) {
          assert.deepEqual(error[key], value, `${label}: ${what} — wrong ${key}`);
        }
        return true;
      },
      `${label}: ${what}`
    );
  }

  const eq = (actual, expected, what) => {
    count();
    assert.deepEqual(actual, expected, `${label}: ${what}`);
  };
  const is = (actual, expected, what) => {
    count();
    assert.equal(actual, expected, `${label}: ${what}`);
  };

  // --- Paths are validated before they reach any backend ---------------------

  {
    const { open } = await newStore();
    const provider = open();

    for (const bad of ["../escape", "oplog/../../escape", "/absolute", "back\\slash"]) {
      count();
      await assert.rejects(
        provider.put(bad, bytes("nope")),
        (error) => error instanceof StoragePathError,
        `${label}: ${JSON.stringify(bad)} must be refused before any write`
      );
    }
  }

  // --- Basic round trip ------------------------------------------------------

  {
    const { open } = await newStore();
    const provider = open();

    is(await provider.get("missing"), null, "an absent object reads null");
    eq(await provider.list(), [], "a fresh store is empty");

    const revision = await provider.put("snapshot/one.enc", bytes("hello"));
    count();
    assert.equal(typeof revision, "string", `${label}: put returns a revision`);
    count();
    assert.ok(revision.length > 0, `${label}: the revision is not empty`);

    const stored = await provider.get("snapshot/one.enc");
    eq(stored.content, bytes("hello"), "bytes round trip exactly");
    is(stored.revision, revision, "get reports the revision put returned");

    const binary = Buffer.from([0, 1, 2, 253, 254, 255, 0]);
    await provider.put("blob.bin", binary);
    eq((await provider.get("blob.bin")).content, binary, "binary survives intact");

    await provider.put("empty.bin", Buffer.alloc(0));
    eq(
      (await provider.get("empty.bin")).content,
      Buffer.alloc(0),
      "an empty object round trips"
    );

    await provider.put("snapshot/two.enc", bytes("hello"));
    is(
      (await provider.get("snapshot/two.enc")).revision,
      revision,
      "revision is derived from content, so equal bytes share one"
    );
    const changed = await provider.put("snapshot/one.enc", bytes("hello!"));
    count();
    assert.notEqual(
      changed,
      revision,
      `${label}: changed bytes must change the revision`
    );
    eq(
      (await provider.get("snapshot/one.enc")).content,
      bytes("hello!"),
      "an unconditional put replaces the content"
    );
  }

  // --- Listing ---------------------------------------------------------------

  {
    const { open } = await newStore();
    const provider = open();
    await provider.put("oplog/device-a/1.jsonl", bytes("a1"));
    await provider.put("oplog/device-a/2.jsonl", bytes("a2"));
    await provider.put("oplog/device-b/1.jsonl", bytes("b1"));
    await provider.put("snapshot/s.enc", bytes("snap"));

    const all = await provider.list();
    is(all.length, 4, "list walks the whole store");
    eq(
      all.map((entry) => entry.path).sort(),
      [
        "oplog/device-a/1.jsonl",
        "oplog/device-a/2.jsonl",
        "oplog/device-b/1.jsonl",
        "snapshot/s.enc"
      ],
      "paths come back POSIX-shaped and relative"
    );

    is((await provider.list("oplog")).length, 3, "a prefix filters");
    is((await provider.list("oplog/device-a")).length, 2, "a deeper prefix filters");
    is((await provider.list("oplog/")).length, 3, "a trailing slash is tolerated");
    is((await provider.list("nothing")).length, 0, "an unmatched prefix is empty");

    const entry = all.find((item) => item.path === "snapshot/s.enc");
    is(entry.size, 4, "size is the byte length");
    count();
    assert.ok(
      !Number.isNaN(Date.parse(entry.modifiedAt)),
      `${label}: modifiedAt parses as a date`
    );
  }

  // --- Optimistic concurrency ------------------------------------------------

  {
    const { open } = await newStore();
    const provider = open();

    await provider.put("free.txt", bytes("one"));
    await provider.put("free.txt", bytes("two"));
    eq(
      (await provider.get("free.txt")).content,
      bytes("two"),
      "an unconditional put always lands"
    );

    const claimed = await provider.put("lease.json", bytes("device-a"), null);
    await rejectsConflict(
      provider.put("lease.json", bytes("device-b"), null),
      "a second claim on an existing object must conflict",
      { expected: null, actual: claimed }
    );
    eq(
      (await provider.get("lease.json")).content,
      bytes("device-a"),
      "the loser must not have overwritten the winner"
    );

    const stale = claimed;
    const fresh = await provider.put("lease.json", bytes("device-a v2"), stale);
    await rejectsConflict(
      provider.put("lease.json", bytes("device-b"), stale),
      "a stale revision must be refused",
      { expected: stale, actual: fresh }
    );
    await provider.put("lease.json", bytes("device-a v3"), fresh);

    await rejectsConflict(
      provider.put("ghost.txt", bytes("x"), "some-revision"),
      "a revision precondition on a missing object must conflict",
      { actual: null }
    );
    is(await provider.get("ghost.txt"), null, "and must not create it");

    await provider.put("brandnew.txt", bytes("y"), null);
    eq(
      (await provider.get("brandnew.txt")).content,
      bytes("y"),
      "claiming an unused path creates it"
    );
  }

  // The race the lease in step 8 depends on: many claimants, exactly one winner.
  {
    const { open } = await newStore();
    const provider = open();
    const claimants = Array.from({ length: 8 }, (_, i) =>
      provider
        .put("lease/token.json", bytes(`device-${i}`), null)
        .then(() => `device-${i}`)
        .catch((error) => {
          assert.ok(
            error instanceof StorageConflictError,
            `${label}: a losing claimant must lose with a conflict, got ${error?.name}: ${error?.message}`
          );
          return null;
        })
    );
    const winners = (await Promise.all(claimants)).filter(Boolean);
    is(winners.length, 1, "exactly one claimant may win the lease");
    eq(
      (await provider.get("lease/token.json")).content,
      bytes(winners[0]),
      "the stored lease belongs to the winner"
    );
    is(
      (await provider.list("lease")).length,
      1,
      "and the losers leave nothing behind"
    );
  }

  // --- Deletion --------------------------------------------------------------

  {
    const { open } = await newStore();
    const provider = open();
    const revision = await provider.put("gone/soon.txt", bytes("bye"));

    await rejectsConflict(
      provider.delete("gone/soon.txt", "wrong-revision"),
      "deleting at a stale revision must conflict"
    );
    count();
    assert.ok(
      await provider.get("gone/soon.txt"),
      `${label}: a refused delete must leave the object alone`
    );

    await provider.delete("gone/soon.txt", revision);
    is(await provider.get("gone/soon.txt"), null, "delete removes it");

    await provider.delete("gone/soon.txt");
    await provider.delete("never/existed.txt");
    count();
    assert.ok(true, `${label}: deleting what is absent is idempotent`);
  }

  // --- Change feed -----------------------------------------------------------

  {
    const { open } = await newStore();
    const provider = open();

    const first = await provider.pollChanges();
    eq(first.changes, [], "an empty store reports no changes");

    await provider.put("a.txt", bytes("1"));
    await provider.put("b.txt", bytes("1"));
    const second = await provider.pollChanges(first.nextCursor);
    eq(
      second.changes.map((change) => change.path).sort(),
      ["a.txt", "b.txt"],
      "new objects appear as changes"
    );

    eq(
      (await provider.pollChanges(second.nextCursor)).changes,
      [],
      "polling again with no writes reports nothing"
    );

    await provider.put("a.txt", bytes("2"));
    await provider.delete("b.txt");
    const third = await provider.pollChanges(second.nextCursor);
    eq(
      [...third.changes].sort((x, y) => x.path.localeCompare(y.path)),
      [
        { path: "a.txt", revision: (await provider.get("a.txt")).revision },
        { path: "b.txt", revision: null }
      ],
      "edits carry the new revision and deletions carry null"
    );
  }

  // --- Two devices, one store ------------------------------------------------

  {
    const { open } = await newStore();
    const deviceA = open();
    const deviceB = open();

    await deviceA.put("oplog/a/1.jsonl", bytes("from A"));
    eq(
      (await deviceB.get("oplog/a/1.jsonl")).content,
      bytes("from A"),
      "one device sees what the other wrote"
    );

    is(await deviceB.get("shared.txt"), null, "B sees nothing yet");
    const revisionA = await deviceA.put("shared.txt", bytes("A wins"));
    await rejectsConflict(
      deviceB.put("shared.txt", bytes("B loses"), null),
      "B must not clobber a file A created while B was looking away",
      { actual: revisionA }
    );
    eq(
      (await deviceB.get("shared.txt")).content,
      bytes("A wins"),
      "and A's content survives"
    );
  }

  return checks;
}
