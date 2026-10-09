import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { STAGE_NUMERALS, type LabourState } from "./labours";
import { formatDayShort } from "./milestones";
import { LabourEmblem, LaurelWreath } from "./recordsIcons";
import type { Announcement } from "./recordsNotices";
import { t } from "../i18n/core";
import { labourMyth, labourName, labourStage } from "./labourWords";
import "./recordsNotices.css";

/**
 * A labour stage reached, said once, in the app's toast stack: the medal, the
 * labour and its stage, the sentence of the milestone that reached it, and a
 * way to the hall. Every screen can raise it, so it lives in the main bundle
 * with its stylesheet rather than with the hall's chunk.
 */
export function LabourToastCard({
  announcement,
  labour,
  onOpen,
  onDismiss
}: {
  announcement: Announcement;
  labour: LabourState;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  const milestone = announcement.milestone;
  return (
    <div className="labour-toast" role="status">
      <button type="button" className="labour-toast-close" aria-label={t("records.toast.dismiss")} onClick={onDismiss}>
        <X size={14} aria-hidden="true" />
      </button>
      <LabourEmblem id={labour.definition.id} reached={labour.reached} size="toast" />
      <p className="labour-toast-eyebrow">{t("records.toast.advanced")}</p>
      <p className="labour-toast-title">
        {labourName(labour.definition.id)} — {t("records.stageOfThree", { stage: STAGE_NUMERALS[announcement.stage] })}
      </p>
      {milestone ? (
        <p className="labour-toast-text">
          {t("records.toast.text", { title: milestone.title, day: formatDayShort(milestone.day) })}
        </p>
      ) : null}
      <div className="labour-toast-pips" aria-label={t("records.stagesReached", { n: labour.reached })}>
        {[1, 2, 3].map((index) => (
          <span key={index} className={index <= labour.reached ? "is-reached" : ""} />
        ))}
      </div>
      <button type="button" className="labour-toast-link" onClick={onOpen}>
        {t("records.toast.view")}
      </button>
    </div>
  );
}

/**
 * A labour complete: the one moment the hall interrupts. A dialog with a
 * close (X), so Escape closes it too.
 */
export function LabourCelebration({
  labour,
  completed,
  onSeeLabours,
  onClose
}: {
  labour: LabourState;
  /** How many of the twelve are complete now, this one included. */
  completed: number;
  onSeeLabours: () => void;
  onClose: () => void;
}) {
  const primaryRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    primaryRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const { definition } = labour;
  return (
    <div className="labour-celebration-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        className="labour-celebration"
        role="dialog"
        aria-modal="true"
        aria-labelledby="labour-celebration-title"
        aria-describedby="labour-celebration-myth"
      >
        <button type="button" className="labour-celebration-close" aria-label={t("common.close")} onClick={onClose}>
          <X size={18} aria-hidden="true" />
        </button>
        <div className="labour-celebration-art" aria-hidden="true">
          <LaurelWreath size={168} />
        </div>
        <p className="labour-celebration-eyebrow">
          {t("records.celebration.eyebrow", { n: completed })}
        </p>
        <div className="labour-celebration-labour">
          <LabourEmblem id={definition.id} reached={3} size="hero" />
          <div>
            <h2 id="labour-celebration-title">{labourName(definition.id)}</h2>
            <p id="labour-celebration-myth" className="labour-celebration-myth">
              {labourMyth(definition.id)}
            </p>
          </div>
        </div>
        <ol className="labour-celebration-stages">
          {labour.stages.map((stage) => (
            <li key={stage.stage}>
              <span className="labour-celebration-pip">{STAGE_NUMERALS[stage.stage]}</span>
              <span>{labourStage(definition.id, stage.stage)}</span>
              <span className="labour-celebration-date">
                {stage.reached ? formatDayShort(stage.reached.day) : ""}
              </span>
            </li>
          ))}
        </ol>
        <div className="labour-celebration-actions">
          <button ref={primaryRef} type="button" className="primary-button" onClick={onSeeLabours}>
            {t("records.celebration.see")}
          </button>
          <button type="button" className="secondary-button" onClick={onClose}>
            {t("common.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
