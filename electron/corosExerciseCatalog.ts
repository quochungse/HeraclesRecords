/**
 * The rows a COROS workout step is built from, as the Training Hub web app
 * builds it.
 *
 * The web app never hand-builds a step. Its serializer (`ts()` in the
 * Training Hub bundle, read 2026-10-20) starts every step from a deep clone of
 * a row of `/training/exercise/query` — the movement picked for a strength
 * step, the catalog's warm-up / training / cool-down / rest row for every
 * other step — and only then writes the step's own id, group, sets, target,
 * intensity and rest over it. A name or overview typed in the editor replaces
 * the row's; nothing else of the row is touched.
 *
 * What rides along is what COROS reads: a strength row carries `muscle`,
 * `muscleRelevance`, `part` and `equipment`, and COROS draws a session's
 * muscle map from those fields on the program the watch ran — not from
 * `originId`. A step built here with `part: [0]` and no muscle fields got an
 * activity with `muscleList: []` (probed 2026-10-20). Its `name` is a
 * localisation key (`T1041`) that the app and the watch resolve in the
 * athlete's language, and its `overview` is the movement's description key.
 *
 * Run, bike and pool swim have four rows each (read 2026-10-20), fixed, and kept
 * here so a payload can be built without a request. Strength has ~380
 * movements and is read from COROS (`loadWorkoutExerciseCatalog`); its three
 * non-movement rows are kept here too. Trail run, climbing, XC ski and HYROX
 * have no catalog, and the web app builds their steps from its own new-workout
 * template, which uses the run rows; `TEMPLATE_STEP_ROWS` are those. The
 * callers name a HYROX run step `HYROX_RUN_STEP_NAME` themselves.
 *
 * Node-free: the renderer may import it.
 */

export type CorosExerciseRow = Record<string, unknown>;

/** Catalog rows by their id, which is a step's `originId`. */
export type CorosExerciseCatalog = ReadonlyMap<string, CorosExerciseRow>;

/** COROS's exerciseType: 1 warm-up, 2 training, 3 cool-down, 4 rest. */
type CorosStepExerciseType = 1 | 2 | 3 | 4;

/** HYROX's running step: the web app writes this name whatever the step says (`ts()`). */
export const HYROX_RUN_STEP_NAME = "T1398";

/** The strength template's training row, for a movement the catalog was not read for. */
const STRENGTH_TEMPLATE_TRAINING: CorosExerciseRow = {"access":0,"createTimestamp":1586597188,"defaultOrder":2,"exerciseType":2,"hrType":0,"intensityCustom":0,"intensityDisplayUnit":0,"intensityMultiplier":0,"intensityPercent":0,"intensityPercentExtend":0,"intensityType":1,"intensityValue":0,"intensityValueExtend":0,"isDefaultAdd":0,"isGroup":false,"isIntensityPercent":false,"name":"T5067","originId":"426109589008859136","overview":"sid_strength_training","part":[0],"restType":1,"restValue":60,"sets":1,"sourceId":"0","sourceUrl":"","subType":0,"targetDisplayUnit":0,"targetType":3,"targetValue":15,"userId":0,"videoUrl":""};

const CATALOG_STEP_ROWS: Readonly<Record<number, Readonly<Partial<Record<1 | 2 | 3 | 4, CorosExerciseRow>>>>> = {
  1: {
    1: {"access":0,"createTimestamp":1586612868,"defaultOrder":1,"equipment":[1],"exerciseType":1,"id":"425895398452936705","intensityCustom":0,"intensityType":0,"isDefaultAdd":0,"isGroup":false,"isIntensityPercent":false,"name":"T1120","overview":"sid_run_warm_up_dist","part":[0],"restType":3,"sets":1,"sortNo":0,"sourceUrl":"","sportType":1,"status":1,"targetType":2,"targetValue":300,"userId":0,"videoInfos":[],"videoUrl":""},
    2: {"access":0,"createTimestamp":1587410719,"defaultOrder":2,"equipment":[1],"exerciseType":2,"id":"426109589008859136","intensityCustom":0,"intensityType":0,"isDefaultAdd":1,"isGroup":false,"isIntensityPercent":false,"name":"T3001","overview":"sid_run_training","part":[0],"restType":1,"restValue":60,"sets":1,"sortNo":0,"sourceUrl":"","sportType":1,"status":1,"targetType":5,"targetValue":100000,"userId":0,"videoInfos":[]},
    3: {"access":0,"createTimestamp":1586613014,"defaultOrder":3,"equipment":[1],"exerciseType":3,"id":"425895456971866112","intensityCustom":0,"intensityType":0,"isDefaultAdd":0,"isGroup":false,"isIntensityPercent":false,"name":"T1122","overview":"sid_run_cool_down_dist","part":[0],"restType":3,"sets":1,"sortNo":0,"sourceUrl":"","sportType":1,"status":1,"targetType":2,"targetValue":300,"userId":0,"videoInfos":[],"videoUrl":""},
    4: {"access":0,"createTimestamp":1586612553,"defaultOrder":0,"equipment":[1],"exerciseType":4,"id":"425895332954685440","intensityCustom":0,"intensityType":1,"intensityValue":0,"isDefaultAdd":0,"isGroup":false,"isIntensityPercent":false,"name":"T1123","overview":"sid_run_rest_time","part":[0],"restType":0,"sets":1,"sortNo":0,"sourceUrl":"","sportType":1,"status":1,"targetType":2,"targetValue":300,"userId":0,"videoInfos":[],"videoUrl":""},
  },
  2: {
    1: {"access":0,"createTimestamp":1586614521,"defaultOrder":1,"equipment":[1],"exerciseType":1,"id":"425895843250487297","intensityCustom":0,"intensityType":0,"isDefaultAdd":0,"isGroup":false,"isIntensityPercent":false,"name":"T1120","overview":"sid_bike_warm_up_dist","part":[0],"restType":3,"sets":1,"sortNo":0,"sourceUrl":"","sportType":2,"status":1,"targetType":2,"targetValue":300,"userId":0,"videoInfos":[],"videoUrl":""},
    2: {"access":0,"createTimestamp":1586613861,"defaultOrder":2,"equipment":[1],"exerciseType":2,"id":"425895474420170753","intensityCustom":0,"intensityType":0,"isDefaultAdd":1,"isGroup":false,"isIntensityPercent":false,"name":"T4000","overview":"sid_bike_dist_speed","part":[0],"restType":1,"restValue":60,"sets":1,"sortNo":0,"sourceUrl":"","sportType":2,"status":1,"targetType":5,"targetValue":100000,"userId":0,"videoInfos":[],"videoUrl":""},
    3: {"access":0,"createTimestamp":1586614638,"defaultOrder":3,"equipment":[1],"exerciseType":3,"id":"425895892642611200","intensityCustom":0,"intensityType":0,"isDefaultAdd":0,"isGroup":false,"isIntensityPercent":false,"name":"T1122","overview":"sid_bike_cool_down_dist","part":[0],"restType":3,"sets":1,"sortNo":0,"sourceUrl":"","sportType":2,"status":1,"targetType":2,"targetValue":300,"userId":0,"videoInfos":[],"videoUrl":""},
    4: {"access":0,"createTimestamp":1586614415,"defaultOrder":0,"equipment":[1],"exerciseType":4,"id":"425895820970344449","intensityCustom":0,"intensityType":0,"isDefaultAdd":0,"isGroup":false,"isIntensityPercent":false,"name":"T1123","overview":"sid_bike_rest_time","part":[0],"restType":1,"restValue":600,"sets":1,"sortNo":0,"sourceUrl":"","sportType":2,"status":1,"targetType":1,"userId":0,"videoInfos":[],"videoUrl":""},
  },
  3: {
    1: {"access":0,"createTimestamp":1586615698,"defaultOrder":1,"equipment":[1],"exerciseType":1,"id":"425896164567728129","intensityCustom":0,"intensityType":0,"isDefaultAdd":0,"isGroup":false,"isIntensityPercent":false,"name":"T1120","overview":"sid_poolswim_warm_up_dist","part":[0],"restType":3,"sets":1,"sortNo":0,"sourceUrl":"","sportType":3,"status":1,"targetType":2,"targetValue":300,"userId":0,"videoInfos":[],"videoUrl":""},
    2: {"access":0,"createTimestamp":1586614826,"defaultOrder":2,"equipment":[1],"exerciseType":2,"id":"425895924049559553","intensityCustom":0,"intensityType":5,"intensityValue":0,"isDefaultAdd":1,"isGroup":false,"isIntensityPercent":false,"name":"T5000","overview":"sid_poolswim_dist_default","part":[0],"restType":1,"restValue":60,"sets":1,"sortNo":0,"sourceUrl":"","sportType":3,"status":1,"targetType":5,"targetValue":100000,"userId":0,"videoInfos":[],"videoUrl":""},
    3: {"access":0,"createTimestamp":1586615831,"defaultOrder":3,"equipment":[1],"exerciseType":3,"id":"425896212886110208","intensityCustom":0,"intensityType":0,"isDefaultAdd":0,"isGroup":false,"isIntensityPercent":false,"name":"T1122","overview":"sid_poolswim_cool_down_dist","part":[0],"restType":3,"sets":1,"sortNo":0,"sourceUrl":"","sportType":3,"status":1,"targetType":2,"targetValue":300,"userId":0,"videoInfos":[],"videoUrl":""},
    4: {"access":0,"createTimestamp":1586615614,"defaultOrder":0,"equipment":[1],"exerciseType":4,"id":"425896122691796993","intensityCustom":0,"intensityType":1,"intensityValue":0,"isDefaultAdd":0,"isGroup":false,"isIntensityPercent":false,"name":"T1123","overview":"sid_poolswim_rest_time","part":[0],"restType":1,"restValue":600,"sets":1,"sortNo":0,"sourceUrl":"","sportType":3,"status":1,"targetType":2,"targetValue":600,"userId":0,"videoInfos":[],"videoUrl":""},
  },
  4: {
    1: {"access":0,"createTimestamp":1586625945,"defaultOrder":1,"exerciseType":1,"id":"425898928110747648","intensityCustom":0,"intensityType":0,"isDefaultAdd":0,"isGroup":false,"isIntensityPercent":false,"name":"T1120","overview":"sid_strength_warm_up","part":[0],"restType":3,"sets":1,"sortNo":0,"sourceUrl":"","sportType":4,"status":1,"targetType":2,"targetValue":300,"userId":0,"videoInfos":[],"videoUrl":""},
    3: {"access":0,"createTimestamp":1586626025,"defaultOrder":3,"exerciseType":3,"id":"425898949585584128","intensityCustom":0,"intensityType":0,"isDefaultAdd":0,"isGroup":false,"isIntensityPercent":false,"name":"T1122","overview":"sid_strength_cool_down","part":[0],"restType":3,"sets":1,"sortNo":0,"sourceUrl":"","sportType":4,"status":1,"targetType":2,"targetValue":300,"userId":0,"videoInfos":[],"videoUrl":""},
    4: {"access":0,"createTimestamp":1590111012,"defaultOrder":0,"exerciseType":4,"id":"426842174601216000","intensityCustom":0,"intensityType":0,"isDefaultAdd":0,"isGroup":false,"isIntensityPercent":false,"name":"T1123","overview":"sid_strength_rest","part":[0],"restType":3,"sets":1,"sortNo":0,"sourceUrl":"","sportType":4,"status":1,"targetType":2,"targetValue":240,"userId":0,"videoInfos":[],"videoUrl":""},
  },
};

const TEMPLATE_STEP_ROWS: Readonly<Record<1 | 2 | 3 | 4, CorosExerciseRow>> = {
  1: {"access":0,"createTimestamp":1586584068,"defaultOrder":1,"equipment":[1],"exerciseType":1,"hrType":3,"intensityCustom":2,"intensityDisplayUnit":0,"intensityMultiplier":0,"intensityPercent":0,"intensityPercentExtend":0,"intensityType":2,"intensityValue":0,"intensityValueExtend":0,"isDefaultAdd":0,"isGroup":false,"isIntensityPercent":false,"name":"T1120","originId":"425895398452936705","overview":"sid_run_warm_up_dist","part":[0],"restType":3,"restValue":0,"sets":1,"sourceId":"0","sourceUrl":"","subType":0,"targetDisplayUnit":0,"targetType":2,"targetValue":300,"userId":0,"videoUrl":""},
  2: {"access":0,"createTimestamp":1587381919,"defaultOrder":2,"equipment":[1],"exerciseType":2,"hrType":3,"intensityCustom":2,"intensityDisplayUnit":0,"intensityMultiplier":0,"intensityPercent":0,"intensityPercentExtend":0,"intensityType":2,"intensityValue":0,"intensityValueExtend":0,"isDefaultAdd":1,"isGroup":false,"isIntensityPercent":false,"name":"T3001","originId":"426109589008859136","overview":"sid_run_training","part":[0],"restType":3,"restValue":0,"sets":1,"sourceId":"0","sourceUrl":"","subType":0,"targetDisplayUnit":0,"targetType":2,"targetValue":300,"userId":0,"videoUrl":""},
  3: {"access":0,"createTimestamp":1586584214,"defaultOrder":3,"equipment":[1],"exerciseType":3,"hrType":3,"intensityCustom":2,"intensityDisplayUnit":0,"intensityMultiplier":0,"intensityPercent":0,"intensityPercentExtend":0,"intensityType":2,"intensityValue":0,"intensityValueExtend":0,"isDefaultAdd":0,"isGroup":false,"isIntensityPercent":false,"name":"T1122","originId":"425895456971866112","overview":"sid_run_cool_down_dist","part":[0],"restType":3,"restValue":0,"sets":1,"sourceId":"0","sourceUrl":"","subType":0,"targetDisplayUnit":0,"targetType":2,"targetValue":300,"userId":0,"videoUrl":""},
  4: {"access":0,"createTimestamp":1586584214,"defaultOrder":3,"equipment":[1],"exerciseType":4,"hrType":3,"intensityCustom":2,"intensityDisplayUnit":0,"intensityMultiplier":0,"intensityPercent":0,"intensityPercentExtend":0,"intensityType":2,"intensityValue":0,"intensityValueExtend":0,"isDefaultAdd":0,"isGroup":false,"isIntensityPercent":false,"name":"T1123","originId":"425895398452936705","overview":"sid_run_cool_down_dist","part":[0],"restType":3,"restValue":0,"sets":1,"sourceId":"0","sourceUrl":"","subType":0,"targetDisplayUnit":0,"targetType":2,"targetValue":300,"userId":0,"videoUrl":""},
};

export const COROS_SOURCE_THUMBNAILS: readonly { sourceId: string; sourceUrl: string }[] = [
  {"sourceId":"425706707117850624","sourceUrl":"https://d31oxp44ddzkyk.cloudfront.net/source/source_default/0/ee2ec19837ba4093b7c8617eb2f9b1f5.jpg"},
  {"sourceId":"425846071290413056","sourceUrl":"https://d31oxp44ddzkyk.cloudfront.net/source/source_default/0/0508c8b8638d47bead5cc384ea561ec7.jpg"},
  {"sourceId":"425868113867882496","sourceUrl":"https://d31oxp44ddzkyk.cloudfront.net/source/source_default/0/5a9db1c3363348298351aaabfd70d0f5.jpg"},
  {"sourceId":"425868113867882497","sourceUrl":"https://d31oxp44ddzkyk.cloudfront.net/source/source_default/0/e3611f19b15648338b0f229b2b1b1015.jpg"},
  {"sourceId":"425868125142171648","sourceUrl":"https://d31oxp44ddzkyk.cloudfront.net/source/source_default/0/eefebdab17d748e59a626f71dbd285f5.jpg"},
  {"sourceId":"425868125142171649","sourceUrl":"https://d31oxp44ddzkyk.cloudfront.net/source/source_default/0/a9dc1a410a0b4becb48157577cbf6852.jpg"},
  {"sourceId":"425868133463670784","sourceUrl":"https://d31oxp44ddzkyk.cloudfront.net/source/source_default/0/2fbd46e17bc54bc5873415c9fa767bdc.jpg"},
  {"sourceId":"425868133463670785","sourceUrl":"https://d31oxp44ddzkyk.cloudfront.net/source/source_default/0/47a2076264084ba78e44b7bb0ca36a0c.jpg"},
  {"sourceId":"425868142590476288","sourceUrl":"https://d31oxp44ddzkyk.cloudfront.net/source/source_default/0/1a3b389aac8a4fe5915860cef62b2b5b.jpg"},
  {"sourceId":"425868142590476289","sourceUrl":"https://d31oxp44ddzkyk.cloudfront.net/source/source_default/0/32e31ac51037460b838a431efd8a33e1.jpg"}
];

export function catalogIndex(rows: readonly CorosExerciseRow[]): CorosExerciseCatalog {
  const index = new Map<string, CorosExerciseRow>();
  for (const row of rows) {
    const id = row.id;
    if (typeof id === "string" || typeof id === "number") index.set(String(id), row);
  }
  return index;
}

/**
 * The object a step starts from: a deep clone of `catalogRow` when there is
 * one, else the sport's own row for the step's type, else the web template's.
 * `originId` is set from the row and `id` is left to the caller, as the web
 * app numbers its steps itself.
 */
export function stepBaseRow(
  sportType: number,
  exerciseType: number,
  catalogRow?: CorosExerciseRow
): CorosExerciseRow {
  const type: CorosStepExerciseType =
    exerciseType === 1 || exerciseType === 3 || exerciseType === 4 ? exerciseType : 2;
  const source = catalogRow ??
    CATALOG_STEP_ROWS[sportType]?.[type] ??
    (sportType === 4 && type === 2 ? STRENGTH_TEMPLATE_TRAINING : TEMPLATE_STEP_ROWS[type]);
  const base = structuredClone(source) as CorosExerciseRow;
  const originId = base.originId ?? base.id;
  delete base.id;
  // The app's own reading of the row (`nameFromCorosLocale`), not COROS's.
  delete base.displayName;
  base.originId = originId === undefined ? "0" : String(originId);
  return base;
}

/**
 * A program's cover. The web app picks one of these ten at random
 * (`getRandomThumbnail(30)`); this picks by the program's name instead, so the
 * same workout built twice is the same payload — a plan upload uses the
 * payload itself to spot a workout it has already written.
 */
export function sourceThumbnailFor(key: string): { sourceId: string; sourceUrl: string } {
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
  }
  return { ...COROS_SOURCE_THUMBNAILS[hash % COROS_SOURCE_THUMBNAILS.length]! };
}

/**
 * COROS's pool-length preset for a length in centimetres and a unit
 * (2 metres, 4 yards): 1 = 25 m, 2 = 50 m, 3 = 25 yd, 4 = 33⅓ m, 5 = 33⅓ yd,
 * 0 = custom — the web app's `gs()` read backwards.
 */
export function poolLengthPresetId(poolLengthCm: number, poolLengthUnit: number): number {
  if (poolLengthUnit === 4) {
    if (poolLengthCm === 2286) return 3;
    if (poolLengthCm === 3048) return 5;
    return 0;
  }
  if (poolLengthCm === 2500) return 1;
  if (poolLengthCm === 5000) return 2;
  if (poolLengthCm === 3333) return 4;
  return 0;
}

/**
 * The fields that make a program the row it is on COROS, as against what it
 * says: who wrote it, which plan holds it, its version, its cover. A session
 * rebuilt from an edit — or a template session written onto a running copy —
 * takes these from the row it replaces, as the web app edits a clone of the
 * existing program rather than a new one.
 */
export const PROGRAM_IDENTITY_KEYS = [
  "id", "planId", "planIdIndex", "version", "userId", "authorId", "createTimestamp",
  "star", "headPic", "nickname", "sourceId", "sourceUrl", "videoUrl", "videoCoverUrl",
  "profile", "access", "status", "deleted", "thirdPartyId"
] as const;

export function withProgramIdentity(program: CorosExerciseRow, row: CorosExerciseRow | undefined): CorosExerciseRow {
  if (!row) return program;
  const merged = structuredClone(program);
  for (const key of PROGRAM_IDENTITY_KEYS) {
    if (row[key] !== undefined) merged[key] = structuredClone(row[key]);
  }
  return merged;
}

/**
 * A library workout as the web app puts it on the calendar or into a plan
 * (`addProgram`): of a heart-rate or pace step's figures, only the half that
 * states the step is kept — a zone keeps its zone and no figures, a
 * percentage its percentages, an absolute range its range — so COROS works
 * the rest out again from the athlete's thresholds on the day. A library
 * detail carries both halves resolved as they were when it was saved, and
 * sent as it is, a step would keep a bpm or a pace from zones since changed.
 * A step with no intensity type is written with type 0.
 */
export function libraryProgramForCalendar(program: CorosExerciseRow): CorosExerciseRow {
  const copy = structuredClone(program);
  const exercises = Array.isArray(copy.exercises) ? copy.exercises : [];
  for (const item of exercises) {
    if (!item || typeof item !== "object") continue;
    const exercise = item as CorosExerciseRow;
    if (exercise.isGroup) continue;
    const type = Number(exercise.intensityType);
    if (!type) {
      exercise.intensityType = 0;
      continue;
    }
    if (type !== 2 && type !== 3) continue;
    if (Number(exercise.intensityCustom)) {
      exercise.intensityValue = 0;
      exercise.intensityValueExtend = 0;
      exercise.intensityPercent = 0;
      exercise.intensityPercentExtend = 0;
    } else if (exercise.isIntensityPercent) {
      exercise.intensityValue = 0;
      exercise.intensityValueExtend = 0;
    } else {
      exercise.intensityPercent = 0;
      exercise.intensityPercentExtend = 0;
    }
  }
  return copy;
}
