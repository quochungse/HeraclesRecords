// Settings that hold a credential, kept encrypted at rest.
//
// The COROS session token, Spotify's client secret and tokens, and Apple
// Music's captured headers were written to `app_settings` as plain text, next
// to secrets that already went through `safeStorage`. This module is the one
// way those are read and written now.
//
// A stored value is `enc:v1:` followed by the `safeStorage` ciphertext in
// base64. Anything without the prefix is a value an earlier build wrote in the
// clear: it is read as it is and encrypted on the spot, so an install upgrades
// itself the first time each secret is used.
//
// **Unlike the API keys, these fall back to plain text when the OS offers no
// encryption** (a Linux desktop with no keyring). The COROS token is a session,
// not a key the athlete can paste again: refusing to keep it would mean a new
// login on every launch, and COROS keeps one live token per account, so each
// launch would sign the athlete out on their other computer. The fallback is a
// trade the app already made for the session in earlier builds, made explicit.
//
// `safeStorage` is loaded lazily, like `mcpServersStore`, so the suites that
// import compiled modules under `ELECTRON_RUN_AS_NODE` — where `electron` is a
// path string, not an API — still load this and read the plain values they
// write.

import { getSetting, setSetting } from "./database";

const ENCRYPTED_PREFIX = "enc:v1:";

type SafeStorage = typeof import("electron").safeStorage;

function safeStorage(): SafeStorage | undefined {
  try {
    const electron = require("electron") as typeof import("electron") | string;
    return typeof electron === "object" ? electron.safeStorage : undefined;
  } catch {
    return undefined;
  }
}

function encryptionAvailable(storage: SafeStorage | undefined): storage is SafeStorage {
  try {
    return Boolean(storage?.isEncryptionAvailable());
  } catch {
    return false;
  }
}

function encode(value: string): string {
  const storage = safeStorage();
  if (!encryptionAvailable(storage)) return value;
  return ENCRYPTED_PREFIX + storage.encryptString(value).toString("base64");
}

/** Writes a credential, encrypted when the OS can. */
export function setSecretSetting(key: string, value: string): void {
  setSetting(key, encode(value));
}

/**
 * Reads a credential. Undefined when there is none, or when it was encrypted
 * and cannot be opened here — a keyring that changed is a sign-in to do again,
 * not a value to guess at.
 */
export function getSecretSetting(key: string): string | undefined {
  const stored = getSetting(key);
  if (stored === undefined || stored === "") return stored;

  if (stored.startsWith(ENCRYPTED_PREFIX)) {
    const storage = safeStorage();
    if (!encryptionAvailable(storage)) return undefined;
    try {
      return storage.decryptString(
        Buffer.from(stored.slice(ENCRYPTED_PREFIX.length), "base64")
      );
    } catch {
      return undefined;
    }
  }

  // Written in the clear by an earlier build, or here without a keyring.
  // Encrypt it now when that has become possible.
  if (encryptionAvailable(safeStorage())) {
    try {
      setSetting(key, encode(stored));
    } catch {
      // Left as it was; it still reads.
    }
  }
  return stored;
}
