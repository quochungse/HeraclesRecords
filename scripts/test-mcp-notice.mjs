/**
 * The MCP notices point at a screen this file cannot see, `undefined` must not
 * read as a failure, and "not connected" must not be said of a server that is.
 * All three are invariants the compiler misses.
 *
 * What the flag behind them does is asserted where it lives, against real
 * behaviour — see `test:sleep-history-cache` and `test:sleep-series-cache`.
 * Which components carry a notice is the compiler's job: they take the flag off
 * the payload they already receive, so a missing one is a type error.
 *
 * Runs under Electron because this machine's Node has no Amaro.
 *
 * Run: npm run test:mcp-notice
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  MCP_CONNECT_HINT,
  MCP_CONNECT_LOCATION,
  MCP_DAILY_HEALTH_SUBJECT,
  MCP_RETRY_HINT,
  MCP_SLEEP_SUBJECT,
  MCP_SLEEP_TREND_SUBJECT,
  MCP_UNAVAILABLE_SHORT,
  MCP_UNREACHABLE_SHORT,
  isMcpFailure,
  mcpNotice,
  mcpShortTextOr,
  mcpTextOr,
  mcpTitleOr
} from "../src/mcp/mcpNotice.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFileSync(join(repoRoot, relative), "utf8");

const SUBJECTS = [
  MCP_SLEEP_SUBJECT,
  MCP_SLEEP_TREND_SUBJECT,
  MCP_DAILY_HEALTH_SUBJECT
];

for (const subject of SUBJECTS) {
  const disconnected = mcpNotice(subject, "disconnected");
  assert.ok(disconnected.endsWith(MCP_CONNECT_HINT), `"${disconnected}" must say where to go`);
  assert.ok(disconnected.includes("COROS MCP server"), `"${disconnected}" must name the cause`);

  // The whole point of the split: a server that *is* connected must not be
  // told to connect. This failed in three places against the boolean.
  const unreachable = mcpNotice(subject, "unreachable");
  assert.ok(unreachable.endsWith(MCP_RETRY_HINT), `"${unreachable}" must say what to try`);
  assert.ok(
    !unreachable.includes("is not connected"),
    `"${unreachable}" must not tell anyone to connect a server that is connected`
  );
  assert.ok(
    !unreachable.includes(MCP_CONNECT_HINT),
    `"${unreachable}" must not repeat the connect instruction`
  );

  assert.equal(mcpNotice(subject, "ready"), null, "a server that answered is not the cause");
  assert.equal(mcpNotice(subject, undefined), null, "an unanswered status blames nobody");
}

// The short forms ride under a banner that already gave the directions.
for (const short of [MCP_UNAVAILABLE_SHORT, MCP_UNREACHABLE_SHORT]) {
  assert.ok(short.includes("COROS MCP server"));
  assert.ok(!short.includes(MCP_CONNECT_LOCATION));
}
assert.notEqual(
  MCP_UNAVAILABLE_SHORT,
  MCP_UNREACHABLE_SHORT,
  "the two failures must not read the same in the short form either"
);

// The route the copy spells out, checked against the screens along it: the
// sidebar's label, then Settings' own headings.
const [view, ...rows] = MCP_CONNECT_LOCATION.split("→").map((part) => part.trim());
assert.ok(
  read("src/navigation/primaryNav.ts").includes(`label: "${view}"`),
  `no sidebar item is called "${view}" — MCP_CONNECT_LOCATION is stale`
);

// Both shapes count. A heading spells its label as element text; a row built
// from `SettingsNavRow` passes it as a prop, and the three rows in Connections
// were collapsed onto that component precisely so they could not drift apart.
// What this asserts is that Settings still names the place the copy sends
// people to — not which of the two ways it happens to say it today.
const settings = read("src/settings/SettingsView.tsx");
for (const row of rows) {
  assert.ok(
    settings.includes(`>${row}<`) || settings.includes(`"${row}"`),
    `SettingsView renders no "${row}" — MCP_CONNECT_LOCATION is stale`
  );
}

assert.equal(
  mcpTextOr("disconnected", MCP_SLEEP_SUBJECT, "fallback"),
  mcpNotice(MCP_SLEEP_SUBJECT, "disconnected")
);
assert.equal(mcpTextOr("ready", MCP_SLEEP_SUBJECT, "fallback"), "fallback");
assert.equal(
  mcpTextOr(undefined, MCP_SLEEP_SUBJECT, "fallback"),
  "fallback",
  "an unanswered status must not tell anyone to connect anything"
);

assert.equal(
  mcpShortTextOr("disconnected", "No nights.", "fallback"),
  `No nights. ${MCP_UNAVAILABLE_SHORT}`
);
assert.equal(
  mcpShortTextOr("unreachable", "No nights.", "fallback"),
  `No nights. ${MCP_UNREACHABLE_SHORT}`
);
assert.equal(mcpShortTextOr("ready", "No nights.", "fallback"), "fallback");
assert.equal(mcpShortTextOr(undefined, "No nights.", "fallback"), "fallback");

assert.equal(mcpTitleOr("disconnected", "Sleep needs MCP", "fallback"), "Sleep needs MCP");
assert.notEqual(
  mcpTitleOr("unreachable", "Sleep needs MCP", "fallback"),
  "Sleep needs MCP",
  "a reachable-but-silent server gets its own heading"
);
assert.equal(mcpTitleOr("ready", "Sleep needs MCP", "fallback"), "fallback");
assert.equal(mcpTitleOr(undefined, "Sleep needs MCP", "fallback"), "fallback");

assert.equal(isMcpFailure("disconnected"), true);
assert.equal(isMcpFailure("unreachable"), true);
assert.equal(isMcpFailure("ready"), false);
assert.equal(isMcpFailure(undefined), false);

console.log("mcp notice tests passed");
