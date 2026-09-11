/**
 * The MCP notices point at a screen this file cannot see, and `undefined` must
 * not read as `false`. Both are invariants the compiler misses.
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
  MCP_DAILY_HEALTH_NOTICE,
  MCP_SLEEP_NOTICE,
  MCP_SLEEP_TREND_NOTICE,
  MCP_UNAVAILABLE_SHORT,
  mcpTextOr
} from "../src/mcp/mcpNotice.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFileSync(join(repoRoot, relative), "utf8");

for (const notice of [
  MCP_SLEEP_NOTICE,
  MCP_SLEEP_TREND_NOTICE,
  MCP_DAILY_HEALTH_NOTICE
]) {
  assert.ok(notice.endsWith(MCP_CONNECT_HINT), `"${notice}" must say where to go`);
  assert.ok(notice.includes("COROS MCP server"), `"${notice}" must name the cause`);
}

// The short form rides under a banner that already gave the directions.
assert.ok(MCP_UNAVAILABLE_SHORT.includes("COROS MCP server"));
assert.ok(!MCP_UNAVAILABLE_SHORT.includes(MCP_CONNECT_LOCATION));

// The route the copy spells out, checked against the screens along it: the
// sidebar's label, then Settings' own headings.
const [view, ...rows] = MCP_CONNECT_LOCATION.split("→").map((part) => part.trim());
assert.ok(
  read("src/navigation/primaryNav.ts").includes(`label: "${view}"`),
  `no sidebar item is called "${view}" — MCP_CONNECT_LOCATION is stale`
);

const settings = read("src/settings/SettingsView.tsx");
for (const row of rows) {
  assert.ok(
    settings.includes(`>${row}<`),
    `SettingsView renders no "${row}" — MCP_CONNECT_LOCATION is stale`
  );
}

assert.equal(mcpTextOr(false, "notice", "fallback"), "notice");
assert.equal(mcpTextOr(true, "notice", "fallback"), "fallback");
assert.equal(
  mcpTextOr(undefined, "notice", "fallback"),
  "fallback",
  "an unanswered status must not tell anyone to connect anything"
);

console.log("mcp notice tests passed");
