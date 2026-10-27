import type { CSSProperties } from "react";

export interface ScaleBand {
  key: string;
  label: string;
}

/**
 * A figure on a scale of named bands: the boundaries in figures above, the
 * bands as equal segments, the marker where the figure is, and the bands'
 * names under it. The band the figure is in is the one drawn solid and the one
 * name in its colour; the colours are the scale's own (`data-scale` in
 * overview.css), keyed by each band's `key`.
 */
export function BandScale({
  scale,
  bands,
  ticks,
  marker,
  current,
  label
}: {
  scale: string;
  bands: readonly ScaleBand[];
  /** Each boundary's figure, as it should be written above the bar. */
  ticks: readonly string[];
  /** 0–1 along the bar; undefined draws no marker. */
  marker: number | undefined;
  /** The band the figure is in. */
  current: string | undefined;
  label: string;
}) {
  const columns = { "--scale-bands": bands.length } as CSSProperties;
  return (
    <div className="overview-scale" data-scale={scale} role="img" aria-label={label} style={columns}>
      <div className="overview-scale-ticks" aria-hidden="true">
        {ticks.map((tick, index) => (
          <span key={tick} style={{ left: `${((index + 1) / bands.length) * 100}%` }}>
            {tick}
          </span>
        ))}
      </div>
      <div className="overview-scale-bar" aria-hidden="true">
        {bands.map((band) => (
          <i
            key={band.key}
            data-band={band.key}
            className={band.key === current ? "is-current" : undefined}
          />
        ))}
        {marker !== undefined ? (
          <b style={{ left: `${Math.min(1, Math.max(0, marker)) * 100}%` }} />
        ) : null}
      </div>
      <div className="overview-scale-names" aria-hidden="true">
        {bands.map((band) => (
          <span
            key={band.key}
            data-band={band.key}
            className={band.key === current ? "is-current" : undefined}
          >
            {band.label}
          </span>
        ))}
      </div>
    </div>
  );
}
