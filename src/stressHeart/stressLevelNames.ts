import type { StressLevelKey } from "../../electron/stressHeartParser";
import { t } from "../i18n/core";

/** A level's name in the language on screen. Read while rendering, never kept. */
export function stressLevelName(level: StressLevelKey): string {
  return t(`stress.level.${level}` as const);
}
