import { t, type MessageKey } from "./core";

/**
 * COROS's own zone names, as the main process and the shipped tables spell
 * them ("Aerobic Endurance", "Threshold"), put into the language on screen.
 * The tables stay English because the coach and the COROS payloads read them;
 * only what is drawn is translated, here, so every screen names a band alike.
 */
const ZONE_NAME_KEYS: Readonly<Record<string, MessageKey>> = {
  Recovery: "zones.recovery", // i18n-ignore: a lookup key
  "Warm Up": "zones.warmUp", // i18n-ignore: a lookup key
  "Fat Burn": "zones.fatBurn", // i18n-ignore: a lookup key
  Aerobic: "zones.aerobic", // i18n-ignore: a lookup key
  "Aerobic Endurance": "zones.aerobicEndurance", // i18n-ignore: a lookup key
  "Aerobic Power": "zones.aerobicPower", // i18n-ignore: a lookup key
  Threshold: "zones.threshold", // i18n-ignore: a lookup key
  Anaerobic: "zones.anaerobic", // i18n-ignore: a lookup key
  "Anaerobic Endurance": "zones.anaerobicEndurance", // i18n-ignore: a lookup key
  "Anaerobic Power": "zones.anaerobicPower", // i18n-ignore: a lookup key
  Sprint: "zones.sprint"
};

export function zoneName(name: string): string {
  const key = ZONE_NAME_KEYS[name];
  if (key) {
    return t(key);
  }
  const numbered = /^Zone (\d+)$/.exec(name);
  return numbered ? t("overview.zones.zone", { n: Number(numbered[1]) }) : name;
}
