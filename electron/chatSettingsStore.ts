import type {
  InlineSuggestionsMode, AnthropicEffort, ChatProvider, ChatSettings } from "./types";
import { normalizeCoachStyle } from "./coachStyles";
import { MAX_CUSTOM_COACH_INSTRUCTIONS } from "./types";
import {
  normalizeCompactModelChoice,
  normalizeContextDetail,
  normalizeContextWindow,
  serializeCompactModelChoice
} from "./chatContextCompaction";
import {
  DEFAULT_LOCAL_CHAT_BASE_URL,
  normalizeLocalChatBaseUrl
} from "./localChatProvider";
import { DEFAULT_OPENROUTER_MODEL } from "./openRouterProvider";
import {
  DEFAULT_ANTHROPIC_EFFORT,
  DEFAULT_ANTHROPIC_MODEL
} from "./anthropicChatProvider";
import {
  CATALOG_PROVIDERS,
  MODEL_CATALOG_KEYS,
  parseCatalogEntries,
  parseStoredCatalog
} from "./modelCatalog";

export const CHAT_SETTINGS_KEYS = {
  provider: "chat.provider",
  chatgptModel: "chat.chatgpt.model",
  openRouterModel: "chat.openRouter.model",
  openRouterApiKey: "chat.openRouter.apiKey",
  anthropicModel: "chat.anthropic.model",
  anthropicEffort: "chat.anthropic.effort",
  anthropicApiKey: "chat.anthropic.apiKey",
  claudeExecutablePath: "chat.claudeCode.executablePath",
  claudeModel: "chat.claudeCode.model",
  claudeEffort: "chat.claudeCode.effort",
  claudeDefaultModel: "chat.claudeCode.defaultModel",
  claudeAvailableModels: "chat.claudeCode.availableModels",
  claudeAvailableModelsAt: "chat.claudeCode.availableModelsAt",
  claudeAvailableModelsFrom: "chat.claudeCode.availableModelsFrom",
  claudeLastConnectionStatus: "chat.claudeCode.lastConnectionStatus",
  claudeLastCheckedAt: "chat.claudeCode.lastCheckedAt",
  claudeRecentActivities: "chat.claudeCode.permissions.recentActivities",
  claudeTrainingMetrics: "chat.claudeCode.permissions.trainingMetrics",
  claudeUpcomingWorkouts: "chat.claudeCode.permissions.upcomingWorkouts",
  claudeSleepData: "chat.claudeCode.permissions.sleepData",
  claudeFullActivityFiles: "chat.claudeCode.permissions.fullActivityFiles",
  localBaseUrl: "chat.local.baseUrl",
  localModel: "chat.local.model",
  localApiKey: "chat.local.apiKey",
  localToolsEnabled: "chat.local.toolsEnabled",
  sidebarOpen: "chat.sidebar.open",
  visualizationsEnabled: "chat.visualizations.enabled",
  customInstructions: "chat.customInstructions",
  inlineSuggestions: "chat.coach.inlineSuggestions",
  coachStyle: "chat.coach.style",
  compactContextEnabled: "chat.compactContext.enabled",
  compactContextLimit: "chat.compactContext.limit",
  compactContextKeep: "chat.compactContext.keep",
  compactContextDetail: "chat.compactContext.detail",
  compactContextModel: "chat.compactContext.model"
} as const;

function inlineSuggestionsMode(value: unknown): InlineSuggestionsMode {
  return value === "on" || value === "off" ? value : "auto";
}

/** Whether a turn by `provider` may attach workout cards it was not asked for (P1.9). */
export function inlineSuggestionsEnabled(
  mode: InlineSuggestionsMode | undefined,
  provider: ChatProvider
): boolean {
  if (mode === "on") return true;
  if (mode === "off") return false;
  return provider === "claude-code" || provider === "claude-api";
}

export interface ChatSettingsStore {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
  delete(keys: string[]): void;
}

export interface ChatApiKeyStore {
  hasApiKey(): boolean;
  saveApiKey(apiKey: string): void;
  clearApiKey(): void;
}

/** One encrypted key store per provider that needs a bring-your-own-key secret. */
export interface ChatApiKeyStores {
  local: ChatApiKeyStore;
  anthropic: ChatApiKeyStore;
  openRouter: ChatApiKeyStore;
}

export function readChatSettingsFromStore(
  store: ChatSettingsStore,
  apiKeyStores: {
    local: Pick<ChatApiKeyStore, "hasApiKey">;
    anthropic: Pick<ChatApiKeyStore, "hasApiKey">;
    openRouter: Pick<ChatApiKeyStore, "hasApiKey">;
  }
): ChatSettings {
  return {
    provider: normalizeProvider(store.get(CHAT_SETTINGS_KEYS.provider)),
    chatgpt: {
      model: store.get(CHAT_SETTINGS_KEYS.chatgptModel) || undefined
    },
    openRouter: {
      model:
        store.get(CHAT_SETTINGS_KEYS.openRouterModel) ??
        DEFAULT_OPENROUTER_MODEL,
      hasApiKey: apiKeyStores.openRouter.hasApiKey()
    },
    anthropic: {
      model:
        store.get(CHAT_SETTINGS_KEYS.anthropicModel) || DEFAULT_ANTHROPIC_MODEL,
      effort: normalizeAnthropicEffort(
        store.get(CHAT_SETTINGS_KEYS.anthropicEffort)
      ),
      hasApiKey: apiKeyStores.anthropic.hasApiKey()
    },
    claudeCode: {
      executablePath:
        store.get(CHAT_SETTINGS_KEYS.claudeExecutablePath) || undefined,
      model: store.get(CHAT_SETTINGS_KEYS.claudeModel) || undefined,
      effort: normalizeAnthropicEffort(store.get(CHAT_SETTINGS_KEYS.claudeEffort)),
      defaultModel:
        store.get(CHAT_SETTINGS_KEYS.claudeDefaultModel) || undefined,
      availableModels: parseModelOptions(
        store.get(CHAT_SETTINGS_KEYS.claudeAvailableModels)
      ),
      availableModelsAt:
        store.get(CHAT_SETTINGS_KEYS.claudeAvailableModelsAt) || undefined,
      availableModelsFrom:
        store.get(CHAT_SETTINGS_KEYS.claudeAvailableModelsFrom) || undefined,
      lastConnectionStatus: normalizeClaudeConnectionStatus(
        store.get(CHAT_SETTINGS_KEYS.claudeLastConnectionStatus)
      ),
      lastCheckedAt:
        store.get(CHAT_SETTINGS_KEYS.claudeLastCheckedAt) || undefined,
      permissions: {
        recentActivities:
          store.get(CHAT_SETTINGS_KEYS.claudeRecentActivities) !== "false",
        trainingMetrics:
          store.get(CHAT_SETTINGS_KEYS.claudeTrainingMetrics) !== "false",
        upcomingWorkouts:
          store.get(CHAT_SETTINGS_KEYS.claudeUpcomingWorkouts) !== "false",
        sleepData:
          store.get(CHAT_SETTINGS_KEYS.claudeSleepData) === "true",
        fullActivityFiles:
          store.get(CHAT_SETTINGS_KEYS.claudeFullActivityFiles) === "true"
      }
    },
    local: {
      baseUrl:
        store.get(CHAT_SETTINGS_KEYS.localBaseUrl) ?? DEFAULT_LOCAL_CHAT_BASE_URL,
      model: store.get(CHAT_SETTINGS_KEYS.localModel) ?? "",
      hasApiKey: apiKeyStores.local.hasApiKey(),
      toolsEnabled: store.get(CHAT_SETTINGS_KEYS.localToolsEnabled) !== "false"
    },
    modelCatalogs: readModelCatalogs(store),
    sidebarOpen: store.get(CHAT_SETTINGS_KEYS.sidebarOpen) !== "false",
    visualizationsEnabled:
      store.get(CHAT_SETTINGS_KEYS.visualizationsEnabled) === "true",
    customInstructions:
      store.get(CHAT_SETTINGS_KEYS.customInstructions) || undefined,
    inlineSuggestions: inlineSuggestionsMode(store.get(CHAT_SETTINGS_KEYS.inlineSuggestions)),
    coachStyle: normalizeCoachStyle(store.get(CHAT_SETTINGS_KEYS.coachStyle)),
    compactContext: {
      // Defaults on. A conversation nobody compacts grows without bound, and
      // the athlete who would notice the bill is the one least likely to go
      // looking for a setting that would have prevented it.
      enabled: store.get(CHAT_SETTINGS_KEYS.compactContextEnabled) !== "false",
      // A stored pair is read through the same normaliser a typed one is: a
      // half-written pair — one key set by an older version, the other absent —
      // must not resolve to a window where `keep` exceeds `limit`.
      ...normalizeContextWindow({
        limit: readNumber(store.get(CHAT_SETTINGS_KEYS.compactContextLimit)),
        keep: readNumber(store.get(CHAT_SETTINGS_KEYS.compactContextKeep))
      }),
      detail: normalizeContextDetail(store.get(CHAT_SETTINGS_KEYS.compactContextDetail)),
      model: normalizeCompactModelChoice(store.get(CHAT_SETTINGS_KEYS.compactContextModel))
    }
  };
}

/** Every provider list that has been read and can still be parsed. */
function readModelCatalogs(store: ChatSettingsStore): ChatSettings["modelCatalogs"] {
  const catalogs: NonNullable<ChatSettings["modelCatalogs"]> = {};
  for (const provider of CATALOG_PROVIDERS) {
    const catalog = parseStoredCatalog(store.get(MODEL_CATALOG_KEYS[provider]));
    if (catalog) catalogs[provider] = catalog;
  }
  return catalogs;
}

/** Undefined rather than NaN, so `normalizeContextWindow` falls back cleanly. */
function readNumber(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

export function saveChatSettingsToStore(
  store: ChatSettingsStore,
  apiKeyStores: ChatApiKeyStores,
  settings: ChatSettings
): ChatSettings {
  store.set(CHAT_SETTINGS_KEYS.provider, normalizeProvider(settings.provider));
  const chatgptModel = settings.chatgpt?.model?.trim();
  if (chatgptModel) {
    store.set(CHAT_SETTINGS_KEYS.chatgptModel, chatgptModel);
  } else {
    store.delete([CHAT_SETTINGS_KEYS.chatgptModel]);
  }
  const openRouterModel = settings.openRouter?.model?.trim();
  store.set(
    CHAT_SETTINGS_KEYS.openRouterModel,
    openRouterModel || DEFAULT_OPENROUTER_MODEL
  );
  store.set(
    CHAT_SETTINGS_KEYS.anthropicModel,
    settings.anthropic.model.trim() || DEFAULT_ANTHROPIC_MODEL
  );
  store.set(
    CHAT_SETTINGS_KEYS.anthropicEffort,
    normalizeAnthropicEffort(settings.anthropic.effort)
  );
  const executablePath = settings.claudeCode?.executablePath?.trim();
  if (executablePath) {
    store.set(CHAT_SETTINGS_KEYS.claudeExecutablePath, executablePath);
  } else {
    store.delete([CHAT_SETTINGS_KEYS.claudeExecutablePath]);
  }
  store.set(
    CHAT_SETTINGS_KEYS.claudeEffort,
    normalizeAnthropicEffort(settings.claudeCode?.effort)
  );
  const availableModels = settings.claudeCode?.availableModels;
  if (availableModels?.length) {
    store.set(
      CHAT_SETTINGS_KEYS.claudeAvailableModels,
      JSON.stringify(availableModels)
    );
  } else {
    store.delete([CHAT_SETTINGS_KEYS.claudeAvailableModels]);
  }
  // `modelCatalogs`, and when and from which CLI Claude Code's list was read,
  // are deliberately not written here: a window's copy of them is whatever it
  // last read, and saving a setting must not put an older answer back over one
  // the main process has just read (`refreshModelCatalogs`,
  // `readClaudeCodeModels`, which write them itself).
  const claudeDefaultModel = settings.claudeCode?.defaultModel?.trim();
  if (claudeDefaultModel) {
    store.set(CHAT_SETTINGS_KEYS.claudeDefaultModel, claudeDefaultModel);
  } else {
    store.delete([CHAT_SETTINGS_KEYS.claudeDefaultModel]);
  }
  const claudeModel = settings.claudeCode?.model?.trim();
  if (claudeModel) {
    store.set(CHAT_SETTINGS_KEYS.claudeModel, claudeModel);
  } else {
    store.delete([CHAT_SETTINGS_KEYS.claudeModel]);
  }
  if (settings.claudeCode?.lastConnectionStatus) {
    store.set(
      CHAT_SETTINGS_KEYS.claudeLastConnectionStatus,
      settings.claudeCode.lastConnectionStatus
    );
  }
  if (settings.claudeCode?.lastCheckedAt) {
    store.set(
      CHAT_SETTINGS_KEYS.claudeLastCheckedAt,
      settings.claudeCode.lastCheckedAt
    );
  }
  const claudePermissions = settings.claudeCode?.permissions;
  store.set(
    CHAT_SETTINGS_KEYS.claudeRecentActivities,
    claudePermissions?.recentActivities === false ? "false" : "true"
  );
  store.set(
    CHAT_SETTINGS_KEYS.claudeTrainingMetrics,
    claudePermissions?.trainingMetrics === false ? "false" : "true"
  );
  store.set(
    CHAT_SETTINGS_KEYS.claudeUpcomingWorkouts,
    claudePermissions?.upcomingWorkouts === false ? "false" : "true"
  );
  store.set(
    CHAT_SETTINGS_KEYS.claudeSleepData,
    claudePermissions?.sleepData === true ? "true" : "false"
  );
  store.set(
    CHAT_SETTINGS_KEYS.claudeFullActivityFiles,
    claudePermissions?.fullActivityFiles === true ? "true" : "false"
  );
  store.set(
    CHAT_SETTINGS_KEYS.localBaseUrl,
    normalizeLocalChatBaseUrl(settings.local.baseUrl)
  );
  store.set(CHAT_SETTINGS_KEYS.localModel, settings.local.model.trim());
  store.set(
    CHAT_SETTINGS_KEYS.localToolsEnabled,
    settings.local.toolsEnabled ? "true" : "false"
  );
  if (typeof settings.sidebarOpen === "boolean") {
    store.set(
      CHAT_SETTINGS_KEYS.sidebarOpen,
      settings.sidebarOpen ? "true" : "false"
    );
  }
  if (settings.inlineSuggestions !== undefined) {
    store.set(CHAT_SETTINGS_KEYS.inlineSuggestions, inlineSuggestionsMode(settings.inlineSuggestions));
  }
  if (settings.coachStyle !== undefined) {
    store.set(CHAT_SETTINGS_KEYS.coachStyle, normalizeCoachStyle(settings.coachStyle));
  }
  if (typeof settings.visualizationsEnabled === "boolean") {
    store.set(
      CHAT_SETTINGS_KEYS.visualizationsEnabled,
      settings.visualizationsEnabled ? "true" : "false"
    );
  }

  if (settings.compactContext) {
    store.set(
      CHAT_SETTINGS_KEYS.compactContextEnabled,
      settings.compactContext.enabled === false ? "false" : "true"
    );
    // Clamped on the way in as well as on the way out. The renderer's number
    // inputs are the only writer today, and "the only writer today" is exactly
    // the assumption that stops being true without anybody noticing.
    const window = normalizeContextWindow(settings.compactContext);
    store.set(CHAT_SETTINGS_KEYS.compactContextLimit, String(window.limit));
    store.set(CHAT_SETTINGS_KEYS.compactContextKeep, String(window.keep));
    if (settings.compactContext.detail !== undefined) {
      store.set(CHAT_SETTINGS_KEYS.compactContextDetail, normalizeContextDetail(settings.compactContext.detail));
    }
    if (settings.compactContext.model !== undefined) {
      store.set(
        CHAT_SETTINGS_KEYS.compactContextModel,
        serializeCompactModelChoice(normalizeCompactModelChoice(settings.compactContext.model))
      );
    }
  }

  if (typeof settings.customInstructions === "string") {
    const customInstructions = settings.customInstructions
      .trim()
      .slice(0, MAX_CUSTOM_COACH_INSTRUCTIONS);
    if (customInstructions) {
      store.set(CHAT_SETTINGS_KEYS.customInstructions, customInstructions);
    } else {
      store.delete([CHAT_SETTINGS_KEYS.customInstructions]);
    }
  }

  if (settings.local.clearApiKey) {
    apiKeyStores.local.clearApiKey();
  } else if (
    typeof settings.local.apiKey === "string" &&
    settings.local.apiKey.trim()
  ) {
    apiKeyStores.local.saveApiKey(settings.local.apiKey.trim());
  }

  // A list read with a key describes that key's account, so it goes with it.
  if (settings.anthropic.clearApiKey) {
    apiKeyStores.anthropic.clearApiKey();
    store.delete([MODEL_CATALOG_KEYS["claude-api"]]);
  } else if (
    typeof settings.anthropic.apiKey === "string" &&
    settings.anthropic.apiKey.trim()
  ) {
    apiKeyStores.anthropic.saveApiKey(settings.anthropic.apiKey.trim());
  }

  if (settings.openRouter?.clearApiKey) {
    apiKeyStores.openRouter.clearApiKey();
    store.delete([MODEL_CATALOG_KEYS.openrouter]);
  } else if (
    typeof settings.openRouter?.apiKey === "string" &&
    settings.openRouter.apiKey.trim()
  ) {
    apiKeyStores.openRouter.saveApiKey(settings.openRouter.apiKey.trim());
  }

  return readChatSettingsFromStore(store, apiKeyStores);
}

/** Tolerates a corrupt or older payload by falling back to the static list. */
function parseModelOptions(
  raw: string | undefined
): ChatSettings["claudeCode"]["availableModels"] {
  if (!raw) return undefined;
  try {
    // The CLI's `default` row is the empty value, so an empty id is kept
    // here where the other lists drop it.
    const rows = parseCatalogEntries(JSON.parse(raw), { keepEmptyValue: true });
    return rows.length > 0 ? rows : undefined;
  } catch {
    return undefined;
  }
}

function normalizeAnthropicEffort(value: unknown): AnthropicEffort {
  return value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh" ||
    value === "max"
    ? value
    : DEFAULT_ANTHROPIC_EFFORT;
}

function normalizeProvider(value: unknown): ChatProvider {
  if (
    value === "local" ||
    value === "claude-code" ||
    value === "claude-api" ||
    value === "openrouter"
  ) {
    return value;
  }
  return "chatgpt";
}

function normalizeClaudeConnectionStatus(
  value: unknown
): ChatSettings["claudeCode"]["lastConnectionStatus"] {
  return value === "not-installed" ||
    value === "sign-in-required" ||
    value === "connecting" ||
    value === "connected" ||
    value === "connection-failed" ||
    value === "usage-limit-reached"
    ? value
    : undefined;
}
