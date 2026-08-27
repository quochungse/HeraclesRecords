import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const groupsUrl = pathToFileURL(
  path.join(repoRoot, "src", "chat", "chatSessionGroups.ts")
);

const { groupChatSessions } = await import(
  `${groupsUrl.href}?cacheBust=${Date.now()}`
);

const now = new Date();
const isoDaysAgo = (days) =>
  new Date(now.getTime() - days * 86_400_000).toISOString();

const session = (id, updatedAt, pinnedAt = null) => ({
  id,
  provider: "chatgpt",
  title: id,
  preview: "",
  updatedAt,
  createdAt: updatedAt,
  messageCount: 1,
  pinnedAt
});

// No pins: the date buckets are unchanged.
assert.deepEqual(
  groupChatSessions([
    session("today", isoDaysAgo(0)),
    session("yesterday", isoDaysAgo(1)),
    session("this-week", isoDaysAgo(3)),
    session("ancient", isoDaysAgo(60))
  ]).map((group) => [group.label, group.sessions.map((entry) => entry.id)]),
  [
    ["Today", ["today"]],
    ["Yesterday", ["yesterday"]],
    ["Previous 7 days", ["this-week"]],
    ["Older", ["ancient"]]
  ]
);

// Pinned sessions leave their date bucket and lead the list, newest pin first.
const withPins = groupChatSessions([
  session("today", isoDaysAgo(0)),
  session("pinned-old-chat", isoDaysAgo(40), isoDaysAgo(5)),
  session("yesterday", isoDaysAgo(1)),
  session("pinned-recently", isoDaysAgo(30), isoDaysAgo(1))
]);
assert.deepEqual(
  withPins.map((group) => [group.label, group.sessions.map((entry) => entry.id)]),
  [
    ["Pinned", ["pinned-recently", "pinned-old-chat"]],
    ["Today", ["today"]],
    ["Yesterday", ["yesterday"]]
  ]
);

// Equal pin timestamps fall back to the most recently updated conversation.
const tie = isoDaysAgo(2);
assert.deepEqual(
  groupChatSessions([
    session("stale", isoDaysAgo(9), tie),
    session("fresh", isoDaysAgo(0), tie)
  ])[0].sessions.map((entry) => entry.id),
  ["fresh", "stale"]
);

// An empty pinned group is dropped rather than rendered as a bare heading.
assert.deepEqual(
  groupChatSessions([]).map((group) => group.label),
  []
);

console.log("chat session group tests passed");
