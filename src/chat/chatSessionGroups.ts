import type { ChatSessionSummary } from "../../electron/types";

export type ChatSessionGroupLabel =
  | "Pinned"
  | "Today"
  | "Yesterday"
  | "Previous 7 days"
  | "Older";

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
    return "Older";
  }

  const todayStart = startOfLocalDay(now).getTime();
  const updatedStart = startOfLocalDay(updated).getTime();
  const dayDiff = Math.floor((todayStart - updatedStart) / 86_400_000);

  if (dayDiff <= 0) {
    return "Today";
  }
  if (dayDiff === 1) {
    return "Yesterday";
  }
  if (dayDiff <= 7) {
    return "Previous 7 days";
  }
  return "Older";
}

const GROUP_ORDER: ChatSessionGroupLabel[] = [
  "Today",
  "Yesterday",
  "Previous 7 days",
  "Older"
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
    { label: "Pinned" as const, sessions: pinned },
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
      ? `${waiting.decisions} to decide`
      : waiting.questions > 0
        ? waiting.questions === 1
          ? "Question"
          : `${waiting.questions} questions`
        : waiting.briefs === 1
          ? "Brief"
          : `${waiting.briefs} briefs`;
  const rest = total - (waiting.decisions || waiting.questions || waiting.briefs);
  return rest > 0 ? `${lead} +${rest}` : lead;
}

/**
 * Built once: `toLocaleTimeString` and `toLocaleDateString` with options build
 * a formatter per call, and the list asks for every row on every render of
 * Coach — a token of a streaming answer included — which measured 10–27 ms a
 * render for 32 conversations.
 */
const SAME_DAY = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const THIS_WEEK = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const EARLIER = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

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
    return SAME_DAY.format(updated);
  }
  if (dayDiff === 1) {
    return "Yesterday";
  }
  if (dayDiff < 7) {
    return THIS_WEEK.format(updated);
  }
  return EARLIER.format(updated);
}
