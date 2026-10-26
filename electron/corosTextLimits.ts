/**
 * Text entered here and written to COROS. Training Hub names and plan overviews
 * are limited in UTF-8 bytes, not JavaScript string length (see
 * docs/coros-text-limits.md). Session and step notes use a 200-byte limit for
 * compatibility with COROS iOS. Keep this module usable by the renderer as
 * well as the main process.
 */
export const COROS_NAME_MAX_BYTES = 90;
export const COROS_PLAN_DESCRIPTION_MAX_BYTES = 800;
export const COROS_WORKOUT_DESCRIPTION_MAX_BYTES = 200;
export const COROS_STEP_DESCRIPTION_MAX_BYTES = 200;

const encoder = new TextEncoder();

export function corosUtf8Length(value: string): number {
  return encoder.encode(value).length;
}

/** Clamp typed text without splitting an emoji or a multibyte character. */
export function clampCorosUtf8(value: string, maxBytes: number): string {
  let bytes = 0;
  let result = "";
  for (const character of value) {
    bytes += corosUtf8Length(character);
    if (bytes > maxBytes) break;
    result += character;
  }
  return result;
}

export function corosTextLimitError(
  value: string | undefined,
  label: string,
  limit: number,
  unit: "bytes" | "characters"
): string | undefined {
  const length = unit === "bytes" ? corosUtf8Length(value ?? "") : (value ?? "").length;
  return length > limit ? `${label} must be ${limit} ${unit === "bytes" ? "UTF-8 bytes" : "characters"} or fewer.` : undefined;
}

export function assertCorosTextLimit(
  value: string | undefined,
  label: string,
  limit: number,
  unit: "bytes" | "characters"
): void {
  const error = corosTextLimitError(value, label, limit, unit);
  if (error) throw new Error(error);
}

/** Automatic copy names leave room for the suffix inside COROS's byte limit. */
export function corosCopyName(name: string): string {
  const suffix = " Copy";
  return clampCorosUtf8(name, COROS_NAME_MAX_BYTES - corosUtf8Length(suffix)).trimEnd() + suffix;
}
