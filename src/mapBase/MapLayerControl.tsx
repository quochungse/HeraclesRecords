import { Layers, X } from "lucide-react";
import { useState } from "react";
import { BASE_LAYERS, BASE_LAYER_ORDER, type BaseLayerId } from "./constants";

/** Floating base-map switcher (top-right of the map). */
export function MapLayerControl({
  value,
  onChange
}: {
  value: BaseLayerId;
  onChange: (layer: BaseLayerId) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`basemap-control${open ? " is-open" : ""}`}>
      {open ? (
        <div className="basemap-menu">
          <div className="basemap-head">
            <span>Base map</span>
            <button
              type="button"
              className="icon-button"
              onClick={() => setOpen(false)}
              aria-label="Close"
            >
              <X size={15} aria-hidden="true" />
            </button>
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
        </div>
      ) : (
        <button
          type="button"
          className="basemap-toggle"
          onClick={() => setOpen(true)}
          title="Change base map"
          aria-label="Change base map"
        >
          <Layers size={18} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
