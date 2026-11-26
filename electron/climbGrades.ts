// Climbing grades as COROS keeps them, and the one ladder they are compared on.
//
// A climb's grade arrives as two numbers: `gradingSystem` (COROS's id of the
// scale) and `hardestGrade`, an index into that scale's list. The lists are
// COROS's own, copied from its Training Hub web app (training.coros.com,
// `climb.GRADING_SYSTEM_DATA` and its neighbours, read 2026-11-26): every
// grade carries `commonGrade`, the steps of one shared ladder it covers, which
// is how COROS converts a grade from one scale to another
// (`getGradingGradeByCommonGrade`). No account here has a climb, so none of
// this is probed against a recorded session; it is what COROS's own page does
// with the same payload.
//
// The web app reads a grade against one of two tables:
// - an indoor climb or a boulder: the indoor rope scales (YDS, French, UIAA,
//   Ewbank) and the bouldering ones (V, Font), each on a ladder of its own;
// - an outdoor climb or a multi-pitch: the outdoor scales, which add jugging
//   the rope, an "easy" step and the aid, ice, mixed and British trad scales,
//   on a rope ladder two steps above the indoor one (outdoor 5.6 is 6, indoor
//   5.6 is 4; French 4a is 3 and 1).
// So there are two ladders here, a route's and a boulder's, and an outdoor
// grade is moved down two steps onto the route ladder. A route and a boulder
// are never compared: the scales measure different things.
//
// Node-free: the renderer reads the same grades.

/** Which ladder a climb is graded on. */
export type ClimbFamily = "route" | "boulder";

/** COROS's `gradingSystem` ids, as its web app's `GRADING_SYSTEM` names them. */
export const CLIMB_SYSTEM = {
  yds: 1,
  french: 2,
  aid: 3,
  ice: 4,
  mixed: 5,
  ukTrad: 6,
  vScale: 7,
  font: 8,
  uiaa: 9,
  ewbank: 10
} as const;

/** What COROS starts an account on: YDS for routes, V for boulders (its climb settings' defaults). */
export const DEFAULT_CLIMB_SYSTEM: Readonly<Record<ClimbFamily, number>> = {
  route: CLIMB_SYSTEM.yds,
  boulder: CLIMB_SYSTEM.vScale
};

/** The scales a route can be shown in, and a boulder: those COROS's climb settings offer. */
export const CLIMB_DISPLAY_SYSTEMS: Readonly<Record<ClimbFamily, readonly number[]>> = {
  route: [CLIMB_SYSTEM.yds, CLIMB_SYSTEM.french, CLIMB_SYSTEM.uiaa, CLIMB_SYSTEM.ewbank],
  boulder: [CLIMB_SYSTEM.vScale, CLIMB_SYSTEM.font]
};

/**
 * One grade: its name, then every step of the ladder it covers. A name that
 * starts with "@" is a word, not a grade, and is said in the language on
 * screen: "@jug" jugging the rope, "@easy" an easy scramble, "@low5th" YDS's
 * low fifth class.
 */
type GradeRow = readonly [string, ...number[]];

type GradeTable = Readonly<Record<number, readonly GradeRow[]>>;

/** Outdoor climbs and multi-pitches (COROS's `GRADING_SYSTEM_DATA`). */
const OUTDOOR: GradeTable = {
  1: [["@jug", 1], ["@low5th", 2, 3, 4, 5], ["5.6", 6], ["5.7", 7], ["5.8", 8], ["5.9", 9], ["5.10a", 10], ["5.10b", 11], ["5.10c", 12], ["5.10d", 13], ["5.11a", 14], ["5.11b", 15], ["5.11c", 16], ["5.11d", 17], ["5.12a", 18], ["5.12b", 19], ["5.12c", 20], ["5.12d", 21], ["5.13a", 22], ["5.13b", 23], ["5.13c", 24], ["5.13d", 25], ["5.14a", 26], ["5.14b", 27], ["5.14c", 28], ["5.14d", 29], ["5.15a", 30]],
  2: [["@jug", 1], ["@easy", 2], ["4a", 3], ["4b", 4], ["4c", 5], ["5a", 6], ["5b", 7], ["5c", 8], ["6a", 9], ["6a+", 10], ["6b", 11], ["6b+", 12], ["6c", 13], ["6c+", 14], ["7a", 15], ["7a+", 16], ["7b", 17], ["7b+", 18], ["7c", 19], ["7c+", 20], ["8a", 21], ["8a+", 22], ["8b", 23], ["8b+", 24], ["8c", 25], ["8c+", 26], ["9a", 27], ["9a+", 28], ["9b", 29], ["9b+", 30]],
  3: [["@jug", 1], ["A1", 2, 3, 4, 5, 6, 7, 8, 9], ["A2", 10, 11, 12, 13, 14], ["A3", 15, 16, 17, 18, 19], ["A4", 20, 21, 22, 23, 24], ["A5", 25, 26, 27, 28, 29, 30]],
  4: [["@jug", 1], ["WI1", 2, 3, 4, 5], ["WI2", 6, 7, 8, 9], ["WI3", 10, 11, 12, 13], ["WI4", 14, 15, 16, 17], ["WI5", 18, 19, 20, 21], ["WI6", 22, 23, 24, 25], ["WI7", 26, 27, 28, 29, 30]],
  5: [["@jug", 1], ["M1", 2], ["M2", 3], ["M3", 4], ["M4", 5], ["M5", 6, 7], ["M6", 8, 9], ["M7", 10, 11], ["M8", 12, 13], ["M9", 14, 15], ["M10", 16, 17], ["M11", 18, 19], ["M12", 20, 21], ["M13", 22, 23], ["M14", 24, 25], ["M15", 26, 27], ["M16", 28, 29, 30]],
  6: [["@jug", 1], ["VD", 2, 3], ["S", 4], ["HS", 5], ["VS", 6], ["HVS", 7], ["E1", 8, 9], ["E2", 10, 11], ["E3", 12, 13], ["E4", 14, 15], ["E5", 16, 17], ["E6", 18, 19], ["E7", 20, 21], ["E8", 22], ["E9", 23], ["E10", 24], ["E11", 25], ["E12", 26, 27, 28, 29, 30]],
  9: [["@jug", 1], ["@easy", 2], ["IV", 3], ["IV+", 4], ["V", 5], ["V+", 6], ["VI-", 7], ["VI", 8], ["VI+", 9], ["VII-", 10], ["VII", 11], ["VII+", 12], ["VIII-", 13, 14], ["VIII", 15], ["VIII+", 16, 17], ["IX-", 18], ["IX", 19], ["IX+", 20, 21], ["X-", 22], ["X", 23], ["X+", 24, 25], ["XI-", 26], ["XI", 27], ["XI+", 28], ["XII-", 29], ["XII", 30]],
  10: [["@jug", 1], ["@easy", 2], ["12", 3], ["13", 4], ["14", 5], ["15", 6], ["16", 7], ["17", 8], ["18", 9], ["19", 10], ["20", 11], ["21", 12], ["22", 13], ["23", 14], ["24", 15], ["25", 16], ["26", 17], ["27", 18], ["28", 19], ["29", 20], ["30", 21], ["31", 22], ["32", 23], ["33", 24], ["34", 25], ["35", 26], ["36", 27], ["37", 28], ["38", 29], ["39", 30]]
};

/** Indoor routes (`INDOOR_CLIMB_GRADING_SYSTEM_DATA`, its rope scales). */
const INDOOR: GradeTable = {
  1: [["5.6", 1, 2, 3, 4], ["5.7", 5], ["5.8", 6], ["5.9", 7], ["5.10a", 8], ["5.10b", 9], ["5.10c", 10], ["5.10d", 11], ["5.11a", 12], ["5.11b", 13], ["5.11c", 14], ["5.11d", 15], ["5.12a", 16], ["5.12b", 17], ["5.12c", 18], ["5.12d", 19], ["5.13a", 20], ["5.13b", 21], ["5.13c", 22], ["5.13d", 23], ["5.14a", 24], ["5.14b", 25], ["5.14c", 26], ["5.14d", 27], ["5.15a", 28]],
  2: [["4a", 1], ["4b", 2], ["4c", 3], ["5a", 4], ["5b", 5], ["5c", 6], ["6a", 7], ["6a+", 8], ["6b", 9], ["6b+", 10], ["6c", 11], ["6c+", 12], ["7a", 13], ["7a+", 14], ["7b", 15], ["7b+", 16], ["7c", 17], ["7c+", 18], ["8a", 19], ["8a+", 20], ["8b", 21], ["8b+", 22], ["8c", 23], ["8c+", 24], ["9a", 25], ["9a+", 26], ["9b", 27], ["9b+", 28]],
  9: [["IV", 1], ["IV+", 2], ["V", 3], ["V+", 4], ["VI-", 5], ["VI", 6], ["VI+", 7], ["VII-", 8], ["VII", 9], ["VII+", 10], ["VIII-", 11, 12], ["VIII", 13], ["VIII+", 14, 15], ["IX-", 16], ["IX", 17], ["IX+", 18, 19], ["X-", 20], ["X", 21], ["X+", 22, 23], ["XI-", 24], ["XI", 25], ["XI+", 26], ["XII-", 27], ["XII", 28]],
  10: [["12", 1], ["13", 2], ["14", 3], ["15", 4], ["16", 5], ["17", 6], ["18", 7], ["19", 8], ["20", 9], ["21", 10], ["22", 11], ["23", 12], ["24", 13], ["25", 14], ["26", 15], ["27", 16], ["28", 17], ["29", 18], ["30", 19], ["31", 20], ["32", 21], ["33", 22], ["34", 23], ["35", 24], ["36", 25], ["37", 26], ["38", 27], ["39", 28]]
};

/** Boulders (`BOULDERING_GRADING_SYSTEM_DATA`). */
const BOULDER: GradeTable = {
  7: [["V0", 1], ["V1", 2], ["V2", 3], ["V3", 4, 5], ["V4", 6, 7], ["V5", 8, 9], ["V6", 10, 11], ["V7", 12], ["V8", 13], ["V9", 14], ["V10", 15], ["V11", 16], ["V12", 17], ["V13", 18], ["V14", 19], ["V15", 20], ["V16", 21], ["V17", 22]],
  8: [["4", 1], ["5", 2], ["5+", 3], ["6A", 4], ["6A+", 5], ["6B", 6], ["6B+", 7], ["6C", 8], ["6C+", 9], ["7A", 10], ["7A+", 11], ["7B", 12], ["7B+", 13], ["7C", 14], ["7C+", 15], ["8A", 16], ["8A+", 17], ["8B", 18], ["8B+", 19], ["8C", 20], ["8C+", 21], ["9A", 22]]
};

/** The outdoor rope ladder sits this many steps above the indoor one. */
const OUTDOOR_LADDER_OFFSET = 2;

/** COROS's climbing sport codes; `climbDetail.ts` and the screen read them from here. */
export const INDOOR_CLIMB_SPORT_TYPE = 800;
export const BOULDERING_SPORT_TYPE = 801;
export const OUTDOOR_CLIMB_SPORT_TYPE = 802;
export const MULTI_PITCH_SPORT_TYPE = 10003;

/** The table COROS's web app reads a climb of this sport against. */
function tableFor(sportType: number | undefined, system: number): GradeTable | undefined {
  if (sportType === OUTDOOR_CLIMB_SPORT_TYPE || sportType === MULTI_PITCH_SPORT_TYPE) return OUTDOOR;
  if (sportType === INDOOR_CLIMB_SPORT_TYPE || sportType === BOULDERING_SPORT_TYPE) return BOULDER[system] ? BOULDER : INDOOR;
  return undefined;
}

/** A climb's grade, read as COROS reads it, placed on its ladder. */
export interface ClimbGrade {
  family: ClimbFamily;
  /** COROS's `gradingSystem`. */
  system: number;
  /** COROS's `hardestGrade`: the grade's index in its scale. */
  index: number;
  /** As the scale writes it, or "@jug" / "@easy" / "@low5th". */
  name: string;
  /** The highest step of its ladder the grade covers (COROS's `commonGrade` last). */
  ladder: number;
}

/**
 * A climb's grade from COROS's two numbers, or undefined when there is none:
 * a scale of 0 is "not set", an index of 255 "no grade", and jugging the rope
 * is not a climb graded on anything.
 */
export function climbGradeOf(
  sportType: number | undefined,
  system: number | undefined,
  index: number | undefined
): ClimbGrade | undefined {
  if (system === undefined || index === undefined || system <= 0 || index < 0 || index === 255) {
    return undefined;
  }
  const table = tableFor(sportType, system);
  const row = table?.[system]?.[index];
  if (!table || !row || row[0] === "@jug") {
    return undefined;
  }
  const steps = row.slice(1) as number[];
  const top = steps[steps.length - 1] ?? 0;
  const family: ClimbFamily = table === BOULDER ? "boulder" : "route";
  const ladder = table === OUTDOOR ? Math.max(1, top - OUTDOOR_LADDER_OFFSET) : top;
  return { family, system, index, name: row[0], ladder };
}

/** One rung of a scale on its ladder: the steps it covers, lowest first. */
export interface LadderRung {
  name: string;
  steps: readonly number[];
}

/**
 * A scale's grades on the ladder of its family, lowest first: the rows a
 * pyramid is drawn in. A rope scale COROS keeps only outdoors (aid, ice,
 * mixed, British trad) is moved down onto the route ladder as its grades are.
 */
export function ladderRungs(family: ClimbFamily, system: number): LadderRung[] {
  if (family === "boulder") {
    return (BOULDER[system] ?? BOULDER[DEFAULT_CLIMB_SYSTEM.boulder]!).map(([name, ...steps]) => ({ name, steps }));
  }
  const indoor = INDOOR[system];
  if (indoor) {
    return indoor.map(([name, ...steps]) => ({ name, steps }));
  }
  const outdoor = OUTDOOR[system];
  if (!outdoor) {
    return ladderRungs("route", DEFAULT_CLIMB_SYSTEM.route);
  }
  return outdoor
    .filter(([name]) => name !== "@jug")
    .map(([name, ...steps]) => ({
      name,
      steps: [...new Set(steps.map((step) => Math.max(1, step - OUTDOOR_LADDER_OFFSET)))]
    }));
}

/**
 * Where a step of the ladder falls in a scale: the rung that covers it, as
 * COROS converts (`getGradingGradeByCommonGrade`), else the nearest end.
 */
export function rungIndexFor(rungs: readonly LadderRung[], ladder: number): number {
  const found = rungs.findIndex((rung) => rung.steps.includes(ladder));
  if (found >= 0) return found;
  const lowest = rungs[0]?.steps[0] ?? 1;
  return ladder < lowest ? 0 : rungs.length - 1;
}

/** A step of the ladder named in a scale: "6b+", "V4", "@easy". */
export function gradeNameOnLadder(family: ClimbFamily, system: number, ladder: number): string {
  const rungs = ladderRungs(family, system);
  return rungs[rungIndexFor(rungs, ladder)]?.name ?? "";
}

/**
 * The athlete's onsight grade from COROS's climb settings (`climbConfig`:
 * `gradeIndex` in the indoor rope scales for sport 6, the bouldering ones for
 * 7, as its settings page reads them), placed on the ladder.
 */
export function onsightLadder(family: ClimbFamily, system: number, gradeIndex: number): number | undefined {
  const table = family === "boulder" ? BOULDER : INDOOR;
  const row = table[system]?.[gradeIndex];
  if (!row) return undefined;
  const steps = row.slice(1) as number[];
  return steps[steps.length - 1];
}
