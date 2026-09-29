import type { TrainingHubActivityZoneBucket } from "../../../electron/types";
import { formatDurationSpan } from "../formatters";

interface ActivityZoneBarProps {
  zones: readonly TrainingHubActivityZoneBucket[];
}

/**
 * COROS's own zone number: bucket 0 is Zone 1, the one under the first bound.
 * What each zone is called depends on the account's model (Max HR names them
 * differently from the other two), which this bar is not told, so it states
 * the number and the bounds and nothing it would have to guess.
 */
function zoneCaption(index: number): string {
  return `Zone ${index + 1}`;
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
 */
export function ActivityZoneBar({ zones }: ActivityZoneBarProps) {
  const scored = zones.filter((zone) => (zone.seconds ?? 0) > 0);
  const total = scored.reduce((sum, zone) => sum + (zone.seconds ?? 0), 0);

  if (total <= 0) {
    return null;
  }

  const ordered = scored.sort((a, b) => a.index - b.index);

  return (
    <section className="activity-zones">
      <h3>Time in heart rate zones</h3>
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
              title={[zoneCaption(zone.index), span].filter(Boolean).join(" — ")}
            >
              <i data-zone={Math.min(6, Math.max(0, zone.index))} aria-hidden="true" />
              <span className="activity-zones-name">
                {`Z${zone.index + 1}`}
              </span>
              <strong>{formatDurationSpan(seconds)}</strong>
              <span className="activity-zones-share">
                {Math.round((seconds / total) * 100)}%
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
