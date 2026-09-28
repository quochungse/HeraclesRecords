import { Layers, X } from "lucide-react";
import { useState } from "react";
import { BASE_LAYERS, BASE_LAYER_ORDER, type BaseLayerId } from "./constants";

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

/** Floating layer switcher (top-right of the map): the base map, then the map's own choices. */
export function MapLayerControl<T extends string = never>({
  value,
  onChange,
  section
}: {
  value: BaseLayerId;
  onChange: (layer: BaseLayerId) => void;
  section?: MapLayerSection<T>;
}) {
  const [open, setOpen] = useState(false);
  const close = (
    <button
      type="button"
      className="icon-button"
      onClick={() => setOpen(false)}
      aria-label="Close"
    >
      <X size={15} aria-hidden="true" />
    </button>
  );
  return (
    <div className={`basemap-control${open ? " is-open" : ""}`}>
      {open ? (
        <div className="basemap-menu">
          <div className="basemap-head">
            <span>Base map</span>
            {close}
          </div>
          {BASE_LAYER_ORDER.map((id) => {
            const config = BASE_LAYERS[id];
            return (
              <button
                key={id}
                type="button"
                className={`basemap-option${id === value ? " is-active" : ""}`}
                onClick={() => {
                  onChange(id);
                  setOpen(false);
                }}
              >
                <strong>{config.label}</strong>
                <em>{config.description}</em>
              </button>
            );
          })}
          {section ? (
            <>
              <div className="basemap-divider" />
              <div className="basemap-head">
                <span>{section.title}</span>
              </div>
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
          type="button"
          className="basemap-toggle"
          onClick={() => setOpen(true)}
          title="Change map layers"
          aria-label="Change map layers"
        >
          <Layers size={18} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
