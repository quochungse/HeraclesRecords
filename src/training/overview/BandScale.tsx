import type { CSSProperties } from "react";

export interface ScaleBand {
  key: string;
  label: string;
  /** The band's figures, "50–79%", shown while the band is pointed at. */
  range: string;
}

/**
 * A figure on a scale of named bands: what the figure is and its value on a
 * line of their own — the way the night's score is headed beside it — what it
 * means on hover, then the bands' names over equal segments and the marker
 * where the figure is. The band the figure is in is the one drawn solid and
 * the one name in its colour, keyed by each band's `key` (`data-band` in
 * overview.css). The boundaries' figures are not written out: a band states
 * its own range on hover.
 */
export function BandScale({
  title,
  value,
  explain,
  bands,
  marker,
  current,
  label
}: {
  /** What the figure is: "Intensity trend". */
  title: string;
  /** The figure: "109%". */
  value?: string;
  /** What it is worked out from, shown while the title is pointed at. */
  explain: string;
  bands: readonly ScaleBand[];
  /** 0–1 along the bar; undefined draws no marker. */
  marker: number | undefined;
  /** The band the figure is in. */
  current: string | undefined;
  label: string;
}) {
  const columns = { "--scale-bands": bands.length } as CSSProperties;
  return (
    <div className="overview-scale" role="img" aria-label={`${label}. ${explain}`} style={columns}>
      <p className="overview-scale-head">
        <span className="overview-scale-title">{title}</span>
        {value ? <span className="overview-scale-value figure">{value}</span> : null}
        <span className="overview-scale-explain">{explain}</span>
      </p>
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
