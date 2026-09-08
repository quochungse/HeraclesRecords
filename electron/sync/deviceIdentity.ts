// This machine's identity inside the sync vault.
//
// It names the device's own oplog directory and breaks ties in the logical
// clock. Both uses demand it stay stable for the life of an install and stay
// *different* from every other install — which is why it is classified `device`
// in syncPolicy and never leaves this computer. Copying a device id onto a
// second machine would put two writers in one oplog directory, the single thing
// this design relies on never happening.

import crypto from "node:crypto";
import { getSetting, setSetting } from "../database";

export const DEVICE_ID_SETTING = "sync.deviceId";

const DEVICE_ID_PATTERN = /^[0-9a-f]{16}$/;

/** 16 hex characters is 64 bits: filename-safe, and far past collision risk for
 *  the handful of machines one person owns. */
function mint(): string {
  return crypto.randomBytes(8).toString("hex");
}

/** This device's id, minting and persisting one on first call. */
export function deviceId(): string {
  const stored = getSetting(DEVICE_ID_SETTING);
  if (stored && DEVICE_ID_PATTERN.test(stored)) {
    return stored;
  }
  const minted = mint();
  setSetting(DEVICE_ID_SETTING, minted);
  return minted;
}

export function isValidDeviceId(value: string): boolean {
  return DEVICE_ID_PATTERN.test(value);
}
