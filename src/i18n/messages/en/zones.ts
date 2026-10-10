import type { Translation } from "../../types.ts";

/** COROS's names for its training zones, as its own apps show them. */
const zones = {
  "zones.recovery": "Recovery",
  "zones.warmUp": "Warm Up",
  "zones.fatBurn": "Fat Burn",
  "zones.aerobic": "Aerobic",
  "zones.aerobicEndurance": "Aerobic Endurance",
  "zones.aerobicPower": "Aerobic Power",
  "zones.threshold": "Threshold",
  "zones.anaerobic": "Anaerobic",
  "zones.anaerobicEndurance": "Anaerobic Endurance",
  "zones.anaerobicPower": "Anaerobic Power",
  "zones.sprint": "Sprint",
};

export default zones;
export type ZonesMessages = Translation<typeof zones>;
