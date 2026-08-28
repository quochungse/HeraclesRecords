/**
 * Accent palettes. The palette only swaps the `--accent*` custom properties in
 * styles.css (see "Accent palettes"); it is orthogonal to `Theme`, which picks
 * the dark or paper background. Both are chosen in Settings -> Appearance.
 */
export type AccentPalette = "gold" | "teal" | "indigo" | "rose" | "sky";

export const ACCENT_STORAGE_KEY = "coroslink.accentPalette";

const DEFAULT_ACCENT: AccentPalette = "gold";

/** Accent values per theme, for the canvas/WebGL surfaces that cannot read CSS
 *  custom properties (the activity globe, Recharts series). Keep in step with
 *  the "Accent palettes" block in styles.css. */
export interface AccentPaletteColors {
  accent: string;
  strong: string;
}

export interface AccentPaletteDetail {
  label: string;
  description: string;
  /** Swatch stops, dark theme. Mirrors --accent / --accent-2 for that palette. */
  swatch: [string, string];
  dark: AccentPaletteColors;
  paper: AccentPaletteColors;
}

export const ACCENT_PALETTES: AccentPalette[] = [
  "gold",
  "teal",
  "indigo",
  "rose",
  "sky"
];

export const ACCENT_PALETTE_DETAILS: Record<AccentPalette, AccentPaletteDetail> =
  {
    gold: {
      label: "Heracles Gold",
      description: "Default. Taken from the app icon.",
      swatch: ["#e7b04c", "#c78f38"],
      dark: { accent: "#e7b04c", strong: "#f3bf5c" },
      paper: { accent: "#9a6414", strong: "#7a4f0f" }
    },
    teal: {
      label: "Original Teal",
      description: "The palette the app shipped with.",
      swatch: ["#2fbe91", "#1fb6a6"],
      dark: { accent: "#2fbe91", strong: "#4fd6a6" },
      paper: { accent: "#12946e", strong: "#0f7f5f" }
    },
    indigo: {
      label: "Indigo",
      description: "Cool and low-glare for long sessions.",
      swatch: ["#818cf8", "#6470e2"],
      dark: { accent: "#818cf8", strong: "#96a0fa" },
      paper: { accent: "#5763d3", strong: "#49539f" }
    },
    rose: {
      label: "Rose",
      description: "Warm contrast against the dark shell.",
      swatch: ["#fb7185", "#e2596f"],
      dark: { accent: "#fb7185", strong: "#fc8b9b" },
      paper: { accent: "#c63a4e", strong: "#a02f40" }
    },
    sky: {
      label: "Sky",
      description: "Bright blue, highest legibility on paper.",
      swatch: ["#38bdf8", "#22a3e0"],
      dark: { accent: "#38bdf8", strong: "#5ecbfa" },
      paper: { accent: "#0076aa", strong: "#005c82" }
    }
  };

function isAccentPalette(value: unknown): value is AccentPalette {
  return ACCENT_PALETTES.includes(value as AccentPalette);
}

export function readStoredAccentPalette(): AccentPalette {
  try {
    const stored = window.localStorage.getItem(ACCENT_STORAGE_KEY);
    if (isAccentPalette(stored)) {
      return stored;
    }
  } catch {
    // localStorage may be unavailable; fall through to the default.
  }
  return DEFAULT_ACCENT;
}

export function storeAccentPalette(palette: AccentPalette): void {
  try {
    window.localStorage.setItem(ACCENT_STORAGE_KEY, palette);
  } catch {
    // Ignore persistence failures.
  }
}

/**
 * Reflect the palette onto the document root. Gold is the implicit default —
 * its CSS block also matches a bare `:root` — so the attribute is cleared for
 * it rather than written out.
 */
export function applyAccentPalette(palette: AccentPalette): void {
  const root = document.documentElement;
  if (palette === DEFAULT_ACCENT) {
    delete root.dataset.accent;
  } else {
    root.dataset.accent = palette;
  }
}
