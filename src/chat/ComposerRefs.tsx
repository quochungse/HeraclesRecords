import { Activity, CalendarDays, CalendarRange, X } from "lucide-react";
import type { CSSProperties } from "react";
import { sportChipStyle, sportTheme } from "../training-library/sportTheme";
import type { WorkoutSport } from "../../electron/types";
import type { RefPreview } from "./refPreview";

export interface ComposerRef {
  key: string;
  preview: RefPreview;
  onRemove: () => void;
}

/**
 * What the question being written points at, as a header on the composer's
 * box (Coach Workbench UAT, proposal A). One ref: its mark (the plan's weeks
 * with the one asked about in full, or its sport's icon), what it is and its
 * figures — the "Asking about ·" line was taken out (UAT), and what it
 * belongs to is the text's title. Several fold to one line of chips under
 * "About".
 */
export function ComposerRefs({ refs }: { refs: readonly ComposerRef[] }) {
  if (!refs.length) return null;
  if (refs.length > 1) {
    return (
      <div className="chat-ref-header is-list" aria-label="Asking about">
        <span className="chat-ref-header-kicker">About</span>
        {refs.map(({ key, preview, onRemove }) => (
          <span key={key} className="chat-ref-chip" title={`${preview.context} · ${preview.title}`}>
            <RefIcon preview={preview} size={13} />
            {preview.chip}
            <RemoveRef title={preview.chip} onRemove={onRemove} size={13} />
          </span>
        ))}
      </div>
    );
  }
  const [{ preview, onRemove }] = refs;
  return (
    <div className="chat-ref-header" aria-label="Asking about" data-kind={preview.kind}>
      {preview.bars ? <RefRidge preview={preview} /> : <RefIcon preview={preview} size={20} />}
      <div className="chat-ref-header-text" title={`${preview.context} · ${preview.title}`}>
        <strong className="chat-ref-header-title">{preview.title}</strong>
        {preview.detail ? <span className="chat-ref-header-detail">{preview.detail}</span> : null}
      </div>
      <RemoveRef title={preview.title} onRemove={onRemove} size={16} />
    </div>
  );
}

function RemoveRef({ title, onRemove, size }: { title: string; onRemove: () => void; size: number }) {
  return (
    <button type="button" className="chat-ref-remove" aria-label={`Stop asking about ${title}`} onClick={onRemove}>
      <X size={size} aria-hidden="true" />
    </button>
  );
}

/** The plan's weeks as bars in its sport's colour, the week asked about in full. */
function RefRidge({ preview }: { preview: RefPreview }) {
  const bars = preview.bars!;
  return (
    <span className="chat-ref-ridge" style={sportChipStyle(preview.sport)} aria-hidden="true">
      {bars.heights.slice(0, 16).map((height, index) => (
        <span
          key={index}
          className={bars.current === undefined || index === bars.current ? "is-current" : ""}
          style={{ height: `${Math.max(3, Math.round(height * 22))}px` } as CSSProperties}
        />
      ))}
    </span>
  );
}

/** A sport's own icon in its colour, for a sent question's line. */
export function SportRefIcon({ sport }: { sport: WorkoutSport }) {
  const Icon = sportTheme(sport).icon;
  return (
    <span className="chat-ref-icon is-sport" style={sportChipStyle(sport)} aria-hidden="true">
      <Icon size={12} />
    </span>
  );
}

/**
 * A session or an activity: its sport's own icon where the ref knows it, else
 * the default. A plan or a week: the calendar week, as in proposal A.
 */
function RefIcon({ preview, size }: { preview: RefPreview; size: number }) {
  const isSpan = preview.kind === "plan" || preview.kind === "week" || preview.kind === "calendarWeek";
  if (preview.sport && !isSpan) {
    const Icon = sportTheme(preview.sport).icon;
    return (
      <span className="chat-ref-icon is-sport" style={sportChipStyle(preview.sport)} aria-hidden="true">
        <Icon size={size} />
      </span>
    );
  }
  const Icon =
    preview.kind === "activity"
      ? Activity
      : preview.kind === "calendar" || preview.kind === "session"
        ? CalendarDays
        : CalendarRange;
  return (
    <span className="chat-ref-icon" aria-hidden="true">
      <Icon size={size} />
    </span>
  );
}
