import type { HeraclesLoad, StrengthDetail } from "../../../electron/types";
import { formatDurationSeconds, formatOptionalNumber } from "../formatters";
import { resolveExerciseName } from "../exerciseNames";
import { useUnitSystem } from "../../units/UnitSystemProvider";
import { formatVolumeKg, formatWeightKg } from "../../strength/strengthAnalytics";
import { formatCount, formatDecimal, t } from "../../i18n/core";
import { loadPairTitle } from "../loadFigures";
import { useLoadSource } from "../loadSource";

function StatTile({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="activity-detail-stat" title={title}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function restLabel(seconds: number): string {
  return seconds > 0 ? formatDurationSeconds(seconds) : "—";
}

// Resolve a display name, falling back to a generic "Exercise N" label when the
// key is still an unresolved COROS code (rare: an exercise absent from both the
// catalogue dictionary and the body-region table).
function displayExerciseName(
  nameKey: string,
  rawName: string | undefined,
  index: number
): string {
  const resolved = resolveExerciseName(nameKey, rawName);
  return /^[TS]\d/.test(resolved) ? `Exercise ${index + 1}` : resolved;
}

/** `heraclesLoad` is the list row's: COROS's detail does not carry it. */
export function StrengthDetailPanel({ strength, heraclesLoad }: { strength: StrengthDetail; heraclesLoad?: HeraclesLoad }) {
  const { unitSystem } = useUnitSystem();
  const { source } = useLoadSource();
  const { summary, exercises } = strength;
  const heracles = source === "heracles" ? heraclesLoad : undefined;
  const load = heracles?.value ?? summary.trainingLoad;
  return (
    <div className="strength-detail">
      <div className="activity-detail-grid">
        <StatTile label={t("activity.strength.sets")} value={formatCount(summary.sets)} />
        <StatTile label={t("activity.strength.reps")} value={formatCount(summary.totalReps)} />
        <StatTile label={t("activity.strength.totalWeight")} value={formatVolumeKg(summary.totalWeightKg, unitSystem)} />
        <StatTile label={t("activity.m.calories")} value={formatCount(summary.calories)} />
        <StatTile label={t("activity.m.duration")} value={formatDurationSeconds(summary.durationSec)} />
        {summary.avgHr !== undefined ? (
          <StatTile label={t("activity.m.avgHr")} value={formatOptionalNumber(summary.avgHr)} />
        ) : null}
        {summary.maxHr !== undefined ? (
          <StatTile label={t("activity.m.maxHr")} value={formatOptionalNumber(summary.maxHr)} />
        ) : null}
        {load !== undefined ? (
          <StatTile
            label={t("activity.m.trainingLoad")}
            value={formatOptionalNumber(Math.round(load))}
            title={loadPairTitle(source, heracles?.value, summary.trainingLoad, heracles?.quality)}
          />
        ) : null}
        {summary.aerobicEffect !== undefined ? (
          <StatTile label={t("activity.strength.aerobic")} value={formatDecimal(summary.aerobicEffect, 1)} />
        ) : null}
        {summary.anaerobicEffect !== undefined ? (
          <StatTile label={t("activity.strength.anaerobic")} value={formatDecimal(summary.anaerobicEffect, 1)} />
        ) : null}
      </div>

      <div className="strength-exercise-list">
        {exercises.map((exercise, index) => (
          <section
            className="strength-exercise"
            key={`${exercise.nameKey}-${index}`}
          >
            <h3 className="strength-exercise-head">
              <span className="strength-exercise-name">
                {index + 1}. {displayExerciseName(exercise.nameKey, exercise.rawName, index)}
              </span>
              <span className="strength-exercise-meta">
                {t("activity.strength.setsReps", { sets: exercise.sets, reps: exercise.totalReps })}
              </span>
            </h3>
            <div className="table-shell">
              <table>
                <thead>
                  <tr>
                    <th>{t("activity.strength.set")}</th>
                    <th>{t("activity.strength.reps")}</th>
                    <th>{t("activity.strength.weight")}</th>
                    <th>{t("activity.m.time")}</th>
                    <th>{t("activity.strength.rest")}</th>
                    <th>{t("activity.strength.cal")}</th>
                  </tr>
                </thead>
                <tbody>
                  {exercise.entries.map((entry, setIndex) => (
                    <tr key={setIndex}>
                      <td>{setIndex + 1}</td>
                      <td>{entry.reps}</td>
                      <td>{entry.weightKg > 0 ? formatWeightKg(entry.weightKg, unitSystem) : "—"}</td>
                      <td>{formatDurationSeconds(entry.workSec)}</td>
                      <td>{restLabel(entry.restSec)}</td>
                      <td>{entry.calories}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
