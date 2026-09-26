/**
 * A pipeline step's run, folded from its stream (docs/coach-plan-canvas.md,
 * P2.3): the generator's trail (`runTrail.ts`), outside the component so a
 * test can reach it.
 */
import type { ChatPipelineStep } from "../../electron/types";
import {
  noteHandOver,
  notePassed,
  noteRead,
  noteSnapshot,
  noteText,
  type RunNotes
} from "../training-library/runTrail";

/** A pipeline step while its turn runs: what Coach has done so far (P2.3). */
export interface StepRun {
  requestId: string;
  step: ChatPipelineStep["step"];
  notes: RunNotes;
  /** Hand-overs to the check so far: a second one means the first came back. */
  attempts: number;
}

export const STEP_TITLE: Record<ChatPipelineStep["step"], string> = {
  outline: "Drawing the outline",
  sessions: "Writing the sessions"
};

const HAND_OVER_TOOL: Record<ChatPipelineStep["step"], string> = {
  outline: "propose_plan_outline",
  sessions: "draft_training_plan"
};

/**
 * A stream event folded into the step's trail, in the generator's words
 * (`runTrail.ts`): a read, a heading of the thinking, a hand-over to the
 * check, the check passed. Only what the stream said.
 */
export function stepRunEvent(
  run: StepRun,
  event:
    | { kind: "text" | "thinking"; delta: string }
    | { kind: "snapshot" }
    | { kind: "call"; tool?: string }
    | { kind: "passed" }
): StepRun {
  switch (event.kind) {
    case "text":
    case "thinking":
      return { ...run, notes: noteText(run.notes, event.delta, event.kind) };
    case "snapshot":
      return { ...run, notes: noteSnapshot(run.notes) };
    case "passed":
      return { ...run, notes: notePassed(run.notes) };
    case "call": {
      const tool = event.tool?.split("__").at(-1);
      if (tool === HAND_OVER_TOOL[run.step]) {
        const attempts = run.attempts + 1;
        return { ...run, attempts, notes: noteHandOver(run.notes, run.step === "outline" ? "outline" : "plan", attempts) };
      }
      return { ...run, notes: noteRead(run.notes, event.tool) };
    }
  }
}
