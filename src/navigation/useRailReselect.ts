import { useEffect, useRef } from "react";

/**
 * The rail's item for the screen already showing, pressed again.
 *
 * Choosing the view that is already active changes no state, so a screen that
 * had drilled down — a run's page, a place open beside the globe — stayed
 * where it was and the press did nothing. App counts those presses instead and
 * hands the count down; a screen with somewhere to go back from calls this to
 * return to its top.
 *
 * The count is the app's, not the screen's, so a screen mounting after earlier
 * presses must not read them as its own: only a change seen after mount counts.
 */
export function useRailReselect(count: number | undefined, onReselect: () => void): void {
  const seen = useRef(count);

  useEffect(() => {
    if (count === seen.current) {
      return;
    }
    seen.current = count;
    onReselect();
  }, [count, onReselect]);
}
