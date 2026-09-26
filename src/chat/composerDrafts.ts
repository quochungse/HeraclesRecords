/**
 * What was being written in a conversation, kept when the athlete leaves it
 * (Coach Workbench UAT): the words and what they point at. The references an
 * Ask Coach put by the composer used to live only in the view's state, so
 * opening another conversation — or restarting — threw them away.
 *
 * One key in localStorage, `device` tier in `syncPolicy.ts`: a draft is about
 * this machine's unsent question, not the athlete's record. Every access is
 * guarded; a draft that cannot be stored is only lost the way it was before.
 */
import type { PlanRef, ScheduleRef } from "../../electron/types";

export const COMPOSER_DRAFTS_KEY = "coroslink.coach.composerDrafts.v1";
/** Conversations whose drafts are kept; the oldest go first. */
const MAX_DRAFTS = 40;

export interface ComposerDraft {
  text: string;
  refs: PlanRef[];
  scheduleRefs: ScheduleRef[];
  updatedAt: number;
}

type DraftStore = Record<string, ComposerDraft>;

function readStore(): DraftStore {
  try {
    const raw = localStorage.getItem(COMPOSER_DRAFTS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as DraftStore) : {};
  } catch {
    return {};
  }
}

function writeStore(store: DraftStore): void {
  try {
    const kept = Object.entries(store)
      .sort((left, right) => right[1].updatedAt - left[1].updatedAt)
      .slice(0, MAX_DRAFTS);
    if (kept.length) localStorage.setItem(COMPOSER_DRAFTS_KEY, JSON.stringify(Object.fromEntries(kept)));
    else localStorage.removeItem(COMPOSER_DRAFTS_KEY);
  } catch {
    // Storage full or blocked: the draft lives on in the view until it closes.
  }
}

/** The draft a conversation was left with, if any. */
export function loadComposerDraft(sessionId: string): ComposerDraft | undefined {
  const draft = readStore()[sessionId];
  if (!draft) return undefined;
  return {
    text: typeof draft.text === "string" ? draft.text : "",
    refs: Array.isArray(draft.refs) ? draft.refs : [],
    scheduleRefs: Array.isArray(draft.scheduleRefs) ? draft.scheduleRefs : [],
    updatedAt: typeof draft.updatedAt === "number" ? draft.updatedAt : 0
  };
}

/** Keeps a conversation's draft; an empty one is removed rather than kept. */
export function saveComposerDraft(
  sessionId: string,
  draft: Omit<ComposerDraft, "updatedAt">,
  now = Date.now()
): void {
  const store = readStore();
  if (!draft.text.trim() && !draft.refs.length && !draft.scheduleRefs.length) {
    if (!(sessionId in store)) return;
    delete store[sessionId];
  } else {
    store[sessionId] = { ...draft, updatedAt: now };
  }
  writeStore(store);
}

/** Drops a conversation's draft: it was sent, or the conversation is gone. */
export function clearComposerDraft(sessionId: string): void {
  const store = readStore();
  if (!(sessionId in store)) return;
  delete store[sessionId];
  writeStore(store);
}
