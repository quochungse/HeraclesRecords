// What one conversation reads and which AI answers it (docs/coach-plan-canvas.md,
// P2.0, D13/D14): stored per conversation, only where it differs from Coach's
// settings, gone with the conversation, and turned into the turn's reach.
//
// Runs under Electron for the better-sqlite3 ABI.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distUrl = (file) =>
  `${pathToFileURL(path.join(repoRoot, "dist-electron", file)).href}?cacheBust=${Date.now()}`;

const database = await import(distUrl("database.js"));
const chat = await import(distUrl("chatService.js"));
const history = await import(distUrl("chatHistoryStore.js"));

database.initializeDatabase(fs.mkdtempSync(path.join(os.tmpdir(), "conversation-settings-")));

const everything = { activities: true, sleep: true, zones: true };

// Legacy conversations: everything shared, their original provider, and no
// row at all (Q1 of the Coach Workbench review: a conversation keeps its AI).
const session = history.createChatSession("claude-code");
assert.deepEqual(chat.getConversationSettings(session.id), {
  sessionId: session.id,
  sources: everything,
  runtime: { provider: "claude-code" },
  web: false
});
assert.equal(database.getChatConversationSettingsRow(session.id), undefined);
// Its own provider goes without saying: stating it stores nothing.
chat.setConversationSettings({ sessionId: session.id, sources: everything, runtime: { provider: "claude-code" } });
assert.equal(database.getChatConversationSettingsRow(session.id), undefined, "no row for its own provider");
// Every conversation is listed, whichever provider it keeps.
history.createChatSession("openrouter");
assert.equal(chat.listAllChatSessions().length, 2, "the list is not split by provider");

// A source switched off and an AI chosen: kept for this conversation.
const set = chat.setConversationSettings({
  sessionId: session.id,
  sources: { activities: true, sleep: false, zones: true },
  runtime: { provider: "openrouter", model: "some/model" }
});
assert.deepEqual(set, {
  sessionId: session.id,
  sources: { activities: true, sleep: false, zones: true },
  runtime: { provider: "openrouter", model: "some/model" },
  web: false
});
assert.ok(database.getChatConversationSettingsRow(session.id));

// Back to Coach's settings for everything: the row goes, so nothing is kept in step.
chat.setConversationSettings({ sessionId: session.id, sources: everything });
assert.equal(database.getChatConversationSettingsRow(session.id), undefined);

// The web is off until switched on, and on is the only thing a row then holds.
const online = chat.setConversationSettings({ sessionId: session.id, sources: everything, web: true });
assert.equal(online.web, true);
assert.deepEqual(database.getChatConversationSettingsRow(session.id), { webSearch: true });
chat.setConversationSettings({ ...online, web: false });
assert.equal(database.getChatConversationSettingsRow(session.id), undefined, "back off, no row");

// An unreadable row shares everything, as if there were none.
database.saveChatConversationSettingsRow(session.id, "{not json", JSON.stringify({ provider: "nobody", effort: "high" }));
assert.deepEqual(chat.getConversationSettings(session.id), {
  sessionId: session.id,
  sources: everything,
  runtime: { effort: "high", provider: "claude-code" },
  web: false
});

// Deleting the conversation takes its settings with it.
const chatGptSession = history.createChatSession("chatgpt");
for (const effort of ["future-depth", ""]) {
  const saved = chat.setConversationSettings({ sessionId: chatGptSession.id, sources: everything,
    runtime: { model: "gpt-test", effort } });
  assert.equal(saved.runtime.effort, effort, "ChatGPT values and an explicit Auto survive storage");
}
chat.deleteChatSessionById(chatGptSession.id);

chat.setConversationSettings({ sessionId: session.id, sources: { activities: false, sleep: true, zones: true } });
chat.deleteChatSessionById(session.id);
assert.equal(database.getChatConversationSettingsRow(session.id), undefined);

// The reach a conversation's sources give a turn: nothing withheld, no reach.
assert.equal(chat.conversationReach(undefined), undefined);
assert.equal(chat.conversationReach(everything), undefined);
const reach = chat.conversationReach({ activities: false, sleep: false, zones: true });
assert.equal(reach.allow("get_sleep_summary"), false, "sleep's tool is not offered");
assert.equal(reach.allow("list_recent_activities"), false, "nor the activity list");
assert.equal(reach.allow("get_training_zones"), true, "zones are shared");
assert.equal(reach.allow("draft_workout"), true, "and writing is not reading");
assert.equal(reach.allow("strava__get_activities"), false, "another MCP server goes with anything withheld");
assert.equal(
  chat.conversationReach({ ...everything, zones: false }).allow("strava__get_activities"),
  false,
  "even a switch its tools have nothing to do with, since nothing says what they read"
);
assert.deepEqual(reach.context, { activities: false, zones: true, sleep: false, announce: true });

// New conversations inherit the most recently selected model/effort for their
// provider. Each conversation keeps a snapshot; no global settings are rewritten.
const lastUsedKey = (provider) => `chat.conversation.lastUsed.${provider}`;
database.deleteSettings([lastUsedKey("claude-code"), lastUsedKey("chatgpt"), lastUsedKey("openrouter")]);
database.setSetting("chat.claudeCode.model", "opus");
database.setSetting("chat.claudeCode.effort", "high");
const first = chat.createChatSessionForProvider("claude-code");
assert.deepEqual(chat.getConversationSettings(first.id).runtime, { provider: "claude-code", model: "opus", effort: "high" });
chat.setConversationSettings({ sessionId: first.id, sources: everything,
  runtime: { provider: "claude-code", model: "sonnet", effort: "low" } });
const second = chat.createChatSessionForProvider("claude-code");
assert.deepEqual(chat.getConversationSettings(second.id).runtime, { provider: "claude-code", model: "sonnet", effort: "low" });
chat.setConversationSettings({ sessionId: first.id, sources: everything,
  runtime: { provider: "claude-code", model: "opus", effort: "max" } });
assert.deepEqual(chat.getConversationSettings(second.id).runtime, { provider: "claude-code", model: "sonnet", effort: "low" },
  "a later selection in another chat does not alter an existing chat");
assert.equal(chat.getChatSettings().claudeCode.model, "opus");
assert.equal(chat.getChatSettings().claudeCode.effort, "high", "last-used preferences do not overwrite provider settings");
const latest = JSON.parse(database.getSetting(lastUsedKey("claude-code")));
assert.deepEqual(latest, { provider: "claude-code", model: "opus", effort: "max" }, "preference is persisted");
const secondSettings = chat.getConversationSettings(second.id);
chat.setConversationSettings({ ...secondSettings, sources: { ...everything, sleep: false }, web: true });
assert.deepEqual(JSON.parse(database.getSetting(lastUsedKey("claude-code"))), latest,
  "changing permissions does not overwrite the last model choice");
const third = chat.createChatSessionForProvider("claude-code");
assert.deepEqual(chat.getConversationSettings(third.id).runtime, latest);
assert.deepEqual(chat.getConversationSettings(third.id).sources, everything, "permissions are not copied from the last chat");
assert.equal(chat.getConversationSettings(third.id).web, false);

const gpt = chat.createChatSessionForProvider("chatgpt");
chat.setConversationSettings({ sessionId: gpt.id, sources: everything,
  runtime: { provider: "chatgpt", model: "gpt-test", effort: "future-depth" } });
const nextGpt = chat.createChatSessionForProvider("chatgpt");
assert.deepEqual(chat.getConversationSettings(nextGpt.id).runtime, { provider: "chatgpt", model: "gpt-test", effort: "future-depth" });
assert.deepEqual(chat.getConversationSettings(chat.createChatSessionForProvider("claude-code").id).runtime, latest,
  "providers remember independent choices");
chat.setConversationSettings({ ...chat.getConversationSettings(gpt.id), runtime: { provider: "chatgpt", model: "", effort: "" } });
assert.deepEqual(chat.getConversationSettings(chat.createChatSessionForProvider("chatgpt").id).runtime,
  { provider: "chatgpt", model: "", effort: "" }, "Auto model and effort survive in a new conversation");
chat.setConversationSettings({ ...chat.getConversationSettings(first.id), runtime: { provider: "claude-code", model: "", effort: "high" } });
assert.deepEqual(chat.getConversationSettings(chat.createChatSessionForProvider("claude-code").id).runtime,
  { provider: "claude-code", model: "", effort: "high" }, "explicit account default does not revert to the saved Opus model");

// Seed existing installations from the latest conversation's stored choice.
const legacy = history.createChatSession("openrouter");
database.saveChatConversationSettingsRow(legacy.id, null, JSON.stringify({ model: "some/recent-model" }));
assert.deepEqual(chat.getConversationSettings(chat.createChatSessionForProvider("openrouter").id).runtime,
  { provider: "openrouter", model: "some/recent-model" });
database.setSetting(lastUsedKey("openrouter"), "{invalid json");
assert.deepEqual(chat.getConversationSettings(chat.createChatSessionForProvider("openrouter").id).runtime,
  { provider: "openrouter", model: "some/recent-model" }, "an unreadable preference falls back to a stored conversation choice");

console.log("conversation settings tests passed");
process.exit(0);
