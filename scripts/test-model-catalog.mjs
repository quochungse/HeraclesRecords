/**
 * Each provider's model list is read from the provider, not shipped
 * (modelCatalog.ts), and every picker reads it through one function
 * (providerModelOptions in chatModels.ts).
 *
 * What this holds down, each because it failed silently before or would:
 *  - a list is read again once a day, and a failed or empty read never
 *    replaces the one held — an offline launch keeps yesterday's menu;
 *  - a provider with no key is skipped in silence unless it was asked for;
 *  - two reads at once for one provider are one request;
 *  - ChatGPT's list is asked with the latest Codex version, not a pinned one,
 *    or the server hides every model newer than the pin;
 *  - a model the provider stops listing stays chosen and says so;
 *  - an effort a model does not take is clamped down, never sent (a 400).
 *
 * Imports compiled main-process code: `npm run build:electron` first.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distUrl = (file) =>
  `${pathToFileURL(path.join(repoRoot, "dist-electron", file)).href}?cacheBust=${Date.now()}`;

const {
  CODEX_CLIENT_VERSION_FLOOR,
  CODEX_MODELS_URL,
  MODEL_CATALOG_TTL_MS,
  codexVersionFromTag,
  createCatalogRefresher,
  isStale,
  latestCodexVersion,
  listChatGptModels,
  openRouterEntries,
  parseCodexModels,
  parseStoredCatalog,
  resetCodexVersionForTests,
  serializeCatalog
} = await import(distUrl("modelCatalog.js"));
const {
  ANTHROPIC_MODEL_OPTIONS,
  CHATGPT_MODEL_OPTIONS,
  CLAUDE_MODEL_OPTIONS,
  OPENROUTER_MODEL_OPTIONS,
  OPENROUTER_PICKER_LIMIT,
  REASONING_EFFORT_OPTIONS,
  effortForModel,
  effortOptionsFor,
  providerModelOptions,
  withCurrentModel
} = await import(distUrl("chatModels.js"));
const { toClaudeModelOption } = await import(distUrl("claudeCodeProvider.js"));

let checks = 0;
const check = (fn) => {
  fn();
  checks += 1;
};

// ----- Staleness -----

const now = Date.parse("2026-09-27T12:00:00.000Z");
check(() => {
  assert.equal(isStale(undefined, now), true);
  assert.equal(isStale("not a date", now), true);
  assert.equal(isStale(new Date(now - 60_000).toISOString(), now), false);
  assert.equal(isStale(new Date(now - MODEL_CATALOG_TTL_MS).toISOString(), now), true);
  // A clock that jumped back must not freeze a list for good.
  assert.equal(isStale(new Date(now + 2 * MODEL_CATALOG_TTL_MS).toISOString(), now), true);
});

// ----- Stored lists -----

check(() => {
  const raw = serializeCatalog(
    [{ value: "claude-opus-6", label: "Claude Opus 6", efforts: ["low", "high"], fallbackModel: "" }],
    new Date(now)
  );
  assert.deepEqual(parseStoredCatalog(raw), {
    models: [{ value: "claude-opus-6", label: "Claude Opus 6", efforts: ["low", "high"], fallbackModel: "" }],
    fetchedAt: "2026-09-27T12:00:00.000Z"
  });
  // Nothing to show is no list at all, so a picker falls back rather than empties.
  assert.equal(parseStoredCatalog(serializeCatalog([])), undefined);
  assert.equal(parseStoredCatalog("{"), undefined);
  assert.equal(parseStoredCatalog(undefined), undefined);
  assert.equal(
    parseStoredCatalog(JSON.stringify({ models: [{ value: "", label: "Empty" }], fetchedAt: "x" })),
    undefined,
    "a row with no model id would send an empty model"
  );
});

// ----- The refresher -----

function fakeDeps(initial = {}) {
  const held = { ...initial };
  const calls = [];
  const answers = {};
  return {
    held,
    calls,
    answers,
    deps: {
      fetchedAt: (provider) => held[provider]?.fetchedAt,
      list: async (provider) => {
        calls.push(provider);
        const answer = answers[provider];
        if (answer instanceof Error) throw answer;
        return typeof answer === "function" ? answer() : answer;
      },
      save: (provider, models) => {
        held[provider] = { models, fetchedAt: new Date(now).toISOString() };
      },
      now: () => now
    }
  };
}

{
  // A fresh list is left alone; a stale one is read; a provider with nothing
  // to ask with is skipped without an error on an ordinary refresh.
  const fresh = new Date(now - 60_000).toISOString();
  const stale = new Date(now - MODEL_CATALOG_TTL_MS - 1).toISOString();
  const fake = fakeDeps({
    "claude-api": { models: [{ value: "a", label: "A" }], fetchedAt: fresh },
    openrouter: { models: [{ value: "b", label: "B" }], fetchedAt: stale }
  });
  fake.answers.openrouter = [{ value: "c", label: "C" }];
  fake.answers.chatgpt = undefined;
  const errors = await createCatalogRefresher(fake.deps)();
  check(() => {
    assert.deepEqual(fake.calls.sort(), ["chatgpt", "openrouter"]);
    assert.deepEqual(errors, {});
    assert.deepEqual(fake.held.openrouter.models, [{ value: "c", label: "C" }]);
    assert.deepEqual(fake.held["claude-api"].models, [{ value: "a", label: "A" }]);
  });
}

{
  // Asked for by name with `force`: read however fresh, and a missing key is said.
  const fake = fakeDeps({
    "claude-api": { models: [{ value: "a", label: "A" }], fetchedAt: new Date(now).toISOString() }
  });
  fake.answers["claude-api"] = [{ value: "z", label: "Z" }];
  const refresh = createCatalogRefresher(fake.deps);
  const errors = await refresh({ provider: "claude-api", force: true });
  const missing = await refresh({ provider: "chatgpt", force: true });
  check(() => {
    assert.deepEqual(errors, {});
    assert.deepEqual(fake.held["claude-api"].models, [{ value: "z", label: "Z" }]);
    assert.match(missing.chatgpt, /Sign in with ChatGPT/);
  });
}

{
  // A failure and an empty answer both keep the list held.
  const held = { models: [{ value: "keep", label: "Keep" }], fetchedAt: "2026-01-01T00:00:00.000Z" };
  const fake = fakeDeps({ "claude-api": held, openrouter: held });
  fake.answers["claude-api"] = new Error("Could not reach the Anthropic API.");
  fake.answers.openrouter = [];
  const errors = await createCatalogRefresher(fake.deps)();
  check(() => {
    assert.match(errors["claude-api"], /Could not reach/);
    assert.match(errors.openrouter, /no models/);
    assert.equal(fake.held["claude-api"], held);
    assert.equal(fake.held.openrouter, held);
  });
}

{
  // Two refreshes at once for one provider are one request.
  const fake = fakeDeps();
  let release;
  fake.answers["claude-api"] = () =>
    new Promise((resolve) => {
      release = () => resolve([{ value: "a", label: "A" }]);
    });
  const refresh = createCatalogRefresher(fake.deps);
  const first = refresh({ provider: "claude-api", force: true });
  const second = refresh({ provider: "claude-api", force: true });
  await new Promise((resolve) => setTimeout(resolve, 0));
  release();
  await Promise.all([first, second]);
  check(() => assert.deepEqual(fake.calls, ["claude-api"]));
}

// ----- ChatGPT's Codex list -----

check(() => {
  assert.equal(codexVersionFromTag("rust-v0.147.0"), "0.147.0");
  assert.equal(codexVersionFromTag("v1.2.3-beta"), "1.2.3");
  assert.equal(codexVersionFromTag("latest"), undefined);
  assert.equal(codexVersionFromTag(undefined), undefined);
});

check(() => {
  // Codex's own order and names; hidden models stay hidden.
  assert.deepEqual(
    parseCodexModels({
      models: [
        { slug: "gpt-5.6-luna", display_name: "GPT-5.6-Luna", visibility: "list", priority: 3 },
        { slug: "gpt-internal", display_name: "Internal", visibility: "hide", priority: 0 },
        { slug: "gpt-6", display_name: "GPT-6", description: "Latest frontier model.", visibility: "list", priority: 1 },
        { slug: "gpt-5.5", visibility: "list", priority: 3 },
        { slug: "", display_name: "No slug", visibility: "list", priority: 2 },
        "junk"
      ]
    }),
    [
      { value: "gpt-6", label: "GPT-6", detail: "Latest frontier model." },
      { value: "gpt-5.6-luna", label: "GPT-5.6-Luna" },
      { value: "gpt-5.5", label: "gpt-5.5" }
    ]
  );
  assert.deepEqual(parseCodexModels({}), []);
  assert.deepEqual(parseCodexModels(null), []);
});

{
  resetCodexVersionForTests();
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url, init });
    if (url.includes("api.github.com")) {
      return new Response(JSON.stringify({ tag_name: "rust-v0.151.0" }), { status: 200 });
    }
    return new Response(
      JSON.stringify({ models: [{ slug: "gpt-6", display_name: "GPT-6", visibility: "list", priority: 1 }] }),
      { status: 200 }
    );
  };
  const models = await listChatGptModels({
    accessToken: "token-123",
    accountId: "account-9",
    originator: "codex_cli_rs",
    fetchImpl
  });
  const listCall = requests.find((request) => request.url.startsWith(CODEX_MODELS_URL));
  check(() => {
    assert.deepEqual(models, [{ value: "gpt-6", label: "GPT-6" }]);
    // Asked with the latest release, so models newer than any pin are listed.
    assert.equal(listCall.url, `${CODEX_MODELS_URL}?client_version=0.151.0`);
    assert.equal(listCall.init.headers.Authorization, "Bearer token-123");
    assert.equal(listCall.init.headers["chatgpt-account-id"], "account-9");
    assert.equal(listCall.init.headers.originator, "codex_cli_rs");
  });

  // The version is read once a day, not once per list.
  await listChatGptModels({ accessToken: "t", originator: "codex_cli_rs", fetchImpl });
  check(() =>
    assert.equal(requests.filter((request) => request.url.includes("api.github.com")).length, 1)
  );

  // GitHub unreachable: the floor, not a failure.
  resetCodexVersionForTests();
  const version = await latestCodexVersion(async () => {
    throw new Error("offline");
  });
  check(() => assert.equal(version, CODEX_CLIENT_VERSION_FLOOR));

  // A refusal and an empty list are errors, so the held list stays.
  resetCodexVersionForTests();
  await assert.rejects(
    listChatGptModels({
      accessToken: "t",
      originator: "codex_cli_rs",
      fetchImpl: async (url) =>
        url.includes("api.github.com")
          ? new Response("{}", { status: 200 })
          : new Response("denied", { status: 403 })
    }),
    /\(403\)/
  );
  await assert.rejects(
    listChatGptModels({
      accessToken: "t",
      originator: "codex_cli_rs",
      fetchImpl: async () => new Response(JSON.stringify({ models: [] }), { status: 200 })
    }),
    /no models/
  );
  checks += 2;
}

// ----- OpenRouter -----

check(() =>
  assert.deepEqual(
    openRouterEntries([
      { id: "anthropic/claude-sonnet-5", name: "Anthropic: Claude Sonnet 5" },
      { id: "x/y", name: "  " },
      { id: " ", name: "blank" }
    ]),
    [
      { value: "anthropic/claude-sonnet-5", label: "Anthropic: Claude Sonnet 5" },
      { value: "x/y", label: "x/y" }
    ]
  )
);

// ----- One function answers every picker -----

const baseSettings = {
  claudeCode: { availableModels: undefined, defaultModel: undefined },
  modelCatalogs: {}
};

check(() => {
  // Nothing read yet: the shipped lists.
  assert.deepEqual(providerModelOptions("claude-api", baseSettings), ANTHROPIC_MODEL_OPTIONS);
  assert.deepEqual(providerModelOptions("openrouter", baseSettings), OPENROUTER_MODEL_OPTIONS);
  assert.deepEqual(providerModelOptions("chatgpt", baseSettings), CHATGPT_MODEL_OPTIONS);
  assert.deepEqual(providerModelOptions("claude-code", baseSettings), CLAUDE_MODEL_OPTIONS);
  assert.deepEqual(providerModelOptions("local", baseSettings), []);
});

check(() => {
  const settings = {
    ...baseSettings,
    modelCatalogs: {
      "claude-api": { models: [{ value: "claude-opus-6", label: "Claude Opus 6" }], fetchedAt: "x" },
      chatgpt: { models: [{ value: "gpt-6", label: "GPT-6" }], fetchedAt: "x" },
      openrouter: {
        models: [
          { value: "openrouter/auto", label: "duplicate router" },
          ...Array.from({ length: 100 }, (_, index) => ({ value: `m/${index}`, label: `M ${index}` }))
        ],
        fetchedAt: "x"
      }
    }
  };
  // A model the provider added reaches the picker; one it dropped does not.
  assert.deepEqual(providerModelOptions("claude-api", settings), [
    { value: "claude-opus-6", label: "Claude Opus 6" }
  ]);
  // "Auto" stays first for ChatGPT, then the account's models.
  assert.deepEqual(
    providerModelOptions("chatgpt", settings).map((option) => option.value),
    ["", "gpt-6"]
  );
  // The routers lead, once, and the list is cut to a menu's length.
  const openRouter = providerModelOptions("openrouter", settings);
  assert.deepEqual(openRouter.slice(0, 2), OPENROUTER_MODEL_OPTIONS);
  assert.equal(openRouter.length, OPENROUTER_MODEL_OPTIONS.length + OPENROUTER_PICKER_LIMIT);
  assert.equal(openRouter.filter((option) => option.value === "openrouter/auto").length, 1);
});

check(() => {
  // Claude Code: the live status's list outranks the stored one.
  const stored = [{ value: "", label: "Default (Opus 5)" }];
  const live = [{ value: "", label: "Default (Opus 5.5)" }, { value: "haiku", label: "Haiku 4.5", efforts: [] }];
  const settings = { ...baseSettings, claudeCode: { availableModels: stored } };
  assert.deepEqual(providerModelOptions("claude-code", settings, { availableModels: live }), live);
  assert.deepEqual(providerModelOptions("claude-code", settings, null), stored);
  assert.equal(
    providerModelOptions("claude-code", baseSettings, { defaultModel: "claude-opus-5-5" })[0].label,
    "Default (Opus 5.5)"
  );
});

check(() => {
  // A model no longer listed stays chosen, named, and says why.
  const options = [{ value: "claude-opus-6", label: "Claude Opus 6" }];
  const kept = withCurrentModel(options, "claude-fable-5");
  assert.deepEqual(kept.at(-1), {
    value: "claude-fable-5",
    label: "Fable 5",
    detail: "not in the provider’s list"
  });
  assert.deepEqual(withCurrentModel(options, "claude-opus-6"), options);
  assert.deepEqual(withCurrentModel(options, "  "), options);
  assert.notEqual(withCurrentModel(options, "claude-opus-6"), options, "the list is copied, never shared");
});

// ----- Effort -----

check(() => {
  assert.deepEqual(effortOptionsFor(undefined), REASONING_EFFORT_OPTIONS);
  assert.deepEqual(effortOptionsFor({}), REASONING_EFFORT_OPTIONS);
  assert.deepEqual(effortOptionsFor({ efforts: [] }), []);
  assert.deepEqual(
    effortOptionsFor({ efforts: ["high", "low"] }).map((option) => option.value),
    ["low", "high"]
  );

  assert.equal(effortForModel("max", undefined), "max");
  assert.equal(effortForModel("max", []), undefined);
  assert.equal(effortForModel("xhigh", ["low", "medium", "high"]), "high");
  assert.equal(effortForModel("medium", ["low", "medium", "high"]), "medium");
  // Nothing at or below the choice: the model's lowest, not a 400.
  assert.equal(effortForModel("low", ["high", "max"]), "high");
});

check(() => {
  // Claude Code says which levels a model takes; the row carries them.
  assert.deepEqual(
    toClaudeModelOption({
      value: "opus",
      displayName: "Opus",
      description: "Opus 5.5 · Most capable",
      supportsEffort: true,
      supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"]
    }).efforts,
    ["low", "medium", "high", "xhigh", "max"]
  );
  assert.deepEqual(
    toClaudeModelOption({ value: "haiku", displayName: "Haiku", supportsEffort: false }).efforts,
    []
  );
  assert.equal(
    "efforts" in toClaudeModelOption({ value: "sonnet", displayName: "Sonnet" }),
    false,
    "unstated stays unstated"
  );
});

console.log(`model catalog OK — ${checks} checks`);
