import type { CSSProperties } from "react";

export interface ScaleBand {
  key: string;
  label: string;
  /** The band's figures, "50–79%", shown while the band is pointed at. */
  range: string;
}

/**
 * A figure on a scale of named bands: the bands' names over equal segments,
 * and the marker where the figure is. The band the figure is in is the one
 * drawn solid and the one name in its colour; the colours are the scale's own
 * (`data-scale` in overview.css), keyed by each band's `key`. The boundaries'
 * figures are not written out: a band states its own range on hover.
 */
export function BandScale({
  scale,
  bands,
  marker,
  current,
  label
}: {
  scale: string;
  bands: readonly ScaleBand[];
  /** 0–1 along the bar; undefined draws no marker. */
  marker: number | undefined;
  /** The band the figure is in. */
  current: string | undefined;
  label: string;
}) {
  const columns = { "--scale-bands": bands.length } as CSSProperties;
  return (
    <div className="overview-scale" data-scale={scale} role="img" aria-label={label} style={columns}>
      <div className="overview-scale-bands">
        {bands.map((band) => (
          <span
            key={band.key}
            data-band={band.key}
            className={`overview-scale-band${band.key === current ? " is-current" : ""}`}
          >
            <span className="overview-scale-name">{band.label}</span>
            <i className="overview-scale-segment" />
            <span className="overview-scale-range">{band.range}</span>
          </span>
        ))}
        {marker !== undefined ? (
          <b className="overview-scale-marker" style={{ left: `${Math.min(1, Math.max(0, marker)) * 100}%` }} />
        ) : null}
      </div>
    </div>
  );
}
