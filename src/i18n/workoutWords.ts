import type { WorkoutIntensityInput, WorkoutSwimStroke, WorkoutZone } from "../../electron/types";
import {
  FTP_PRESETS,
  HEART_RATE_PRESETS,
  PACE_PRESETS,
  formatWorkoutIntensity,
  zoneOptionLabel,
  type WorkoutIntensityType
} from "../../electron/workoutCapabilities";
import { formatDecimal, messageRecord, t } from "./core";
import { zoneName } from "./zoneNames";

/**
 * A workout's words as the screen draws them. The tables in
 * `workoutCapabilities.ts` stay English — the coach, the validator and COROS
 * read them — so what is shown is put into the language here, once, and the
 * builder, the day drawer and the library agree on it.
 */

const INTENSITY_TYPE_LABELS = messageRecord<WorkoutIntensityType>({
  none: "workout.intensity.none",
  heartRate: "workout.intensity.heartRate",
  heartRatePercent: "workout.intensity.heartRatePercent",
  pace: "workout.intensity.pace",
  effortPace: "workout.intensity.effortPace",
  thresholdPacePercent: "workout.intensity.thresholdPacePercent",
  effortPacePercent: "workout.intensity.effortPacePercent",
  ftpPercent: "workout.intensity.ftpPercent",
  power: "workout.intensity.power",
  speed: "workout.intensity.speed",
  cadence: "workout.intensity.cadence",
  swimStroke: "workout.intensity.swimStroke",
  weight: "workout.intensity.weight",
  rpe: "workout.intensity.rpe",
  climbGrade: "workout.intensity.climbGrade"
});

export function intensityTypeLabel(type: WorkoutIntensityType): string {
  return INTENSITY_TYPE_LABELS[type];
}

const SWIM_STROKE_LABELS = messageRecord<WorkoutSwimStroke>({
  freestyle: "workout.stroke.freestyle",
  breaststroke: "workout.stroke.breaststroke",
  backstroke: "workout.stroke.backstroke",
  butterfly: "workout.stroke.butterfly",
  mix: "workout.stroke.mix",
  individualMedley: "workout.stroke.individualMedley",
  drills: "workout.stroke.drills",
  notSet: "workout.stroke.notSet"
});

export function swimStrokeLabel(stroke: string): string {
  return SWIM_STROKE_LABELS[stroke as WorkoutSwimStroke] ?? stroke;
}

/** Heart-rate bases are COROS's own abbreviations, the same in every language. */
const HEART_RATE_BASIS: Record<string, string> = {
  maxHr: "% Max HR", // i18n-ignore: a COROS abbreviation
  reserve: "% HRR", // i18n-ignore: a COROS abbreviation
  lthr: "% LTHR" // i18n-ignore: a COROS abbreviation
};

/** `formatWorkoutIntensity`, with its words in the language on screen. */
export function workoutIntensityText(intensity: WorkoutIntensityInput): string {
  switch (intensity.type) {
    case "none":
      return t("workout.notSet");
    case "heartRatePercent":
      if (intensity.preset) {
        const zone = HEART_RATE_PRESETS[intensity.basis].find((entry) => entry.preset === intensity.preset);
        return `${zone ? zoneName(zone.label) : intensity.preset} · ${HEART_RATE_BASIS[intensity.basis] ?? intensity.basis}`;
      }
      break;
    case "thresholdPacePercent":
    case "effortPacePercent":
      if (intensity.preset) {
        const zone = PACE_PRESETS.find((entry) => entry.preset === intensity.preset);
        return zone ? zoneName(zone.label) : intensity.preset;
      }
      break;
    case "ftpPercent":
      if (intensity.preset) {
        const zone = FTP_PRESETS.find((entry) => entry.preset === intensity.preset);
        return zone ? zoneName(zone.label) : intensity.preset;
      }
      break;
    case "swimStroke":
      return swimStrokeLabel(intensity.stroke);
    case "weight":
      return intensity.mode === "bodyweight"
        ? t("workout.bodyweight")
        : `${formatDecimal(intensity.value, Number.isInteger(intensity.value) ? 0 : 1)} ${intensity.unit}`;
    case "climbGrade":
      if ("relativeToOnsight" in intensity && intensity.relativeToOnsight !== undefined) {
        return t("workout.fromOnsight", {
          n: `${intensity.relativeToOnsight >= 0 ? "+" : ""}${intensity.relativeToOnsight}`
        });
      }
      break;
    default:
      break;
  }
  return formatWorkoutIntensity(intensity);
}

/** `zoneOptionLabel` with COROS's zone name in the language on screen. */
export function zoneOptionText(
  definition: { label: string; low: number; high: number },
  index: number,
  total: number,
  configured?: WorkoutZone
): string {
  const text = zoneOptionLabel(definition, index, total, configured);
  return text.startsWith(definition.label)
    ? zoneName(definition.label) + text.slice(definition.label.length)
    : text;
}

const PLAN_STAGE_LABELS = messageRecord({
  none: "library.stage.none",
  preparation: "library.stage.preparation",
  base: "library.stage.base",
  build: "library.stage.build",
  peak: "library.stage.peak",
  race: "library.stage.race",
  transition: "library.stage.transition"
});

/** One of COROS's seven week stages, by its slug, as the screen names it. */
export function planStageLabel(slug: string): string {
  return PLAN_STAGE_LABELS[slug as keyof typeof PLAN_STAGE_LABELS] ?? slug;
}
