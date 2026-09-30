import { useMemo } from "react";
import type {
  CorosProfileZone,
  TrainingHubActivityDynamics,
  TrainingHubActivitySeriesPoint
} from "../../electron/types";
import { formatDurationSeconds, formatDurationSpan } from "../training/formatters";
import { zoneColor } from "../training/components/routeColoring";
import {
  powerSeconds,
  powerZoneBounds,
  powerZoneTime,
  rideLoadFromPower,
  ridePower,
  type PowerZoneBound
} from "./rideAnalysis";
import { StatGrid, type Stat } from "./StatGrid";

interface RidePowerPanelProps {
  /** The ride's samples on activity time. */
  series: readonly TrainingHubActivitySeriesPoint[];
  /** COROS's own averages, which the watch showed: they win over a recount. */
  dynamics?: TrainingHubActivityDynamics;
  /** FTP on the COROS profile, watts. */
  ftp?: number;
  /** The account's cycling power zones, as COROS states them. */
  powerZones?: readonly CorosProfileZone[];
}

function zoneRange(bound: PowerZoneBound): string {
  if (bound.floor === undefined && bound.ceiling !== undefined) {
    return `≤ ${bound.ceiling} W`;
  }
  if (bound.ceiling === undefined && bound.floor !== undefined) {
    return `≥ ${bound.floor} W`;
  }
  return `${bound.floor}–${bound.ceiling} W`;
}

/**
 * What the pedals said, where a meter was fitted — the half of a ride a run has
 * no equivalent for.
 *
 * The average is what a meter measures; normalised power is what the ride
 * cost, so a group ride of surges and freewheeling reads harder than its
 * average and the variability index says by how much. IF and TSS put it
 * against the rider's FTP. The peak row is the ride's best 5 seconds to hour,
 * and the zones are COROS's own power bands, over the time spent pedalling.
 *
 * Without power it falls back to cadence alone, which a speed-and-cadence
 * sensor still records; without either it draws nothing.
 */
export function RidePowerPanel({ series, dynamics, ftp, powerZones }: RidePowerPanelProps) {
  const watts = useMemo(() => powerSeconds(series), [series]);
  const power = useMemo(() => ridePower(watts), [watts]);
  const load = useMemo(() => (power ? rideLoadFromPower(power, ftp) : undefined), [ftp, power]);
  const zones = useMemo(() => {
    const bounds = power ? powerZoneBounds(powerZones, ftp) : undefined;
    return bounds ? powerZoneTime(watts, bounds) : [];
  }, [ftp, power, powerZones, watts]);

  const cadence: Stat[] = [];
  if (dynamics?.avgCadence !== undefined) {
    cadence.push({
      label: "Cadence",
      value: `${Math.round(dynamics.avgCadence)} rpm`,
      title: "Averaged over the time the pedals were turning"
    });
  }
  if (dynamics?.maxCadence !== undefined) {
    cadence.push({ label: "Max cadence", value: `${Math.round(dynamics.maxCadence)} rpm` });
  }

  if (!power) {
    return cadence.length > 0 ? (
      <section className="panel run-detail-panel">
        <p className="running-eyebrow">Cadence</p>
        <StatGrid stats={cadence} />
      </section>
    ) : null;
  }

  const average = dynamics?.avgPower ?? power.average;
  const stats: Stat[] = [
    { label: "Avg power", value: `${Math.round(average)} W` },
    ...(power.normalized !== undefined
      ? [
          {
            label: "Normalized",
            value: `${Math.round(power.normalized)} W`,
            title: "Normalized power: what the ride cost, surges and freewheeling weighed in"
          }
        ]
      : []),
    { label: "Max power", value: `${Math.round(dynamics?.maxPower ?? power.max)} W` },
    ...(load
      ? [
          {
            label: "Intensity",
            value: load.intensity.toFixed(2),
            title: "Intensity factor: normalized power over FTP. 1.00 is an hour's all-out effort"
          },
          {
            label: "TSS",
            value: `${Math.round(load.stressScore)}`,
            title: "Training stress score from power: an hour at FTP is 100"
          }
        ]
      : []),
    ...(power.normalized !== undefined && average > 0
      ? [
          {
            label: "Variability",
            value: (power.normalized / average).toFixed(2),
            title: "Normalized over average power. Near 1.00 is a steady effort; group rides and crits run higher"
          }
        ]
      : []),
    {
      label: "Work",
      value: `${Math.round(power.workKj).toLocaleString()} kJ`,
      title: "Energy delivered to the pedals — close to the calories the ride burned"
    },
    ...cadence
  ];

  const pedalling = zones.reduce((sum, zone) => sum + zone.seconds, 0);

  return (
    <section className="panel run-detail-panel ride-power-panel">
      <p className="running-eyebrow">Power</p>
      <StatGrid stats={stats} />

      {power.peaks.length > 0 ? (
        <div className="ride-power-section">
          <p className="run-intensity-title">Peak power</p>
          <StatGrid
            stats={power.peaks.map((peak) => ({
              label: peak.label,
              value: `${Math.round(peak.watts)} W`,
              title: `Best ${peak.label} average on this ride`
            }))}
          />
        </div>
      ) : null}

      {pedalling > 0 ? (
        <div className="ride-power-section">
          <p className="run-intensity-title">Time in power zones</p>
          <div className="run-surface-bar" aria-hidden="true">
            {zones.map((zone, index) =>
              zone.seconds > 0 ? (
                <div
                  key={zone.label}
                  style={{ flexGrow: zone.seconds / pedalling, background: zoneColor(index) }}
                  title={`${zone.label} ${zone.name}: ${formatDurationSpan(zone.seconds)}`}
                />
              ) : null
            )}
          </div>
          <div className="run-table-scroll">
            <table className="run-list run-surface-table ride-zone-table">
              <thead>
                <tr>
                  <th scope="col">Zone</th>
                  <th scope="col" className="is-numeric">Watts</th>
                  <th scope="col" className="is-numeric">Time</th>
                  <th scope="col" className="is-numeric">Share</th>
                </tr>
              </thead>
              <tbody>
                {zones.map((zone, index) => (
                  <tr key={zone.label}>
                    <td>
                      <span className="run-surface-swatch" style={{ background: zoneColor(index) }} />
                      {zone.label} · {zone.name}
                    </td>
                    <td className="is-numeric">{zoneRange(zone)}</td>
                    <td className="is-numeric">
                      {zone.seconds > 0 ? formatDurationSeconds(zone.seconds) : "—"}
                    </td>
                    <td className="is-numeric">{Math.round((zone.seconds / pedalling) * 100)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <p className="run-block-note">
        {ftp !== undefined
          ? `Intensity and TSS are against your FTP of ${Math.round(ftp)} W as COROS has it today, not as it was on the day. `
          : "No FTP on your COROS profile, so there is no intensity or TSS. "}
        {power.coastingSeconds > 0
          ? `${formatDurationSpan(power.coastingSeconds)} coasting at 0 W ${
              pedalling > 0 ? "is left out of the zones but" : "is"
            } counted in the average.`
          : ""}
      </p>
    </section>
  );
}
