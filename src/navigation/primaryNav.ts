import {
  Activity,
  Bike,
  BookOpen,
  CalendarDays,
  Dumbbell,
  Globe,
  LayoutGrid,
  MessageCircle,
  Moon,
  Mountain,
  Settings,
  User,
  type LucideIcon,
} from "lucide-react";
import { t, type MessageKey } from "../i18n/core.ts";
import { LaurelIcon } from "../records/recordsIcons";
import { RunnerIcon } from "../running/runnerIcon";

export type PrimaryView =
  | "overview"
  | "profile"
  | "training"
  | "running"
  | "cycling"
  | "hiking"
  | "library"
  | "strength"
  | "sleep"
  | "calendar"
  | "coach"
  | "places"
  | "records"
  | "settings";

export type PrimaryNavSectionId = "today" | "plan" | "history" | "journey";

export interface PrimaryNavItem {
  id: PrimaryView;
  /** In the language on screen: read it while rendering, never keep it. */
  readonly label: string;
  /** The message `label` is read from, for what must not change with the language. */
  labelKey: MessageKey;
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
  readonly label: string;
  items: PrimaryNavItem[];
}

/** A destination whose label is read in the language on screen each time it is asked for. */
function navItem(
  id: PrimaryView,
  labelKey: MessageKey,
  icon: LucideIcon,
  extra: Omit<PrimaryNavItem, "id" | "label" | "labelKey" | "icon"> = {},
): PrimaryNavItem {
  return {
    id,
    labelKey,
    get label() {
      return t(labelKey);
    },
    icon,
    ...extra,
  };
}

/**
 * The rail reads as an index: four standing headings, twelve destinations,
 * nothing to open first.
 *
 * The sections answer *when the athlete reaches for a screen*, not where the
 * data came from. That is the one grouping the athlete already has in their
 * head — the morning check, the week being planned, the work on file, the
 * ground covered over the years — and it is what lets the whole list stand
 * open at once. The
 * disclosure groups this replaced existed only because eighteen equal rows did
 * not fit, and they cost two rows, a chevron, a remembered open/closed state and
 * a rule that reopened a group whenever the app navigated into it.
 */
export const PRIMARY_NAV_SECTIONS: PrimaryNavSection[] = [
  {
    id: "today",
    get label() {
      return t("nav.section.today");
    },
    // What the morning is read from: the app's own account of it, and the
    // night it is all judged against.
    items: [
      navItem("overview", "nav.overview", LayoutGrid),
      navItem("sleep", "nav.sleep", Moon),
    ],
  },
  {
    id: "plan",
    get label() {
      return t("nav.section.plan");
    },
    // What is ahead, in the order it is decided: the coach settles what the
    // next session should be, the calendar is where it lands, and the library
    // is reached for while filling that calendar — a peer of it rather than a
    // drawer inside it.
    items: [
      navItem("coach", "nav.coach", MessageCircle, { showActivity: true }),
      navItem("calendar", "nav.calendar", CalendarDays),
      navItem("library", "nav.library", BookOpen),
    ],
  },
  {
    id: "history",
    get label() {
      return t("nav.section.history");
    },
    // What is behind. Activities holds every sport; Running, Cycling,
    // Hiking and Strength are separate destinations because they are read
    // through different numbers, not because they are filters.
    items: [
      navItem("training", "nav.training", Activity),
      navItem("running", "nav.running", RunnerIcon),
      navItem("cycling", "nav.cycling", Bike),
      navItem("hiking", "nav.hiking", Mountain),
      navItem("strength", "nav.strength", Dumbbell),
    ],
  },
  {
    id: "journey",
    get label() {
      return t("nav.section.journey");
    },
    // The same history seen from above: not a session or a week but every
    // milestone the training has reached, and every place it has taken the
    // athlete — reached for at a different moment from the log above it.
    items: [
      navItem("records", "nav.records", LaurelIcon),
      navItem("places", "nav.places", Globe),
    ],
  },
];

/**
 * The two destinations that are about the person rather than the training.
 * They sit in the identity row at the foot of the rail, which is where an
 * account and its settings are looked for — and keeping them out of the index
 * is what brings it down to twelve rows that fit without folding.
 */
export const PRIMARY_NAV_ACCOUNT_ITEMS: PrimaryNavItem[] = [
  navItem("profile", "nav.profile", User),
  navItem("settings", "nav.settings", Settings, { excludeFromStartup: true }),
];

/** Every destination, flattened in rail order. */
export const PRIMARY_NAV_ITEMS: PrimaryNavItem[] = [
  ...PRIMARY_NAV_SECTIONS.flatMap((section) => section.items),
  ...PRIMARY_NAV_ACCOUNT_ITEMS,
];

/** `hiddenViews` is what the athlete took off the rail in Settings → Navigation. */
function isVisible(
  item: PrimaryNavItem,
  showDevelopmentItems: boolean,
  hiddenViews: readonly PrimaryView[],
): boolean {
  return (
    (!item.developmentOnly || showDevelopmentItems) &&
    !hiddenViews.includes(item.id)
  );
}

export function visiblePrimaryNavItems(
  showDevelopmentItems: boolean,
  hiddenViews: readonly PrimaryView[] = [],
): PrimaryNavItem[] {
  return PRIMARY_NAV_ITEMS.filter((item) =>
    isVisible(item, showDevelopmentItems, hiddenViews),
  );
}

/** The sections with development-only and hidden destinations — and any they empty — removed. */
export function visiblePrimaryNavSections(
  showDevelopmentItems: boolean,
  hiddenViews: readonly PrimaryView[] = [],
): PrimaryNavSection[] {
  return PRIMARY_NAV_SECTIONS.flatMap((section) => {
    const items = section.items.filter((item) =>
      isVisible(item, showDevelopmentItems, hiddenViews),
    );
    return items.length > 0 ? [{ ...section, items }] : [];
  });
}

export const SIDEBAR_EXPANDED_WIDTH = 236;
export const SIDEBAR_COLLAPSED_WIDTH = 64;
