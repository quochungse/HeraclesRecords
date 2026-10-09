import type { ChatSessionSummary } from "../../electron/types";
import { getIntlLocale, messageRecord, plural, t } from "../i18n/core.ts";

export type ChatSessionGroupLabel =
  | "Pinned" // i18n-ignore: a key
  | "Today" // i18n-ignore: a key
  | "Yesterday" // i18n-ignore: a key
  | "Previous 7 days" // i18n-ignore: a key
  | "Older"; // i18n-ignore: a key

/** The group's name on screen; `ChatSessionGroupLabel` is its key. */
const GROUP_NAMES = messageRecord<ChatSessionGroupLabel>({
  Pinned: "chat.group.pinned",
  Today: "chat.group.today",
  Yesterday: "chat.group.yesterday",
  "Previous 7 days": "chat.group.week", // i18n-ignore: a key
  Older: "chat.group.older"
});

export function sessionGroupName(label: ChatSessionGroupLabel): string {
  return GROUP_NAMES[label];
}

export interface ChatSessionGroup {
  label: ChatSessionGroupLabel;
  sessions: ChatSessionSummary[];
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function sessionGroupLabel(updatedAt: string, now = new Date()): ChatSessionGroupLabel {
  const updated = new Date(updatedAt);
  if (Number.isNaN(updated.getTime())) {
    return "Older"; // i18n-ignore: a key
  }

  const todayStart = startOfLocalDay(now).getTime();
  const updatedStart = startOfLocalDay(updated).getTime();
  const dayDiff = Math.floor((todayStart - updatedStart) / 86_400_000);

  if (dayDiff <= 0) {
    return "Today"; // i18n-ignore: a key
  }
  if (dayDiff === 1) {
    return "Yesterday"; // i18n-ignore: a key
  }
  if (dayDiff <= 7) {
    return "Previous 7 days"; // i18n-ignore: a key
  }
  return "Older"; // i18n-ignore: a key
}

const GROUP_ORDER: ChatSessionGroupLabel[] = [
  "Today", // i18n-ignore: a key
  "Yesterday", // i18n-ignore: a key
  "Previous 7 days", // i18n-ignore: a key
  "Older" // i18n-ignore: a key
];

/** Most recently pinned first, falling back to recency when timestamps tie. */
function comparePinned(
  left: ChatSessionSummary,
  right: ChatSessionSummary
): number {
  const leftPinned = new Date(left.pinnedAt ?? 0).getTime();
  const rightPinned = new Date(right.pinnedAt ?? 0).getTime();
  if (leftPinned !== rightPinned) {
    return rightPinned - leftPinned;
  }
  return (
    new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
  );
}

export function groupChatSessions(
  sessions: ChatSessionSummary[]
): ChatSessionGroup[] {
  const buckets = new Map<ChatSessionGroupLabel, ChatSessionSummary[]>();
  for (const label of GROUP_ORDER) {
    buckets.set(label, []);
  }

  const pinned: ChatSessionSummary[] = [];
  for (const session of sessions) {
    if (session.pinnedAt) {
      pinned.push(session);
      continue;
    }
    const label = sessionGroupLabel(session.updatedAt);
    buckets.get(label)?.push(session);
  }
  pinned.sort(comparePinned);

  return [
    { label: "Pinned" as const, sessions: pinned }, // i18n-ignore: a key
    ...GROUP_ORDER.map((label) => ({
      label,
      sessions: buckets.get(label) ?? []
    }))
  ].filter((group) => group.sessions.length > 0);
}

/**
 * What waits on the athlete in a conversation, as its row says it (R3): the
 * most pressing kind named, and how many things wait in all. Null when
 * nothing does.
 */
export function waitingLabel(session: ChatSessionSummary): string | null {
  const waiting = session.waiting;
  if (!waiting) return null;
  const total = waiting.questions + waiting.decisions + waiting.briefs;
  if (!total) return null;
  const lead =
    waiting.decisions > 0
      ? t("chat.waitingRow.decide", { n: waiting.decisions })
      : waiting.questions > 0
        ? plural("chat.waitingRow.questions", waiting.questions)
        : plural("chat.waitingRow.briefs", waiting.briefs);
  const rest = total - (waiting.decisions || waiting.questions || waiting.briefs);
  return rest > 0 ? `${lead} +${rest}` : lead;
}

/**
 * Built once: `toLocaleTimeString` and `toLocaleDateString` with options build
 * a formatter per call, and the list asks for every row on every render of
 * Coach — a token of a streaming answer included — which measured 10–27 ms a
 * render for 32 conversations.
 */
let formatsFor = "";
let formats: Record<"sameDay" | "thisWeek" | "earlier", Intl.DateTimeFormat> | null = null;
/** Built once per language, for the reason above. */
function rowFormat(kind: "sameDay" | "thisWeek" | "earlier"): Intl.DateTimeFormat {
  const locale = getIntlLocale();
  if (!formats || formatsFor !== locale) {
    formatsFor = locale;
    formats = {
      sameDay: new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }),
      thisWeek: new Intl.DateTimeFormat(locale, { weekday: "short" }),
      // Vietnamese abbreviates a month as "thg 9", which nobody writes in a
      // narrow column; "28/9" is how a date that short is written there.
      earlier: new Intl.DateTimeFormat(locale, {
        month: locale.startsWith("vi") ? "numeric" : "short",
        day: "numeric"
      })
    };
  }
  return formats[kind];
}

export function formatSessionRelativeTime(updatedAt: string): string {
  const updated = new Date(updatedAt);
  if (Number.isNaN(updated.getTime())) {
    return "";
  }

  const now = new Date();
  const todayStart = startOfLocalDay(now).getTime();
  const updatedStart = startOfLocalDay(updated).getTime();
  const dayDiff = Math.floor((todayStart - updatedStart) / 86_400_000);

  if (dayDiff <= 0) {
    return rowFormat("sameDay").format(updated);
  }
  if (dayDiff === 1) {
    return t("chat.group.yesterday");
  }
  if (dayDiff < 7) {
    return rowFormat("thisWeek").format(updated);
  }
  return rowFormat("earlier").format(updated);
}
