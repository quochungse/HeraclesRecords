import { Fragment, memo } from "react";
import { BODY_OUTLINE, BODY_SHAPES, BODY_VIEW_BOX, type BodyView } from "../calendar/bodyShapes";
import { MUSCLE_SLUG, MUSCLE_VIEW } from "../calendar/bodyFigure";
import type { MuscleId } from "./muscles";
import { heatLevel, type MuscleStat } from "./strengthAnalytics";

const VIEWS: readonly BodyView[] = ["front", "back"];
const MUSCLE_IDS = Object.keys(MUSCLE_VIEW) as MuscleId[];

/**
 * The artwork, drawn once for the list: an outline per side and a group per
 * muscle, which every row's figure draws by reference. Written into each row
 * it was ~40 KB of path data a row — a year's window held megabytes of the
 * same few shapes. Each muscle lives on the side `MUSCLE_VIEW` gives it, never
 * on the sliver the artwork also has on the other.
 */
export function SessionBodySprite({ id }: { id: string }) {
  return (
    <svg className="strength-session-figure-sprite" aria-hidden="true" focusable="false">
      <defs>
        {VIEWS.map((view) => (
          <Fragment key={view}>
            <path id={`${id}-${view}`} d={BODY_OUTLINE[view]} />
            {MUSCLE_IDS.filter((muscle) => MUSCLE_VIEW[muscle] === view).map((muscle) => (
              <g key={muscle} id={`${id}-${view}-${muscle}`}>
                {(BODY_SHAPES[view][MUSCLE_SLUG[muscle]] ?? []).map((d, index) => (
                  <path key={index} d={d} />
                ))}
              </g>
            ))}
          </Fragment>
        ))}
      </defs>
    </svg>
  );
}

interface SessionBodyGlyphProps {
  /** The id `SessionBodySprite` was drawn under, in this list. */
  sprite: string;
  /** What the body map would draw for the row — `sessionHeat` for a session, the window's own for "All sessions". */
  muscleById: Record<MuscleId, MuscleStat>;
  /** The scale the map reads them on: the busiest muscle's sets. */
  max: number;
}

/**
 * A row's muscles at a glance: the front and the back of the figure the
 * Exercises Library draws (`bodyShapes.ts`), each muscle lit on the body map's
 * heat ramp, so a row reads as a small copy of the map it opens. It replaced a
 * push / pull / legs / core bar in four colours, which said less and shouted.
 *
 * Both sides, always: one figure chosen by the busier side drew a leg day as
 * quads alone, its hamstrings, glutes and calves on the side not shown.
 */
export const SessionBodyGlyph = memo(function SessionBodyGlyph({ sprite, muscleById, max }: SessionBodyGlyphProps) {
  return (
    <span className="strength-session-row-figure" aria-hidden="true">
      {VIEWS.map((view) => (
        <svg key={view} viewBox={BODY_VIEW_BOX[view]} focusable="false">
          <use className="strength-session-figure-body" href={`#${sprite}-${view}`} />
          {MUSCLE_IDS.map((muscle) => {
            if (MUSCLE_VIEW[muscle] !== view) return null;
            const level = heatLevel(muscleById[muscle]?.sets ?? 0, max);
            return level > 0 ? (
              <use
                key={muscle}
                className="strength-session-figure-muscle"
                data-level={level}
                href={`#${sprite}-${view}-${muscle}`}
              />
            ) : null;
          })}
        </svg>
      ))}
    </span>
  );
});
