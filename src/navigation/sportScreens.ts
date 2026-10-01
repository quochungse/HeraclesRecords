import { isRideSportType } from "../cycling/rideType";
import { isHikeSportType } from "../hiking/hikeType";
import { isRunSportType } from "../running/runSurface";
import { isStrengthSportType } from "../training/sportTypes";
import type { PrimaryView } from "./primaryNav";

/**
 * The screens built for one sport. Each can be taken off the rail because
 * Activities holds every COROS session: hiding Hiking hides a way of reading
 * hikes, never a hike. Strength is the one exception — a workout only Hevy
 * knows, and the Hevy connection itself, live on Strength alone, which is why
 * Settings says so once Hevy is connected.
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

/** Every string stored, this build's screens or not. */
function readStoredIds(): string[] {
  try {
    const stored = window.localStorage.getItem(HIDDEN_SPORT_SCREENS_KEY);
    const parsed: unknown = stored ? JSON.parse(stored) : [];
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
}

export function readHiddenSportScreens(): SportScreen[] {
  if (typeof window === "undefined") {
    return [];
  }
  const stored = readStoredIds();
  return SPORT_SCREENS.filter((screen) => stored.includes(screen));
}

export function saveHiddenSportScreens(hidden: readonly SportScreen[]): void {
  if (typeof window === "undefined") {
    return;
  }

  // A screen a newer build hid is kept as it was written: this build cannot
  // show it, and dropping it here would put it back on that build's rail.
  const unknown = readStoredIds().filter(
    (id) => !SPORT_SCREENS.includes(id as SportScreen),
  );
  try {
    window.localStorage.setItem(
      HIDDEN_SPORT_SCREENS_KEY,
      JSON.stringify([
        ...SPORT_SCREENS.filter((screen) => hidden.includes(screen)),
        ...unknown,
      ]),
    );
  } catch {
    // Ignore private-mode or locked-storage failures; the rail keeps them all.
  }
}

/**
 * The screen built for a COROS sport code, if there is one. Every answer is
 * taken from the module that owns it — `isRunSportType` is where hikes and
 * mountain climbs are left out of Running, `isHikeSportType` where Hiking
 * takes them in — so a door to a screen cannot disagree with the room behind it.
 */
export function sportScreenFor(
  sportType: number | undefined,
): SportScreen | null {
  if (isRunSportType(sportType)) return "running";
  if (isRideSportType(sportType)) return "cycling";
  if (isHikeSportType(sportType)) return "hiking";
  if (isStrengthSportType(sportType)) return "strength";
  return null;
}
