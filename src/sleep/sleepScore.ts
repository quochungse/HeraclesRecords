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
  waitingLabel = "No score"
): string {
  switch (sleepScoreTone(score)) {
    case "low":
      return "Poor";
    case "mid":
      return "Fair";
    case "good":
      return "Good";
    case "high":
      return "Excellent";
    default:
      return waitingLabel;
  }
}
