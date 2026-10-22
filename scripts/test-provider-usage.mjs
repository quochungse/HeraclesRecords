/**
 * The usage dialog's reading of a subscription's limits (providerUsage.ts),
 * against the payloads both providers answered on 2026-10-22, emails and ids
 * taken out.
 *
 * What this holds down:
 *  - Claude's windows are read by name, so the twenty-odd null windows under
 *    internal code names (and the one under a code name that is *not* null)
 *    never reach the screen;
 *  - a breakdown of nothing is no breakdown, and extra usage that is off says
 *    so without sums;
 *  - a login whose plan limits do not apply draws none;
 *  - ChatGPT's windows keep their length, so Free's thirty days is not read as
 *    Plus's five hours, and a missing secondary window is not a window;
 *  - credits show only when the account has some.
 *
 * Runs the TypeScript directly; launched through Electron like the other
 * strip-types suites, for a Node built without Amaro.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const { parseClaudeSubscriptionUsage, parseChatGptUsage } = await import(
  `${pathToFileURL(path.join(root, "electron/providerUsage.ts")).href}?cacheBust=${Date.now()}`
);

const READ_AT = new Date("2026-10-22T04:31:27.000Z");

const nullWindows = Object.fromEntries(
  [
    "seven_day_oauth_apps", "seven_day_opus", "seven_day_sonnet", "seven_day_cowork",
    "seven_day_omelette", "tangelo", "omelette_promotional", "nimbus_quill", "cinder_cove"
  ].map((key) => [key, null])
);

const claudePro = {
  session: { total_cost_usd: 0, model_usage: {} },
  subscription_type: "pro",
  rate_limits_available: true,
  rate_limits: {
    five_hour: { utilization: 39, resets_at: "2026-10-22T06:49:59.686666+00:00", limit_dollars: null },
    seven_day: { utilization: 73, resets_at: "2026-10-22T09:59:59.686685+00:00", limit_dollars: null },
    ...nullWindows,
    iguana_necktie: { utilization: 100, resets_at: "2026-11-05T07:59:00+00:00", limit_dollars: 100, used_dollars: 100.879222 },
    extra_usage: { is_enabled: false, monthly_limit: null, used_credits: null, utilization: null, currency: null },
    spend: { used: { amount_minor: 0, currency: "USD", exponent: 2 }, limit: null, percent: 0, enabled: false },
    seven_day_breakdown: {
      rows: [
        { key: "claude_code", display_name: "Claude Code", percent: 100 },
        { key: "chat", display_name: "Chats", percent: 0 },
        { key: "cowork", display_name: "Cowork", percent: 0 },
        { key: "other", display_name: "Other", percent: 0 }
      ]
    },
    model_scoped: []
  }
};

{
  const usage = parseClaudeSubscriptionUsage(claudePro, READ_AT);
  assert.equal(usage.provider, "claude-code");
  assert.equal(usage.plan, "pro");
  assert.equal(usage.limitsApply, true);
  assert.deepEqual(usage.session, { usedPercent: 39, resetsAt: "2026-10-22T06:49:59.686666+00:00" });
  assert.deepEqual(usage.week, { usedPercent: 73, resetsAt: "2026-10-22T09:59:59.686685+00:00" });
  assert.deepEqual(usage.weekByModel, [], "a window under a code name is never drawn");
  assert.deepEqual(usage.breakdown.map((row) => row.label), ["Claude Code", "Chats", "Cowork", "Other"]);
  assert.deepEqual(usage.extra, { enabled: false, usedPercent: 0, used: null, limit: null });
  assert.equal(usage.readAt, READ_AT.toISOString());
}

{
  // A Max plan with model weeks and credits switched on.
  const usage = parseClaudeSubscriptionUsage({
    subscription_type: "max",
    rate_limits_available: true,
    rate_limits: {
      five_hour: { utilization: 120, resets_at: "2026-10-22T06:00:00Z" },
      seven_day: { utilization: 40, resets_at: "2026-10-25T06:00:00Z" },
      seven_day_opus: { utilization: 91, resets_at: "2026-10-25T06:00:00Z" },
      model_scoped: [{ display_name: "Fable", utilization: 12, resets_at: null }, { utilization: 5 }],
      spend: { used: { amount_minor: 1250, currency: "USD", exponent: 2 }, limit: { amount_minor: 5000, currency: "USD", exponent: 2 }, percent: 25, enabled: true },
      seven_day_breakdown: { rows: [{ display_name: "Claude Code", percent: 0 }] }
    }
  }, READ_AT);
  assert.equal(usage.session.usedPercent, 100, "a figure past the window is held at 100");
  assert.deepEqual(usage.weekByModel.map((entry) => [entry.label, entry.window.usedPercent]), [["Opus", 91], ["Fable", 12]]);
  assert.deepEqual(usage.breakdown, [], "a breakdown of nothing is none");
  assert.deepEqual(usage.extra, {
    enabled: true,
    usedPercent: 25,
    used: { amount: 12.5, currency: "USD" },
    limit: { amount: 50, currency: "USD" }
  });
}

{
  const usage = parseClaudeSubscriptionUsage({ subscription_type: null, rate_limits_available: false, rate_limits: null }, READ_AT);
  assert.equal(usage.limitsApply, false);
  assert.equal(usage.session, null);
  assert.equal(usage.week, null);
  assert.equal(usage.extra, null);
  assert.equal(parseClaudeSubscriptionUsage(undefined, READ_AT).limitsApply, false, "nothing read is no limits, not a crash");
}

const chatGptFree = {
  plan_type: "free",
  rate_limit: {
    allowed: true,
    limit_reached: false,
    primary_window: { used_percent: 0, limit_window_seconds: 2592000, reset_after_seconds: 2592000, reset_at: 1795235538 },
    secondary_window: null
  },
  code_review_rate_limit: null,
  additional_rate_limits: null,
  credits: { has_credits: false, unlimited: false, overage_limit_reached: false, balance: null },
  promo: { campaign_id: "plus-1-month-free", message: "Start a free trial of Plus today" }
};

{
  const usage = parseChatGptUsage(chatGptFree, READ_AT);
  assert.equal(usage.provider, "chatgpt");
  assert.equal(usage.plan, "free");
  assert.equal(usage.limitReached, false);
  assert.deepEqual(usage.windows, [
    { usedPercent: 0, resetsAt: new Date(1795235538 * 1000).toISOString(), seconds: 2592000 }
  ]);
  assert.deepEqual(usage.additional, []);
  assert.equal(usage.credits, null, "no credits, no line");
}

{
  // Plus, as Codex reads it: five hours and a week, one of them spent.
  const usage = parseChatGptUsage({
    plan_type: "plus",
    rate_limit: {
      allowed: false,
      limit_reached: true,
      primary_window: { used_percent: 100, limit_window_seconds: 18000, reset_after_seconds: 600 },
      secondary_window: { used_percent: 64, limit_window_seconds: 604800, reset_at: 1795235538 }
    },
    additional_rate_limits: [
      { limit_name: "GPT-5.3-Codex-Spark", metered_feature: "codex_spark", rate_limit: { primary_window: { used_percent: 3, limit_window_seconds: 18000 } } },
      { metered_feature: "empty", rate_limit: null }
    ],
    credits: { has_credits: true, unlimited: false, balance: "42" }
  }, READ_AT);
  assert.equal(usage.limitReached, true);
  assert.deepEqual(usage.windows.map((window) => [window.seconds, window.usedPercent]), [[18000, 100], [604800, 64]]);
  assert.equal(usage.windows[0].resetsAt, new Date(READ_AT.getTime() + 600_000).toISOString(), "reset_after_seconds counts from the answer");
  assert.deepEqual(usage.additional.map((limit) => limit.label), ["GPT-5.3-Codex-Spark"], "a limit with no window is left out");
  assert.deepEqual(usage.credits, { unlimited: false, balance: "42" });
  assert.deepEqual(parseChatGptUsage({ credits: { unlimited: true } }, READ_AT).credits, { unlimited: true, balance: null });
}

console.log("provider usage tests passed");
