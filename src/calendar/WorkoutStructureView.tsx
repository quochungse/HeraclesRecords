import {
  ChevronDown,
  Dumbbell,
  Flame,
  Pause,
  Play,
  Repeat,
  Snowflake,
  Timer,
  Zap,
  type LucideIcon
} from "lucide-react";
import { useState } from "react";
import type { UnitSystem, WorkoutExerciseOption } from "../../electron/types";
import { POUNDS_PER_KILOGRAM, formatWeightValue } from "../units/units";
import { ExercisePreview } from "./ExercisePreview";
import {
  formatStepDistanceLabel,
  formatStepTimeLabel,
  liftSchemeLabel,
  type ScheduledNodeView,
  type ScheduledStepKind,
  type ScheduledStepView,
  type ScheduledStructureView
} from "./scheduledStructure";

/*
 * How a workout's steps are drawn, wherever they are read.
 *
 * The day drawer reads a scheduled occurrence and the Calendar's View reads a
 * library workout; the two arrive from different COROS payloads and both
 * become a `ScheduledStructureView` before they reach here, so one renderer
 * serves both. Two would drift, and the drift would be silent — neither
 * surface shows the other.
 */

const KIND_ICON: Record<ScheduledStepKind, LucideIcon> = {
  warmup: Flame,
  training: Zap,
  rest: Pause,
  cooldown: Snowflake,
  sendOff: Timer
};

const KIND_LABEL: Record<ScheduledStepKind, string> = {
  warmup: "Warm-up",
  training: "Main",
  rest: "Rest",
  cooldown: "Cool-down",
  sendOff: "Send-off"
};

const KIND_ORDER: ScheduledStepKind[] = [
  "warmup",
  "training",
  "rest",
  "cooldown",
  "sendOff"
];

function stepMagnitudeLabel(
  step: ScheduledStepView,
  unitSystem: UnitSystem,
  swim: boolean
): string | undefined {
  if (step.magnitude === undefined || !step.magnitudeType) {
    return undefined;
  }
  return step.magnitudeType === "distance"
    ? formatStepDistanceLabel(step.magnitude, unitSystem, swim)
    : formatStepTimeLabel(step.magnitude);
}

export function flatSteps(view: ScheduledStructureView): ScheduledStepView[] {
  const steps: ScheduledStepView[] = [];
  for (const node of view.nodes) {
    if (node.type === "step") {
      steps.push(node.step);
    } else {
      steps.push(...node.steps);
    }
  }
  return steps;
}

/** The strength/cardio split, so a caller only has to say which it holds. */
export function WorkoutStructure({
  view,
  unitSystem,
  strength,
  swim,
  showSummary = true,
  exercises
}: {
  view: ScheduledStructureView;
  unitSystem: UnitSystem;
  strength: boolean;
  swim: boolean;
  /**
   * The strength chip row. Off where the caller already states those figures
   * above it — the Calendar's workout view puts them in its hero, and the two
   * rows a finger apart said 9 exercises, 9 sets, twice.
   */
  showSummary?: boolean;
  /**
   * The COROS exercise catalog, keyed by id. A surface holding it can open the
   * demonstration clip for each movement; one without it draws the same rows
   * and no clips, which is why this is optional rather than required.
   */
  exercises?: ReadonlyMap<string, WorkoutExerciseOption>;
}) {
  return strength ? (
    <StrengthStructure
      view={view}
      unitSystem={unitSystem}
      showSummary={showSummary}
      exercises={exercises}
    />
  ) : (
    <CardioStructure view={view} unitSystem={unitSystem} swim={swim} />
  );
}

/* ---------------- cardio (run / ride / swim / other) ---------------- */

type ScheduledRepeatViewExtract = Extract<ScheduledNodeView, { type: "repeat" }>;

interface BarSegment {
  key: string;
  kind: ScheduledStepKind;
  grow: number;
  label: string;
}

function buildBarSegments(
  view: ScheduledStructureView,
  unitSystem: UnitSystem,
  swim: boolean
): BarSegment[] {
  const segments: BarSegment[] = [];
  const push = (step: ScheduledStepView, key: string, repeat?: number) => {
    const magnitude = stepMagnitudeLabel(step, unitSystem, swim);
    const label = [
      step.name,
      repeat && repeat > 1 ? `×${repeat}` : null,
      magnitude ?? step.targetLabel ?? null
    ]
      .filter(Boolean)
      .join(" · ");
    segments.push({ key, kind: step.kind, grow: step.magnitude ?? 0, label });
  };

  for (const node of view.nodes) {
    if (node.type === "step") {
      push(node.step, node.step.id);
    } else {
      for (let round = 0; round < node.repeat; round += 1) {
        for (const step of node.steps) {
          push(step, `${node.id}-${round}-${step.id}`, node.repeat);
        }
      }
    }
  }

  const max = Math.max(0, ...segments.map((segment) => segment.grow));
  if (max <= 0) {
    return segments.map((segment) => ({ ...segment, grow: 1 }));
  }
  // Floor tiny segments (short recoveries) so they stay visible.
  const floor = max * 0.035;
  return segments.map((segment) => ({
    ...segment,
    grow: segment.grow > 0 ? Math.max(segment.grow, floor) : floor
  }));
}

/**
 * The structure bar and its legend, shared by both halves of the split so a
 * strength session and a run draw their shape the same way. Nothing to draw
 * draws nothing — an empty track says less than no track.
 */
function StructureBar({
  view,
  segments
}: {
  view: ScheduledStructureView;
  segments: BarSegment[];
}) {
  if (segments.length === 0) return null;
  const kindsPresent = KIND_ORDER.filter((kind) =>
    view.nodes.some((node) =>
      node.type === "step"
        ? node.step.kind === kind
        : node.steps.some((step) => step.kind === kind)
    )
  );

  return (
    <>
      <div
        className="sched-bar"
        role="img"
        aria-label={`Workout structure: ${segments
          .map((segment) => segment.label)
          .join(", ")}`}
      >
        {segments.map((segment) => (
          <span
            key={segment.key}
            className={`sched-bar-segment is-${segment.kind}`}
            style={{ flexGrow: segment.grow }}
            title={segment.label}
          />
        ))}
      </div>
      {kindsPresent.length > 1 ? (
        <div className="sched-legend" aria-hidden="true">
          {kindsPresent.map((kind) => (
            <span key={kind} className={`sched-legend-item is-${kind}`}>
              <span className="sched-legend-dot" />
              {KIND_LABEL[kind]}
            </span>
          ))}
        </div>
      ) : null}
    </>
  );
}

function CardioStructure({
  view,
  unitSystem,
  swim
}: {
  view: ScheduledStructureView;
  unitSystem: UnitSystem;
  swim: boolean;
}) {
  return (
    <>
      <StructureBar view={view} segments={buildBarSegments(view, unitSystem, swim)} />
      <ol className="sched-steps">
        {view.nodes.map((node) =>
          node.type === "step" ? (
            <StepRow key={node.step.id} step={node.step} />
          ) : (
            <RepeatCard
              key={node.id}
              node={node}
              unitSystem={unitSystem}
              swim={swim}
            />
          )
        )}
      </ol>
    </>
  );
}

function StepRow({ step }: { step: ScheduledStepView }) {
  const KindIcon = KIND_ICON[step.kind];
  const setsSuffix =
    step.sets && step.sets > 1 && !step.reps ? ` ×${step.sets}` : null;
  return (
    <li className={`sched-step is-${step.kind}`}>
      <span className="sched-step-token" aria-hidden="true">
        <KindIcon size={13} />
      </span>
      <div className="sched-step-text">
        <span className="sched-step-name">
          {step.name}
          {setsSuffix}
        </span>
        {step.intensityLabel ? (
          <span className="sched-step-intensity">{step.intensityLabel}</span>
        ) : null}
      </div>
      {step.targetLabel ? (
        <span className="sched-step-target">{step.targetLabel}</span>
      ) : null}
    </li>
  );
}

function RepeatCard({
  node,
  unitSystem,
  swim
}: {
  node: ScheduledRepeatViewExtract;
  unitSystem: UnitSystem;
  swim: boolean;
}) {
  const perRep = node.magnitude
    ? node.magnitudeType === "distance"
      ? formatStepDistanceLabel(node.magnitude, unitSystem, swim)
      : formatStepTimeLabel(node.magnitude)
    : undefined;
  const total =
    node.magnitude !== undefined
      ? node.magnitudeType === "distance"
        ? formatStepDistanceLabel(node.magnitude * node.repeat, unitSystem, swim)
        : formatStepTimeLabel(node.magnitude * node.repeat)
      : undefined;

  return (
    <li className="sched-repeat">
      <div className="sched-repeat-head">
        <span className="sched-repeat-token" aria-hidden="true">
          <Repeat size={12} />
        </span>
        <span className="sched-repeat-title">Repeat ×{node.repeat}</span>
        {perRep && total ? (
          <span className="sched-repeat-total">
            {perRep} each · {total} total
          </span>
        ) : null}
      </div>
      <ol className="sched-repeat-steps">
        {node.steps.map((step) => (
          <StepRow key={step.id} step={step} />
        ))}
      </ol>
    </li>
  );
}

/* ---------------- strength ---------------- */

export function formatTonnage(kg: number, unitSystem: UnitSystem): string {
  if (unitSystem === "metric" && kg >= 10_000) {
    return `${(kg / 1000).toFixed(1)} t`;
  }
  return formatWeightValue(kg, unitSystem, 0);
}

/** Total weight moved, in kilograms. Shared with the view's hero figures. */
export function strengthTonnage(steps: ScheduledStepView[]): number {
  return steps.reduce(
    (sum, step) =>
      sum +
      (step.sets ?? 1) *
        (step.reps ?? 0) *
        (step.weightUnit === "lb"
          ? (step.weight ?? 0) / POUNDS_PER_KILOGRAM
          : (step.weight ?? 0)),
    0
  );
}

/**
 * A strength session's bar: one segment per step, sized by the work in it.
 *
 * A lift's target is reps or time, and most carry no distance or duration at
 * all, so `magnitude` alone leaves the bar with nothing to size by. Each step
 * weighs its sets times what one set asks — its seconds when it is timed, four
 * seconds a rep otherwise, two minutes when it states neither — which is the
 * weighting the library's list rows draw their line with, so the two agree.
 */
function buildStrengthBarSegments(view: ScheduledStructureView): BarSegment[] {
  const segments: BarSegment[] = [];
  const push = (step: ScheduledStepView, key: string, repeat?: number) => {
    const sets = Math.max(1, step.sets ?? 1);
    const perSet =
      step.magnitudeType === "time" && step.magnitude
        ? step.magnitude
        : step.reps
          ? step.reps * 4
          : 120;
    const scheme = liftSchemeLabel(step);
    const label = [step.name, repeat && repeat > 1 ? `×${repeat}` : null, scheme]
      .filter(Boolean)
      .join(" · ");
    segments.push({ key, kind: step.kind, grow: sets * perSet, label });
  };

  for (const node of view.nodes) {
    if (node.type === "step") {
      push(node.step, node.step.id);
    } else {
      for (let round = 0; round < node.repeat; round += 1) {
        for (const step of node.steps) {
          push(step, `${node.id}-${round}-${step.id}`, node.repeat);
        }
      }
    }
  }

  const max = Math.max(0, ...segments.map((segment) => segment.grow));
  const floor = max * 0.035;
  return segments.map((segment) => ({ ...segment, grow: Math.max(segment.grow, floor) }));
}

function StrengthStructure({
  view,
  unitSystem,
  showSummary = true,
  exercises
}: {
  view: ScheduledStructureView;
  unitSystem: UnitSystem;
  showSummary?: boolean;
  exercises?: ReadonlyMap<string, WorkoutExerciseOption>;
}) {
  const steps = flatSteps(view);
  const totalSets = steps.reduce((sum, step) => sum + (step.sets ?? 1), 0);
  const tonnage = strengthTonnage(steps);

  return (
    <>
      {showSummary ? (
        <div className="sched-strength-summary">
          <span className="sched-strength-chip">
            {steps.length} exercise{steps.length === 1 ? "" : "s"}
          </span>
          <span className="sched-strength-chip">{totalSets} sets</span>
          {tonnage > 0 ? (
            <span className="sched-strength-chip">
              {formatTonnage(tonnage, unitSystem)} lifted
            </span>
          ) : null}
        </div>
      ) : null}
      <StructureBar view={view} segments={buildStrengthBarSegments(view)} />
      <div className="sched-strength-list">
        {view.nodes.map((node) =>
          node.type === "step" ? (
            <LiftCard
              key={node.step.id}
              step={node.step}
              unitSystem={unitSystem}
              exercises={exercises}
            />
          ) : (
            <div className="sched-circuit" key={node.id}>
              <div className="sched-circuit-head">
                <Repeat size={12} aria-hidden="true" />
                Circuit ×{node.repeat}
              </div>
              {node.steps.map((step) => (
                <LiftCard
                  key={step.id}
                  step={step}
                  unitSystem={unitSystem}
                  exercises={exercises}
                />
              ))}
            </div>
          )
        )}
      </div>
    </>
  );
}

function LiftCard({
  step,
  unitSystem,
  exercises
}: {
  step: ScheduledStepView;
  unitSystem: UnitSystem;
  exercises?: ReadonlyMap<string, WorkoutExerciseOption>;
}) {
  const [showClip, setShowClip] = useState(false);
  const scheme = liftSchemeLabel(step);
  const option = step.exerciseId ? exercises?.get(step.exerciseId) : undefined;
  const clip = option?.media?.find((entry) => entry.videoUrl);
  const poster = clip?.coverUrl ?? option?.thumbnailUrl;
  // The load, and only the load. The target moved up into the scheme line, so
  // a chip repeating it would put "0:45" twice on one row.
  const weightLabel =
    step.weight !== undefined
      ? formatWeightValue(
          step.weightUnit === "lb"
            ? step.weight / POUNDS_PER_KILOGRAM
            : step.weight,
          unitSystem,
          1
        )
      : (step.intensityLabel ?? undefined);

  const row = (
    <>
      {poster ? (
        <img className="sched-lift-thumb" src={poster} alt="" loading="lazy" />
      ) : (
        <span className="sched-lift-icon" aria-hidden="true">
          <Dumbbell size={14} />
        </span>
      )}
      <div className="sched-lift-text">
        <span className="sched-lift-name">{step.name}</span>
        {scheme ? <span className="sched-lift-scheme">{scheme}</span> : null}
      </div>
      {weightLabel ? (
        <span className="sched-lift-weight">{weightLabel}</span>
      ) : null}
    </>
  );

  /*
   * A clip is fetched when it is asked for, not with the list. Nine
   * demonstrations on one screen is nine videos downloaded and decoded at
   * once, on a page whose job is to say what the session is — so the row
   * carries the still and opens the clip underneath it.
   */
  if (!clip) {
    return <article className="sched-lift">{row}</article>;
  }

  return (
    <article className={`sched-lift has-clip ${showClip ? "is-open" : ""}`}>
      <button
        type="button"
        className="sched-lift-toggle"
        aria-expanded={showClip}
        onClick={() => setShowClip((current) => !current)}
      >
        {row}
        <span className="sched-lift-chevron" aria-hidden="true">
          {showClip ? <ChevronDown size={15} /> : <Play size={13} />}
        </span>
      </button>
      {showClip ? (
        <ExercisePreview
          className="sched-lift-clip"
          option={option}
          name={step.name}
          autoPlay
        />
      ) : null}
    </article>
  );
}
