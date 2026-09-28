import type { TrainingHubActivityZoneBucket } from "../../../electron/types";
import { formatDurationSpan } from "../formatters";

interface ActivityZoneBarProps {
  zones: readonly TrainingHubActivityZoneBucket[];
}

/**
 * COROS's zone for a bucket: bucket n is zone n + 1. Bucket 0 — "under 134 bpm"
 * — is the band COROS draws as zone 1, Recovery, not something below the zones;
 * this bar used to call it "Below Z1" and number the rest one short, so its Z1
 * was COROS's Z2 and the map's Z2.
 */
function zoneNumber(index: number): number {
  return Math.min(6, Math.max(1, index + 1));
}

function zoneCaption(zone: number): string {
  switch (zone) {
    case 1:
      return "Recovery & warm-up";
    case 2:
      return "Aerobic base";
    case 3:
      return "Steady aerobic";
    case 4:
      return "Threshold";
    case 5:
      return "VO2max";
    case 6:
      return "Anaerobic";
    default:
      return "Zone";
  }
}

function bounds(zone: TrainingHubActivityZoneBucket): string | undefined {
  // Bucket 0, zone 1, repeats the next zone's scopes rather than carrying its
  // own, so only its ceiling means anything; the top bucket's ceiling is a
  // sentinel (401 bpm), so only its floor does.
  if (zone.index === 0) {
    return zone.high === undefined ? undefined : `under ${Math.round(zone.high)} bpm`;
  }
  if (zoneNumber(zone.index) === 6) {
    return zone.low === undefined ? undefined : `over ${Math.round(zone.low)} bpm`;
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
            data-zone={zoneNumber(zone.index)}
            style={{ flexGrow: (zone.seconds ?? 0) / total }}
            title={`${zoneCaption(zoneNumber(zone.index))} — ${formatDurationSpan(zone.seconds)}`}
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
              title={[zoneCaption(zoneNumber(zone.index)), span].filter(Boolean).join(" — ")}
            >
              <i data-zone={zoneNumber(zone.index)} aria-hidden="true" />
              <span className="activity-zones-name">{`Z${zoneNumber(zone.index)}`}</span>
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
