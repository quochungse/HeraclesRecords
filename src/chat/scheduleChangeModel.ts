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
import { getIntlLocale, getLocale, messageRecord, plural, t, type MessageKey } from "../i18n/core";
import { screenKeyForEnglish } from "../../electron/screenText";

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

/**
 * A line as the card states it. Its `label` is stored, and stored text stays
 * English, so in English it is shown as written; in another language it is
 * said again from the line itself — the session, the days and the workout —
 * with the plan the session belongs to taken from where the label names it.
 * A line of an op this build does not know keeps its stored label.
 */
export function changeLineLabel(line: ScheduleChangeLine): string {
  if (getLocale() === "en") return line.label;
  const session = line.session;
  const plan = session ? planOf(line.label, session.name) : "";
  const quoted = (name: string) => t("chat.change.line.quoted", { name });
  switch (line.op) {
    case "move":
      return session && line.toDay
        ? t("chat.change.line.move", { name: quoted(session.name), plan, from: changeDayLabel(session.happenDay), to: changeDayLabel(line.toDay) })
        : line.label;
    case "replace":
      return session && line.workout
        ? t("chat.change.line.replace", { name: quoted(session.name), plan, day: changeDayLabel(session.happenDay), workout: quoted(line.workout.name) })
        : line.label;
    case "remove":
      return session
        ? t("chat.change.line.remove", { name: quoted(session.name), plan, day: changeDayLabel(session.happenDay) })
        : line.label;
    case "add":
      return line.workout && line.toDay
        ? t("chat.change.line.add", { workout: quoted(line.workout.name), day: changeDayLabel(line.toDay) })
        : line.label;
    case "deleteWorkout":
      return line.program ? t("chat.change.line.deleteWorkout", { name: quoted(line.program.name) }) : line.label;
    default:
      return line.label;
  }
}

/** " (Plan name)", where the stored label names the session's plan right after it. */
function planOf(label: string, name: string): string {
  const at = label.indexOf(`"${name}"`);
  if (at < 0) return "";
  const after = /^ ((.+?)) (?:from|on) /.exec(label.slice(at + name.length + 2));
  return after ? ` (${after[1]})` : "";
}

/** The sentences the main process stores as a reason, keyed by their English. */
const FIXED_REASONS: Record<string, MessageKey> = {
  "This build cannot apply that change.": "chat.change.reason.unknownOp", // i18n-ignore: the stored English it stands for
  "The proposal does not say which session.": "chat.change.reason.noSession", // i18n-ignore: the stored English it stands for
  "The proposal does not say which session or where to.": "chat.change.reason.noSessionOrDay", // i18n-ignore: the stored English it stands for
  "The proposal does not say which session or what with.": "chat.change.reason.noSessionOrWorkout", // i18n-ignore: the stored English it stands for
  "The proposal does not say what or where.": "chat.change.reason.noWhatOrWhere", // i18n-ignore: the stored English it stands for
  "The proposal does not say which workout.": "chat.change.reason.noWorkout" // i18n-ignore: the stored English it stands for
};

/**
 * Why a line failed or went stale. Stored in English, like its label: in
 * another language the sentences the app writes itself are said again — the
 * fixed ones by their words, the ones naming a session from the line, an
 * error the main process raised by its key — and anything else (COROS's own
 * answer) is shown as it came.
 */
export function changeLineReason(line: ScheduleChangeLine): string | undefined {
  const reason = line.reason;
  if (!reason || getLocale() === "en") return reason;
  const fixed = FIXED_REASONS[reason];
  if (fixed) return t(fixed);
  const screenKey = screenKeyForEnglish(reason);
  if (screenKey) return t(screenKey);
  const session = line.session;
  if (session && reason === `"${session.name}" is no longer on the calendar on ${englishCardDay(session.happenDay)}.`) { // i18n-ignore: the stored English
    return t("chat.change.reason.gone", { name: session.name, day: changeDayLabel(session.happenDay) });
  }
  const now = session ? /^The session on .+ is now "(.+)", not "/.exec(reason) : null;
  if (session && now) {
    return t("chat.change.reason.replaced", { name: session.name, now: now[1], day: changeDayLabel(session.happenDay) });
  }
  if (line.workout && line.toDay && reason === `"${line.workout.name}" is already on the calendar on ${englishCardDay(line.toDay)}.`) { // i18n-ignore: the stored English
    return t("chat.change.reason.alreadyThere", { name: line.workout.name, day: changeDayLabel(line.toDay) });
  }
  if (line.program && reason === `"${line.program.name}" is no longer in the workout library.`) { // i18n-ignore: the stored English
    return t("chat.change.reason.notInLibrary", { name: line.program.name });
  }
  return reason;
}

/** The day as the main process wrote it into a reason (`cardDay`, English). */
function englishCardDay(day: string): string {
  const date = new Date(Number(day.slice(0, 4)), Number(day.slice(4, 6)) - 1, Number(day.slice(6, 8)), 12);
  return `${DAY_NAMES[date.getDay()]} ${date.getDate()} ${MONTH_NAMES[date.getMonth()]}`;
}

/** The change sets a transcript anchors, once each, in order. */
export function scheduleChangeIds(entries: readonly (ChatEntry | PersistedChatEntry)[]): string[] {
  return [...new Set(entries.flatMap((entry) => (entry.kind === "scheduleChange" ? [entry.changeSetId] : [])))];
}
