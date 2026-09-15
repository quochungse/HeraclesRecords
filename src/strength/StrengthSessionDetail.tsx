import { useMemo, useState } from "react";
import { ArrowUpRight, ChevronRight, Info, Trophy } from "lucide-react";
import type { StrengthSession, UnitSystem } from "../../electron/types";
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

/** Sessions this short open with every exercise's sets showing; longer ones start folded. */
const EXPANDED_EXERCISE_LIMIT = 3;

const SET_TYPE_TAGS: Record<string, { tag: string; label: string }> = {
  warmup: { tag: "W", label: "Warm-up" },
  dropset: { tag: "D", label: "Drop set" },
  failure: { tag: "F", label: "To failure" }
};

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

function RecordFigures({ group, unitSystem }: { group: RecordGroup; unitSystem: UnitSystem }) {
  return (
    <span className="strength-session-record-figures">
      {group.weight ? (
        <span>
          Heaviest set <strong>{formatLiftWeight(group.weight.valueKg, unitSystem)}</strong>
          <em>was {formatLiftWeight(group.weight.previousKg, unitSystem)}</em>
        </span>
      ) : null}
      {group.e1rm ? (
        <span>
          Est. max <strong>{formatLiftWeight(group.e1rm.valueKg, unitSystem)}</strong>
          <em>was {formatLiftWeight(group.e1rm.previousKg, unitSystem)}</em>
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
                  <strong>{row.name}</strong>
                  {row.records.length > 0 ? (
                    <span className="strength-session-record-badge" title="Beat every earlier session in the window">
                      <Trophy size={10} aria-hidden="true" />
                      PR
                    </span>
                  ) : null}
                </span>
                <span className="strength-session-exercise-facts">
                  {row.sets.length} set{row.sets.length === 1 ? "" : "s"} · {row.reps} reps
                </span>
                <span className="strength-session-exercise-top">
                  {row.topSet
                    ? `${formatLiftWeight(row.topSet.weightKg, unitSystem)} × ${row.topSet.reps}`
                    : "Bodyweight"}
                </span>
              </button>
              {explorable.has(row.name) ? (
                <button
                  type="button"
                  className="strength-session-exercise-explore"
                  aria-label={`Explore ${row.name}`}
                  title="Open in Exercise Explorer"
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
                      <th scope="col">Set</th>
                      <th scope="col">Reps</th>
                      {hasWeight ? <th scope="col">Weight</th> : null}
                      {hasE1rm ? <th scope="col">Est. max</th> : null}
                      {hasRest ? <th scope="col">Rest</th> : null}
                      {hasRpe ? <th scope="col">RPE</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {row.sets.map((set, index) => {
                      const tag = SET_TYPE_TAGS[set.type];
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
}

/** What the session was, how much work it held, and the records it set. */
export function StrengthSessionHeader({ entry, showSource }: StrengthSessionHeaderProps) {
  const { unitSystem } = useUnitSystem();
  const { session } = entry;
  const stats = useMemo(() => buildSessionStats(session), [session]);
  const recordGroups = useMemo(() => groupRecords(entry.records), [entry.records]);
  const source = showSource ? sessionSourceLabel(session) : undefined;

  return (
    <header className="panel strength-card strength-session-detail-head">
      <p className="eyebrow">
        {formatSessionDate(session.startTime)}
        {source ? ` · ${source}` : ""}
      </p>
      <h3>{session.name?.trim() || "Strength session"}</h3>

      <div className="strength-session-stats">
        <Stat label="Duration" value={formatSpan(stats.durationSec)} />
        <Stat
          label="Working sets"
          value={String(stats.workingSets)}
          caption={
            stats.warmupSets > 0
              ? `+ ${stats.warmupSets} warm-up`
              : `${stats.reps.toLocaleString()} reps`
          }
        />
        <Stat
          label="Weight lifted"
          value={stats.volumeKg > 0 ? formatTotalWeight(stats.volumeKg, unitSystem) : "Bodyweight"}
        />
        {stats.densityKgPerMin !== undefined ? (
          <Stat
            label="Density"
            value={`${formatLiftWeight(Math.round(stats.densityKgPerMin), unitSystem)}/min`}
          />
        ) : null}
        {stats.restPerWork !== undefined ? (
          <Stat
            label="Work : rest"
            value={`1 : ${stats.restPerWork.toFixed(1)}`}
            caption="Rest per second of work"
          />
        ) : null}
        {stats.avgHr !== undefined ? (
          <Stat
            label="Heart rate"
            value={`${Math.round(stats.avgHr)} bpm`}
            caption={stats.maxHr !== undefined ? `Max ${Math.round(stats.maxHr)}` : "Average"}
          />
        ) : null}
        {stats.trainingLoad !== undefined ? (
          <Stat label="Training load" value={String(Math.round(stats.trainingLoad))} />
        ) : null}
        {stats.calories !== undefined ? (
          <Stat label="Calories" value={`${Math.round(stats.calories).toLocaleString()} kcal`} />
        ) : null}
      </div>

      {recordGroups.length > 0 ? (
        <ul className="strength-session-records" aria-label="Records set in this session">
          {recordGroups.map((group) => (
            <li key={group.exercise}>
              <Trophy size={14} aria-hidden="true" />
              <strong>{group.exercise}</strong>
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
    generic > 0 ? `${generic} COROS recorded only as Full Body` : "",
    unmapped > 0 ? `${unmapped} from exercises we don't recognise` : ""
  ].filter(Boolean);
  return (
    <p className="strength-notice is-attribution" role="note">
      <Info size={15} aria-hidden="true" />
      <span>
        The map places {attributed} of {working} working sets on specific muscles. The other{" "}
        {working - attributed} {working - attributed === 1 ? "is" : "are"} left out: {left.join(", ")}.
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
          <h3>Exercises</h3>
          <p>
            {rows.length} exercise{rows.length === 1 ? "" : "s"}, in the order you did them.
          </p>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="strength-empty">This session has no sets recorded.</p>
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
      <h3>All sessions</h3>
      <p className="strength-session-detail-sub">
        {sessionCount} session{sessionCount === 1 ? "" : "s"} in {windowPhrase}, muscle by muscle.
        Pick one to see what it trained.
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
          <h3>Records</h3>
          <p>Lifts that beat every earlier session of the same exercise in {windowPhrase}.</p>
        </div>
      </div>
      {recordRows.length === 0 ? (
        <p className="strength-empty">
          None yet — a record needs an earlier session of the same lift to beat.
        </p>
      ) : (
        <ul className="strength-session-records is-list">
          {recordRows.map(({ session, group }) => (
            <li key={`${session.activityId}-${group.exercise}`}>
              <button type="button" onClick={() => onSelectSession(session.activityId)}>
                <Trophy size={14} aria-hidden="true" />
                <strong>{group.exercise}</strong>
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
