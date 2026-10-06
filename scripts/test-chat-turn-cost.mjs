// Runs under Electron because this repo's Node is built without Amaro and
// cannot strip types. Nothing here touches SQLite.
//
// The per-answer cost footer: what it prints, and the round-trip that decides
// whether it is still there after a reload.
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const srcUrl = (...parts) =>
  pathToFileURL(path.join(repoRoot, ...parts)).href + `?c=${Date.now()}`;

const { formatTokenCount, formatTurnCost, formatTurnCostDetail, totalTokens } =
  await import(srcUrl("src", "chat", "turnCost.ts"));
const { CACHE_READ_WEIGHT, addTokenUsage, countableUsage, countedTokens, tokenUsage } =
  await import(srcUrl("electron", "tokenUsage.ts"));
const { extractResponseUsage } = await import(srcUrl("electron", "chatResponsesProtocol.ts"));
const { describeChatModel } = await import(
  srcUrl("electron", "chatModels.ts")
);
const { fromPersistedEntries, toPersistedEntries } = await import(
  srcUrl("src", "chat", "chatTypes.ts")
);

// --- the number, as a person reads it --------------------------------------
// Thousands keep one decimal because that is the range a chat turn lives in:
// rounding to whole thousands would make 12.4k and 12.9k print identically,
// and telling those apart is the whole reason the footer exists.
assert.equal(formatTokenCount(0), "0");
assert.equal(formatTokenCount(847), "847");
assert.equal(formatTokenCount(999), "999");
assert.equal(formatTokenCount(1_000), "1k");
assert.equal(formatTokenCount(23_200), "23.2k");
assert.equal(formatTokenCount(23_990), "24k", "a rounded .0 does not print");
// The unit is chosen after rounding: to one decimal this is 1000.0k, which is
// not a number anyone writes. A 1M-context model puts it within one turn.
assert.equal(formatTokenCount(999_999), "1M");
assert.equal(formatTokenCount(999_000), "999k");
assert.equal(formatTokenCount(1_400_000), "1.4M");
// Nothing here should ever produce NaN under an answer.
assert.equal(formatTokenCount(Number.NaN), "0");
assert.equal(formatTokenCount(-5), "0");

// --- input and output are one number ---------------------------------------
// The split is in the tooltip. The line itself answers "was that turn
// expensive?", and two numbers make that a subtraction the reader has to do.
assert.equal(totalTokens({ inputTokens: 18_200, outputTokens: 900 }), 19_100);
assert.equal(
  formatTurnCost({ inputTokens: 18_200, outputTokens: 900 }, "claude-opus-5"),
  "Opus 5 - 19.1k Tokens"
);
assert.equal(
  formatTurnCostDetail({ inputTokens: 18_200, outputTokens: 900 }),
  "Input 18,200 · Output 900"
);

// A model nobody reported drops the name rather than printing a placeholder:
// the cost is the fact worth showing, and "Unknown" adds a word that says
// nothing. This is the Claude Code case before the CLI has answered once.
assert.equal(
  formatTurnCost({ inputTokens: 1_200, outputTokens: 300 }),
  "1.5k Tokens"
);

// --- a cache read counts as a tenth ----------------------------------------
// Measured 2026-10-06 on Claude Code: three tool rounds, 92,509 input tokens of
// which 85,021 were the same prefix read back from the cache. Counted whole it
// read as 96.3k; it cost less than a one-round turn whose prefix was new.
{
  assert.equal(CACHE_READ_WEIGHT, 0.1);
  const threeRounds = tokenUsage({ uncachedInput: 6, cacheRead: 85_021, cacheWrite: 7_482, output: 3_787 });
  assert.deepEqual(threeRounds, {
    inputTokens: 92_509,
    outputTokens: 3_787,
    cacheReadTokens: 85_021,
    cacheWriteTokens: 7_482
  });
  assert.equal(countedTokens(threeRounds), 6 + 7_482 + 8_502 + 3_787);
  assert.equal(totalTokens(threeRounds), countedTokens(threeRounds), "the footer states the same number as the budget");
  assert.equal(formatTurnCost(threeRounds, "claude-opus-5-5"), "Opus 5.5 - 19.8k Tokens");
  assert.equal(
    formatTurnCostDetail(threeRounds),
    "Input 6 · Cache write 7,482 · Cache read 85,021 (counted as 8,502) · Output 3,787"
  );
  // A cache write is counted whole: it is input the provider processed this turn.
  const coldPrefix = tokenUsage({ uncachedInput: 2, cacheWrite: 27_494, output: 1_006 });
  assert.equal(countedTokens(coldPrefix), 28_502);
  assert.equal(formatTurnCostDetail(coldPrefix), "Input 2 · Cache write 27,494 · Output 1,006");

  // A provider with no cache produces the same object as one with an empty one.
  assert.deepEqual(tokenUsage({ uncachedInput: 500, cacheRead: 0, cacheWrite: 0, output: 20 }), {
    inputTokens: 500,
    outputTokens: 20
  });

  // Summing rounds keeps the cache parts; unknown stays unknown.
  assert.deepEqual(addTokenUsage(threeRounds, { inputTokens: 100, outputTokens: 5 }), {
    inputTokens: 92_609,
    outputTokens: 3_792,
    cacheReadTokens: 85_021,
    cacheWriteTokens: 7_482
  });
  assert.equal(addTokenUsage(undefined, undefined), undefined);
  assert.equal(addTokenUsage(undefined, coldPrefix), coldPrefix);

  // A cache count that cannot be part of the input is dropped, which counts the
  // turn in full: a budget must never read under what was spent.
  assert.deepEqual(countableUsage({ inputTokens: 100, outputTokens: 1, cacheReadTokens: 900 }), {
    inputTokens: 100,
    outputTokens: 1
  });
  assert.deepEqual(
    countableUsage({ inputTokens: 100, outputTokens: 1, cacheReadTokens: 60, cacheWriteTokens: 60 }),
    { inputTokens: 100, outputTokens: 1, cacheReadTokens: 60 },
    "a write that does not fit beside the read"
  );
  assert.equal(countableUsage({ inputTokens: -1, outputTokens: 1 }), undefined);
}

// The Responses API states the cached part inside `input_tokens`, which
// already includes it — so it is the read, and nothing is added to the input.
{
  const completed = (usage) => ({ type: "response.completed", response: { usage } });
  assert.deepEqual(
    extractResponseUsage(
      completed({ input_tokens: 30_000, output_tokens: 900, input_tokens_details: { cached_tokens: 24_000 } })
    ),
    { inputTokens: 30_000, outputTokens: 900, cacheReadTokens: 24_000 }
  );
  assert.deepEqual(
    extractResponseUsage(completed({ input_tokens: 30_000, output_tokens: 900, input_tokens_details: { cached_tokens: 0 } })),
    { inputTokens: 30_000, outputTokens: 900 }
  );
  assert.equal(extractResponseUsage(completed({ input_tokens: 0, output_tokens: 0 })), undefined);
}

// --- naming a model id ------------------------------------------------------
// Claude ids are formatted rather than looked up, so a dated id or one added
// after this build still reads as a name instead of falling through raw.
assert.equal(describeChatModel("claude-opus-5"), "Opus 5");
assert.equal(describeChatModel("claude-opus-5-20260114"), "Opus 5");
assert.equal(describeChatModel("claude-haiku-4-5"), "Haiku 4.5");
assert.equal(describeChatModel("claude-fable-5-1"), "Fable 5.1");
// The picker's parenthetical is a menu qualifier, not a name to print under an
// answer: "Opus (most capable)" is how the row reads, "Opus" is the model.
assert.equal(describeChatModel("opus"), "Opus");
assert.equal(describeChatModel("gpt-5.6-sol"), "GPT-5.6 Sol");
assert.equal(describeChatModel("openrouter/auto"), "Auto Router");
// An id nothing recognises is more use printed than blanked — a router that
// answers with a model no picker lists still names it.
assert.equal(
  describeChatModel("meta-llama/llama-4-70b"),
  "meta-llama/llama-4-70b"
);
assert.equal(describeChatModel("   "), "");

// --- and it has to survive the conversion both ways -------------------------
// Both converters rebuild entries field by field, so an unlisted field is
// dropped — silently, and only visibly after a reload. That is the trap the
// header of `chatTypes.ts` already warns about for attribution; the cost is now
// the second thing riding in that shape.
{
  const answered = [
    {
      kind: "message",
      role: "assistant",
      content: "Eight easy kilometres.",
      model: "claude-opus-5",
      usage: { inputTokens: 18_200, outputTokens: 900 }
    }
  ];
  const persisted = toPersistedEntries(answered);
  assert.deepEqual(persisted[0].usage, { inputTokens: 18_200, outputTokens: 900 });
  assert.equal(persisted[0].model, "claude-opus-5");
  assert.deepEqual(fromPersistedEntries(persisted), answered);

  // The cache counts ride inside `usage`, so they travel with it both ways.
  const cachedAnswer = [
    {
      ...answered[0],
      usage: { inputTokens: 92_509, outputTokens: 3_787, cacheReadTokens: 85_021, cacheWriteTokens: 7_482 }
    }
  ];
  assert.deepEqual(fromPersistedEntries(toPersistedEntries(cachedAnswer)), cachedAnswer);

  // An answer nobody priced carries neither field, so the footer is absent
  // rather than reading zero — every answer written before this shipped is one
  // of these, and old conversations must not grow a row of zeroes.
  const unpriced = [
    { kind: "message", role: "assistant", content: "No idea what that cost." }
  ];
  const storedUnpriced = toPersistedEntries(unpriced);
  assert.equal("usage" in storedUnpriced[0], false);
  assert.equal("model" in storedUnpriced[0], false);
  assert.deepEqual(fromPersistedEntries(storedUnpriced), unpriced);
}

console.log("chat turn cost tests passed");
