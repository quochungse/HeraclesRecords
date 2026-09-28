import { useCallback } from "react";
import {
  defineSelectionPreference,
  selectionIsOneOf,
  useSelectionPreference,
  type SelectionPreference
} from "../preferences/selectionPreferences";
import { useTheme } from "../theme/ThemeProvider";
import { BASE_LAYER_ORDER, type BaseLayerId } from "./constants";

/** The theme-matched style: a light map on the light theme, dark on dark. */
export function themeBaseLayer(theme: string): BaseLayerId {
  return theme === "paper" ? "light" : "dark";
}

/**
 * What is stored: a style picked on purpose, or `"theme"` — the map that goes
 * with whichever theme is on. Picking the theme's own map stores `"theme"`
 * rather than its id, so a light map picked on the light theme turns dark with
 * the theme, while a map picked against the theme (Satellite, or Dark on the
 * light theme) stays put through every switch.
 */
type StoredBaseLayer = BaseLayerId | "theme";

/** A remembered base map choice for one kind of map. */
export function defineBaseLayerPreference(
  key: string
): SelectionPreference<StoredBaseLayer> {
  return defineSelectionPreference<StoredBaseLayer>({
    key,
    defaultValue: "theme",
    validate: selectionIsOneOf([...BASE_LAYER_ORDER, "theme"] as const)
  });
}

/**
 * The base map to draw and the setter the layer picker calls. The choice is
 * saved and restored on the next mount; the theme is read live, so a map
 * following it repaints the moment the theme changes.
 */
export function useBaseLayerPreference(
  preference: SelectionPreference<StoredBaseLayer>
): [BaseLayerId, (layer: BaseLayerId) => void] {
  const { theme } = useTheme();
  const [stored, setStored] = useSelectionPreference(preference);

  const choose = useCallback(
    (layer: BaseLayerId) =>
      setStored(layer === themeBaseLayer(theme) ? "theme" : layer),
    [setStored, theme]
  );

  return [stored === "theme" ? themeBaseLayer(theme) : stored, choose];
}
