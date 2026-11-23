import { createLucideIcon } from "lucide-react";
import { MENTOR_PORTRAIT_PATH } from "./mentorPortrait";

/**
 * Mentor's icon, its portrait (`mentorPortrait.ts`) at the rail's sizes.
 *
 * Traced from the athlete's own line art into one filled even-odd path on
 * lucide's 24-unit grid, fitted to the 22-unit optical box like `RunnerIcon`
 * (see there for why the path states its own fill and stroke, and why it
 * carries a `key`). The lines were thickened before tracing to about one unit:
 * heavier closed the gaps between the curls at the rail's 16px.
 */
export const MentorIcon = createLucideIcon("mentor", [
  [
    "path",
    {
      d: MENTOR_PORTRAIT_PATH,
      fill: "currentColor",
      fillRule: "evenodd",
      stroke: "none",
      key: "mentor-head"
    }
  ]
]);
