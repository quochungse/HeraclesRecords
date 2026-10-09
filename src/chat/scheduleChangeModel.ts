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
import { getIntlLocale, getLocale, messageRecord, plural, t } from "../i18n/core";

const KNOWN_OPS: ReadonlySet<string> = new Set(["move", "replace", "remove", "add", "deleteWorkout"]);

/** A line this build can apply: an op a newer build added is drawn and left alone, as the main process leaves it. */
export function canApply(line: ScheduleChangeLine): boolean {
  return KNOWN_OPS.has(line.op);
}

export function proposedLines(set: ScheduleChangeSet): ScheduleChangeLine[] {
  return set.lines.filter((line) => line.status === "proposed" && canApply(line));
}

const STATUS_LABEL = messageRecord<Exclude<ScheduleChangeStatus, "proposed">>({
  applied: "chat.change.status.applied",
  failed: "chat.change.status.failed",
  dismissed: "chat.change.status.dismissed",
  stale: "chat.change.status.stale"
});

export function lineStatusLabel(line: ScheduleChangeLine): string {
  if (line.status === "proposed") return "";
  /* A status a newer build wrote: said as it is rather than as something this build knows. */
  if (!(line.status in STATUS_LABEL)) return String(line.status);
  if (line.status === "applied") {
    return line.op === "remove"
      ? t("chat.change.status.removed")
      : line.op === "deleteWorkout"
        ? t("chat.change.status.deleted")
        : STATUS_LABEL.applied;
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
  if (counts.proposed === total) return plural("chat.change.noneApplied", total);
  const parts: string[] = [];
  if (counts.applied) parts.push(plural("chat.change.applied", counts.applied));
  if (counts.proposed) parts.push(plural("chat.change.toDecide", counts.proposed));
  if (counts.failed) parts.push(plural("chat.change.failed", counts.failed));
  if (counts.stale) parts.push(plural("chat.change.stale", counts.stale));
  if (counts.dismissed) parts.push(plural("chat.change.dismissed", counts.dismissed));
  if (newer) parts.push(plural("chat.change.newer", newer));
  return parts.join(" · ");
}

/**
 * The card's lines by what is left to do with them (Workbench review, R2):
 * to decide, worth another try, and done. They were one list in the order
 * Coach wrote them, so the two lines still waiting sat under five that were
 * over. A line a newer build wrote is done as far as this build goes.
 */
export function groupChangeLines(set: ScheduleChangeSet): {
  toDecide: ScheduleChangeLine[];
  retry: ScheduleChangeLine[];
  done: ScheduleChangeLine[];
} {
  const toDecide: ScheduleChangeLine[] = [];
  const retry: ScheduleChangeLine[] = [];
  const done: ScheduleChangeLine[] = [];
  for (const line of set.lines) {
    if (line.status === "proposed" && canApply(line)) toDecide.push(line);
    else if (line.status === "failed" && line.retry !== false && canApply(line)) retry.push(line);
    else done.push(line);
  }
  return { toDecide, retry, done };
}

/** One day the set touches, and what it does there. */
export interface ChangeDay {
  /** yyyyMMdd. */
  day: string;
  marks: { name: string; kind: "gone" | "new" | "kept" | "failed" }[];
}

/**
 * The days a set touches, as they stand once every line still open is
 * applied: a session leaving a day struck through, one arriving marked new.
 * Only what the lines name — the card knows nothing else of the calendar —
 * so it is the days, not the whole week. Dismissed and out-of-date lines
 * change nothing and are left out.
 */
export function changeSetDays(set: ScheduleChangeSet): ChangeDay[] {
  const days = new Map<string, ChangeDay["marks"]>();
  const mark = (day: string | undefined, name: string, kind: ChangeDay["marks"][number]["kind"]) => {
    if (!day || !/^\d{8}$/.test(day)) return;
    const list = days.get(day) ?? [];
    list.push({ name, kind });
    days.set(day, list);
  };
  for (const line of set.lines) {
    if (!canApply(line) || !["proposed", "applied", "failed"].includes(line.status)) continue;
    const failed = line.status === "failed";
    const from = line.session;
    const newName = line.workout?.name ?? from?.name ?? "";
    switch (line.op) {
      case "move":
        mark(from?.happenDay, from?.name ?? "", failed ? "kept" : "gone");
        if (!failed) mark(line.toDay, from?.name ?? "", "new");
        else mark(line.toDay, from?.name ?? "", "failed");
        break;
      case "replace":
        mark(from?.happenDay, from?.name ?? "", failed ? "kept" : "gone");
        mark(from?.happenDay, newName, failed ? "failed" : "new");
        break;
      case "remove":
        mark(from?.happenDay, from?.name ?? "", failed ? "failed" : "gone");
        break;
      case "add":
        mark(line.toDay, newName, failed ? "failed" : "new");
        break;
      default:
        break;
    }
  }
  return [...days.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([day, marks]) => ({ day, marks }));
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const; // i18n-ignore: English's own form
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const; // i18n-ignore

/** `Tue 29 Sep`, as the lines name a day; another language's own short form. */
export function changeDayLabel(day: string): string {
  const date = new Date(Number(day.slice(0, 4)), Number(day.slice(4, 6)) - 1, Number(day.slice(6, 8)), 12);
  if (getLocale() !== "en") {
    return new Intl.DateTimeFormat(getIntlLocale(), { weekday: "short", day: "numeric", month: "short" }).format(date);
  }
  return `${DAY_NAMES[date.getDay()]} ${date.getDate()} ${MONTH_NAMES[date.getMonth()]}`;
}

/** The change sets a transcript anchors, once each, in order. */
export function scheduleChangeIds(entries: readonly (ChatEntry | PersistedChatEntry)[]): string[] {
  return [...new Set(entries.flatMap((entry) => (entry.kind === "scheduleChange" ? [entry.changeSetId] : [])))];
}
