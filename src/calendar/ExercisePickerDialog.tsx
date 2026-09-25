/**
 * Choosing a movement is a screen, not a dropdown.
 *
 * COROS's Strength and Hybrid Fitness catalogs run to several hundred
 * movements, each with a demonstration clip. A menu under a text field could
 * show a name and a 48px still, and the only way through it was to already
 * know what the movement is called — which is the one thing an athlete
 * browsing for an exercise does not.
 *
 * So the picker takes the surface: a filter kind across the top, its values
 * down the left with a picture apiece, and the movements themselves on the
 * right with their own thumbnail and a play button. **All** drops the value
 * column, because there is nothing to narrow by.
 *
 * Every facet is derived from the movement's name — see `exerciseFacets.ts`
 * for why, and for what a movement no rule recognises does.
 */
import { Play, Search, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { ExerciseSearchEquipment } from "../../electron/exerciseCatalogSearch";
import type { WorkoutExerciseOption } from "../../electron/types";
import { OptionGroup } from "../components/OptionGroup";
import type { MuscleId } from "../strength/muscles";
import { ExercisePreview } from "./ExercisePreview";
import { BodyGlyph, EquipmentGlyph } from "./ExerciseFacetGlyph";
import {
  BODY_PART_LABELS,
  BODY_PART_MUSCLES,
  EQUIPMENT_LABELS,
  EXERCISE_BODY_PARTS,
  EXERCISE_EQUIPMENT_ORDER,
  EXERCISE_FACET_KINDS,
  EXERCISE_MUSCLE_ORDER,
  exerciseFacets,
  muscleAnatomy,
  muscleLabel,
  type ExerciseBodyPartId,
  type ExerciseFacetKind
} from "./exerciseFacets";

export interface LabeledExerciseOption extends WorkoutExerciseOption {
  label: string;
}

interface ExercisePickerDialogProps {
  /** Names the catalog being browsed — "Exercise", "Hybrid Fitness exercise". */
  title: string;
  options: readonly LabeledExerciseOption[];
  selectedId?: string;
  loading: boolean;
  onPick: (option: LabeledExerciseOption) => void;
  onClose: () => void;
}

interface FacetValue {
  /** The stored value; `bodyPart`, `muscle` and `equipment` share this field. */
  value: string;
  label: string;
  /** The muscle's anatomical name. Nothing else carries a second line. */
  detail?: string;
  glyph: ReactNode;
  count: number;
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function videoUrl(option: WorkoutExerciseOption): string | undefined {
  return option.media?.find((entry) => entry.videoUrl)?.videoUrl;
}

function thumbnailUrl(option: WorkoutExerciseOption): string | undefined {
  return option.media?.find((entry) => entry.coverUrl)?.coverUrl ?? option.thumbnailUrl;
}

export function ExercisePickerDialog({
  title,
  options,
  selectedId,
  loading,
  onPick,
  onClose
}: ExercisePickerDialogProps) {
  const reducedMotion = useReducedMotion();
  const [query, setQuery] = useState("");
  const [facetKind, setFacetKind] = useState<ExerciseFacetKind>("all");
  const [facetValue, setFacetValue] = useState<string | null>(null);
  const [playing, setPlaying] = useState<LabeledExerciseOption | null>(null);

  /*
   * Escape is taken in the capture phase, and the press is stopped there. This
   * dialog opens over a modal that closes itself on Escape from its own
   * `window` listener, and two listeners on two nodes are not separated by a
   * bubble-phase `stopPropagation`. The clip closes first when one is open.
   */
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (playing) setPlaying(null);
      else onClose();
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [onClose, playing]);

  /* Classified once per catalog, not once per keystroke: the facet counts and
     the results both read it for every option. */
  const classified = useMemo(
    () => new Map(options.map((option) => [option, exerciseFacets(option.label)])),
    [options]
  );

  /** The search narrows the facet counts too, so a count is never a promise of
      rows the athlete cannot reach from where they are. */
  const searched = useMemo(() => {
    const term = normalize(query);
    if (!term) return options;
    return options.filter((option) => normalize(option.label).includes(term));
  }, [options, query]);

  const facets = useMemo<FacetValue[]>(() => {
    if (facetKind === "all") return [];

    const counts = new Map<string, number>();
    for (const option of searched) {
      const facetsOf = classified.get(option)!;
      const values: readonly string[] = facetKind === "bodyPart"
        ? facetsOf.bodyParts
        : facetKind === "muscle"
          ? facetsOf.muscles
          : facetsOf.equipment;
      for (const value of new Set(values)) {
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }
    }

    const build = (value: string, label: string, glyph: ReactNode, detail?: string) => {
      const count = counts.get(value) ?? 0;
      return count > 0 ? [{ value, label, glyph, count, ...(detail ? { detail } : {}) }] : [];
    };

    if (facetKind === "bodyPart") {
      return EXERCISE_BODY_PARTS.flatMap((part: ExerciseBodyPartId) => build(
        part,
        BODY_PART_LABELS[part],
        <BodyGlyph muscles={BODY_PART_MUSCLES[part]} size={60} />
      ));
    }
    if (facetKind === "muscle") {
      return EXERCISE_MUSCLE_ORDER.flatMap((muscle: MuscleId) => build(
        muscle,
        muscleLabel(muscle),
        <BodyGlyph muscles={[muscle]} size={60} />,
        muscleAnatomy(muscle)
      ));
    }
    return EXERCISE_EQUIPMENT_ORDER.flatMap((item: ExerciseSearchEquipment) => build(
      item,
      EQUIPMENT_LABELS[item],
      <span className="exercise-picker-facet-icon"><EquipmentGlyph equipment={item} size={19} /></span>
    ));
  }, [classified, facetKind, searched]);

  /* A value the current search has emptied out stops narrowing anything, or
     the results column reads as "no exercises" for a filter nothing can match. */
  useEffect(() => {
    if (facetValue && !facets.some((facet) => facet.value === facetValue)) {
      setFacetValue(null);
    }
  }, [facets, facetValue]);

  const results = useMemo(() => {
    if (facetKind === "all" || !facetValue) return searched;
    return searched.filter((option) => {
      const facetsOf = classified.get(option)!;
      if (facetKind === "bodyPart") {
        return facetsOf.bodyParts.includes(facetValue as ExerciseBodyPartId);
      }
      if (facetKind === "muscle") return facetsOf.muscles.includes(facetValue as MuscleId);
      return facetsOf.equipment.includes(facetValue as ExerciseSearchEquipment);
    });
  }, [classified, facetKind, facetValue, searched]);

  return createPortal(
    <div
      className="exercise-picker-scrim"
      role="presentation"
      onClick={onClose}
    >
      <motion.div
        className="exercise-picker panel"
        role="dialog"
        aria-modal="true"
        aria-label={`Choose ${title.toLocaleLowerCase()}`}
        initial={reducedMotion ? false : { opacity: 0, y: 16, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={reducedMotion ? { duration: 0 } : { type: "spring", stiffness: 360, damping: 30 }}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="exercise-picker-header">
          <div className="exercise-picker-heading">
            <p>Exercise library</p>
            <h3>Choose {title.toLocaleLowerCase()}</h3>
          </div>
          <label className="exercise-picker-search">
            <Search size={15} aria-hidden="true" />
            <input
              type="search"
              value={query}
              autoFocus
              aria-label={`Search ${title.toLocaleLowerCase()}s`}
              placeholder="Search by name"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="exercise-picker-close"
            aria-label="Close the exercise library"
            onClick={onClose}
          >
            <X size={17} aria-hidden="true" />
          </button>
        </header>

        <div className="exercise-picker-filter-bar">
          <OptionGroup<ExerciseFacetKind>
            label="Filter exercises by"
            size="md"
            value={facetKind}
            options={EXERCISE_FACET_KINDS.map((kind) => ({ value: kind.value, label: kind.label }))}
            onChange={(next) => {
              setFacetKind(next);
              setFacetValue(null);
            }}
          />
          <span className="exercise-picker-count" role="status">
            {loading
              ? "Loading COROS exercises…"
              : `${results.length} ${results.length === 1 ? "exercise" : "exercises"}`}
          </span>
        </div>

        <div className={`exercise-picker-body ${facetKind === "all" ? "is-unfiltered" : ""}`}>
          {facetKind === "all" ? null : (
            <aside className="exercise-picker-facets" aria-label={`Filter by ${facetKind === "bodyPart" ? "body part" : facetKind}`}>
              {facets.length === 0 ? (
                <p className="exercise-picker-empty">Nothing to narrow by here.</p>
              ) : facets.map((facet) => (
                <button
                  key={facet.value}
                  type="button"
                  className="exercise-picker-facet"
                  aria-pressed={facetValue === facet.value}
                  onClick={() => setFacetValue(facetValue === facet.value ? null : facet.value)}
                >
                  <span className="exercise-picker-facet-art" aria-hidden="true">{facet.glyph}</span>
                  <span className="exercise-picker-facet-copy">
                    <strong>{facet.label}</strong>
                    {facet.detail ? <small>{facet.detail}</small> : null}
                  </span>
                  <span className="exercise-picker-facet-count">{facet.count}</span>
                </button>
              ))}
            </aside>
          )}

          <div className="exercise-picker-results">
            {loading ? (
              <p className="exercise-picker-empty">Loading the COROS exercise library…</p>
            ) : results.length === 0 ? (
              <p className="exercise-picker-empty">No exercise matches this search.</p>
            ) : (
              <ul className="exercise-picker-grid">
                {results.map((option) => {
                  const clip = videoUrl(option);
                  const still = thumbnailUrl(option);
                  return (
                    <li key={option.id} className="exercise-picker-card">
                      <button
                        type="button"
                        className="exercise-picker-card-pick"
                        aria-current={option.id === selectedId ? "true" : undefined}
                        onClick={() => onPick(option)}
                      >
                        <span className="exercise-picker-card-media">
                          {still ? (
                            <img
                              src={still}
                              alt=""
                              loading="lazy"
                              decoding="async"
                              onError={(event) => { event.currentTarget.hidden = true; }}
                            />
                          ) : null}
                        </span>
                        <span className="exercise-picker-card-name">{option.label}</span>
                      </button>
                      {clip ? (
                        <button
                          type="button"
                          className="exercise-picker-card-play"
                          aria-label={`Play the ${option.label} demonstration`}
                          onClick={() => setPlaying(option)}
                        >
                          <Play size={15} strokeWidth={2.4} aria-hidden="true" />
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </motion.div>

      <AnimatePresence>
        {playing ? (
          <motion.div
            key="exercise-picker-clip"
            className="exercise-picker-clip-scrim"
            role="presentation"
            initial={reducedMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={reducedMotion ? { opacity: 1 } : { opacity: 0 }}
            transition={reducedMotion ? { duration: 0 } : { duration: 0.16 }}
            onClick={(event) => {
              event.stopPropagation();
              setPlaying(null);
            }}
          >
            <div
              className="exercise-picker-clip panel"
              role="dialog"
              aria-modal="true"
              aria-label={`${playing.label} demonstration`}
              onClick={(event) => event.stopPropagation()}
            >
              <header className="exercise-picker-clip-header">
                <h4>{playing.label}</h4>
                <button
                  type="button"
                  className="ghost-button"
                  aria-label="Close the demonstration"
                  onClick={() => setPlaying(null)}
                >
                  <X size={16} aria-hidden="true" />
                </button>
              </header>
              <ExercisePreview option={playing} name={playing.label} autoPlay showTargets />
              <footer className="exercise-picker-clip-footer">
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => onPick(playing)}
                >
                  Use this exercise
                </button>
              </footer>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>,
    document.body
  );
}
