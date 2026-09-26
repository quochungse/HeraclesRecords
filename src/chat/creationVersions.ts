/**
 * Which version of a coach's creation each card in the conversation is, and
 * whether it is the one that counts (docs/coach-plan-canvas.md, P1.1).
 *
 * Every version is a card of its own in the transcript — which is also how a
 * build from before versions draws them — so the conversation groups them
 * here: the newest version of each creation is drawn whole, and every older
 * one folds to a line. Pure and outside the component for the reason
 * `activityFilters.ts` is.
 */
import type {
  PlanArtifactVersion,
  PlanDraftPreview,
  TrainingPlanDocument
} from "../../electron/types";

export interface CreationVersion {
  artifactId: string;
  version: number;
  author: PlanArtifactVersion["author"];
  /** The newest version of its creation — the one with buttons. */
  latest: boolean;
  /** That newest version's number, for a folded line to name. */
  latestVersion: number;
  /** Versions of this creation, oldest first. */
  siblings: PlanArtifactVersion[];
}

/**
 * The newest version is the highest number; two machines that each made the
 * next one offline give two rows of one number, and then the later written
 * counts, so both stay listed and neither is lost.
 */
export function creationVersions(
  versions: readonly PlanArtifactVersion[]
): Map<string, CreationVersion> {
  const byArtifact = new Map<string, PlanArtifactVersion[]>();
  for (const version of versions) {
    const group = byArtifact.get(version.artifactId);
    if (group) {
      if (!group.some((item) => item.draftId === version.draftId)) group.push(version);
    } else {
      byArtifact.set(version.artifactId, [version]);
    }
  }
  const result = new Map<string, CreationVersion>();
  for (const [artifactId, group] of byArtifact) {
    const ordered = [...group].sort(
      (left, right) => left.version - right.version || left.createdAt - right.createdAt
    );
    const newest = ordered[ordered.length - 1];
    for (const item of ordered) {
      result.set(item.draftId, {
        artifactId,
        version: item.version,
        author: item.author,
        latest: item.draftId === newest.draftId,
        latestVersion: newest.version,
        siblings: ordered
      });
    }
  }
  return result;
}

/**
 * Whether the creation is a COROS plan now (P1.6): some version was saved as
 * one, and no later version records it deleted there. What makes a new
 * version's save an update of that plan rather than a plan of its own.
 */
export function isOnCoros(info: CreationVersion | undefined): boolean {
  let onCoros = false;
  for (const version of info?.siblings ?? []) {
    if (version.remotePlanId) onCoros = true;
    if (version.detached) onCoros = false;
  }
  return onCoros;
}

/** A card with no version known yet — still loading, or never versioned — counts as its own newest. */
export function isLatestVersion(index: ReadonlyMap<string, CreationVersion>, draftId: string): boolean {
  return index.get(draftId)?.latest ?? true;
}

const AUTHORS: Record<PlanArtifactVersion["author"], string> = {
  coach: "Coach",
  athlete: "you",
  coros: "a change in the Library"
};

/** "v1 · replaced by v2 from Coach", for a version that is no longer the newest. */
export function supersededLine(info: CreationVersion): string {
  const newest = info.siblings[info.siblings.length - 1];
  // Two machines that each made the next version: the one written later counts.
  const which = info.version === info.latestVersion ? "a later " : "";
  return `v${info.version} · replaced by ${which}v${info.latestVersion} from ${AUTHORS[newest.author]}`;
}

/**
 * A card's preview with each session's full workout put back. The transcript
 * carries a light preview — names, sports and dates, not steps — so the steps
 * come from the draft's document, matched by the key the coach gave each
 * session. A session the document does not hold stays as it was.
 */
export function withDocumentSources(
  draft: PlanDraftPreview,
  document: TrainingPlanDocument | null | undefined
): PlanDraftPreview {
  if (!document) return draft;
  const workouts = new Map(document.entries.map((entry) => [entry.workout.key, entry.workout]));
  let changed = false;
  const entries = draft.entries.map((entry) => {
    if (entry.source) return entry;
    const workout = workouts.get(entry.key);
    if (!workout) return entry;
    changed = true;
    return { ...entry, source: workout };
  });
  return changed ? { ...draft, entries } : draft;
}
