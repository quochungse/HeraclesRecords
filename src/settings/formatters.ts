import { getIntlLocale } from "../i18n/core";

// The two lines Sync and Backup both have to draw.
//
// Kept together because the panels are siblings that describe the same kind of
// thing — a destination and a file — and they carried byte-identical copies of
// both functions. Settings' storage locations read sizes through here too.

/** A stored ISO timestamp, written the way the app's language writes dates. Falls back to the
 *  raw string rather than "Invalid Date", so a file from a future version still
 *  shows something a person can read. */
export function formatWhen(iso: string): string {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime())
    ? iso
    : parsed.toLocaleString(getIntlLocale(), {
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
  // In the language's own digits: 6,0 GB in German, 6.0 GB in English.
  const figure = (value: number, digits: number) =>
    value.toLocaleString(getIntlLocale(), {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
  if (bytes < 1024) return `${figure(bytes, 0)} B`;
  if (bytes < 1024 * 1024) return `${figure(bytes / 1024, 0)} KB`;
  const megabytes = bytes / (1024 * 1024);
  return megabytes < 1024
    ? `${figure(megabytes, 0)} MB`
    : `${figure(megabytes / 1024, 1)} GB`;
}
