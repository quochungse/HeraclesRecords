/**
 * Plan briefs as stored (docs/coach-plan-canvas.md, P2.1): one per Coach
 * creation that starts from a brief, on its `chat_plan_artifacts` row. The
 * transcript holds only an anchor (`planBrief`, Q3), so an edit here is never
 * a rewrite of the conversation.
 */
import crypto from "node:crypto";
import {
  deleteChatPlanArtifactRow,
  getChatPlanArtifactRow,
  listChatPlanArtifactRows,
  listChatPlanDraftVersions,
  saveChatPlanArtifactRow,
  type ChatPlanArtifactRow
} from "./database";
import {
  briefChangedFields,
  briefFromPrefill,
  briefLine,
  defaultPlanBriefRequest,
  parseStoredBrief
} from "./planBrief";
import { firstPlanMonday, generationRequestProblems } from "./trainingPlanGeneration";
import type { PlanBrief, PlanBriefField, PlanBriefOrigin, PlanBriefRequest } from "./types";

function briefOfRow(row: ChatPlanArtifactRow | undefined): PlanBrief | undefined {
  const stored = parseStoredBrief(row?.briefJson);
  if (!row || !stored) return undefined;
  return {
    artifactId: row.artifactId,
    ...(row.sessionId ? { sessionId: row.sessionId } : {}),
    request: stored.request,
    origins: stored.origins,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

export function planBriefOf(artifactId: string): PlanBrief | undefined {
  return briefOfRow(getChatPlanArtifactRow(artifactId));
}

export function listPlanBriefs(artifactIds: readonly string[]): PlanBrief[] {
  return listChatPlanArtifactRows(artifactIds).flatMap((row) => {
    const brief = briefOfRow(row);
    return brief ? [brief] : [];
  });
}

function writeBrief(
  artifactId: string,
  request: PlanBriefRequest,
  origins: Partial<Record<PlanBriefField, PlanBriefOrigin>>,
  sessionId?: string
): PlanBrief {
  const now = new Date().toISOString();
  const existing = getChatPlanArtifactRow(artifactId);
  saveChatPlanArtifactRow({
    ...existing,
    artifactId,
    sessionId: sessionId ?? existing?.sessionId,
    kind: "plan",
    startMonday: request.startDate,
    raceDay: request.race?.date || undefined,
    briefJson: JSON.stringify({ request, origins }),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  });
  return planBriefOf(artifactId)!;
}

/** A brief with a version has become a plan: it is changed through the plan from then on. */
function hasVersions(artifactId: string): boolean {
  return listChatPlanDraftVersions(artifactId).length > 0;
}

/**
 * The athlete's edit of a brief. The request arrives from the brief's own
 * screen, so it is taken whole; a field it changed loses its "from chat" or
 * "from data", since it is the athlete's now.
 */
export function updatePlanBrief(artifactId: string, request: PlanBriefRequest): PlanBrief {
  const current = planBriefOf(artifactId);
  if (!current) throw new Error("That brief is no longer in this conversation.");
  if (hasVersions(artifactId)) throw new Error("This brief has become a plan; change the plan instead.");
  const checked = parseStoredBrief(JSON.stringify({ request }));
  if (!checked) throw new Error("That brief could not be read.");
  const origins = { ...current.origins };
  for (const field of briefChangedFields(current.request, checked.request)) delete origins[field];
  return writeBrief(artifactId, checked.request, origins);
}

export function deletePlanBriefs(artifactIds: readonly string[]): void {
  for (const artifactId of artifactIds) deleteChatPlanArtifactRow(artifactId);
}

/**
 * `request_plan_brief`: a new brief laid over the defaults, or — with a
 * `brief_id` — the rest of one Coach set out earlier, laid over it. What goes
 * back to Coach is what the card now says and what is still missing before an
 * outline can be drawn, so its answer can ask for exactly that.
 */
export function handleRequestPlanBrief(
  args: Record<string, unknown>,
  sessionId: string | undefined,
  onBrief: ((brief: PlanBrief) => void) | undefined,
  today = new Date()
): string {
  const briefId = typeof args.brief_id === "string" ? args.brief_id.trim() : "";
  const existing = briefId ? planBriefOf(briefId) : undefined;
  if (briefId && !existing) {
    return JSON.stringify({ ok: false, error: `No brief ${briefId} in this conversation. Leave brief_id out to set out a new one.` });
  }
  if (existing && hasVersions(existing.artifactId)) {
    return JSON.stringify({
      ok: false,
      error: `Brief ${briefId} is already a plan. Change it with revise_training_plan.`
    });
  }
  const base = existing?.request ?? defaultPlanBriefRequest(firstPlanMonday(today));
  const parsed = briefFromPrefill(args, base, existing?.origins);
  const artifactId = existing?.artifactId ?? crypto.randomUUID();
  const brief = writeBrief(artifactId, parsed.request, parsed.origins, sessionId);
  onBrief?.(brief);
  const open = generationRequestProblems(brief.request, today).map((problem) => problem.message);
  return JSON.stringify({
    ok: true,
    brief_id: artifactId,
    brief: briefLine(brief.request),
    ...(parsed.dropped.length ? { not_taken: parsed.dropped } : {}),
    still_open: open,
    next:
      "The brief is on a card in the conversation. Stop here: say in a sentence what you filled in and, if anything " +
      "is still open, ask for it. Do not restate the brief or draft the plan — the athlete edits the brief and asks " +
      "for the outline from the card."
  });
}
