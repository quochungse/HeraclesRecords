/**
 * The digest of a coach answer: what the condensed layer of a long
 * conversation carries in the answer's place (`CONTEXT_BUDGETS` in
 * `chatContextCompaction.ts`). The prompt and the check a digest must pass
 * before it is used; making one is `chatCompression.ts`.
 *
 * Measured on eight real answers (2026-09-30, Haiku 4.5): with a thinking
 * budget of 1,500 tokens a digest came out at 9–22% of the answer, in the
 * answer's language, every prescribed figure kept, at $0.007–0.010. With
 * thinking off it ran to twice the limit, switched to English, and turned the
 * weekdays "T7" and "T5" into the dates "7/7" and "5/9" — a coach reading its
 * own answer back as the wrong day is worse than no digest. So a digest is
 * never trusted as written: `digestProblems` refuses one that states a figure
 * or a date its answer does not, and the answer then goes out whole.
 *
 * No `node:` imports: a suite drives the check directly.
 */

/** The length a digest is asked for, in characters. */
export const DIGEST_CHARS = 400;

/** Thinking for a model that takes a budget rather than an effort (Haiku 4.5). */
export const DIGEST_THINKING_BUDGET = 1_500;

export function digestSystemPrompt(): string {
  return (
    "You compress one answer a running coach gave, so later turns of the conversation can carry it cheaply. " +
    `Write notes, not prose, in the answer's own language, at most ${DIGEST_CHARS} characters. Keep, exactly as written: ` +
    "every figure that was prescribed or decided (paces, heart rates, zones, distances, durations, dates, weekdays), " +
    "what the athlete was told to do, and any conclusion drawn about their data. Drop explanation, reasoning, " +
    "tables of splits, pleasantries and anything the coach could say again. Reply with the notes only."
  );
}

export function digestUserPrompt(answer: string, question?: string, problems: readonly string[] = []): string {
  return [
    ...(question ? [`Athlete asked:\n${question}`, ""] : []),
    `Coach answered:\n${answer}`,
    ...(problems.length
      ? ["", `An earlier attempt was refused: ${problems.join("; ")}. Copy every figure and date exactly as the answer writes it.`]
      : [])
  ].join("\n");
}

const DATE = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?(?!\d)/g;
const ISO_DATE = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
const NUMBER = /\d+(?:[.,]\d+)?/g;

function plain(value: string): string {
  const [whole, fraction] = value.replace(",", ".").split(".");
  const integer = String(Number(whole));
  return fraction === undefined ? integer : `${integer}.${fraction}`;
}

function dateKey(day: number, month: number, year?: number): string {
  const fullYear = year === undefined ? undefined : year < 100 ? 2000 + year : year;
  return fullYear === undefined ? `${day}/${month}` : `${day}/${month}/${fullYear}`;
}

function isDate(day: number, month: number): boolean {
  return day >= 1 && day <= 31 && month >= 1 && month <= 12;
}

/** The figures and dates a text states, each spelled one way. */
function figuresOf(text: string): { dates: Set<string>; numbers: Set<string>; rest: string } {
  const dates = new Set<string>();
  let rest = text.replace(ISO_DATE, (_match, year: string, month: string, day: string) => {
    dates.add(dateKey(Number(day), Number(month), Number(year)));
    dates.add(dateKey(Number(day), Number(month)));
    return ` ${Number(day)} ${Number(month)} ${year} `;
  });
  rest = rest.replace(DATE, (match, day: string, month: string, year: string | undefined) => {
    if (!isDate(Number(day), Number(month))) return ` ${match.replace(/\//g, " ")} `;
    dates.add(dateKey(Number(day), Number(month), year === undefined ? undefined : Number(year)));
    dates.add(dateKey(Number(day), Number(month)));
    return ` ${day} ${month} ${year ?? ""} `;
  });
  const numbers = new Set((rest.match(NUMBER) ?? []).map(plain));
  return { dates, numbers, rest };
}

/**
 * Why a digest cannot stand in for its answer, or nothing when it can.
 *
 * Every date the digest states must be one the answer states — "25/8" and
 * "25/08" are one date, a year may be written short — and every other number
 * must appear in the answer or the question, where "26" for 2026 counts. A
 * rewrite that reorders what the answer said ("HR 152/161" from two columns of
 * a table) passes; a figure that is not in the answer at all does not. A
 * refusal costs one retry and then the answer going out whole, so the check
 * errs towards refusing.
 */
export function digestProblems(
  digest: string,
  answer: string,
  question = ""
): string[] {
  const text = digest.trim();
  if (!text) return ["it was empty"];
  const problems: string[] = [];
  if (text.length > DIGEST_CHARS * 1.5) problems.push(`it ran to ${text.length} characters where ${DIGEST_CHARS} were asked for`);
  const source = figuresOf(`${question}\n${answer}`);
  const stated = figuresOf(text);
  const invented = [...stated.dates].filter((date) => !source.dates.has(date));
  if (invented.length) problems.push(`it states dates the answer does not (${invented.join(", ")})`);
  const unknown = [...stated.numbers].filter(
    (number) => !source.numbers.has(number) && !(number.length === 2 && source.numbers.has(`20${number}`))
  );
  if (unknown.length) problems.push(`it states figures the answer does not (${unknown.join(", ")})`);
  return problems;
}
