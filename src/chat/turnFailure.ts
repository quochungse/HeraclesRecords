// What went wrong with a turn, for the row drawn where its answer would be.
//
// Nothing here is stored. A failure's words live as long as the window that
// saw it; reopened, a question with no answer under it is all there is, and
// that is enough to offer it again (`unansweredKind`). The stopped-early
// notice is the exception only because it was already stored, as a sentence
// of its own (`storedNotice.ts`).

/** Why a turn produced nothing: what the provider's error says, sorted by what the athlete can do about it. */
export type TurnFailureKind = "limit" | "busy" | "offline" | "auth" | "tooLong" | "other";

/** Every row the transcript can draw under a question. */
export type TurnFailureRowKind = TurnFailureKind | "partial" | "noAnswer" | "elsewhere";

/** A subscription's usage limit: Claude Code's own "usage limit" or "hit your … limit", not a passing rate limit. */
const LIMIT = /usage limit|session limit|hit your [^.]*limit|credits_required/i;
const BUSY = /\b(429|529)\b|overloaded|rate[ _-]?limit|too many requests|capacity/i;
const OFFLINE =
  /ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|fetch failed|network|socket hang up|getaddrinfo/i;
const TOO_LONG = /prompt is too long|context[_ ]length|context window|maximum context|too many tokens|input is too long/i;
const AUTH = /\b401\b|unauthori[sz]ed|authentication_error|invalid (?:x-)?api[ -]key|not logged in|please run \/login|oauth token/i;

/**
 * The kind of a failure, read from the provider's own words. The main process
 * already says when a failure was a sign-in (`authError`); everything else is
 * matched on the message, which every provider phrases differently — a miss
 * lands on "other", whose row still offers Retry.
 */
export function classifyTurnFailure(message: string, authError = false): TurnFailureKind {
  if (authError) return "auth";
  if (TOO_LONG.test(message)) return "tooLong";
  if (LIMIT.test(message)) return "limit";
  if (BUSY.test(message)) return "busy";
  if (OFFLINE.test(message)) return "offline";
  if (AUTH.test(message)) return "auth";
  return "other";
}

/**
 * When a usage limit resets, as the main process writes it into the failure
 * ("… Resets at <ISO instant>.", `usageLimitError`) — read off the words, which
 * are also what a stopped turn stores.
 */
export function limitResetsAt(message: string | undefined): Date | undefined {
  const at = message?.match(/\bResets at (\d{4}-\d\d-\d\dT[\d:.]+Z)\./)?.[1];
  const date = at ? new Date(at) : undefined;
  return date && Number.isFinite(date.getTime()) ? date : undefined;
}

/** How long a question with no answer may still be one being answered on another device. */
export const ANSWERING_ELSEWHERE_MS = 10 * 60_000;

/**
 * What to say under a question no answer followed, when this window saw no
 * failure: a recent one asked on the other machine may still be in flight
 * there — its question is saved the moment it is sent, its answer only once
 * it is done. Only the machine that asked answers (`askedOn`, read off the
 * question's `mid`), so one asked here, with no turn running here, went
 * unanswered however recent: a transcript a sync pull had disordered once
 * showed this machine's own question as being answered elsewhere. `here`
 * unknown rules no machine out.
 */
export function unansweredKind(
  question: { askedAt: number | undefined; askedOn: string | undefined },
  here: string | undefined,
  now: number
): "noAnswer" | "elsewhere" {
  const { askedAt, askedOn } = question;
  if (askedAt === undefined || now - askedAt >= ANSWERING_ELSEWHERE_MS) return "noAnswer";
  // No `mid` yet: written in this window, so asked here.
  if (askedOn === undefined || askedOn === here) return "noAnswer";
  return "elsewhere";
}
