import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";
import { flushSync } from "react-dom";
import {
  applyTheme,
  readStoredTheme,
  runThemeTransition,
  storeTheme,
  type Theme,
  type ThemeOrigin
} from "./theme";
import {
  applyAccentPalette,
  readStoredAccentPalette,
  storeAccentPalette,
  type AccentPalette
} from "./accentPalette";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme, origin?: ThemeOrigin) => void;
  toggleTheme: (origin?: ThemeOrigin) => void;
  accent: AccentPalette;
  setAccent: (accent: AccentPalette, origin?: ThemeOrigin) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => readStoredTheme());
  const [accent, setAccentState] = useState<AccentPalette>(() =>
    readStoredAccentPalette()
  );

  useEffect(() => {
    storeTheme(theme);
  }, [theme]);

  useEffect(() => {
    storeAccentPalette(accent);
  }, [accent]);

  // The palette is written on mount too: index.html ships no attribute, so a
  // stored non-default palette would otherwise only appear after a change.
  useEffect(() => {
    applyAccentPalette(accent);
  }, [accent]);

  const setTheme = useCallback((next: Theme, origin?: ThemeOrigin) => {
    // Commit the state change *and* the DOM attribute inside the view
    // transition callback so the snapshot captures the new theme. flushSync
    // forces React to paint the update synchronously within that callback.
    runThemeTransition(origin, () => {
      flushSync(() => setThemeState(next));
      applyTheme(next);
    });
  }, []);

  const toggleTheme = useCallback(
    (origin?: ThemeOrigin) => {
      setTheme(theme === "dark" ? "paper" : "dark", origin);
    },
    [theme, setTheme]
  );

  const setAccent = useCallback((next: AccentPalette, origin?: ThemeOrigin) => {
    // Same view-transition treatment as the light/dark swap so a palette
    // change wipes in from the control the user clicked.
    runThemeTransition(origin, () => {
      flushSync(() => setAccentState(next));
      applyAccentPalette(next);
    });
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, setTheme, toggleTheme, accent, setAccent }),
    [theme, setTheme, toggleTheme, accent, setAccent]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
