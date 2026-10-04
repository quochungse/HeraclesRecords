import { Layers, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { BASE_LAYERS, BASE_LAYER_ORDER, type BaseLayerId } from "./constants";

import { t } from "../i18n/core";
/**
 * A choice a map adds to its layer menu below the base maps — how a route is
 * coloured, say. The menu is where everything about how the map is drawn
 * lives, so a map does not grow a second picker of its own.
 */
export interface MapLayerSection<T extends string> {
  title: string;
  value: T;
  options: { value: T; label: string; description: string; disabled?: boolean }[];
  onChange: (value: T) => void;
}

/**
 * Whether a layer menu is open inside `root`. A dialog that closes on Escape
 * from the window asks this first and lets that Escape through to the menu,
 * which is what should close: one key closes one thing. (The dialog's
 * listener is the older of the two on the window, so it hears the key first.)
 */
export function hasOpenLayerMenu(root: ParentNode): boolean {
  return root.querySelector(".basemap-control.is-open") !== null;
}

/**
 * Floating layer switcher (top-right of the map): the base map, then the map's
 * own choices. A map drawn on the theme's own base map offers no base map to
 * pick, and leaves `value` and `onChange` out: its menu is `section` alone.
 */
export function MapLayerControl<T extends string = never>({
  value,
  onChange,
  section
}: { section?: MapLayerSection<T> } & (
  | { value: BaseLayerId; onChange: (layer: BaseLayerId) => void }
  | { value?: undefined; onChange?: undefined }
)) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const refocusRef = useRef(false);

  // Escape closes the menu and hands focus back to its button; a press
  // anywhere else closes it too. Escape is caught on the window, on the way
  // down, and stopped there: the screen under a map answers Escape from its
  // own capturing listener on `document` — the Calendar's day panel closes on
  // it — and a listener on the same node would hear the key whatever this one
  // did. A dialog above the map that also listens on the window asks
  // `hasOpenLayerMenu` and lets the key through.
  useEffect(() => {
    if (!open) {
      if (refocusRef.current) {
        refocusRef.current = false;
        toggleRef.current?.focus();
      }
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      refocusRef.current = true;
      setOpen(false);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={`basemap-control${open ? " is-open" : ""}`}>
      {open ? (
        <div className="basemap-menu">
          <div className="basemap-head">
            <span>{onChange ? t("app.map.baseMap") : section?.title}</span>
            <button
              type="button"
              className="icon-button"
              onClick={() => setOpen(false)}
              aria-label={t("common.close")}
            >
              <X size={15} aria-hidden="true" />
            </button>
          </div>
          {onChange ? BASE_LAYER_ORDER.map((id) => {
            const config = BASE_LAYERS[id];
            return (
              <button
                key={id}
                type="button"
                className={`basemap-option${id === value ? " is-active" : ""}`}
                aria-pressed={id === value}
                onClick={() => {
                  onChange(id);
                  setOpen(false);
                }}
              >
                <strong>{config.label}</strong>
                <em>{config.description}</em>
              </button>
            );
          }) : null}
          {section ? (
            <>
              {onChange ? (
                <>
                  <div className="basemap-divider" />
                  <div className="basemap-head">
                    <span>{section.title}</span>
                  </div>
                </>
              ) : null}
              {section.options.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`basemap-option${option.value === section.value ? " is-active" : ""}`}
                  aria-pressed={option.value === section.value}
                  disabled={option.disabled}
                  onClick={() => {
                    section.onChange(option.value);
                    setOpen(false);
                  }}
                >
                  <strong>{option.label}</strong>
                  <em>{option.description}</em>
                </button>
              ))}
            </>
          ) : null}
        </div>
      ) : (
        <button
          ref={toggleRef}
          type="button"
          className="basemap-toggle"
          onClick={() => setOpen(true)}
          title={t("app.map.changeLayers")}
          aria-label={t("app.map.changeLayers")}
        >
          <Layers size={18} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
