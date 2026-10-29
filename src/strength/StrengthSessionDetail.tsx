import { exerciseLabel } from "./strengthAnalytics";
import { useMemo, useState, type ReactNode } from "react";
import { ArrowUpRight, ChevronLeft, ChevronRight, Info, MessageCircle, Trophy } from "lucide-react";
import type {
  CoachOpenRequest,
  HeraclesSetLoad,
  StrengthLoadSource,
  StrengthSession,
  UnitSystem
} from "../../electron/types";
import { activityCoachRequest } from "../training/askCoachAbout";
import { loadPairTitle, useLoadSource } from "../training/loadSource";
import { formatDistanceValue } from "../units/units";
import { useUnitSystem } from "../units/UnitSystemProvider";
import {
  buildExerciseRows,
  buildSessionStats,
  type SessionAnalytics,
  type SessionExerciseRow,
  type SessionPersonalRecord,
  type SessionStats,
  type StrengthSessionIndex
} from "./sessionAnalytics";
import {
  formatLiftWeight,
  formatSessionDate,
  formatSpan,
  formatTotalWeight,
  sessionSourceLabel
} from "./strengthFormat";
import { formatCount, formatDecimal, getIntlLocale, plural, t } from "../i18n/core";

/** Sessions this short open with every exercise's sets showing; longer ones start folded. */
const EXPANDED_EXERCISE_LIMIT = 3;

/** Sessions with a record listed before "Show all"; the rest wait behind it. */
const RECORD_SESSIONS_SHOWN = 6;

/** Where the header's PR chip takes the reader. */
const EXERCISES_ID = "strength-session-exercises";
const RECORDS_ID = "strength-window-records";

const SET_TYPES = new Set(["warmup", "dropset", "failure"]);

/** A set's type as a one-letter tag and its name, in the language on screen. */
function setTypeTag(type: string): { tag: string; label: string } | undefined {
  if (!SET_TYPES.has(type)) return undefined;
  const kind = type as "warmup" | "dropset" | "failure";
  return { tag: t(`strength.setType.${kind}.tag` as const), label: t(`strength.setType.${kind}` as const) };
}

interface RecordGroup {
  exercise: string;
  weight?: SessionPersonalRecord;
  e1rm?: SessionPersonalRecord;
}

/** A lift's heaviest-set and estimated-max records read as one record, not two. */
function groupRecords(records: SessionPersonalRecord[]): RecordGroup[] {
  const groups = new Map<string, RecordGroup>();
  for (const record of records) {
    const group = groups.get(record.exercise) ?? { exercise: record.exercise };
    group[record.kind] = record;
    groups.set(record.exercise, group);
  }
  return [...groups.values()];
}

/**
 * The figure a record is stated by: the estimated max, which a lighter set
 * for more reps can still raise, and the heaviest set only where that is all
 * the record was.
 */
function headlineRecord(group: RecordGroup): SessionPersonalRecord | undefined {
  return group.e1rm ?? group.weight;
}

/**
 * `+2.4 kg`: how far a record moved its lift. Nothing at all for a gain that
 * rounds away — a record only has to beat the last best, and "+0 kg" reads as
 * a record that moved nothing.
 */
function RecordGain({ record, unitSystem }: { record: SessionPersonalRecord; unitSystem: UnitSystem }) {
  const gain = Math.round((record.valueKg - record.previousKg) * 10) / 10;
  if (gain <= 0) return null;
  return <em className="strength-session-gain">+{formatLiftWeight(gain, unitSystem)}</em>;
}

/** How many lifts set a record in the window, as the header's chip counts them. */
export function countWindowRecords(sessions: StrengthSession[], index: StrengthSessionIndex): number {
  return sessions.reduce(
    (total, session) => total + groupRecords(index.byId.get(session.activityId)?.records ?? []).length,
    0
  );
}

function scrollToCard(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function Stat({ label, value, caption, title }: { label: string; value: string; caption?: ReactNode; title?: string }) {
  return (
    <div className="strength-session-stat" title={title}>
      <span>{label}</span>
      <strong>{value}</strong>
      {/* Always drawn, so every stat in the band is the same height. */}
      <em>{caption ?? ""}</em>
    </div>
  );
}

/**
 * The session's training load in the load the athlete reads strength in. As
 * Heracles Training Load, the caption names COROS's figure beside a bar of the
 * two parts — COROS's heart-rate part, then what the sets add — inside the
 * caption line, so the band keeps its height. The hover adds the run of theirs
 * that carried about the same load.
 */
function LoadStat({
  stats,
  source,
  unitSystem
}: {
  stats: SessionStats;
  source: StrengthLoadSource;
  unitSystem: UnitSystem;
}) {
  const heracles = source === "heracles" ? stats.heracles : undefined;
  if (!heracles) {
    return stats.trainingLoad !== undefined ? (
      <Stat label={t("activity.m.trainingLoad")} value={String(Math.round(stats.trainingLoad))} />
    ) : null;
  }
  const corosLabel =
    heracles.cardio !== undefined
      ? t("strength.load.coros", { value: formatCount(Math.round(heracles.cardio)) })
      : t("strength.load.corosNone");
  const showSplit = heracles.quality === "sets" && heracles.value > 0 && heracles.cardio !== undefined;
  const run = heracles.runEquivalent;
  const title = [
    loadPairTitle(source, heracles.value, heracles.cardio, heracles.quality),
    run
      ? t("strength.load.runEquivalent", {
          distance: formatDistanceValue(run.distance ?? 0, unitSystem, { digits: 1 }),
          time: formatSpan(run.duration ?? 0),
          date: new Intl.DateTimeFormat(getIntlLocale(), { day: "numeric", month: "short" }).format(
            new Date((run.startTime ?? 0) * 1000)
          ),
          load: formatCount(Math.round(run.trainingLoad))
        })
      : undefined
  ]
    .filter(Boolean)
    .join("\n");
  return (
    <Stat
      label={t("activity.m.trainingLoad")}
      value={formatCount(Math.round(heracles.value))}
      title={title || undefined}
      caption={
        <>
          {showSplit ? (
            <i className="strength-load-split" aria-hidden="true">
              <i className="is-cardio" style={{ flexGrow: heracles.cardio }} />
              <i className="is-muscular" style={{ flexGrow: heracles.muscular }} />
            </i>
          ) : null}
          {corosLabel}
        </>
      }
    />
  );
}

/** What a set's load was read from, for its hover. */
function setLoadTitle(load: HeraclesSetLoad): string {
  const rpe = formatDecimal(load.rpe, 1);
  if (load.filled) return t("strength.load.setFilled", { rpe });
  if (load.rir === undefined || load.intensity === undefined) return t("strength.load.setHold", { rpe });
  return t("strength.load.set", {
    rpe,
    rir: formatDecimal(load.rir, 1),
    intensity: formatCount(Math.round(load.intensity * 100))
  });
}

/** The band's PR chip; it takes the reader down to where the records are written out. */
function RecordChip({ count, target }: { count: number; target: string }) {
  if (count <= 0) return null;
  return (
    <button type="button" className="strength-record-chip" onClick={() => scrollToCard(target)}>
      <Trophy size={13} aria-hidden="true" />
      {plural("strength.prCount", count)}
    </button>
  );
}

/** `4 sets · 32 reps`, or the time held when the sets were timed. */
function formatSeconds(seconds: number): string {
  const total = Math.round(seconds);
  if (total < 60) return `${total} s`;
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

interface ExerciseTableProps {
  rows: SessionExerciseRow[];
  explorable: ReadonlySet<string>;
  onOpenExercise: (name: string) => void;
  unitSystem: UnitSystem;
  /** Each set's Heracles load, while that is the load strength is read in. */
  showLoad: boolean;
}

function ExerciseTable({ rows, explorable, onOpenExercise, unitSystem, showLoad }: ExerciseTableProps) {
  const [open, setOpen] = useState<ReadonlySet<string>>(
    () => new Set(rows.length <= EXPANDED_EXERCISE_LIMIT ? rows.map((row) => row.key) : [])
  );
  const toggle = (key: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <>
      <div className="strength-session-exercise-columns" aria-hidden="true">
        <span />
        <span>{t("strength.col.exercise")}</span>
        <span className="strength-session-exercise-facts" />
        <span>{t("strength.col.topSet")}</span>
        <span>{t("strength.col.e1rm")}</span>
      </div>
      <ul className="strength-session-exercise-list">
        {rows.map((row) => {
          const expanded = open.has(row.key);
          const hasWeight = row.sets.some((set) => set.weightKg > 0);
          const hasE1rm = row.sets.some((set) => set.e1rmKg > 0);
          const hasRest = row.sets.some((set) => set.restSec > 0);
          const hasReps = row.sets.some((set) => !set.timed);
          const hasTime = row.sets.some((set) => set.timed);
          const hasRpe = row.sets.some((set) => set.rpe !== undefined);
          const hasLoad = showLoad && row.sets.some((set) => set.heracles !== undefined);
          const group = groupRecords(row.records)[0];
          const panelId = `strength-session-exercise-${row.key}`;
          return (
            <li key={row.key} className="strength-session-exercise" data-open={expanded || undefined}>
              <div className="strength-session-exercise-head">
                <button
                  type="button"
                  className="strength-session-exercise-toggle"
                  aria-expanded={expanded}
                  aria-controls={panelId}
                  onClick={() => toggle(row.key)}
                >
                  <ChevronRight className="strength-session-exercise-chevron" size={15} aria-hidden="true" />
                  <span className="strength-session-exercise-name">
                    <strong>{exerciseLabel(row.name)}</strong>
                    {group ? (
                      <span className="strength-session-record-badge" title={t("strength.record.badgeTitle")}>
                        <Trophy size={10} aria-hidden="true" />
                        {t("strength.pr")}
                      </span>
                    ) : null}
                  </span>
                  <span className="strength-session-exercise-facts">
                    {plural("strength.sets", row.sets.length)}
                    {row.reps > 0 || !hasTime ? ` · ${plural("strength.reps", row.reps)}` : null}
                    {hasTime && !hasReps ? ` · ${formatSeconds(row.timedSec)}` : null}
                  </span>
                  <span className="strength-session-exercise-top">
                    {row.topSet
                      ? `${formatLiftWeight(row.topSet.weightKg, unitSystem)} × ${row.topSet.reps}`
                      : t("strength.bodyweight")}
                    {group?.weight && !group.e1rm ? <RecordGain record={group.weight} unitSystem={unitSystem} /> : null}
                  </span>
                  <span className="strength-session-exercise-e1rm">
                    {row.bestE1rmKg > 0
                      ? formatLiftWeight(Math.round(row.bestE1rmKg * 10) / 10, unitSystem)
                      : "—"}
                    {group?.e1rm ? <RecordGain record={group.e1rm} unitSystem={unitSystem} /> : null}
                  </span>
                </button>
                {explorable.has(row.name) ? (
                  <button
                    type="button"
                    className="strength-session-exercise-explore"
                    aria-label={t("strength.explore", { name: exerciseLabel(row.name) })}
                    title={t("strength.exploreTitle")}
                    onClick={() => onOpenExercise(row.name)}
                  >
                    <ArrowUpRight size={14} aria-hidden="true" />
                  </button>
                ) : (
                  <span className="strength-session-exercise-explore is-placeholder" aria-hidden="true" />
                )}
              </div>

              {expanded ? (
                <div className="strength-session-exercise-sets" id={panelId}>
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">{t("strength.col.set")}</th>
                        {hasReps ? <th scope="col">{t("strength.col.reps")}</th> : null}
                        {hasTime ? <th scope="col">{t("strength.col.time")}</th> : null}
                        {hasWeight ? <th scope="col">{t("strength.col.weight")}</th> : null}
                        {hasE1rm ? <th scope="col">{t("strength.col.e1rm")}</th> : null}
                        {hasRest ? <th scope="col">{t("strength.col.rest")}</th> : null}
                        {hasRpe ? <th scope="col">{t("strength.col.rpe")}</th> : null}
                        {hasLoad ? <th scope="col">{t("strength.col.load")}</th> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {row.sets.map((set, index) => {
                        const tag = setTypeTag(set.type);
                        return (
                          <tr key={index} data-type={set.type}>
                            <td>
                              {tag ? (
                                <abbr className="strength-session-set-tag" title={tag.label}>
                                  {tag.tag}
                                </abbr>
                              ) : (
                                index + 1
                              )}
                            </td>
                            {hasReps ? <td>{set.timed ? "—" : set.reps}</td> : null}
                            {hasTime ? <td>{set.timed ? formatSeconds(set.workSec) : "—"}</td> : null}
                            {hasWeight ? (
                              <td>{set.weightKg > 0 ? formatLiftWeight(set.weightKg, unitSystem) : "—"}</td>
                            ) : null}
                            {hasE1rm ? (
                              <td>{set.e1rmKg > 0 ? formatLiftWeight(Math.round(set.e1rmKg * 10) / 10, unitSystem) : "—"}</td>
                            ) : null}
                            {hasRest ? <td>{set.restSec > 0 ? formatSeconds(set.restSec) : "—"}</td> : null}
                            {hasRpe ? <td>{set.rpe ?? "—"}</td> : null}
                            {hasLoad ? (
                              <td title={set.heracles ? setLoadTitle(set.heracles) : undefined}>
                                {set.heracles ? formatDecimal(set.heracles.load, 1) : "—"}
                              </td>
                            ) : null}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </>
  );
}

/**
 * The detail pane is assembled in StrengthView from the pieces below, around a
 * body map that keeps one position in the tree. Swapping between a session and
 * "All sessions" then swaps the header and leaves the WebGL figure mounted
 * instead of rebuilding its renderer and reloading the model.
 *
 * **The two headers are one band of one fixed height.** The session header
 * used to grow with its stats and with a row per record, so the body map under
 * it jumped some 450px between "All sessions" and a session. Both are the same
 * box now (`.strength-session-detail-head`): a title line, then one row of
 * figures, every figure with a caption line whether it has a caption or not.
 * Records moved out of it, into the exercise rows they belong to.
 */

interface StrengthSessionHeaderProps {
  entry: SessionAnalytics;
  showSource: boolean;
  /** Back to the window as a whole; the band's way out of a session. */
  onShowAll: () => void;
  /** Asks Coach about this session, as the Calendar's Ask Coach does. */
  onAskCoach?: (request: CoachOpenRequest) => void;
}

/** What the session was and how much work it held. */
export function StrengthSessionHeader({ entry, showSource, onShowAll, onAskCoach }: StrengthSessionHeaderProps) {
  const { unitSystem } = useUnitSystem();
  const { source: loadSource } = useLoadSource();
  const { session } = entry;
  const stats = useMemo(() => buildSessionStats(session), [session]);
  const recordCount = useMemo(() => groupRecords(entry.records).length, [entry.records]);
  const source = showSource ? sessionSourceLabel(session) : undefined;

  return (
    <header className="panel strength-card strength-session-detail-head">
      <div className="strength-session-detail-title-row">
        <div className="strength-session-detail-title">
          <p className="eyebrow strength-session-crumb">
            <button type="button" onClick={onShowAll}>
              <ChevronLeft size={13} aria-hidden="true" />
              {t("strength.allSessions")}
            </button>
            <span aria-hidden="true">/</span>
            <span>
              {formatSessionDate(session.startTime)}
              {source ? ` · ${source}` : ""}
            </span>
          </p>
          <h3>{session.name?.trim() || t("strength.untitled")}</h3>
        </div>
        <div className="strength-session-detail-actions">
          <RecordChip count={recordCount} target={EXERCISES_ID} />
          {onAskCoach ? (
            <button
              type="button"
              className="ghost-button activity-ask-coach"
              onClick={() =>
                onAskCoach(
                  activityCoachRequest(
                    {
                      // A session only Hevy knows has no COROS id for Coach's tools.
                      activityId: session.sourceIds?.coros ?? (session.source === "hevy" ? undefined : session.activityId),
                      name: session.name,
                      sportName: session.sportName ?? t("nav.strength"),
                      sportType: session.sportType,
                      startTime: session.startTime,
                      duration: session.duration
                    },
                    unitSystem
                  )
                )
              }
            >
              <MessageCircle size={15} aria-hidden="true" />
              {t("activity.askCoach")}
            </button>
          ) : null}
        </div>
      </div>

      <div className="strength-session-stats">
        <Stat label={t("activity.m.duration")} value={formatSpan(stats.durationSec)} />
        <Stat
          label={t("strength.stat.workingSets")}
          value={String(stats.workingSets)}
          caption={
            stats.warmupSets > 0
              ? t("strength.stat.warmups", { count: stats.warmupSets })
              : plural("strength.reps", stats.reps)
          }
        />
        <Stat
          label={t("strength.summary.lifted")}
          value={stats.volumeKg > 0 ? formatTotalWeight(stats.volumeKg, unitSystem) : t("strength.bodyweight")}
        />
        {stats.avgHr !== undefined ? (
          <Stat
            label={t("activity.m.heartRate")}
            value={`${Math.round(stats.avgHr)} bpm`}
            caption={
              stats.maxHr !== undefined
                ? t("strength.stat.max", { value: Math.round(stats.maxHr) })
                : t("strength.stat.average")
            }
          />
        ) : null}
        <LoadStat stats={stats} source={loadSource} unitSystem={unitSystem} />
        {stats.calories !== undefined ? (
          <Stat label={t("activity.m.calories")} value={`${formatCount(Math.round(stats.calories))} kcal`} />
        ) : null}
      </div>
    </header>
  );
}

export interface WindowStat {
  key: string;
  label: string;
  value: string;
  caption: string;
}

interface StrengthAggregateHeaderProps {
  /** The window's short label, e.g. "3 months". */
  windowLabel: string;
  stats: WindowStat[];
  /** Lifts that set a record in the window. */
  recordCount: number;
}

/** The window as a whole: the same band as a session's, with the window's totals. */
export function StrengthAggregateHeader({ windowLabel, stats, recordCount }: StrengthAggregateHeaderProps) {
  return (
    <header className="panel strength-card strength-session-detail-head is-window">
      <div className="strength-session-detail-title-row">
        <div className="strength-session-detail-title">
          <p className="eyebrow">{windowLabel}</p>
          <h3>{t("strength.allSessions")}</h3>
        </div>
        <div className="strength-session-detail-actions">
          <RecordChip count={recordCount} target={RECORDS_ID} />
        </div>
      </div>
      <div className="strength-session-stats">
        {stats.map((stat) => (
          <Stat key={stat.key} label={stat.label} value={stat.value} caption={stat.caption} />
        ))}
      </div>
    </header>
  );
}

/**
 * How much of a partly attributed session the map could place. A session with
 * no attribution at all says so inside the muscle panel instead, and one fully
 * attributed needs no note.
 */
export function StrengthSessionCoverage({ entry }: { entry: SessionAnalytics }) {
  const { attributed, generic, unmapped, working } = entry.coverage;
  if (attributed <= 0 || attributed >= working) {
    return null;
  }
  const left = [
    generic > 0 ? t("strength.coverage.generic", { count: generic }) : "",
    unmapped > 0 ? t("strength.coverage.unmapped", { count: unmapped }) : ""
  ].filter(Boolean);
  return (
    <p className="strength-notice is-attribution" role="note">
      <Info size={15} aria-hidden="true" />
      <span>
        {plural("strength.coverage.note", working - attributed, {
          attributed,
          working,
          reasons: new Intl.ListFormat(getIntlLocale(), { type: "conjunction" }).format(left)
        })}
      </span>
    </p>
  );
}

interface StrengthSessionExercisesProps {
  entry: SessionAnalytics;
  /** Exercise names the Exercise Explorer has a history for. */
  explorable: ReadonlySet<string>;
  onOpenExercise: (name: string) => void;
}

/**
 * Every exercise in the session, with its sets — and the session's records,
 * each on the row of the lift that set it, by how far it moved the estimated
 * max. The pace of the work (density, work to rest) heads the card, since it
 * describes the exercises rather than the session's size.
 */
export function StrengthSessionExercises({
  entry,
  explorable,
  onOpenExercise
}: StrengthSessionExercisesProps) {
  const { unitSystem } = useUnitSystem();
  const { source: loadSource } = useLoadSource();
  const rows = useMemo(() => buildExerciseRows(entry), [entry]);
  const stats = useMemo(() => buildSessionStats(entry.session), [entry.session]);

  return (
    <section id={EXERCISES_ID} className="panel strength-card strength-session-exercise-card">
      <div className="strength-card-head">
        <div>
          <h3>{t("strength.exercises.title")}</h3>
          <p>{plural("strength.exercises.count", rows.length)}</p>
        </div>
        <dl className="strength-session-pace">
          {stats.densityKgPerMin !== undefined ? (
            <div>
              <dt>{t("strength.stat.density")}</dt>
              <dd>{`${formatLiftWeight(Math.round(stats.densityKgPerMin), unitSystem)}/min`}</dd>
            </div>
          ) : null}
          {stats.restPerWork !== undefined ? (
            <div title={t("strength.stat.workRestCaption")}>
              <dt>{t("strength.stat.workRest")}</dt>
              <dd>{`1 : ${formatDecimal(stats.restPerWork, 1)}`}</dd>
            </div>
          ) : null}
        </dl>
      </div>
      {rows.length === 0 ? (
        <p className="strength-empty">{t("strength.exercises.none")}</p>
      ) : (
        <ExerciseTable
          key={entry.session.activityId}
          rows={rows}
          explorable={explorable}
          onOpenExercise={onOpenExercise}
          unitSystem={unitSystem}
          showLoad={loadSource === "heracles"}
        />
      )}
    </section>
  );
}

interface StrengthAggregateRecordsProps {
  sessions: StrengthSession[];
  index: StrengthSessionIndex;
  windowPhrase: string;
  onSelectSession: (activityId: string) => void;
}

/**
 * Every record set in the window, a line per session, newest first; each opens
 * the session that set it. A record is stated by the figure it moved and how
 * far — "Squats 130.7 kg +2.4 kg" — rather than as a heaviest set and an
 * estimated max each beside what it was.
 */
export function StrengthAggregateRecords({
  sessions,
  index,
  windowPhrase,
  onSelectSession
}: StrengthAggregateRecordsProps) {
  const { unitSystem } = useUnitSystem();
  const [showAll, setShowAll] = useState(false);
  const recordSessions = useMemo(
    () =>
      [...sessions]
        .sort((a, b) => (b.startTime ?? 0) - (a.startTime ?? 0))
        .map((session) => ({
          session,
          groups: groupRecords(index.byId.get(session.activityId)?.records ?? [])
        }))
        .filter((entry) => entry.groups.length > 0),
    [index, sessions]
  );
  const shown = showAll ? recordSessions : recordSessions.slice(0, RECORD_SESSIONS_SHOWN);

  return (
    <section id={RECORDS_ID} className="panel strength-card">
      <div className="strength-card-head">
        <div>
          <h3>{t("strength.records.title")}</h3>
          <p>{t("strength.records.sub", { window: windowPhrase })}</p>
        </div>
      </div>
      {recordSessions.length === 0 ? (
        <p className="strength-empty">{t("strength.records.none")}</p>
      ) : (
        <>
          <ul className="strength-record-sessions">
            {shown.map(({ session, groups }) => (
              <li key={session.activityId}>
                <button type="button" onClick={() => onSelectSession(session.activityId)}>
                  <span className="strength-record-when">
                    <strong>{formatSessionDate(session.startTime)}</strong>
                    <span>{session.name?.trim() || t("strength.untitled")}</span>
                  </span>
                  <span className="strength-record-lifts">
                    {groups.map((group) => {
                      const record = headlineRecord(group);
                      if (!record) return null;
                      return (
                        <span className="strength-record-lift" key={group.exercise}>
                          <strong>{exerciseLabel(group.exercise)}</strong>
                          <span>{formatLiftWeight(Math.round(record.valueKg * 10) / 10, unitSystem)}</span>
                          <RecordGain record={record} unitSystem={unitSystem} />
                        </span>
                      );
                    })}
                  </span>
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
          {recordSessions.length > RECORD_SESSIONS_SHOWN ? (
            <button type="button" className="strength-action strength-record-more" onClick={() => setShowAll((value) => !value)}>
              {showAll
                ? t("strength.records.showFewer")
                : t("strength.records.showAll", { count: recordSessions.length })}
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}
