import {
  Activity,
  BookOpen,
  CalendarDays,
  Database,
  Dumbbell,
  Footprints,
  Gauge,
  Globe,
  LayoutGrid,
  Map as MapIcon,
  MessageCircle,
  Moon,
  Music,
  Settings,
  User,
  Watch,
  type LucideIcon,
} from "lucide-react";
import { RunnerIcon } from "../running/runnerIcon";

export type PrimaryView =
  | "overview"
  | "profile"
  | "coros-overview"
  | "media"
  | "training"
  | "running"
  | "gear"
  | "library"
  | "strength"
  | "sleep"
  | "data"
  | "calendar"
  | "maps"
  | "watchfaces"
  | "coach"
  | "places"
  | "settings";

export type PrimaryNavSectionId = "today" | "plan" | "history" | "device";

export interface PrimaryNavItem {
  id: PrimaryView;
  label: string;
  icon: LucideIcon;
  beta?: boolean;
  showActivity?: boolean;
  /** Shown only while the development build's Dev view is active. */
  developmentOnly?: boolean;
  /** Hidden from the startup-view picker (e.g. Settings). */
  excludeFromStartup?: boolean;
}

/**
 * A run of destinations under one standing heading. The heading is a label and
 * nothing more — it does not open, close or remember anything.
 */
export interface PrimaryNavSection {
  id: PrimaryNavSectionId;
  label: string;
  items: PrimaryNavItem[];
}

/**
 * The rail reads as an index: four standing headings, thirteen destinations,
 * nothing to open first.
 *
 * The sections answer *when the athlete reaches for a screen*, not where the
 * data came from. That is the one grouping the athlete already has in their
 * head — the morning check, the week being planned, the work on file, the watch
 * on the desk — and it is what lets the whole list stand open at once. The
 * disclosure groups this replaced existed only because eighteen equal rows did
 * not fit, and they cost two rows, a chevron, a remembered open/closed state and
 * a rule that reopened a group whenever the app navigated into it.
 */
export const PRIMARY_NAV_SECTIONS: PrimaryNavSection[] = [
  {
    id: "today",
    label: "Today",
    // What the morning is read from: the app's own account of it, and the
    // night it is all judged against.
    items: [
      { id: "overview", label: "Overview", icon: LayoutGrid },
      { id: "sleep", label: "Sleep", icon: Moon },
    ],
  },
  {
    id: "plan",
    label: "Plan",
    // What is ahead, in the order it is decided: the coach settles what the
    // next session should be, the calendar is where it lands, and the library
    // is reached for while filling that calendar — a peer of it rather than a
    // drawer inside it.
    items: [
      {
        id: "coach",
        label: "Coach",
        icon: MessageCircle,
        showActivity: true,
      },
      { id: "calendar", label: "Calendar", icon: CalendarDays },
      { id: "library", label: "Training Library", icon: BookOpen },
    ],
  },
  {
    id: "history",
    label: "History",
    // What is behind. Activities holds every sport; Running and Strength are
    // separate destinations because they are read through different numbers,
    // not because they are filters. The globe is the same history seen from
    // above.
    items: [
      { id: "training", label: "Activities", icon: Activity },
      { id: "running", label: "Running", icon: RunnerIcon },
      { id: "strength", label: "Strength", icon: Dumbbell },
      { id: "places", label: "Where you’ve been", icon: Globe },
    ],
  },
  {
    id: "device",
    label: "Device",
    // The watch itself: what is on it, what goes onto it. This is the one
    // section about a piece of hardware rather than about training, which is
    // why the heading carries the watch's name while one is on USB.
    items: [
      { id: "coros-overview", label: "Coros Overview", icon: Gauge },
      { id: "media", label: "Media", icon: Music },
      { id: "maps", label: "Maps", icon: MapIcon, beta: true },
      {
        id: "watchfaces",
        label: "Watch Faces",
        icon: Watch,
        beta: true,
        developmentOnly: true,
      },
      { id: "data", label: "Data", icon: Database },
      {
        id: "gear",
        label: "Gear",
        icon: Footprints,
        developmentOnly: true,
      },
    ],
  },
];

/**
 * The two destinations that are about the person rather than the training.
 * They sit in the identity row at the foot of the rail, which is where an
 * account and its settings are looked for — and keeping them out of the index
 * is what brings it down to thirteen rows that fit without folding.
 */
export const PRIMARY_NAV_ACCOUNT_ITEMS: PrimaryNavItem[] = [
  { id: "profile", label: "Personal", icon: User },
  {
    id: "settings",
    label: "Settings",
    icon: Settings,
    excludeFromStartup: true,
  },
];

/** Every destination, flattened in rail order. */
export const PRIMARY_NAV_ITEMS: PrimaryNavItem[] = [
  ...PRIMARY_NAV_SECTIONS.flatMap((section) => section.items),
  ...PRIMARY_NAV_ACCOUNT_ITEMS,
];

export function visiblePrimaryNavItems(
  showDevelopmentItems: boolean,
): PrimaryNavItem[] {
  return PRIMARY_NAV_ITEMS.filter(
    (item) => !item.developmentOnly || showDevelopmentItems,
  );
}

/** The sections with development-only destinations — and any they empty — removed. */
export function visiblePrimaryNavSections(
  showDevelopmentItems: boolean,
): PrimaryNavSection[] {
  return PRIMARY_NAV_SECTIONS.flatMap((section) => {
    const items = section.items.filter(
      (item) => !item.developmentOnly || showDevelopmentItems,
    );
    return items.length > 0 ? [{ ...section, items }] : [];
  });
}

export const SIDEBAR_EXPANDED_WIDTH = 236;
export const SIDEBAR_COLLAPSED_WIDTH = 64;
