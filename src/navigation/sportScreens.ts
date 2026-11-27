import { isRideSportType } from "../cycling/rideType";
import { isHikeSportType } from "../hiking/hikeType";
import { isSwimSportType } from "../swimming/swimType";
import { isClimbSportType } from "../climbing/climbType";
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
  "running" | "cycling" | "hiking" | "swimming" | "climbing" | "strength"
>;

export const SPORT_SCREENS: readonly SportScreen[] = [
  "running",
  "cycling",
  "hiking",
  "swimming",
  "climbing",
  "strength",
];

/**
 * A sport screen is on the rail once the account has a session of its sport,
 * unless the athlete chose otherwise in Settings. Three lists say so:
 *
 * - **hidden**: turned off by the athlete. The key predates the other two and
 *   keeps its meaning, so a build that knows only it still reads it right.
 * - **shown**: turned on by the athlete — a screen with no session yet.
 * - **with sessions**: screens the account has had a session for. Only ever
 *   added to: the activity list is empty while it loads, after a failed read
 *   and once signed out, and none of those may take a screen off the rail.
 *   Rebuilt from COROS on every machine, so it never syncs.
 */
const HIDDEN_SPORT_SCREENS_KEY = "heraclesrecords.hiddenSportScreens";
const SHOWN_SPORT_SCREENS_KEY = "heraclesrecords.shownSportScreens";
const SPORT_SCREENS_WITH_SESSIONS_KEY =
  "heraclesrecords.sportScreensWithSessions";

export interface SportScreenChoices {
  hidden: readonly SportScreen[];
  shown: readonly SportScreen[];
  withSessions: readonly SportScreen[];
}

/**
 * The screens off the rail. Hidden outranks shown: the two keys sync apart,
 * so another machine's choice can leave a screen in both, and hidden is what a
 * build reading only that key shows.
 */
export function hiddenSportScreensFrom(
  choices: SportScreenChoices,
): SportScreen[] {
  return SPORT_SCREENS.filter(
    (screen) =>
      choices.hidden.includes(screen) ||
      !(choices.shown.includes(screen) || choices.withSessions.includes(screen)),
  );
}

/**
 * Where each list is kept. Every key is named at its own storage call, which
 * is how `test:sync-policy` finds the keys `src/` writes.
 */
const STORED_LISTS = {
  hidden: {
    read: () => window.localStorage.getItem(HIDDEN_SPORT_SCREENS_KEY),
    write: (value: string) =>
      window.localStorage.setItem(HIDDEN_SPORT_SCREENS_KEY, value),
  },
  shown: {
    read: () => window.localStorage.getItem(SHOWN_SPORT_SCREENS_KEY),
    write: (value: string) =>
      window.localStorage.setItem(SHOWN_SPORT_SCREENS_KEY, value),
  },
  withSessions: {
    read: () => window.localStorage.getItem(SPORT_SCREENS_WITH_SESSIONS_KEY),
    write: (value: string) =>
      window.localStorage.setItem(SPORT_SCREENS_WITH_SESSIONS_KEY, value),
  },
};

type StoredList = keyof typeof STORED_LISTS;

/** Every string a list holds, this build's screens or not. */
function readStoredIds(list: StoredList): string[] {
  try {
    const stored = STORED_LISTS[list].read();
    const parsed: unknown = stored ? JSON.parse(stored) : [];
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
}

function readScreens(list: StoredList): SportScreen[] {
  const stored = readStoredIds(list);
  return SPORT_SCREENS.filter((screen) => stored.includes(screen));
}

function writeScreens(list: StoredList, screens: readonly SportScreen[]): void {
  // A screen a newer build wrote is kept as it was: this build cannot show
  // it, and dropping it here would change that build's rail.
  const unknown = readStoredIds(list).filter(
    (id) => !SPORT_SCREENS.includes(id as SportScreen),
  );
  try {
    STORED_LISTS[list].write(
      JSON.stringify([
        ...SPORT_SCREENS.filter((screen) => screens.includes(screen)),
        ...unknown,
      ]),
    );
  } catch {
    // Ignore private-mode or locked-storage failures; the rail keeps its state.
  }
}

export function readSportScreenChoices(): SportScreenChoices {
  if (typeof window === "undefined") {
    return { hidden: [], shown: [], withSessions: [] };
  }
  return {
    hidden: readScreens("hidden"),
    shown: readScreens("shown"),
    withSessions: readScreens("withSessions"),
  };
}

/** The screens off the rail now; every reader of the rail asks this. */
export function readHiddenSportScreens(): SportScreen[] {
  return hiddenSportScreensFrom(readSportScreenChoices());
}

/** The athlete's own choice for one screen, which outranks its sessions. */
export function saveSportScreenChoice(screen: SportScreen, shown: boolean): void {
  if (typeof window === "undefined") {
    return;
  }
  const { hidden, shown: shownScreens } = readSportScreenChoices();
  const others = (list: readonly SportScreen[]) =>
    list.filter((candidate) => candidate !== screen);
  writeScreens(
    "hidden",
    shown ? others(hidden) : [...others(hidden), screen],
  );
  writeScreens(
    "shown",
    shown ? [...others(shownScreens), screen] : others(shownScreens),
  );
}

/**
 * The screens these sessions add to the ones already known — only a sport not
 * yet seen is looked for, and the walk stops once every screen is known.
 */
export function newSportScreensIn(
  activities: readonly { sportType?: number }[],
  known: readonly SportScreen[],
): SportScreen[] {
  const found = new Set(known);
  const added: SportScreen[] = [];
  if (found.size === SPORT_SCREENS.length) {
    return added;
  }
  for (const activity of activities) {
    const screen = sportScreenFor(activity.sportType);
    if (screen && !found.has(screen)) {
      found.add(screen);
      added.push(screen);
      if (found.size === SPORT_SCREENS.length) break;
    }
  }
  return added;
}

/** Records screens the account has a session for; true when any was new. */
export function addSportScreensWithSessions(
  screens: readonly SportScreen[],
): boolean {
  if (typeof window === "undefined" || screens.length === 0) {
    return false;
  }
  const known = readScreens("withSessions");
  const added = screens.filter((screen) => !known.includes(screen));
  if (added.length === 0) {
    return false;
  }
  writeScreens("withSessions", [...known, ...added]);
  return true;
}

/** Records the screens a list of sessions holds; true when any was new. */
export function recordSportScreensIn(
  activities: readonly { sportType?: number }[],
): boolean {
  if (typeof window === "undefined" || activities.length === 0) {
    return false;
  }
  return addSportScreensWithSessions(
    newSportScreensIn(activities, readScreens("withSessions")),
  );
}

/**
 * Signing out forgets them: the next account's sessions decide its rail.
 * The athlete's own choices stay.
 */
export function forgetSportScreensWithSessions(): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.removeItem(SPORT_SCREENS_WITH_SESSIONS_KEY);
  } catch {
    // Nothing to forget where storage is locked.
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
  if (isSwimSportType(sportType)) return "swimming";
  if (isClimbSportType(sportType)) return "climbing";
  if (isStrengthSportType(sportType)) return "strength";
  return null;
}
