/**
 * The Exercises Library tab: COROS's own movement catalog, to read.
 *
 * It is one library, not one per sport. COROS keeps a single catalog of
 * movements, the Strength one: Hybrid Fitness has none of its own and builds
 * its workouts from that same list, so a tab per sport showed the same 382
 * movements twice. The eight HYROX stations are a filter instead, listed in
 * race order. A run or a ride is built from warm-up, training and cool-down
 * steps, which are not exercises, so they are not here at all.
 *
 * Two cards, the list and the movement open beside it, rather than the
 * Workouts tab's single split panel: this is a place to read, and nothing
 * docks under the reader. The list narrows by two filters, not three lists —
 * the body (a part, then a muscle within it: `BodyFilterPanel`) and the
 * equipment, drawn with the pictures the exercise picker already uses — plus
 * a search, the HYROX stations and the athlete's favourites.
 *
 * What the reader says about a movement is what the app can stand behind:
 * the clip COROS ships, where the work lands (the picker's own `optionFacets`
 * reading of COROS's muscles), and how hard it loads them
 * (`exerciseEffort.ts`). The catalog row's default target and rest are not
 * shown — they are what a step starts at in the builder, not facts about the
 * movement.
 *
 * Favourites are rows of `exercise_library_favorites` (`personal`), keyed by
 * COROS's catalog id, so they follow the athlete to the other machine; a pull
 * that touches the table reads them again.
 */
import { ChevronDown, Heart, LayoutGrid, LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { WorkoutExerciseOption } from "../../electron/types";
import { SelectDropdown } from "../components/SelectDropdown";
import { BodyGlyph, EquipmentGlyph } from "../calendar/ExerciseFacetGlyph";
import { ExercisePreview } from "../calendar/ExercisePreview";
import { MUSCLE_SLUG } from "../calendar/bodyFigure";
import { BODY_OUTLINE, BODY_SHAPES, BODY_VIEW_BOX, type BodyView } from "../calendar/bodyShapes";
import {
  BODY_PART_LABELS,
  BODY_PART_MUSCLES,
  EQUIPMENT_LABELS,
  muscleLabel,
  type ExerciseBodyPartId,
  type ExerciseEquipment
} from "../calendar/exerciseFacets";
import { useWorkoutExerciseCatalog } from "../calendar/useWorkoutExerciseCatalog";
import { workoutSportView } from "../calendar/workoutSportIcons";
import type { HeraclesRecordsApi } from "../heraclesrecords-api";
import type { MuscleId } from "../strength/muscles";
import { resolveExerciseName } from "../training/exerciseNames";
import { workoutSportLabel } from "../training/workoutSport";
import { BodyFilterPanel } from "./BodyFilterPanel";
import { CollapsibleSearch } from "./LibrarySearch";
import {
  bodyCounts,
  effortStep,
  equipmentCounts,
  libraryExercises,
  muscleShares,
  narrowExercises,
  pickMuscle,
  type ExerciseLibraryFilter,
  type LibraryExercise
} from "./exerciseLibraryModel";
import { sportAccentStyle, sportTheme } from "./sportTheme";
import { getIntlLocale, plural, t } from "../i18n/core";
import { useI18n } from "../i18n/useI18n";

/** The one catalog COROS keeps, Hybrid Fitness's included. */
const CATALOG_SPORT = "strength";

const FAVORITES_TABLE = "exercise_library_favorites";
const ANY_EQUIPMENT = "any";
type EquipmentChoice = ExerciseEquipment | typeof ANY_EQUIPMENT;

/** The body panel: the names column beside the figure, and the room around both. */
const PANEL_WIDTH = 600;
const PANEL_NAMES_WIDTH = 210;
const PANEL_STAGE_PADDING = 40;

function exerciseLabel(option: WorkoutExerciseOption): string {
  return resolveExerciseName(option.name) || option.name;
}

function thumbnailOf(option: WorkoutExerciseOption): string | undefined {
  return option.media?.find((entry) => entry.coverUrl)?.coverUrl ?? option.thumbnailUrl;
}

function hasClip(option: WorkoutExerciseOption): boolean {
  return Boolean(option.media?.some((entry) => entry.videoUrl));
}

export function ExercisesLibrary({
  api,
  onError
}: {
  api: HeraclesRecordsApi;
  onError: (message: string | null) => void;
}) {
  const { locale } = useI18n();
  const catalog = useWorkoutExerciseCatalog(api, CATALOG_SPORT);
  const [favorites, setFavorites] = useState<ReadonlySet<string>>(new Set());
  const [query, setQuery] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [hyroxOnly, setHyroxOnly] = useState(false);
  const [equipment, setEquipment] = useState<ExerciseEquipment | null>(null);
  const [part, setPart] = useState<ExerciseBodyPartId | null>(null);
  const [muscle, setMuscle] = useState<MuscleId | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [bodyOpen, setBodyOpen] = useState(false);

  const loadFavorites = useCallback(async () => {
    try {
      setFavorites(new Set(await api.listExerciseFavorites()));
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [api, onError]);

  useEffect(() => {
    void loadFavorites();
    if (!api.onSyncChanged) return;
    return api.onSyncChanged((change) => {
      if (change.tables.includes(FAVORITES_TABLE)) void loadFavorites();
    });
  }, [api, loadFavorites]);

  const rows = useMemo(
    () => libraryExercises(catalog.options, exerciseLabel, getIntlLocale()),
    // The names are read in the language on screen, so a switch re-reads them.
    [catalog.options, locale]
  );

  const filter: ExerciseLibraryFilter = { query, favoritesOnly, favorites, hyroxOnly, equipment, part, muscle };
  const shown = useMemo(
    () => narrowExercises(rows, filter),
    // `filter` is rebuilt every render; these are what it is made of.
    [rows, query, favoritesOnly, favorites, hyroxOnly, equipment, part, muscle]
  );
  const counts = useMemo(
    () => bodyCounts(rows, filter),
    [rows, query, favoritesOnly, favorites, hyroxOnly, equipment]
  );
  const equipmentOptions = useMemo(
    () => equipmentCounts(rows, filter),
    [rows, query, favoritesOnly, favorites, hyroxOnly, part, muscle]
  );

  const selected = shown.find((row) => row.id === selectedId) ?? shown[0] ?? null;

  /* The heart moves at once and goes back only for the movement that failed:
     taking back the whole set as it was would undo a second heart pressed
     while the first was still on its way. */
  const toggleFavorite = async (exercise: LibraryExercise) => {
    const keep = !favorites.has(exercise.id);
    const mark = (kept: boolean) => setFavorites((current) => {
      const next = new Set(current);
      if (kept) next.add(exercise.id);
      else next.delete(exercise.id);
      return next;
    });
    mark(keep);
    try {
      await api.setExerciseFavorite(exercise.id, CATALOG_SPORT, keep);
    } catch (cause) {
      mark(!keep);
      onError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const clearFilters = () => {
    setQuery("");
    setFavoritesOnly(false);
    setHyroxOnly(false);
    setEquipment(null);
    setPart(null);
    setMuscle(null);
  };

  /* The body panel hangs under its trigger and over both cards, so it is
     placed against the two-card box rather than inside the list's card,
     which clips. */
  const boxRef = useRef<HTMLDivElement>(null);
  const bodyTriggerRef = useRef<HTMLButtonElement>(null);
  const [panelPlace, setPanelPlace] = useState<{ top: number; left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    if (!bodyOpen) return;
    const place = () => {
      const box = boxRef.current?.getBoundingClientRect();
      const trigger = bodyTriggerRef.current?.getBoundingClientRect();
      if (!box || !trigger) return;
      const left = trigger.left - box.left;
      setPanelPlace({
        top: trigger.bottom - box.top + 6,
        left,
        width: Math.min(PANEL_WIDTH, box.width - left - 12)
      });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [bodyOpen]);

  const closeBody = useCallback(() => {
    setBodyOpen(false);
    bodyTriggerRef.current?.focus();
  }, []);

  const bodyLabel = muscle && part
    ? `${BODY_PART_LABELS[part]} › ${muscleLabel(muscle)}`
    : part
      ? BODY_PART_LABELS[part]
      : t("library.x.wholeBody");
  const bodyGlyph = muscle ? [muscle] : part ? BODY_PART_MUSCLES[part] : [];
  const orderTarget = muscle ? muscleLabel(muscle) : part ? BODY_PART_LABELS[part] : null;

  const equipmentValue: EquipmentChoice = equipment ?? ANY_EQUIPMENT;
  const equipmentSelectOptions = [
    { value: ANY_EQUIPMENT as EquipmentChoice, label: t("library.x.anyEquipment") },
    ...equipmentOptions.map((entry) => ({
      value: entry.equipment as EquipmentChoice,
      label: EQUIPMENT_LABELS[entry.equipment],
      detail: String(entry.count)
    }))
  ];

  const filtering = Boolean(query || favoritesOnly || hyroxOnly || equipment || part || muscle);
  const HyroxIcon = sportTheme("hyrox").icon;

  return (
    <div className="tl-exercises" ref={boxRef} style={sportAccentStyle(CATALOG_SPORT)}>
      <section className="tl-panel tl-exercise-list" aria-label={t("library.section.exercises")}>
        <div className="tl-exercise-filters">
          <div className="tl-exercise-filter-pair">
            <button
              ref={bodyTriggerRef}
              type="button"
              className={`app-select-trigger tl-body-trigger${part ? " is-set" : ""}`}
              aria-haspopup="dialog"
              aria-expanded={bodyOpen}
              aria-label={`${t("library.x.body")}: ${bodyLabel}`}
              onClick={() => setBodyOpen((open) => !open)}
            >
              <span className="app-select-value">
                <span className="app-select-leading-icon" aria-hidden="true">
                  <BodyGlyph muscles={bodyGlyph} size={24} />
                </span>
                <span className="app-select-value-label">{bodyLabel}</span>
              </span>
              <ChevronDown
                className={bodyOpen ? "app-select-icon is-open" : "app-select-icon"}
                size={17}
                strokeWidth={2.4}
                aria-hidden="true"
              />
            </button>
            <SelectDropdown
              className={`tl-equipment-select${equipment ? " is-set" : ""}`}
              menuClassName="tl-equipment-menu"
              label={t("library.x.equipment")}
              value={equipmentValue}
              options={equipmentSelectOptions}
              portal
              renderIcon={(value) => value === ANY_EQUIPMENT
                ? <LayoutGrid size={18} aria-hidden="true" />
                : <EquipmentGlyph equipment={value} size={18} />}
              onChange={(value) => {
                setEquipment(value === ANY_EQUIPMENT ? null : value);
                setSelectedId(null);
              }}
            />
          </div>
          <div className="tl-exercise-status">
            <span role="status">
              {plural("library.x.count", shown.length)}
              {orderTarget && shown.length > 1 ? ` · ${t("library.x.hardestFirst", { target: orderTarget })}` : ""}
            </span>
            <div className="tl-filters-tail">
              <CollapsibleSearch value={query} onChange={setQuery} label={t("library.x.search")} />
              <button
                type="button"
                className={`tl-exercise-favorites tl-exercise-hyrox${hyroxOnly ? " is-active" : ""}`}
                aria-pressed={hyroxOnly}
                title={t("library.x.hyroxOnly")}
                onClick={() => {
                  setHyroxOnly((current) => !current);
                  setSelectedId(null);
                }}
              >
                <HyroxIcon size={14} aria-hidden="true" />
                {t("library.x.hyrox")}
              </button>
              <button
                type="button"
                className={`tl-exercise-favorites${favoritesOnly ? " is-active" : ""}`}
                aria-pressed={favoritesOnly}
                aria-label={t("library.x.favoritesOnly")}
                title={t("library.x.favoritesOnly")}
                onClick={() => setFavoritesOnly((current) => !current)}
              >
                <Heart size={14} fill={favoritesOnly ? "currentColor" : "none"} aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>

        {catalog.loading && !rows.length ? (
          <p className="tl-reader-loading tl-exercise-loading">
            <LoaderCircle className="is-spinning" size={16} aria-hidden="true" /> {t("library.x.loading")}
          </p>
        ) : !rows.length ? (
          <div className="tl-empty">
            <h3>{t("library.x.noneTitle")}</h3>
            <p>{t("library.x.noneBody")}</p>
          </div>
        ) : !shown.length ? (
          <div className="tl-empty">
            <h3>{favoritesOnly && !favorites.size ? t("library.x.noFavoritesTitle") : t("library.x.noMatchTitle")}</h3>
            <p>{favoritesOnly && !favorites.size ? t("library.x.noFavoritesBody") : t("library.x.noMatchBody")}</p>
            {filtering ? (
              <button type="button" className="ghost-button" onClick={clearFilters}>
                {t("library.x.clear")}
              </button>
            ) : null}
          </div>
        ) : (
          <div className="tl-index">
            <ul role="list">
              {shown.map((exercise) => (
                <ExerciseRow
                  key={exercise.id}
                  exercise={exercise}
                  active={exercise.id === selected?.id}
                  favorite={favorites.has(exercise.id)}
                  onOpen={() => {
                    setSelectedId(exercise.id);
                    setBodyOpen(false);
                  }}
                />
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="tl-panel tl-exercise-reader" aria-live="polite">
        {selected ? (
          <ExerciseReader
            key={selected.id}
            exercise={selected}
            favorite={favorites.has(selected.id)}
            onToggleFavorite={() => void toggleFavorite(selected)}
          />
        ) : (
          <div className="tl-empty">
            <h3>{t("library.x.pickTitle")}</h3>
            <p>{t("library.x.pickBody")}</p>
          </div>
        )}
      </section>

      {bodyOpen && panelPlace ? (
        <BodyFilterPanel
          part={part}
          muscle={muscle}
          counts={counts}
          stageWidth={panelPlace.width - PANEL_NAMES_WIDTH - PANEL_STAGE_PADDING}
          style={{ top: panelPlace.top, left: panelPlace.left, width: panelPlace.width }}
          anchor={bodyTriggerRef.current}
          onClose={closeBody}
          onPickPart={(next) => {
            setPart(next);
            setMuscle(null);
            setSelectedId(null);
          }}
          onPickMuscle={(next) => {
            const picked = pickMuscle({ part, muscle }, next);
            setPart(picked.part);
            setMuscle(picked.muscle);
            setSelectedId(null);
          }}
        />
      ) : null}
    </div>
  );
}

function ExerciseRow({
  exercise,
  active,
  favorite,
  onOpen
}: {
  exercise: LibraryExercise;
  active: boolean;
  favorite: boolean;
  onOpen: () => void;
}) {
  const thumbnail = thumbnailOf(exercise.option);
  const muscles = exercise.primary.map(muscleLabel).join(", ");
  const kit = exercise.facets.equipment.map((entry) => EQUIPMENT_LABELS[entry]).join(", ");
  const station = exercise.hyroxStation !== undefined
    ? t("library.x.hyroxStation", { station: exercise.hyroxStation })
    : "";
  return (
    <li className={`tl-row tl-exercise-row${active ? " is-active" : ""}`} onClick={onOpen}>
      <span className="tl-exercise-thumb" aria-hidden="true">
        {thumbnail ? <img src={thumbnail} alt="" loading="lazy" /> : <BodyGlyph muscles={exercise.primary} size={34} />}
      </span>
      <button type="button" className="tl-row-open" aria-current={active ? "true" : undefined}>
        <span className="tl-row-name">
          <span className="tl-row-name-text">{exercise.name}</span>
        </span>
        {station || muscles || kit ? (
          <span className="tl-row-sub">{[station, muscles, kit].filter(Boolean).join(" · ")}</span>
        ) : null}
      </button>
      {/* A slot of its own at the row's end, there or not, so the heart never
          moves a name. */}
      <span className="tl-exercise-row-favorite">
        {favorite ? (
          <Heart size={13} fill="currentColor" strokeWidth={0} role="img" aria-label={t("library.w.favorite")} />
        ) : null}
      </span>
    </li>
  );
}

const EFFORT_LABEL_KEYS = {
  minimal: "library.x.effort.minimal",
  light: "library.x.effort.light",
  moderate: "library.x.effort.moderate",
  heavy: "library.x.effort.heavy",
  loaded: "library.x.effort.loaded"
} as const;

function ExerciseReader({
  exercise,
  favorite,
  onToggleFavorite
}: {
  exercise: LibraryExercise;
  favorite: boolean;
  onToggleFavorite: () => void;
}) {
  // A station wears Hybrid Fitness's colour and icon, as its workouts do.
  const sport = exercise.hyroxStation !== undefined ? "hyrox" : CATALOG_SPORT;
  const { category, icon: SportIcon } = workoutSportView(sport);
  const shares = muscleShares(exercise);
  const step = effortStep(exercise);
  const kit = exercise.facets.equipment.map((entry) => EQUIPMENT_LABELS[entry]);
  const top = shares[0]?.share ?? 1;

  return (
    <div className="tl-reader-scroll">
      <div className={`sched-detail workout-view is-${category}`}>
        <div className="sched-hero">
          <div className="sched-hero-top">
            <span className="sched-hero-icon" aria-hidden="true">
              <SportIcon size={20} />
            </span>
            <div className="sched-hero-title">
              <h2 className="sched-hero-name">{exercise.name}</h2>
              <span className="sched-hero-context">
                <b>
                  {exercise.hyroxStation !== undefined
                    ? t("library.x.hyroxStation", { station: exercise.hyroxStation })
                    : workoutSportLabel(sport)}
                </b>
                {exercise.mainPart ? <em className="tl-exercise-chip">{BODY_PART_LABELS[exercise.mainPart]}</em> : null}
                {kit.map((label) => <em className="tl-exercise-chip" key={label}>{label}</em>)}
              </span>
            </div>
            <div className="sched-hero-aside">
              <button
                type="button"
                className={`tl-reader-favorite${favorite ? " is-active" : ""}`}
                aria-pressed={favorite}
                aria-label={favorite ? t("library.reader.unfavorite") : t("library.reader.favorite")}
                onClick={onToggleFavorite}
              >
                <Heart size={16} fill={favorite ? "currentColor" : "none"} />
              </button>
            </div>
          </div>
          <dl className="sched-hero-stats is-3">
            <div className="sched-stat">
              <dt className="sched-stat-label">{t("library.x.bodyPart")}</dt>
              <dd className="sched-stat-value">
                {exercise.mainPart ? BODY_PART_LABELS[exercise.mainPart] : "—"}
              </dd>
              {exercise.mainPart ? (
                <dd className="tl-exercise-stat-note">
                  {exercise.otherParts.length
                    ? t("library.x.alsoParts", { parts: exercise.otherParts.slice(0, 2).map((entry) => BODY_PART_LABELS[entry]).join(", ") })
                    : t("library.x.onePart")}
                </dd>
              ) : null}
            </div>
            <div className="sched-stat">
              <dt className="sched-stat-label">{t("library.x.muscleLoad")}</dt>
              <dd className="sched-stat-value">{t(EFFORT_LABEL_KEYS[exercise.facets.effort])}</dd>
              <dd className="tl-exercise-stat-note">
                {step ? (
                  <span className="tl-exercise-effort" role="img" aria-label={t("library.x.effortStep", { step })}>
                    {[1, 2, 3, 4].map((pip) => <i key={pip} className={pip <= step ? "is-on" : ""} />)}
                  </span>
                ) : (
                  t("library.x.effortLoadedNote")
                )}
              </dd>
            </div>
            <div className="sched-stat">
              <dt className="sched-stat-label">{t("library.x.muscles")}</dt>
              <dd className="sched-stat-value">{shares.length ? plural("library.x.musclesWorked", shares.length) : "—"}</dd>
              {shares.length ? (
                <dd className="tl-exercise-stat-note">{plural("library.x.primaryCount", exercise.primary.length)}</dd>
              ) : null}
            </div>
          </dl>
        </div>

        {hasClip(exercise.option) ? (
          <ExercisePreview option={exercise.option} name={exercise.name} className="tl-exercise-clip" />
        ) : null}

        <section className="tl-exercise-muscles" aria-label={t("library.x.muscles")}>
          <h3>{t("library.x.muscles")}</h3>
          {shares.length ? (
            <div className="tl-exercise-muscles-body">
              <div className="tl-exercise-figures">
                {(["front", "back"] as const).map((view) => (
                  <MuscleFigure key={view} view={view} exercise={exercise} />
                ))}
              </div>
              <div className="tl-exercise-shares">
                <p className="tl-exercise-shares-title">{t("library.x.whereWork")}</p>
                <ul role="list">
                  {shares.map((entry) => (
                    <li key={entry.muscle} className={entry.primary ? "is-primary" : ""}>
                      <span className="tl-exercise-share-name">{muscleLabel(entry.muscle)}</span>
                      <span className="tl-exercise-share-value">
                        {Math.round(entry.share * 100)}%
                      </span>
                      <span className="tl-exercise-share-bar" aria-hidden="true">
                        <i style={{ width: `${Math.round((entry.share / top) * 100)}%` } as CSSProperties} />
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="tl-exercise-legend">
                  <span className="is-primary">{t("library.x.primary")}</span>
                  <span>{t("library.x.involved")}</span>
                </p>
              </div>
            </div>
          ) : (
            <p className="tl-exercise-none">{t("library.x.noMuscles")}</p>
          )}
        </section>
      </div>
    </div>
  );
}

/** One side of the body with the movement's muscles lit: primary in the sport's colour, involved a step back. */
function MuscleFigure({ view, exercise }: { view: BodyView; exercise: LibraryExercise }) {
  const roleOf = new Map<string, string>([
    ...exercise.involved.map((entry) => [MUSCLE_SLUG[entry], "is-involved"] as const),
    ...exercise.primary.map((entry) => [MUSCLE_SLUG[entry], "is-primary"] as const)
  ]);
  return (
    <figure className="tl-body-view">
      <svg className="tl-body-figure" viewBox={BODY_VIEW_BOX[view]} aria-hidden="true">
        <path className="tl-body-skin" d={BODY_OUTLINE[view]} />
        {Object.entries(BODY_SHAPES[view]).map(([slug, paths]) => (
          <g key={slug} className={`tl-body-muscle ${roleOf.get(slug) ?? "is-rest"}`}>
            {paths.map((d, index) => <path key={index} d={d} />)}
          </g>
        ))}
      </svg>
      <figcaption>{view === "front" ? t("library.x.front") : t("library.x.back")}</figcaption>
    </figure>
  );
}
