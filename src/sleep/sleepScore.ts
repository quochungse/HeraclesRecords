import { t } from "../i18n/core";

/**
 * COROS's sleep score, banded once.
 *
 * The thresholds were copied into three components — the Overview card, the
 * night list and the night detail — which is three places for them to drift
 * and no way to notice: a night scoring 74 would have read "Fair" on one
 * surface and "Good" on another with nobody the wiser.
 */
export type SleepScoreTone = "low" | "mid" | "good" | "high" | "neutral";

export function sleepScoreTone(score?: number): SleepScoreTone {
  if (score === undefined || !Number.isFinite(score)) {
    return "neutral";
  }

  if (score < 60) {
    return "low";
  }

  if (score < 75) {
    return "mid";
  }

  if (score < 90) {
    return "good";
  }

  return "high";
}

/**
 * `waitingLabel` is what an absent score reads as, which differs by surface:
 * the Overview card is waiting for tonight's sync, a night in the list simply
 * never got one.
 */
export function sleepScoreLabel(
  score?: number,
  waitingLabel = t("sleep.score.none")
): string {
  switch (sleepScoreTone(score)) {
    case "low":
      return t("sleep.score.poor");
    case "mid":
      return t("sleep.score.fair");
    case "good":
      return t("sleep.score.good");
    case "high":
      return t("sleep.score.excellent");
    default:
      return waitingLabel;
  }
}
