import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { STAGE_NUMERALS, type LabourState } from "./labours";
import { formatDayShort } from "./milestones";
import { LabourGlyph, LabourMedal, LaurelWreath } from "./recordsIcons";
import type { Announcement } from "./recordsNotices";
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
      <button type="button" className="labour-toast-close" aria-label="Dismiss" onClick={onDismiss}>
        <X size={14} aria-hidden="true" />
      </button>
      <LabourMedal id={labour.definition.id} reached={1} size="chip" />
      <p className="labour-toast-eyebrow">Labour advanced</p>
      <p className="labour-toast-title">
        {labour.definition.name} — {STAGE_NUMERALS[announcement.stage]} of III
      </p>
      {milestone ? (
        <p className="labour-toast-text">
          {milestone.title}, {formatDayShort(milestone.day)}.
        </p>
      ) : null}
      <div className="labour-toast-pips" aria-label={`${labour.reached} of 3 stages`}>
        {[1, 2, 3].map((index) => (
          <span key={index} className={index <= labour.reached ? "is-reached" : ""} />
        ))}
      </div>
      <button type="button" className="labour-toast-link" onClick={onOpen}>
        View in Hall of Records
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
        <button type="button" className="labour-celebration-close" aria-label="Close" onClick={onClose}>
          <X size={18} aria-hidden="true" />
        </button>
        <div className="labour-celebration-art" aria-hidden="true">
          <LaurelWreath size={200} />
          <span className="labour-celebration-medal">
            <LabourGlyph id={definition.id} size={42} />
          </span>
        </div>
        <p className="labour-celebration-eyebrow">
          Labour complete · {completed} of 12
        </p>
        <h2 id="labour-celebration-title">{definition.name}</h2>
        <p id="labour-celebration-myth" className="labour-celebration-myth">
          {definition.myth}
        </p>
        <ol className="labour-celebration-stages">
          {labour.stages.map((stage) => (
            <li key={stage.stage}>
              <span className="labour-celebration-pip">{STAGE_NUMERALS[stage.stage]}</span>
              <span>{stage.title}</span>
              <span className="labour-celebration-date">
                {stage.reached ? formatDayShort(stage.reached.day) : ""}
              </span>
            </li>
          ))}
        </ol>
        <div className="labour-celebration-actions">
          <button ref={primaryRef} type="button" className="primary-button" onClick={onSeeLabours}>
            See the Twelve Labours
          </button>
          <button type="button" className="secondary-button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
