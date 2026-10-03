// What the Hall of Records tells the athlete without being asked: which
// milestones are new to them, and which labour stages to announce.
//
// Kept as one small record in localStorage, `personal` tier, so a stage
// announced on one machine is not announced again on the other, and a
// milestone seen there is not "new" here.
//
// **Two copies, unioned.** Sync carries a localStorage value whole and the
// last writer wins, so the other machine's copy, written before it had pulled
// this one, would wipe what this machine had seen and announced — the rail
// said "N new" again and a stage was toasted twice. Both sets only ever grow,
// so this machine also keeps its own copy (`device` tier, never synced), reads
// the union of the two, and writes the union back to both whenever the synced
// copy lacks something: the other machine's copy is folded in, never obeyed.
//
// Three rules, each held by test:records:
//
//  * **The first reckoning announces nothing.** An athlete opening a build
//    with the hall in it already has a history; every one of those milestones
//    is a fact they lived, not news. So the first state written marks all of
//    them seen and every reached stage announced.
//  * **News is recent.** A milestone reached more than `NEW_WITHIN_DAYS` ago —
//    a record from last year the backfill has only now read — is marked seen
//    without a badge, and a stage reached more than `ANNOUNCE_WITHIN_DAYS` ago
//    is marked announced without a toast. The hall shows it; the rail does not
//    shout about it.
//  * **A stage is announced once**, by its key (`lion:2`), whichever milestone
//    reached it.

import type { LabourId, LabourStage, LabourState } from "./labours";
import { labourStageKey } from "./labours";
import { dateOfDay, type Milestone } from "./milestones";

export const NOTICES_STORAGE_KEY = "heraclesrecords.records.notices.v1";
/** This machine's own copy of the same record, for the union. */
const NOTICES_LOCAL_KEY = "heraclesrecords.records.notices.local.v1";
export const NEW_WITHIN_DAYS = 30;
export const ANNOUNCE_WITHIN_DAYS = 14;
/** Plenty for years of milestones; a bound so the record cannot grow forever. */
const MAX_IDS = 2000;

export interface NoticeState {
  v: 1;
  /** Milestone ids the athlete has seen, or that were never news. */
  seen: string[];
  /** Labour stages already announced, as `labourStageKey`. */
  announced: string[];
}

export interface Announcement {
  key: string;
  labourId: LabourId;
  stage: LabourStage;
  /** All three stages reached with this one: the celebration, not a toast. */
  completes: boolean;
  /** The milestone that reached it, for the toast's sentence. */
  milestone?: Milestone;
}

export interface Reckoning {
  /** What to store; `undefined` when nothing moved. */
  next: NoticeState | undefined;
  /** Milestones not yet seen and recent enough to be news. */
  fresh: string[];
  announce: Announcement[];
}

function daysAgo(day: string, today: string): number {
  return Math.round((dateOfDay(today).getTime() - dateOfDay(day).getTime()) / 86_400_000);
}

function capped(ids: Iterable<string>): string[] {
  const list = [...ids];
  return list.length > MAX_IDS ? list.slice(list.length - MAX_IDS) : list;
}

/**
 * Compare what is reached now with what the athlete has been told. Pure: the
 * caller stores `next` and shows the rest.
 */
export function reckonNotices(
  state: NoticeState | null,
  milestones: readonly Milestone[],
  labours: readonly LabourState[],
  today: string
): Reckoning {
  const reachedStages: Array<{ key: string; labour: LabourState; stage: LabourStage; day: string; milestoneId: string }> = [];
  for (const labour of labours) {
    for (const stage of labour.stages) {
      if (!stage.reached) continue;
      reachedStages.push({
        key: labourStageKey(labour.definition.id, stage.stage),
        labour,
        stage: stage.stage,
        day: stage.reached.day,
        milestoneId: stage.reached.milestoneId
      });
    }
  }

  if (!state) {
    return {
      next: {
        v: 1,
        seen: capped(milestones.map((milestone) => milestone.id)),
        announced: reachedStages.map((entry) => entry.key)
      },
      fresh: [],
      announce: []
    };
  }

  const seen = new Set(state.seen);
  const announced = new Set(state.announced);
  let moved = false;
  const fresh: string[] = [];
  for (const milestone of milestones) {
    if (seen.has(milestone.id)) continue;
    if (daysAgo(milestone.day, today) > NEW_WITHIN_DAYS) {
      seen.add(milestone.id);
      moved = true;
    } else {
      fresh.push(milestone.id);
    }
  }

  const byId = new Map(milestones.map((milestone) => [milestone.id, milestone]));
  const announce: Announcement[] = [];
  for (const entry of reachedStages) {
    if (announced.has(entry.key)) continue;
    announced.add(entry.key);
    moved = true;
    if (daysAgo(entry.day, today) > ANNOUNCE_WITHIN_DAYS) continue;
    const others = entry.labour.stages.filter((stage) => stage.stage !== entry.stage);
    announce.push({
      key: entry.key,
      labourId: entry.labour.definition.id,
      stage: entry.stage,
      completes: entry.labour.complete && others.every((stage) => stage.reached && stage.reached.day <= entry.day),
      milestone: byId.get(entry.milestoneId)
    });
  }

  return {
    next: moved ? { v: 1, seen: capped(seen), announced: [...announced] } : undefined,
    fresh,
    announce
  };
}

/** Every one of these is now seen. Answers `undefined` when none was new. */
export function markSeen(state: NoticeState, ids: readonly string[]): NoticeState | undefined {
  const seen = new Set(state.seen);
  const before = seen.size;
  for (const id of ids) seen.add(id);
  return seen.size === before ? undefined : { ...state, seen: capped(seen) };
}

export function parseNoticeState(raw: string | null): NoticeState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<NoticeState>;
    if (parsed.v !== 1 || !Array.isArray(parsed.seen) || !Array.isArray(parsed.announced)) {
      return null;
    }
    return {
      v: 1,
      seen: parsed.seen.filter((id): id is string => typeof id === "string"),
      announced: parsed.announced.filter((key): key is string => typeof key === "string")
    };
  } catch {
    return null;
  }
}

/** Every id either copy holds. Both sets only grow, so a union loses nothing. */
export function unionNoticeStates(
  left: NoticeState | null,
  right: NoticeState | null
): NoticeState | null {
  if (!left) return right;
  if (!right) return left;
  return {
    v: 1,
    seen: capped(new Set([...left.seen, ...right.seen])),
    announced: [...new Set([...left.announced, ...right.announced])]
  };
}

function sameNoticeState(left: NoticeState, right: NoticeState): boolean {
  const same = (a: readonly string[], b: readonly string[]) => {
    if (a.length !== b.length) return false;
    const held = new Set(a);
    return b.every((id) => held.has(id));
  };
  return same(left.seen, right.seen) && same(left.announced, right.announced);
}

function readKey(key: string): NoticeState | null {
  try {
    return parseNoticeState(window.localStorage.getItem(key));
  } catch {
    return null;
  }
}

/** The synced copy and this machine's own, as one. */
export function readNoticeState(): NoticeState | null {
  try {
    return unionNoticeStates(
      parseNoticeState(window.localStorage.getItem(NOTICES_STORAGE_KEY)),
      parseNoticeState(window.localStorage.getItem(NOTICES_LOCAL_KEY))
    );
  } catch {
    return null;
  }
}

/**
 * Write to both copies, each only where it differs — an unchanged write is not
 * a sync change, and the synced copy is rewritten exactly when the other
 * machine's version of it lacked something this one holds.
 */
export function writeNoticeState(state: NoticeState): void {
  try {
    const synced = readKey(NOTICES_STORAGE_KEY);
    if (!synced || !sameNoticeState(synced, state)) {
      window.localStorage.setItem(NOTICES_STORAGE_KEY, JSON.stringify(state));
    }
    const local = readKey(NOTICES_LOCAL_KEY);
    if (!local || !sameNoticeState(local, state)) {
      window.localStorage.setItem(NOTICES_LOCAL_KEY, JSON.stringify(state));
    }
  } catch {
    // Private storage or a full quota: the hall still draws, it only forgets
    // what it told the athlete, and the next reckoning starts from scratch.
  }
}
