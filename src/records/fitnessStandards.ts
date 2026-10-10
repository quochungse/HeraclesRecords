import { messageRecord } from "../i18n/core";

// The two absolute yardsticks the Hall of Records measures speed and aerobic
// fitness against, so that a labour asks the same of everyone: a beginner does
// not reach it by improving on their own first weeks, and an athlete already at
// the top is not shut out for having nowhere left to improve.
//
// **Age grading** — the WMA/USATF road standards approved 2025-01-10, version
// 2025-07-27, by Alan Jones with Tom Bernhard
// (github.com/AlanLyttonJones/Age-Grade-Tables, `2025 Files`, CC0 1.0). A
// distance's open standard divided by the age factor is the best time for that
// age; a run's grade is that time over the athlete's. Only the four distances
// the records keep a best effort for are carried: 5K, 10K, half and marathon.
//
// **VO2max ratings** — The Cooper Institute's norms by age and sex, as Garmin
// and ACSM print them ("Data reprinted with permission from The Cooper
// Institute"): the 60th, 80th and 95th percentiles, rated Good, Excellent and
// Superior. COROS states VO2max on the same ml/kg/min scale.
//
// Node-free like everything under `src/records`, so the suites reach it.

/** COROS's `sex`: 0 male, 1 female. */
export type AthleteSex = 0 | 1;

/** Who is graded when the COROS profile says nothing: the middle of 25–35. */
export const DEFAULT_ATHLETE_AGE = 30;
export const DEFAULT_ATHLETE_SEX: AthleteSex = 0;

export const AGE_GRADED_DISTANCES = [5000, 10000, 21097.5, 42195] as const;
export type AgeGradedDistance = (typeof AGE_GRADED_DISTANCES)[number];

const FIRST_AGE = 5;
const LAST_AGE = 100;

/** Open-class standard in seconds, and the factor for each age 5–100, ×10 000. */
const ROAD_STANDARDS: Readonly<
  Record<"male" | "female", Readonly<Record<AgeGradedDistance, { standard: number; factors: readonly number[] }>>>
> = {
  male: {
    5000: {
      standard: 769,
      factors: [
        6080, 6664, 7200, 7688, 8128, 8520, 8864, 9160, 9408, 9608, 9760, 9864, 9944, 9995, 10000, 10000,
        10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 9999, 9988, 9965, 9930, 9883, 9824, 9755,
        9685, 9615, 9545, 9475, 9405, 9335, 9265, 9195, 9125, 9055, 8985, 8915, 8845, 8775, 8705, 8635,
        8565, 8495, 8425, 8355, 8285, 8215, 8145, 8075, 8005, 7935, 7865, 7795, 7725, 7655, 7585, 7514,
        7436, 7353, 7264, 7169, 7068, 6960, 6847, 6728, 6603, 6472, 6334, 6191, 6042, 5887, 5726, 5558,
        5385, 5206, 5021, 4830, 4632, 4429, 4220, 4005, 3784, 3556, 3323, 3084, 2839, 2588, 2330, 2067
      ]
    },
    10000: {
      standard: 1584,
      factors: [
        5073, 5678, 6243, 6768, 7253, 7698, 8103, 8468, 8793, 9078, 9323, 9528, 9693, 9818, 9903, 9968,
        10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 9996, 9985, 9967, 9942, 9909, 9869,
        9822, 9767, 9705, 9636, 9561, 9486, 9411, 9336, 9261, 9186, 9111, 9036, 8961, 8886, 8811, 8736,
        8661, 8586, 8511, 8436, 8361, 8286, 8211, 8136, 8061, 7986, 7911, 7836, 7761, 7686, 7611, 7536,
        7461, 7386, 7308, 7223, 7131, 7033, 6928, 6816, 6697, 6572, 6440, 6301, 6156, 6004, 5845, 5680,
        5508, 5329, 5143, 4951, 4752, 4546, 4334, 4115, 3889, 3657, 3418, 3172, 2919, 2660, 2394, 2121
      ]
    },
    21097.5: {
      standard: 3451,
      factors: [
        4621, 5364, 6050, 6678, 7248, 7762, 8218, 8616, 8957, 9241, 9467, 9636, 9750, 9850, 9950, 10000,
        10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 9996, 9982, 9960, 9928, 9888,
        9839, 9781, 9714, 9638, 9560, 9483, 9405, 9327, 9249, 9171, 9094, 9016, 8938, 8860, 8782, 8705,
        8627, 8549, 8471, 8393, 8316, 8238, 8160, 8082, 8004, 7927, 7849, 7771, 7693, 7615, 7538, 7460,
        7382, 7304, 7223, 7135, 7040, 6938, 6830, 6715, 6593, 6464, 6328, 6185, 6036, 5880, 5717, 5547,
        5370, 5186, 4996, 4799, 4595, 4384, 4167, 3942, 3711, 3473, 3228, 2976, 2718, 2452, 2180, 1901
      ]
    },
    42195: {
      standard: 7235,
      factors: [
        4414, 5080, 5702, 6279, 6812, 7301, 7745, 8145, 8500, 8811, 9078, 9300, 9500, 9680, 9820, 9920,
        9980, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 9999,
        9979, 9934, 9865, 9783, 9701, 9619, 9537, 9455, 9373, 9291, 9209, 9127, 9045, 8963, 8881, 8799,
        8717, 8635, 8553, 8471, 8389, 8307, 8225, 8143, 8061, 7979, 7897, 7815, 7733, 7651, 7569, 7487,
        7405, 7323, 7241, 7155, 7063, 6963, 6857, 6743, 6623, 6495, 6361, 6219, 6071, 5915, 5753, 5583,
        5407, 5223, 5033, 4835, 4631, 4419, 4201, 3975, 3743, 3503, 3257, 3003, 2743, 2475, 2201, 1919
      ]
    }
  },
  female: {
    5000: {
      standard: 834,
      factors: [
        6903, 7222, 7527, 7816, 8091, 8351, 8596, 8827, 9042, 9243, 9433, 9622, 9811, 9953, 10000, 10000,
        10000, 10000, 10000, 10000, 10000, 10000, 9997, 9990, 9977, 9959, 9936, 9908, 9875, 9836, 9793, 9744,
        9691, 9632, 9568, 9499, 9425, 9346, 9262, 9172, 9078, 8980, 8883, 8786, 8689, 8592, 8495, 8398,
        8301, 8204, 8107, 8009, 7912, 7815, 7718, 7621, 7524, 7427, 7330, 7233, 7136, 7038, 6941, 6844,
        6747, 6650, 6553, 6456, 6359, 6262, 6165, 6067, 5970, 5868, 5758, 5640, 5515, 5382, 5242, 5094,
        4938, 4775, 4604, 4426, 4240, 4046, 3845, 3636, 3419, 3195, 2964, 2725, 2478, 2223, 1961, 1692
      ]
    },
    10000: {
      standard: 1726,
      factors: [
        6850, 7183, 7498, 7794, 8072, 8333, 8574, 8798, 9004, 9191, 9360, 9520, 9680, 9820, 9920, 9980,
        10000, 10000, 10000, 10000, 10000, 10000, 10000, 9998, 9991, 9980, 9964, 9944, 9920, 9891, 9857, 9819,
        9777, 9730, 9679, 9623, 9563, 9499, 9429, 9356, 9278, 9195, 9109, 9017, 8921, 8822, 8723, 8623,
        8524, 8425, 8325, 8226, 8126, 8027, 7928, 7828, 7729, 7629, 7530, 7431, 7331, 7232, 7132, 7033,
        6934, 6834, 6735, 6635, 6536, 6437, 6337, 6234, 6123, 6005, 5879, 5745, 5604, 5455, 5299, 5135,
        4963, 4784, 4597, 4403, 4201, 3991, 3774, 3549, 3317, 3077, 2829, 2574, 2311, 2041, 1763, 1477
      ]
    },
    21097.5: {
      standard: 3772,
      factors: [
        6080, 6474, 6847, 7200, 7533, 7845, 8137, 8408, 8659, 8890, 9100, 9300, 9500, 9680, 9820, 9920,
        9980, 10000, 10000, 10000, 10000, 10000, 10000, 9998, 9991, 9979, 9962, 9941, 9915, 9884, 9849, 9809,
        9764, 9714, 9660, 9601, 9537, 9468, 9395, 9317, 9234, 9147, 9055, 8958, 8856, 8753, 8649, 8546,
        8442, 8339, 8235, 8132, 8028, 7925, 7821, 7718, 7614, 7511, 7407, 7304, 7200, 7097, 6993, 6890,
        6786, 6683, 6579, 6476, 6372, 6269, 6165, 6059, 5945, 5822, 5692, 5554, 5407, 5253, 5091, 4921,
        4742, 4556, 4362, 4159, 3949, 3731, 3504, 3270, 3028, 2778, 2519, 2253, 1979, 1696, 1406, 1108
      ]
    },
    42195: {
      standard: 7796,
      factors: [
        5405, 5874, 6311, 6718, 7093, 7438, 7751, 8034, 8285, 8506, 8695, 8869, 9043, 9217, 9391, 9553,
        9689, 9801, 9888, 9950, 9988, 10000, 10000, 9998, 9992, 9983, 9970, 9953, 9932, 9907, 9879, 9847,
        9811, 9771, 9727, 9680, 9629, 9574, 9515, 9453, 9386, 9316, 9242, 9165, 9083, 8998, 8909, 8816,
        8720, 8619, 8515, 8407, 8297, 8186, 8076, 7965, 7854, 7744, 7633, 7523, 7412, 7301, 7191, 7080,
        6970, 6859, 6748, 6638, 6527, 6413, 6290, 6159, 6021, 5874, 5720, 5557, 5386, 5208, 5021, 4827,
        4624, 4413, 4195, 3968, 3734, 3491, 3240, 2982, 2715, 2441, 2158, 1867, 1569, 1262, 948, 625
      ]
    }
  }
};

/** Whole years on `day` (`YYYYMMDD`) for a COROS birthday (`YYYYMMDD` as a number). */
export function ageOnDay(birthday: number | undefined, day: string): number {
  if (!birthday || !Number.isFinite(birthday)) return DEFAULT_ATHLETE_AGE;
  const born = String(Math.trunc(birthday));
  if (!/^\d{8}$/.test(born)) return DEFAULT_ATHLETE_AGE;
  const years = Number(day.slice(0, 4)) - Number(born.slice(0, 4));
  const age = day.slice(4) < born.slice(4) ? years - 1 : years;
  return age > 0 && age < 120 ? age : DEFAULT_ATHLETE_AGE;
}

export function athleteSex(sex: number | undefined): AthleteSex {
  return sex === 1 ? 1 : DEFAULT_ATHLETE_SEX;
}

export function isAgeGradedDistance(distance: number): distance is AgeGradedDistance {
  return (AGE_GRADED_DISTANCES as readonly number[]).includes(distance);
}

/** The best time on the road for this age and sex, in seconds. */
export function ageStandardSeconds(distance: AgeGradedDistance, age: number, sex: AthleteSex): number {
  const table = ROAD_STANDARDS[sex === 1 ? "female" : "male"][distance]; // i18n-ignore
  const index = Math.min(LAST_AGE, Math.max(FIRST_AGE, Math.round(age))) - FIRST_AGE;
  return table.standard / (table.factors[index] / 10000);
}

/** A run's age grade, 0–1: the age standard over the time. 0.6 is "local class". */
export function ageGrade(distance: AgeGradedDistance, seconds: number, age: number, sex: AthleteSex): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return ageStandardSeconds(distance, age, sex) / seconds;
}

export type Vo2Rating = "good" | "excellent" | "superior";

export const VO2_RATINGS: readonly Vo2Rating[] = ["good", "excellent", "superior"];

export const VO2_RATING_NAMES: Readonly<Record<Vo2Rating, string>> = messageRecord<Vo2Rating>({
  good: "records.vo2.good",
  excellent: "records.vo2.excellent",
  superior: "records.vo2.superior"
});

/** By decade from 20–29 to 70–79; younger reads as 20–29, older as 70–79. */
const VO2_NORMS: Readonly<Record<"male" | "female", Readonly<Record<Vo2Rating, readonly number[]>>>> = {
  male: {
    good: [45.4, 44.0, 42.4, 39.2, 35.5, 32.3],
    excellent: [51.1, 48.3, 46.4, 43.4, 39.5, 36.7],
    superior: [55.4, 54.0, 52.5, 48.9, 45.7, 42.1]
  },
  female: {
    good: [39.5, 37.8, 36.3, 33.0, 30.0, 28.1],
    excellent: [43.9, 42.4, 39.7, 36.7, 33.0, 30.9],
    superior: [49.6, 47.4, 45.3, 41.1, 37.8, 36.7]
  }
};

/** The VO2max a rating starts at, for this age and sex. */
export function vo2RatingThreshold(rating: Vo2Rating, age: number, sex: AthleteSex): number {
  const decade = Math.min(5, Math.max(0, Math.floor(age / 10) - 2));
  return VO2_NORMS[sex === 1 ? "female" : "male"][rating][decade]; // i18n-ignore
}
