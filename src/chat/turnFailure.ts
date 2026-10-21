// What went wrong with a turn, for the row drawn where its answer would be.
//
// Nothing here is stored. A failure's words live as long as the window that
// saw it; reopened, a question with no answer under it is all there is, and
// that is enough to offer it again (`unansweredKind`). The stopped-early
// notice is the exception only because it was already stored, as a sentence
// of its own (`storedNotice.ts`).

/** Why a turn produced nothing: what the provider's error says, sorted by what the athlete can do about it. */
export type TurnFailureKind = "busy" | "offline" | "auth" | "tooLong" | "other";

/** Every row the transcript can draw under a question. */
export type TurnFailureRowKind = TurnFailureKind | "partial" | "noAnswer" | "elsewhere";

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
  if (BUSY.test(message)) return "busy";
  if (OFFLINE.test(message)) return "offline";
  if (AUTH.test(message)) return "auth";
  return "other";
}

/** How long a question with no answer may still be one being answered on another device. */
export const ANSWERING_ELSEWHERE_MS = 10 * 60_000;

/**
 * What to say under a question no answer followed, when this window saw no
 * failure: a recent one may still be in flight on the other machine — its
 * question is saved the moment it is sent, its answer only once it is done.
 */
export function unansweredKind(askedAt: number | undefined, now: number): "noAnswer" | "elsewhere" {
  return askedAt !== undefined && now - askedAt < ANSWERING_ELSEWHERE_MS ? "elsewhere" : "noAnswer";
}
