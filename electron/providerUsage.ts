import type {
  ChatGptUsage,
  ClaudeSubscriptionUsage,
  ProviderUsageWindow
} from "./types";

/*
 * What a subscription's own usage endpoint says, cut to what the usage dialog
 * draws. Node-free, so a suite reads it with the payloads verbatim.
 *
 * Both answers are read defensively: Claude's arrives through the Agent SDK's
 * `usage_EXPERIMENTAL_…` control request, whose shape its own type says may
 * change, and ChatGPT's from an endpoint only Codex documents by using it.
 * Probed on 2026-10-22: Claude Pro answered `five_hour`/`seven_day` with
 * `utilization` and `resets_at`, a `seven_day_breakdown` the SDK's type does not
 * declare, and some twenty null windows under internal code names — read by name
 * only, so none of those can reach the screen. ChatGPT Free answered one
 * `primary_window` of 2,592,000 s (thirty days) and no `secondary_window`.
 */

type Raw = Record<string, unknown>;

function record(value: unknown): Raw | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Raw) : null;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function percent(value: unknown): number | null {
  const figure = finite(value);
  return figure === null ? null : Math.min(100, Math.max(0, figure));
}

/** An ISO string as given, or seconds since the epoch made one. */
function isoTime(value: unknown): string | null {
  const seconds = finite(value);
  if (seconds !== null) return new Date(seconds * 1000).toISOString();
  const stated = text(value);
  return stated && Number.isFinite(Date.parse(stated)) ? stated : null;
}

function claudeWindow(value: unknown): ProviderUsageWindow | null {
  const raw = record(value);
  if (!raw) return null;
  const window = { usedPercent: percent(raw.utilization), resetsAt: isoTime(raw.resets_at) };
  return window.usedPercent === null && window.resetsAt === null ? null : window;
}

/** A sum of minor units and the exponent that places the point. */
function money(value: unknown): { amount: number; currency: string } | null {
  const raw = record(value);
  const minor = finite(raw?.amount_minor);
  const currency = text(raw?.currency);
  if (!raw || minor === null || !currency) return null;
  return { amount: minor / 10 ** (finite(raw.exponent) ?? 2), currency };
}

export function parseClaudeSubscriptionUsage(payload: unknown, readAt = new Date()): ClaudeSubscriptionUsage {
  const raw = record(payload) ?? {};
  const limits = record(raw.rate_limits);
  const limitsApply = raw.rate_limits_available !== false && limits !== null;
  const weekByModel: ClaudeSubscriptionUsage["weekByModel"] = [];
  for (const [key, label] of [["seven_day_opus", "Opus"], ["seven_day_sonnet", "Sonnet"]] as const) {
    const window = claudeWindow(limits?.[key]);
    if (window) weekByModel.push({ label, window });
  }
  if (Array.isArray(limits?.model_scoped)) {
    for (const entry of limits.model_scoped) {
      const label = text(record(entry)?.display_name);
      const window = claudeWindow(entry);
      if (label && window) weekByModel.push({ label, window });
    }
  }
  const rows = record(limits?.seven_day_breakdown)?.rows;
  const breakdown = Array.isArray(rows)
    ? rows.flatMap((row) => {
        const label = text(record(row)?.display_name);
        const share = percent(record(row)?.percent);
        return label && share !== null ? [{ label, percent: share }] : [];
      })
    : [];
  return {
    provider: "claude-code",
    plan: text(raw.subscription_type),
    limitsApply,
    session: limitsApply ? claudeWindow(limits?.five_hour) : null,
    week: limitsApply ? claudeWindow(limits?.seven_day) : null,
    weekByModel: limitsApply ? weekByModel : [],
    // A breakdown of nothing says nothing.
    breakdown: limitsApply && breakdown.some((row) => row.percent > 0) ? breakdown : [],
    extra: limitsApply ? claudeExtra(limits) : null,
    readAt: readAt.toISOString()
  };
}

/**
 * Credits past the plan. `spend` states its sums in minor units with their
 * exponent; `extra_usage` states a `used_credits` whose unit nothing says, so
 * only its switch and its share are taken from it.
 */
function claudeExtra(limits: Raw | null): ClaudeSubscriptionUsage["extra"] {
  const spend = record(limits?.spend);
  const extra = record(limits?.extra_usage);
  if (!spend && !extra) return null;
  const enabled = spend?.enabled === true || extra?.is_enabled === true;
  return {
    enabled,
    usedPercent: percent(spend?.percent) ?? percent(extra?.utilization),
    used: enabled ? money(spend?.used) : null,
    limit: enabled ? money(spend?.limit) : null
  };
}

/** `reset_after_seconds` counts from the moment of the answer, which is `readAt`. */
function chatGptWindow(value: unknown, readAt: Date): ChatGptUsage["windows"][number] | null {
  const raw = record(value);
  if (!raw) return null;
  const resetAfter = finite(raw.reset_after_seconds);
  return {
    usedPercent: percent(raw.used_percent),
    resetsAt:
      isoTime(raw.reset_at) ??
      (resetAfter !== null ? new Date(readAt.getTime() + resetAfter * 1000).toISOString() : null),
    seconds: finite(raw.limit_window_seconds)
  };
}

function chatGptWindows(rateLimit: unknown, readAt: Date): ChatGptUsage["windows"] {
  const raw = record(rateLimit);
  return [chatGptWindow(raw?.primary_window, readAt), chatGptWindow(raw?.secondary_window, readAt)].filter(
    (window): window is ChatGptUsage["windows"][number] => window !== null
  );
}

export function parseChatGptUsage(payload: unknown, readAt = new Date()): ChatGptUsage {
  const raw = record(payload) ?? {};
  const rateLimit = record(raw.rate_limit);
  const additional = Array.isArray(raw.additional_rate_limits)
    ? raw.additional_rate_limits.flatMap((entry) => {
        const limit = record(entry);
        const label = text(limit?.limit_name) ?? text(limit?.metered_feature);
        const windows = chatGptWindows(limit?.rate_limit, readAt);
        return label && windows.length ? [{ label, windows }] : [];
      })
    : [];
  const credits = record(raw.credits);
  const unlimited = credits?.unlimited === true;
  return {
    provider: "chatgpt",
    plan: text(raw.plan_type),
    limitReached: rateLimit?.limit_reached === true || rateLimit?.allowed === false,
    windows: chatGptWindows(rateLimit, readAt),
    additional,
    credits:
      credits && (unlimited || credits.has_credits === true)
        ? { unlimited, balance: unlimited ? null : text(credits.balance) ?? (finite(credits.balance)?.toString() ?? null) }
        : null,
    readAt: readAt.toISOString()
  };
}
