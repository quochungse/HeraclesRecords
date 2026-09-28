import { Info } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

/**
 * How long the tile credit stays spelled out before folding into its (i)
 * button. The OSM Foundation's attribution guidelines allow a credit to
 * collapse after five seconds provided it can still be found from an (i) in
 * the corner — which is what this does. It cannot be left out altogether:
 * OpenStreetMap, OpenMapTiles and OpenFreeMap all require it.
 */
const CREDIT_VISIBLE_MS = 5000;

/**
 * When the credit folds for the whole session. The five seconds are counted
 * once, from the first map the app draws — not per map — so a map opened later
 * starts folded rather than spelling the credit out again, and maps on screen
 * together in those first seconds fold at the same moment.
 */
let creditFoldsAt: number | undefined;

function creditStillShowing(): boolean {
  creditFoldsAt ??= Date.now() + CREDIT_VISIBLE_MS;
  return Date.now() < creditFoldsAt;
}

/**
 * Whether the credit is spelled out, and the (i)'s toggle. The caller puts
 * `is-credit-open` on the map's `.map-frame` while it is; the frame's CSS folds
 * Leaflet's attribution bar the rest of the time.
 */
export function useFoldingCredit(): [boolean, () => void] {
  const [open, setOpen] = useState(creditStillShowing);

  useEffect(() => {
    if (creditFoldsAt === undefined || Date.now() >= creditFoldsAt) {
      return;
    }
    const timer = window.setTimeout(
      () => setOpen(false),
      creditFoldsAt - Date.now()
    );
    return () => window.clearTimeout(timer);
  }, []);

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
      aria-label="Map data credits"
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
