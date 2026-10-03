import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ThemeProvider } from "./theme/ThemeProvider";
import { applyTheme, readStoredTheme } from "./theme/theme";
import { applySportColors, readStoredSportColors } from "./training/sportColors";
import { installRendererDiagnostics } from "./diagnostics";
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

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <UnitSystemProvider>
        <App />
      </UnitSystemProvider>
    </ThemeProvider>
  </React.StrictMode>
);
