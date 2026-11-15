/**
 * Said when a strength sync has read breakdowns COROS still owed. Until its
 * sets are read a strength session's Heracles load is COROS's figure
 * (`pending`), so every list read before then — the app's activities, the day
 * deltas, the planned loads — holds the wrong figure until it is read again.
 * Whoever holds such a list listens here.
 */
const listeners = new Set<() => void>();

export function onStrengthBreakdownsRead(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function announceStrengthBreakdownsRead(): void {
  for (const listener of [...listeners]) listener();
}
