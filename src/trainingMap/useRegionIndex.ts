import { useEffect, useState } from "react";
import { loadedRegionIndex, loadRegionIndex, type RegionIndex } from "./adminRegions";

/**
 * The region index (`adminRegions.ts`), or `null` while it is first read.
 * Read once per window: a screen mounted after that has it in its first render
 * rather than one frame later, so it does not flash its loading state.
 */
export function useRegionIndex(): RegionIndex | null {
  const [index, setIndex] = useState<RegionIndex | null>(() => loadedRegionIndex() ?? null);
  useEffect(() => {
    if (index) return;
    let cancelled = false;
    void loadRegionIndex().then((loaded) => {
      if (!cancelled) setIndex(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [index]);
  return index;
}
