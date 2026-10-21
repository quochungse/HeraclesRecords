import { memo, useId, useMemo, useState, type CSSProperties } from "react";
import { ChevronDown } from "lucide-react";
import {
  Bar,
  BarChart,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { ChartWhenNear } from "./charts/ChartWhenNear";
import type { TooltipContentProps } from "recharts";
import type {
  ActivityVisualLapPoint,
  ActivityVisualPreview
} from "../../electron/types";
import {
  formatDistanceMeters,
  formatDurationSeconds,
  formatDurationSpan,
  formatOptionalNumber,
  formatPaceSecondsPerKm
} from "../training/formatters";
import {
  trainingChartMargin,
  trainingChartTooltipStyle
} from "../training/chartConfig";
import { useChartColors } from "../training/useChartColors";
import { useUnitSystem } from "../units/UnitSystemProvider";
import {
  elevationUnit,
  kilogramsToDisplayWeight,
  kmhToDisplaySpeed,
  speedUnit,
  swimDistanceUnit
} from "../units/units";
import {
  ACTIVITY_READINGS,
  activityReading,
  formatSwimPace,
  formatSwimPaceClock,
  readsMovement,
  readsSpeed
} from "../../electron/activityReading";
import {
  buildDistanceSeriesData,
  buildElevationSeriesData,
  ChatMiniAreaChart
} from "./charts/ChatMiniAreaChart";
import { formatCount, formatDecimal, t } from "../i18n/core";
import { resolveExerciseName } from "../training/exerciseNames";
import { formatVolumeKg, formatWeightKg } from "../strength/strengthAnalytics";
import { useI18n } from "../i18n/useI18n";
import { zoneName } from "../i18n/zoneNames";
import { heartRateZoneFamily, heartRateZoneTime } from "../training/zoneTime";
import { zoneColor } from "../training/components/routeColoring";

/** `40 kg`, or `20–40 kg` when the sets were lifted at different loads. */
function formatLoadRange(
  minKg: number | undefined,
  maxKg: number | undefined,
  unitSystem: "metric" | "imperial"
): string {
  if (!maxKg) {
    return "—";
  }
  if (!minKg || minKg === maxKg) {
    return formatWeightKg(maxKg, unitSystem);
  }
  const low = kilogramsToDisplayWeight(minKg, unitSystem);
  return `${Number.isInteger(low) ? formatCount(low) : formatDecimal(low, 1)}–${formatWeightKg(maxKg, unitSystem)}`;
}

interface ActivityVisualCardProps {
  preview: ActivityVisualPreview;
}

function formatPaceValue(
  paceSecondsPerKm: number,
  unitSystem: "metric" | "imperial"
): string {
  return formatPaceSecondsPerKm(paceSecondsPerKm, unitSystem);
}

function LapBarTooltip({
  active,
  payload,
  label,
  formatValue
}: TooltipContentProps & { formatValue: (value: number) => string }) {
  if (!active || !payload?.length) {
    return null;
  }

  const value = payload[0]?.value;

  return (
    <div className="training-chart-tooltip">
      <span>{label}</span>
      <strong>{typeof value === "number" ? formatValue(value) : "-"}</strong>
    </div>
  );
}

interface LapBarDatum {
  label: string;
  value: number;
}

/**
 * The per-lap view of a channel, for the activities where COROS records lap
 * averages and no sample stream. Shared by heart rate and cadence so the two
 * fall back to the same chart rather than to two copies of it.
 */
function ChatLapBarChart({
  data,
  name,
  formatValue
}: {
  data: LapBarDatum[];
  name: string;
  formatValue: (value: number) => string;
}) {
  const { colors } = useChartColors();

  return (
    <div className="chat-visual-chart-shell">
      <ChartWhenNear>
        <BarChart data={data} margin={trainingChartMargin}>
          <XAxis
            dataKey="label"
            tick={{ fill: colors.text, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            minTickGap={16}
          />
          <YAxis
            tick={{ fill: colors.text, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={36}
            domain={["auto", "auto"]}
          />
          <Tooltip
            content={(props) => (
              <LapBarTooltip {...props} formatValue={formatValue} />
            )}
            cursor={{ fill: colors.cursor }}
            contentStyle={trainingChartTooltipStyle}
          />
          <Bar
            dataKey="value"
            name={name}
            fill={colors.accentBright}
            radius={[4, 4, 0, 0]}
            isAnimationActive={false}
          />
        </BarChart>
      </ChartWhenNear>
    </div>
  );
}

function buildLapBarData(
  laps: ActivityVisualLapPoint[] | undefined,
  pick: (lap: ActivityVisualLapPoint) => number | undefined
): LapBarDatum[] {
  return (laps ?? [])
    .map((lap) => ({ label: `Lap ${lap.index}`, value: pick(lap) }))
    .filter((datum): datum is LapBarDatum =>
      datum.value !== undefined && Number.isFinite(datum.value)
    );
}

/**
 * Memoised on `preview`, which is the transcript entry's own object: Coach
 * re-renders on every token, keystroke and settings change, and a card whose
 * entry did not change has nothing to redraw.
 */
/**
 * Where the session's heart rate sat, as COROS scored it: one bar of the
 * zones reached, each in the colour the route map and the session's own page
 * give it, named in the account's model. The zones never reached are left
 * out here — the page lists the whole scale; a card in a conversation says
 * what the session was.
 */
function ZoneShare({ zones }: { zones: NonNullable<ActivityVisualPreview["sections"]["zones"]> }) {
  const reached = useMemo(
    () =>
      heartRateZoneTime(zones.buckets, heartRateZoneFamily(zones.zoneType || undefined, undefined)).filter(
        (row) => row.seconds > 0
      ),
    [zones]
  );
  if (!reached.length) return null;
  const rows = reached.map((row) => ({
    ...row,
    name: row.label ? zoneName(row.label) : t("overview.zones.zone", { n: row.position + 1 }),
    style: { "--zone-color": zoneColor(row.position) } as CSSProperties
  }));
  return (
    <section className="chat-visual-section">
      <h5>{t("activity.zoneTime.title")}</h5>
      <div className="chat-visual-zones-bar" aria-hidden="true">
        {rows.map((row) => (
          <i
            key={row.position}
            style={{ ...row.style, flexGrow: row.share }}
            title={`${row.name} · ${formatDurationSpan(row.seconds)}`}
          />
        ))}
      </div>
      <ul className="chat-visual-zones-legend">
        {rows.map((row) => (
          <li key={row.position} style={row.style} title={formatDurationSpan(row.seconds)}>
            <i aria-hidden="true" />
            {row.name}
            <strong>{`${Math.round(row.share * 100)}%`}</strong>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * A lap table this long or longer starts folded: an interval session's twenty
 * rows ran the card a screen down the conversation, past the answer that
 * reads them. A shorter one is open, being no taller than a chart.
 */
const LAPS_FOLDED_FROM = 5;

export const ActivityVisualCard = memo(function ActivityVisualCard({
  preview
}: ActivityVisualCardProps) {
  // The series carry their labels as text (a distance's decimals, "Point 3"),
  // so they are worked out again when the language changes.
  const { locale } = useI18n();
  const { unitSystem } = useUnitSystem();
  // What a sport is read in decides every section below: a gym session is
  // heart rate over time, a hike and a ride read km/h, a swim a pace per 100.
  // A card stored before this was decided may still hold a pace or a cadence
  // for a gym session, which is not drawn, and carries no `reading` (nor one
  // this build knows, from a newer one): its code stands in, which misreads
  // only a custom sport. A card from before the code was stored has neither,
  // and reads as a pace, as every such card was drawn.
  const reading =
    preview.reading && ACTIVITY_READINGS.includes(preview.reading)
      ? preview.reading
      : activityReading(preview.sportType);
  const swim = reading === "swim";
  const cycling = reading === "speed";
  const asSpeed = readsSpeed(reading);
  const moves = readsMovement(reading);
  const hrSeriesData = useMemo(
    () =>
      preview.sections.hr?.chartKind === "series" && preview.sections.hr.series
        ? buildDistanceSeriesData(preview.sections.hr.series, "hr", unitSystem, swim)
        : [],
    [locale, preview, swim, unitSystem]
  );
  const hrBarData = useMemo(
    () => buildLapBarData(preview.sections.hr?.laps, (lap) => lap.avgHr),
    [preview]
  );
  const cadenceSeriesData = useMemo(
    () =>
      preview.sections.cadence?.chartKind === "series" &&
      preview.sections.cadence.series
        ? buildDistanceSeriesData(
            preview.sections.cadence.series,
            "cadence",
            unitSystem,
            swim
          )
        : [],
    [locale, preview, swim, unitSystem]
  );
  const cadenceBarData = useMemo(
    () => buildLapBarData(preview.sections.cadence?.laps, (lap) => lap.avgCadence),
    [preview]
  );
  const paceData = useMemo(
    () =>
      preview.sections.pace?.series
        ? buildDistanceSeriesData(
            preview.sections.pace.series,
            "pace",
            unitSystem,
            swim,
            asSpeed
          )
        : [],
    [asSpeed, locale, preview, swim, unitSystem]
  );
  const powerData = useMemo(
    () =>
      preview.sections.power?.series
        ? buildDistanceSeriesData(preview.sections.power.series, "power", unitSystem, swim)
        : [],
    [locale, preview, swim, unitSystem]
  );
  const elevationData = useMemo(
    () =>
      preview.sections.elevation?.points
        ? buildElevationSeriesData(preview.sections.elevation.points, unitSystem)
        : [],
    [locale, preview, unitSystem]
  );

  const cadenceUnit = cycling ? "rpm" : "spm";
  const title = preview.name ?? t("activity.untitled");
  const subtitle = preview.startTime ?? undefined;
  const laps = preview.sections.laps ?? [];
  const [lapsOpen, setLapsOpen] = useState(laps.length < LAPS_FOLDED_FROM);
  const lapsTableId = useId();
  const strengthExercises = preview.sections.strength?.exercises ?? [];
  // The column only appears where a lap actually recorded cadence, so a pool
  // swim keeps the narrow table it has now. A gym session's laps are its sets
  // and rests: time and heart rate, no distance, pace or cadence.
  const lapsHaveCadence = moves && laps.some((lap) => lap.avgCadence !== undefined);
  const lapsHaveDistance =
    moves && (reading !== "effort" || laps.some((lap) => (lap.distance ?? 0) > 0));
  const paceLabel = asSpeed ? t("activity.m.speed") : t("activity.m.pace");
  const formatPerformance = (secondsPerKm: number): string =>
    asSpeed
      ? `${formatDecimal(kmhToDisplaySpeed(3600 / secondsPerKm, unitSystem), 1)} ${speedUnit(unitSystem)}`
      : swim
        ? formatSwimPace(secondsPerKm, unitSystem)
        : formatPaceValue(secondsPerKm, unitSystem);
  const cadence = moves ? preview.sections.cadence : undefined;

  return (
    <div className="chat-visual-card">
      <div className="chat-visual-card-header">
        <div>
          <h4>{title}</h4>
          {subtitle ? (
            <span className="chat-visual-card-subtitle">{subtitle}</span>
          ) : null}
        </div>
        <div className="chat-visual-stats">
          {preview.avgHr != null ? (
            <span className="chat-visual-stat">
              {t("activity.m.avgHr")} <strong>{Math.round(preview.avgHr)}</strong>
            </span>
          ) : null}
          {preview.maxHr != null ? (
            <span className="chat-visual-stat">
              {t("activity.m.maxHr")} <strong>{Math.round(preview.maxHr)}</strong>
            </span>
          ) : null}
        </div>
      </div>

      {preview.sections.zones ? <ZoneShare zones={preview.sections.zones} /> : null}

      {preview.sections.hr ? (
        <section className="chat-visual-section">
          <h5>{t("activity.m.heartRate")}</h5>
          {preview.sections.hr.chartKind === "series" && hrSeriesData.length >= 2 ? (
            <ChatMiniAreaChart
              data={hrSeriesData}
              gradientId={`chatHrFill-${preview.previewId}`}
              name={t("activity.m.heartRate")}
              formatValue={(value) => `${Math.round(value)} bpm`}
            />
          ) : hrBarData.length >= 2 ? (
            <ChatLapBarChart
              data={hrBarData}
              name={t("activity.m.avgHr")}
              formatValue={(value) => `${Math.round(value)} bpm`}
            />
          ) : (
            <p className="chat-visual-empty">{t("chat.chart.noHr")}</p>
          )}
        </section>
      ) : null}

      {moves && preview.sections.pace ? (
        <section className="chat-visual-section">
          <h5>{paceLabel}</h5>
          {paceData.length >= 2 ? (
            <ChatMiniAreaChart
              data={paceData}
              gradientId={`chatPaceFill-${preview.previewId}`}
              name={paceLabel}
              // A swim's values are already seconds per 100 (the series data
              // converts them), a ride's and a hike's km/h.
              formatValue={(value) =>
                asSpeed
                  ? `${formatDecimal(value, 1)} ${speedUnit(unitSystem)}`
                  : swim
                    ? `${formatSwimPaceClock(value)} /100${swimDistanceUnit(unitSystem)}`
                    : formatPaceValue(value, unitSystem)
              }
              yAxisFormatter={(value) =>
                asSpeed
                  ? formatDecimal(value, 1)
                  : swim
                    ? formatSwimPaceClock(value)
                    : formatPaceValue(value, unitSystem).replace(/\/(?:km|mi)$/, "")
              }
            />
          ) : (
            <p className="chat-visual-empty">{asSpeed ? t("chat.chart.noSpeed") : t("chat.chart.noPace")}</p>
          )}
        </section>
      ) : null}

      {moves && preview.sections.power ? (
        <section className="chat-visual-section">
          <h5>{t("activity.m.power")}</h5>
          {powerData.length >= 2 ? (
            <ChatMiniAreaChart
              data={powerData}
              gradientId={`chatPowerFill-${preview.previewId}`}
              name={t("activity.m.power")}
              formatValue={(value) => `${Math.round(value)} W`}
            />
          ) : (
            <p className="chat-visual-empty">{t("chat.chart.noPower")}</p>
          )}
        </section>
      ) : null}

      {cadence ? (
        <section className="chat-visual-section">
          <h5>{t("activity.m.cadence")}</h5>
          {cadence.chartKind === "series" &&
          cadenceSeriesData.length >= 2 ? (
            <ChatMiniAreaChart
              data={cadenceSeriesData}
              gradientId={`chatCadenceFill-${preview.previewId}`}
              name={t("activity.m.cadence")}
              formatValue={(value) => `${Math.round(value)} ${cadenceUnit}`}
            />
          ) : cadenceBarData.length >= 2 ? (
            <ChatLapBarChart
              data={cadenceBarData}
              name={t("activity.m.avgCadence")}
              formatValue={(value) => `${Math.round(value)} ${cadenceUnit}`}
            />
          ) : (
            <p className="chat-visual-empty">{t("chat.chart.noCadence")}</p>
          )}
        </section>
      ) : null}

      {moves && !swim && preview.sections.elevation ? (
        <section className="chat-visual-section">
          <h5>{t("activity.m.elevation")}</h5>
          {elevationData.length >= 2 ? (
            <ChatMiniAreaChart
              data={elevationData}
              gradientId={`chatElevFill-${preview.previewId}`}
              name={t("activity.m.elevation")}
              formatValue={(value) => `${Math.round(value)} ${elevationUnit(unitSystem)}`}
            />
          ) : (
            <p className="chat-visual-empty">{t("chat.chart.noElevation")}</p>
          )}
        </section>
      ) : null}

      {strengthExercises.length > 0 ? (
        <section className="chat-visual-section">
          <h5>{t("strength.exercises.title")}</h5>
          <div className="chat-plan-table-wrap">
            <table className="chat-plan-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>{t("workout.summary.exercise")}</th>
                  <th>{t("activity.strength.sets")}</th>
                  <th>{t("activity.strength.reps")}</th>
                  <th>{t("activity.strength.weight")}</th>
                  <th>{t("strength.metric.volume")}</th>
                </tr>
              </thead>
              <tbody>
                {strengthExercises.map((exercise, index) => (
                  <tr key={`${exercise.nameKey}-${index}`}>
                    <td>{index + 1}</td>
                    <td>{resolveExerciseName(exercise.nameKey, exercise.rawName)}</td>
                    <td>{formatCount(exercise.sets)}</td>
                    <td>{formatCount(exercise.reps)}</td>
                    <td>{formatLoadRange(exercise.minWeightKg, exercise.maxWeightKg, unitSystem)}</td>
                    <td>
                      {exercise.volumeKg ? formatVolumeKg(exercise.volumeKg, unitSystem) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {laps.length > 0 ? (
        <section className="chat-visual-section">
          <div className="chat-visual-section-head">
            <h5>
              {t("activity.m.laps")} <span>{formatCount(laps.length)}</span>
            </h5>
            <button
              type="button"
              className="chat-plan-review chat-visual-toggle"
              aria-expanded={lapsOpen}
              aria-controls={lapsTableId}
              onClick={() => setLapsOpen((open) => !open)}
            >
              {lapsOpen ? t("chat.chart.hideLaps") : t("chat.chart.showLaps")}
              <ChevronDown size={14} aria-hidden="true" />
            </button>
          </div>
          <div className="chat-plan-table-wrap" id={lapsTableId} hidden={!lapsOpen}>
            <table className="chat-plan-table">
              <thead>
                <tr>
                  <th>#</th>
                  {lapsHaveDistance ? <th>{t("activity.m.distance")}</th> : null}
                  <th>{t("activity.m.duration")}</th>
                  <th>{t("activity.m.avgHr")}</th>
                  <th>{t("activity.m.maxHr")}</th>
                  {lapsHaveDistance ? <th>{paceLabel}</th> : null}
                  {lapsHaveCadence ? <th>{cadenceUnit.toUpperCase()}</th> : null}
                </tr>
              </thead>
              <tbody>
                {laps.map((lap) => (
                  <tr key={lap.index}>
                    <td>{lap.index}</td>
                    {lapsHaveDistance ? (
                      <td>{formatDistanceMeters(lap.distance, unitSystem, swim)}</td>
                    ) : null}
                    <td>{formatDurationSeconds(lap.duration)}</td>
                    <td>{formatOptionalNumber(lap.avgHr)}</td>
                    <td>{formatOptionalNumber(lap.maxHr)}</td>
                    {lapsHaveDistance ? (
                      <td>
                        {lap.distance && lap.duration
                          ? formatPerformance(lap.duration / (lap.distance / 1000))
                          : lap.pace
                            ? formatPerformance(lap.pace)
                            : "—"}
                      </td>
                    ) : null}
                    {lapsHaveCadence ? (
                      <td>{formatOptionalNumber(lap.avgCadence)}</td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
});
