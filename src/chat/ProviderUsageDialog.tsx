import { AlertTriangle, RotateCw, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ChatGptUsage,
  ClaudeSubscriptionUsage,
  ProviderUsageResult,
  ProviderUsageWindow,
  UsageProvider
} from "../../electron/types";
import { formatDecimal, getIntlLocale, t } from "../i18n/core";
import { useI18n } from "../i18n/useI18n";

/**
 * A subscription's limits, opened from "AI for this conversation". Each
 * provider is drawn as its own answer reads: Claude by its five-hour session
 * and its week, with where the week went and what happens past it; ChatGPT by
 * windows named for their length (Plus has five hours and a week, Free thirty
 * days) and its credits. Read on open, never on a turn: Claude's spawns the CLI.
 */

/** What was read last, per provider, so reopening within a minute shows it at once. */
const lastRead = new Map<UsageProvider, { result: ProviderUsageResult; at: number }>();
const FRESH_MS = 60_000;

/**
 * A read still in flight, per provider, which a second open shares rather than
 * repeating: Claude's spawns the CLI, and StrictMode runs the opening effect twice.
 */
const inFlight = new Map<UsageProvider, Promise<ProviderUsageResult>>();

function readUsage(provider: UsageProvider): Promise<ProviderUsageResult> {
  const pending = inFlight.get(provider);
  if (pending) return pending;
  const read = Promise.resolve()
    .then(() => window.heraclesRecords?.readProviderUsage(provider))
    .then(
      (result): ProviderUsageResult => result ?? { ok: false, reason: "failed" },
      (error: unknown): ProviderUsageResult => ({
        ok: false,
        reason: "failed",
        detail: error instanceof Error ? error.message : String(error)
      })
    )
    .then((result) => {
      lastRead.set(provider, { result, at: Date.now() });
      return result;
    })
    .finally(() => inFlight.delete(provider));
  inFlight.set(provider, read);
  return read;
}

export function canReadUsage(provider: string): provider is UsageProvider {
  return provider === "claude-code" || provider === "chatgpt";
}

export function ProviderUsageDialog({ provider, onClose }: { provider: UsageProvider; onClose: () => void }) {
  useI18n();
  const cached = lastRead.get(provider);
  const [result, setResult] = useState<ProviderUsageResult | null>(cached?.result ?? null);
  const [reading, setReading] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  const read = useCallback(async () => {
    setReading(true);
    try {
      setResult(await readUsage(provider));
    } finally {
      setReading(false);
    }
  }, [provider]);

  useEffect(() => {
    closeRef.current?.focus();
    const entry = lastRead.get(provider);
    if (!entry || Date.now() - entry.at > FRESH_MS || !entry.result.ok) void read();
  }, [provider, read]);

  // Over the AI sheet: Escape closes this layer and nothing under it.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const usage = result?.ok ? result.usage : null;
  return (
    <div className="plan-generator-sheet-layer">
      <button type="button" className="plan-generator-scrim" aria-label={t("chat.usage.close")} tabIndex={-1} onClick={onClose} />
      <div className="plan-generator-sheet provider-usage" role="dialog" aria-modal="true" aria-labelledby="provider-usage-title">
        <header>
          <div>
            <h3 id="provider-usage-title">{provider === "claude-code" ? t("chat.usage.title.claude") : t("chat.usage.title.chatgpt")}</h3>
            {reading || usage ? (
              <p className="provider-usage-meta">
                {usage && planName(usage) ? <span className="provider-usage-plan">{planName(usage)}</span> : null}
                <span>{reading ? t("chat.usage.reading") : usage ? t("chat.usage.updated", { time: clock(usage.readAt) }) : null}</span>
              </p>
            ) : null}
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label={t("chat.usage.refresh")}
            title={t("chat.usage.refresh")}
            disabled={reading}
            onClick={() => void read()}
          >
            <RotateCw size={14} className={reading ? "is-spinning" : undefined} aria-hidden="true" />
          </button>
          <button ref={closeRef} type="button" className="icon-button" aria-label={t("chat.usage.close")} onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        <div className="plan-generator-sheet-body provider-usage-body" aria-busy={reading}>
          {usage?.provider === "claude-code" ? <ClaudeUsage usage={usage} /> : null}
          {usage?.provider === "chatgpt" ? <ChatGptUsageView usage={usage} /> : null}
          {result && !result.ok ? <UsageProblem provider={provider} result={result} onRetry={() => void read()} reading={reading} /> : null}
          {!result ? <UsageSkeleton /> : null}
        </div>
      </div>
    </div>
  );
}

function ClaudeUsage({ usage }: { usage: ClaudeSubscriptionUsage }) {
  if (!usage.limitsApply) {
    return <p className="plan-generator-sheet-note">{t("chat.usage.noLimits")}</p>;
  }
  return (
    <>
      {usage.session ? (
        <section className="provider-usage-group">
          <p className="tl-eyebrow">{t("chat.usage.session")}</p>
          <UsageMeter limit={usage.session} note={t("chat.usage.sessionNote")} />
        </section>
      ) : null}
      {usage.week || usage.weekByModel.length ? (
        <section className="provider-usage-group">
          <p className="tl-eyebrow">{t("chat.usage.week")}</p>
          {usage.week ? <UsageMeter limit={usage.week} label={t("chat.usage.weekAll")} /> : null}
          {usage.weekByModel.map((entry) => (
            <UsageMeter key={entry.label} limit={entry.window} label={t("chat.usage.weekModel", { model: entry.label })} />
          ))}
        </section>
      ) : null}
      {usage.breakdown.length ? (
        <section className="provider-usage-group">
          <p className="tl-eyebrow">{t("chat.usage.breakdown")}</p>
          <ul className="provider-usage-shares">
            {usage.breakdown.map((row) => (
              <li key={row.label}>
                <span>{row.label}</span>
                <span className="provider-usage-share-track" aria-hidden="true">
                  <span style={{ width: `${row.percent}%` }} />
                </span>
                <span className="provider-usage-figure-small">{formatPercent(row.percent)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {usage.extra ? (
        <div className="provider-usage-line">
          <span>{t("chat.usage.extra")}</span>
          <span>{extraLine(usage.extra)}</span>
        </div>
      ) : null}
      <p className="provider-usage-footnote">{t("chat.usage.claudeNote")}</p>
    </>
  );
}

function ChatGptUsageView({ usage }: { usage: ChatGptUsage }) {
  return (
    <>
      {usage.limitReached ? (
        <div className="plan-generator-sheet-warning provider-usage-reached" role="status">
          <AlertTriangle size={15} aria-hidden="true" />
          <p>{t("chat.usage.limitReached")}</p>
        </div>
      ) : null}
      {usage.windows.length ? (
        <UsageTiles windows={usage.windows} />
      ) : (
        <p className="plan-generator-sheet-note">{t("chat.usage.noWindows")}</p>
      )}
      {usage.additional.map((limit) => (
        <section key={limit.label} className="provider-usage-group">
          <p className="tl-eyebrow">{limit.label}</p>
          <UsageTiles windows={limit.windows} />
        </section>
      ))}
      {usage.credits ? (
        <div className="provider-usage-line">
          <span>{t("chat.usage.credits")}</span>
          <span>
            {usage.credits.unlimited
              ? t("chat.usage.creditsUnlimited")
              : usage.credits.balance
                ? t("chat.usage.creditsBalance", { balance: usage.credits.balance })
                : "—"}
          </span>
        </div>
      ) : null}
      <p className="provider-usage-footnote">{t("chat.usage.chatgptNote")}</p>
    </>
  );
}

/**
 * ChatGPT's windows side by side, each named by its length with its figure
 * large: there are one or two, and which runs out first is the question.
 */
function UsageTiles({ windows }: { windows: ChatGptUsage["windows"] }) {
  return (
    <div className="provider-usage-tiles">
      {windows.map((entry, index) => {
        const used = entry.usedPercent;
        return (
          <div key={index} className={`provider-usage-tile provider-usage-meter${toneOf(used)}`}>
            <p className="tl-eyebrow">{windowName(entry.seconds)}</p>
            <p className="provider-usage-tile-figure">
              {used === null ? "—" : formatPercent(used)}
            </p>
            <UsageTrack used={used} label={windowName(entry.seconds)} />
            {entry.resetsAt ? <ResetLine at={entry.resetsAt} stacked /> : null}
          </div>
        );
      })}
    </div>
  );
}

function toneOf(used: number | null): string {
  return used === null ? "" : used >= 90 ? " is-critical" : used >= 75 ? " is-high" : "";
}

function UsageTrack({ used, label }: { used: number | null; label?: string }) {
  return (
    <div
      className="provider-usage-track"
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={used ?? undefined}
    >
      <span style={{ width: `${used ?? 0}%` }} />
    </div>
  );
}

/** When a window starts over; `stacked` puts the clock on a line of its own, for a narrow tile. */
function ResetLine({ at, stacked = false }: { at: string; stacked?: boolean }) {
  return (
    <p className="provider-usage-reset" title={fullTime(at)}>
      {t("chat.usage.resets", { when: relativeTime(at) })}
      {stacked ? <br /> : <span aria-hidden="true"> · </span>}
      {shortTime(at)}
    </p>
  );
}

/** How much of a window is spent, as a figure, a bar and when it starts over. */
function UsageMeter({ limit, label, note }: { limit: ProviderUsageWindow; label?: string; note?: string }) {
  const used = limit.usedPercent;
  return (
    <div className={`provider-usage-meter${toneOf(used)}`}>
      <div className="provider-usage-meter-head">
        <span>{label ?? note}</span>
        <span className="provider-usage-figure">{used === null ? "—" : t("chat.usage.used", { percent: formatPercent(used) })}</span>
      </div>
      <UsageTrack used={used} label={label ?? note} />
      {limit.resetsAt ? <ResetLine at={limit.resetsAt} /> : null}
      {label && note ? <p className="provider-usage-reset">{note}</p> : null}
    </div>
  );
}

function UsageProblem({
  provider,
  result,
  reading,
  onRetry
}: {
  provider: UsageProvider;
  result: Extract<ProviderUsageResult, { ok: false }>;
  reading: boolean;
  onRetry: () => void;
}) {
  if (result.reason === "signed-out") {
    return (
      <p className="plan-generator-sheet-note">
        {provider === "claude-code" ? t("chat.usage.signedOut.claude") : t("chat.usage.signedOut.chatgpt")}
      </p>
    );
  }
  return (
    <div className="plan-generator-sheet-warning" role="status" title={result.detail}>
      <AlertTriangle size={15} aria-hidden="true" />
      <p>{t("chat.usage.failed")}</p>
      <button type="button" className="ghost-button" disabled={reading} onClick={onRetry}>{t("chat.usage.retry")}</button>
    </div>
  );
}

/** The meters' outline while the first read is in flight, so the sheet does not jump when it lands. */
function UsageSkeleton() {
  return (
    <div className="provider-usage-skeleton" aria-hidden="true">
      {[0, 1].map((index) => (
        <div key={index} className="provider-usage-meter">
          <div className="provider-usage-meter-head"><span /><span /></div>
          <div className="provider-usage-track" />
        </div>
      ))}
    </div>
  );
}

/** A plan is a product name, kept as the provider writes it. */
function planName(usage: ClaudeSubscriptionUsage | ChatGptUsage): string | null {
  const brand = usage.provider === "claude-code" ? "Claude" : "ChatGPT";
  if (!usage.plan) return null;
  return `${brand} ${usage.plan.charAt(0).toUpperCase()}${usage.plan.slice(1)}`;
}

function windowName(seconds: number | null): string {
  if (seconds === null || seconds <= 0) return t("chat.usage.window.other");
  const hours = seconds / 3600;
  if (hours < 24) return t("chat.usage.window.hours", { hours: Math.round(hours) });
  const days = Math.round(hours / 24);
  return days === 7 ? t("chat.usage.window.week") : t("chat.usage.window.days", { days });
}

function extraLine(extra: NonNullable<ClaudeSubscriptionUsage["extra"]>): string {
  if (!extra.enabled) return t("chat.usage.extraOff");
  if (extra.used && extra.limit) {
    return t("chat.usage.extraSpent", { used: formatMoney(extra.used), limit: formatMoney(extra.limit) });
  }
  if (extra.used) return t("chat.usage.extraSpentNoLimit", { used: formatMoney(extra.used) });
  return extra.usedPercent === null ? t("chat.usage.extraOn") : t("chat.usage.used", { percent: formatPercent(extra.usedPercent) });
}

function formatPercent(value: number): string {
  return new Intl.NumberFormat(getIntlLocale(), { style: "percent", maximumFractionDigits: 0 }).format(value / 100);
}

function formatMoney(value: { amount: number; currency: string }): string {
  try {
    return new Intl.NumberFormat(getIntlLocale(), { style: "currency", currency: value.currency }).format(value.amount);
  } catch {
    return `${formatDecimal(value.amount, 2)} ${value.currency}`;
  }
}

/** How far off a reset is; one already past (a read left open) reads as a minute off, never as "ago". */
function relativeTime(iso: string): string {
  const minutes = Math.max(1, (Date.parse(iso) - Date.now()) / 60_000);
  const format = new Intl.RelativeTimeFormat(getIntlLocale(), { numeric: "auto" });
  if (minutes < 60) return format.format(Math.round(minutes), "minute");
  if (minutes < 48 * 60) return format.format(Math.round(minutes / 60), "hour");
  return format.format(Math.round(minutes / 1440), "day");
}

/** The clock time within a day, the date past it. */
function shortTime(iso: string): string {
  const date = new Date(iso);
  const withinDay = date.getTime() - Date.now() < 24 * 3_600_000;
  return new Intl.DateTimeFormat(
    getIntlLocale(),
    withinDay ? { hour: "2-digit", minute: "2-digit" } : { weekday: "short", day: "numeric", month: "short" }
  ).format(date);
}

function fullTime(iso: string): string {
  return new Intl.DateTimeFormat(getIntlLocale(), { dateStyle: "full", timeStyle: "short" }).format(new Date(iso));
}

function clock(iso: string): string {
  return new Intl.DateTimeFormat(getIntlLocale(), { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}
