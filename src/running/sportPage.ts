import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { TrainingHubActivity } from "../../electron/types";
import { PRIMARY_NAV_ITEMS, type PrimaryView } from "../navigation/primaryNav";
import type { SportScreenRequest } from "../training/types";
import { runWindowStartMs } from "./runMetrics";

/**
 * What every sport screen built on Running's page does the same way — Running,
 * Cycling and Hiking: which sessions a period covers, and a list that opens a
 * session on the whole page and comes back to exactly where it was left.
 *
 * It was written once for Running and then copied into each screen built after
 * it, a hundred lines at a time; a fix to one (the restore timer below was one)
 * had to be found and made three times.
 */

/**
 * Weeks the charts draw for a period.
 *
 * "All" is capped rather than unbounded: an athlete with six years of history
 * would get three hundred bars two pixels wide, which is a texture rather than
 * a chart, and the years before last are not what these screens are for.
 */
export const MAX_ALL_TIME_WEEKS = 104;

export function weeksForPeriod(days: number | null): number {
  return days === null ? MAX_ALL_TIME_WEEKS : Math.max(1, Math.ceil(days / 7));
}

/**
 * The sessions a period covers, cut at the same Monday the charts start on —
 * see `runWindowStartMs`. "4 weeks" is four calendar weeks, this one included,
 * for the totals strip, the list and every chart alike.
 */
export function withinPeriod(
  activities: readonly TrainingHubActivity[],
  days: number | null,
  nowMs: number
): TrainingHubActivity[] {
  if (days === null) {
    return [...activities];
  }

  const cutoff = runWindowStartMs(weeksForPeriod(days), nowMs) / 1000;
  return activities.filter(
    (activity) => activity.startTime !== undefined && activity.startTime >= cutoff
  );
}

/** Keys that scroll a page — the ones that mean the athlete took over. */
const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "]);

/** How often, and for how long, a restored scroll position is re-applied. */
const RESTORE_INTERVAL_MS = 50;
const RESTORE_DEADLINE_MS = 1000;

export interface SessionPageOptions {
  /** Every session the screen holds, whatever its filters — a handed-over one may be outside them. */
  activities: readonly TrainingHubActivity[];
  onSelectActivity: (activity: TrainingHubActivity) => void;
  /** A session another screen handed over, to be opened rather than merely listed. */
  openRequest?: SportScreenRequest | null;
  /** Taken, so the same session is not re-opened when the athlete closes it. */
  onOpenRequestHandled?: () => void;
  /** Back on a handed-over session: that screen, again. */
  onReturn?: (view: PrimaryView) => void;
  /** What Back reads when it goes to this screen's own list: "Running". */
  listLabel: string;
}

export interface SessionPage {
  /** The page's own scroller — the whole page is one scroll, title and filters included. */
  pageRef: RefObject<HTMLElement | null>;
  /** The session open on the whole page, or null while the list is showing. */
  selected: TrainingHubActivity | null;
  selectedId: string | null;
  /** What the detail page's Back reads: the list, or the screen it came from. */
  backLabel: string;
  open: (activity: TrainingHubActivity) => void;
  close: () => void;
}

/**
 * A list that opens one session on the whole page and closes back to it.
 *
 * Opening keeps the list's scroll position and closing lands on it again,
 * which is what makes the full-page detail feel like a drill-down rather than
 * a trip back to the top. A session handed over from another screen (Activities,
 * the Library) is opened by id — so one outside the current period opens just
 * the same — and Back then returns to that screen.
 */
export function useSessionPage({
  activities,
  onSelectActivity,
  openRequest = null,
  onOpenRequestHandled,
  onReturn,
  listLabel
}: SessionPageOptions): SessionPage {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Where Back goes from the session open: the screen that handed it over, or,
  // for a session opened from this list, the list.
  const [returnTo, setReturnTo] = useState<PrimaryView | null>(null);
  const pageRef = useRef<HTMLElement>(null);
  const pageScrollTop = useRef(0);

  const selected = useMemo(
    () =>
      selectedId === null
        ? null
        : (activities.find((activity) => activity.activityId === selectedId) ?? null),
    [activities, selectedId]
  );

  const open = useCallback(
    (activity: TrainingHubActivity) => {
      pageScrollTop.current = pageRef.current?.scrollTop ?? 0;
      setSelectedId(activity.activityId);
      setReturnTo(null);
      onSelectActivity(activity);
    },
    [onSelectActivity]
  );

  const close = useCallback(() => {
    setSelectedId(null);
    setReturnTo(null);
    if (returnTo && onReturn) {
      onReturn(returnTo);
    }
  }, [onReturn, returnTo]);

  // The id is taken straight rather than looked up first: the screen mounts
  // with whatever `activities` the app already holds, and `selected` reads the
  // full history rather than the filtered list. The request is cleared as soon
  // as it is taken — leaving it standing would re-open the session the moment
  // the athlete closed it.
  useEffect(() => {
    if (!openRequest) {
      return;
    }

    const activity = activities.find((row) => row.activityId === openRequest.activityId);
    setSelectedId(openRequest.activityId);
    setReturnTo(openRequest.from ?? null);
    if (activity) {
      onSelectActivity(activity);
    }
    onOpenRequestHandled?.();
  }, [activities, onOpenRequestHandled, onSelectActivity, openRequest]);

  useLayoutEffect(() => {
    const page = pageRef.current;
    if (selected !== null || !page) {
      return;
    }

    const target = pageScrollTop.current;
    page.scrollTop = target;
    if (page.scrollTop >= target - 1) {
      return;
    }

    // The remounted page can still be growing at this moment, and a position
    // past its current end is clamped short — seen once in a real window as a
    // run opened at 2000px coming back at 798px. So the position is re-applied
    // until it lands, the athlete scrolls on their own, or a second has passed.
    // Never longer: fighting a scroll the athlete started is worse than landing
    // a little high.
    //
    // A timer, not a ResizeObserver. An observer only reports during a rendering
    // frame, and a window that is not being given frames — an occluded GNOME
    // Wayland window, which this app has met before — never reports, so the
    // restore quietly gave up. Writing `scrollTop` forces layout synchronously,
    // so a timer lands whether or not anything is being painted.
    const pageEvents = ["wheel", "touchstart", "pointerdown"] as const;
    let finished = false;
    const interval = window.setInterval(() => {
      page.scrollTop = target;
      if (page.scrollTop >= target - 1) {
        finish();
      }
    }, RESTORE_INTERVAL_MS);
    const deadline = window.setTimeout(finish, RESTORE_DEADLINE_MS);

    // Only keys that scroll count. Escape is what closes a detail page, and its
    // keydown is still travelling up to the window when this effect runs —
    // listening for any key here would catch the very press that brought the
    // athlete back and cancel the restore on arrival.
    const onKeyDown = (event: KeyboardEvent) => {
      if (SCROLL_KEYS.has(event.key)) {
        finish();
      }
    };

    function finish() {
      if (finished) {
        return;
      }
      finished = true;
      window.clearInterval(interval);
      window.clearTimeout(deadline);
      for (const type of pageEvents) {
        page?.removeEventListener(type, finish);
      }
      window.removeEventListener("keydown", onKeyDown);
    }

    for (const type of pageEvents) {
      page.addEventListener(type, finish, { passive: true });
    }
    // Keyboard scrolling reaches the window, not the page, when focus sits on
    // the document body.
    window.addEventListener("keydown", onKeyDown);
    return finish;
  }, [selected]);

  const backLabel =
    (returnTo && onReturn && PRIMARY_NAV_ITEMS.find((item) => item.id === returnTo)?.label) ||
    listLabel;

  return { pageRef, selected, selectedId, backLabel, open, close };
}

/** `MouseEvent.button` for the mouse's back button. */
const MOUSE_BACK_BUTTON = 3;

/**
 * Back on a detail page is its button and the mouse's back button, as in a
 * browser. Taken on the way up and cancelled, where Chromium would otherwise go
 * back in the window's own history; a mouse whose driver sends its back button
 * as the Browser Back key arrives as that key instead.
 */
export function useBackGesture(onBack: () => void): void {
  useEffect(() => {
    const onMouseUp = (event: MouseEvent) => {
      if (event.button === MOUSE_BACK_BUTTON) {
        event.preventDefault();
        onBack();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "BrowserBack") {
        event.preventDefault();
        onBack();
      }
    };
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onBack]);
}
