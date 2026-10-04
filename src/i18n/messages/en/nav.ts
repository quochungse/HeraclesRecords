import type { Translation } from "../../types.ts";

/** The rail: its four headings, every destination, and its own controls. */
const nav = {
  "nav.section.today": "Today",
  "nav.section.plan": "Plan",
  "nav.section.history": "History",
  "nav.section.journey": "Your journey",

  "nav.overview": "Overview",
  "nav.sleep": "Sleep",
  "nav.coach": "Coach",
  "nav.calendar": "Calendar",
  "nav.library": "Training Library",
  "nav.training": "Activities",
  "nav.running": "Running",
  "nav.cycling": "Cycling",
  "nav.hiking": "Hiking",
  "nav.strength": "Strength",
  "nav.records": "Hall of Records",
  "nav.places": "Where you’ve been",
  "nav.profile": "Personal",
  "nav.settings": "Settings",

  "nav.primary": "Primary",
  "nav.coachResponding": "Coach is responding",
  "nav.collapse": "Collapse sidebar",
  "nav.expand": "Expand sidebar",
  "nav.closeNavigation": "Close navigation",
  "nav.startupSet": "Startup view set to {view}. It will open on next launch.",
};

export default nav;
export type NavMessages = Translation<typeof nav>;
