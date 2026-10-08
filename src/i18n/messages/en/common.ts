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
  "common.connectFirst.title": "Connect COROS first",
  "common.connectFirst.body": "Signing in to COROS lives on Overview. Connect there and your activities and their detail load here.",
  "common.openOverview": "Open Overview",
  "common.loading": "Loading…",
  "common.showMore": "Show more",
  "common.all": "All",
  "common.done": "Done",
};

export default common;
export type CommonMessages = Translation<typeof common>;
