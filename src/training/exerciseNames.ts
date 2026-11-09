import exerciseNames from "./exerciseNames.json" with { type: "json" };
import { t, type MessageKey } from "../i18n/core.ts";

const NAME_MAP = exerciseNames as Record<string, string>;
const CODE_RE = /^[TS]\d/;

/**
 * Unstructured (free) strength sessions have no program, so the watch labels
 * each auto-detected segment by the body region worked, using S-codes that are
 * absent from the exercise catalogue. Verified against the COROS app — these are
 * body regions, not specific exercises.
 */
const BODY_REGION_CODES = new Set(["S4208", "S4209", "S4210", "S4211", "S4212", "S4213", "S4214"]);

/** A body region's name in the language on screen. */
function bodyRegionName(code: string): string | undefined {
  return BODY_REGION_CODES.has(code) ? t(`activity.region.${code}` as MessageKey) : undefined;
}

/**
 * Resolve a COROS strength exercise name for display (English).
 * - Built-in library codes (T####/S####) come from the bundled dictionary.
 * - Unstructured-session body-region S-codes come from BODY_REGION_NAMES.
 * - User-custom exercises carry a readable `rawName` in the payload; use it.
 * - Anything unresolved falls back to the key verbatim (never throws).
 */
export function resolveExerciseName(nameKey: string, rawName?: string): string {
  const mapped = NAME_MAP[nameKey] ?? bodyRegionName(nameKey);
  if (mapped) {
    return mapped;
  }
  if (rawName && rawName.trim() && !CODE_RE.test(rawName.trim())) {
    return rawName.trim();
  }
  return nameKey;
}

/** What a done exercise is called, and the movement key recovered for it. */
export interface NamedExercise {
  nameKey: string;
  rawName?: string;
  corosKey?: string;
}

/**
 * The movement a done exercise is, in words. A step named in words of its own
 * ("Bench 60 kg 4x6-10") comes back from the watch under those words in place
 * of the key; COROS's key for the movement, recovered from the program by the
 * step's catalog id (`corosKey`), is the movement whatever the step was called.
 * The names stand in only where there is no key (Hevy, a custom movement) or
 * the key names nothing.
 */
export function resolveMovementName(exercise: NamedExercise): string {
  if (exercise.corosKey) {
    const byKey = resolveExerciseName(exercise.corosKey);
    if (!CODE_RE.test(byKey)) return byKey;
  }
  return resolveExerciseName(exercise.nameKey, exercise.rawName);
}

/** Letters and digits only, in one case: "Bench press" and "Bench-Press" are one name. */
export function sameExerciseName(left: string, right: string): boolean {
  const plain = (value: string) => value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  return plain(left) === plain(right);
}

/**
 * The name a COROS step was given, when it says more than its movement's:
 * "KĐ Bench 40 kg" for a warm-up set of Bench Press. Drawn under the movement,
 * never grouped by. Only a movement known by its key has one — without the
 * key the name is all there is, and it is already the title.
 */
export function exerciseStepLabel(exercise: NamedExercise): string | undefined {
  if (!exercise.corosKey) return undefined;
  const own = [exercise.rawName, exercise.nameKey]
    .map((value) => value?.trim())
    .find((value): value is string => Boolean(value) && !CODE_RE.test(value!));
  if (!own) return undefined;
  const movement = resolveMovementName(exercise);
  return CODE_RE.test(movement) || sameExerciseName(own, movement) ? undefined : own;
}
