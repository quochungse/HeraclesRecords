/**
 * The Exercises Library's body filter: one control for a body part and a
 * muscle within it, because a body part is a roll-up of muscles and picking
 * a muscle is narrowing a part.
 *
 * **Two steps, the second one zoomed.** At the first, the whole figure is on
 * screen and a press anywhere picks the part the muscle under it belongs to,
 * so the target is a region — the legs, the arms — and never a sliver like
 * the forearm or the neck. At the second, the picture frames that part alone
 * (`zoomViewBox`), several times larger, and its muscles are what is picked.
 * A part that is one muscle — the chest, the shoulders, the neck — has no
 * second step: picking it is the whole choice, so it is chosen where it stands.
 * Every shape also carries a transparent stroke a few pixels wide on screen,
 * so the edge of a muscle is not a near miss.
 *
 * **The names are the control; the figure points at them.** Beside the
 * picture, every part — then every muscle — is a full-height row with its
 * count, and the two light each other: hovering a row lights its shapes, and
 * hovering a shape lights its row. The keyboard and a screen reader use the
 * rows alone; the picture is `aria-hidden`.
 *
 * It filters as it is used — the list behind it is narrowed by every pick —
 * and closes on Escape (taken in the capture phase, for the reason
 * `OptionGroup` takes it there) or on a press outside it.
 */
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { SLUG_MUSCLES, viewsOf, zoomViewBox } from "../calendar/bodyFigure";
import { BODY_OUTLINE, BODY_SHAPES, BODY_VIEW_BOX, type BodyView } from "../calendar/bodyShapes";
import {
  BODY_PART_LABELS,
  BODY_PART_MUSCLES,
  EXERCISE_BODY_PARTS,
  bodyPartOf,
  muscleLabel,
  type ExerciseBodyPartId
} from "../calendar/exerciseFacets";
import type { MuscleId } from "../strength/muscles";
import type { BodyCounts } from "./exerciseLibraryModel";

/** A part with more than one muscle opens a second, zoomed step; one muscle is the part. */
function hasMuscles(part: ExerciseBodyPartId): boolean {
  return BODY_PART_MUSCLES[part].length > 1;
}
import { t } from "../i18n/core";

/** The figure's height on screen, caption excluded. */
const STAGE_HEIGHT = 320;
/** Room each shape's invisible stroke adds on every side, in screen pixels. */
const HIT_SLOP_PX = 5;
const VIEW_HEIGHT = 1448;

interface BodyFilterPanelProps {
  part: ExerciseBodyPartId | null;
  muscle: MuscleId | null;
  counts: BodyCounts;
  /** The width the figure has to stand in, beside the list of names. */
  stageWidth: number;
  style: CSSProperties;
  onPickPart: (part: ExerciseBodyPartId | null) => void;
  onPickMuscle: (muscle: MuscleId | null) => void;
  onClose: () => void;
  /** The trigger: a press on it is its own toggle, not a press outside. */
  anchor: HTMLElement | null;
}

interface StageView {
  view: BodyView;
  box: string;
  width: number;
  height: number;
  /** User units per screen pixel, for the hit stroke. */
  unitsPerPixel: number;
}

export function BodyFilterPanel({
  part,
  muscle,
  counts,
  stageWidth,
  style,
  onPickPart,
  onPickMuscle,
  onClose,
  anchor
}: BodyFilterPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  /* A part at the first step, a muscle at the second. */
  const [hover, setHover] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target || panelRef.current?.contains(target) || anchor?.contains(target)) return;
      onClose();
    };
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [anchor, onClose]);

  /* Focus goes in with the panel, onto the row standing for what is chosen —
     on open and on a change of step only, so a hover never moves it. */
  useLayoutEffect(() => {
    panelRef.current?.querySelector<HTMLButtonElement>("[aria-pressed='true']")?.focus();
  }, [part]);

  useEffect(() => setHover(null), [part]);

  const zoomed = part !== null && hasMuscles(part);
  const partMuscles = part && zoomed ? BODY_PART_MUSCLES[part] : [];
  const views: BodyView[] = zoomed ? viewsOf(partMuscles) : ["front", "back"];
  const gap = 12;
  const stage: StageView[] = views.map((view) => {
    if (!zoomed) {
      const width = Math.round(STAGE_HEIGHT / 2);
      return { view, box: BODY_VIEW_BOX[view], width, height: STAGE_HEIGHT, unitsPerPixel: VIEW_HEIGHT / STAGE_HEIGHT };
    }
    const width = Math.floor((stageWidth - gap * (views.length - 1)) / views.length);
    const box = zoomViewBox(view, partMuscles, width, STAGE_HEIGHT, part === "arms") ?? BODY_VIEW_BOX[view];
    const boxWidth = Number(box.split(" ")[2]);
    return { view, box, width, height: STAGE_HEIGHT, unitsPerPixel: boxWidth / width };
  });

  /* A shape can stand for more than one muscle — the gluteal shape is the
     glutes' and the abductors' — so it lights for either, and a press on it
     picks the first of them that has anything to show. */
  const shapeState = (shapeMuscles: readonly MuscleId[]): { live: boolean; className: string; target: string | null } => {
    if (!zoomed) {
      const shapePart = bodyPartOf(shapeMuscles[0]!) ?? null;
      const live = shapePart !== null && (counts.parts.get(shapePart) ?? 0) > 0;
      return {
        live,
        target: shapePart,
        className: shapePart !== null && shapePart === part
          ? "is-picked"
          : shapePart !== null && shapePart === hover ? "is-hover" : live ? "is-live" : "is-dead"
      };
    }
    const inPart = shapeMuscles.filter((entry) => partMuscles.includes(entry));
    if (!inPart.length) return { live: false, target: null, className: "is-outside" };
    const target = inPart.find((entry) => (counts.muscles.get(entry) ?? 0) > 0) ?? null;
    const live = target !== null;
    return {
      live,
      target,
      className: muscle !== null && inPart.includes(muscle)
        ? "is-picked"
        : hover !== null && inPart.includes(hover as MuscleId) ? "is-hover" : live ? "is-live" : "is-dead"
    };
  };

  const pick = (target: string) => {
    if (zoomed) onPickMuscle(target as MuscleId);
    else onPickPart(target as ExerciseBodyPartId);
  };

  return (
    <div
      ref={panelRef}
      className="tl-body-panel"
      role="dialog"
      aria-label={t("library.x.body")}
      style={style}
      onPointerLeave={() => setHover(null)}
    >
      <div className="tl-body-stage" aria-hidden="true">
        {stage.map((entry) => (
          <figure className="tl-body-view" key={entry.view}>
            <svg
              className="tl-body-figure is-interactive"
              viewBox={entry.box}
              width={entry.width}
              height={entry.height}
              style={{ "--tl-body-hit": `${Math.round(HIT_SLOP_PX * 2 * entry.unitsPerPixel)}px` } as CSSProperties}
            >
              <path className="tl-body-skin" d={BODY_OUTLINE[entry.view]} />
              {Object.entries(BODY_SHAPES[entry.view]).map(([slug, paths]) => {
                const shapeMuscles = SLUG_MUSCLES[slug];
                if (!shapeMuscles?.length) return null;
                const state = shapeState(shapeMuscles);
                const target = state.live ? state.target : null;
                return (
                  <g
                    key={slug}
                    className={`tl-body-muscle ${state.className}`}
                    {...(target
                      ? {
                          onPointerEnter: () => setHover(target),
                          onClick: () => pick(target)
                        }
                      : {})}
                  >
                    {paths.map((d, index) => <path key={index} d={d} />)}
                  </g>
                );
              })}
            </svg>
            <figcaption>{entry.view === "front" ? t("library.x.front") : t("library.x.back")}</figcaption>
          </figure>
        ))}
      </div>

      <div className="tl-body-names">
        {part && zoomed ? (
          <>
            <button type="button" className="tl-body-back" onClick={() => onPickPart(null)}>
              <ChevronLeft size={14} aria-hidden="true" />
              {t("library.x.wholeBody")}
            </button>
            <p className="tl-body-heading">{BODY_PART_LABELS[part]}</p>
            <NameRow
              label={t("library.x.anyMuscle")}
              count={counts.parts.get(part) ?? 0}
              pressed={muscle === null}
              lit={false}
              onPick={() => onPickMuscle(null)}
              onHover={() => setHover(null)}
            />
            {partMuscles.map((entry) => (
              <NameRow
                key={entry}
                label={muscleLabel(entry)}
                count={counts.muscles.get(entry) ?? 0}
                pressed={muscle === entry}
                lit={hover === entry}
                onPick={() => onPickMuscle(entry)}
                onHover={() => setHover(entry)}
              />
            ))}
          </>
        ) : (
          <>
            <NameRow
              label={t("library.x.wholeBody")}
              count={counts.total}
              pressed={part === null}
              lit={false}
              onPick={() => onPickPart(null)}
              onHover={() => setHover(null)}
            />
            {EXERCISE_BODY_PARTS.map((entry) => (
              <NameRow
                key={entry}
                label={BODY_PART_LABELS[entry]}
                count={counts.parts.get(entry) ?? 0}
                pressed={part === entry}
                lit={hover === entry}
                drills={hasMuscles(entry)}
                onPick={() => onPickPart(entry)}
                onHover={() => setHover(entry)}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function NameRow({
  label,
  count,
  pressed,
  lit,
  drills = false,
  onPick,
  onHover
}: {
  label: string;
  count: number;
  pressed: boolean;
  lit: boolean;
  /** Opens a step further down rather than choosing. */
  drills?: boolean;
  onPick: () => void;
  onHover: () => void;
}) {
  return (
    <button
      type="button"
      className={`tl-body-name${lit ? " is-lit" : ""}`}
      aria-pressed={pressed}
      disabled={count === 0 && !pressed}
      onClick={onPick}
      onPointerEnter={onHover}
      onFocus={onHover}
    >
      <span className="tl-body-name-label">{label}</span>
      <span className="tl-body-name-count">{count}</span>
      {drills ? <ChevronRight size={14} aria-hidden="true" /> : null}
    </button>
  );
}
