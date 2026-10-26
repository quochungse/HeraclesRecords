// Run the actual ChatGPT streaming path with a temporary database, dummy
// credentials and a stubbed network. Assert what crosses the provider boundary.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Module = require("node:module");
const originalLoad = Module._load;
const root = path.resolve(import.meta.dirname, "..");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-effort-"));
Module._load = function (name, ...args) {
  if (name === "electron") return {
    BrowserWindow: class {},
    app: { getPath: () => temporary, getVersion: () => "test", on() {}, whenReady: () => Promise.resolve() },
    safeStorage: { isEncryptionAvailable: () => true, decryptString: (buffer) => buffer.toString() },
    shell: { openExternal() {} }
  };
  return originalLoad.call(this, name, ...args);
};
const database = require(path.join(root, "dist-electron/database.js"));
const chat = require(path.join(root, "dist-electron/chatService.js"));
const { MODEL_CATALOG_KEYS, parseCodexModels, serializeCatalog } = require(path.join(root, "dist-electron/modelCatalog.js"));
const { runtimeOver } = require(path.join(root, "dist-electron/chatModels.js"));
const { resolveCompressionRuntime } = require(path.join(root, "dist-electron/chatCompression.js"));
database.initializeDatabase(temporary);
database.setSetting("chat.oauthToken", Buffer.from(JSON.stringify({
  access_token: "dummy-token", refresh_token: "dummy-refresh", expires_at: Math.floor(Date.now() / 1000) + 3600
})).toString("base64"));
database.setSetting("chat.provider", "chatgpt");
database.setSetting("chat.chatgpt.model", "gpt-saved");
database.setSetting("chat.chatgpt.effort", "saved-depth");
const models = parseCodexModels({ models: [
  { slug: "gpt-saved", supported_reasoning_levels: [{ effort: "saved-depth", description: "Saved" }] },
  { slug: "gpt-override", default_reasoning_level: "future-depth",
    supported_reasoning_levels: [{ effort: "future-depth", description: "Future" }, { effort: "none" }] }
] });
database.setSetting(MODEL_CATALOG_KEYS.chatgpt, serializeCatalog(models));

let requests = [];
let rejectSummary = false;
let rejectSavedModel = false;
globalThis.fetch = async (url, init) => {
  assert.equal(url, "https://chatgpt.com/backend-api/codex/responses", "no external request escapes the stub");
  const body = JSON.parse(init.body);
  requests.push(body);
  if (rejectSavedModel && body.model === "gpt-saved") return new Response("model is not supported", { status: 400 });
  if (rejectSummary && body.reasoning?.summary) return new Response("reasoning summary unsupported", { status: 400 });
  return new Response('data: {"type":"response.output_text.delta","delta":"Ready"}\n\ndata: {"type":"response.completed","response":{}}\n\n', {
    headers: { "Content-Type": "text/event-stream" }
  });
};
async function run(runtime = {}) {
  requests = [];
  const events = [];
  await chat.streamChat({ emit: (channel, payload) => events.push({ channel, payload }) },
    `effort-${Date.now()}`, [{ role: "user", content: "Test reasoning" }], {
      runtime, toolPolicy: "none", textJob: { system: "Reply briefly" }
    });
  assert.equal(events.some((event) => event.channel === "chat:streamDone"), true, JSON.stringify(events));
  assert.equal(events.some((event) => event.channel === "chat:streamError"), false);
  return requests;
}

assert.equal((await run())[0].reasoning.effort, "saved-depth", "provider default effort reaches inference");
const override = (await run({ model: "gpt-override", effort: "future-depth" }))[0];
assert.equal(override.model, "gpt-override", "the conversation model override is honoured");
assert.equal(override.reasoning.effort, "future-depth", "a level not known to the app reaches inference");
assert.equal((await run({ model: "gpt-override", effort: "none" }))[0].reasoning.effort, "none");
for (const effort of ["", "retired-level"]) {
  assert.equal("effort" in (await run({ model: "gpt-override", effort }))[0].reasoning, false,
    "Auto and unsupported levels leave the server's default intact");
}
assert.equal("effort" in (await run({ model: "gpt-missing", effort: "future-depth" }))[0].reasoning, false,
  "missing metadata never invents supported levels");
rejectSummary = true;
const retry = await run({ model: "gpt-override", effort: "future-depth" });
assert.equal(retry.length, 2);
assert.deepEqual(retry[1].reasoning, { effort: "future-depth" }, "summary fallback keeps the requested effort");
rejectSummary = false;
rejectSavedModel = true;
database.setSetting("chat.model", "gpt-saved");
const fallback = await run({ model: "", effort: "saved-depth" });
assert.equal(fallback.at(-1).model, "gpt-override");
assert.equal("effort" in fallback.at(-1).reasoning, false, "Auto revalidates effort for each actual model candidate");
rejectSavedModel = false;
database.setSetting("chat.model", "gpt-override");
const auto = { provider: "chatgpt", model: "", effort: "" };
const inherited = runtimeOver({}, auto);
assert.equal((await run(inherited))[0].model, "gpt-override",
  "an analysis inheriting Auto must not fall back to the provider's explicitly saved model");
const compression = resolveCompressionRuntime(undefined, auto, {
  ...chat.getChatSettings(), compactContext: { enabled: true, model: { kind: "conversation" } }
});
assert.deepEqual(compression.runtime, { ...auto, effort: "low" },
  "conversation-model compression preserves Auto through to the provider request");
assert.equal((await run(compression.runtime))[0].model, "gpt-override");
console.log("ChatGPT effort OK — dynamic metadata, saved settings, runtime overrides, defaults, summary retry, Auto fallback");
database.closeDatabase();
fs.rmSync(temporary, { recursive: true, force: true });
process.exit(0);
