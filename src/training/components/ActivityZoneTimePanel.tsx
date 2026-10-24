import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type {
  CorosProfileZoneFamily,
  TrainingHubActivityZoneBucket,
  UnitSystem
} from "../../../electron/types";
import { OptionGroup } from "../../components/OptionGroup";
import { zoneName } from "../../i18n/zoneNames";
import { t } from "../../i18n/core";
import { useUnitSystem } from "../../units/UnitSystemProvider";
import { formatDurationSpan, formatPaceSecondsPerKm } from "../formatters";
import {
  heartRateZoneFamily,
  heartRateZoneTime,
  paceZoneTime,
  type ZoneTimeRow
} from "../zoneTime";
import { zoneColor } from "./routeColoring";
import type { TrainingBenefitReading } from "../trainingBenefit";
import { TrainingBenefitReason } from "./TrainingBenefitChip";

type ZoneScale = "hr" | "pace";

interface ActivityZoneTimePanelProps {
  hrZones: readonly TrainingHubActivityZoneBucket[];
  /** COROS's model for this activity's heart-rate zones; 0 or absent falls back to the account's. */
  hrZoneType?: number;
  accountFamily?: CorosProfileZoneFamily;
  /** Offered beside heart rate only when given — a run's. */
  paceZones?: readonly TrainingHubActivityZoneBucket[];
  /** The pace scale is grade-adjusted (a trail run's), and the switch says so. */
  paceIsGradeAdjusted?: boolean;
  /** The session's training label, when it has one: why it was given is written under the zones. */
  benefit?: TrainingBenefitReading;
}

/**
 * Minutes, as elsewhere — but a zone held for under a minute says its seconds:
 * rounded, 25 s at the top of a tempo read "0m" beside the zone nobody reached.
 */
function zoneDuration(seconds: number): string {
  return seconds > 0 && seconds < 60
    ? t("units.duration.s", { s: Math.round(seconds) })
    : formatDurationSpan(seconds);
}

/** A zone's bounds as a reader writes them: bpm low to high, a pace band fast edge first. */
function zoneRange(row: ZoneTimeRow, scale: ZoneScale, unitSystem: UnitSystem): string | undefined {
  const { easyEdge, hardEdge } = row;
  if (scale === "hr") {
    if (easyEdge !== undefined && hardEdge !== undefined) {
      return `${Math.round(easyEdge)}–${Math.round(hardEdge)} bpm`;
    }
    if (hardEdge !== undefined) return `< ${Math.round(hardEdge)} bpm`;
    if (easyEdge !== undefined) return `> ${Math.round(easyEdge)} bpm`;
    return undefined;
  }
  const pace = (value: number) => formatPaceSecondsPerKm(value, unitSystem);
  if (easyEdge !== undefined && hardEdge !== undefined) {
    // The unit once: "5:17–5:52 /km", not "5:17 /km–5:52 /km".
    return `${pace(hardEdge).replace(/\s*\/\w+$/, "")}–${pace(easyEdge)}`;
  }
  if (hardEdge !== undefined) return t("activity.zoneTime.slower", { pace: pace(hardEdge) });
  if (easyEdge !== undefined) return t("activity.zoneTime.faster", { pace: pace(easyEdge) });
  return undefined;
}

function zoneStyle(position: number): CSSProperties {
  return { "--zone-color": zoneColor(position) } as CSSProperties;
}

/**
 * Where a session's effort sat: the time in each zone, on heart rate and — for
 * a run — on pace, one switch apart. Every zone is listed, an empty one at
 * zero, so the session reads against the whole scale rather than against the
 * zones it happened to reach.
 */
export function ActivityZoneTimePanel({
  hrZones,
  hrZoneType,
  accountFamily,
  paceZones,
  paceIsGradeAdjusted = false,
  benefit
}: ActivityZoneTimePanelProps) {
  const { unitSystem } = useUnitSystem();
  const family = heartRateZoneFamily(hrZoneType, accountFamily);
  const hrRows = useMemo(() => heartRateZoneTime(hrZones, family), [hrZones, family]);
  const paceRows = useMemo(() => paceZoneTime(paceZones ?? []), [paceZones]);
  const [picked, setPicked] = useState<ZoneScale>("hr");

  const scale: ZoneScale =
    picked === "pace" && paceRows.length > 0 ? "pace" : hrRows.length > 0 ? "hr" : "pace";
  const rows = scale === "hr" ? hrRows : paceRows;
  if (rows.length === 0) {
    return null;
  }

  const paceLabel = paceIsGradeAdjusted ? t("activity.m.gap") : t("activity.m.pace");
  const options = [
    ...(hrRows.length > 0 ? [{ value: "hr" as const, label: t("activity.m.heartRate") }] : []),
    ...(paceRows.length > 0 ? [{ value: "pace" as const, label: paceLabel }] : [])
  ];
  const control =
    options.length > 1 ? (
      <OptionGroup
        label={t("activity.zoneTime.scale")}
        value={scale}
        options={options}
        onChange={setPicked}
      />
    ) : null;
  // Never 0: a scale with nothing scored has no rows.
  const top = Math.max(...rows.map((row) => row.share));

  return (
    <Frame title={t("activity.zoneTime.title")} control={control}>
      <ul className="activity-zone-time">
        {rows.map((row) => {
          const name = row.label
            ? zoneName(row.label)
            : t("overview.zones.zone", { n: row.position + 1 });
          const span = zoneRange(row, scale, unitSystem);
          return (
            <li
              key={row.position}
              style={zoneStyle(row.position)}
              className={row.seconds > 0 ? undefined : "is-empty"}
            >
              <div className="activity-zone-time-label">
                <span>
                  <i aria-hidden="true" />
                  {name}
                </span>
                {span ? <small>{span}</small> : null}
              </div>
              <div className="activity-zone-time-track" aria-hidden="true">
                <i style={{ width: `${(row.share / top) * 100}%` }} />
              </div>
              <div className="activity-zone-time-figure">
                <strong>{zoneDuration(row.seconds)}</strong>
                <span>{`${Math.round(row.share * 100)}%`}</span>
              </div>
            </li>
          );
        })}
      </ul>
      {benefit ? <TrainingBenefitReason reading={benefit} /> : null}
    </Frame>
  );
}

function Frame({
  title,
  control,
  children
}: {
  title: string;
  control: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="panel run-detail-panel activity-zone-time-panel">
      <header className="activity-zone-time-head">
        <p className="running-eyebrow">{title}</p>
        {control}
      </header>
      {children}
    </section>
  );
}
