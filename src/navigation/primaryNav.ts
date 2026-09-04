import {
  Activity,
  BookOpen,
  Cable,
  CalendarDays,
  Database,
  Dumbbell,
  Flame,
  Footprints,
  Gauge,
  LayoutGrid,
  Map as MapIcon,
  MessageCircle,
  Music,
  Settings,
  Watch,
  type LucideIcon,
} from "lucide-react";

export type PrimaryView =
  | "overview"
  | "coros-overview"
  | "media"
  | "training"
  | "gear"
  | "library"
  | "strength"
  | "data"
  | "calendar"
  | "maps"
  | "watchfaces"
  | "coach"
  | "settings";

export type PrimaryNavGroupId = "training-group" | "coros-connect";

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

export interface PrimaryNavGroup {
  id: PrimaryNavGroupId;
  label: string;
  icon: LucideIcon;
  items: PrimaryNavItem[];
}

/**
 * One row of the sidebar tree: either a top-level destination or a group that
 * holds destinations one level in.
 */
export type PrimaryNavEntry =
  | { kind: "item"; item: PrimaryNavItem }
  | { kind: "group"; group: PrimaryNavGroup };

function item(entry: PrimaryNavItem): PrimaryNavEntry {
  return { kind: "item", item: entry };
}

function group(entry: PrimaryNavGroup): PrimaryNavEntry {
  return { kind: "group", group: entry };
}

export const PRIMARY_NAV_TREE: PrimaryNavEntry[] = [
  item({ id: "overview", label: "Overview", icon: LayoutGrid }),
  item({ id: "calendar", label: "Calendar", icon: CalendarDays }),
  item({
    id: "coach",
    label: "Coach",
    icon: MessageCircle,
    showActivity: true,
  }),
  group({
    id: "training-group",
    label: "Training",
    icon: Flame,
    items: [
      { id: "training", label: "Activities", icon: Activity },
      { id: "strength", label: "Strength", icon: Dumbbell, beta: true },
      { id: "library", label: "Training Library", icon: BookOpen },
    ],
  }),
  group({
    id: "coros-connect",
    label: "Coros Connect",
    icon: Cable,
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
  }),
  item({
    id: "settings",
    label: "Settings",
    icon: Settings,
    excludeFromStartup: true,
  }),
];

/** Every destination, flattened in tree order. */
export const PRIMARY_NAV_ITEMS: PrimaryNavItem[] = PRIMARY_NAV_TREE.flatMap(
  (entry) => (entry.kind === "item" ? [entry.item] : entry.group.items),
);

export const PRIMARY_NAV_GROUPS: PrimaryNavGroup[] = PRIMARY_NAV_TREE.flatMap(
  (entry) => (entry.kind === "group" ? [entry.group] : []),
);

export function visiblePrimaryNavItems(
  showDevelopmentItems: boolean,
): PrimaryNavItem[] {
  return PRIMARY_NAV_ITEMS.filter(
    (item) => !item.developmentOnly || showDevelopmentItems,
  );
}

/** The tree with development-only destinations — and any group they empty — removed. */
export function visiblePrimaryNavTree(
  showDevelopmentItems: boolean,
): PrimaryNavEntry[] {
  const isVisible = (entry: PrimaryNavItem) =>
    !entry.developmentOnly || showDevelopmentItems;

  return PRIMARY_NAV_TREE.flatMap<PrimaryNavEntry>((entry) => {
    if (entry.kind === "item") {
      return isVisible(entry.item) ? [entry] : [];
    }

    const items = entry.group.items.filter(isVisible);
    return items.length > 0
      ? [{ kind: "group", group: { ...entry.group, items } }]
      : [];
  });
}

/** The group a destination lives in, or null when it sits at the top level. */
export function findPrimaryNavGroupId(
  view: PrimaryView,
): PrimaryNavGroupId | null {
  return (
    PRIMARY_NAV_GROUPS.find((group) =>
      group.items.some((item) => item.id === view),
    )?.id ?? null
  );
}

export const SIDEBAR_EXPANDED_WIDTH = 248;
export const SIDEBAR_COLLAPSED_WIDTH = 72;
