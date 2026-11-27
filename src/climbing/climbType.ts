import type { ClimbStyle, TrainingHubActivity } from "../../electron/types";
import { isClimbSportType } from "../../electron/climbDetail";
import type { ClimbFamily } from "../../electron/climbGrades";
import { t } from "../i18n/core";

/**
 * The four kinds of climbing COROS records, each its own sport code: a rope
 * route indoors, a boulder, a route outdoors and a multi-pitch. A boulder is
 * graded on a ladder of its own (V, Font); the three rope kinds share the
 * route ladder (YDS, French, UIAA, Ewbank), so their grades are compared and a
 * boulder's never are.
 *
 * Codes are COROS `sportType`; keep them in sync with electron/corosSportTypes.ts.
 */
export type ClimbKind = "indoor" | "boulder" | "outdoor" | "multiPitch";

/** Render order: the everyday kinds first. */
export const CLIMB_KINDS: readonly ClimbKind[] = ["indoor", "boulder", "outdoor", "multiPitch"];

const SPORT_TYPE_KIND: Record<number, ClimbKind> = {
  800: "indoor", //      Indoor Climb
  801: "boulder", //     Bouldering
  802: "outdoor", //     Outdoor Climb
  10003: "multiPitch" // Multi-Pitch Climb
};

export const CLIMB_KIND_LABELS: Readonly<Record<ClimbKind, string>> = {
  get indoor() {
    return t("climb.kind.indoor");
  },
  get boulder() {
    return t("climb.kind.boulder");
  },
  get outdoor() {
    return t("climb.kind.outdoor");
  },
  get multiPitch() {
    return t("climb.kind.multiPitch");
  }
};

/** How a climb went, in the language on screen — COROS's own words for it. */
export const CLIMB_STYLE_LABELS: Readonly<Record<ClimbStyle, string>> = {
  get onsight() {
    return t("climb.style.onsight");
  },
  get flash() {
    return t("climb.style.flash");
  },
  get redpoint() {
    return t("climb.style.redpoint");
  },
  get repeat() {
    return t("climb.style.repeat");
  },
  get attempt() {
    return t("climb.style.attempt");
  },
  get unrecorded() {
    return t("climb.style.unrecorded");
  }
};

export const CLIMB_FAMILY_LABELS: Readonly<Record<ClimbFamily, string>> = {
  get route() {
    return t("climb.family.routes");
  },
  get boulder() {
    return t("climb.family.boulders");
  }
};

/** A climbing session: the main process's answer, so both layers agree. */
export { isClimbSportType };

export function classifyClimbKind(sportType: number | undefined): ClimbKind | null {
  return sportType === undefined ? null : SPORT_TYPE_KIND[sportType] ?? null;
}

/** Climbing sessions of one kind, or all of them when no kind is asked for. */
export function climbsOfKind(
  activities: readonly TrainingHubActivity[],
  kind: ClimbKind | null
): TrainingHubActivity[] {
  return activities.filter(
    (activity) =>
      isClimbSportType(activity.sportType) &&
      (kind === null || classifyClimbKind(activity.sportType) === kind)
  );
}

/** A grade's name as the screen says it: a scale's own, or a word for "@easy" and its kin. */
export function gradeLabel(name: string): string {
  if (name === "@easy") return t("climb.grade.easy");
  if (name === "@low5th") return t("climb.grade.low5th");
  if (name === "@jug") return t("climb.grade.jug");
  return name;
}
