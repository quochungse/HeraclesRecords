// Whose data this is.
//
// Sync mixes two machines' records together and a restore overwrites one
// machine with another's, so both need to be sure they are working on one
// person's data. The app has exactly one identity worth asking: the COROS
// account. Nothing else qualifies — the email only exists if "remember
// credentials" is on and is itself a credential, and the Google account
// identifies the *destination*, not the owner of what goes into it.
//
// **What travels is a fingerprint, never the id.** `trainingHub.userId` is
// `device` tier: it does not leave this machine, and this module is not a
// licence to change that. What leaves is an HMAC of it, which answers the only
// question anyone asks — "is this the same account?" — without putting a COROS
// user id in a vault on someone's Drive or in a file that gets emailed about.
//
// Be honest about the strength of that: the HMAC key is a constant in this
// source, exactly like `syncObfuscation.ts`, because every machine that joins a
// vault has to compute the same fingerprint with nothing asked of the user. A
// COROS user id is a short number, so anyone holding this file could confirm a
// guess. It stops the id being *readable* where it is stored; it is not a
// secret, and no UI copy may imply otherwise.
//
// This is a guard between machines and between files. It is deliberately not a
// data partition: the tables have no owner column, so switching COROS accounts
// on one machine leaves the previous account's conversations and plans sitting
// there, and a backup taken afterwards is labelled with the new account. That
// is a known limit, stated in the Settings copy, and closing it means giving
// every row an owner — a different piece of work.

import crypto from "node:crypto";

import { getSetting } from "./database";

/** Where the COROS account id lives. Mirrors `trainingHubService`'s own
 *  constant; imported from there would drag the whole service — and its
 *  network client — into every suite that touches ownership. */
const USER_ID_SETTING = "trainingHub.userId";

const FINGERPRINT_SECRET =
  "heracles-records/owner/v1:" +
  "2b8f47a1c9e3d05b6a4f81c72e9d3b508fa16c4d7b2e95038c1af64d29e7b350";

const FINGERPRINT_KEY: Buffer = Buffer.from(
  crypto.hkdfSync(
    "sha256",
    Buffer.from(FINGERPRINT_SECRET, "utf8"),
    Buffer.from("heracles-records/owner/salt/v1", "utf8"),
    Buffer.from("fingerprint", "utf8"),
    32
  )
);

/** Long enough that two accounts will not collide, short enough to read in a
 *  log line. The full digest buys nothing here: this is only ever compared. */
const FINGERPRINT_HEX = 16;

const FINGERPRINT_PATTERN = new RegExp(`^[0-9a-f]{${FINGERPRINT_HEX}}$`);

/** The fingerprint of one account id. Stable across machines and builds — it
 *  has to be, or two computers signed in to the same account would disagree
 *  about whether they are the same person. */
export function fingerprintOwner(userId: string): string {
  return crypto
    .createHmac("sha256", FINGERPRINT_KEY)
    .update(userId, "utf8")
    .digest("hex")
    .slice(0, FINGERPRINT_HEX);
}

/** True for a string this module could have produced. Guards against a vault
 *  or a file carrying something else in the field. */
export function isOwnerFingerprint(value: unknown): value is string {
  return typeof value === "string" && FINGERPRINT_PATTERN.test(value);
}

/**
 * Who this machine is acting as, or null when nobody is signed in.
 *
 * Read fresh every time rather than cached. Signing in and out happens while
 * the app runs, and a cached answer would have sync and backup acting for an
 * account that has since been replaced.
 */
export function currentOwner(): string | null {
  const userId = getSetting(USER_ID_SETTING);
  if (!userId) return null;
  return fingerprintOwner(userId);
}
