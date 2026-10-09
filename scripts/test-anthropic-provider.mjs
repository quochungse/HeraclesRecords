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
  anthropicModelEntry,
  buildAnthropicMessages,
  buildAnthropicSystem,
  buildAnthropicRequestTuning,
  buildAnthropicTools,
  buildAnthropicWebTools,
  getAnthropicModelCapabilities,
  normalizeAnthropicError,
  resolveAnthropicModel,
  testAnthropicApiConnectionRequest
} = await import(`${providerUrl}?cacheBust=${Date.now()}`);

// Web search and fetch: the filtering variants where the model takes them,
// the basic ones on Haiku and before 4.6.
const webTypes = (model) => buildAnthropicWebTools(model).map((tool) => tool.type);
assert.deepEqual(webTypes("claude-opus-5-5"), ["web_search_20260209", "web_fetch_20260209"]);
assert.deepEqual(webTypes("claude-sonnet-4-6"), ["web_search_20260209", "web_fetch_20260209"]);
for (const older of ["claude-haiku-4-5", "claude-sonnet-4-5", "claude-opus-4-1-20250805", "claude-sonnet-4-20250514"]) {
  assert.deepEqual(webTypes(older), ["web_search_20250305", "web_fetch_20250910"], older);
}
assert.ok(buildAnthropicWebTools("claude-opus-5-5").every((tool) => tool.max_uses > 0), "every search is bounded");

assert.equal(resolveAnthropicModel(), DEFAULT_ANTHROPIC_MODEL);
assert.equal(resolveAnthropicModel("   "), DEFAULT_ANTHROPIC_MODEL);
assert.equal(resolveAnthropicModel(" claude-sonnet-5 "), "claude-sonnet-5");

// The rules and the tool guide are cached; the snapshot after them is not, so
// a new recovery figure does not re-send the tool guide uncached.
assert.deepEqual(buildAnthropicSystem("Rules.", "Today is…"), [
  { type: "text", text: "Rules.", cache_control: { type: "ephemeral" } },
  { type: "text", text: "Today is…" }
]);
assert.deepEqual(buildAnthropicSystem("Rules.", "  "), [
  { type: "text", text: "Rules.", cache_control: { type: "ephemeral" } }
], "an empty snapshot is no block (the API refuses an empty text block)");
const providerSource = (await import("node:fs")).readFileSync(
  path.join(repoRoot, "electron", "anthropicChatProvider.ts"),
  "utf8"
);
assert.match(providerSource, /system: buildAnthropicSystem\(options\.instructions, options\.liveInstructions\),\s*cache_control: \{ type: "ephemeral" \}/, "the request caches its system prompt and its conversation");

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
assert.equal(unknown.fallbackModel, "");

// ----- The key's own model list outranks the table, field by field -----

const supported = { supported: true };
const unsupported = { supported: false };
const effortLevels = (levels) => ({
  supported: levels.length > 0,
  ...Object.fromEntries(
    ["low", "medium", "high", "xhigh", "max"].map((level) => [
      level,
      levels.includes(level) ? supported : unsupported
    ])
  )
});
const modelInfo = (overrides) => ({
  id: "claude-opus-6",
  display_name: "Claude Opus 6",
  max_tokens: 128_000,
  allowed_fallback_models: ["claude-opus-5", "claude-opus-4-8"],
  capabilities: {
    effort: effortLevels(["low", "medium", "high"]),
    thinking: { supported: true, types: { adaptive: supported, enabled: unsupported } }
  },
  ...overrides
});

// A model released after this build is listed with what it takes.
const opus6 = anthropicModelEntry(modelInfo({}));
assert.deepEqual(opus6, {
  value: "claude-opus-6",
  label: "Claude Opus 6",
  efforts: ["low", "medium", "high"],
  adaptiveThinking: true,
  maxOutputTokens: 128_000,
  // The rescue it had stays while the model still allows it.
  fallbackModel: "claude-opus-4-8"
});
// A retired fallback does not strand the model: its first allowed target is taken.
assert.equal(
  anthropicModelEntry(modelInfo({ allowed_fallback_models: ["claude-opus-5"] })).fallbackModel,
  "claude-opus-5"
);
assert.equal(
  anthropicModelEntry(modelInfo({ allowed_fallback_models: [] })).fallbackModel,
  ""
);
// What the API leaves out stays unstated, so the table can still answer.
const bare = anthropicModelEntry(
  modelInfo({ capabilities: null, allowed_fallback_models: null, max_tokens: null, display_name: "" })
);
assert.deepEqual(bare, { value: "claude-opus-6", label: "Opus 6" });
// A model with no effort at all lists none, rather than every level.
assert.deepEqual(
  anthropicModelEntry(modelInfo({ capabilities: { effort: effortLevels([]), thinking: { supported: false, types: { adaptive: unsupported, enabled: supported } } } })).efforts,
  []
);

// The request follows the listed row: the effort clamps to the highest level
// the model takes at or below the one chosen, rather than a 400.
const listedTuning = buildAnthropicRequestTuning({
  model: "claude-opus-6",
  effort: "max",
  listed: opus6
});
assert.deepEqual(listedTuning.output_config, { effort: "high" });
assert.deepEqual(listedTuning.fallbacks, [{ model: "claude-opus-4-8" }]);
assert.deepEqual(listedTuning.betas, ["server-side-fallback-2026-06-01"]);
// The API's output ceiling replaces the unknown-model guess, held to the app's cap.
assert.equal(getAnthropicModelCapabilities("claude-opus-6", opus6).maxOutputTokens, 64_000);
assert.equal(
  getAnthropicModelCapabilities("claude-opus-6", { ...opus6, maxOutputTokens: 8_192 }).maxOutputTokens,
  8_192
);
// A row that says a model takes no effort sends none, even for a known id.
const noEffort = buildAnthropicRequestTuning({
  model: "claude-opus-5",
  effort: "high",
  listed: { value: "claude-opus-5", label: "Claude Opus 5", efforts: [], fallbackModel: "" }
});
assert.equal(noEffort.output_config, undefined);
assert.equal(noEffort.fallbacks, undefined);
// A row that leaves thinking unstated keeps the table's answer.
assert.deepEqual(
  buildAnthropicRequestTuning({
    model: "claude-haiku-4-5",
    effort: "high",
    listed: { value: "claude-haiku-4-5", label: "Claude Haiku 4.5" }
  }).thinking,
  undefined
);

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
