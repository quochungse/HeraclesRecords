/**
 * The pictures beside a filter value.
 *
 * A body part and a muscle are drawn on the same figure, so the two rows of
 * the picker read as one body rather than two vocabularies. The artwork is
 * `react-native-body-highlighter`'s, copied into `bodyShapes.ts` — see that
 * file's header for why it is copied rather than depended on, and for its
 * licence. The first version of this file drew the figure out of rounded
 * rectangles; it sat in the right places and did not read as a body.
 *
 * **A glyph draws one view, and each muscle says which.** The package carries
 * a front and a back figure, and most muscles have a sliver on both, so the
 * side is declared per muscle rather than read off the path data — see
 * `MUSCLE_VIEW` in `bodyFigure.ts`. A body part takes the side the majority
 * of its muscles are on, so Back and Legs draw the back figure and Arms and
 * Core the front.
 *
 * Equipment is an icon rather than a picture: a dumbbell, a cable stack and a
 * sled have no shared frame to be drawn in.
 */
import {
  Anchor,
  Cable,
  CircleDashed,
  CircleEllipsis,
  Cog,
  Disc3,
  Dumbbell,
  HandGrab,
  MoveHorizontal,
  PersonStanding,
  Spline,
  Truck,
  Volleyball,
  Waves,
  Weight,
  type LucideIcon
} from "lucide-react";
import type { MuscleId } from "../strength/muscles";
import { chooseView, drawableOn } from "./bodyFigure";
import type { ExerciseEquipment } from "./exerciseFacets";
import { BODY_OUTLINE, BODY_SHAPES, BODY_VIEW_BOX } from "./bodyShapes";

export function BodyGlyph({
  muscles,
  size = 60
}: {
  /** The muscles to light up. An empty list draws the bare figure. */
  muscles: readonly MuscleId[];
  /** Height in pixels; the figure is half as wide as it is tall. */
  size?: number;
}) {
  const view = chooseView(muscles);
  const shapes = BODY_SHAPES[view];
  const lit = drawableOn(view, muscles);
  return (
    <svg
      className="exercise-body-glyph"
      viewBox={BODY_VIEW_BOX[view]}
      height={size}
      width={size / 2}
      aria-hidden="true"
      focusable="false"
    >
      <path className="exercise-body-glyph-figure" d={BODY_OUTLINE[view]} />
      {lit.flatMap((slug) => shapes[slug]!.map((d, index) => (
        <path className="exercise-body-glyph-lit" key={`${slug}-${index}`} d={d} />
      )))}
    </svg>
  );
}

const EQUIPMENT_ICONS: Readonly<Record<ExerciseEquipment, LucideIcon | "barbell">> = {
  bodyweight: PersonStanding,
  barbell: "barbell",
  dumbbell: Dumbbell,
  kettlebell: Weight,
  machine: Cog,
  cable: Cable,
  resistance_band: Spline,
  medicine_ball: Volleyball,
  exercise_ball: CircleDashed,
  suspension: Anchor,
  bosu: Waves,
  sled: Truck,
  rope: Waves,
  plate: Disc3,
  hangboard: HandGrab,
  rower: MoveHorizontal,
  other: CircleEllipsis
};

/** Lucide has no barbell, and a dumbbell glyph for one is a different lift. */
function BarbellGlyph({ size }: { size: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M3 9v6M6 7v10M18 7v10M21 9v6M6 12h12" />
    </svg>
  );
}

export function EquipmentGlyph({
  equipment,
  size = 20
}: {
  equipment: ExerciseEquipment;
  size?: number;
}) {
  const Icon = EQUIPMENT_ICONS[equipment];
  if (Icon === "barbell") return <BarbellGlyph size={size} />;
  return <Icon size={size} aria-hidden="true" />;
}
