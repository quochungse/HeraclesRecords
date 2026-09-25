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
 * `MUSCLE_VIEW`. A body part takes the side the majority of its muscles are
 * on, so Back and Legs draw the back figure and Arms and Core the front.
 *
 * Equipment is an icon rather than a picture: a dumbbell, a cable stack and a
 * sled have no shared frame to be drawn in.
 */
import {
  Anchor,
  Cable,
  CircleDashed,
  Cog,
  Dumbbell,
  PersonStanding,
  Spline,
  Truck,
  Volleyball,
  Waves,
  Weight,
  type LucideIcon
} from "lucide-react";
import type { ExerciseSearchEquipment } from "../../electron/exerciseCatalogSearch";
import type { MuscleId } from "../strength/muscles";
import { BODY_OUTLINE, BODY_SHAPES, BODY_VIEW_BOX, type BodyView } from "./bodyShapes";

/**
 * This app's sixteen muscles against the artwork's own slugs.
 *
 * It is not one-to-one by name: the package calls the lats "upper-back" and
 * the hamstrings "hamstring", and it has no separate shape for the traps on
 * the front. A muscle with no slug at all would simply draw the bare figure,
 * which is why the map is exhaustive rather than partial.
 */
const MUSCLE_SLUG: Readonly<Record<MuscleId, string>> = {
  neck: "neck",
  traps: "trapezius",
  shoulders: "deltoids",
  chest: "chest",
  lats: "upper-back",
  biceps: "biceps",
  triceps: "triceps",
  forearms: "forearm",
  abs: "abs",
  obliques: "obliques",
  lowerBack: "lower-back",
  glutes: "gluteal",
  quads: "quadriceps",
  hamstrings: "hamstring",
  adductors: "adductors",
  calves: "calves"
};

/**
 * The side of the body each muscle is drawn on.
 *
 * **Stated, not counted.** The artwork carries a sliver for most muscles on
 * both views — there is a triceps edge on the front figure and a trapezius
 * edge on it too — so choosing the view by "which one has a shape for this"
 * put the triceps on a chest and the traps on a pair of shoulders, both of
 * them a few pixels of green where the muscle is barely visible. A triceps is
 * a back muscle; that is a fact about anatomy, not about the path data.
 */
const MUSCLE_VIEW: Readonly<Record<MuscleId, BodyView>> = {
  neck: "front",
  traps: "back",
  shoulders: "front",
  chest: "front",
  lats: "back",
  biceps: "front",
  triceps: "back",
  forearms: "front",
  abs: "front",
  obliques: "front",
  lowerBack: "back",
  glutes: "back",
  quads: "front",
  hamstrings: "back",
  adductors: "front",
  calves: "back"
};

/** How many of these muscles the artwork can actually draw on a given view. */
function drawableOn(view: BodyView, muscles: readonly MuscleId[]): string[] {
  const shapes = BODY_SHAPES[view];
  return muscles
    .map((muscle) => MUSCLE_SLUG[muscle])
    .filter((slug, index, all) => all.indexOf(slug) === index && Boolean(shapes[slug]));
}

/**
 * The muscles vote with the side they belong to, and the front wins a tie —
 * it is the figure a reader expects when nothing argues otherwise. So Back and
 * Legs draw the back, Arms and Core the front.
 */
function chooseView(muscles: readonly MuscleId[]): BodyView {
  let back = 0;
  for (const muscle of muscles) {
    if (MUSCLE_VIEW[muscle] === "back") back += 1;
  }
  return back > muscles.length - back ? "back" : "front";
}

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

const EQUIPMENT_ICONS: Readonly<Record<ExerciseSearchEquipment, LucideIcon | "barbell">> = {
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
  rope: Waves
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
  equipment: ExerciseSearchEquipment;
  size?: number;
}) {
  const Icon = EQUIPMENT_ICONS[equipment];
  if (Icon === "barbell") return <BarbellGlyph size={size} />;
  return <Icon size={size} aria-hidden="true" />;
}
