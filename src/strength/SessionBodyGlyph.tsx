import { memo } from "react";
import { BODY_OUTLINE, BODY_SHAPES, BODY_VIEW_BOX, type BodyView } from "../calendar/bodyShapes";
import { MUSCLE_SLUG, MUSCLE_VIEW } from "../calendar/bodyFigure";
import type { MuscleId } from "./muscles";
import { heatLevel, type MuscleStat } from "./strengthAnalytics";

const VIEWS: readonly BodyView[] = ["front", "back"];

interface SessionBodyGlyphProps {
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
 * quads alone, its hamstrings, glutes and calves on the side not shown. Each
 * muscle is drawn on the side `MUSCLE_VIEW` gives it, never on the sliver the
 * artwork also has on the other.
 */
export const SessionBodyGlyph = memo(function SessionBodyGlyph({ muscleById, max }: SessionBodyGlyphProps) {
  return (
    <span className="strength-session-row-figure" aria-hidden="true">
      {VIEWS.map((view) => (
        <svg key={view} viewBox={BODY_VIEW_BOX[view]} focusable="false">
          <path className="strength-session-figure-body" d={BODY_OUTLINE[view]} />
          {(Object.keys(muscleById) as MuscleId[]).flatMap((muscle) => {
            if (MUSCLE_VIEW[muscle] !== view) return [];
            const level = heatLevel(muscleById[muscle].sets, max);
            if (level === 0) return [];
            return (BODY_SHAPES[view][MUSCLE_SLUG[muscle]] ?? []).map((d, index) => (
              <path
                key={`${muscle}-${index}`}
                className="strength-session-figure-muscle"
                data-level={level}
                d={d}
              />
            ));
          })}
        </svg>
      ))}
    </span>
  );
});
