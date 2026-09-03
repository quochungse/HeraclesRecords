import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronRight, Loader2, X } from "lucide-react";
import type { ChatContextInspection, ChatMessage } from "../../electron/types";

/**
 * Dev-build only: what the next turn in this conversation would actually send.
 *
 * The whole point of compaction is that it is invisible — the transcript on
 * screen is complete whatever the model was given. That is right for the
 * athlete and useless while building it, because the two only diverge once a
 * roll has happened and nothing on screen says it did. This is the view that
 * shows the divergence.
 *
 * It reports; it never rolls. See `inspectChatSessionContext`.
 */
export function ContextHistoryDialog({
  title,
  inspection,
  error,
  onClose
}: {
  title: string;
  inspection: ChatContextInspection | null;
  error: string | null;
  onClose: () => void;
}) {
  useEffect(() => {
    // Capture phase, the same as the base-instructions dialog: Escape closes
    // this without also reaching whatever is listening underneath it.
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [onClose]);

  return createPortal(
    <div
      className="chat-base-instructions-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="chat-context-history-title"
      onClick={onClose}
    >
      <div
        className="panel chat-base-instructions-dialog chat-context-history-dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="chat-base-instructions-header">
          <h4 id="chat-context-history-title">
            Context history <span className="chat-context-dev-tag">Dev</span>
          </h4>
          <button
            type="button"
            className="icon-button"
            aria-label="Close context history"
            onClick={onClose}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </header>
        <div className="chat-base-instructions-body">
          {error ? (
            <p className="chat-settings-copy">{error}</p>
          ) : inspection === null ? (
            <p className="chat-settings-copy">
              <Loader2 className="chat-spinner" size={14} aria-hidden="true" />{" "}
              Reading…
            </p>
          ) : (
            <ContextHistoryBody title={title} inspection={inspection} />
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

function ContextHistoryBody({
  title,
  inspection
}: {
  title: string;
  inspection: ChatContextInspection;
}) {
  const {
    summary,
    through,
    window: contextWindow,
    enabled,
    entryCount,
    tailStart,
    pending,
    tail,
    characterCount
  } = inspection;
  const uncovered = entryCount - through;

  return (
    <div className="chat-context-history">
      <p className="chat-settings-copy">
        What the next message in <strong>{title}</strong> would send. The
        transcript on screen is unaffected either way — this is the context
        window, not the record.
      </p>

      <dl className="chat-context-stats">
        <Stat label="Entries" value={String(entryCount)} />
        <Stat
          label="Summarised"
          value={summary ? `${through} at the head` : "none yet"}
        />
        <Stat label="Past the summary" value={`${uncovered} / ${contextWindow.limit}`} />
        <Stat label="Tail starts at" value={String(tailStart)} />
        <Stat label="Sent as turns" value={String(pending.length + tail.length + (summary ? 1 : 0))} />
        <Stat label="Characters" value={characterCount.toLocaleString()} />
      </dl>

      {!enabled ? (
        <p className="chat-context-flag">
          Automatic compaction is off, so this conversation is being sent whole.
          What follows is the plan that would apply if it were on.
        </p>
      ) : pending.length ? (
        <p className="chat-context-flag">
          A roll is due: the next message folds the {pending.length} turn
          {pending.length === 1 ? "" : "s"} below into the summary first. Until
          then they are still going over in full.
        </p>
      ) : null}

      <Section
        heading={summary ? "Rolling summary" : "Rolling summary — none yet"}
        count={summary ? 1 : 0}
        defaultOpen={Boolean(summary)}
      >
        {summary ? (
          <pre>{summary}</pre>
        ) : (
          <p className="chat-settings-copy">
            Nothing has been rolled here. Every entry below goes over verbatim.
          </p>
        )}
      </Section>

      {pending.length ? (
        <Section
          heading="Folded in on the next message"
          count={pending.length}
          defaultOpen={false}
        >
          <MessageList messages={pending} />
        </Section>
      ) : null}

      <Section heading="Sent verbatim" count={tail.length} defaultOpen>
        {tail.length ? (
          <MessageList messages={tail} />
        ) : (
          <p className="chat-settings-copy">Nothing yet.</p>
        )}
      </Section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="chat-context-stat">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function Section({
  heading,
  count,
  defaultOpen,
  children
}: {
  heading: string;
  count: number;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  return (
    <section className="chat-context-section">
      <button
        type="button"
        className="chat-context-section-toggle"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {open ? (
          <ChevronDown size={13} aria-hidden="true" />
        ) : (
          <ChevronRight size={13} aria-hidden="true" />
        )}
        <span>{heading}</span>
        <span className="chat-context-section-count">{count}</span>
      </button>
      {open ? <div className="chat-context-section-body">{children}</div> : null}
    </section>
  );
}

function MessageList({ messages }: { messages: ChatMessage[] }) {
  return (
    <ol className="chat-context-messages">
      {messages.map((message, index) => (
        <li key={index} className={`is-${message.role}`}>
          <span className="chat-context-message-role">
            {message.role === "user" ? "Athlete" : "Coach"}
          </span>
          <pre>{message.content}</pre>
        </li>
      ))}
    </ol>
  );
}
