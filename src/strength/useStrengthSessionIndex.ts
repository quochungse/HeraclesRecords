import { useMemo } from "react";
import type { StrengthSession } from "../../electron/types";
import {
  defineSelectionPreference,
  selectionIsOneOf
} from "../preferences/selectionPreferences";
import {
  buildStrengthSessionIndex,
  type HeatScope,
  type StrengthSessionIndex
} from "./sessionAnalytics";

/** Whether one session's body map is read on its own scale or against the window. */
export const STRENGTH_HEAT_SCOPE_PREFERENCE = defineSelectionPreference<HeatScope>({
  key: "strength.heatScope",
  defaultValue: "session",
  validate: selectionIsOneOf(["session", "window"])
});

/** Every session in the history analysed once, rebuilt only when the history changes. */
export function useStrengthSessionIndex(sessions: StrengthSession[]): StrengthSessionIndex {
  return useMemo(() => buildStrengthSessionIndex(sessions), [sessions]);
}
