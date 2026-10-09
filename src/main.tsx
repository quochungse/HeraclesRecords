import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ThemeProvider } from "./theme/ThemeProvider";
import { applyTheme, readStoredTheme } from "./theme/theme";
import { applySportColors, readStoredSportColors } from "./training/sportColors";
import { installRendererDiagnostics } from "./diagnostics";
import { initLocale } from "./i18n/core";
import "./i18n/screenTextHooks";
import { UnitSystemProvider } from "./units/UnitSystemProvider";
import "./styles.css";
// In the main bundle, after the base sheet, because the library's skeleton is
// App's Suspense fallback and is drawn before the library's chunk has loaded.
import "./training-library/trainingLibrary.css";

// Uncaught errors go to the error log (Settings → Report an issue); installed before React renders.
installRendererDiagnostics(window.heraclesRecords);

// Apply the persisted theme before the first paint to avoid a dark→light flash.
applyTheme(readStoredTheme());
// Apply persisted per-sport colors so the heatmap tints correctly on first paint.
applySportColors(readStoredSportColors());

// The stored language is loaded before anything is drawn, so a launch in
// Vietnamese never shows a frame of English. English is in the bundle; any other
// language is one local chunk, and initLocale falls back to English rather than
// leaving the window empty if that chunk will not load.
void initLocale().then(() => {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <ThemeProvider>
        <UnitSystemProvider>
          <App />
        </UnitSystemProvider>
      </ThemeProvider>
    </React.StrictMode>
  );
});
