// The payload seal, and the provider that applies it.
//
// Runs under plain `node`: syncObfuscation imports `node:crypto` and nothing
// else, and LocalFolderProvider imports only node builtins, so no Electron ABI
// is involved and every branch here is reachable.
//
// The point of this suite is not "encryption works" — AES-GCM works. It is to
// pin down the two things this design actually promises (someone's training
// diary is not readable at a glance; a vault holds sealed and plain payloads at
// once, because sealing every write is newer than the format) and the one it
// explicitly does not (secrecy, because the key ships in the build).
//
// No credential is in the vault to protect: sync carries user data only, which
// `test-sync-policy.mjs` is what enforces.
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
    `${pathToFileURL(path.join(repoRoot, "dist-electron", file)).href}${bust}`
  );

const {
  ENVELOPE_HEADER_BYTES,
  ENVELOPE_MAGIC,
  isSealed,
  seal,
  SyncSealError,
  unseal
} = await load("sync/syncObfuscation.js");
const { ObfuscatedProvider } = await load("sync/obfuscatedProvider.js");
const { LocalFolderProvider } = await load("sync/localFolderProvider.js");

const tempRoots = [];
function tempDir(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `heracles-${label}-`));
  tempRoots.push(dir);
  return dir;
}

/** The kind of thing actually in a payload: a line out of a coach conversation.
 *  Private, and worth keeping out of a folder preview — but re-readable by
 *  anyone holding the build, which is the whole point of the header above. */
const PRIVATE_LINE = "resting HR 41 all week and the tempo run still hurt";
const PAYLOAD = Buffer.from(
  JSON.stringify({ tables: { chat_sessions: [{ id: "s1", text: PRIVATE_LINE }] } }),
  "utf8"
);

// ===========================================================================
// The envelope
// ===========================================================================

{
  const sealed = seal(PAYLOAD, "snapshot/one.json");
  assert.deepEqual(unseal(sealed, "snapshot/one.json"), PAYLOAD);

  // The whole point, asserted: the credential is not readable in the file.
  assert.equal(
    sealed.includes(Buffer.from(PRIVATE_LINE, "utf8")),
    false,
    "a sealed payload must not carry the credential in the clear"
  );
  assert.equal(
    sealed.subarray(0, ENVELOPE_MAGIC.length).toString("ascii"),
    "HRSO",
    "and it must be recognisable as a sealed payload"
  );
  assert.equal(
    sealed.length,
    ENVELOPE_HEADER_BYTES + PAYLOAD.length,
    "AES-GCM is a stream cipher, so the overhead is exactly the header"
  );
}

// The key is in the build, not in the file. This is the assertion that pins
// down the design decision: an envelope that carried its own key would be
// readable by anything, app or not.
{
  const a = seal(PAYLOAD, "snapshot/one.json");
  const b = seal(PAYLOAD, "snapshot/one.json");
  assert.equal(
    a.equals(b),
    false,
    "a fresh nonce per write, so identical payloads do not produce identical bytes"
  );

  // Everything after the magic and version byte is nonce, tag and ciphertext.
  // Nothing in there is a 32-byte key, and there is nowhere else for one to be:
  // the envelope is exactly header + ciphertext, and the ciphertext is the same
  // length as the payload.
  assert.equal(
    a.length - ENVELOPE_HEADER_BYTES,
    PAYLOAD.length,
    "there is no room in the envelope for a key, by construction"
  );
}

// An unsealed payload is left alone, and recognised as such. Every payload the
// engine writes in the clear is JSON or JSON Lines, which is what makes the
// four-byte sniff safe.
{
  assert.equal(isSealed(PAYLOAD), false);
  assert.equal(isSealed(Buffer.from("{}", "utf8")), false);
  assert.equal(isSealed(Buffer.alloc(0)), false);
  assert.equal(
    isSealed(Buffer.from("HRSO", "ascii")),
    false,
    "the magic alone is too short to be an envelope"
  );
  assert.equal(isSealed(seal(Buffer.alloc(0), "x")), true);
  assert.deepEqual(
    unseal(seal(Buffer.alloc(0), "x"), "x"),
    Buffer.alloc(0),
    "an empty payload round trips"
  );
}

// The path is authenticated, so a payload cannot be read as though it lived
// somewhere else. A consistency check, not a security one — anyone holding the
// app can re-seal at any path they like.
{
  const sealed = seal(PAYLOAD, "snapshot/one.json");
  assert.throws(
    () => unseal(sealed, "snapshot/two.json"),
    (error) => error instanceof SyncSealError && error.code === "unreadable",
    "the wrong path must fail the tag check"
  );
  assert.throws(
    () => unseal(sealed),
    (error) => error instanceof SyncSealError && error.code === "unreadable",
    "and so must no path at all"
  );
}

// Edited bytes are refused rather than returned as garbage.
{
  const sealed = seal(PAYLOAD, "snapshot/one.json");
  const tampered = Buffer.from(sealed);
  tampered[tampered.length - 1] ^= 0x01;
  assert.throws(
    () => unseal(tampered, "snapshot/one.json"),
    (error) => error instanceof SyncSealError && error.code === "unreadable"
  );
}

// Bytes that are not an envelope, and envelopes from a future format.
{
  assert.throws(
    () => unseal(PAYLOAD, "snapshot/one.json"),
    (error) =>
      error instanceof SyncSealError && error.code === "malformed-envelope",
    "plain JSON is not an envelope"
  );
  assert.throws(
    () => unseal(Buffer.from("HRSO", "ascii"), "x"),
    (error) =>
      error instanceof SyncSealError && error.code === "malformed-envelope",
    "nor is a truncated one"
  );

  // The old keyring-era magic must be rejected outright, not fed a key that
  // cannot open it.
  const legacy = Buffer.concat([
    Buffer.from("HRS1", "ascii"),
    Buffer.alloc(ENVELOPE_HEADER_BYTES)
  ]);
  assert.equal(isSealed(legacy), false);
  assert.throws(
    () => unseal(legacy, "x"),
    (error) =>
      error instanceof SyncSealError && error.code === "malformed-envelope",
    "a payload from the keyring era is not this format"
  );

  const future = Buffer.from(seal(PAYLOAD, "x"));
  future[ENVELOPE_MAGIC.length] = 9;
  assert.throws(
    () => unseal(future, "x"),
    (error) =>
      error instanceof SyncSealError && error.code === "unsupported-version",
    "a newer version must say so rather than fail the tag check"
  );
}

// ===========================================================================
// The provider
// ===========================================================================

// Every write is sealed; not every read expects one. That asymmetry is what
// lets a vault written by an earlier build go on being readable.
{
  const root = tempDir("seal");
  const inner = new LocalFolderProvider({ root });
  const provider = new ObfuscatedProvider(inner);

  await provider.put("snapshot/sealed.json", PAYLOAD);
  const sealedOnDisk = fs.readFileSync(path.join(root, "snapshot/sealed.json"));
  assert.equal(isSealed(sealedOnDisk), true, "the wrapper seals unconditionally");
  assert.equal(
    sealedOnDisk.includes(Buffer.from(PRIVATE_LINE, "utf8")),
    false,
    "and what someone told their coach is not readable on disk"
  );

  // A plain payload, as a build from before unconditional sealing left behind.
  // Written past the wrapper on purpose: there is no longer any way to produce
  // one through it, which is exactly why the read path still has to cope.
  await inner.put("snapshot/plain.json", PAYLOAD);

  assert.deepEqual(
    (await provider.get("snapshot/sealed.json")).content,
    PAYLOAD,
    "a sealed payload opens"
  );
  assert.deepEqual(
    (await provider.get("snapshot/plain.json")).content,
    PAYLOAD,
    "and a plain one passes straight through rather than failing"
  );

  assert.equal(await provider.get("snapshot/missing.json"), null);
}

// The revision a sealed read reports is the one `put` will compare against,
// which is the inner provider's digest of the bytes on disk — not of the
// payload. Getting this wrong would make every conditional write fail.
{
  const root = tempDir("revision");
  const inner = new LocalFolderProvider({ root });
  const provider = new ObfuscatedProvider(inner);

  const written = await provider.put("oplog/a/00001.jsonl", PAYLOAD);
  const read = await provider.get("oplog/a/00001.jsonl");
  assert.equal(read.revision, written, "put and get must agree on the revision");
  assert.equal(
    read.revision,
    (await inner.get("oplog/a/00001.jsonl")).revision,
    "and it must be the revision of what is actually stored"
  );

  // A conditional write built on that revision has to be accepted.
  await provider.put("oplog/a/00001.jsonl", PAYLOAD, read.revision);

  // Listing is metadata only, so it reports the size on disk — larger than the
  // payload by exactly the envelope header.
  const [entry] = await provider.list("oplog");
  assert.equal(entry.size, ENVELOPE_HEADER_BYTES + PAYLOAD.length);
}

// A sealed payload is bound to its path through the provider too: copying one
// object over another's name does not produce a readable object.
{
  const root = tempDir("moved");
  const provider = new ObfuscatedProvider(new LocalFolderProvider({ root }));
  await provider.put("snapshot/one.json", PAYLOAD);
  fs.copyFileSync(
    path.join(root, "snapshot/one.json"),
    path.join(root, "snapshot/two.json")
  );
  await assert.rejects(
    provider.get("snapshot/two.json"),
    (error) => error instanceof SyncSealError && error.code === "unreadable",
    "a sealed snapshot copied into another slot must not open"
  );
}

await Promise.all(
  tempRoots.map((root) => fsp.rm(root, { recursive: true, force: true }))
);

console.log(
  "sync obfuscation OK — payload unreadable on disk, no key in the envelope, " +
    "path authenticated, tamper and legacy formats refused, sealed and plain " +
    "payloads share one vault, revisions survive the wrapper"
);
