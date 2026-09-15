import { useMemo } from "react";
import type { StrengthSession } from "../../electron/types";
import {
  buildStrengthSessionIndex,
  type StrengthSessionIndex
} from "./sessionAnalytics";

/** Every session in the history analysed once, rebuilt only when the history changes. */
export function useStrengthSessionIndex(sessions: StrengthSession[]): StrengthSessionIndex {
  return useMemo(() => buildStrengthSessionIndex(sessions), [sessions]);
}
