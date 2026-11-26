import { createLucideIcon } from "lucide-react";

/**
 * The Climbing destination's icon: a carabiner, its gate swung in.
 *
 * Lucide has nothing for climbing a wall — `Mountain` is Hiking's — so this is
 * our own, drawn like `RunnerIcon` through lucide's `createLucideIcon` so it is
 * a real `LucideIcon`. Unlike the runner it is stroked, as lucide's own are,
 * and inherits their stroke width. Each node carries its `key`: lucide renders
 * the list without one (see `RunnerIcon`).
 */
export const ClimbIcon = createLucideIcon("climb", [
  ["path", { d: "M7 8.5a5 5 0 0 1 10 0v7a5 5 0 0 1-10 0", key: "climb-body" }],
  ["path", { d: "M7 8.5l2.2 6.8", key: "climb-gate" }],
  ["path", { d: "M17 11.5h-2", key: "climb-nose" }]
]);
