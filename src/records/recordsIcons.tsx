import { createLucideIcon } from "lucide-react";
import type { LabourId } from "./labours";

/**
 * The Hall of Records' own icon: a laurel wreath, open at the top.
 *
 * Lucide has no laurel, so it is drawn here the way `RunnerIcon` is — through
 * lucide's `createLucideIcon`, so it is a real `LucideIcon` the nav tree takes
 * beside the others. Stroked like its neighbours (it inherits the root's
 * `stroke="currentColor"`), two stems and five leaves a side. Each node carries
 * a `key` for the reason `runnerIcon.ts` gives.
 */
const LEAF_SIDES: ReadonlyArray<[string, string]> = [
  ["M8.8 20A2.2 2.2 0 0 1 5.8 19.9A2.2 2.2 0 0 1 8.8 20z", "M15.2 20A2.2 2.2 0 0 0 18.2 19.9A2.2 2.2 0 0 0 15.2 20z"],
  ["M6.6 17.8A2.2 2.2 0 0 1 3.6 16.9A2.2 2.2 0 0 1 6.6 17.8z", "M17.4 17.8A2.2 2.2 0 0 0 20.4 16.9A2.2 2.2 0 0 0 17.4 17.8z"],
  ["M5.3 14.5A2.2 2.2 0 0 1 2.5 13A2.2 2.2 0 0 1 5.3 14.5z", "M18.7 14.5A2.2 2.2 0 0 0 21.5 13A2.2 2.2 0 0 0 18.7 14.5z"],
  ["M4.9 11A2.2 2.2 0 0 1 2.6 9A2.2 2.2 0 0 1 4.9 11z", "M19.1 11A2.2 2.2 0 0 0 21.4 9A2.2 2.2 0 0 0 19.1 11z"],
  ["M5 9A2.2 2.2 0 0 1 5.6 5.8A2.2 2.2 0 0 1 5 9z", "M19 9A2.2 2.2 0 0 0 18.4 5.8A2.2 2.2 0 0 0 19 9z"]
];

export const LAUREL_PATH = [
  "M11 21c-4-1-6.5-5-6-12",
  "M13 21c4-1 6.5-5 6-12",
  ...LEAF_SIDES.flat()
].join("");

export const LaurelIcon = createLucideIcon("laurel", [
  ["path", { d: "M11 21c-4-1-6.5-5-6-12", key: "laurel-stem-left" }],
  ["path", { d: "M13 21c4-1 6.5-5 6-12", key: "laurel-stem-right" }],
  ...LEAF_SIDES.flatMap(([left, right], index) => [
    ["path", { d: left, key: `laurel-leaf-left-${index}` }] as ["path", { d: string; key: string }],
    ["path", { d: right, key: `laurel-leaf-right-${index}` }] as ["path", { d: string; key: string }]
  ])
]);

/**
 * One mark per labour, on the same 24-unit grid as lucide and stroked like it:
 * small black-figure silhouettes, readable at a badge's 12px and a card's 28px.
 * Placeholders a designer can redraw without touching anything else — every
 * use goes through `LabourGlyph`.
 */
export const LABOUR_GLYPHS: Readonly<Record<LabourId, string>> = {
  lion: "M12 2.5l2 2.2 2.9-.7.7 2.9 2.6 1.6-1.3 2.7 1.3 2.7-2.6 1.6-.7 2.9-2.9-.7-2 2.2-2-2.2-2.9.7-.7-2.9-2.6-1.6 1.3-2.7-1.3-2.7 2.6-1.6.7-2.9 2.9.7zM8 11.2a4 4 0 1 0 8 0a4 4 0 1 0-8 0M10.4 10.2h.01M13.6 10.2h.01M11 12.6h2l-1 1.1z",
  hydra: "M3 20c1.5-1 3-1 4.5 0s3 1 4.5 0 3-1 4.5 0 3 1 4.5 0M7 18.5c-1.2-3 1.2-5 0-8.2M12 18.5c-1.2-4 1.2-6.5 0-10.2M17 18.5c1.2-3-1.2-5 0-8.2M5.7 9a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0-2.6 0M10.7 7a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0-2.6 0M15.7 9a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0-2.6 0",
  hind: "M12 21l-2.8-5.5v-3L12 10.5l2.8 2v3zM9.2 12.5L6.5 8.5l-.7-4M6.5 8.5L3.8 8M7.4 9.8l1.2-3.6M14.8 12.5l2.7-4 .7-4M17.5 8.5l2.7-.5M16.6 9.8l-1.2-3.6M9.2 13.5l-2.6-.4M14.8 13.5l2.6-.4M11.3 19h1.4",
  boar: "M4 15c0-4.4 3.6-7 8-7 2.6 0 4.6.9 5.8 2.6L21 12v2.5l-2.6.9C17.4 17.4 15 18 12 18H7c-1.7 0-3-1.3-3-3zM18.6 15.2c.9.3 1.9-.2 2.2-1.2M15.5 11.2h.01M9.6 8.3L8.8 5.6l2.8 2.2M8 18v2.5M14 18v2.5",
  stables: "M3.5 11L12 5l8.5 6M5.5 10v6.5h13V10M10 16.5V13h4v3.5M3 20c1.5-1 3-1 4.5 0s3 1 4.5 0 3-1 4.5 0 3 1 4.5 0",
  birds: "M2 10.5c3-2.2 6-1.6 8 1.8 2-3.4 5-4 8-1.8M12.5 17c1.5-1.1 3-.8 4 .9 1-1.7 2.5-2 4-.9",
  bull: "M4 4.5c0 3.2 2 5.3 5 5.3M20 4.5c0 3.2-2 5.3-5 5.3M9 9.8h6l1.2 4.2-2.2 6h-4L7.8 14zM10.4 12.6h.01M13.6 12.6h.01M10.8 17.4h.01M13.2 17.4h.01M8.6 11l-2.8.8M15.4 11l2.8.8",
  mares: "M8.5 21h9v-3.2c0-2 1-3.3 1-6.3 0-4.5-3.2-8-7.8-8L9.6 2l-.7 2.6-4.3 4.6L4 11.6l1.6 1.6L8.3 12l1.6 1.3c-1.1 2.1-1.4 4.2-1.4 7.7zM12 5c1.6.6 3 2.2 3.5 4.3M8.6 7.6h.01",
  girdle: "M3 9.5c3 1.3 6 2 9 2s6-.7 9-2M3 14.5c3 1.3 6 2 9 2s6-.7 9-2M3 9.5v5M21 9.5v5M10.5 10.5h3a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1zM12 13v3",
  cattle: "M3.5 6.5h5M4.3 6.5v13M7.7 6.5v13M3 19.5h6M15.5 6.5h5M16.3 6.5v13M19.7 6.5v13M15 19.5h6M9.8 15.5a2.2 2.2 0 0 1 4.4 0M9.5 15.5h5M12 11.2v1.3M10.1 12.4l.6.8M13.9 12.4l-.6.8",
  apples: "M12 8c-1.5-1-4-1.2-5.5.5C4.8 10.5 5 14 6.5 16.8 7.8 19.2 9.5 21 11 20.5c.6-.2.6-.4 1-.4s.4.2 1 .4c1.5.5 3.2-1.3 4.5-3.7 1.5-2.8 1.7-6.3 0-8.3C16 6.8 13.5 7 12 8zM12 8c0-2 .5-3.5 2-4.5M14 4.5c1.5-1 3.5-.8 4.5.3-1.2 1.2-3 1.4-4.5-.3z",
  cerberus: "M9.5 9.5l.8-2.8L12 8.2l1.7-1.5.8 2.8v4.2L12 16l-2.5-2.3zM3.5 12l.7-2.3 1.4 1.2 1.4-1.2.7 2.3v3.3l-2.1 1.9-2.1-1.9zM16.4 12l.7-2.3 1.4 1.2 1.4-1.2.7 2.3v3.3l-2.1 1.9-2.1-1.9zM5 20.5c2.2-1.4 4.5-2 7-2s4.8.6 7 2"
};

export function LabourGlyph({ id, size }: { id: LabourId; size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={LABOUR_GLYPHS[id]} />
    </svg>
  );
}

/**
 * A labour's medal: dashed while no stage is reached, washed in the accent
 * while some are, and solid once all three are. `reached` is a count, 0–3.
 */
export function LabourMedal({
  id,
  reached,
  size
}: {
  id: LabourId;
  reached: number;
  size: "badge" | "chip" | "card" | "hero";
}) {
  const state = reached >= 3 ? "complete" : reached > 0 ? "begun" : "open";
  const glyph = { badge: 12, chip: 18, card: 28, hero: 46 }[size];
  return (
    <span className={`records-medal is-${size} is-${state}`} aria-hidden="true">
      <LabourGlyph id={id} size={glyph} />
    </span>
  );
}
