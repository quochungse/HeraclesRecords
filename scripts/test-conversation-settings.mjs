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

// Until changed: everything shared, Coach's AI, and no row at all.
const session = history.createChatSession("claude-code");
assert.deepEqual(chat.getConversationSettings(session.id), { sessionId: session.id, sources: everything });
assert.equal(database.getChatConversationSettingsRow(session.id), undefined);

// A source switched off and an AI chosen: kept for this conversation.
const set = chat.setConversationSettings({
  sessionId: session.id,
  sources: { activities: true, sleep: false, zones: true },
  runtime: { provider: "openrouter", model: "some/model" }
});
assert.deepEqual(set, {
  sessionId: session.id,
  sources: { activities: true, sleep: false, zones: true },
  runtime: { provider: "openrouter", model: "some/model" }
});
assert.ok(database.getChatConversationSettingsRow(session.id));

// Back to Coach's settings for everything: the row goes, so nothing is kept in step.
chat.setConversationSettings({ sessionId: session.id, sources: everything });
assert.equal(database.getChatConversationSettingsRow(session.id), undefined);

// An unreadable row shares everything, as if there were none.
database.saveChatConversationSettingsRow(session.id, "{not json", JSON.stringify({ provider: "nobody", effort: "high" }));
assert.deepEqual(chat.getConversationSettings(session.id), {
  sessionId: session.id,
  sources: everything,
  runtime: { effort: "high" }
});

// Deleting the conversation takes its settings with it.
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
assert.deepEqual(reach.context, { activities: false, zones: true, sleep: false, announce: true });

console.log("conversation settings tests passed");
process.exit(0);
