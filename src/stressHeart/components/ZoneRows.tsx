import type { CSSProperties } from "react";
import { formatDurationSpan } from "../../training/formatters";
import { zoneColor, zoneLabel } from "../../training/components/routeColoring";

export interface ZoneRowItem {
  /** 0 is the easiest zone; it picks the colour. */
  position: number;
  name: string;
  /** The zone's bounds in bpm, as words. */
  range?: string;
  seconds: number;
  /** 0–1. */
  share: number;
}

/** A 0–1 share as "42%". */
export function sharePercent(share: number): string {
  return `${Math.round(share * 100)}%`;
}

/** Time in each heart-rate zone, a row a zone, in the zone colours the app uses everywhere. */
export function ZoneRows({ rows, label, compact = false }: { rows: ZoneRowItem[]; label: string; compact?: boolean }) {
  return (
    <ul className={`heart-zones${compact ? " is-compact" : ""}`} aria-label={label}>
      {rows.map((row) => (
        <li key={row.position}>
          <span className="heart-zone-number">{zoneLabel(row.position)}</span>
          <span className="heart-zone-name">
            {row.name}
            {row.range ? <span>{row.range}</span> : null}
          </span>
          <i
            aria-hidden="true"
            style={{ "--zone-fill": `${row.share * 100}%`, "--zone-colour": zoneColor(row.position) } as CSSProperties}
          />
          <span className="heart-zone-time">{formatDurationSpan(row.seconds)}</span>
          <span className="heart-zone-share">{sharePercent(row.share)}</span>
        </li>
      ))}
    </ul>
  );
}
