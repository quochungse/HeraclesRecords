import type { ReactNode } from "react";
import type { TrainingHubActivityZoneBucket } from "../../../electron/types";
import { formatDurationSpan } from "../formatters";
import { zoneLabel, zoneNumber } from "./routeColoring";
import { t } from "../../i18n/core";

interface ActivityZoneBarProps {
  zones: readonly TrainingHubActivityZoneBucket[];
  /** Said at the end of the heading's line: what the zones were read as. */
  aside?: ReactNode;
}

/**
 * COROS's own zone number (`zoneNumber`), as the route map numbers it. What
 * each zone is called depends on the account's model (Max HR names them
 * differently from the other two), which this bar is not told, so it states
 * the number and the bounds and nothing it would have to guess.
 */
function zoneCaption(index: number): string {
  return t("overview.zones.zone", { n: zoneNumber(index) });
}

function bounds(zone: TrainingHubActivityZoneBucket): string | undefined {
  // Index 0 is Zone 1: it repeats zone 2's bounds rather than carrying its
  // own, so only the ceiling means anything there.
  if (zone.index === 0) {
    return zone.high === undefined ? undefined : `under ${Math.round(zone.high)} bpm`;
  }

  if (zone.low === undefined || zone.high === undefined) {
    return undefined;
  }

  return `${Math.round(zone.low)}–${Math.round(zone.high)} bpm`;
}

/**
 * Where this session's heart rate actually sat, as COROS scored it.
 *
 * It comes on the detail payload as `hrZones` and the pane used to drop it,
 * which left the eight summary chips saying an average and a maximum and
 * nothing at all about the shape in between — the difference between an hour
 * held in zone 2 and an hour that averaged into it.
 *
 * Each zone's name and time sit under its own band, as wide as it is, so the
 * bar and its legend are read as one thing; the share and the bounds are on
 * the entry's tooltip. A sliver too narrow for its label is cut, not moved —
 * the list is still whole for a screen reader.
 */
export function ActivityZoneBar({ zones, aside }: ActivityZoneBarProps) {
  const scored = zones.filter((zone) => (zone.seconds ?? 0) > 0);
  const total = scored.reduce((sum, zone) => sum + (zone.seconds ?? 0), 0);

  if (total <= 0) {
    return null;
  }

  const ordered = scored.sort((a, b) => a.index - b.index);

  return (
    <section className="activity-zones">
      <div className="activity-zones-head">
        <h3>{t("activity.zones.timeIn")}</h3>
        {aside}
      </div>
      <div className="activity-zones-bar" aria-hidden="true">
        {ordered.map((zone) => (
          <i
            key={zone.index}
            data-zone={Math.min(6, Math.max(0, zone.index))}
            style={{ flexGrow: (zone.seconds ?? 0) / total }}
            title={`${zoneCaption(zone.index)} — ${formatDurationSpan(zone.seconds)}`}
          />
        ))}
      </div>
      <ul className="activity-zones-legend">
        {ordered.map((zone) => {
          const seconds = zone.seconds ?? 0;
          const span = bounds(zone);
          return (
            <li
              key={zone.index}
              style={{ flexGrow: seconds / total }}
              title={[
                zoneCaption(zone.index),
                `${Math.round((seconds / total) * 100)}%`,
                span
              ]
                .filter(Boolean)
                .join(" — ")}
            >
              <span className="activity-zones-name">
                {zoneLabel(zone.index)}
              </span>
              <strong>{formatDurationSpan(seconds)}</strong>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
