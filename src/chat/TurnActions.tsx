import { Check, Copy, Eye, EyeOff, GitBranch, Pencil, Trash2, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { t } from "../i18n/core";
import { useI18n } from "../i18n/useI18n";

/** How long a copied message says so before its icon goes back. */
const COPIED_MS = 1500;

function Action({
  icon: Icon,
  label,
  danger = false,
  onClick
}: {
  icon: LucideIcon;
  label: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={danger ? "chat-turn-action is-danger" : "chat-turn-action"}
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      <Icon size={14} aria-hidden="true" />
    </button>
  );
}

/**
 * What can be done to a message, beside it: copy it, ask the last question
 * again in other words, keep its turn out of what Coach reads, carry the
 * conversation up to it into a new one, delete the turn. Drawn quiet and shown on hover or focus, so a conversation reads as
 * a conversation until the athlete reaches for one of them. An action left
 * out is one that does not apply here, or not now.
 */
export function TurnActions({
  copyText,
  onEdit,
  hidden,
  onToggleHidden,
  onBranch,
  onDelete
}: {
  /** The text a copy puts on the clipboard, worked out when it is pressed. */
  copyText: () => string;
  onEdit?: () => void;
  /** Whether the turn is hidden from Coach, for the toggle's words. */
  hidden?: boolean;
  onToggleHidden?: () => void;
  onBranch?: () => void;
  onDelete?: () => void;
}) {
  useI18n();
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = () => {
    void navigator.clipboard
      .writeText(copyText())
      .then(() => {
        setCopied(true);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(false), COPIED_MS);
      })
      .catch(() => undefined);
  };

  return (
    <span className="chat-turn-actions">
      <Action icon={copied ? Check : Copy} label={copied ? t("chat.turn.copied") : t("chat.turn.copy")} onClick={copy} />
      {onEdit ? <Action icon={Pencil} label={t("chat.turn.edit")} onClick={onEdit} /> : null}
      {onToggleHidden ? (
        <Action
          icon={hidden ? Eye : EyeOff}
          label={hidden ? t("chat.turn.show") : t("chat.turn.hide")}
          onClick={onToggleHidden}
        />
      ) : null}
      {onBranch ? <Action icon={GitBranch} label={t("chat.turn.branch")} onClick={onBranch} /> : null}
      {onDelete ? <Action icon={Trash2} label={t("chat.turn.delete")} danger onClick={onDelete} /> : null}
    </span>
  );
}
