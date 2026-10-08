import { zoneName } from "../i18n/zoneNames";
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

import { formatCount, formatDecimal, t } from "../i18n/core";
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
/** A peak's window, "5 s" or "20 min", in the language on screen. */
function peakWindowLabel(seconds: number): string {
  return seconds < 60 ? `${seconds} s` : t("units.min", { m: Math.round(seconds / 60) });
}

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
      label: t("activity.m.cadence"),
      value: `${Math.round(dynamics.avgCadence)} rpm`,
      title: t("ride.power.cadenceTitle")
    });
  }
  if (dynamics?.maxCadence !== undefined) {
    cadence.push({ label: t("ride.power.maxCadence"), value: `${Math.round(dynamics.maxCadence)} rpm` });
  }

  if (!power) {
    return cadence.length > 0 ? (
      <section className="panel run-detail-panel">
        <p className="running-eyebrow">{t("activity.m.cadence")}</p>
        <StatGrid stats={cadence} />
      </section>
    ) : null;
  }

  const average = dynamics?.avgPower ?? power.average;
  const stats: Stat[] = [
    { label: t("activity.m.avgPower"), value: `${Math.round(average)} W` },
    ...(power.normalized !== undefined
      ? [
          {
            label: t("ride.power.normalized"),
            value: `${Math.round(power.normalized)} W`,
            title: t("ride.power.normalizedTitle")
          }
        ]
      : []),
    { label: t("ride.power.max"), value: `${Math.round(dynamics?.maxPower ?? power.max)} W` },
    ...(load
      ? [
          {
            label: t("ride.power.intensity"),
            value: formatDecimal(load.intensity, 2),
            title: t("ride.power.intensityTitle")
          },
          {
            label: t("ride.power.tss"),
            value: `${Math.round(load.stressScore)}`,
            title: t("ride.power.tssTitle")
          }
        ]
      : []),
    ...(power.normalized !== undefined && average > 0
      ? [
          {
            label: t("ride.power.variability"),
            value: formatDecimal(power.normalized / average, 2),
            title: t("ride.power.variabilityTitle")
          }
        ]
      : []),
    {
      label: t("ride.power.work"),
      value: `${formatCount(Math.round(power.workKj))} kJ`,
      title: t("ride.power.workTitle")
    },
    ...cadence
  ];

  const pedalling = zones.reduce((sum, zone) => sum + zone.seconds, 0);

  return (
    <section className="panel run-detail-panel ride-power-panel">
      <p className="running-eyebrow">{t("activity.m.power")}</p>
      <StatGrid stats={stats} />

      {power.peaks.length > 0 ? (
        <div className="ride-power-section">
          <p className="run-intensity-title">{t("ride.power.peak")}</p>
          <StatGrid
            stats={power.peaks.map((peak) => ({
              label: peakWindowLabel(peak.seconds),
              value: `${Math.round(peak.watts)} W`,
              title: t("ride.power.peakTitle", { window: peakWindowLabel(peak.seconds) })
            }))}
          />
        </div>
      ) : null}

      {pedalling > 0 ? (
        <div className="ride-power-section">
          <p className="run-intensity-title">{t("ride.power.zonesTitle")}</p>
          <div className="run-surface-bar" aria-hidden="true">
            {zones.map((zone, index) =>
              zone.seconds > 0 ? (
                <div
                  key={zone.label}
                  style={{ flexGrow: zone.seconds / pedalling, background: zoneColor(index) }}
                  title={`${zone.label} ${zoneName(zone.name)}: ${formatDurationSpan(zone.seconds)}`}
                />
              ) : null
            )}
          </div>
          <div className="run-table-scroll">
            <table className="run-list run-surface-table ride-zone-table">
              <thead>
                <tr>
                  <th scope="col">{t("ride.power.zone")}</th>
                  <th scope="col" className="is-numeric">{t("ride.power.watts")}</th>
                  <th scope="col" className="is-numeric">{t("activity.m.time")}</th>
                  <th scope="col" className="is-numeric">{t("run.share")}</th>
                </tr>
              </thead>
              <tbody>
                {zones.map((zone, index) => (
                  <tr key={zone.label}>
                    <td>
                      <span className="run-surface-swatch" style={{ background: zoneColor(index) }} />
                      {zone.label} · {zoneName(zone.name)}
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
          ? t("ride.power.ftpNote", { ftp: Math.round(ftp) })
          : t("ride.power.noFtpNote")}
        {power.coastingSeconds > 0
          ? t(pedalling > 0 ? "ride.power.coastingZones" : "ride.power.coasting", {
              time: formatDurationSpan(power.coastingSeconds)
            })
          : ""}
      </p>
    </section>
  );
}
