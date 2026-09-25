import { CalendarDays, ChevronLeft, ChevronRight, Minus, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { WorkoutSport } from "../../electron/types";
import { TRAINING_PLAN_GENERATION_LIMITS, addPlanWeeks } from "../../electron/trainingPlanGeneration";
import { parsePlanDay } from "../../electron/trainingPlanDomain";
import { WORKOUT_SPORTS, formatWorkoutSport } from "../../electron/workoutCapabilities";
import { OptionChips, OptionGroup } from "../components/OptionGroup";
import { MonthDayPicker } from "./MonthDayPicker";
import {
  GOAL_KINDS,
  LEVELS,
  RACE_DISTANCES,
  formatPlanDate,
  raceDayIso,
  raceDayKey,
  type GeneratorForm
} from "./planGeneratorModel";
import { sportTheme } from "./sportTheme";

const LIMITS = TRAINING_PLAN_GENERATION_LIMITS;

export interface StepProps {
  form: GeneratorForm;
  firstMonday: string;
  update: (patch: Partial<GeneratorForm>, field?: string) => void;
  problemOf: (field: string) => string | undefined;
  spanSentence: string;
}

interface StepperProps {
  id: string;
  value: number;
  min: number;
  max: number;
  invalid?: boolean;
  decreaseLabel: string;
  increaseLabel: string;
  /** What is drawn between the buttons, when it is not the number itself. */
  display?: ReactNode;
  onChange: (value: number) => void;
}

export function Stepper({ id, value, min, max, invalid, decreaseLabel, increaseLabel, display, onChange }: StepperProps) {
  return (
    <span className={`plan-generator-stepper${invalid ? " is-invalid" : ""}`} id={id}>
      <button type="button" aria-label={decreaseLabel} disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))}>
        {display ? <ChevronLeft size={14} /> : <Minus size={13} />}
      </button>
      <strong aria-live="polite">{display ?? value}</strong>
      <button type="button" aria-label={increaseLabel} disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))}>
        {display ? <ChevronRight size={14} /> : <Plus size={13} />}
      </button>
    </span>
  );
}

/**
 * A field's own line of trouble. Shown once the athlete has changed that field
 * or tried to move on, so a form nobody has touched is not already red.
 */
export function FieldProblem({ field, message }: { field: string; message?: string }) {
  return message ? (
    <p className="plan-generator-inline-error" id={`plan-generator-${field}-problem`}>
      {message}
    </p>
  ) : null;
}

export function invalidProps(field: string, message: string | undefined) {
  return message ? { "aria-invalid": true as const, "aria-describedby": `plan-generator-${field}-problem` } : {};
}

/** "starts today", "next week", "in 3 weeks" — how far off the first week is. */
function startsIn(iso: string, today = new Date()): string {
  const start = parsePlanDay(iso);
  if (!start) return "";
  const midday = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12);
  const days = Math.round((start.valueOf() - midday.valueOf()) / 86_400_000);
  if (days <= 0) return "starts today";
  const weeks = Math.ceil(days / 7);
  return weeks === 1 ? "next week" : `in ${weeks} weeks`;
}

/**
 * Race day: a month of days opening under its button, as the Workouts
 * reader's schedule picker does, so a race is placed by the week it falls in.
 * Escape and a press outside close it — Escape in the capture phase, so the
 * generator's own Escape does not also close the dialog.
 */
function RaceDayPicker({ value, min, invalid, onChange }: { value: string; min: string; invalid: boolean; onChange: (iso: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    ref.current?.querySelector<HTMLButtonElement>(".tl-daypick-day.is-selected")?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);
  const minKey = raceDayKey(min);
  return (
    <div className="plan-generator-racepop" ref={ref}>
      <button
        type="button"
        id="plan-generator-race"
        className={`plan-generator-racepop-trigger${invalid ? " is-invalid" : ""}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <CalendarDays size={14} aria-hidden="true" />
        {value ? formatPlanDate(value, true) : "Pick race day"}
      </button>
      {open ? (
        <div className="plan-generator-racepop-panel" role="dialog" aria-label="Race day">
          <MonthDayPicker
            label="Race day"
            value={value ? raceDayKey(value) : minKey}
            min={minKey}
            onChange={(key) => {
              onChange(raceDayIso(key));
              setOpen(false);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

/** The goal field's words, per kind. The hints are one line each, so the field is one height whatever is picked. */
const GOAL_FIELD: Record<GeneratorForm["goalKind"], { title: string; qualifier: string; placeholder: string; hint: string }> = {
  race: {
    title: "The race",
    qualifier: "name, course, a target time",
    placeholder: "Example: Hanoi Half, aiming for 1:45",
    hint: "A target time is what Coach sets the paces from."
  },
  base: {
    title: "In your words",
    qualifier: "optional",
    placeholder: "Example: Run five days a week without niggles",
    hint: "Coach reads this beside the goal you picked."
  },
  return: {
    title: "In your words",
    qualifier: "optional",
    placeholder: "Example: Back from a calf strain, six weeks off",
    hint: "Coach reads this beside the goal you picked."
  },
  hybrid: {
    title: "In your words",
    qualifier: "optional",
    placeholder: "Example: HYROX in the spring, two gym days a week",
    hint: "Coach reads this beside the goal you picked."
  },
  other: {
    title: "Describe your goal",
    qualifier: "required",
    placeholder: "Example: Get fit for a ski trip in February and keep two gym days a week",
    hint: "Coach reads this as the goal — say what you want to do, and by when."
  }
};

/** What the plan is for: the kind of goal, its words, its length and dates, the level and the sports. */
export function GeneratorGoalStep({ form, firstMonday, update, problemOf, spanSentence }: StepProps) {
  const startDate = addPlanWeeks(firstMonday, form.startOffset);
  const goalProblem = problemOf("goal");
  const goalField = GOAL_FIELD[form.goalKind];
  const toggleSport = (sport: WorkoutSport) =>
    update({ sports: form.sports.includes(sport) ? form.sports.filter((item) => item !== sport) : [...form.sports, sport] }, "sports");

  return (
    <div className="plan-generator-step">
      <fieldset id="plan-generator-kind">
        <legend>What kind of goal?</legend>
        <div className="plan-generator-cards plan-generator-goal-kinds">
          {GOAL_KINDS.map((option) => (
            <button
              type="button"
              key={option.value}
              className={`plan-generator-goal-kind${form.goalKind === option.value ? " is-selected" : ""}`}
              aria-pressed={form.goalKind === option.value}
              onClick={() => update({ goalKind: option.value })}
            >
              <strong>{option.label}</strong>
              <small>{option.hint}</small>
            </button>
          ))}
        </div>
      </fieldset>

      {/* One field for every kind, the size "Something else" needs: it used to
          be a one-line input for four kinds and a four-line box for the fifth,
          so picking a kind jumped everything below it. */}
      <label className="plan-generator-goal">
        <span>{goalField.title} <small>{goalField.qualifier}</small></span>
        <textarea
          id="plan-generator-goal"
          rows={4}
          value={form.goal}
          maxLength={LIMITS.goalLength}
          placeholder={goalField.placeholder}
          onChange={(event) => update({ goal: event.target.value }, "goal")}
          {...invalidProps("goal", goalProblem)}
        />
        <small>{goalField.hint}</small>
      </label>
      <FieldProblem field="goal" message={goalProblem} />

      {form.goalKind === "race" ? (
        <div className="plan-generator-row">
          <div className="plan-generator-field" role="group" aria-labelledby="plan-generator-distance-label">
            <span id="plan-generator-distance-label">Distance</span>
            <OptionGroup
              label="Distance"
              size="sm"
              value={form.raceDistance || "none"}
              options={[...RACE_DISTANCES.map((distance) => ({ value: distance, label: distance })), { value: "none", label: "Other" }]}
              onChange={(distance) => update({ raceDistance: distance === "none" ? "" : distance }, "race")}
            />
          </div>
          <div className="plan-generator-field" role="group" aria-labelledby="plan-generator-race-label">
            <span id="plan-generator-race-label">Race day</span>
            <RaceDayPicker
              value={form.raceDate}
              min={addPlanWeeks(startDate, 1)}
              invalid={Boolean(problemOf("race"))}
              onChange={(raceDate) => update({ raceDate }, "race")}
            />
          </div>
        </div>
      ) : (
        <div className="plan-generator-row">
          <div className="plan-generator-field" role="group" aria-labelledby="plan-generator-length-label">
            <span id="plan-generator-length-label">How long?</span>
            <OptionGroup
              label="How long"
              size="sm"
              value={form.lengthMode}
              options={[{ value: "coach", label: "Coach decides" }, { value: "set", label: "Set the length" }]}
              onChange={(lengthMode) => update({ lengthMode }, "weeks")}
            />
          </div>
          {form.lengthMode === "set" ? (
            <div className="plan-generator-field" role="group" aria-labelledby="plan-generator-weeks-label">
              <span id="plan-generator-weeks-label">Weeks</span>
              <Stepper
                id="plan-generator-weeks"
                value={form.weeks}
                min={1}
                max={LIMITS.maxWeeks}
                decreaseLabel="Fewer weeks"
                increaseLabel="More weeks"
                onChange={(weeks) => update({ weeks }, "weeks")}
              />
            </div>
          ) : null}
        </div>
      )}
      <FieldProblem field="race" message={problemOf("race")} />
      <FieldProblem field="weeks" message={problemOf("weeks")} />

      {/* Groups, not labels: a label forwards a click on its text to the first
          control inside it, which here is the "earlier" button. */}
      <div className="plan-generator-field" role="group" aria-labelledby="plan-generator-start-label">
        <span id="plan-generator-start-label">First week <small>{startsIn(startDate)}</small></span>
        <Stepper
          id="plan-generator-start"
          value={form.startOffset}
          min={0}
          max={LIMITS.maxLeadWeeks}
          invalid={Boolean(problemOf("start"))}
          decreaseLabel="A week earlier"
          increaseLabel="A week later"
          display={formatPlanDate(startDate)}
          onChange={(startOffset) => update({ startOffset }, "start")}
        />
      </div>
      <p className="plan-generator-span" aria-live="polite">{spanSentence}</p>
      <FieldProblem field="start" message={problemOf("start")} />

      <fieldset id="plan-generator-difficulty" className={problemOf("difficulty") ? "is-invalid" : undefined}>
        <legend>Level</legend>
        <div className="plan-generator-cards plan-generator-segmented">
          {LEVELS.map((option) => (
            <button
              type="button"
              key={option.value}
              className={form.difficulty === option.value ? "is-selected" : ""}
              aria-pressed={form.difficulty === option.value}
              onClick={() => update({ difficulty: option.value }, "difficulty")}
            >
              <strong>{option.label}</strong>
              <small>{option.hint}</small>
            </button>
          ))}
        </div>
        <FieldProblem field="difficulty" message={problemOf("difficulty")} />
      </fieldset>

      <fieldset id="plan-generator-sports" className={problemOf("sports") ? "is-invalid" : undefined}>
        <legend>Sports</legend>
        <OptionChips
          label="Sports"
          className="plan-generator-sports"
          values={form.sports}
          options={WORKOUT_SPORTS.map((sport) => {
            const theme = sportTheme(sport);
            const SportIcon = theme.icon;
            return { value: sport, label: formatWorkoutSport(sport), icon: <SportIcon size={13} aria-hidden="true" /> };
          })}
          colorOf={(sport) => sportTheme(sport as WorkoutSport).color}
          onToggle={(sport) => toggleSport(sport as WorkoutSport)}
        />
        <FieldProblem field="sports" message={problemOf("sports")} />
      </fieldset>
    </div>
  );
}
