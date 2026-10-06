/**
 * Each provider's model list, read from the provider rather than shipped.
 *
 * A list written into the build goes stale the day a provider adds or retires
 * a model: the picker keeps offering one that is gone and never offers the
 * new one. So the lists are read — Anthropic's `/v1/models`, OpenRouter's
 * `/models/user`, ChatGPT's Codex model list — kept in `app_settings` with the
 * time they were read, and read again once a day or when the athlete asks.
 * Claude Code keeps its own list under `chat.claudeCode.availableModels`,
 * read from the CLI (`listClaudeCodeModels`) on the same one-day clock.
 *
 * The shipped lists in `chatModels.ts` remain, as what a picker shows before
 * a list has ever been read. A failed read never clears a list that was read
 * before: an offline launch keeps yesterday's menu rather than falling back
 * to the build's.
 *
 * Everything here but the two fetches is pure, for the tests.
 */
import type {
  CatalogProvider,
  ModelCatalog,
  ModelCatalogEntry,
  OpenRouterModelOption
} from "./types";

/** How old a list may be before an ordinary refresh reads it again. */
export const MODEL_CATALOG_TTL_MS = 24 * 60 * 60 * 1000;

/** Where each list is kept. `device` tier: a list belongs to the key or account signed in here. */
export const MODEL_CATALOG_KEYS: Record<CatalogProvider, string> = {
  "claude-api": "chat.modelCatalog.claudeApi",
  openrouter: "chat.modelCatalog.openRouter",
  chatgpt: "chat.modelCatalog.chatgpt"
};

export const CATALOG_PROVIDERS: readonly CatalogProvider[] = ["claude-api", "openrouter", "chatgpt"];

/** A list read at `fetchedAt` is due again once a day has passed, or when its time is unreadable. */
export function isStale(fetchedAt: string | undefined, now = Date.now()): boolean {
  if (!fetchedAt) return true;
  const at = Date.parse(fetchedAt);
  return !Number.isFinite(at) || now - at >= MODEL_CATALOG_TTL_MS || at > now + MODEL_CATALOG_TTL_MS;
}

const EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);

/**
 * One stored row, checked field by field. A row this build cannot read is
 * dropped rather than trusted: a picker row with no `value` would send an
 * empty model id.
 */
export function parseCatalogEntry(raw: unknown): ModelCatalogEntry | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const row = raw as Record<string, unknown>;
  if (typeof row.value !== "string" || typeof row.label !== "string") return undefined;
  const entry: ModelCatalogEntry = { value: row.value, label: row.label };
  if (typeof row.detail === "string" && row.detail) entry.detail = row.detail;
  if (Array.isArray(row.efforts)) {
    entry.efforts = row.efforts.filter(
      (level): level is NonNullable<ModelCatalogEntry["efforts"]>[number] =>
        typeof level === "string" && EFFORTS.has(level)
    );
  }
  if (typeof row.adaptiveThinking === "boolean") entry.adaptiveThinking = row.adaptiveThinking;
  if (typeof row.maxOutputTokens === "number" && row.maxOutputTokens > 0) {
    entry.maxOutputTokens = row.maxOutputTokens;
  }
  if (typeof row.fallbackModel === "string") entry.fallbackModel = row.fallbackModel;
  return entry;
}

/**
 * Stored rows, the unreadable ones dropped. An empty `value` is dropped too,
 * unless the list means one — Claude Code's "Default" row is the empty id.
 */
export function parseCatalogEntries(
  raw: unknown,
  options: { keepEmptyValue?: boolean } = {}
): ModelCatalogEntry[] {
  return Array.isArray(raw)
    ? raw.flatMap((row) => {
        const entry = parseCatalogEntry(row);
        return entry && (options.keepEmptyValue || entry.value.trim()) ? [entry] : [];
      })
    : [];
}

/** A stored list, or `undefined` for none, an empty one, or one this build cannot read. */
export function parseStoredCatalog(raw: string | undefined): ModelCatalog | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as { models?: unknown; fetchedAt?: unknown };
    const models = parseCatalogEntries(parsed.models);
    if (models.length === 0 || typeof parsed.fetchedAt !== "string") return undefined;
    return { models, fetchedAt: parsed.fetchedAt };
  } catch {
    return undefined;
  }
}

export function serializeCatalog(models: ModelCatalogEntry[], fetchedAt: Date = new Date()): string {
  return JSON.stringify({ models, fetchedAt: fetchedAt.toISOString() } satisfies ModelCatalog);
}

// ----- Refreshing -----

export interface CatalogRefreshDeps {
  /** When the provider's held list was read, if one is held. */
  fetchedAt(provider: CatalogProvider): string | undefined;
  /** The provider's list now, or `undefined` when there is nothing to ask with (no key, not signed in). */
  list(provider: CatalogProvider): Promise<ModelCatalogEntry[] | undefined>;
  save(provider: CatalogProvider, models: ModelCatalogEntry[]): void;
  now?(): number;
}

const NOTHING_TO_ASK_WITH: Record<CatalogProvider, string> = {
  "claude-api": "Add an Anthropic API key first.",
  openrouter: "Add an OpenRouter API key first.",
  chatgpt: "Sign in with ChatGPT first."
};

/**
 * Reads each provider's list where it is due — a day old, never read, or
 * named with `force` — and keeps what comes back. The rules, each for a
 * reason:
 *
 * - A provider with nothing to ask with is skipped in silence, unless it was
 *   named: an ordinary launch must not report "add a key" for every provider
 *   the athlete does not use.
 * - A failure keeps the list held, and so does an empty answer: an offline
 *   launch shows yesterday's menu, never an empty one.
 * - A read already running for a provider is joined, not repeated, so Coach
 *   and Settings opening together cost one request each.
 *
 * Returns why each provider that failed did, by provider.
 */
export function createCatalogRefresher(deps: CatalogRefreshDeps) {
  const running = new Map<CatalogProvider, Promise<void>>();
  const readOne = async (provider: CatalogProvider, named: boolean): Promise<void> => {
    const models = await deps.list(provider);
    if (models === undefined) {
      if (named) throw new Error(NOTHING_TO_ASK_WITH[provider]);
      return;
    }
    if (models.length === 0) throw new Error("The provider listed no models.");
    deps.save(provider, models);
  };
  return async (
    options: { provider?: CatalogProvider; force?: boolean } = {}
  ): Promise<Partial<Record<CatalogProvider, string>>> => {
    const errors: Partial<Record<CatalogProvider, string>> = {};
    const targets = options.provider ? [options.provider] : CATALOG_PROVIDERS;
    const now = deps.now?.() ?? Date.now();
    await Promise.all(
      targets.map(async (provider) => {
        if (!options.force && !isStale(deps.fetchedAt(provider), now)) return;
        let job = running.get(provider);
        if (!job) {
          job = readOne(provider, provider === options.provider).finally(() => {
            running.delete(provider);
          });
          running.set(provider, job);
        }
        try {
          await job;
        } catch (caught) {
          errors[provider] = caught instanceof Error ? caught.message : String(caught);
        }
      })
    );
    return errors;
  };
}

// ----- OpenRouter -----

/** OpenRouter's listed models as picker rows, in its own most-used order. The routers are the picker's, not the list's. */
export function openRouterEntries(models: readonly OpenRouterModelOption[]): ModelCatalogEntry[] {
  return models.flatMap((model) =>
    model.id.trim() ? [{ value: model.id, label: model.name.trim() || model.id }] : []
  );
}

// ----- ChatGPT (Codex backend) -----
//
// Same caveat as the rest of the ChatGPT path in chatService.ts: this is the
// endpoint the Codex CLI reads its own model list from, undocumented and
// subject to change. It is why every failure here falls back to the shipped
// list rather than to nothing.

export const CODEX_MODELS_URL = "https://chatgpt.com/backend-api/codex/models";
const CODEX_RELEASES_URL = "https://api.github.com/repos/openai/codex/releases/latest";

/**
 * The client version the list is asked for when the latest Codex release
 * cannot be read. The server leaves out every model whose
 * `minimal_client_version` is newer than the version asked with, so a
 * version fixed in the build would hide each model released after it —
 * which is the staleness this module exists to remove. It is only the floor.
 */
export const CODEX_CLIENT_VERSION_FLOOR = "0.144.0";

/** `rust-v0.147.0` → `0.147.0`; anything that is not a version → undefined. */
export function codexVersionFromTag(tag: unknown): string | undefined {
  if (typeof tag !== "string") return undefined;
  const match = /(\d+\.\d+\.\d+)/.exec(tag);
  return match?.[1];
}

/**
 * The Codex model list as picker rows: only the models Codex itself lists
 * (`visibility: "list"`; hidden ones are internal or retired), in its own
 * priority order, named as ChatGPT names them.
 */
export function parseCodexModels(payload: unknown): ModelCatalogEntry[] {
  const models = (payload as { models?: unknown } | null)?.models;
  if (!Array.isArray(models)) return [];
  return models
    .flatMap((raw, index) => {
      if (typeof raw !== "object" || raw === null) return [];
      const row = raw as Record<string, unknown>;
      const slug = typeof row.slug === "string" ? row.slug.trim() : "";
      if (!slug) return [];
      if (row.visibility !== undefined && row.visibility !== "list") return [];
      const priority = typeof row.priority === "number" ? row.priority : Number.MAX_SAFE_INTEGER;
      const label = typeof row.display_name === "string" && row.display_name.trim() ? row.display_name.trim() : slug;
      const detail = typeof row.description === "string" && row.description.trim() ? row.description.trim() : undefined;
      return [{ entry: { value: slug, label, ...(detail ? { detail } : {}) }, priority, index }];
    })
    .sort((a, b) => a.priority - b.priority || a.index - b.index)
    .map(({ entry }) => entry);
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

let codexVersion: { value: string; at: number } | undefined;

/** The latest Codex CLI release, read at most once a day; the floor when GitHub does not answer. */
export async function latestCodexVersion(fetchImpl: FetchLike = fetch): Promise<string> {
  if (codexVersion && Date.now() - codexVersion.at < MODEL_CATALOG_TTL_MS) return codexVersion.value;
  try {
    const response = await fetchImpl(CODEX_RELEASES_URL, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "Heracles Records" },
      signal: AbortSignal.timeout(10_000)
    });
    const version = response.ok ? codexVersionFromTag(((await response.json()) as { tag_name?: unknown }).tag_name) : undefined;
    if (version) {
      codexVersion = { value: version, at: Date.now() };
      return version;
    }
  } catch {
    // The floor below still lists every model released up to it.
  }
  return CODEX_CLIENT_VERSION_FLOOR;
}

export interface CodexModelListRequest {
  accessToken: string;
  accountId?: string;
  originator: string;
  fetchImpl?: FetchLike;
}

/** The models this ChatGPT account can run through Codex, in ChatGPT's order. */
export async function listChatGptModels(request: CodexModelListRequest): Promise<ModelCatalogEntry[]> {
  const fetchImpl = request.fetchImpl ?? fetch;
  const version = await latestCodexVersion(fetchImpl);
  const url = `${CODEX_MODELS_URL}?client_version=${encodeURIComponent(version)}`;
  const response = await fetchImpl(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${request.accessToken}`,
      Accept: "application/json",
      originator: request.originator,
      version,
      ...(request.accountId ? { "chatgpt-account-id": request.accountId } : {})
    },
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) {
    throw new Error(`ChatGPT model list failed (${response.status}).`);
  }
  const models = parseCodexModels(await response.json());
  if (models.length === 0) {
    throw new Error("ChatGPT returned no models.");
  }
  return models;
}

const CLAUDE_CODE_DIST_TAGS_URL = "https://registry.npmjs.org/-/package/@anthropic-ai/claude-code/dist-tags";
/** How long a failed read stands before it is tried again, so an offline Settings does not wait on every open. */
const CLAUDE_CODE_VERSION_RETRY_MS = 60 * 60 * 1000;

let claudeCodeVersion: { value: string | undefined; at: number; ttl: number } | undefined;

/**
 * The latest Claude Code release, from npm's `latest` tag — the channel both the
 * npm package and `claude update` follow. Read at most once a day; undefined when
 * npm does not answer, and that answer is kept for an hour.
 */
export async function latestClaudeCodeVersion(fetchImpl: FetchLike = fetch): Promise<string | undefined> {
  if (claudeCodeVersion && Date.now() - claudeCodeVersion.at < claudeCodeVersion.ttl) return claudeCodeVersion.value;
  let value: string | undefined;
  try {
    const response = await fetchImpl(CLAUDE_CODE_DIST_TAGS_URL, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5_000)
    });
    value = response.ok ? codexVersionFromTag(((await response.json()) as { latest?: unknown }).latest) : undefined;
  } catch {
    value = undefined;
  }
  claudeCodeVersion = { value, at: Date.now(), ttl: value ? MODEL_CATALOG_TTL_MS : CLAUDE_CODE_VERSION_RETRY_MS };
  return value;
}

/** The latest Claude Code release as last read, without asking npm. */
export function knownLatestClaudeCodeVersion(): string | undefined {
  return claudeCodeVersion?.value;
}

/** For tests: forget the cached Codex version. */
export function resetCodexVersionForTests(): void {
  codexVersion = undefined;
}
