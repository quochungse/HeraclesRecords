/**
 * The workout builder: the Structured tab of Create workout, and now every
 * other place a workout is written — a plan session, new or edited, and Edit
 * workout in the Training Library (`WorkoutBuilderModal`).
 *
 * Moved out of `AddWorkoutModal` as it was, so Create workout draws and
 * behaves exactly as it did; what differs between the places it opens is the
 * dialog around it and the slots `WorkoutBuilderWorkspace` takes. The row
 * model, its defaults and its encoder live in `workoutBuilderRows.ts`.
 */
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  AlertCircle,
  Bike,
  ChevronDown,
  ChevronUp,
  Copy,
  Dumbbell,
  Flag,
  Flame,
  Grip,
  GripVertical,
  Hand,
  ListTree,
  Mountain,
  Plus,
  Repeat2,
  Route,
  Snowflake,
  Timer,
  Trash2,
  Trophy,
  Waves,
  Zap,
  type LucideIcon
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { OptionGroup } from "../components/OptionGroup";
import { SelectDropdown } from "../components/SelectDropdown";
import type {
  RunWorkoutEditorDraft,
  WorkoutEditorContext,
  WorkoutExerciseOption,
  WorkoutHeartRateBasis,
  WorkoutIntensityInput,
  WorkoutSport
} from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";
import { useUnitSystem } from "../units/UnitSystemProvider";
import { RunnerIcon } from "../running/runnerIcon";
import { distanceUnit, swimDistanceUnit } from "../units/units";
import { ExerciseCombobox, type ExerciseComboboxSelection } from "./ExerciseCombobox";
import { ExercisePreview } from "./ExercisePreview";
import {
  CLIMB_GRADES,
  CLIMB_SYSTEM_IDS,
  FTP_PRESETS,
  HEART_RATE_PRESETS,
  PACE_PRESETS,
  zoneOptionLabel,
  SWIM_STROKE_IDS,
  WORKOUT_SPORT_CAPABILITIES,
  WORKOUT_SPORTS,
  formatIntensityType,
  formatWorkoutSport,
  workoutIntensitiesForStep,
  workoutTargetsForStep
} from "../../electron/workoutCapabilities";
import {
  BUILDER_ADD_KIND_ORDER,
  BUILDER_KIND_LABELS,
  builderRowSummary,
  builderRowValidationMessage,
  builderRowsToEditorDraft,
  builderStructureCounts,
  builderTargetLabel,
  builderTargetTypeLabel,
  builderWorkoutTotals,
  changeBuilderRowKind,
  cloneBuilderRow,
  editorDraftToBuilderRows,
  emptyRow,
  exerciseSelectionFields,
  formatBuilderDistance,
  formatBuilderMinutes,
  formatBuilderToken,
  moveBuilderRow,
  rowIntensity,
  rowIsValid,
  seedBuilderRows,
  syncRowHeartRateBasis,
  type BuilderKind,
  type BuilderRow,
  type RowSeed
} from "./workoutBuilderRows";

/** The builder's own per-sport glyph, so Quick and Structured agree. */
export function BuilderSportIcon({
  sport,
  size = 14
}: {
  sport: WorkoutSport;
  size?: number;
}) {
  const Icon = BUILDER_SPORT_META[sport].Icon;
  return <Icon size={size} aria-hidden="true" />;
}

/**
 * What may sit in a clock field while it is being typed.
 *
 * Deliberately looser than `CLOCK_PATTERN`: "4", "4:" and "4:3" are all on the
 * way to a valid value, and rejecting them would make the field impossible to
 * fill. The strict pattern is what the validator uses before anything is sent.
 */
const CLOCK_DRAFT = /^\d{0,2}(:\d{0,2})?$/;

/** The colon is typed for the athlete once the minutes are in. */
function clockDraft(value: string): string | undefined {
  const cleaned = value.replace(/[^\d:]/g, "");
  if (!CLOCK_DRAFT.test(cleaned)) return undefined;
  const [minutes, seconds] = cleaned.split(":");
  if (seconds === undefined) {
    return cleaned.length > 2 ? `${cleaned.slice(0, 2)}:${cleaned.slice(2)}` : cleaned;
  }
  // A leading digit above 5 can only be a seconds value the athlete meant to
  // start with, so it is held rather than silently turned into something else.
  return `${minutes}:${seconds.slice(0, 2)}`;
}

/**
 * One `mm:ss` box.
 *
 * `inputMode="numeric"` rather than `type="number"`: a number input drops the
 * colon and would make this unfillable on a phone keyboard.
 */
export function ClockField({ label, value, placeholder, onChange }: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <input
      type="text"
      className="clock-field"
      inputMode="numeric"
      aria-label={label}
      maxLength={5}
      value={value}
      placeholder={placeholder}
      onChange={(event) => {
        const next = clockDraft(event.target.value);
        if (next !== undefined) onChange(next);
      }}
    />
  );
}

/**
 * What COROS calls each heart-rate family, on its own Heart Rate Zone screen.
 *
 * It labels the zone control rather than filling a picker: the family is the
 * account's setting, so the builder states which one the percentages are of
 * and leaves changing it to COROS.
 */
export const HEART_RATE_BASIS_LABELS: Readonly<Record<WorkoutHeartRateBasis, string>> = {
  maxHr: "Zone (% Max Heart Rate)",
  reserve: "Zone (% Heart Rate Reserve)",
  lthr: "Zone (% Threshold HR)"
};

/**
 * Per-sport builder identity: an icon plus the user's (customizable) sport
 * color token. Categories mirror sportColorCategory() — run/trail/bike/
 * strength get their own hue, everything else falls back to "other".
 */
export const BUILDER_SPORT_META: Record<WorkoutSport, { Icon: LucideIcon; colorVar: string }> = {
  run: { Icon: RunnerIcon, colorVar: "var(--sport-run)" },
  bike: { Icon: Bike, colorVar: "var(--sport-bike)" },
  swim: { Icon: Waves, colorVar: "var(--sport-other)" },
  strength: { Icon: Dumbbell, colorVar: "var(--sport-strength)" },
  trailRun: { Icon: Mountain, colorVar: "var(--sport-trail)" },
  indoorClimb: { Icon: Grip, colorVar: "var(--sport-other)" },
  bouldering: { Icon: Hand, colorVar: "var(--sport-other)" },
  xcSki: { Icon: Snowflake, colorVar: "var(--sport-other)" },
  hyrox: { Icon: Trophy, colorVar: "var(--sport-strength)" }
};

/** Display metadata for each step kind; hues come from CSS per data-kind. */
export const BUILDER_KIND_META: Record<BuilderKind, { label: string; Icon: LucideIcon }> = {
  warmup: { label: BUILDER_KIND_LABELS.warmup, Icon: Flame },
  training: { label: BUILDER_KIND_LABELS.training, Icon: Zap },
  intervals: { label: BUILDER_KIND_LABELS.intervals, Icon: Repeat2 },
  rest: { label: BUILDER_KIND_LABELS.rest, Icon: Timer },
  cooldown: { label: BUILDER_KIND_LABELS.cooldown, Icon: Snowflake },
  sendOff: { label: BUILDER_KIND_LABELS.sendOff, Icon: Flag }
};

function BuilderIntensityFields({ row, sport, context, exerciseOptions, exercisesLoading, onChange }: { row: BuilderRow; sport: WorkoutSport; context?: WorkoutEditorContext; exerciseOptions: WorkoutExerciseOption[]; exercisesLoading: boolean; onChange: (update: Partial<BuilderRow>) => void }) {
  const { unitSystem } = useUnitSystem();
  const stepKind = row.kind === "intervals" ? "training" : row.kind;
  const intensityTypes = workoutIntensitiesForStep(sport, stepKind, row.exerciseKind);
  const numericRange = ["heartRate", "speed", "cadence"].includes(row.intensityType) ||
    (row.intensityType === "power" && !row.intensityPreset);
  const percentType = ["heartRatePercent", "thresholdPacePercent", "effortPacePercent", "ftpPercent"].includes(row.intensityType);
  /*
   * Which heart-rate family this account is scored in. COROS aggregates every
   * activity against one `hrZoneType`, so it is a property of the athlete and
   * not of a step — the builder reads it rather than asking. `row` still
   * carries it because that is what travels to COROS; `syncRowHeartRateBasis`
   * is what keeps the two in step once the account has answered.
   */
  const heartRateBasis = row.keepBasis
    ? row.intensityBasis
    : context?.heartRateBasis ?? row.intensityBasis;
  const presets = row.intensityType === "heartRatePercent"
    ? HEART_RATE_PRESETS[heartRateBasis]
    : row.intensityType === "ftpPercent" ? FTP_PRESETS
      : row.intensityType === "thresholdPacePercent" || row.intensityType === "effortPacePercent" ? PACE_PRESETS
        : [];
  const presetZoneKey: keyof WorkoutEditorContext["zones"] | undefined = row.intensityType === "heartRatePercent"
    ? heartRateBasis
    : row.intensityType === "ftpPercent" ? "ftp"
      : row.intensityType === "thresholdPacePercent" || row.intensityType === "effortPacePercent" ? "thresholdPace"
        : undefined;
  const climbParts = row.intensityPreset.split(":");
  const rawClimbSystem = row.intensityPreset.startsWith("relative:") ? climbParts[1] : climbParts[0];
  const climbSystem = (rawClimbSystem || (sport === "bouldering" ? "vScale" : "yds")) as keyof typeof CLIMB_SYSTEM_IDS;
  const showExercise = (sport === "strength" || sport === "hyrox") && row.kind !== "warmup" && row.kind !== "cooldown";
  const paceUnitLabel = distanceUnit(unitSystem);
  const numberUnit = row.intensityType === "heartRate" ? "bpm"
    : row.intensityType === "speed" ? (row.intensityUnit === "mph" ? "mph" : "km/h")
      : row.intensityType === "cadence" ? (row.intensityUnit === "spm" ? "spm" : "rpm")
        : row.intensityType === "power" ? "W" : "%";
  const selectExercise = (selection: ExerciseComboboxSelection) => {
    onChange(exerciseSelectionFields(selection, sport, stepKind, { context, unitSystem }));
  };
  const intensityControls = <>
    <label className="calendar-builder-control">
      <span>Intensity</span>
      <SelectDropdown<BuilderRow["intensityType"]>
        label="Intensity"
        value={row.intensityType}
        options={intensityTypes.map((type) => ({ value: type, label: formatIntensityType(type) }))}
        portal
        onChange={(intensityType) => {
        onChange({
          intensityType,
          // A new intensity is a default again, so it takes the account's family.
          keepBasis: undefined,
          intensityBasis: context?.heartRateBasis ?? row.intensityBasis,
          intensityLow: intensityType === "heartRate" ? "135" : intensityType === "rpe" ? "5" : intensityType === "climbGrade" ? "0" : "80",
          intensityHigh: intensityType === "heartRate" ? "145" : "100",
          intensityPreset: intensityType === "swimStroke" ? "freestyle" : intensityType === "weight" ? "bodyweight" : intensityType === "climbGrade" ? `relative:${sport === "bouldering" ? "vScale" : "yds"}` : "",
          intensityUnit: intensityType === "weight" ? (unitSystem === "imperial" ? "lb" : "kg") : intensityType === "speed" ? (unitSystem === "imperial" ? "mph" : "km/h") : sport === "run" || sport === "trailRun" || sport === "hyrox" ? "spm" : "rpm"
        });
      }} />
    </label>

    {(row.intensityType === "pace" || row.intensityType === "effortPace") ? <div className="calendar-builder-control pace-range-control">
      <span>Pace range ({paceUnitLabel})</span>
      <div className="pace-range">
        <ClockField
          label={`Fastest pace per ${paceUnitLabel}`}
          value={row.paceFast}
          placeholder={unitSystem === "imperial" ? "7:15" : "4:30"}
          onChange={(paceFast) => onChange({ paceFast })}
        />
        <span className="pace-range-separator" aria-hidden="true">–</span>
        <ClockField
          label={`Slowest pace per ${paceUnitLabel}`}
          value={row.paceSlow}
          placeholder={unitSystem === "imperial" ? "7:30" : "4:45"}
          onChange={(paceSlow) => onChange({ paceSlow })}
        />
      </div>
      <small>Fastest first, each as mm:ss.</small>
    </div> : null}

    {(percentType || (row.intensityType === "power" && sport !== "bike")) ? <label className="calendar-builder-control">
      <span>{row.intensityType === "heartRatePercent" ? HEART_RATE_BASIS_LABELS[heartRateBasis] : "Zone"}</span>
      <SelectDropdown
        label="Intensity zone"
        value={row.intensityPreset || "custom"}
        options={[
          { value: "custom", label: "Custom range" },
          ...presets.map((zone, index) => {
            // Prefer the athlete's own zone over the shipped default, by
            // position: COROS sends no label and no id on a zone entry, so
            // position is the only thing the two lists agree on.
            const configured = presetZoneKey
              ? context?.zones[presetZoneKey]?.[index]
              : undefined;
            return {
              value: zone.preset,
              label: zoneOptionLabel(zone, index, presets.length, configured)
            };
          })
        ]}
        portal
        onChange={(intensityPreset) => onChange({ intensityPreset: intensityPreset === "custom" ? "" : intensityPreset })}
      />
    </label> : null}

    {(numericRange || (percentType && !row.intensityPreset)) ? <>
      <label className="calendar-builder-control"><span>Low ({numberUnit})</span><input type="number" value={row.intensityLow} onChange={(event) => onChange({ intensityLow: event.target.value })} /></label>
      <label className="calendar-builder-control"><span>High ({numberUnit})</span><input type="number" value={row.intensityHigh} onChange={(event) => onChange({ intensityHigh: event.target.value })} /></label>
    </> : null}

    {row.intensityType === "speed" ? <label className="calendar-builder-control"><span>Speed unit</span><span className="calendar-builder-readonly-value">{unitSystem === "imperial" ? "mph" : "km/h"}</span></label> : null}
    {row.intensityType === "cadence" ? <label className="calendar-builder-control"><span>Cadence unit</span><SelectDropdown label="Cadence unit" value={row.intensityUnit === "spm" ? "spm" : "rpm"} options={[{ value: "spm", label: "steps/min" }, { value: "rpm", label: "revs/min" }]} portal onChange={(intensityUnit) => onChange({ intensityUnit })} /></label> : null}
    {row.intensityType === "swimStroke" ? <label className="calendar-builder-control"><span>Stroke</span><SelectDropdown label="Swim stroke" value={row.intensityPreset || "freestyle"} options={Object.keys(SWIM_STROKE_IDS).map((stroke) => ({ value: stroke, label: formatBuilderToken(stroke) }))} portal onChange={(intensityPreset) => onChange({ intensityPreset })} /></label> : null}

    {row.intensityType === "weight" ? <>
      <label className="calendar-builder-control"><span>Load type</span><SelectDropdown label="Load type" value={row.intensityPreset || "bodyweight"} options={[{ value: "bodyweight", label: "Bodyweight" }, { value: "weight", label: "Added weight" }]} portal onChange={(intensityPreset) => onChange({ intensityPreset })} /></label>
      {row.intensityPreset === "weight" ? <><label className="calendar-builder-control"><span>Weight ({unitSystem === "imperial" ? "lb" : "kg"})</span><input type="number" min="0" value={row.intensityLow} onChange={(event) => onChange({ intensityLow: event.target.value, intensityUnit: unitSystem === "imperial" ? "lb" : "kg" })} /></label></> : null}
    </> : null}

    {row.intensityType === "rpe" ? <label className="calendar-builder-control"><span>RPE</span><SelectDropdown label="RPE" value={row.intensityLow || "5"} options={Array.from({ length: 10 }, (_, index) => String(index + 1)).map((value) => ({ value, label: value }))} portal onChange={(intensityLow) => onChange({ intensityLow })} /></label> : null}

    {row.intensityType === "climbGrade" ? <>
      <label className="calendar-builder-control"><span>Grade system</span><SelectDropdown label="Grade system" value={climbSystem} options={(Object.keys(CLIMB_SYSTEM_IDS) as Array<keyof typeof CLIMB_SYSTEM_IDS>).map((system) => ({ value: system, label: formatBuilderToken(system) }))} portal onChange={(system) => onChange({ intensityPreset: `relative:${system}` })} /></label>
      <label className="calendar-builder-control"><span>Grade mode</span><SelectDropdown label="Grade mode" value={row.intensityPreset.startsWith("relative:") ? "relative" : "absolute"} options={[{ value: "relative", label: "Relative to onsight" }, { value: "absolute", label: "Absolute grade" }]} portal onChange={(mode) => onChange({ intensityPreset: mode === "relative" ? `relative:${climbSystem}` : `${climbSystem}:${CLIMB_GRADES[climbSystem][0]}` })} /></label>
      {row.intensityPreset.startsWith("relative:") ? <label className="calendar-builder-control"><span>Relative level</span><input type="number" min="-8" max="4" value={row.intensityLow || "0"} onChange={(event) => onChange({ intensityLow: event.target.value })} /></label> : <label className="calendar-builder-control"><span>Grade</span><SelectDropdown label="Climbing grade" value={row.intensityPreset.split(":")[1] ?? CLIMB_GRADES[climbSystem][0]} options={CLIMB_GRADES[climbSystem].map((grade) => ({ value: grade, label: grade }))} portal onChange={(grade) => onChange({ intensityPreset: `${climbSystem}:${grade}` })} /></label>}
    </> : null}

    {/*
      * The box is drawn for any zone-based intensity, whether or not its
      * figures are in yet. `context` arrives a round trip after the form
      * does, so gating the box on it made the row grow under the athlete's
      * hands the moment COROS answered.
      */}
    {percentType ? (
      <div className="calendar-builder-derived">
        {context ? (
          <BuilderDerivedIntensityPreview
            intensity={rowIntensity(row, unitSystem)}
            context={context}
          />
        ) : null}
      </div>
    ) : null}
  </>;
  const exerciseStatus = exercisesLoading
    ? "Loading COROS exercises..."
    : row.exerciseId
      ? "Selected from your COROS exercise library."
      : exerciseOptions.length === 0
        ? "No exercises are available. Reconnect COROS and try again."
        : sport === "strength"
          ? "Choose an exact COROS exercise to continue."
          : "Optional for running steps.";

  return <div className={`calendar-builder-intensity-grid ${showExercise ? "has-exercise-workspace" : ""}`}>
    {showExercise ? <div className="calendar-builder-control calendar-builder-exercise-workspace is-wide">
      <span>{sport === "strength" ? "Exercise" : "Exercise (optional for running steps)"}</span>
      <ExerciseCombobox
        value={row.exerciseName}
        selectedId={row.exerciseId}
        options={exerciseOptions}
        placeholder={sport === "strength" ? "Choose an exercise" : "Choose a Hybrid Fitness exercise"}
        label={sport === "strength" ? "Exercise" : "Hybrid Fitness exercise"}
        loading={exercisesLoading}
        details={<div className="calendar-builder-exercise-details">
          <div className={`calendar-builder-exercise-status ${row.exerciseId ? "is-selected" : ""}`}>
            <strong>{row.exerciseId ? "Exercise selected" : sport === "strength" ? "Exercise required" : "Exercise optional"}</strong>
            <span>{exerciseStatus}</span>
          </div>
          <div className="calendar-builder-exercise-fields">{intensityControls}</div>
        </div>}
        onChange={selectExercise}
      />
    </div> : intensityControls}
  </div>;
}

/** Rest lengths lifters actually reach for; anything else goes in the field. */
const STRENGTH_REST_PRESETS = [30, 45, 60, 90, 120] as const;

/** Rest chips read as one clock format so they scan as a single scale. */
function formatRestChip(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatStrengthClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  if (seconds < 60) return `${seconds} sec`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder === 0 ? `${minutes} min` : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

/** How the load slot is set, folding the intensity type and its mode into one. */
type StrengthLoadMode = "bodyweight" | "added" | "unspecified";

function strengthLoadMode(row: BuilderRow): StrengthLoadMode {
  if (row.intensityType === "none") return "unspecified";
  return row.intensityPreset === "weight" ? "added" : "bodyweight";
}

/**
 * A strength set is written the way lifters write it — sets × work @ load,
 * then rest — so the editor is that line rather than a column of look-alike
 * fields. Everything COROS accepts for a Strength training step (reps or
 * seconds or a manual end, bodyweight or added load, sets, rest) lives here.
 */
function BuilderStrengthStepFields({
  row,
  exerciseOptions,
  exercisesLoading,
  allowedKinds,
  kindLabel,
  validationMessage,
  context,
  onChange,
  onKindChange
}: {
  row: BuilderRow;
  context?: WorkoutEditorContext;
  exerciseOptions: WorkoutExerciseOption[];
  exercisesLoading: boolean;
  allowedKinds: readonly BuilderKind[];
  kindLabel: string;
  validationMessage?: string;
  onChange: (update: Partial<BuilderRow>) => void;
  onKindChange: (kind: BuilderKind) => void;
}) {
  const { unitSystem } = useUnitSystem();
  const targetTypes = workoutTargetsForStep("strength", "training", row.exerciseKind);
  const selectedExercise = row.exerciseId
    ? exerciseOptions.find((option) => option.id === row.exerciseId)
    : undefined;
  const loadMode = strengthLoadMode(row);
  const weightUnit = unitSystem === "imperial" ? "lb" : "kg";
  const restSeconds = Number(row.restSeconds);
  const sets = Number(row.sets);
  const perSet = Number(row.targetValue);

  const measureLabels: Partial<Record<BuilderRow["targetType"], string>> = {
    reps: "reps",
    time: "seconds",
    open: "to lap button"
  };

  // Only worth saying once the sets multiply into something you can't read
  // straight off the line above.
  const restTotal = Number.isFinite(restSeconds) && sets > 1
    ? Math.max(0, restSeconds) * (sets - 1)
    : 0;
  const readout = !(sets > 1)
    ? undefined
    : row.targetType === "reps" && perSet > 0
      ? `${sets * perSet} reps in total${restTotal > 0 ? `, ${formatStrengthClock(restTotal)} resting` : ""}`
      : row.targetType === "time" && perSet > 0
        ? `About ${formatStrengthClock(sets * perSet + restTotal)} in total`
        : row.targetType === "open" && restTotal > 0
          ? `${formatStrengthClock(restTotal)} resting in total`
          : undefined;

  const changeMeasure = (targetType: BuilderRow["targetType"]) => {
    if (targetType === row.targetType) return;
    // The number carries the old measure's unit, so it is reseeded rather
    // than kept: 10 reps left alone would read as 10 seconds.
    onChange({
      targetType,
      ...(targetType === "open" ? {} : { targetValue: targetType === "reps" ? "10" : "30" })
    });
  };

  const changeLoadMode = (mode: StrengthLoadMode) => {
    if (mode === "unspecified") {
      onChange({ intensityType: "none", intensityPreset: "" });
      return;
    }
    if (mode === "bodyweight") {
      onChange({ intensityType: "weight", intensityPreset: "bodyweight" });
      return;
    }
    onChange({
      intensityType: "weight",
      intensityPreset: "weight",
      intensityUnit: weightUnit,
      intensityLow: Number(row.intensityLow) > 0 ? row.intensityLow : ""
    });
  };

  return (
    <div className="calendar-builder-row-content strength-step">
      <div className="strength-step-form">
        <label className="calendar-builder-control strength-step-kind">
          <span>{kindLabel}</span>
          <SelectDropdown<BuilderKind>
            label={kindLabel ?? "Step type"}
            value={row.kind}
            options={allowedKinds.map((kind) => ({
              value: kind,
              label: BUILDER_KIND_META[kind].label
            }))}
            portal
            onChange={onKindChange}
          />
        </label>

        <section className="strength-block">
          <h4>Movement</h4>
          <ExerciseCombobox
            value={row.exerciseName}
            selectedId={row.exerciseId}
            options={exerciseOptions}
            placeholder="Choose a movement"
            label="Exercise"
            loading={exercisesLoading}
            hidePreview
            onChange={(selection) => onChange(
              exerciseSelectionFields(selection, "strength", "training", { context, unitSystem })
            )}
          />
          {exercisesLoading ? (
            <p className="strength-block-note">Loading the COROS exercise library.</p>
          ) : exerciseOptions.length === 0 ? (
            <p className="strength-block-note">No exercises loaded. Reconnect COROS to get the library.</p>
          ) : !row.exerciseId ? (
            <p className="strength-block-note">Pick one exercise from the library. The watch needs an exact match.</p>
          ) : null}
        </section>

        <section className="strength-block">
          <h4>Prescription</h4>
          <div className="set-line">
            <label className="set-line-cell">
              <span>Sets</span>
              <input
                type="number"
                min="1"
                max="99"
                value={row.sets}
                onChange={(event) => onChange({ sets: event.target.value })}
              />
            </label>

            <span className="set-line-operator" aria-hidden="true">×</span>

            <div className="set-line-cell">
              <span>Per set</span>
              <div className="set-line-compound">
                {row.targetType === "open" ? (
                  <span className="set-line-open">Ends on the lap button</span>
                ) : (
                  <input
                    type="number"
                    min="1"
                    max={row.targetType === "reps" ? 500 : undefined}
                    aria-label={row.targetType === "reps" ? "Repetitions per set" : "Seconds per set"}
                    value={row.targetValue}
                    placeholder={row.targetType === "time" ? "30" : "10"}
                    onChange={(event) => onChange({ targetValue: event.target.value })}
                  />
                )}
                <SelectDropdown<BuilderRow["targetType"]>
                  className="set-line-select"
                  label="Measure each set by"
                  value={row.targetType}
                  options={targetTypes.map((target) => ({
                    value: target,
                    label: measureLabels[target] ?? builderTargetTypeLabel(target)
                  }))}
                  portal
                  onChange={changeMeasure}
                />
              </div>
            </div>

            <span className="set-line-operator" aria-hidden="true">@</span>

            <div className="set-line-cell is-load">
              <span>Load</span>
              <div className="set-line-compound">
                <SelectDropdown<StrengthLoadMode>
                  className="set-line-select"
                  label="Load"
                  value={loadMode}
                  options={[
                    { value: "bodyweight", label: "Bodyweight" },
                    { value: "added", label: "Added weight" },
                    { value: "unspecified", label: "Not set" }
                  ]}
                  portal
                  onChange={changeLoadMode}
                />
                {loadMode === "added" ? (
                  <span className="set-line-weight">
                    <input
                      type="number"
                      min="0"
                      step="0.5"
                      aria-label={`Weight in ${weightUnit}`}
                      value={row.intensityLow}
                      onChange={(event) => onChange({
                        intensityLow: event.target.value,
                        intensityUnit: weightUnit
                      })}
                    />
                    <em>{weightUnit}</em>
                  </span>
                ) : null}
              </div>
            </div>
          </div>
          {readout ? <p className="set-line-readout">{readout}</p> : null}
        </section>

        <section className="strength-block">
          <h4>Rest between sets</h4>
          <div className="rest-picker">
            <OptionGroup
              label="Rest between sets"
              tone="quiet"
              value={Number.isFinite(restSeconds) ? String(restSeconds) : ""}
              options={STRENGTH_REST_PRESETS.map((preset) => ({
                value: String(preset),
                label: formatRestChip(preset)
              }))}
              onChange={(next) => onChange({ restSeconds: next })}
            />
            <label className="rest-picker-custom">
              <input
                type="number"
                min="0"
                max="3600"
                step="5"
                aria-label="Rest between sets in seconds"
                value={row.restSeconds}
                onChange={(event) => onChange({ restSeconds: event.target.value })}
              />
              <em>sec</em>
            </label>
          </div>
        </section>

        {validationMessage ? (
          <p className="calendar-builder-error" role="alert">
            <AlertCircle size={13} aria-hidden="true" />
            <span>{validationMessage}</span>
          </p>
        ) : null}
      </div>

      {selectedExercise ? (
        <aside className="strength-step-aside">
          <ExercisePreview
            option={selectedExercise}
            name={row.exerciseName}
            showTargets
          />
        </aside>
      ) : null}
    </div>
  );
}

function BuilderStepFields({
  row,
  sport,
  context,
  exerciseOptions,
  exercisesLoading,
  allowedKinds,
  kindLabel = "Step type",
  onChange,
  onKindChange
}: {
  row: BuilderRow;
  sport: WorkoutSport;
  context?: WorkoutEditorContext;
  exerciseOptions: WorkoutExerciseOption[];
  exercisesLoading: boolean;
  allowedKinds: readonly BuilderKind[];
  kindLabel?: string;
  onChange: (update: Partial<BuilderRow>) => void;
  onKindChange: (kind: BuilderKind) => void;
}) {
  const { unitSystem } = useUnitSystem();
  const stepKind = row.kind === "intervals" ? "training" : row.kind;
  const targetTypes = workoutTargetsForStep(sport, stepKind, row.exerciseKind);
  const usesExerciseWorkspace = (sport === "strength" || sport === "hyrox")
    && row.kind !== "warmup"
    && row.kind !== "cooldown";
  const validationMessage = builderRowValidationMessage(
    row,
    sport,
    exerciseOptions,
    exercisesLoading,
    unitSystem
  );

  if (sport === "strength" && row.kind === "training") {
    return (
      <BuilderStrengthStepFields
        row={row}
        context={context}
        exerciseOptions={exerciseOptions}
        exercisesLoading={exercisesLoading}
        allowedKinds={allowedKinds}
        kindLabel={kindLabel}
        validationMessage={validationMessage}
        onChange={onChange}
        onKindChange={onKindChange}
      />
    );
  }

  return (
    <div className={`calendar-builder-row-content ${usesExerciseWorkspace ? "has-exercise-workspace" : ""}`}>
      <div className="calendar-builder-primary-grid">
        <label className="calendar-builder-control">
          <span>{kindLabel}</span>
          <SelectDropdown<BuilderKind>
            label={kindLabel ?? "Step type"}
            value={row.kind}
            options={allowedKinds.map((kind) => ({
              value: kind,
              label: BUILDER_KIND_META[kind].label
            }))}
            portal
            onChange={onKindChange}
          />
        </label>

        <label className="calendar-builder-control">
          <span>{sport === "strength" && row.kind === "training" ? "Measure by" : "Target"}</span>
          <SelectDropdown<BuilderRow["targetType"]>
            label={sport === "strength" && row.kind === "training" ? "Measure by" : "Target"}
            value={row.targetType}
            options={targetTypes.map((target) => ({
              value: target,
              label: builderTargetTypeLabel(target)
            }))}
            portal
            onChange={(targetType) => onChange({ targetType })}
          />
        </label>

        <label className="calendar-builder-control">
          <span>{builderTargetLabel(row.targetType, sport, unitSystem)}</span>
          {row.targetType === "open" ? (
            <span className="calendar-builder-readonly-value">Ends when you press the lap button</span>
          ) : (
            <input
              type="number"
              min={row.targetType === "hrRecovery" ? 30 : row.targetType === "elevationGain" ? 20 : row.targetType === "distance" ? 0.01 : 1}
              max={row.targetType === "hrRecovery" ? 180 : row.targetType === "load" ? 999 : row.targetType === "routes" ? 20 : row.targetType === "reps" ? 500 : undefined}
              step={row.targetType === "distance" ? "0.1" : "1"}
              value={row.targetValue}
              placeholder={row.targetType === "distance" ? (sport === "swim" ? "100" : "0.8") : row.targetType === "hrRecovery" ? "120" : sport === "strength" && row.targetType === "time" ? "30" : "10"}
              onChange={(event) => onChange({ targetValue: event.target.value })}
            />
          )}
        </label>

        {sport === "strength" && row.kind === "training" ? (
          <>
            <label className="calendar-builder-control">
              <span>Sets</span>
              <input
                type="number"
                min="1"
                max="99"
                value={row.sets}
                onChange={(event) => onChange({ sets: event.target.value })}
              />
            </label>
            <label className="calendar-builder-control">
              <span>Rest between sets (sec)</span>
              <input
                type="number"
                min="0"
                max="3600"
                step="5"
                value={row.restSeconds}
                onChange={(event) => onChange({ restSeconds: event.target.value })}
              />
            </label>
          </>
        ) : null}
      </div>

      <BuilderIntensityFields
        row={row}
        sport={sport}
        context={context}
        exerciseOptions={exerciseOptions}
        exercisesLoading={exercisesLoading}
        onChange={onChange}
      />
      {validationMessage ? (
        <p className="calendar-builder-error" role="alert">
          <AlertCircle size={13} aria-hidden="true" />
          <span>{validationMessage}</span>
        </p>
      ) : null}
    </div>
  );
}

function BuilderRepeatFields({
  row,
  sport,
  context,
  exerciseOptions,
  exercisesLoading,
  activeChildId,
  reducedMotion,
  onChange,
  onActiveChildChange
}: {
  row: BuilderRow;
  sport: WorkoutSport;
  context?: WorkoutEditorContext;
  exerciseOptions: WorkoutExerciseOption[];
  exercisesLoading: boolean;
  activeChildId: number | null;
  reducedMotion: boolean | null;
  onChange: (update: Partial<BuilderRow>) => void;
  onActiveChildChange: (id: number | null) => void;
}) {
  const { unitSystem } = useUnitSystem();
  // Every step built here is one rep of something rather than the session.
  const seed: RowSeed = { context, unitSystem, insideRepeat: true };
  const children = row.children ?? [];
  const childKinds = WORKOUT_SPORT_CAPABILITIES[sport].stepKinds as readonly BuilderKind[];
  const repeatCount = Number(row.repeats) || 0;
  const repeatError = !Number.isInteger(Number(row.repeats))
    || Number(row.repeats) < 1
    || Number(row.repeats) > 99
    ? "Enter between 1 and 99 repeats."
    : children.length === 0
      ? "Add at least one step inside this repeat."
      : undefined;
  const updateChild = (childId: number, update: Partial<BuilderRow>) => {
    onChange({
      children: children.map((child) =>
        child.id === childId ? { ...child, ...update } : child
      )
    });
  };
  const changeChildKind = (childId: number, kind: BuilderKind) => {
    onChange({
      children: children.map((child) =>
        child.id === childId
          ? changeBuilderRowKind(child, kind, sport, seed)
          : child
      )
    });
  };
  const moveChild = (childId: number, direction: -1 | 1) => {
    const index = children.findIndex((child) => child.id === childId);
    const target = children[index + direction];
    if (index < 0 || !target) return;
    onChange({ children: moveBuilderRow(children, childId, target.id) });
  };

  return (
    <div className="calendar-builder-repeat">
      <div className="calendar-builder-repeat-settings">
        <div className="calendar-builder-repeat-copy">
          <Repeat2 size={15} aria-hidden="true" />
          <span>
            <strong>Repeat sequence</strong>
            <small>Every sub-step below runs in order, then the sequence starts again.</small>
          </span>
        </div>
        <div className="calendar-builder-repeat-count">
          <span>Times</span>
          <button
            type="button"
            onClick={() => onChange({ repeats: String(Math.max(1, repeatCount - 1)) })}
            disabled={repeatCount <= 1}
            aria-label="Decrease repeat count"
          >
            −
          </button>
          <input
            type="number"
            min="1"
            max="99"
            aria-label="Repeat count"
            value={row.repeats}
            onChange={(event) => onChange({ repeats: event.target.value })}
          />
          <button
            type="button"
            onClick={() => onChange({ repeats: String(Math.min(99, repeatCount + 1)) })}
            disabled={repeatCount >= 99}
            aria-label="Increase repeat count"
          >
            +
          </button>
        </div>
      </div>
      {repeatError ? (
        <p className="calendar-builder-error" role="alert">
          <AlertCircle size={13} aria-hidden="true" />
          <span>{repeatError}</span>
        </p>
      ) : null}

      <div className="calendar-builder-repeat-children">
        {children.map((child, childIndex) => {
          const isActive = activeChildId === child.id && !child.locked;
          const ChildIcon = child.kind === "training" && sport === "strength"
            ? Dumbbell
            : BUILDER_KIND_META[child.kind].Icon;
          const childError = builderRowValidationMessage(
            child,
            sport,
            exerciseOptions,
            exercisesLoading,
            unitSystem
          );
          return (
            <motion.section
              key={child.id}
              layout={reducedMotion ? false : "position"}
              className={`calendar-builder-repeat-child ${isActive ? "is-active" : "is-collapsed"} ${childError ? "has-error" : ""} ${child.locked ? "is-locked" : ""}`}
              data-builder-kind={child.kind}
            >
              <header className="calendar-builder-repeat-child-header">
                <span className="calendar-builder-repeat-child-index" aria-hidden="true">{childIndex + 1}</span>
                <button
                  type="button"
                  className="calendar-builder-repeat-child-toggle"
                  aria-expanded={isActive}
                  aria-controls={`builder-repeat-child-${child.id}`}
                  disabled={Boolean(child.locked)}
                  onClick={() => onActiveChildChange(isActive ? null : child.id)}
                >
                  <span className="calendar-builder-step-icon" aria-hidden="true">
                    <ChildIcon size={14} />
                  </span>
                  <span>
                    <small>Sub-step {childIndex + 1}</small>
                    <strong>{child.locked ? child.origin?.node.name ?? BUILDER_KIND_META[child.kind].label : BUILDER_KIND_META[child.kind].label}</strong>
                  </span>
                  {/* Against the name, for the reason the step header's is. */}
                  {child.locked ? null : <ChevronDown className={isActive ? "is-open" : ""} size={15} aria-hidden="true" />}
                  {!isActive ? (
                    <span className="calendar-builder-repeat-child-summary">
                      {builderRowSummary(
                        child,
                        sport,
                        unitSystem,
                        child.exerciseId
                          ? exerciseOptions.find((option) => option.id === child.exerciseId)?.name
                          : undefined
                      ).map((item) => item.value).join(", ")}
                    </span>
                  ) : null}
                </button>
                <div className="calendar-builder-repeat-child-actions">
                  <button type="button" onClick={() => moveChild(child.id, -1)} disabled={childIndex === 0} aria-label={`Move sub-step ${childIndex + 1} up`} title="Move up"><ChevronUp size={13} aria-hidden="true" /></button>
                  <button type="button" onClick={() => moveChild(child.id, 1)} disabled={childIndex === children.length - 1} aria-label={`Move sub-step ${childIndex + 1} down`} title="Move down"><ChevronDown size={13} aria-hidden="true" /></button>
                  <button
                    type="button"
                    onClick={() => {
                      const duplicate = cloneBuilderRow(child);
                      onChange({
                        children: [
                          ...children.slice(0, childIndex + 1),
                          duplicate,
                          ...children.slice(childIndex + 1)
                        ]
                      });
                      onActiveChildChange(duplicate.id);
                    }}
                    disabled={Boolean(child.locked)}
                    aria-label={`Duplicate sub-step ${childIndex + 1}`}
                    title="Duplicate sub-step"
                  >
                    <Copy size={13} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="is-delete"
                    onClick={() => {
                      const nextChildren = children.filter((candidate) => candidate.id !== child.id);
                      onChange({ children: nextChildren });
                      if (isActive) {
                        onActiveChildChange(nextChildren[Math.min(childIndex, nextChildren.length - 1)]?.id ?? null);
                      }
                    }}
                    disabled={children.length === 1}
                    aria-label={`Delete sub-step ${childIndex + 1}`}
                    title={children.length === 1 ? "A repeat needs at least one sub-step" : "Delete sub-step"}
                  >
                    <Trash2 size={13} aria-hidden="true" />
                  </button>
                </div>
              </header>

              <AnimatePresence initial={false}>
                {isActive ? (
                  <motion.div
                    id={`builder-repeat-child-${child.id}`}
                    className="calendar-builder-repeat-child-reveal"
                    initial={reducedMotion ? false : { height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1, transitionEnd: { overflow: "visible" } }}
                    exit={{ height: 0, opacity: 0, overflow: "hidden" }}
                    transition={reducedMotion ? { duration: 0 } : {
                      height: { duration: 0.2, ease: [0.4, 0, 0.2, 1] },
                      opacity: { duration: 0.12, ease: "easeOut" }
                    }}
                  >
                    <BuilderStepFields
                      row={child}
                      sport={sport}
                      context={context}
                      exerciseOptions={exerciseOptions}
                      exercisesLoading={exercisesLoading}
                      allowedKinds={childKinds}
                      kindLabel="Sub-step type"
                      onChange={(update) => updateChild(child.id, update)}
                      onKindChange={(kind) => changeChildKind(child.id, kind)}
                    />
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </motion.section>
          );
        })}
      </div>

      <div className="calendar-builder-repeat-add" role="group" aria-label="Add a sub-step to repeat">
        <span><Plus size={12} aria-hidden="true" /> Add sub-step</span>
        <div>
          {childKinds.map((kind) => {
            const meta = BUILDER_KIND_META[kind];
            const KindIcon = kind === "training" && sport === "strength" ? Dumbbell : meta.Icon;
            return (
              <button
                key={kind}
                type="button"
                data-kind={kind}
                onClick={() => {
                  const child = emptyRow(kind, sport, seed);
                  onChange({ children: [...children, child] });
                  onActiveChildChange(child.id);
                }}
              >
                <KindIcon size={12} aria-hidden="true" />
                {meta.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function BuilderDerivedIntensityPreview({ intensity, context }: { intensity: WorkoutIntensityInput; context: WorkoutEditorContext }) {
  const configuredZone = (key: keyof WorkoutEditorContext["zones"], preset: string | undefined, id: number | undefined) =>
    context.zones[key]?.find((zone) => zone.id === id || zone.key === preset || zone.label === preset);
  const clock = (secondsPerKm: number) => {
    const seconds = Math.round(secondsPerKm * (context.paceUnit === "mi" ? 1.609344 : 1));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}/${context.paceUnit}`;
  };
  if (intensity.type === "heartRatePercent") {
    const fallback = HEART_RATE_PRESETS[intensity.basis].find((zone) => zone.preset === intensity.preset);
    const zone = configuredZone(intensity.basis, intensity.preset, intensity.zoneId ?? fallback?.id);
    const low = intensity.lowPercent ?? zone?.lowPercent ?? fallback?.low;
    const high = intensity.highPercent ?? zone?.highPercent ?? fallback?.high;
    const reference = intensity.basis === "lthr" ? context.lthrBpm : context.maxHr;
    if (low !== undefined && high !== undefined && reference) {
      const derive = (percent: number) => intensity.basis === "reserve" && context.restingHr
        ? context.restingHr + (reference - context.restingHr) * percent / 100
        : reference * percent / 100;
      return <span className="workout-control-hint">Derived: {Math.round(derive(low))}-{Math.round(derive(high))} bpm</span>;
    }
  }
  if (intensity.type === "thresholdPacePercent" || intensity.type === "effortPacePercent") {
    const fallback = PACE_PRESETS.find((zone) => zone.preset === intensity.preset);
    const zone = configuredZone("thresholdPace", intensity.preset, intensity.zoneId ?? fallback?.id);
    const low = intensity.lowPercent ?? zone?.lowPercent ?? fallback?.low;
    const high = intensity.highPercent ?? zone?.highPercent ?? fallback?.high;
    if (low && high && context.thresholdPaceSecondsPerKm) {
      return <span className="workout-control-hint">Derived: {clock(context.thresholdPaceSecondsPerKm * 100 / high)} to {clock(context.thresholdPaceSecondsPerKm * 100 / low)}</span>;
    }
  }
  if (intensity.type === "ftpPercent") {
    const fallback = FTP_PRESETS.find((zone) => zone.preset === intensity.preset);
    const zone = configuredZone("ftp", intensity.preset, intensity.zoneId ?? fallback?.id);
    const low = intensity.lowPercent ?? zone?.lowPercent ?? fallback?.low;
    const high = intensity.highPercent ?? zone?.highPercent ?? fallback?.high;
    if (low !== undefined && high !== undefined && context.ftp) {
      return <span className="workout-control-hint">Derived: {Math.round(context.ftp * low / 100)}-{Math.round(context.ftp * high / 100)} W</span>;
    }
  }
  return null;
}

/* ================================================================ state */

export interface UseWorkoutBuilderOptions {
  /**
   * The workout to open, for an edit. Left out, the builder opens as Create
   * workout always has: three steps of a run, filled from the defaults.
   */
  seed?: RunWorkoutEditorDraft;
  /** The sport a new workout opens on. A seed brings its own. */
  initialSport?: WorkoutSport;
}

/**
 * Everything the builder holds, in one place, so the dialog around it can
 * read it.
 *
 * It is a hook rather than state inside `WorkoutBuilderWorkspace` because
 * Create workout keeps the builder's work while another tab is showing — the
 * workspace is unmounted then — and its Quick tab reads the same pool length.
 * The names are the ones `AddWorkoutModal` gave these when they lived there.
 *
 * `edited` is raised by what the athlete does and by nothing else: the
 * account's answer restating a default zone, or the catalog arriving, is not
 * an edit, and reading it as one would ask "discard changes?" of a dialog
 * nobody had touched.
 */
export function useWorkoutBuilder(api: CorosLinkApi, options: UseWorkoutBuilderOptions = {}) {
  const { unitSystem } = useUnitSystem();
  const { seed } = options;
  const [builderSport, setBuilderSportState] = useState<WorkoutSport>(
    seed?.sport ?? options.initialSport ?? "run"
  );
  const seededPool = seed?.sportOptions?.poolLength;
  const [builderPoolLength, setBuilderPoolLengthState] = useState(
    seededPool ? String(Number(seededPool.value.toFixed(2))) : "25"
  );
  /* The pool's unit is a function of the unit system and nothing else —
     `parseWorkoutEditorContext` derives `defaultPoolLength.unit` from exactly
     this, and both of the field's own change handlers restated it. Held as
     state seeded from that context, it was correct only once the context
     request came back: an athlete reading imperial who reached the swim field
     first, or whose context request failed (it is caught and dropped), sent
     COROS a 25 **metre** pool under a field labelled yd. Reading it here
     removes the load order from the question. The *length* still comes from
     the context, because that is the athlete's own pool and not a derivation. */
  const builderPoolUnit: "m" | "yd" = unitSystem === "imperial" ? "yd" : "m";
  const seededGrade = seed?.sportOptions?.gradingSystem;
  const [builderGradeSystem, setBuilderGradeSystemState] = useState<keyof typeof CLIMB_SYSTEM_IDS>(
    seededGrade ?? "yds"
  );
  const [builderExercises, setBuilderExercises] = useState<WorkoutExerciseOption[]>([]);
  const [builderExercisesLoading, setBuilderExercisesLoading] = useState(false);
  const [builderContext, setBuilderContext] = useState<WorkoutEditorContext>();
  const [builderName, setBuilderNameState] = useState(seed?.name ?? "");
  const [builderDescription, setBuilderDescriptionState] = useState(seed?.overview ?? "");
  /*
   * The first three steps are seeded before COROS has answered with the
   * athlete's thresholds, which is why `resolveStepDefaults` treats an absent
   * context as "not asked yet" rather than "has no FTP": a zone lowered here
   * would have nothing to raise it again once the answer landed.
   */
  const [rows, setRowsState] = useState<BuilderRow[]>(() =>
    seed
      ? editorDraftToBuilderRows(seed, unitSystem)
      : seedBuilderRows(options.initialSport ?? "run", { unitSystem })
  );
  const [activeBuilderRowId, setActiveBuilderRowId] = useState<number | null>(rows[0]?.id ?? null);
  const [activeBuilderChildId, setActiveBuilderChildId] = useState<number | null>(null);
  const [draggedBuilderRowId, setDraggedBuilderRowId] = useState<number | null>(null);
  const [dropTargetBuilderRowId, setDropTargetBuilderRowId] = useState<number | null>(null);
  const [builderReorderMessage, setBuilderReorderMessage] = useState("");
  const [edited, setEdited] = useState(false);

  /* What the athlete does goes through these; what COROS answers does not. */
  const setRows: typeof setRowsState = useCallback((update) => {
    setEdited(true);
    setRowsState(update);
  }, []);
  const setBuilderName = useCallback((value: string) => {
    setEdited(true);
    setBuilderNameState(value);
  }, []);
  const setBuilderDescription = useCallback((value: string) => {
    setEdited(true);
    setBuilderDescriptionState(value);
  }, []);
  const setBuilderPoolLength = useCallback((value: string) => {
    setEdited(true);
    setBuilderPoolLengthState(value);
  }, []);
  const setBuilderGradeSystem = useCallback((value: keyof typeof CLIMB_SYSTEM_IDS) => {
    setEdited(true);
    setBuilderGradeSystemState(value);
  }, []);

  useEffect(() => {
    void api.getWorkoutEditorContext(unitSystem)
      .then((context) => {
        setBuilderContext(context);
        // Steps seeded before this answer carry the Max HR family; restate
        // them in the one the account is actually scored against. COROS can
        // answer with nothing at all — no session, or a read that failed —
        // and then there is no family to restate them into.
        const basis = context?.heartRateBasis;
        if (!basis) return;
        setRowsState((current) => {
          const next = current.map((row) => syncRowHeartRateBasis(row, basis));
          return next.some((row, index) => row !== current[index]) ? next : current;
        });
        // Only the length: the context derives its unit from the unit system
        // it was asked with, which `builderPoolUnit` already reads directly.
        // A workout that states its own pool keeps it.
        if (!seededPool) {
          setBuilderPoolLengthState(String(Number(context.defaultPoolLength.value.toFixed(2))));
        }
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, unitSystem]);

  useEffect(() => {
    if (builderSport !== "strength" && builderSport !== "hyrox") {
      setBuilderExercises([]);
      setBuilderExercisesLoading(false);
      return;
    }
    let active = true;
    setBuilderExercisesLoading(true);
    void api.listWorkoutExercises(builderSport)
      .then((options) => { if (active) setBuilderExercises(options); })
      .catch(() => { if (active) setBuilderExercises([]); })
      .finally(() => { if (active) setBuilderExercisesLoading(false); });
    return () => { active = false; };
  }, [api, builderSport]);

  useEffect(() => {
    if (seededGrade && seed?.sport === builderSport) return;
    if ((builderSport === "indoorClimb" || builderSport === "bouldering") && builderContext?.climbSystems[builderSport]) {
      setBuilderGradeSystemState(builderContext.climbSystems[builderSport]!);
    }
  }, [builderContext, builderSport, seed?.sport, seededGrade]);

  const builderValid = rows.length > 0 && rows.every((row) =>
    rowIsValid(
      row,
      builderSport,
      builderExercises,
      builderExercisesLoading,
      unitSystem
    )
  );
  const builderSportMeta = BUILDER_SPORT_META[builderSport];
  const builderTotals = useMemo(() => builderWorkoutTotals(rows, builderSport), [rows, builderSport]);
  const builderStructure = useMemo(() => builderStructureCounts(rows), [rows]);
  const builderStepKinds = useMemo<BuilderKind[]>(() => {
    const supported = WORKOUT_SPORT_CAPABILITIES[builderSport].stepKinds;
    return BUILDER_ADD_KIND_ORDER.filter((kind) =>
      kind === "intervals"
        ? builderSport !== "strength"
        : (supported as readonly BuilderKind[]).includes(kind)
    );
  }, [builderSport]);

  const reorderBuilderRow = (sourceId: number, targetId: number) => {
    const sourceRow = rows.find((row) => row.id === sourceId);
    const nextRows = moveBuilderRow(rows, sourceId, targetId);
    if (!sourceRow || nextRows === rows) return;
    setRows(nextRows);
    const nextIndex = nextRows.findIndex((row) => row.id === sourceId);
    setBuilderReorderMessage(`${formatBuilderToken(sourceRow.kind)} moved to step ${nextIndex + 1}.`);
  };

  const moveBuilderRowBy = (rowId: number, direction: -1 | 1) => {
    const currentIndex = rows.findIndex((row) => row.id === rowId);
    const targetIndex = currentIndex + direction;
    const targetRow = rows[targetIndex];
    if (currentIndex < 0 || !targetRow) return;
    reorderBuilderRow(rowId, targetRow.id);
  };

  const builderSeed: RowSeed = { context: builderContext, unitSystem };

  const selectBuilderSport = (sport: WorkoutSport) => {
    // Re-selecting the active sport must not wipe the steps being built.
    if (sport === builderSport) return;
    const nextRows = seedBuilderRows(sport, builderSeed);
    setBuilderSportState(sport);
    setRows(nextRows);
    setActiveBuilderRowId(nextRows[0]?.id ?? null);
    setActiveBuilderChildId(null);
  };

  const addBuilderStep = (kind: BuilderKind) => {
    const nextRow = emptyRow(kind, builderSport, builderSeed);
    setRows((current) => [...current, nextRow]);
    setActiveBuilderRowId(nextRow.id);
    setActiveBuilderChildId(nextRow.children?.[0]?.id ?? null);
  };

  /** The workout as an edit saves it: see `builderRowsToEditorDraft`. */
  const toEditorDraft = (fallbackName: string): RunWorkoutEditorDraft =>
    builderRowsToEditorDraft(
      rows,
      {
        sport: builderSport,
        name: builderName.trim() || fallbackName,
        description: builderDescription.trim(),
        ...(builderSport === "swim"
          ? {
              poolLength: seededPool && builderPoolLength === String(Number(seededPool.value.toFixed(2)))
                ? seededPool
                : { value: Number(builderPoolLength), unit: builderPoolUnit }
            }
          : {}),
        ...(builderSport === "indoorClimb" || builderSport === "bouldering"
          ? { gradingSystem: builderGradeSystem }
          : {})
      },
      unitSystem,
      seed
    );

  return {
    unitSystem,
    edited,
    builderSport,
    builderPoolLength,
    setBuilderPoolLength,
    builderPoolUnit,
    builderGradeSystem,
    setBuilderGradeSystem,
    builderExercises,
    builderExercisesLoading,
    builderContext,
    builderName,
    setBuilderName,
    builderDescription,
    setBuilderDescription,
    rows,
    setRows,
    activeBuilderRowId,
    setActiveBuilderRowId,
    activeBuilderChildId,
    setActiveBuilderChildId,
    draggedBuilderRowId,
    setDraggedBuilderRowId,
    dropTargetBuilderRowId,
    setDropTargetBuilderRowId,
    builderReorderMessage,
    builderValid,
    builderSportMeta,
    builderTotals,
    builderStructure,
    builderStepKinds,
    builderSeed,
    reorderBuilderRow,
    moveBuilderRowBy,
    selectBuilderSport,
    addBuilderStep,
    toEditorDraft
  };
}

export type WorkoutBuilderState = ReturnType<typeof useWorkoutBuilder>;

/* ============================================================ workspace */

export interface WorkoutBuilderWorkspaceProps {
  builder: WorkoutBuilderState;
  /**
   * The sport is stated rather than offered. A workout that exists keeps its
   * sport — COROS cannot change one in place, and choosing another resets the
   * steps, which on an edit would throw the workout away.
   */
  sportLocked?: boolean;
  /** Under the description: Create workout's "Save to library" card. */
  settingsExtra?: ReactNode;
  /** The footer's leading edge, before the totals. */
  footerLead?: ReactNode;
  /** More totals, before the sport. */
  totalsExtra?: ReactNode;
  /** The footer's button. */
  action: ReactNode;
}

/**
 * The builder's body: settings beside the steps, and the footer under both.
 * This is the markup the Structured tab drew, moved rather than redrawn.
 */
export function WorkoutBuilderWorkspace({
  builder,
  sportLocked = false,
  settingsExtra,
  footerLead,
  totalsExtra,
  action
}: WorkoutBuilderWorkspaceProps) {
  const reducedMotion = useReducedMotion();
  const {
    unitSystem,
    builderSport,
    builderPoolLength,
    setBuilderPoolLength,
    builderGradeSystem,
    setBuilderGradeSystem,
    builderExercises,
    builderExercisesLoading,
    builderContext,
    builderName,
    setBuilderName,
    builderDescription,
    setBuilderDescription,
    rows,
    setRows,
    activeBuilderRowId,
    setActiveBuilderRowId,
    activeBuilderChildId,
    setActiveBuilderChildId,
    draggedBuilderRowId,
    setDraggedBuilderRowId,
    dropTargetBuilderRowId,
    setDropTargetBuilderRowId,
    builderReorderMessage,
    builderSportMeta,
    builderTotals,
    builderStructure,
    builderStepKinds,
    builderSeed,
    reorderBuilderRow,
    moveBuilderRowBy,
    selectBuilderSport,
    addBuilderStep
  } = builder;

  return (
    <div className="calendar-modal-body calendar-builder-body">
      <div className="calendar-builder-workspace">
        <aside className="calendar-builder-settings" aria-label="Workout settings">
          <div className="calendar-builder-settings-copy">
            <h4>Workout settings</h4>
            <p>Set the basics for your workout.</p>
          </div>
          {/* Nine sports with an icon apiece: a grid of them was the
              tallest thing in this modal, for a choice made once per
              workout. The icon rides along in the trigger, so the
              chosen sport still reads at a glance. */}
          {sportLocked ? (
            /* A workout that exists keeps its sport: COROS cannot
               change one in place, and a plan session is edited as
               the sport it was written for. Stated where the picker
               would be, so the column reads the same either way. */
            <div className="calendar-field">
              <span className="calendar-field-label">
                <span>Sport</span>
              </span>
              <span className="calendar-builder-readonly-value calendar-builder-sport-value">
                <builderSportMeta.Icon size={16} aria-hidden="true" />
                {formatWorkoutSport(builderSport)}
              </span>
            </div>
          ) : (
            <label className="calendar-field">
              <span className="calendar-field-label">
                <span>Sport</span>
              </span>
              <OptionGroup
                label="Sport"
                mode="dropdown"
                size="md"
                value={builderSport}
                options={WORKOUT_SPORTS.map((sport) => {
                  const { Icon } = BUILDER_SPORT_META[sport];
                  return {
                    value: sport,
                    label: formatWorkoutSport(sport),
                    icon: <Icon size={16} aria-hidden="true" />
                  };
                })}
                onChange={selectBuilderSport}
              />
            </label>
          )}
          {builderSport === "swim" ? <div className="calendar-field-row"><label className="calendar-field"><span>Pool length ({swimDistanceUnit(unitSystem)})</span><input type="number" min="1" value={builderPoolLength} onChange={(event) => setBuilderPoolLength(event.target.value)} /></label></div> : null}
          {(builderSport === "indoorClimb" || builderSport === "bouldering") ? <label className="calendar-field"><span>Grading system</span><SelectDropdown label="Grading system" value={builderGradeSystem} options={(Object.keys(CLIMB_SYSTEM_IDS) as Array<keyof typeof CLIMB_SYSTEM_IDS>).map((system) => ({ value: system, label: formatBuilderToken(system) }))} portal onChange={setBuilderGradeSystem} /></label> : null}
          <label className="calendar-field">
            <span className="calendar-field-label">
              <span>Workout name</span>
              <small>Optional</small>
            </span>
            <input
              type="text"
              value={builderName}
              onChange={(event) => setBuilderName(event.target.value)}
              placeholder={builderSport === "strength" ? "Full-body strength" : builderSport === "swim" ? "Pool endurance" : builderSport === "bike" ? "Threshold ride" : builderSport === "indoorClimb" || builderSport === "bouldering" ? "Climbing session" : builderSport === "hyrox" ? "Hybrid Fitness mixed session" : "6 x 800 m"}
            />
          </label>
          <label className="calendar-field calendar-builder-description">
            <span className="calendar-field-label">
              <span>Description</span>
              <small id="calendar-builder-description-count">{builderDescription.length} / 300</small>
            </span>
            <textarea
              value={builderDescription}
              maxLength={300}
              rows={4}
              onChange={(event) => setBuilderDescription(event.target.value)}
              aria-describedby="calendar-builder-description-count"
              placeholder="Add coaching notes or the goal of this workout"
            />
          </label>
          {settingsExtra}
        </aside>

        <section className="calendar-builder-canvas" aria-labelledby="calendar-builder-steps-title">
          <header className="calendar-builder-canvas-header">
            <div>
              <h4 id="calendar-builder-steps-title">Workout steps</h4>
              <p>Repeat groups contain their own ordered sub-steps.</p>
            </div>
            <span className="calendar-builder-step-count">
              {builderStructure.steps} {builderStructure.steps === 1 ? "step" : "steps"}
              {builderStructure.repeatGroups > 0
                ? `, ${builderStructure.repeatGroups} ${builderStructure.repeatGroups === 1 ? "repeat" : "repeats"}`
                : ""}
            </span>
          </header>
          <span className="sr-only" role="status" aria-live="polite">{builderReorderMessage}</span>
          <div className="calendar-builder-rows">
        {rows.map((row, index) => {
          const validationMessage = builderRowValidationMessage(
            row,
            builderSport,
            builderExercises,
            builderExercisesLoading,
            unitSystem
          );
          // A locked step has nothing to open: it is kept as COROS has it.
          const isActive = activeBuilderRowId === row.id && !row.locked;
          const stepKind = row.kind === "intervals" ? "training" : row.kind;
          const selectedExercise = row.exerciseId
            ? builderExercises.find((exercise) => exercise.id === row.exerciseId)
            : undefined;
          const exercisePreviewUrl = selectedExercise?.media?.find((media) => media.coverUrl)?.coverUrl
            ?? selectedExercise?.thumbnailUrl;
          const StepIcon = row.kind === "training" && builderSport === "strength"
            ? Dumbbell
            : BUILDER_KIND_META[row.kind].Icon;
          return <motion.section
            key={row.id}
            layout={reducedMotion ? false : "position"}
            draggable={rows.length > 1}
            className={`calendar-builder-row ${isActive ? "is-active" : "is-collapsed"} ${exercisePreviewUrl ? "has-exercise-preview" : ""} ${validationMessage ? "has-error" : ""} ${draggedBuilderRowId === row.id ? "is-dragging" : ""} ${dropTargetBuilderRowId === row.id ? "is-drop-target" : ""} ${row.locked ? "is-locked" : ""}`}
            data-step-kind={stepKind}
            data-builder-kind={row.kind}
            aria-labelledby={`builder-step-${row.id}`}
            /*
             * Tabbing into a field inside a collapsed step opens it —
             * the body is `height: 0`, not `display: none`, so its
             * inputs are still reachable by keyboard and would
             * otherwise be typed into blind.
             *
             * The **header is exempt**, and not only the reorder
             * controls it used to exempt. A press on the expand toggle
             * focuses the button on `mousedown` and fires `click` on
             * `mouseup`: focus opened the step, and the click that
             * followed read it as already open and shut it again —
             * about 20% into the reveal, which is exactly how long
             * React took to flush the focus render. It looked
             * intermittent because it is a race with that flush, and
             * it was worst when moving between steps, where the focus
             * genuinely changed something. None of the header's
             * controls edits the step, so none of them has any
             * business opening it.
             */
            onFocusCapture={(event) => {
              if (!row.locked && !(event.target as HTMLElement).closest(".calendar-builder-row-header")) {
                setActiveBuilderRowId(row.id);
              }
            }}
            onDragStartCapture={(event) => {
              if (!(event.target as HTMLElement).closest(".calendar-builder-drag-handle")) {
                event.preventDefault();
                return;
              }
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/calendar-builder-row", String(row.id));
              setDraggedBuilderRowId(row.id);
              setDropTargetBuilderRowId(null);
            }}
            onDragEnd={() => {
              setDraggedBuilderRowId(null);
              setDropTargetBuilderRowId(null);
            }}
            onDragEnter={(event) => {
              if (draggedBuilderRowId !== null && draggedBuilderRowId !== row.id) {
                event.preventDefault();
                setDropTargetBuilderRowId(row.id);
              }
            }}
            onDragOver={(event) => {
              if (draggedBuilderRowId !== null && draggedBuilderRowId !== row.id) {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
              }
            }}
            onDrop={(event) => {
              event.preventDefault();
              const sourceId = Number(event.dataTransfer.getData("text/calendar-builder-row")) || draggedBuilderRowId;
              if (sourceId !== null) reorderBuilderRow(sourceId, row.id);
              setDraggedBuilderRowId(null);
              setDropTargetBuilderRowId(null);
            }}
          >
            <header className="calendar-builder-row-header">
              <div className="calendar-builder-reorder-controls" aria-label={`Reorder block ${index + 1}`}>
                <span
                  className="calendar-builder-drag-handle"
                  draggable={rows.length > 1}
                  title="Drag to reorder"
                >
                  <GripVertical size={16} aria-hidden="true" />
                </span>
                <span className="calendar-builder-order-buttons">
                  <button
                    type="button"
                    onClick={() => moveBuilderRowBy(row.id, -1)}
                    disabled={index === 0}
                    aria-label={`Move block ${index + 1} up`}
                    title="Move up"
                  >
                    <ChevronUp size={13} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveBuilderRowBy(row.id, 1)}
                    disabled={index === rows.length - 1}
                    aria-label={`Move block ${index + 1} down`}
                    title="Move down"
                  >
                    <ChevronDown size={13} aria-hidden="true" />
                  </button>
                </span>
              </div>
              <button
                type="button"
                className="calendar-builder-row-toggle"
                aria-expanded={isActive}
                aria-controls={`builder-step-content-${row.id}`}
                disabled={Boolean(row.locked)}
                aria-label={`${isActive ? "Collapse" : "Expand"} ${row.kind === "intervals" ? "repeat group" : "step"} ${index + 1}: ${BUILDER_KIND_META[row.kind].label}`}
                onClick={() => setActiveBuilderRowId(
                  (current) => current === row.id ? null : row.id
                )}
              >
                <span className="calendar-builder-step-icon" aria-hidden="true">
                  <StepIcon size={15} />
                </span>
                <span className="calendar-builder-step-label">{row.kind === "intervals" ? "Repeat" : "Step"} {index + 1}</span>
                <strong id={`builder-step-${row.id}`}>{row.locked ? row.origin?.node.name ?? BUILDER_KIND_META[row.kind].label : row.kind === "intervals" ? `Repeat ${row.repeats || 0} times` : BUILDER_KIND_META[row.kind].label}</strong>
                {/* The chevron sits against the name, not at the far
                    end of the row. The summary is drawn only while the
                    step is collapsed, so a chevron after it changed
                    places on every open and close — the one control
                    whose job is to be pressed twice. */}
                {row.locked ? null : <ChevronDown className={isActive ? "is-open" : ""} size={16} aria-hidden="true" />}
                {!isActive && exercisePreviewUrl ? (
                  <span className="calendar-builder-row-thumbnail" aria-hidden="true">
                    <img
                      src={exercisePreviewUrl}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      onError={(event) => { event.currentTarget.hidden = true; }}
                    />
                  </span>
                ) : null}
                <span className="calendar-builder-row-summary" aria-label="Step summary">
                  {builderRowSummary(row, builderSport, unitSystem, selectedExercise?.name).map((item) => (
                    <span className="calendar-builder-row-summary-item" key={item.label}>
                      <span>{item.label}</span>
                      <strong>{item.value}</strong>
                    </span>
                  ))}
                </span>
              </button>
              <div className="calendar-builder-row-actions">
                <button
                  type="button"
                  className="ghost-button calendar-builder-row-action calendar-builder-duplicate"
                  onClick={() => {
                    const duplicate = cloneBuilderRow(row);
                    setRows((current) => [
                      ...current.slice(0, index + 1),
                      duplicate,
                      ...current.slice(index + 1)
                    ]);
                    setActiveBuilderRowId(duplicate.id);
                    setActiveBuilderChildId(duplicate.children?.[0]?.id ?? null);
                  }}
                  disabled={Boolean(row.locked)}
                  aria-label={`Duplicate ${row.kind === "intervals" ? "repeat group" : "step"} ${index + 1}`}
                  title={row.kind === "intervals" ? "Duplicate repeat group" : "Duplicate step"}
                >
                  <Copy size={14} aria-hidden="true" /> <span>Duplicate</span>
                </button>
                <button
                  type="button"
                  className="ghost-button calendar-builder-row-action calendar-builder-delete"
                  onClick={() => {
                    const nextRows = rows.filter((candidate) => candidate.id !== row.id);
                    setRows(nextRows);
                    if (row.children?.some((child) => child.id === activeBuilderChildId)) {
                      setActiveBuilderChildId(null);
                    }
                    setActiveBuilderRowId((current) => current === row.id
                      ? nextRows[Math.min(index, nextRows.length - 1)]?.id ?? null
                      : current);
                  }}
                  disabled={rows.length === 1}
                  aria-label={`Delete ${row.kind === "intervals" ? "repeat group" : "step"} ${index + 1}`}
                  title={rows.length === 1 ? "A workout needs at least one block" : row.kind === "intervals" ? "Delete repeat group" : "Delete step"}
                >
                  <Trash2 size={14} aria-hidden="true" /> <span>Delete</span>
                </button>
              </div>
            </header>

            <AnimatePresence initial={false}>
            {isActive ? <motion.div
              key={`builder-step-content-${row.id}`}
              className="calendar-builder-row-reveal"
              initial={reducedMotion ? false : { height: 0, opacity: 0 }}
              animate={{
                height: "auto",
                opacity: 1,
                transitionEnd: { overflow: "visible" }
              }}
              exit={{ height: 0, opacity: 0, overflow: "hidden" }}
              transition={reducedMotion ? { duration: 0 } : {
                height: { duration: 0.24, ease: [0.4, 0, 0.2, 1] },
                opacity: { duration: 0.14, ease: "easeOut" }
              }}
            >
            <div id={`builder-step-content-${row.id}`}>
              {row.kind === "intervals" ? (
                <BuilderRepeatFields
                  row={row}
                  sport={builderSport}
                  context={builderContext}
                  exerciseOptions={builderExercises}
                  exercisesLoading={builderExercisesLoading}
                  activeChildId={activeBuilderChildId}
                  reducedMotion={reducedMotion}
                  onActiveChildChange={setActiveBuilderChildId}
                  onChange={(update) => setRows((current) => current.map((candidate) =>
                    candidate.id === row.id ? { ...candidate, ...update } : candidate
                  ))}
                />
              ) : (
                <BuilderStepFields
                  row={row}
                  sport={builderSport}
                  context={builderContext}
                  exerciseOptions={builderExercises}
                  exercisesLoading={builderExercisesLoading}
                  allowedKinds={builderStepKinds}
                  onChange={(update) => setRows((current) => current.map((candidate) =>
                    candidate.id === row.id ? { ...candidate, ...update } : candidate
                  ))}
                  onKindChange={(kind) => {
                    const nextRow = changeBuilderRowKind(row, kind, builderSport, builderSeed);
                    setRows((current) => current.map((candidate) =>
                      candidate.id === row.id ? nextRow : candidate
                    ));
                    setActiveBuilderChildId(
                      kind === "intervals" ? nextRow.children?.[0]?.id ?? null : null
                    );
                  }}
                />
              )}
            </div>
            </motion.div> : null}
            </AnimatePresence>
          </motion.section>;
        })}
          <div className="calendar-builder-add-bar" role="group" aria-label="Add a workout block">
            <span className="calendar-builder-add-label">
              <Plus size={14} aria-hidden="true" /> Add block
            </span>
            <div className="calendar-builder-add-chips">
              {builderStepKinds.map((kind) => {
                const meta = BUILDER_KIND_META[kind];
                const KindIcon = kind === "training" && builderSport === "strength" ? Dumbbell : meta.Icon;
                return (
                  <button
                    key={kind}
                    type="button"
                    data-kind={kind}
                    className="calendar-builder-add-chip"
                    onClick={() => addBuilderStep(kind)}
                  >
                    <KindIcon size={14} aria-hidden="true" />
                    <span>{meta.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
          </div>
        </section>
      </div>
      <footer className="calendar-modal-footer calendar-builder-footer">
        {footerLead}
        <span className="calendar-builder-totals">
          <span className="calendar-builder-total">
            <ListTree size={11} aria-hidden="true" />
            {builderStructure.steps} {builderStructure.steps === 1 ? "step" : "steps"}
            {builderStructure.repeatGroups > 0
              ? `, ${builderStructure.repeatGroups} ${builderStructure.repeatGroups === 1 ? "repeat" : "repeats"}`
              : ""}
          </span>
          {builderTotals.minutes >= 1 ? (
            <span className="calendar-builder-total" title="Estimated moving time">
              <Timer size={11} aria-hidden="true" />
              ≈{formatBuilderMinutes(builderTotals.minutes)}
            </span>
          ) : null}
          {builderTotals.distance > 0 ? (
            <span className="calendar-builder-total" title="Total distance">
              <Route size={11} aria-hidden="true" />
              {formatBuilderDistance(
                builderTotals.distance,
                builderTotals.distanceUnit,
                unitSystem
              )}
            </span>
          ) : null}
          {totalsExtra}
          <span className="calendar-builder-total calendar-builder-total-sport">
            <builderSportMeta.Icon size={11} aria-hidden="true" />
            {formatWorkoutSport(builderSport)}
          </span>
        </span>
        {action}
      </footer>
    </div>
  );
}
