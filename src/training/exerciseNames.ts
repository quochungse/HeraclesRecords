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
