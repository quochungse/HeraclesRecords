// The two lines Sync and Backup both have to draw.
//
// Kept together because the panels are siblings that describe the same kind of
// thing — a destination and a file — and they carried byte-identical copies of
// both functions. Settings' storage locations read sizes through here too.

/** A stored ISO timestamp as the local machine writes dates. Falls back to the
 *  raw string rather than "Invalid Date", so a file from a future version still
 *  shows something a person can read. */
export function formatWhen(iso: string): string {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime())
    ? iso
    : parsed.toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short"
      });
}

/**
 * A size, rounded to what the number is actually for.
 *
 * These are Drive quotas and backup files — routinely past a gigabyte, where
 * "15360.0 MB" is a number nobody reads. Megabytes are whole: a tenth of a
 * megabyte says nothing about a quota.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  const megabytes = bytes / (1024 * 1024);
  return megabytes < 1024
    ? `${megabytes.toFixed(0)} MB`
    : `${(megabytes / 1024).toFixed(1)} GB`;
}
