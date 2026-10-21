import { useRef } from "react";
import { t } from "../i18n/core";
import { useI18n } from "../i18n/useI18n";

/**
 * The last question, in place, to be asked again in other words. Saving
 * replaces Coach's answer and what it made, without a second question: the
 * note under the words says so, and Escape or Cancel leaves everything as it
 * was. Ctrl or ⌘ + Enter saves, as the composer's Enter sends.
 */
export function QuestionEditor({
  initial,
  onSave,
  onCancel
}: {
  initial: string;
  onSave: (text: string) => void;
  onCancel: () => void;
}) {
  useI18n();
  const field = useRef<HTMLTextAreaElement>(null);
  const save = () => {
    const text = field.current?.value.trim() ?? "";
    if (text) onSave(text);
  };
  return (
    <div className="chat-question-edit">
      <textarea
        ref={field}
        defaultValue={initial}
        aria-label={t("chat.turn.editLabel")}
        autoFocus
        onFocus={(event) => event.currentTarget.setSelectionRange(initial.length, initial.length)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            save();
          }
        }}
      />
      <div className="chat-question-edit-foot">
        <span>{t("chat.turn.editNote")}</span>
        <button type="button" className="chat-plan-review" onClick={onCancel}>
          {t("common.cancel")}
        </button>
        <button type="button" className="chat-plan-upload" onClick={save}>
          {t("chat.turn.editSave")}
        </button>
      </div>
    </div>
  );
}
