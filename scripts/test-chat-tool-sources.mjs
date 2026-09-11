import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

// The source badge under a coach answer: DB, Coros or MCP per tool. It used to
// say "MCP" for every call, so one Training Hub read looked like an MCP turn.

const repoRoot = path.resolve(import.meta.dirname, "..");
const load = (file) =>
  import(
    `${pathToFileURL(path.join(repoRoot, "dist-electron", file)).href}?cacheBust=${Date.now()}`
  );

const { LOCAL_CHAT_TOOL_SOURCES, chatToolSource, groupChatToolsBySource } =
  await load("chatToolSources.js");
const { CHAT_ACTIVITY_TOOL_NAMES } = await load("chatActivityTools.js");
const { CHAT_ANALYTICS_TOOL_NAMES } = await load("chatAnalyticsTools.js");
const { CHAT_SLEEP_TOOL_NAMES } = await load("chatSleepTools.js");
const { CHAT_WORKOUT_TOOL_NAMES } = await load("chatWorkoutTools.js");
const { CHAT_INTERACTION_TOOL_NAMES } = await load("chatInteractionTools.js");

// --- every local tool is placed -------------------------------------------
// An unlisted local tool falls through to the MCP label, which is exactly the
// mislabel this exists to end — so a new tool fails here until it is placed.
const localTools = [
  ...CHAT_ACTIVITY_TOOL_NAMES,
  ...CHAT_ANALYTICS_TOOL_NAMES,
  ...CHAT_SLEEP_TOOL_NAMES,
  ...CHAT_WORKOUT_TOOL_NAMES,
  ...CHAT_INTERACTION_TOOL_NAMES
];
for (const name of localTools) {
  assert.ok(LOCAL_CHAT_TOOL_SOURCES.has(name), `${name} has no source in chatToolSources`);
  // MCP names are recognised by what they are not, which only holds while no
  // local name looks like a prefixed one.
  assert.ok(!name.includes("__"), `${name} would read as an MCP server's tool`);
}
// Nothing listed that no longer exists, except renamed tools old transcripts carry.
const legacy = new Set(["get_hr_zone_summary"]);
for (const name of LOCAL_CHAT_TOOL_SOURCES.keys()) {
  assert.ok(
    localTools.includes(name) || legacy.has(name),
    `${name} is listed but is not a local tool`
  );
}

// --- grouping ---------------------------------------------------------------
// The turn that raised this: one activity and the schedule, both read straight
// from the Training Hub API, with no MCP server involved.
assert.deepEqual(groupChatToolsBySource(["get_activity_detail", "list_scheduled_workouts"]), [
  {
    source: "coros",
    label: "Coros",
    tools: ["get_activity_detail", "list_scheduled_workouts"]
  }
]);

// All three, nearest first; each tool once however often it ran; tools that
// read nothing stay off.
assert.deepEqual(
  groupChatToolsBySource([
    "coros__queryDailyStress",
    "get_activity_detail",
    "get_sleep_summary",
    "get_activity_detail",
    "request_coach_input",
    "draft_workout",
    ""
  ]).map(({ label, tools }) => `${label}: ${tools.join(", ")}`),
  ["DB: get_sleep_summary", "Coros: get_activity_detail", "MCP: coros__queryDailyStress"]
);
assert.deepEqual(groupChatToolsBySource(["request_coach_input", "draft_training_plan"]), []);
assert.deepEqual(groupChatToolsBySource([]), []);

// Names from older transcripts: the renamed zone tool is still a COROS read,
// and an unknown name keeps the MCP label every tool used to wear.
assert.equal(chatToolSource("get_hr_zone_summary"), "coros");
assert.equal(chatToolSource("queryActivities"), "mcp");
// A Map, not an object literal: no prototype key can pass for a local tool.
assert.equal(chatToolSource("constructor"), "mcp");
assert.equal(chatToolSource("toString"), "mcp");

console.log("chat tool source tests passed");
