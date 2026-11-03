import { useState } from "react";
import { MessageCircle, PencilLine, Send } from "lucide-react";
import type { CoachInputChoice, CoachInputPrompt } from "../../electron/types";
import { t } from "../i18n/core";
import { useI18n } from "../i18n/useI18n";
import { isPicked, type QuestionPick } from "./coachQuestions";

/**
 * Words of the athlete's own, in place under a question's choices: a field that
 * reads as one (a pencil, a placeholder, an input's ground), not a link to the
 * composer. With `onSubmit` it sends on Enter or its arrow — a single question
 * is answered from here; on a card of several the words wait for Send.
 * Enter while an input method is composing (Vietnamese Telex) is the IME's,
 * not a send.
 */
function AnswerField({
  questionId,
  value,
  disabled,
  onChange,
  onSubmit
}: {
  /** The question's heading, which names the field: on a card of several, each field is its question's. */
  questionId: string;
  value: string;
  disabled: boolean;
  onChange: (text: string) => void;
  onSubmit?: () => void;
}) {
  return (
    <label className="chat-coach-prompt-field">
      <PencilLine size={14} aria-hidden="true" />
      <input
        type="text"
        value={value}
        placeholder={t("chat.composer.anotherAnswer")}
        aria-labelledby={questionId}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (onSubmit && event.key === "Enter" && !event.nativeEvent.isComposing) {
            event.preventDefault();
            onSubmit();
          }
        }}
      />
      {onSubmit ? (
        <button
          type="button"
          className="chat-coach-prompt-field-send"
          aria-label={t("chat.composer.send")}
          disabled={disabled || !value.trim()}
          onClick={onSubmit}
        >
          <Send size={14} aria-hidden="true" />
        </button>
      ) : null}
    </label>
  );
}

/**
 * One of Coach's answers. `selected` only on a card of several questions, where
 * a press picks and a second press unpicks; on a single question a press is
 * the answer, an action rather than a toggle, so it carries no pressed state.
 */
function ChoiceButton({
  choice,
  recommended,
  selected,
  disabled,
  onClick
}: {
  choice: CoachInputChoice;
  recommended: boolean;
  selected?: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`chat-coach-prompt-choice${selected ? " is-selected" : ""}`}
      aria-pressed={selected}
      onClick={onClick}
      disabled={disabled}
    >
      <span>
        {choice.label}
        {recommended ? <em>{t("chat.prompt.recommended")}</em> : null}
      </span>
      {choice.description ? <small>{choice.description}</small> : null}
    </button>
  );
}

/** One question: a press on a choice, or words in the field, answers it at once. */
export function CoachQuestionCard({
  prompt,
  disabled,
  onChoose,
  onAnswer
}: {
  prompt: CoachInputPrompt;
  disabled: boolean;
  onChoose: (choice: CoachInputChoice) => void;
  onAnswer: (words: string) => void;
}) {
  useI18n();
  const [words, setWords] = useState("");
  const answer = () => {
    const text = words.trim();
    if (text && !disabled) onAnswer(text);
  };
  return (
    <section className="chat-coach-prompt" aria-labelledby={`coach-prompt-${prompt.promptId}`}>
      <header className="chat-coach-prompt-header">
        <span className="chat-coach-prompt-status">
          <MessageCircle size={14} aria-hidden="true" />
          {t("chat.prompt.waiting")}
        </span>
        <h4 id={`coach-prompt-${prompt.promptId}`}>{prompt.question}</h4>
      </header>
      <div className="chat-coach-prompt-choices" role="group" aria-label={t("chat.prompt.choices")}>
        {prompt.choices.map((choice, index) => (
          <ChoiceButton
            key={choice.id}
            choice={choice}
            recommended={index === 0}
            disabled={disabled}
            onClick={() => onChoose(choice)}
          />
        ))}
      </div>
      {prompt.allowCustom ? (
        <AnswerField
          questionId={`coach-prompt-${prompt.promptId}`}
          value={words}
          disabled={disabled}
          onChange={setWords}
          onSubmit={answer}
        />
      ) : null}
    </section>
  );
}

/**
 * Coach's questions asked together, as one card: each picked or answered in
 * words, changed freely, then sent in one turn. What is left blank is skipped
 * — the coach goes on with its own assumption — so Send waits only for one
 * answer, not for all of them.
 */
export function CoachQuestionsCard({
  prompts,
  picks,
  disabled,
  onPick,
  onSend
}: {
  prompts: CoachInputPrompt[];
  picks: Readonly<Record<string, QuestionPick>>;
  disabled: boolean;
  onPick: (promptId: string, pick: QuestionPick | undefined) => void;
  onSend: () => void;
}) {
  useI18n();
  const answered = prompts.filter((prompt) => isPicked(picks[prompt.promptId])).length;
  return (
    <section className="chat-coach-prompt" aria-label={t("chat.prompt.waitingMany")}>
      <header className="chat-coach-prompt-header">
        <span className="chat-coach-prompt-status">
          <MessageCircle size={14} aria-hidden="true" />
          {t("chat.prompt.waitingMany")}
        </span>
      </header>
      <ol className="chat-coach-prompt-list">
        {prompts.map((prompt, position) => {
          const pick = picks[prompt.promptId];
          return (
            <li key={prompt.promptId} className="chat-coach-prompt-item">
              <h4 id={`coach-prompt-${prompt.promptId}`}>
                <span className="chat-coach-prompt-number">{position + 1}</span>
                {prompt.question}
              </h4>
              <div
                className="chat-coach-prompt-choices"
                role="group"
                aria-labelledby={`coach-prompt-${prompt.promptId}`}
              >
                {prompt.choices.map((choice, index) => {
                  const selected = pick?.choiceId === choice.id;
                  return (
                    <ChoiceButton
                      key={choice.id}
                      choice={choice}
                      recommended={index === 0}
                      selected={selected}
                      disabled={disabled}
                      onClick={() => onPick(prompt.promptId, selected ? undefined : { choiceId: choice.id })}
                    />
                  );
                })}
              </div>
              {prompt.allowCustom ? (
                <AnswerField
                  questionId={`coach-prompt-${prompt.promptId}`}
                  value={pick?.choiceId ? "" : pick?.text ?? ""}
                  disabled={disabled}
                  onChange={(text) => onPick(prompt.promptId, text ? { text } : undefined)}
                />
              ) : null}
            </li>
          );
        })}
      </ol>
      <footer className="chat-coach-prompt-foot">
        <span>
          {t("chat.prompt.progress", { answered, total: prompts.length })}
          {answered < prompts.length ? ` · ${t("chat.prompt.skipNote")}` : ""}
        </span>
        <button type="button" className="chat-plan-upload" disabled={disabled || answered === 0} onClick={onSend}>
          {t("chat.prompt.send")}
        </button>
      </footer>
    </section>
  );
}
