import type { ReactNode } from "react";
import { renderRich } from "../i18n/useI18n";
import { exerciseLabel } from "./strengthAnalytics";
import { useMemo, useState } from "react";
import { ArrowUpRight, ChevronRight, Info, MessageCircle, Trophy } from "lucide-react";
import type { CoachOpenRequest, StrengthSession, UnitSystem } from "../../electron/types";
import { activityCoachRequest } from "../training/askCoachAbout";
import { useUnitSystem } from "../units/UnitSystemProvider";
import {
  buildExerciseRows,
  buildSessionStats,
  type SessionAnalytics,
  type SessionExerciseRow,
  type SessionPersonalRecord,
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

/** A lift's heaviest-set and estimated-max records read as one line, not two. */
function groupRecords(records: SessionPersonalRecord[]): RecordGroup[] {
  const groups = new Map<string, RecordGroup>();
  for (const record of records) {
    const group = groups.get(record.exercise) ?? { exercise: record.exercise };
    group[record.kind] = record;
    groups.set(record.exercise, group);
  }
  return [...groups.values()];
}

const RECORD_TAGS = {
  b: (chunk: ReactNode) => <strong>{chunk}</strong>,
  em: (chunk: ReactNode) => <em>{chunk}</em>
};

function RecordFigures({ group, unitSystem }: { group: RecordGroup; unitSystem: UnitSystem }) {
  return (
    <span className="strength-session-record-figures">
      {group.weight ? (
        <span>
          {renderRich(
            t("strength.record.heaviest", {
              value: formatLiftWeight(group.weight.valueKg, unitSystem),
              previous: formatLiftWeight(group.weight.previousKg, unitSystem)
            }),
            RECORD_TAGS
          )}
        </span>
      ) : null}
      {group.e1rm ? (
        <span>
          {renderRich(
            t("strength.record.e1rm", {
              value: formatLiftWeight(group.e1rm.valueKg, unitSystem),
              previous: formatLiftWeight(group.e1rm.previousKg, unitSystem)
            }),
            RECORD_TAGS
          )}
        </span>
      ) : null}
    </span>
  );
}

function Stat({ label, value, caption }: { label: string; value: string; caption?: string }) {
  return (
    <div className="strength-session-stat">
      <span>{label}</span>
      <strong>{value}</strong>
      {caption ? <em>{caption}</em> : null}
    </div>
  );
}

function formatRest(seconds: number): string {
  const total = Math.round(seconds);
  if (total < 60) return `${total} s`;
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

interface ExerciseTableProps {
  rows: SessionExerciseRow[];
  explorable: ReadonlySet<string>;
  onOpenExercise: (name: string) => void;
  unitSystem: UnitSystem;
}

function ExerciseTable({ rows, explorable, onOpenExercise, unitSystem }: ExerciseTableProps) {
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
    <ul className="strength-session-exercise-list">
      {rows.map((row) => {
        const expanded = open.has(row.key);
        const hasWeight = row.sets.some((set) => set.weightKg > 0);
        const hasE1rm = row.sets.some((set) => set.e1rmKg > 0);
        const hasRest = row.sets.some((set) => set.restSec > 0);
        const hasRpe = row.sets.some((set) => set.rpe !== undefined);
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
                  {row.records.length > 0 ? (
                    <span className="strength-session-record-badge" title={t("strength.record.badgeTitle")}>
                      <Trophy size={10} aria-hidden="true" />
                      {t("strength.pr")}
                    </span>
                  ) : null}
                </span>
                <span className="strength-session-exercise-facts">
                  {plural("strength.sets", row.sets.length)} · {plural("strength.reps", row.reps)}
                </span>
                <span className="strength-session-exercise-top">
                  {row.topSet
                    ? `${formatLiftWeight(row.topSet.weightKg, unitSystem)} × ${row.topSet.reps}`
                    : t("strength.bodyweight")}
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
              ) : null}
            </div>

            {expanded ? (
              <div className="strength-session-exercise-sets" id={panelId}>
                <table>
                  <thead>
                    <tr>
                      <th scope="col">{t("strength.col.set")}</th>
                      <th scope="col">{t("strength.col.reps")}</th>
                      {hasWeight ? <th scope="col">{t("strength.col.weight")}</th> : null}
                      {hasE1rm ? <th scope="col">{t("strength.col.e1rm")}</th> : null}
                      {hasRest ? <th scope="col">{t("strength.col.rest")}</th> : null}
                      {hasRpe ? <th scope="col">{t("strength.col.rpe")}</th> : null}
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
                          <td>{set.reps}</td>
                          {hasWeight ? (
                            <td>{set.weightKg > 0 ? formatLiftWeight(set.weightKg, unitSystem) : "—"}</td>
                          ) : null}
                          {hasE1rm ? (
                            <td>{set.e1rmKg > 0 ? formatLiftWeight(Math.round(set.e1rmKg * 10) / 10, unitSystem) : "—"}</td>
                          ) : null}
                          {hasRest ? <td>{set.restSec > 0 ? formatRest(set.restSec) : "—"}</td> : null}
                          {hasRpe ? <td>{set.rpe ?? "—"}</td> : null}
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
  );
}

/**
 * The detail pane is assembled in StrengthView from the pieces below, around a
 * body map that keeps one position in the tree. Swapping between a session and
 * "All sessions" then swaps the header and the body, and leaves the WebGL figure
 * mounted instead of rebuilding its renderer and reloading the model.
 */

interface StrengthSessionHeaderProps {
  entry: SessionAnalytics;
  showSource: boolean;
  /** Asks Coach about this session, as the Calendar's Ask Coach does. */
  onAskCoach?: (request: CoachOpenRequest) => void;
}

/** What the session was, how much work it held, and the records it set. */
export function StrengthSessionHeader({ entry, showSource, onAskCoach }: StrengthSessionHeaderProps) {
  const { unitSystem } = useUnitSystem();
  const { session } = entry;
  const stats = useMemo(() => buildSessionStats(session), [session]);
  const recordGroups = useMemo(() => groupRecords(entry.records), [entry.records]);
  const source = showSource ? sessionSourceLabel(session) : undefined;

  return (
    <header className="panel strength-card strength-session-detail-head">
      <div className="strength-session-detail-title-row">
        <div>
          <p className="eyebrow">
            {formatSessionDate(session.startTime)}
            {source ? ` · ${source}` : ""}
          </p>
          <h3>{session.name?.trim() || t("strength.untitled")}</h3>
        </div>
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
        {stats.densityKgPerMin !== undefined ? (
          <Stat
            label={t("strength.stat.density")}
            value={`${formatLiftWeight(Math.round(stats.densityKgPerMin), unitSystem)}/min`}
          />
        ) : null}
        {stats.restPerWork !== undefined ? (
          <Stat
            label={t("strength.stat.workRest")}
            value={`1 : ${formatDecimal(stats.restPerWork, 1)}`}
            caption={t("strength.stat.workRestCaption")}
          />
        ) : null}
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
        {stats.trainingLoad !== undefined ? (
          <Stat label={t("activity.m.trainingLoad")} value={String(Math.round(stats.trainingLoad))} />
        ) : null}
        {stats.calories !== undefined ? (
          <Stat label={t("activity.m.calories")} value={`${formatCount(Math.round(stats.calories))} kcal`} />
        ) : null}
      </div>

      {recordGroups.length > 0 ? (
        <ul className="strength-session-records" aria-label={t("strength.recordsSet")}>
          {recordGroups.map((group) => (
            <li key={group.exercise}>
              <Trophy size={14} aria-hidden="true" />
              <strong>{exerciseLabel(group.exercise)}</strong>
              <RecordFigures group={group} unitSystem={unitSystem} />
            </li>
          ))}
        </ul>
      ) : null}
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

/** Every exercise in the session, with its sets. */
export function StrengthSessionExercises({
  entry,
  explorable,
  onOpenExercise
}: StrengthSessionExercisesProps) {
  const { unitSystem } = useUnitSystem();
  const rows = useMemo(() => buildExerciseRows(entry), [entry]);

  return (
    <section className="panel strength-card strength-session-exercise-card">
      <div className="strength-card-head">
        <div>
          <h3>{t("strength.exercises.title")}</h3>
          <p>{plural("strength.exercises.count", rows.length)}</p>
        </div>
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
        />
      )}
    </section>
  );
}

interface StrengthAggregateHeaderProps {
  sessionCount: number;
  windowLabel: string;
  windowPhrase: string;
}

export function StrengthAggregateHeader({
  sessionCount,
  windowLabel,
  windowPhrase
}: StrengthAggregateHeaderProps) {
  return (
    <header className="panel strength-card strength-session-detail-head">
      <p className="eyebrow">{windowLabel}</p>
      <h3>{t("strength.allSessions")}</h3>
      <p className="strength-session-detail-sub">
        {plural("strength.aggregate.sub", sessionCount, { window: windowPhrase })}
      </p>
    </header>
  );
}

interface StrengthAggregateRecordsProps {
  sessions: StrengthSession[];
  index: StrengthSessionIndex;
  windowPhrase: string;
  onSelectSession: (activityId: string) => void;
}

/** Every record set in the window, newest first; each opens the session that set it. */
export function StrengthAggregateRecords({
  sessions,
  index,
  windowPhrase,
  onSelectSession
}: StrengthAggregateRecordsProps) {
  const { unitSystem } = useUnitSystem();
  const recordRows = useMemo(
    () =>
      [...sessions]
        .sort((a, b) => (b.startTime ?? 0) - (a.startTime ?? 0))
        .flatMap((session) =>
          groupRecords(index.byId.get(session.activityId)?.records ?? []).map((group) => ({
            session,
            group
          }))
        ),
    [index, sessions]
  );

  return (
    <section className="panel strength-card strength-session-records-card">
      <div className="strength-card-head">
        <div>
          <h3>{t("strength.records.title")}</h3>
          <p>{t("strength.records.sub", { window: windowPhrase })}</p>
        </div>
      </div>
      {recordRows.length === 0 ? (
        <p className="strength-empty">
          {t("strength.records.none")}
        </p>
      ) : (
        <ul className="strength-session-records is-list">
          {recordRows.map(({ session, group }) => (
            <li key={`${session.activityId}-${group.exercise}`}>
              <button type="button" onClick={() => onSelectSession(session.activityId)}>
                <Trophy size={14} aria-hidden="true" />
                <strong>{exerciseLabel(group.exercise)}</strong>
                <RecordFigures group={group} unitSystem={unitSystem} />
                <span className="strength-session-record-date">
                  {formatSessionDate(session.startTime)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
