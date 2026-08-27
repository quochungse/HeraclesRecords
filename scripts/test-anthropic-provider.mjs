import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const providerUrl = pathToFileURL(
  path.join(repoRoot, "dist-electron", "anthropicChatProvider.js")
).href;

const {
  DEFAULT_ANTHROPIC_MODEL,
  buildAnthropicMessages,
  buildAnthropicRequestTuning,
  buildAnthropicTools,
  getAnthropicModelCapabilities,
  normalizeAnthropicError,
  resolveAnthropicModel,
  testAnthropicApiConnectionRequest
} = await import(`${providerUrl}?cacheBust=${Date.now()}`);

assert.equal(resolveAnthropicModel(), DEFAULT_ANTHROPIC_MODEL);
assert.equal(resolveAnthropicModel("   "), DEFAULT_ANTHROPIC_MODEL);
assert.equal(resolveAnthropicModel(" claude-sonnet-5 "), "claude-sonnet-5");

// Adaptive thinking and effort are 400s on models that do not support them.
const opus = buildAnthropicRequestTuning({
  model: "claude-opus-5",
  effort: "xhigh"
});
assert.deepEqual(opus.thinking, { type: "adaptive", display: "summarized" });
assert.deepEqual(opus.output_config, { effort: "xhigh" });
assert.deepEqual(opus.fallbacks, [{ model: "claude-opus-4-8" }]);
assert.deepEqual(opus.betas, ["server-side-fallback-2026-06-01"]);

const haiku = buildAnthropicRequestTuning({
  model: "claude-haiku-4-5",
  effort: "high"
});
assert.equal(haiku.thinking, undefined);
assert.equal(haiku.output_config, undefined);
assert.equal(haiku.fallbacks, undefined);
assert.equal(haiku.betas, undefined);

// Sonnet 5 takes adaptive thinking and effort but is not a fallback target.
const sonnet = buildAnthropicRequestTuning({
  model: "claude-sonnet-5",
  effort: "low"
});
assert.deepEqual(sonnet.output_config, { effort: "low" });
assert.equal(sonnet.fallbacks, undefined);

// Asking for more output than a model allows is a hard 400, so an id this build
// does not know gets a lower ceiling rather than the optimistic one.
assert.equal(getAnthropicModelCapabilities("claude-opus-5").maxOutputTokens, 64_000);
assert.equal(
  getAnthropicModelCapabilities("claude-opus-9").maxOutputTokens,
  32_000
);

// A model id newer than this build keeps the modern request shape.
const unknown = getAnthropicModelCapabilities("claude-opus-9");
assert.equal(unknown.adaptiveThinking, true);
assert.equal(unknown.effort, true);
assert.equal(unknown.refusalFallback, false);

// An empty model resolves to the default before capabilities are read.
assert.deepEqual(
  buildAnthropicRequestTuning({ model: "", effort: "max" }).output_config,
  { effort: "max" }
);

assert.deepEqual(
  buildAnthropicTools([
    {
      name: "list_recent_activities",
      description: "List activities",
      inputSchema: { type: "object", properties: { limit: { type: "number" } } }
    },
    { name: "no_schema" }
  ]),
  [
    {
      name: "list_recent_activities",
      description: "List activities",
      input_schema: {
        type: "object",
        properties: { limit: { type: "number" } }
      }
    },
    {
      name: "no_schema",
      description: "",
      input_schema: { type: "object", properties: {} }
    }
  ]
);

// The Messages API rejects a leading assistant turn and empty content.
assert.deepEqual(
  buildAnthropicMessages([
    { role: "assistant", content: "Welcome back." },
    { role: "user", content: "  " },
    { role: "user", content: "How was my week?" },
    { role: "assistant", content: "Solid." }
  ]),
  [
    { role: "user", content: "How was my week?" },
    { role: "assistant", content: "Solid." }
  ]
);
assert.deepEqual(
  buildAnthropicMessages([{ role: "assistant", content: "orphan" }]),
  []
);

assert.equal(normalizeAnthropicError(new Error("boom")).kind, "connection");

// The provider requires the SDK's CommonJS build, so the error classes must be
// loaded the same way for instanceof to hold.
const requireCjs = createRequire(import.meta.url);
const {
  APIUserAbortError,
  AuthenticationError,
  NotFoundError,
  RateLimitError
} = requireCjs("@anthropic-ai/sdk");

assert.equal(
  normalizeAnthropicError(
    new AuthenticationError(401, undefined, "invalid x-api-key", undefined)
  ).kind,
  "auth"
);
assert.equal(
  normalizeAnthropicError(
    new RateLimitError(429, undefined, "rate limited", undefined)
  ).kind,
  "usage-limit"
);
assert.equal(
  normalizeAnthropicError(
    new NotFoundError(404, undefined, "model not found", undefined)
  ).kind,
  "model-unavailable"
);
assert.equal(
  normalizeAnthropicError(new APIUserAbortError()).kind,
  "cancelled"
);

// A missing key is reported without a network call.
const noKey = await testAnthropicApiConnectionRequest({
  model: "claude-opus-5",
  effort: "high"
});
assert.equal(noKey.ok, false);
assert.match(noKey.message, /API key/i);

console.log("anthropic provider tests passed");
