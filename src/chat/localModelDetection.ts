import type {
  ChatSettings,
  LocalChatConnectionTest,
  LocalChatDiscovery
} from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";

export interface LocalDetectionResult {
  /** Every server probed, which is what fills the server and model pickers. */
  discovery: LocalChatDiscovery;
  /** Settings as persisted, when a usable server was adopted. */
  settings?: ChatSettings;
  /** What to show under the Local model section either way. */
  connection: LocalChatConnectionTest;
}

/**
 * Find a running Ollama or LM Studio server, adopt it, and persist the choice.
 *
 * Shared because two callers need the same behaviour and neither owns the
 * other: the Coach Models dialog runs it from its Detect button, and Coach runs
 * it once at startup when the athlete is on the local provider with no model
 * chosen yet. Duplicating it would let the two drift on which server wins.
 */
export async function detectAndAdoptLocalServer(
  api: CorosLinkApi,
  chatSettings: ChatSettings,
  apiKeyDraft: string
): Promise<LocalDetectionResult> {
  const discovery = await api.detectLocalChatServers(
    apiKeyDraft.trim() || undefined
  );
  const available = discovery.servers.filter(
    (server) => server.ok && server.models.length > 0
  );

  if (available.length === 0) {
    const runningEmpty = discovery.servers.filter((server) => server.ok);
    return {
      discovery,
      connection: {
        ok: false,
        message:
          runningEmpty.length > 0
            ? `${runningEmpty.map((server) => server.label).join(" and ")} ${runningEmpty.length === 1 ? "is" : "are"} running, but no models were found. Pull an Ollama model or load a model in LM Studio, then detect again.`
            : "No Ollama or LM Studio server found on localhost ports 11434 or 1234."
      }
    };
  }

  // Prefer the server already configured, and within it the model already
  // chosen, so detecting again does not silently move the athlete elsewhere.
  const currentBaseUrl = chatSettings.local.baseUrl;
  const currentModel = chatSettings.local.model;
  const preferred =
    available.find(
      (server) =>
        server.baseUrl === currentBaseUrl && server.models.includes(currentModel)
    ) ??
    available.find((server) => server.baseUrl === currentBaseUrl) ??
    available[0]!;
  const model = preferred.models.includes(currentModel)
    ? currentModel
    : preferred.models[0]!;

  const apiKey = apiKeyDraft.trim();
  const settings = await api.saveChatSettings({
    ...chatSettings,
    provider: "local",
    local: {
      ...chatSettings.local,
      baseUrl: preferred.baseUrl,
      model,
      apiKey: apiKey || undefined
    }
  });

  return {
    discovery,
    settings,
    connection: {
      ok: true,
      message: `Detected ${preferred.label} with ${preferred.models.length} model${preferred.models.length === 1 ? "" : "s"}.`,
      normalizedBaseUrl: preferred.baseUrl,
      models: preferred.models
    }
  };
}
