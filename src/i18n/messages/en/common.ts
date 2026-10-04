import type { Translation } from "../../types.ts";

/** Words every screen reaches for. */
const common = {
  "common.close": "Close",
  "common.cancel": "Cancel",
  "common.unknown": "Unknown",
  "common.connected": "Connected",
  "common.connect": "Connect",
  "common.disconnect": "Disconnect",
  "common.manage": "Manage",
  "common.refresh": "Refresh",
  "common.reset": "Reset",
  "common.tryAgain": "Try again",
  "common.signIn": "Sign in",
  "common.details": "Details",
  "common.hide": "Hide",
  "common.beta": "Beta",
  "common.newCount": "{count} new",

  "sport.run": "Running",
  "sport.bike": "Cycling",
  "sport.hiking": "Hiking",
  "sport.strength": "Strength",
  "sport.other": "Other",
};

export default common;
export type CommonMessages = Translation<typeof common>;
