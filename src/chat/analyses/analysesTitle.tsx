import { createContext, useContext, useEffect } from "react";

const AnalysesTitleContext = createContext<
  ((title: string | null) => void) | null
>(null);

export const AnalysesTitleProvider = AnalysesTitleContext.Provider;

/**
 * A sub-screen names itself in the modal's title bar rather than drawing a
 * second header of its own.
 *
 * This used to carry a back action too, which the header drew as an arrow
 * beside the title. There was never anywhere for it to go: the modal holds one
 * screen, so back and close were the same move, and the header offered both.
 * Only the title survived.
 *
 * The registration is cleared on unmount, so the modal falls back to its own
 * title without having to know which screen it was showing.
 */
export function useAnalysesTitle(title: string | null): void {
  const setTitle = useContext(AnalysesTitleContext);

  useEffect(() => {
    if (!setTitle) return;
    if (!title) {
      setTitle(null);
      return;
    }
    setTitle(title);
    return () => setTitle(null);
  }, [setTitle, title]);
}
