import { createContext, useContext, useEffect, useRef } from "react";

/** What the modal's title bar should show while a sub-screen is open. */
export interface AutomationsNav {
  title: string;
  onBack: () => void;
}

const AutomationsNavContext = createContext<
  ((nav: AutomationsNav | null) => void) | null
>(null);

export const AutomationsNavProvider = AutomationsNavContext.Provider;

/**
 * Sub-screens publish their own back action to the modal header rather than
 * drawing a second header of their own, so there is one place to go back from
 * however deep the athlete is.
 *
 * Only leaf screens register. The registration is cleared on unmount, so
 * returning to the list restores the modal's own title without the list having
 * to know which screen it came from.
 */
export function useAutomationsNav(nav: AutomationsNav | null): void {
  const setNav = useContext(AutomationsNavContext);
  // The registered `onBack` has to be stable, and callers pass an inline arrow.
  // Depending on its identity re-registers on every render, which re-renders
  // the modal, which re-renders the caller, which makes a new arrow: React
  // ends that with "Maximum update depth exceeded". So the callback is held in
  // a ref and the registration is keyed on the title alone.
  const onBackRef = useRef(nav?.onBack);
  onBackRef.current = nav?.onBack;
  const title = nav?.title;

  useEffect(() => {
    if (!setNav) return;
    if (!title) {
      setNav(null);
      return;
    }
    setNav({ title, onBack: () => onBackRef.current?.() });
    return () => setNav(null);
  }, [setNav, title]);
}
