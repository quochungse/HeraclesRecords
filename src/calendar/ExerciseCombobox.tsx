/**
 * The exercise field: what has been chosen, and the way into the library.
 *
 * **It is a button, and it is drawn as one.** It used to be a text box with a
 * dropdown of names under it, which asked the athlete to already know what a
 * movement is called and could show one 48px still at a time — for a catalog
 * of several hundred movements that each ship a demonstration clip. Choosing
 * happens in `ExercisePickerDialog` now, which has room for the filters and
 * the pictures.
 *
 * The first pass kept the old shell: a magnifier, a caret and a divider down
 * the right edge. Every one of those is the vocabulary of a field you type
 * into and a menu that drops from it, so the control still read as a search
 * box that had stopped taking text. What it says now is what it does — the
 * movement, or an invitation to pick one, and `Change` / `Browse` at the end.
 *
 * The props are unchanged, so every surface that draws this field — the two in
 * the calendar's builder and the two in the workout editor — got the picker
 * without being touched. `placeholder` is now the button's empty-state label
 * rather than a search hint.
 *
 * `onChange` therefore fires only on a pick, and a pick always carries a COROS
 * id. Free text used to reach it on every keystroke, which is what let a
 * strength step be saved with a name COROS has never heard of.
 */
import { ChevronRight, Dumbbell } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import type { WorkoutExerciseOption } from "../../electron/types";
import { resolveExerciseName } from "../training/exerciseNames";
import { ExercisePreview } from "./ExercisePreview";
import { ExercisePickerDialog, type LabeledExerciseOption } from "./ExercisePickerDialog";

export interface ExerciseComboboxSelection {
  name: string;
  id?: string;
  exerciseKind?: number;
}

interface ExerciseComboboxProps {
  value: string;
  selectedId?: string;
  options: WorkoutExerciseOption[];
  /** What the button says while nothing is chosen — "Choose an exercise". */
  placeholder: string;
  label: string;
  loading?: boolean;
  disabled?: boolean;
  details?: ReactNode;
  /** Suppress the built-in demonstration plate when the host renders its own. */
  hidePreview?: boolean;
  onChange: (selection: ExerciseComboboxSelection) => void;
}

function exerciseLabel(option: WorkoutExerciseOption): string {
  return resolveExerciseName(option.name) || option.name;
}

export function ExerciseCombobox({
  value,
  selectedId,
  options,
  placeholder,
  label,
  loading = false,
  disabled = false,
  details,
  hidePreview = false,
  onChange
}: ExerciseComboboxProps) {
  const [isOpen, setIsOpen] = useState(false);

  const labeledOptions = useMemo<LabeledExerciseOption[]>(() => options
    .map((option) => ({ ...option, label: exerciseLabel(option) }))
    .sort((left, right) => left.label.localeCompare(right.label)), [options]);
  const selectedOption = useMemo(
    () => labeledOptions.find((option) => option.id === selectedId),
    [labeledOptions, selectedId]
  );
  const hasPreview = !hidePreview
    && Boolean(selectedOption?.media?.some((entry) => entry.videoUrl));
  const still = selectedOption?.media?.find((entry) => entry.coverUrl)?.coverUrl
    ?? selectedOption?.thumbnailUrl;

  return (
    <div className={`exercise-combobox ${hasPreview ? "has-inline-video" : ""}`}>
      <div className="exercise-combobox-picker">
        <button
          type="button"
          className={`exercise-choice ${value ? "is-chosen" : "is-empty"}`}
          aria-haspopup="dialog"
          aria-label={value ? `${label}: ${value}. Choose another` : `Choose ${label.toLocaleLowerCase()}`}
          disabled={disabled}
          onClick={() => setIsOpen(true)}
        >
          <span className="exercise-choice-art" aria-hidden="true">
            {still ? (
              <img
                src={still}
                alt=""
                decoding="async"
                onError={(event) => { event.currentTarget.hidden = true; }}
              />
            ) : <Dumbbell size={18} />}
          </span>
          <span className="exercise-choice-name">{value || placeholder}</span>
          <span className="exercise-choice-action" aria-hidden="true">
            {value ? "Change" : "Browse"}
            <ChevronRight size={14} />
          </span>
        </button>

        {details ? <div className="exercise-combobox-details">{details}</div> : null}
      </div>

      {hasPreview ? (
        <ExercisePreview
          option={selectedOption}
          name={selectedOption?.label ?? ""}
        />
      ) : null}

      {isOpen ? (
        <ExercisePickerDialog
          title={label}
          options={labeledOptions}
          selectedId={selectedId}
          loading={loading}
          onPick={(option) => {
            setIsOpen(false);
            onChange({
              name: option.label,
              id: option.id,
              exerciseKind: option.exerciseKind
            });
          }}
          onClose={() => setIsOpen(false)}
        />
      ) : null}
    </div>
  );
}
