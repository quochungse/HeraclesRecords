import { Check, Copy, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { t } from "../i18n/core";
import { useI18n } from "../i18n/useI18n";

/** How long a copied message says so before its icon goes back. */
const COPIED_MS = 1500;

/**
 * What can be done to a message, beside it: copy it, delete the turn it
 * belongs to. Drawn quiet and shown
 * on hover or focus, so a conversation reads as a conversation until the
 * athlete reaches for one of them.
 */
export function TurnActions({
  copyText,
  onDelete
}: {
  /** The text a copy puts on the clipboard, worked out when it is pressed. */
  copyText: () => string;
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
      <button
        type="button"
        className="chat-turn-action"
        onClick={copy}
        aria-label={copied ? t("chat.turn.copied") : t("chat.turn.copy")}
        title={copied ? t("chat.turn.copied") : t("chat.turn.copy")}
      >
        {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
      </button>
      {onDelete ? (
        <button
          type="button"
          className="chat-turn-action is-danger"
          onClick={onDelete}
          aria-label={t("chat.turn.delete")}
          title={t("chat.turn.delete")}
        >
          <Trash2 size={14} aria-hidden="true" />
        </button>
      ) : null}
    </span>
  );
}
