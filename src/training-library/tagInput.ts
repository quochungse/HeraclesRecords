/**
 * What a tag may be, held at the one place a tag is written.
 *
 * Tags are local labels — they are searched, filtered by, and drawn on a row
 * and on a tile, where the space they get is one clipped line. A tag long
 * enough to fill that line on its own says nothing the name has not already
 * said and hides the tags beside it, so the limit is stated at the input
 * rather than at the draw: a label that arrives clipped is a label the athlete
 * chose without being able to see what they were choosing.
 *
 * **Blocked as it is typed, not on save.** Both tag dialogs take one
 * comma-separated string, so a limit checked at confirm time would have to
 * refuse the whole line for one long entry in it — and the entry it refused
 * would be the only part the athlete could not see a reason for.
 */
export const TAG_MAX_LENGTH = 20;

/**
 * The typed line with every entry in it held to the limit.
 *
 * Whitespace is left exactly where it is on an entry short enough to keep,
 * because this runs on every keystroke: trimming as it goes would eat the
 * space after a comma the moment it was typed.
 */
export function clampTagInput(value: string): string {
  return value
    .split(",")
    .map((segment) => {
      const body = segment.trim();
      if (body.length <= TAG_MAX_LENGTH) return segment;
      const lead = segment.slice(0, segment.length - segment.trimStart().length);
      /* trimEnd, or a cut that lands on a space leaves one hanging in front
         of the comma the athlete types next. */
      return lead + body.slice(0, TAG_MAX_LENGTH).trimEnd();
    })
    .join(",");
}

/**
 * The line as the tags it names: trimmed, held to the limit, emptied of
 * blanks, and each one once.
 *
 * The limit is applied here as well as at the input because a stored tag can
 * predate it — COROS holds no tags, so these are this app's own, and a
 * transcript of them written by an older build is the ordinary case.
 */
export function parseTagInput(value: string): string[] {
  return [
    ...new Set(
      value
        .split(",")
        .map((item) => item.trim().slice(0, TAG_MAX_LENGTH))
        .filter(Boolean)
    )
  ];
}
