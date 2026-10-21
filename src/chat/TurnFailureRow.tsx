import {
  AlertTriangle,
  Clock,
  Copy,
  KeyRound,
  Minimize2,
  RotateCcw,
  Sparkles,
  Trash2,
  WifiOff,
  type LucideIcon
} from "lucide-react";
import type { ReactNode } from "react";
import { t, type MessageKey } from "../i18n/core";
import { useI18n } from "../i18n/useI18n";
import type { TurnFailureRowKind } from "./turnFailure";

/** What each row says and looks like: a passing trouble is a warning, one to act on an error. */
const ROWS: Record<
  TurnFailureRowKind,
  { icon: LucideIcon; tone: "warning" | "error" | "neutral"; title: MessageKey; body: MessageKey }
> = {
  busy: { icon: Clock, tone: "warning", title: "chat.fail.busy.title", body: "chat.fail.busy.body" },
  offline: { icon: WifiOff, tone: "warning", title: "chat.fail.offline.title", body: "chat.fail.offline.body" },
  auth: { icon: KeyRound, tone: "error", title: "chat.fail.auth.title", body: "chat.fail.auth.body" },
  tooLong: { icon: Minimize2, tone: "error", title: "chat.fail.tooLong.title", body: "chat.fail.tooLong.body" },
  other: { icon: AlertTriangle, tone: "error", title: "chat.fail.other.title", body: "chat.fail.other.body" },
  partial: { icon: AlertTriangle, tone: "warning", title: "chat.fail.partial.title", body: "chat.fail.partial.body" },
  noAnswer: { icon: AlertTriangle, tone: "neutral", title: "chat.fail.noAnswer.title", body: "chat.fail.noAnswer.body" },
  elsewhere: { icon: Clock, tone: "neutral", title: "chat.fail.elsewhere.title", body: "chat.fail.elsewhere.body" }
};

export interface TurnFailureActions {
  onRetry: () => void;
  onDelete?: () => void;
  onOtherAi?: () => void;
  onSettings?: () => void;
  onCondense?: () => void;
}

/**
 * Where a turn's answer would be when none came: what happened, in the
 * athlete's terms, and the button for what to do about it. It replaced a
 * banner over the screen that went with the next click, which left the
 * question sitting with nothing under it and no way to ask it again but to
 * type it out.
 */
export function TurnFailureRow({
  kind,
  detail,
  busy,
  actions
}: {
  kind: TurnFailureRowKind;
  /** The provider's own words, folded under Details. */
  detail?: string;
  /** A retry is on its way: every button waits. */
  busy: boolean;
  actions: TurnFailureActions;
}) {
  useI18n();
  const row = ROWS[kind];
  const Icon = row.icon;
  const button = (key: string, label: string, icon: ReactNode, onClick: () => void, primary = false) => (
    <button
      key={key}
      type="button"
      className={primary ? "chat-plan-upload" : "chat-plan-review"}
      disabled={busy}
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  );
  const copy = () => {
    if (detail) void navigator.clipboard.writeText(detail).catch(() => undefined);
  };

  return (
    // Only trouble interrupts a screen reader: a question still unanswered is
    // read out every time its conversation opens, so it is a status.
    <div className={`chat-failure is-${row.tone}`} role={row.tone === "neutral" ? "status" : "alert"}>
      <div className="chat-failure-head">
        <Icon size={16} aria-hidden="true" />
        <div>
          <strong>{t(row.title)}</strong>
          <p>{t(row.body)}</p>
        </div>
      </div>
      <div className="chat-plan-actions">
        {kind === "tooLong" && actions.onCondense
          ? button("condense", t("chat.fail.condense"), <Minimize2 size={14} aria-hidden="true" />, actions.onCondense, true)
          : button("retry", t("chat.fail.retry"), <RotateCcw size={14} aria-hidden="true" />, actions.onRetry, true)}
        {(kind === "busy" || kind === "tooLong" || kind === "auth") && actions.onOtherAi
          ? button("other-ai", t("chat.fail.otherAi"), <Sparkles size={14} aria-hidden="true" />, actions.onOtherAi)
          : null}
        {kind === "auth" && actions.onSettings
          ? button("settings", t("chat.fail.settings"), <KeyRound size={14} aria-hidden="true" />, actions.onSettings)
          : null}
        {kind === "other" && detail
          ? button("copy", t("chat.fail.copy"), <Copy size={14} aria-hidden="true" />, copy)
          : null}
        {(kind === "noAnswer" || kind === "elsewhere") && actions.onDelete
          ? button("delete", t("chat.turn.delete"), <Trash2 size={14} aria-hidden="true" />, actions.onDelete)
          : null}
      </div>
      {detail ? (
        <details className="chat-failure-details">
          <summary>{t("chat.fail.details")}</summary>
          <pre>{detail}</pre>
        </details>
      ) : null}
    </div>
  );
}
