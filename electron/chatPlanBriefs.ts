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
  parseStoredBrief,
  parseStoredOutline,
  readOutline
} from "./planBrief";
import { firstPlanMonday, generationRequestProblems, planOutlineProblems } from "./trainingPlanGeneration";
import type {
  PlanBrief,
  PlanBriefField,
  PlanBriefOrigin,
  PlanBriefOutline,
  PlanBriefRequest,
  TrainingPlanOutline
} from "./types";

function briefOfRow(row: ChatPlanArtifactRow | undefined): PlanBrief | undefined {
  const stored = parseStoredBrief(row?.briefJson);
  if (!row || !stored) return undefined;
  const outline = parseStoredOutline(row.outlineJson, row.outlineVersion);
  return {
    artifactId: row.artifactId,
    ...(row.sessionId ? { sessionId: row.sessionId } : {}),
    request: stored.request,
    origins: stored.origins,
    ...(outline ? { outline } : {}),
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
 * The brief AI Plan opens a new conversation on (P2.5): the one the athlete
 * filled in on the brief's screen before the conversation existed, with no
 * field marked, since every one is theirs. Without one it is the generator
 * form's defaults from the next Monday. No model is asked either way.
 */
export function createPlanBrief(sessionId: string, request?: unknown, today = new Date()): PlanBrief {
  if (request === undefined) {
    return writeBrief(crypto.randomUUID(), defaultPlanBriefRequest(firstPlanMonday(today)), {}, sessionId);
  }
  const checked = parseStoredBrief(JSON.stringify({ request }));
  if (!checked) throw new Error("That brief could not be read.");
  return writeBrief(crypto.randomUUID(), checked.request, {}, sessionId);
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

/**
 * A brief's outline, written as the next outline version (P2.2). A turn that
 * has its outline accepted twice — refused, fixed, then accepted again after
 * a second thought — replaces the one it wrote rather than counting two, so
 * `replacing` names the version the same turn wrote before.
 */
export function savePlanOutline(
  artifactId: string,
  outline: TrainingPlanOutline,
  author: PlanBriefOutline["author"],
  replacing?: number
): PlanBrief {
  const row = getChatPlanArtifactRow(artifactId);
  if (!row || !planBriefOf(artifactId)) throw new Error("That brief is no longer in this conversation.");
  const current = row.outlineVersion ?? 0;
  const version = replacing !== undefined && replacing === current ? current : current + 1;
  const now = new Date().toISOString();
  saveChatPlanArtifactRow({
    ...row,
    outlineJson: JSON.stringify({ outline, author, updatedAt: now }),
    outlineVersion: version,
    updatedAt: now
  });
  return planBriefOf(artifactId)!;
}

/**
 * The athlete's adjustment of an outline, from its own screen (P2.2): no
 * model is asked, and an outline that breaks the brief is refused with the
 * same sentences the outline tool hands Coach.
 */
export function updatePlanOutline(artifactId: string, value: unknown): PlanBrief {
  const brief = planBriefOf(artifactId);
  if (!brief) throw new Error("That brief is no longer in this conversation.");
  if (hasVersions(artifactId)) throw new Error("This brief has become a plan; change the plan instead.");
  if (!brief.outline) throw new Error("This brief has no outline yet.");
  const outline = readOutline(value);
  if (!outline) throw new Error("That outline could not be read.");
  const problems = planOutlineProblems(outline, brief.request);
  if (problems.length) throw new Error(problems.join(" "));
  return savePlanOutline(artifactId, outline, "athlete");
}

/** Whether a brief may still have its outline drawn: it exists and has not become a plan. */
export function briefForOutline(artifactId: string): PlanBrief {
  const brief = planBriefOf(artifactId);
  if (!brief) throw new Error("That brief is no longer in this conversation.");
  if (hasVersions(artifactId)) throw new Error("This brief has become a plan; change the plan instead.");
  return brief;
}

/** A brief whose sessions may be written: it has an outline and has not become a plan (P2.3). */
export function briefForSessions(artifactId: string): PlanBrief & { outline: PlanBriefOutline } {
  const brief = briefForOutline(artifactId);
  if (!brief.outline) throw new Error("Draw the outline first: the sessions are written to it.");
  return brief as PlanBrief & { outline: PlanBriefOutline };
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
  const found = briefId ? planBriefOf(briefId) : undefined;
  // A brief belongs to its conversation: changing one from another would
  // rewrite a card the athlete is not reading.
  const existing = found && (!sessionId || !found.sessionId || found.sessionId === sessionId) ? found : undefined;
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
    // Changing a brief does not change its outline (P2.2): Coach says so
    // rather than letting the athlete write sessions to a stale shape.
    ...(brief.outline
      ? {
          outline:
            "This brief already has an outline, drawn from it as it was. It is unchanged: tell the athlete to redraw or adjust it on its card if your change affects its weeks."
        }
      : {}),
    still_open: open,
    next:
      "The brief is on a card in the conversation. Stop here: say in a sentence what you filled in and, if anything " +
      "is still open, ask for it. Do not restate the brief or draft the plan — the athlete edits the brief and asks " +
      "for the outline from the card."
  });
}
