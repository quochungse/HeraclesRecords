/**
 * The words a change set's card draws (P3.2–P3.3), outside the component for
 * the reason `activityFilters.ts` sits outside `ActivitiesView`: it is the
 * part a test can reach.
 */
import type { ChatEntry } from "./chatTypes";
import type { ScheduleChangeLine, ScheduleChangeSet, ScheduleChangeStatus } from "../../electron/types";

export function proposedLines(set: ScheduleChangeSet): ScheduleChangeLine[] {
  return set.lines.filter((line) => line.status === "proposed");
}

const STATUS_LABEL: Record<Exclude<ScheduleChangeStatus, "proposed">, string> = {
  applied: "Applied",
  failed: "Failed",
  dismissed: "Dismissed",
  stale: "Out of date"
};

export function lineStatusLabel(line: ScheduleChangeLine): string {
  if (line.status === "proposed") return "";
  if (line.status === "applied") {
    return line.op === "remove" ? "Removed" : line.op === "deleteWorkout" ? "Deleted" : STATUS_LABEL.applied;
  }
  return STATUS_LABEL[line.status];
}

/** The card's one line under its title: what is still to decide, else how it ended. */
export function changeSetHead(set: ScheduleChangeSet): string {
  const counts = { proposed: 0, applied: 0, failed: 0, dismissed: 0, stale: 0 };
  for (const line of set.lines) counts[line.status] += 1;
  const total = set.lines.length;
  if (counts.proposed === total) return total === 1 ? "Not applied yet" : `${total} changes, none applied yet`;
  const parts: string[] = [];
  if (counts.applied) parts.push(`${counts.applied} applied`);
  if (counts.proposed) parts.push(`${counts.proposed} to decide`);
  if (counts.failed) parts.push(`${counts.failed} failed`);
  if (counts.stale) parts.push(`${counts.stale} out of date`);
  if (counts.dismissed) parts.push(`${counts.dismissed} dismissed`);
  return parts.join(" · ");
}

/** The change sets a transcript anchors, once each, in order. */
export function scheduleChangeIds(entries: readonly ChatEntry[]): string[] {
  return [...new Set(entries.flatMap((entry) => (entry.kind === "scheduleChange" ? [entry.changeSetId] : [])))];
}
