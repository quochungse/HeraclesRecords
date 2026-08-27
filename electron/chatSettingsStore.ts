import type { AnthropicEffort, ChatProvider, ChatSettings } from "./types";
import { MAX_CUSTOM_COACH_INSTRUCTIONS } from "./types";
import {
  DEFAULT_LOCAL_CHAT_BASE_URL,
  normalizeLocalChatBaseUrl
} from "./localChatProvider";
import { DEFAULT_OPENROUTER_MODEL } from "./openRouterProvider";
import {
  DEFAULT_ANTHROPIC_EFFORT,
  DEFAULT_ANTHROPIC_MODEL
} from "./anthropicChatProvider";

export const CHAT_SETTINGS_KEYS = {
  provider: "chat.provider",
  chatgptModel: "chat.chatgpt.model",
  openRouterModel: "chat.openRouter.model",
  openRouterApiKey: "chat.openRouter.apiKey",
  anthropicModel: "chat.anthropic.model",
  anthropicEffort: "chat.anthropic.effort",
  anthropicApiKey: "chat.anthropic.apiKey",
  claudeExecutablePath: "chat.claudeCode.executablePath",
  claudeUseAppScopedAuth: "chat.claudeCode.useAppScopedAuth",
  claudeModel: "chat.claudeCode.model",
  claudeEffort: "chat.claudeCode.effort",
  claudeDefaultModel: "chat.claudeCode.defaultModel",
  claudeAvailableModels: "chat.claudeCode.availableModels",
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
  customInstructions: "chat.customInstructions"
} as const;

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
      // Defaults on: the app should not silently use another account's login.
      useAppScopedAuth:
        store.get(CHAT_SETTINGS_KEYS.claudeUseAppScopedAuth) !== "false",
      model: store.get(CHAT_SETTINGS_KEYS.claudeModel) || undefined,
      effort: normalizeAnthropicEffort(store.get(CHAT_SETTINGS_KEYS.claudeEffort)),
      defaultModel:
        store.get(CHAT_SETTINGS_KEYS.claudeDefaultModel) || undefined,
      availableModels: parseModelOptions(
        store.get(CHAT_SETTINGS_KEYS.claudeAvailableModels)
      ),
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
    sidebarOpen: store.get(CHAT_SETTINGS_KEYS.sidebarOpen) !== "false",
    visualizationsEnabled:
      store.get(CHAT_SETTINGS_KEYS.visualizationsEnabled) === "true",
    customInstructions:
      store.get(CHAT_SETTINGS_KEYS.customInstructions) || undefined
  };
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
    CHAT_SETTINGS_KEYS.claudeUseAppScopedAuth,
    settings.claudeCode?.useAppScopedAuth === false ? "false" : "true"
  );
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
  if (typeof settings.visualizationsEnabled === "boolean") {
    store.set(
      CHAT_SETTINGS_KEYS.visualizationsEnabled,
      settings.visualizationsEnabled ? "true" : "false"
    );
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

  if (settings.anthropic.clearApiKey) {
    apiKeyStores.anthropic.clearApiKey();
  } else if (
    typeof settings.anthropic.apiKey === "string" &&
    settings.anthropic.apiKey.trim()
  ) {
    apiKeyStores.anthropic.saveApiKey(settings.anthropic.apiKey.trim());
  }

  if (settings.openRouter?.clearApiKey) {
    apiKeyStores.openRouter.clearApiKey();
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
): Array<{ value: string; label: string }> | undefined {
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return undefined;
    const rows = parsed.filter(
      (row): row is { value: string; label: string } =>
        typeof row === "object" &&
        row !== null &&
        typeof (row as { value?: unknown }).value === "string" &&
        typeof (row as { label?: unknown }).label === "string"
    );
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
