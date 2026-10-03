import type { CSSProperties } from "react";
import { createLucideIcon } from "lucide-react";
import type { LabourId } from "./labours";
import lionArt from "../assets/labours/lion.webp";
import hydraArt from "../assets/labours/hydra.webp";
import hindArt from "../assets/labours/hind.webp";
import boarArt from "../assets/labours/boar.webp";
import stablesArt from "../assets/labours/stables.webp";
import birdsArt from "../assets/labours/birds.webp";
import bullArt from "../assets/labours/bull.webp";
import maresArt from "../assets/labours/mares.webp";
import girdleArt from "../assets/labours/girdle.webp";
import cattleArt from "../assets/labours/cattle.webp";
import applesArt from "../assets/labours/apples.webp";
import cerberusArt from "../assets/labours/cerberus.webp";

/**
 * The Hall of Records' own icon: a laurel wreath, open at the top, its two
 * branches crossing at the foot.
 *
 * Traced from the athlete's own artwork (a gold wreath) into one filled
 * silhouette on lucide's 24-unit grid — the outline of both branches, and the
 * two gaps the crossing stems enclose, read even-odd. It is filled with
 * `currentColor` rather than stroked like its neighbours: a wreath drawn in
 * strokes at 18px is a scribble, and a fill takes the rail's ink and the
 * active row's accent like any other icon. Lucide has no laurel, so it goes
 * through `createLucideIcon` the way `RunnerIcon` does, and the hall's
 * Apotheosis panel and the celebration draw the same path larger.
 */
const LAUREL_LOOPS: readonly string[] = [
  "M8.93 2.98L8.99 2.98L8.89 3.19L8.02 4.54L7.38 5.12L6.33 5.71L6.05 6.09L5.67 6.76L5.42 7.27L5.49 7.28L5.68 7.14L6.15 6.43L6.71 5.96L7.06 5.80L7.50 5.67L7.93 5.61L8.52 5.63L7.67 6.56L7.21 6.98L6.49 7.31L5.66 7.41L5.25 7.73L4.71 9.07L4.46 10.12L4.44 10.50L4.59 10.29L4.73 9.66L4.90 9.20L5.35 8.57L5.66 8.31L6.21 8.02L6.71 7.85L7.14 7.81L6.54 8.95L6.12 9.56L5.53 10.09L4.94 10.39L4.55 10.71L4.42 11.00L4.40 11.51L4.46 12.52L4.69 13.52L4.76 13.32L4.69 12.31L4.77 11.86L4.94 11.47L5.19 11.09L5.52 10.75L6.02 10.37L6.40 10.16L6.25 11.30L6.04 12.01L5.70 12.60L4.92 13.53L4.83 13.86L4.88 14.20L5.17 14.91L5.46 15.46L5.93 16.17L6.17 16.42L6.14 16.21L5.61 15.20L5.52 14.79L5.51 14.32L5.57 13.95L5.74 13.53L6.16 12.90L6.54 12.46L6.83 13.57L6.92 14.36L6.83 14.94L6.39 16.05L6.43 16.63L6.73 17.05L7.29 17.58L8.01 18.13L8.77 18.58L9.06 18.72L9.07 18.65L7.84 17.61L7.62 17.35L7.33 16.76L7.25 16.30L7.25 15.92L7.37 15.25L7.59 14.51L8.22 15.25L8.77 16.17L8.98 16.84L9.16 18.19L9.25 18.44L9.46 18.73L9.77 19.01L10.07 19.14L12.00 19.78L13.97 19.13L14.31 18.95L14.55 18.73L14.74 18.44L14.84 18.19L14.98 17.01L15.23 16.17L15.61 15.50L16.41 14.49L16.67 15.42L16.75 15.98L16.75 16.33L16.67 16.76L16.45 17.22L16.16 17.61L15.65 18.07L15.11 18.46L14.90 18.69L14.94 18.72L15.23 18.59L15.99 18.13L16.70 17.58L17.35 16.97L17.56 16.63L17.61 16.05L17.16 14.95L17.08 14.24L17.17 13.57L17.46 12.46L17.71 12.73L18.22 13.45L18.39 13.82L18.48 14.20L18.49 14.66L18.43 15.04L18.26 15.49L17.86 16.21L17.82 16.42L17.90 16.38L18.36 15.75L19.00 14.53L19.17 13.99L19.11 13.61L18.95 13.32L18.21 12.48L17.96 12.01L17.75 11.30L17.60 10.16L18.39 10.67L18.81 11.09L19.07 11.47L19.23 11.85L19.32 12.31L19.24 13.32L19.31 13.51L19.45 13.02L19.58 12.22L19.57 10.96L19.45 10.71L19.27 10.53L18.47 10.08L17.84 9.50L17.46 8.93L16.86 7.81L17.11 7.81L17.80 8.02L18.34 8.31L18.68 8.59L19.02 9.03L19.18 9.37L19.41 10.29L19.52 10.47L19.57 10.46L19.54 10.12L19.21 8.82L18.77 7.77L18.59 7.56L18.34 7.41L17.38 7.27L16.79 6.97L16.45 6.68L15.48 5.63L16.03 5.61L16.49 5.66L16.95 5.80L17.29 5.96L17.84 6.41L18.33 7.14L18.57 7.27L17.73 5.75L17.42 5.52L16.76 5.21L16.24 4.81L15.74 4.20L15.02 2.98L15.74 3.14L16.45 3.44L16.98 3.78L17.42 4.20L17.67 4.55L17.84 4.96L17.98 5.80L19.14 8.03L19.16 7.64L18.64 6.59L18.51 6.17L18.46 5.38L18.59 4.54L18.68 4.27L19.36 5.21L19.69 5.92L19.78 6.38L19.78 6.72L19.69 7.22L19.34 8.02L19.29 8.36L19.65 9.62L19.81 10.68L19.92 10.42L19.73 9.24L19.81 8.44L20.10 7.73L20.70 6.78L21.07 8.16L21.12 8.65L21.08 9.16L20.95 9.53L20.74 9.90L20.05 10.71L19.88 11.05L19.82 12.18L19.60 13.47L19.83 13.15L20.11 11.90L20.48 11.13L21.16 10.36L21.88 9.74L21.87 10.54L21.79 11.34L21.70 11.72L21.49 12.22L21.21 12.64L20.95 12.90L20.61 13.15L19.90 13.51L19.58 13.82L19.06 15.04L18.39 16.17L18.55 16.14L18.78 15.96L19.43 14.83L19.94 14.24L20.57 13.78L21.93 13.06L22.00 13.07L21.71 13.90L21.20 14.91L20.70 15.51L20.19 15.88L19.73 16.09L18.68 16.32L18.30 16.48L17.12 17.60L16.34 18.23L16.49 18.27L16.75 18.21L17.92 17.30L18.85 16.84L20.82 16.40L20.70 16.68L19.82 17.73L19.44 18.07L18.97 18.36L18.38 18.57L18.05 18.62L17.54 18.61L16.70 18.46L16.07 18.50L14.56 19.28L12.74 19.95L12.76 20.02L13.33 20.25L13.93 20.58L14.65 21.19L14.73 21.30L14.25 21.46L13.97 21.52L13.68 21.17L13.18 20.73L12.59 20.39L12.00 20.17L11.41 20.39L10.78 20.77L10.36 21.13L10.03 21.52L9.27 21.30L9.68 20.88L10.07 20.58L10.75 20.20L11.29 20.00L11.27 19.95L9.35 19.25L7.93 18.51L7.34 18.46L6.45 18.61L5.87 18.61L5.22 18.44L4.56 18.07L3.77 17.26L3.26 16.61L3.14 16.42L3.18 16.40L4.73 16.71L5.49 16.97L6.16 17.35L7.25 18.21L7.42 18.26L7.65 18.23L6.68 17.43L5.70 16.48L5.32 16.32L4.61 16.18L4.06 16.01L3.61 15.75L3.30 15.51L2.92 15.08L2.62 14.62L2.29 13.90L2.00 13.06L3.43 13.77L4.10 14.28L4.57 14.83L5.22 15.96L5.45 16.15L5.60 16.17L4.98 15.11L4.42 13.82L4.10 13.51L3.56 13.24L3.01 12.86L2.80 12.64L2.51 12.21L2.34 11.84L2.21 11.34L2.12 9.74L2.84 10.36L3.52 11.13L3.90 11.93L4.16 13.15L4.40 13.46L4.22 12.48L4.13 11.05L3.96 10.71L3.22 9.83L2.92 9.16L2.88 8.69L2.93 8.15L3.30 6.76L3.85 7.64L4.19 8.48L4.27 9.24L4.08 10.37L4.19 10.66L4.35 9.66L4.72 8.32L4.66 8.02L4.27 7.08L4.22 6.38L4.35 5.84L4.73 5.08L5.32 4.27L5.54 5.38L5.54 5.84L5.45 6.34L4.84 7.64L4.86 8.04L5.56 6.59L5.98 5.88L6.16 4.96L6.37 4.49L6.58 4.20L7.08 3.73L7.55 3.44L8.14 3.18z",
  "M7.10 19.03L7.76 19.01L8.18 19.06L8.72 19.24L9.99 19.78L9.73 19.85L8.93 20.25L8.46 20.41L7.84 20.47L7.29 20.38L6.37 20.00L5.50 19.41z",
  "M16.03 19.03L16.91 19.03L18.50 19.41L17.71 19.96L17.00 20.29L16.32 20.46L15.78 20.46L15.28 20.33L14.35 19.88L13.99 19.78L15.40 19.19z",
];

const LAUREL_PATH = LAUREL_LOOPS.join("");

export const LaurelIcon = createLucideIcon("laurel", [
  ["path", { d: LAUREL_PATH, fill: "currentColor", stroke: "none", fillRule: "evenodd", key: "laurel" }]
]);

/** The wreath at any size, filled with the text colour around it. */
export function LaurelWreath({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d={LAUREL_PATH} fillRule="evenodd" />
    </svg>
  );
}

/*
 * One emblem per labour: gold relief cut from the athlete's own artwork, its
 * black ground keyed out to transparency and its frame taken off, so the frame
 * is drawn here and can follow the size and the state. 256px squares, the
 * figure centred at 84% of the side.
 */
export const LABOUR_ART: Readonly<Record<LabourId, string>> = {
  lion: lionArt,
  hydra: hydraArt,
  hind: hindArt,
  boar: boarArt,
  stables: stablesArt,
  birds: birdsArt,
  bull: bullArt,
  mares: maresArt,
  girdle: girdleArt,
  cattle: cattleArt,
  apples: applesArt,
  cerberus: cerberusArt
};

/**
 * Where an emblem is drawn, and so how large. The relief is detailed, so it is
 * never asked to read below 24px, and only the timeline's inline badge goes
 * that small — bare there, because a plate and a rim at that size are only
 * noise around a figure that is already hard to make out.
 */
const EMBLEM_SIZES = {
  badge: 24,
  tag: 36,
  chip: 40,
  toast: 44,
  card: 76,
  hero: 88
} as const;

export type LabourEmblemSize = keyof typeof EMBLEM_SIZES;

/**
 * A labour's emblem on its plate. The plate is the artwork's own black in
 * every theme — the relief was cast for it — and the light on it says how far
 * the labour has gone, one step per stage: unlit and grey at none, a dim gold
 * at I, nearly full at II, and full gold with a glowing rim at III. `reached`
 * is a count, 0–3.
 */
export function LabourEmblem({
  id,
  reached,
  size
}: {
  id: LabourId;
  reached: number;
  size: LabourEmblemSize;
}) {
  const stage = Math.max(0, Math.min(3, Math.floor(reached)));
  return (
    <span
      className={`labour-emblem is-${size} is-stage-${stage}`}
      style={{ "--emblem-size": `${EMBLEM_SIZES[size]}px` } as CSSProperties}
      aria-hidden="true"
    >
      <img src={LABOUR_ART[id]} alt="" draggable={false} decoding="async" />
    </span>
  );
}
