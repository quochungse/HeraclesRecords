/**
 * The words a change set's card draws (P3.2–P3.3), outside the component for
 * the reason `activityFilters.ts` sits outside `ActivitiesView`: it is the
 * part a test can reach.
 */
import type { ChatEntry } from "./chatTypes";
import type {
  PersistedChatEntry,
  ScheduleChangeLine,
  ScheduleChangeSet,
  ScheduleChangeStatus
} from "../../electron/types";

const KNOWN_OPS: ReadonlySet<string> = new Set(["move", "replace", "remove", "add", "deleteWorkout"]);

/** A line this build can apply: an op a newer build added is drawn and left alone, as the main process leaves it. */
export function canApply(line: ScheduleChangeLine): boolean {
  return KNOWN_OPS.has(line.op);
}

export function proposedLines(set: ScheduleChangeSet): ScheduleChangeLine[] {
  return set.lines.filter((line) => line.status === "proposed" && canApply(line));
}

const STATUS_LABEL: Record<Exclude<ScheduleChangeStatus, "proposed">, string> = {
  applied: "Applied",
  failed: "Failed",
  dismissed: "Dismissed",
  stale: "Out of date"
};

export function lineStatusLabel(line: ScheduleChangeLine): string {
  if (line.status === "proposed") return "";
  /* A status a newer build wrote: said as it is rather than as something this build knows. */
  if (!(line.status in STATUS_LABEL)) return String(line.status);
  if (line.status === "applied") {
    return line.op === "remove" ? "Removed" : line.op === "deleteWorkout" ? "Deleted" : STATUS_LABEL.applied;
  }
  return STATUS_LABEL[line.status];
}

/**
 * The card's one line under its title: what is still to decide, else how it
 * ended. A line a newer build wrote — an op or a status this one does not
 * know — is counted as that, not as something to decide here.
 */
export function changeSetHead(set: ScheduleChangeSet): string {
  const counts = { proposed: 0, applied: 0, failed: 0, dismissed: 0, stale: 0 };
  let newer = 0;
  for (const line of set.lines) {
    if (!canApply(line) || !(line.status in counts)) newer += 1;
    else counts[line.status] += 1;
  }
  const total = set.lines.length;
  if (counts.proposed === total) return total === 1 ? "Not applied yet" : `${total} changes, none applied yet`;
  const parts: string[] = [];
  if (counts.applied) parts.push(`${counts.applied} applied`);
  if (counts.proposed) parts.push(`${counts.proposed} to decide`);
  if (counts.failed) parts.push(`${counts.failed} failed`);
  if (counts.stale) parts.push(`${counts.stale} out of date`);
  if (counts.dismissed) parts.push(`${counts.dismissed} dismissed`);
  if (newer) parts.push(`${newer} from a newer version of the app`);
  return parts.join(" · ");
}

/** The change sets a transcript anchors, once each, in order. */
export function scheduleChangeIds(entries: readonly (ChatEntry | PersistedChatEntry)[]): string[] {
  return [...new Set(entries.flatMap((entry) => (entry.kind === "scheduleChange" ? [entry.changeSetId] : [])))];
}
