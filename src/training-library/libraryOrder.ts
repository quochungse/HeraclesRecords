/**
 * The one order both library tabs open in: **favourites first, then by name.**
 *
 * A favourite is the athlete saying "this is the one I reach for", so it leads
 * the list rather than waiting at whatever letter it happens to start with.
 * Inside each half the order is the name, because name is the one key every
 * row — a plan or a workout — carries in its first paint.
 *
 * Names compare `numeric` and case-insensitively, so "Week 2" sits before
 * "Week 10" and "tempo" beside "Tempo". The id breaks a tie, so two rows with
 * one name cannot swap places between renders.
 *
 * Nothing here imports React, so `test:plan-filters` runs it directly.
 */
export interface LibraryOrderable {
  id: string;
  name: string;
  favorite: boolean;
}

const NAME_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function compareLibraryNames(left: string, right: string): number {
  return NAME_COLLATOR.compare(left.trim(), right.trim());
}

export function compareFavoriteThenName(left: LibraryOrderable, right: LibraryOrderable): number {
  if (left.favorite !== right.favorite) return left.favorite ? -1 : 1;
  return compareLibraryNames(left.name, right.name) || left.id.localeCompare(right.id);
}
