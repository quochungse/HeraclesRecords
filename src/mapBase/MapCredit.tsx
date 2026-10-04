import { Info } from "lucide-react";
import { useCallback, useState } from "react";

import { t } from "../i18n/core";
/**
 * Whether the tile credit is spelled out, and the (i)'s toggle. It starts
 * folded into the (i), as other map apps show it: OpenStreetMap, OpenMapTiles
 * and OpenFreeMap all require the credit, and the OSM Foundation's attribution
 * guidelines accept one that can be found from an (i) in the corner. The caller
 * puts `is-credit-open` on the map's `.map-frame` while it is open; the frame's
 * CSS folds Leaflet's attribution bar the rest of the time.
 */
export function useFoldingCredit(): [boolean, () => void] {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((current) => !current), []);
  return [open, toggle];
}

/** The (i) that brings a folded tile credit back. */
export function MapCreditButton({
  open,
  onToggle,
  className
}: {
  open: boolean;
  onToggle: () => void;
  /** Placement for a map that is not a `.map-frame` (the route cover). */
  className?: string;
}) {
  return (
    <button
      type="button"
      className={className ?? "map-credit-toggle"}
      aria-label={t("app.map.credits")}
      aria-expanded={open}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
    >
      <Info size={13} aria-hidden="true" />
    </button>
  );
}
