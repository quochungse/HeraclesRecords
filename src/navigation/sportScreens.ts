import type { PrimaryView } from "./primaryNav";

/**
 * The screens built for one sport. Each can be taken off the rail because
 * Activities holds every sport: hiding Hiking hides a way of reading hikes,
 * never a hike.
 */
export type SportScreen = Extract<
  PrimaryView,
  "running" | "cycling" | "hiking" | "strength"
>;

export const SPORT_SCREENS: readonly SportScreen[] = [
  "running",
  "cycling",
  "hiking",
  "strength",
];

/**
 * The *hidden* screens are stored, not the shown ones, so a sport screen added
 * later reaches the rail for everyone without a migration — and an athlete who
 * never opened the setting has nothing stored at all.
 */
const HIDDEN_SPORT_SCREENS_KEY = "coroslink.hiddenSportScreens";

export function readHiddenSportScreens(): SportScreen[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const stored = window.localStorage.getItem(HIDDEN_SPORT_SCREENS_KEY);
    const parsed: unknown = stored ? JSON.parse(stored) : [];
    return Array.isArray(parsed)
      ? SPORT_SCREENS.filter((screen) => parsed.includes(screen))
      : [];
  } catch {
    return [];
  }
}

export function saveHiddenSportScreens(hidden: readonly SportScreen[]): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      HIDDEN_SPORT_SCREENS_KEY,
      JSON.stringify(SPORT_SCREENS.filter((screen) => hidden.includes(screen))),
    );
  } catch {
    // Ignore private-mode or locked-storage failures; the rail keeps them all.
  }
}

/** Whether a destination is a sport screen the athlete has taken off the rail. */
export function isHiddenSportScreen(
  view: PrimaryView,
  hidden: readonly SportScreen[],
): boolean {
  return hidden.includes(view as SportScreen);
}
