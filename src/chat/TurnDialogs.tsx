import { useState } from "react";
import type { DeleteTurnOptions, TurnCreation, TurnDescription } from "../../electron/types";
import { t } from "../i18n/core";
import { useI18n } from "../i18n/useI18n";
import { ConfirmDialog } from "../training-library/ConfirmDialog";

function creationKind(creation: TurnCreation): string {
  if (creation.kind === "workout") return t("chat.turn.kind.workout");
  if (creation.kind === "changes") return t("chat.turn.kind.changes");
  return t("chat.turn.kind.plan");
}

function keptNote(creation: TurnCreation): string | undefined {
  if (creation.keptBecause === "saved") return t("chat.turn.keptSaved");
  if (creation.keptBecause === "versions") return t("chat.turn.keptVersions");
  return undefined;
}

/**
 * The summary's part of either question: what the summary still says, and
 * whether to write it again now — on the model that condenses the
 * conversation — or leave it until it next rolls.
 */
function SummaryChoice({
  note,
  model,
  checked,
  disabled,
  onChange
}: {
  note: string;
  model?: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <section className="chat-turn-dialog-section">
      <h3>{t("chat.turn.summary")}</h3>
      <p className="tl-dialog-warning" role="note">{note}</p>
      <label className="chat-turn-dialog-choice">
        <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
        <span>
          <b>{t("chat.turn.rewrite")}</b>
          <small>{model ? t("chat.turn.rewriteOn", { model }) : t("chat.turn.rewriteAny")}</small>
        </span>
      </label>
    </section>
  );
}

/**
 * The question before a turn is deleted. It says what goes, and asks the two
 * things only the athlete can answer: whether what Coach made in the turn
 * goes with it (left alone, its cards stay where they are), and — when the
 * conversation's summary speaks for the turn — whether to write the summary
 * again now.
 *
 * `description` is null while the main process is still finding out; the
 * delete waits for it, since the answer may add a question.
 */
export function DeleteTurnDialog({
  description,
  busy,
  onConfirm,
  onCancel
}: {
  description: TurnDescription | null;
  busy: boolean;
  onConfirm: (options: DeleteTurnOptions) => void;
  onCancel: () => void;
}) {
  useI18n();
  const [deleteCreations, setDeleteCreations] = useState(false);
  const [rewriteSummary, setRewriteSummary] = useState(false);
  const creations = description?.creations ?? [];
  const deletable = creations.some((creation) => creation.deletable);
  const rewriting = Boolean(description?.summarised && rewriteSummary);

  return (
    <ConfirmDialog
      title={t("chat.turn.deleteTitle")}
      description={t("chat.turn.deleteBody")}
      confirmLabel={rewriting ? t("chat.turn.deleteRewrite") : t("chat.turn.delete")}
      danger
      confirmDisabled={!description}
      busy={busy ? { target: "confirm", label: rewriting ? t("chat.turn.rewriting") : t("chat.turn.deleting") } : undefined}
      onConfirm={() => onConfirm({ deleteCreations: deletable && deleteCreations, rewriteSummary: rewriting })}
      onCancel={onCancel}
    >
      {description === null ? <p className="chat-turn-dialog-pending">{t("chat.turn.checking")}</p> : null}
      {creations.length ? (
        <section className="chat-turn-dialog-section">
          <h3>{t("chat.turn.made")}</h3>
          <ul>
            {creations.map((creation, index) => (
              <li key={`${creation.kind}-${index}`}>
                {creation.name || creationKind(creation)}
                <span>{[creationKind(creation), keptNote(creation)].filter(Boolean).join(" · ")}</span>
              </li>
            ))}
          </ul>
          {deletable ? (
            <label className="chat-turn-dialog-choice">
              <input
                type="checkbox"
                checked={deleteCreations}
                disabled={busy}
                onChange={(event) => setDeleteCreations(event.target.checked)}
              />
              <span>
                <b>{t("chat.turn.deleteMade")}</b>
                <small>{t("chat.turn.deleteMadeDetail")}</small>
              </span>
            </label>
          ) : null}
        </section>
      ) : null}
      {description?.summarised ? (
        <SummaryChoice
          note={t("chat.turn.summaryNote")}
          model={description.summaryModel}
          checked={rewriteSummary}
          disabled={busy}
          onChange={setRewriteSummary}
        />
      ) : null}
    </ConfirmDialog>
  );
}

/**
 * The question before a turn the summary covers is hidden from Coach, or
 * shown to it again: the summary is a summary of what Coach could read, so it
 * is out of step with the change until it is written again.
 */
export function HideTurnDialog({
  hidden,
  summaryModel,
  busy,
  onConfirm,
  onCancel
}: {
  /** What the turn becomes: hidden, or shown again. */
  hidden: boolean;
  summaryModel?: string;
  busy: boolean;
  onConfirm: (rewriteSummary: boolean) => void;
  onCancel: () => void;
}) {
  useI18n();
  const [rewriteSummary, setRewriteSummary] = useState(false);
  const confirmLabel = hidden
    ? rewriteSummary
      ? t("chat.turn.hideRewrite")
      : t("chat.turn.hide")
    : rewriteSummary
      ? t("chat.turn.showRewrite")
      : t("chat.turn.show");
  return (
    <ConfirmDialog
      title={hidden ? t("chat.turn.hideTitle") : t("chat.turn.showTitle")}
      description={hidden ? t("chat.turn.hideBody") : t("chat.turn.showBody")}
      confirmLabel={confirmLabel}
      busy={busy ? { target: "confirm", label: t("chat.turn.saving") } : undefined}
      onConfirm={() => onConfirm(rewriteSummary)}
      onCancel={onCancel}
    >
      <SummaryChoice
        note={hidden ? t("chat.turn.summaryNote") : t("chat.turn.summaryLeavesOut")}
        model={summaryModel}
        checked={rewriteSummary}
        disabled={busy}
        onChange={setRewriteSummary}
      />
    </ConfirmDialog>
  );
}
