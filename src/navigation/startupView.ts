import { LayoutGrid, type LucideIcon } from "lucide-react";
import { PRIMARY_NAV_ITEMS, type PrimaryView } from "./primaryNav";

const DEFAULT_STARTUP_VIEW: PrimaryView = "overview";
const STARTUP_VIEW_STORAGE_KEY = "coroslink.startupView";

function isPrimaryView(value: string | null): value is PrimaryView {
  return PRIMARY_NAV_ITEMS.some(
    (item) =>
      item.id === value &&
      !item.excludeFromStartup &&
      // A destination that has since become development-only may still be
      // stored here -- from an earlier build, or from a dev run sharing this
      // localStorage. Restoring it in a production build opens a view that
      // renders nothing, so fall back to the default instead.
      (!item.developmentOnly || import.meta.env.DEV),
  );
}

export function getPrimaryViewLabel(view: PrimaryView): string {
  return (
    PRIMARY_NAV_ITEMS.find((item) => item.id === view)?.label ??
    "Overview"
  );
}

/** The selected destination's own icon, so the row shows what will open. */
export function getPrimaryViewIcon(view: PrimaryView): LucideIcon {
  return (
    PRIMARY_NAV_ITEMS.find((item) => item.id === view)?.icon ?? LayoutGrid
  );
}

export function readStartupView(): PrimaryView {
  if (typeof window === "undefined") {
    return DEFAULT_STARTUP_VIEW;
  }

  try {
    const storedView = window.localStorage.getItem(STARTUP_VIEW_STORAGE_KEY);
    return isPrimaryView(storedView) ? storedView : DEFAULT_STARTUP_VIEW;
  } catch {
    return DEFAULT_STARTUP_VIEW;
  }
}

export function saveStartupView(view: PrimaryView): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(STARTUP_VIEW_STORAGE_KEY, view);
  } catch {
    // Ignore private-mode or locked-storage failures; the app can still run.
  }
}
