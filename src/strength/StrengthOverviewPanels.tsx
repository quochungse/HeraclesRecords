import { useMemo } from "react";
import { ArrowDownRight, ArrowUpRight, ChevronRight, Search } from "lucide-react";
import { useUnitSystem } from "../units/UnitSystemProvider";
import {
  formatSets,
  type ExerciseStat,
  type StrengthAnalytics
} from "./strengthAnalytics";
import { formatLiftWeight, liftWeightParts } from "./strengthFormat";

/**
 * Lifts shown in the main-lift list. Five keeps that card roughly level with
 * the movement mix beside it; six left the right-hand column ending well
 * short of the left.
 */
const MAX_MAIN_LIFTS = 5;

/** Course of one lift's estimated max, drawn small enough to read as texture. */
function Sparkline({
  values,
  tone,
  record = false
}: {
  values: number[];
  tone: string;
  /** True when the newest point is also the lift's best — that dot earns gold. */
  record?: boolean;
}) {
  const width = 112;
  const height = 34;
  const pad = 5;

  const path = useMemo(() => {
    if (values.length < 2) {
      return null;
    }
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const step = (width - pad * 2) / (values.length - 1);
    return values.map((value, index) => ({
      x: pad + index * step,
      y: height - pad - ((value - min) / span) * (height - pad * 2)
    }));
  }, [values]);

  if (!path) {
    return <span className="strength-spark is-empty" aria-hidden="true" />;
  }

  const first = path[0]!;
  const last = path[path.length - 1]!;
  const area = [
    `M ${first.x} ${first.y}`,
    ...path.slice(1).map((point) => `L ${point.x} ${point.y}`),
    `L ${last.x} ${height}`,
    `L ${first.x} ${height}`,
    "Z"
  ].join(" ");
  return (
    <svg
      className="strength-spark"
      data-tone={tone}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
    >
      <path className="strength-spark-area" d={area} />
      <polyline points={path.map((point) => `${point.x},${point.y}`).join(" ")} />
      <circle
        className={record ? "strength-spark-record" : undefined}
        cx={last.x}
        cy={last.y}
        r={2.6}
      />
    </svg>
  );
}

interface StrengthOverviewPanelsProps {
  analytics: StrengthAnalytics;
  onOpenExercise: (name: string) => void;
}

/** The main lifts and where the work went, side by side under the weekly chart. */
export function StrengthOverviewPanels({
  analytics,
  onOpenExercise
}: StrengthOverviewPanelsProps) {
  const { unitSystem } = useUnitSystem();

  /**
   * Ranked by the work each lift actually took, not by how many times it was
   * performed: counting sets floats side bends and calf raises above the bench
   * press, which is not what anyone means by a main lift.
   */
  const mainLifts = useMemo(
    () =>
      analytics.exercises
        .filter((exercise: ExerciseStat) => exercise.bestE1rmKg > 0)
        .sort((a, b) => b.volumeKg - a.volumeKg)
        .slice(0, MAX_MAIN_LIFTS),
    [analytics.exercises]
  );

  const balanceTotal =
    analytics.balance.push +
    analytics.balance.pull +
    analytics.balance.legs +
    analytics.balance.core;

  const balanceSegments = (
    [
      ["push", "Pushing"],
      ["pull", "Pulling"],
      ["legs", "Legs"],
      ["core", "Core"]
    ] as const
  ).map(([key, label]) => ({
    key,
    label,
    share: balanceTotal > 0 ? analytics.balance[key] / balanceTotal : 0
  }));

  return (
    <div className="strength-columns">
      <section className="panel strength-card strength-lifts-card">
        <div className="strength-card-head">
          <div>
            <h3>Your main lifts</h3>
            <p>
              The most you could lift for one rep, estimated from your best
              set.
            </p>
          </div>
          {analytics.exercises.length > 0 ? (
            <button
              type="button"
              className="strength-explore-all"
              onClick={() =>
                onOpenExercise(mainLifts[0]?.name ?? analytics.exercises[0]!.name)
              }
            >
              <Search size={13} aria-hidden="true" />
              Explore all
            </button>
          ) : null}
        </div>

        {mainLifts.length === 0 ? (
          <p className="strength-empty">
            Nothing to estimate yet — this needs sets with weight on them.
          </p>
        ) : (
          <ul className="strength-lift-list">
            {mainLifts.map((lift) => {
              const trend = lift.e1rmTrendKg;
              const tone =
                trend === undefined
                  ? "flat"
                  : trend > 0.5
                    ? "up"
                    : trend < -0.5
                      ? "down"
                      : "flat";
              const loaded = lift.history.filter(
                (point) => point.e1rmKg > 0
              );
              const latest = loaded[loaded.length - 1];
              const onRecord =
                latest !== undefined &&
                latest.e1rmKg >= lift.bestE1rmKg - 1e-6;
              const best = liftWeightParts(lift.bestE1rmKg, unitSystem)[0]!;
              return (
                <li key={lift.name} className="is-interactive">
                  <button
                    type="button"
                    className="strength-lift-button"
                    aria-label={`Explore ${lift.name}`}
                    onClick={() => onOpenExercise(lift.name)}
                  >
                    <div className="strength-lift-main">
                      <span className="strength-lift-name">{lift.name}</span>
                      <span className="strength-lift-meta">
                        {lift.sessions} session
                        {lift.sessions === 1 ? "" : "s"} ·{" "}
                        {formatSets(lift.sets)} sets
                      </span>
                    </div>
                    <Sparkline
                      values={loaded.map((point) => point.e1rmKg)}
                      tone={tone}
                      record={onRecord}
                    />
                    <div className="strength-lift-figures">
                      <strong>
                        {best.value}
                        {best.unit ? <em>{best.unit}</em> : null}
                      </strong>
                      <span className="strength-lift-change" data-tone={tone}>
                        {trend === undefined ? (
                          "One session"
                        ) : tone === "flat" ? (
                          "No change"
                        ) : (
                          <>
                            {tone === "up" ? (
                              <ArrowUpRight size={12} aria-hidden="true" />
                            ) : (
                              <ArrowDownRight size={12} aria-hidden="true" />
                            )}
                            {formatLiftWeight(Math.abs(trend), unitSystem)}
                          </>
                        )}
                      </span>
                    </div>
                    <ChevronRight
                      className="strength-lift-open-icon"
                      size={15}
                      aria-hidden="true"
                    />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="panel strength-card strength-mix-card">
        <div className="strength-card-head">
          <div>
            <h3>Where the work went</h3>
            <p>Share of your working sets.</p>
          </div>
        </div>

        {balanceTotal <= 0 ? (
          <p className="strength-empty">
            Nothing to sort yet — sets appear here once we recognise the
            exercise.
          </p>
        ) : (
          <>
            <div className="strength-mix-bar" aria-hidden="true">
              {balanceSegments
                .filter((segment) => segment.share > 0)
                .map((segment) => (
                  <span
                    key={segment.key}
                    data-pattern={segment.key}
                    style={{ flexGrow: segment.share }}
                  />
                ))}
            </div>
            <ul className="strength-mix-legend">
              {balanceSegments.map((segment) => (
                <li key={segment.key}>
                  <i data-pattern={segment.key} aria-hidden="true" />
                  <span>{segment.label}</span>
                  <strong>{Math.round(segment.share * 100)}%</strong>
                </li>
              ))}
            </ul>
            <p className="strength-mix-note">
              Helper muscles count for part of a set, so a bench press
              mostly counts as pushing.
              {analytics.genericSets > 0
                ? " COROS Full Body sets are left out because they do not identify a specific muscle."
                : ""}
              {analytics.mobilitySets > 0 || analytics.unmappedSets > 0
                ? " Warm-ups, stretching and moves we don't recognise are left out."
                : ""}
            </p>
          </>
        )}
      </section>
    </div>
  );
}
