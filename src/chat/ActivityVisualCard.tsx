import { Fragment, memo, useEffect, useId, useMemo, useState, type CSSProperties } from "react";
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
  ActivityVisualPreview,
  ActivityVisualStrengthExercise,
  CorosProfileZoneFamily,
  SessionSet
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
  speedUnit
} from "../units/units";
import {
  ACTIVITY_READINGS,
  activityReading,
  formatSwimPace,
  readsMovement,
  readsSpeed,
  type ActivityReading
} from "../../electron/activityReading";
import {
  buildElevationSeriesData,
  ChatMiniAreaChart
} from "./charts/ChatMiniAreaChart";
import { ChatChannelChart } from "./charts/ChatChannelChart";
import { joinChannelRows } from "./charts/channelRows";
import { formatCount, formatDecimal, t } from "../i18n/core";
import { resolveExerciseName } from "../training/exerciseNames";
import { formatVolumeKg, formatWeightKg } from "../strength/strengthAnalytics";
import { useI18n } from "../i18n/useI18n";
import { zoneName } from "../i18n/zoneNames";
import { heartRateZoneFamily, heartRateZoneTime } from "../training/zoneTime";
import { heartRateZoneModelFromProfile } from "../training/heartRateZoneModel";
import { zoneColor } from "../training/components/routeColoring";
import { sessionSetsCardExercises, sessionSetsHeartRate } from "../../electron/sessionSets";
import { SessionSetsChart } from "./charts/SessionSetsChart";
import { formatSessionSet, formatSetScheme } from "./sessionSetsFormat";
import { LapRecoveryMark, LapSectionRow } from "../training/components/LapSections";

/** COROS's Hybrid Fitness, recorded set by set though it is read as any other sport. */
const HYBRID_FITNESS = 1200;

type CardSections = ActivityVisualPreview["sections"];

/**
 * Each session's redraw, asked once a window. A session with no sets — a gym
 * session the watch recorded no exercises for — and a detail that cannot be
 * read (signed out, the session gone from COROS) are remembered as none: the
 * card would otherwise ask again on every mount, and each ask opens a ~2.5 MB
 * file, or costs a COROS request, and each failure writes to the error log.
 */
const storedSetsRedraws = new Map<string, Promise<Partial<CardSections> | null>>();

function readStoredSetsRedraw(activityId: string, sportType: number): Promise<Partial<CardSections> | null> {
  const key = `${activityId}:${sportType}`;
  const known = storedSetsRedraws.get(key);
  if (known) return known;
  const api = window.heraclesRecords;
  if (!api?.getTrainingHubActivityDetail) return Promise.resolve(null);
  const read = api.getTrainingHubActivityDetail(activityId, sportType).then(
    (detail): Partial<CardSections> | null => {
      const exercises = sessionSetsCardExercises(detail.exerciseSets);
      if (exercises.length === 0) return null;
      const series = sessionSetsHeartRate(detail.series);
      return {
        strength: { exercises },
        laps: undefined,
        cadence: undefined,
        ...(series.length >= 2 ? { hr: { chartKind: "series" as const, series } } : {})
      };
    },
    () => null
  );
  storedSetsRedraws.set(key, read);
  return read;
}

/**
 * A set-by-set session's card stored before its sets were kept — heart rate
 * with no clock, drawn as "Point 1, Point 2…", and a lap table of sets and
 * rests with nothing to say which is which — drawn again from the session's
 * detail, which is on disk from when the card was made. Nothing is written
 * back: the stored card stays as it was, and a detail that cannot be read
 * leaves it drawn as before.
 */
function useStoredSetsRedraw(
  preview: ActivityVisualPreview,
  reading: ActivityReading
): Partial<CardSections> | undefined {
  const [redrawn, setRedrawn] = useState<Partial<CardSections>>();
  const { activityId, sportType } = preview;
  const stale =
    (reading === "sets" || sportType === HYBRID_FITNESS) &&
    sportType !== undefined &&
    !preview.sections.strength?.exercises.some((exercise) => exercise.setList?.length);

  useEffect(() => {
    if (!stale || sportType === undefined) return;
    let live = true;
    void readStoredSetsRedraw(activityId, sportType).then((sections) => {
      if (live && sections) setRedrawn(sections);
    });
    return () => {
      live = false;
    };
  }, [activityId, sportType, stale]);

  return stale ? redrawn : undefined;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** A set the card can place: a start and a length on the clock, and a rest after it if any. */
function readableSet(set: unknown): set is SessionSet {
  if (!set || typeof set !== "object") return false;
  const { start, seconds, restSeconds } = set as Record<string, unknown>;
  return finite(start) && finite(seconds) && (restSeconds === undefined || finite(restSeconds));
}

/**
 * The exercises with every set list in a shape the card can draw. The sets
 * reach it through the stored entry's unknown keys, unparsed, so a list
 * another build wrote in a shape this one does not know loses the sets it
 * cannot read rather than taking the card down.
 */
function readableExercises(
  exercises: ActivityVisualStrengthExercise[] | undefined
): ActivityVisualStrengthExercise[] {
  return (exercises ?? []).map((exercise) => {
    const sets: unknown = exercise.setList;
    if (sets === undefined || (Array.isArray(sets) && sets.every(readableSet))) return exercise;
    const { setList: _unreadable, ...rest } = exercise;
    const setList = Array.isArray(sets) ? sets.filter(readableSet) : [];
    return setList.length > 0 ? { ...rest, setList } : rest;
  });
}

/** How long the account's zone model read for a card is trusted before it is read again. */
const ACCOUNT_FAMILY_TTL_MS = 10 * 60_000;
let accountFamilyRead: { at: number; family: Promise<CorosProfileZoneFamily | undefined> } | undefined;

/**
 * The heart-rate model the account is scored against, for a zone split whose
 * activity names none — COROS sends `zoneType` 0 on some sessions of an
 * account it scores on reserve. Read from the main process's profile cache,
 * which costs no COROS request, and shared by every card on screen.
 */
function readAccountZoneFamily(): Promise<CorosProfileZoneFamily | undefined> {
  const api = window.heraclesRecords;
  if (!api?.getCorosProfileSnapshot) return Promise.resolve(undefined);
  if (!accountFamilyRead || Date.now() - accountFamilyRead.at > ACCOUNT_FAMILY_TTL_MS) {
    accountFamilyRead = {
      at: Date.now(),
      family: api.getCorosProfileSnapshot().then(
        (snapshot) => heartRateZoneModelFromProfile(snapshot.profile)?.family,
        () => undefined
      )
    };
  }
  return accountFamilyRead.family;
}

function useAccountZoneFamily(needed: boolean): CorosProfileZoneFamily | undefined {
  const [family, setFamily] = useState<CorosProfileZoneFamily>();
  useEffect(() => {
    if (!needed) return;
    let live = true;
    void readAccountZoneFamily().then((read) => {
      if (live) setFamily(read);
    });
    return () => {
      live = false;
    };
  }, [needed]);
  return needed ? family : undefined;
}

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
 * Where the session's heart rate sat, as COROS scored it: one bar of the
 * zones reached, each in the colour the route map and the session's own page
 * give it, named in the account's model. The zones never reached are left
 * out here — the page lists the whole scale; a card in a conversation says
 * what the session was.
 */
function ZoneShare({ zones }: { zones: NonNullable<ActivityVisualPreview["sections"]["zones"]> }) {
  useI18n();
  const stated = zones.zoneType || undefined;
  const account = useAccountZoneFamily(heartRateZoneFamily(stated, undefined) === undefined);
  const family = heartRateZoneFamily(stated, account);
  const reached = useMemo(
    () => heartRateZoneTime(zones.buckets, family).filter((row) => row.seconds > 0),
    [family, zones]
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

/**
 * Memoised on `preview`, which is the transcript entry's own object: Coach
 * re-renders on every token, keystroke and settings change, and a card whose
 * entry did not change has nothing to redraw.
 */
export const ActivityVisualCard = memo(function ActivityVisualCard({
  preview
}: ActivityVisualCardProps) {
  // The series carry their labels as text (a distance's decimals, a clock),
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
  const redrawn = useStoredSetsRedraw(preview, reading);
  const sections = useMemo<CardSections>(
    () => (redrawn ? { ...preview.sections, ...redrawn } : preview.sections),
    [preview, redrawn]
  );
  const hrBarData = useMemo(
    () => buildLapBarData(sections.hr?.laps, (lap) => lap.avgHr),
    [sections]
  );
  const cadenceBarData = useMemo(
    () => buildLapBarData(sections.cadence?.laps, (lap) => lap.avgCadence),
    [sections]
  );
  const elevationData = useMemo(
    () =>
      sections.elevation?.points
        ? buildElevationSeriesData(sections.elevation.points, unitSystem)
        : [],
    [locale, sections, unitSystem]
  );

  const cadenceUnit = cycling ? "rpm" : "spm";
  const title = preview.name ?? t("activity.untitled");
  const subtitle = preview.startTime ?? undefined;
  const laps = sections.laps ?? [];
  const [lapsOpen, setLapsOpen] = useState(laps.length < LAPS_FOLDED_FROM);
  const lapsTableId = useId();
  const strengthExercises = useMemo(() => readableExercises(sections.strength?.exercises), [sections]);
  // A session recorded set by set draws its heart rate under its sets, on
  // the clock they were placed on; a card with no clock or no sets cannot.
  const setsSeries =
    sections.hr?.chartKind === "series" &&
    strengthExercises.some((exercise) => exercise.setList?.length) &&
    (sections.hr.series ?? []).filter((point) => point.elapsed !== undefined && point.hr !== undefined)
      .length >= 2
      ? sections.hr.series
      : undefined;
  const exercisesHaveLoad = strengthExercises.some((exercise) => exercise.maxWeightKg);
  const exercisesHaveVolume = strengthExercises.some((exercise) => exercise.volumeKg);
  // The column only appears where a lap actually recorded cadence, so a pool
  // swim keeps the narrow table it has now. A gym session's laps are its sets
  // and rests: time and heart rate, no distance, pace or cadence.
  const lapsHaveCadence = moves && laps.some((lap) => lap.avgCadence !== undefined);
  const lapsHaveDistance =
    moves && (reading !== "effort" || laps.some((lap) => (lap.distance ?? 0) > 0));
  const lapColumns = 4 + (lapsHaveDistance ? 2 : 0) + (lapsHaveCadence ? 1 : 0);
  const lapSectionList = laps.map((lap) => lap.section);
  const paceLabel = asSpeed ? t("activity.m.speed") : t("activity.m.pace");
  const formatPerformance = (secondsPerKm: number): string =>
    asSpeed
      ? `${formatDecimal(kmhToDisplaySpeed(3600 / secondsPerKm, unitSystem), 1)} ${speedUnit(unitSystem)}`
      : swim
        ? formatSwimPace(secondsPerKm, unitSystem)
        : formatPaceValue(secondsPerKm, unitSystem);
  const cadence = moves ? sections.cadence : undefined;
  const { colors } = useChartColors();
  // Every channel recorded sample by sample shares one chart, a chip each; a
  // channel COROS gave only per-lap averages for keeps its own bars, which run
  // along the laps rather than the distance, and a session of sets keeps its
  // heart rate under its sets.
  const { rows: channelRows, joinsElevation } = useMemo(
    () =>
      joinChannelRows(
        {
          hr: sections.hr?.chartKind === "series" && !setsSeries ? sections.hr.series : undefined,
          pace: moves ? sections.pace?.series : undefined,
          power: moves ? sections.power?.series : undefined,
          cadence: cadence?.chartKind === "series" ? cadence.series : undefined,
          elevation: moves && !swim ? sections.elevation?.points : undefined
        },
        reading,
        unitSystem
      ),
    // The labels are text in the language on screen.
    [cadence, locale, moves, reading, sections, setsSeries, swim, unitSystem]
  );
  const charted = (key: "hr" | "pace" | "speed" | "power" | "cadence"): boolean =>
    channelRows.filter((row) => row[key] !== undefined).length >= 2;
  const hrCharted = charted("hr");
  const paceCharted = charted(asSpeed ? "speed" : "pace");

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

      {sections.zones ? <ZoneShare zones={sections.zones} /> : null}

      {channelRows.length >= 2 && (hrCharted || paceCharted || charted("power") || charted("cadence")) ? (
        <ChatChannelChart
          previewId={preview.previewId}
          reading={reading}
          sportType={preview.sportType}
          rows={channelRows}
          unitSystem={unitSystem}
          cadenceUnit={cadenceUnit}
        />
      ) : null}

      {sections.hr && !hrCharted ? (
        <section className="chat-visual-section">
          {setsSeries ? (
            <div className="chat-visual-section-head">
              <h5>{t("activity.m.heartRate")}</h5>
              <span className="chat-visual-key" style={{ "--set-band": colors.accent } as CSSProperties}>
                <i aria-hidden="true" />
                {t("activity.strength.set")}
              </span>
            </div>
          ) : (
            <h5>{t("activity.m.heartRate")}</h5>
          )}
          {setsSeries ? (
            <SessionSetsChart
              series={setsSeries}
              exercises={strengthExercises}
              gradientId={`chatHrFill-${preview.previewId}`}
              unitSystem={unitSystem}
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

      {moves && sections.pace && !paceCharted ? (
        <section className="chat-visual-section">
          <h5>{paceLabel}</h5>
          <p className="chat-visual-empty">{asSpeed ? t("chat.chart.noSpeed") : t("chat.chart.noPace")}</p>
        </section>
      ) : null}

      {moves && sections.power && !charted("power") ? (
        <section className="chat-visual-section">
          <h5>{t("activity.m.power")}</h5>
          <p className="chat-visual-empty">{t("chat.chart.noPower")}</p>
        </section>
      ) : null}

      {cadence && !charted("cadence") ? (
        <section className="chat-visual-section">
          <h5>{t("activity.m.cadence")}</h5>
          {cadenceBarData.length >= 2 ? (
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

      {moves && !swim && sections.elevation && !joinsElevation ? (
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
          <h5>
            {t("strength.exercises.title")} <span>{formatCount(strengthExercises.length)}</span>
          </h5>
          <div className="chat-plan-table-wrap">
            <table className="chat-plan-table chat-sets-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>{t("workout.summary.exercise")}</th>
                  <th>{t("activity.strength.sets")}</th>
                  {exercisesHaveLoad ? <th>{t("activity.strength.weight")}</th> : null}
                  {exercisesHaveVolume ? <th>{t("strength.metric.volume")}</th> : null}
                </tr>
              </thead>
              <tbody>
                {strengthExercises.map((exercise, index) => (
                  <tr key={`${exercise.nameKey}-${index}`}>
                    <td>{index + 1}</td>
                    <td>{resolveExerciseName(exercise.nameKey, exercise.rawName)}</td>
                    <td
                      title={exercise.setList
                        ?.map((set) => formatSessionSet(set, unitSystem))
                        .join(" · ")}
                    >
                      {formatSetScheme(exercise)}
                    </td>
                    {exercisesHaveLoad ? (
                      <td>{formatLoadRange(exercise.minWeightKg, exercise.maxWeightKg, unitSystem)}</td>
                    ) : null}
                    {exercisesHaveVolume ? (
                      <td>
                        {exercise.volumeKg ? formatVolumeKg(exercise.volumeKg, unitSystem) : "—"}
                      </td>
                    ) : null}
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
                {laps.map((lap, position) => (
                  <Fragment key={lap.index}>
                    <LapSectionRow sections={lapSectionList} index={position} colSpan={lapColumns} />
                    <tr className={lap.recovery ? "is-lap-recovery" : undefined}>
                      <td>
                        {lap.index}
                        {lap.recovery ? <LapRecoveryMark /> : null}
                      </td>
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
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
});
