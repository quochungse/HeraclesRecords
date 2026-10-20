import type {
  CorosProfileZoneFamily,
  SessionIntensity,
  SessionRep
} from "../../electron/types";
import {
  lowerMedian,
  sportHasTrainingBenefit,
  summarizeSessionIntensity,
  type IntensityInput
} from "../../electron/sessionIntensity.ts";

/*
 * What a run or a ride trained, in one word, and what shape of session it was —
 * read off the intensity `electron/sessionIntensity.ts` keeps on the summary.
 *
 * The words and their bounds follow published standards rather than this
 * app's taste. COROS's own zones line up with Daniels' paces — Aerobic
 * Endurance with E, Aerobic Power with M, Threshold with T, Anaerobic
 * Endurance with I, Anaerobic Power with R — so the label reads the athlete's
 * zones and names them as Daniels does:
 *  - a repeat session is labelled by its work bouts (Seiler & Kjerland's
 *    session-goal method): a rep on its pace where it has one, as Daniels sets
 *    reps by pace, on its heart rate elsewhere; a rep under two minutes at
 *    interval pace or faster is a repetition (R), and the least work each
 *    session takes is Daniels';
 *  - a steady session by its seconds after the warm-up, each counted at the
 *    lower of what pace and heart rate say where both were read, so a hot easy
 *    run's drifting pulse does not make it a tempo run.
 * Node-free and React-free, so a suite can reach it.
 */

export { sportHasTrainingBenefit };

/** Easiest to hardest; a benefit's index is its rank. */
export const TRAINING_BENEFITS = [
  "recovery",
  "aerobic",
  "tempo",
  "threshold",
  "vo2max",
  "anaerobic"
] as const;

export type TrainingBenefit = (typeof TRAINING_BENEFITS)[number];

const RANK = Object.fromEntries(TRAINING_BENEFITS.map((benefit, rank) => [benefit, rank])) as Readonly<
  Record<TrainingBenefit, number>
>;

/**
 * The account's heart-rate model once its profile has answered: a family, or
 * null when the answer had none. `undefined` is the wait for it, and labels
 * nothing — a label drawn on the wrong model and corrected a moment later is a
 * row changing its word under the athlete.
 */
export type BenefitZoneFamily = CorosProfileZoneFamily | null;

/** The family to label on, from `useHeartRateZoneModel`'s answer: nothing until it has settled. */
export function benefitZoneFamily(state: {
  settled: boolean;
  model: { family: CorosProfileZoneFamily } | null;
}): BenefitZoneFamily | undefined {
  return state.settled ? (state.model?.family ?? null) : undefined;
}

/**
 * Each HR bucket's rank. Reserve and LTHR name their buckets as the ranks
 * above. Max HR's sit at 50/60/70/80/90% of max: Warm Up is still easy, its
 * Threshold is the fifth bucket, and its top is where interval work lands.
 */
const RESERVE_TIERS: readonly number[] = [0, 1, 2, 3, 4, 5];
const MAX_HR_TIERS: readonly number[] = [0, 0, 1, 2, 3, 4];
/** COROS's seven pace buckets: Threshold is stored in two, split at threshold speed. */
const PACE_TIERS: readonly number[] = [0, 1, 2, 3, 3, 4, 5];

/** Less activity time than this is a warm-up or a commute, not a session to label. */
export const MIN_BENEFIT_SECONDS = 10 * 60;
/**
 * Less than this read after the warm-up — no heart rate recorded, or a run
 * that barely outlasted the warm-up — says nothing about a steady session.
 */
const MIN_STEADY_READ_SECONDS = 5 * 60;

/**
 * Daniels' sessions, and the least work each takes to be one: R repetitions
 * add up to a few minutes, I intervals to eight or more, a T or M session to
 * twenty — a tempo run, or cruise intervals that add up to one.
 */
const MIN_WORK_SECONDS: Readonly<Partial<Record<TrainingBenefit, number>>> = {
  anaerobic: 4 * 60,
  vo2max: 8 * 60,
  threshold: 20 * 60,
  tempo: 20 * 60
};
/** A steady session is VO2 Max only when that work is a real share of it — a 5K race, not a hard finish. */
const STEADY_VO2MAX_SHARE = 0.25;
/** And Tempo only when the tempo running is the session, not a drift at its end. */
const STEADY_TEMPO_SHARE = 0.5;
/** Daniels' recovery run: short and very easy. */
const RECOVERY_MAX_SECONDS = 45 * 60;
const RECOVERY_SHARE = 0.7;
/** Daniels' I reps run three to five minutes; a shorter one at I pace or faster is an R rep. */
const REPETITION_UNDER_SECONDS = 2 * 60;
/** Strides: a handful of short accelerations added to an easy run. */
const STRIDE_MAX_SECONDS = 45;
const STRIDES_MAX_WORK_SECONDS = 5 * 60;
/** A long run is 90 minutes or more; a long ride three hours. */
const LONG_RUN_SECONDS = 90 * 60;
const LONG_RIDE_SECONDS = 3 * 60 * 60;

/** What a rep was set as: whichever of time and distance the reps hold to more closely. */
export type RepSize = { unit: "seconds" | "meters"; value: number };

export type SessionFormat =
  | { kind: "intervals" | "strides"; count: number; size: RepSize }
  | { kind: "long"; ride: boolean };

export type BenefitBasis =
  /** The reps decided it, read mostly on pace or mostly on heart rate. */
  | { kind: "reps"; count: number; measure: "pace" | "hr" }
  /**
   * The session's seconds after the warm-up: at the benefit or harder, or for
   * Recovery and Aerobic at it or easier. `both` counts a second only where
   * pace and heart rate agree.
   */
  | { kind: "steady"; measure: "both" | "hr"; seconds: number; share: number };

export interface TrainingBenefitReading {
  primary: TrainingBenefit;
  basis: BenefitBasis;
  format?: SessionFormat;
}

type Reading = Omit<TrainingBenefitReading, "format">;

/** Coefficient of variation; Infinity where there is nothing to divide by. */
function spread(values: readonly number[]): number {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (!(mean > 0)) return Infinity;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}

/** Strides are said in seconds whatever was set: GPS measures a 100 m stride as 40 to 80. */
function repSize(reps: readonly SessionRep[], strides: boolean): RepSize {
  const seconds = reps.map((rep) => rep.seconds);
  const meters = reps.map((rep) => rep.meters);
  return !strides && spread(meters) < spread(seconds)
    ? { unit: "meters", value: lowerMedian(meters) }
    : { unit: "seconds", value: lowerMedian(seconds) };
}

/** A rep's rank: on its pace where it has one, else on its heart rate. */
function repRank(rep: SessionRep, tiers: readonly number[]): number | undefined {
  const rank = rep.paceBucket !== undefined
    ? PACE_TIERS[rep.paceBucket]
    : rep.hrBucket !== undefined
      ? tiers[rep.hrBucket]
      : undefined;
  if (rank === undefined) return undefined;
  return rank >= RANK.vo2max && rep.seconds < REPETITION_UNDER_SECONDS ? RANK.anaerobic : rank;
}

/**
 * A repeat session's shape, and its label when the reps carry enough work to
 * decide it. Reps too few to decide it are pick-ups on another session, and
 * `accessory` says so.
 */
function fromReps(
  reps: readonly SessionRep[],
  tiers: readonly number[]
): { format: SessionFormat; reading?: Reading; accessory?: true } {
  const work = reps.reduce((sum, rep) => sum + rep.seconds, 0);
  const strides =
    lowerMedian(reps.map((rep) => rep.seconds)) < STRIDE_MAX_SECONDS && work < STRIDES_MAX_WORK_SECONDS;
  const format: SessionFormat = {
    kind: strides ? "strides" : "intervals",
    count: reps.length,
    size: repSize(reps, strides)
  };
  if (strides) return { format, accessory: true };

  const ranks = reps
    .map((rep) => repRank(rep, tiers))
    .filter((rank): rank is number => rank !== undefined);
  if (ranks.length === 0) return { format, accessory: true };
  const primary = TRAINING_BENEFITS[lowerMedian(ranks)]!;
  const needed = MIN_WORK_SECONDS[primary];
  if (needed === undefined || work < needed) return { format, accessory: true };
  const onPace = reps.filter((rep) => rep.paceBucket !== undefined).length;
  return {
    format,
    reading: {
      primary,
      basis: { kind: "reps", count: reps.length, measure: onPace * 2 > reps.length ? "pace" : "hr" }
    }
  };
}

/** Seconds per rank after the warm-up: each at the lower of pace and heart rate where both were read. */
function rankedSeconds(intensity: SessionIntensity, tiers: readonly number[]): number[] {
  const ranked = new Array<number>(TRAINING_BENEFITS.length).fill(0);
  if (intensity.joint) {
    intensity.joint.forEach((row, hr) =>
      row.forEach((seconds, pace) => {
        ranked[Math.min(tiers[hr] ?? 0, PACE_TIERS[pace] ?? 0)]! += seconds;
      })
    );
  } else {
    intensity.hr.forEach((seconds, hr) => {
      ranked[tiers[hr] ?? 0]! += seconds;
    });
  }
  return ranked;
}

/**
 * A session without reps that decide it: hardest first, as each standard
 * defines it. Nothing when too little of it was read to say.
 */
function steady(intensity: SessionIntensity, tiers: readonly number[]): Reading | undefined {
  const ranked = rankedSeconds(intensity, tiers);
  const total = ranked.reduce((sum, value) => sum + value, 0);
  if (total < MIN_STEADY_READ_SECONDS) return undefined;
  const measure = intensity.joint ? "both" : "hr";
  const atOrAbove = (benefit: TrainingBenefit) =>
    ranked.slice(RANK[benefit]).reduce((sum, value) => sum + value, 0);
  const share = (seconds: number) => (total > 0 ? seconds / total : 0);
  const reading = (primary: TrainingBenefit, seconds: number): Reading => ({
    primary,
    basis: { kind: "steady", measure, seconds, share: share(seconds) }
  });

  const anaerobic = atOrAbove("anaerobic");
  if (anaerobic >= MIN_WORK_SECONDS.anaerobic!) return reading("anaerobic", anaerobic);
  const vo2max = atOrAbove("vo2max");
  if (vo2max >= MIN_WORK_SECONDS.vo2max! && share(vo2max) >= STEADY_VO2MAX_SHARE) {
    return reading("vo2max", vo2max);
  }
  const threshold = atOrAbove("threshold");
  if (threshold >= MIN_WORK_SECONDS.threshold!) return reading("threshold", threshold);
  const tempo = atOrAbove("tempo");
  if (tempo >= MIN_WORK_SECONDS.tempo! && share(tempo) >= STEADY_TEMPO_SHARE) {
    return reading("tempo", tempo);
  }
  const easiest = ranked[RANK.recovery]!;
  if (intensity.seconds <= RECOVERY_MAX_SECONDS && share(easiest) >= RECOVERY_SHARE) {
    return reading("recovery", easiest);
  }
  // Everything else is easy running: the time below Tempo.
  return reading("aerobic", total - tempo);
}

/**
 * The session's label and shape, or nothing: the wrong sport, no intensity
 * read yet, under ten minutes, too little read after the warm-up, or the
 * account's model not known yet.
 */
export function trainingBenefit(
  sportType: number | undefined,
  intensity: SessionIntensity | undefined,
  family: BenefitZoneFamily | undefined
): TrainingBenefitReading | undefined {
  if (family === undefined || !intensity || !sportHasTrainingBenefit(sportType)) return undefined;
  if (intensity.seconds < MIN_BENEFIT_SECONDS) return undefined;

  const tiers = family === "maxHr" ? MAX_HR_TIERS : RESERVE_TIERS;
  const repeats = intensity.reps?.length ? fromReps(intensity.reps, tiers) : undefined;
  const reading = repeats?.reading ?? steady(intensity, tiers);
  if (!reading) return undefined;
  const ride = (sportType ?? 0) >= 200;
  const long = intensity.seconds >= (ride ? LONG_RIDE_SECONDS : LONG_RUN_SECONDS);
  // Pick-ups that decide nothing say less about a long run than its length does; strides stay strides.
  const format =
    repeats && (!repeats.accessory || repeats.format.kind === "strides" || !long)
      ? repeats.format
      : long
        ? { kind: "long" as const, ride }
        : undefined;
  return format ? { ...reading, format } : reading;
}

/**
 * A loaded detail's reading, as its list row's summary was made: the pane and
 * the run and ride pages re-render often, and a detail is never changed in
 * place, so its intensity is worked out once per detail object.
 */
const detailIntensities = new WeakMap<object, SessionIntensity | null>();

export function detailTrainingBenefit(
  detail: IntensityInput | null | undefined,
  sportType: number | undefined,
  family: BenefitZoneFamily | undefined
): TrainingBenefitReading | undefined {
  if (!detail) return undefined;
  let intensity = detailIntensities.get(detail);
  if (intensity === undefined) {
    intensity = summarizeSessionIntensity(detail, sportType) ?? null;
    detailIntensities.set(detail, intensity);
  }
  return trainingBenefit(sportType, intensity ?? undefined, family);
}
