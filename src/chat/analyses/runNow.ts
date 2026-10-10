import type { CoachAnalysisRun } from "../../../electron/types";
import { showToast } from "../../toast";
import { skipReasonLabel } from "./analysisLabels";
import { t } from "../../i18n/core";

/**
 * "Run now" is the one trigger the athlete watches happen, so it has to answer
 * even when it does nothing. A run that streams into a conversation is its own
 * feedback; a run that declined or failed leaves the screen unchanged and reads
 * as a broken button, so those are the outcomes announced here.
 */
export function announceRunNow(runs: CoachAnalysisRun[]): void {
  if (!runs.length) {
    // An analysis is always in a conversation, so the only way to produce no
    // runs at all is a switched-off one — which the row already shows, but a
    // button that does nothing has to say why anyway.
    showToast(t("chat.an.toast.off"), "error");
    return;
  }

  // A failure leaves the conversation as empty as a skip does, and the reason
  // is the one thing the athlete cannot work out for themselves — a provider
  // that stopped answering looks exactly like one that was never asked.
  const failed = runs.filter((run) => run.status === "failed");
  if (failed.length === runs.length) {
    showToast(failed[0].error ?? t("chat.an.toast.failed"), "error");
    return;
  }

  if (runs.every((run) => run.skipReason === "no-activity")) {
    showToast(t("chat.an.toast.noActivity"), "error");
    return;
  }

  const skipped = runs.filter((run) => run.status === "skipped");
  if (skipped.length === runs.length) {
    showToast(t("chat.an.toast.skipped", { reason: skipReasonLabel(skipped[0].skipReason ?? "") }), "error");
  }
}
