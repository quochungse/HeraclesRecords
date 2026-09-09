import type {
  CorosProfile,
  CorosProfileZoneFamily,
  TrainingHubThresholdZone
} from "../../electron/types";

/**
 * COROS `hrZoneType`, labelled as its own web client labels the picker.
 * `title` is the same name in the heading case the panels use.
 */
export interface HeartRateZoneModelDefinition {
  value: number;
  label: string;
  title: string;
  family: CorosProfileZoneFamily;
}

export const HR_ZONE_MODELS: ReadonlyArray<HeartRateZoneModelDefinition> = [
  {
    value: 1,
    label: "Max heart rate",
    title: "Max Heart Rate",
    family: "maxHr"
  },
  {
    value: 2,
    label: "Heart rate reserve",
    title: "Heart Rate Reserve",
    family: "restingHr"
  },
  {
    value: 3,
    label: "Lactate threshold",
    title: "Threshold Heart Rate",
    family: "lthr"
  }
];

export function hrZoneModelDefinition(
  value?: number
): HeartRateZoneModelDefinition | undefined {
  return HR_ZONE_MODELS.find((model) => model.value === value);
}

/** The zone family the account is actually scored against, chart-ready. */
export interface HeartRateZoneModel {
  family: CorosProfileZoneFamily;
  label: string;
  title: string;
  /** Ascending, each `hr` the zone's upper bound — how COROS states them. */
  zones: TrainingHubThresholdZone[];
  /** What the zone percentages are taken of, spelled for the reader. */
  anchorNote?: string;
}

function anchorNote(
  family: CorosProfileZoneFamily,
  thresholds: CorosProfile["thresholds"]
): string | undefined {
  if (family === "maxHr") {
    return thresholds.maxHr ? `Max HR ${thresholds.maxHr} bpm` : undefined;
  }

  if (family === "restingHr") {
    return thresholds.maxHr && thresholds.restingHr
      ? `Max HR ${thresholds.maxHr} bpm · resting ${thresholds.restingHr} bpm`
      : undefined;
  }

  return thresholds.lthr ? `LTHR ${thresholds.lthr} bpm` : undefined;
}

/**
 * Which heart-rate zones a screen should label its distribution with: the ones
 * belonging to the model picked on the Personal screen, not LTHR by default.
 * COROS aggregates `hrTlAreaList` against the account's own model, so reading
 * anything else off `hrZoneType` puts the wrong bpm on every bucket — an
 * account on Heart Rate Reserve was being shown LTHR bounds.
 *
 * Returns null when the profile has no zones for the selected model, which is
 * the caller's cue to fall back to whatever it had before.
 */
export function heartRateZoneModelFromProfile(
  profile: CorosProfile | null | undefined
): HeartRateZoneModel | null {
  if (!profile) {
    return null;
  }

  const definition = hrZoneModelDefinition(profile.hrZoneType);

  if (!definition) {
    return null;
  }

  const zones = profile.thresholds.zones[definition.family]
    .map(
      (zone): TrainingHubThresholdZone => ({
        index: zone.index,
        ...(zone.bpm !== undefined ? { hr: zone.bpm } : {}),
        ...(zone.ratio !== undefined ? { ratio: zone.ratio } : {})
      })
    )
    .sort((left, right) => left.index - right.index);

  if (zones.length === 0) {
    return null;
  }

  const note = anchorNote(definition.family, profile.thresholds);

  return {
    family: definition.family,
    label: definition.label,
    title: definition.title,
    zones,
    ...(note !== undefined ? { anchorNote: note } : {})
  };
}

/**
 * The bpm span of one zone. COROS states a zone by its ceiling, so a zone's
 * floor is the one below it plus a beat; the top zone has no honest ceiling —
 * `rhrZone` fills it with a 404 bpm sentinel — so it reads open-ended.
 *
 * `zoneIndex` is matched against COROS's own zone index first, falling back to
 * array position, because both numbering conventions reach this from callers.
 */
export function formatHeartRateZoneRange(
  zones: TrainingHubThresholdZone[],
  zoneIndex: number
): string {
  const sorted = [...zones].sort((left, right) => left.index - right.index);

  if (sorted.length === 0) {
    return "—";
  }

  const zone =
    sorted.find((entry) => entry.index === zoneIndex) ??
    sorted[zoneIndex] ??
    sorted[sorted.length - 1];
  const position = sorted.findIndex((entry) => entry.index === zone.index);
  const previous = position > 0 ? sorted[position - 1] : undefined;
  const isTopZone = position === sorted.length - 1;

  if (previous?.hr !== undefined) {
    return isTopZone
      ? `≥ ${previous.hr + 1} bpm`
      : zone.hr !== undefined
        ? `${previous.hr + 1}–${zone.hr} bpm`
        : `≥ ${previous.hr + 1} bpm`;
  }

  return zone.hr !== undefined ? `≤ ${zone.hr} bpm` : "—";
}
