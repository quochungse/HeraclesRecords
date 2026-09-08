// Payload obfuscation for the sync vault.
//
// **Read this before trusting it with anything.** The algorithm is real
// AES-256-GCM, correctly used. The key is not secret: it is derived from a
// constant a few lines below, in a public repository, shipped inside every
// build. Anyone holding the app — or this file — can open every payload it
// writes. That is not a flaw to be fixed by hiding the constant better; a
// symmetric key that has to be present on every machine that joins a vault,
// with nothing asked of the user, cannot be secret. It is arithmetic, not
// carelessness.
//
// So what is it for? One thing, and it is worth having:
//
//   * Someone's training diary and months of coach conversations are not
//     sitting in a file that reads as prose. Drive's content indexing does not
//     see them, a synced-folder preview does not render them, a support bundle
//     or a screenshot of a file listing does not leak them, and a DLP scanner
//     walking the folder finds bytes. Every one of those is an *accidental*
//     disclosure, and accidental disclosure is what actually happens to backup
//     folders.
//
// No credential is in there to protect: sync carries user data only, and
// `syncPolicy.ts` is where that is enforced. This module is not a reason to
// change that — it could not carry the weight.
//
// What it is emphatically not is protection from anyone who went looking. The
// person who holds the destination can read it, and so can Google. Nothing in
// the UI may call this "encrypted" without that sentence next to it, and
// nothing in this codebase may treat it as a reason to store something it
// would otherwise refuse to store.
//
// It replaced a design that kept a random master key in `vault/keyring.json`
// beside the data. That gave the same practical protection — the key travelled
// with what it locked — at the cost of a file the user could delete and lose
// the vault with. A key that ships in the build cannot be lost.
//
// This module imports `node:crypto` and nothing else — neither Electron nor
// SQLite — so its suite runs under plain `node` with every branch reachable.

import crypto from "node:crypto";

// --- The key ----------------------------------------------------------------

/**
 * The input the payload key is derived from. Public, by construction — see the
 * file header.
 *
 * It is a constant in the source rather than something baked in per build on
 * purpose: every build has to be able to open every other build's vault, or a
 * self-built copy could not read what an official release wrote and the
 * multi-machine story would quietly break. Changing this value orphans every
 * sealed payload already written, so it is versioned in the string and would
 * need a read-both-ways path, not an edit.
 */
const OBFUSCATION_SECRET =
  "heracles-records/sync/obfuscation/v1:" +
  "7f3b1c9d8e2a45f60b1d3c8a95e7420fd6c81b3a9e5f2470c8d1a6b3f9e04c27";

const KEY_BYTES = 32;

/** HKDF rather than using the string's bytes directly: it costs nothing and
 *  means the key is uniform even though the input above is ASCII. */
const PAYLOAD_KEY: Buffer = Buffer.from(
  crypto.hkdfSync(
    "sha256",
    Buffer.from(OBFUSCATION_SECRET, "utf8"),
    Buffer.from("heracles-records/sync/salt/v1", "utf8"),
    Buffer.from("payload", "utf8"),
    KEY_BYTES
  )
);

// --- Envelope ---------------------------------------------------------------

/** 96 bits, the nonce size AES-GCM is specified and fastest for. */
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

/** File header: magic + format version. `HRSO` — Heracles Records, obfuscated.
 *  Deliberately not the `HRS1` the keyring-based design used, so a payload from
 *  that era is rejected rather than fed a key that cannot open it. */
export const ENVELOPE_MAGIC = Buffer.from("HRSO", "ascii");
const ENVELOPE_VERSION = 1;
export const ENVELOPE_HEADER_BYTES =
  ENVELOPE_MAGIC.length + 1 + NONCE_BYTES + TAG_BYTES;

export type SyncSealErrorCode =
  | "unreadable"
  | "malformed-envelope"
  | "unsupported-version";

export class SyncSealError extends Error {
  readonly code: SyncSealErrorCode;

  constructor(code: SyncSealErrorCode, message: string) {
    super(message);
    this.name = "SyncSealError";
    this.code = code;
  }
}

/**
 * Whether these bytes are a sealed payload.
 *
 * This is what lets one vault hold both kinds at once, which it must: sealing
 * every write is recent, so a folder can still hold plain payloads an earlier
 * build wrote, and a machine on that build reads what this one writes only
 * because it sniffs too. Every payload this engine ever wrote in the clear is
 * JSON or JSON Lines and so starts with `{`, which is why sniffing a four-byte
 * magic is safe rather than merely convenient.
 */
export function isSealed(payload: Buffer): boolean {
  return (
    payload.length >= ENVELOPE_HEADER_BYTES &&
    payload.subarray(0, ENVELOPE_MAGIC.length).equals(ENVELOPE_MAGIC)
  );
}

/**
 * Seal one payload.
 *
 * `aad` is authenticated but not encrypted. Pass the storage path so a payload
 * cannot be moved elsewhere in the vault and still open — swapping two
 * snapshots then fails the tag check instead of silently succeeding. With a
 * public key that is a consistency property, not a security one: anyone can
 * re-seal at whatever path they like. It is here to catch a mistake, not an
 * attacker.
 */
export function seal(plaintext: Buffer, aad?: string): Buffer {
  const nonce = crypto.randomBytes(NONCE_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", PAYLOAD_KEY, nonce);
  if (aad !== undefined) {
    cipher.setAAD(Buffer.from(aad, "utf8"));
  }
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([
    ENVELOPE_MAGIC,
    Buffer.of(ENVELOPE_VERSION),
    nonce,
    cipher.getAuthTag(),
    ciphertext
  ]);
}

/** Open a sealed payload. Callers gate on `isSealed` first; this still checks,
 *  because being handed the wrong bytes should say so rather than produce
 *  garbage. */
export function unseal(envelope: Buffer, aad?: string): Buffer {
  if (!isSealed(envelope)) {
    throw new SyncSealError(
      "malformed-envelope",
      "This payload was not written by the sync engine."
    );
  }
  const version = envelope[ENVELOPE_MAGIC.length];
  if (version !== ENVELOPE_VERSION) {
    throw new SyncSealError(
      "unsupported-version",
      `Unsupported payload version ${version}.`
    );
  }

  let offset = ENVELOPE_MAGIC.length + 1;
  const nonce = envelope.subarray(offset, (offset += NONCE_BYTES));
  const tag = envelope.subarray(offset, (offset += TAG_BYTES));
  const ciphertext = envelope.subarray(offset);

  const decipher = crypto.createDecipheriv("aes-256-gcm", PAYLOAD_KEY, nonce);
  decipher.setAuthTag(tag);
  if (aad !== undefined) {
    decipher.setAAD(Buffer.from(aad, "utf8"));
  }
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    // Edited bytes, a payload from a build with a different constant, or the
    // wrong path passed as AAD. GCM cannot tell them apart and neither should
    // the message.
    throw new SyncSealError(
      "unreadable",
      "This payload could not be read. It may have been edited, or written by " +
        "a version of the app that used a different format."
    );
  }
}
