import { useEffect, useState } from "react";

/**
 * Whether a CSS media query currently matches, kept in step with the window.
 *
 * Lifted out of `AppSidebar`, which had the only copy, when the Activities
 * screen needed the same thing: below a width, its two panes stop being a
 * split and become two screens, and that is a decision about *what to render*
 * rather than about how to style it — CSS alone cannot stop a component
 * mounting.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }

    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    const media = window.matchMedia(query);
    const handleChange = () => setMatches(media.matches);

    // Called once here as well: the query may already have changed between the
    // initial state being computed and this effect running.
    handleChange();
    media.addEventListener("change", handleChange);

    return () => media.removeEventListener("change", handleChange);
  }, [query]);

  return matches;
}
