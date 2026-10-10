import type { TrainingHubSportType } from "../../electron/types";
import { isHikeSportType } from "../hiking/hikeType";
import { t, type MessageKey } from "../i18n/core";
import englishSports from "../i18n/messages/en/sports";

/**
 * Every code COROS names: the codes English has a `sports.code.<code>` message
 * for, so a code added there is known here without a second list to keep. The
 * messages follow electron/corosSportTypes.ts, the main process's own table.
 */
const KNOWN_SPORT_CODES: ReadonlySet<number> = new Set(
  Object.keys(englishSports).map((key) => Number(key.slice("sports.code.".length)))
);

/**
 * Codes whose name is the athlete's own: a custom sport carries the name they
 * gave it, which no table here can know.
 */
function isCustomSportCode(code: number): boolean {
  return code === 98 || (code >= 9800 && code <= 9999);
}

/** A known code's name in the language on screen. */
export function knownSportName(code: number): string | undefined {
  return KNOWN_SPORT_CODES.has(code) ? t(`sports.code.${code}` as MessageKey) : undefined;
}

export function isSwimSportType(sportType?: number): boolean {
  return sportType === 300 || sportType === 301;
}

/**
 * The codes the Strength screen reads, matching `STRENGTH_SPORT_TYPES` in
 * `electron/trainingHubService.ts` — 400 Gym Cardio and 402 Strength. Keep the
 * two in step: this is what decides whether a session has a screen to open in.
 */
export function isStrengthSportType(sportType?: number): boolean {
  return sportType === 400 || sportType === 402;
}

export function isCyclingSportType(sportType?: number): boolean {
  return sportType !== undefined && sportType >= 200 && sportType <= 299;
}

/**
 * Whether an activity is read in speed rather than pace: a ride, by its COROS
 * code or, for a custom sport, its name — the rule the activity panes apply to
 * their own "Avg speed" — and a hike or a mountain climb, which a walker reads
 * in km/h. On the route map that also keeps a hike off COROS's pace zones,
 * which are the account's running zones and put a whole hike below zone 1.
 */
export function isSpeedSport(sportType?: number, sportName?: string): boolean {
  return (
    isCyclingSportType(sportType) ||
    isHikeSportType(sportType) ||
    /bike|cycl|ride/i.test(sportName ?? "")
  );
}

export function resolveSportName(
  activity: {
    sportType?: number;
    sportName?: string;
  },
  sportTypes: TrainingHubSportType[] | Map<number, string> = []
): string | undefined {
  // A code COROS names is written in the language on screen: the main process
  // fills `sportName` in English, and a custom sport's own name is kept.
  if (
    activity.sportType !== undefined &&
    !isCustomSportCode(activity.sportType) &&
    KNOWN_SPORT_CODES.has(activity.sportType)
  ) {
    return knownSportName(activity.sportType);
  }

  if (activity.sportName?.trim()) {
    return activity.sportName.trim();
  }

  const sportType = activity.sportType;
  if (sportType === undefined) {
    return undefined;
  }

  const lookup =
    sportTypes instanceof Map
      ? sportTypes
      : new Map(sportTypes.map((item) => [item.sportType, item.sportName]));

  const fromMap = lookup.get(sportType)?.trim();
  if (fromMap) {
    return fromMap;
  }

  return knownSportName(sportType);
}
