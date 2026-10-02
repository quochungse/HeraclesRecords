// Which of two copies of one remembered milestone (`athlete_milestones`) is kept.
//
// Asked in two places that have to agree: the ledger's own write, and the sync
// merge of the same row from another machine. Last-writer-wins there would let a
// machine that keeps nine weeks of nights overwrite "seven good nights, first
// reached last November" with the same streak reached last week — and once the
// first machine's own nights have aged out, nothing could put November back.
//
// So the rule is a total order, the same on every machine and in either
// direction, which is what makes the merge commutative:
//
//   1. **The earliest day wins.** A fact reached in March and seen again in May
//      was reached in March.
//   2. **On the same day, a plan run's better-settled reading wins**: more
//      sessions settled, then the higher compliance. A run is first seen while
//      the matcher is still catching up on its last week, and that reading
//      must not stay the plan's for good.
//   3. **Otherwise the payload decides**, compared as text — arbitrary, but the
//      same answer everywhere, so two machines that disagree settle on one copy
//      instead of trading it back and forth.
//
// No `node:` imports: the sync layer and the database both read it.

export interface MilestoneCopy {
  kind: string;
  happenDay: string;
  payload: Record<string, unknown>;
}

function numberIn(payload: Record<string, unknown>, key: string): number {
  const value = payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : -1;
}

/** Positive when `a` should be kept over `b`, negative for `b`, 0 when they are one copy. */
export function compareMilestoneCopies(a: MilestoneCopy, b: MilestoneCopy): number {
  if (a.happenDay !== b.happenDay) return a.happenDay < b.happenDay ? 1 : -1;
  if (a.kind === "plan" && b.kind === "plan") {
    const settled = numberIn(a.payload, "settled") - numberIn(b.payload, "settled");
    if (settled !== 0) return Math.sign(settled);
    const ratio = numberIn(a.payload, "ratio") - numberIn(b.payload, "ratio");
    if (ratio !== 0) return Math.sign(ratio);
  }
  const left = JSON.stringify(a.payload);
  const right = JSON.stringify(b.payload);
  return left === right ? 0 : left > right ? 1 : -1;
}

/** The payload as a row stores it, a JSON string, or already parsed. */
export function parseMilestonePayload(value: unknown): Record<string, unknown> {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return {};
    }
  }
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}
