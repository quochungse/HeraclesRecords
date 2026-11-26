import { createLucideIcon } from "lucide-react";

/**
 * The Climbing destination's icon: a carabiner hanging at a slant, its gate
 * swung in.
 *
 * Lucide has nothing for climbing a wall — `Mountain` is Hiking's — so this is
 * our own, drawn like `RunnerIcon` through lucide's `createLucideIcon` so it is
 * a real `LucideIcon`. Unlike the runner it is stroked, as lucide's own are,
 * and inherits their stroke width. Upright it read as a zero at the rail's
 * size; tilted, the gate and the spine read as a carabiner. Each node carries
 * its `key`: lucide renders the list without one (see `RunnerIcon`).
 */
export const ClimbIcon = createLucideIcon("climb", [
  ["path", { d: "M7.5 8a4.5 4.5 0 0 1 9 0v8a4.5 4.5 0 0 1-9 0", transform: "rotate(35 12 12)", key: "climb-body" }],
  ["path", { d: "M7.5 8l2 6.6", transform: "rotate(35 12 12)", key: "climb-gate" }]
]);
