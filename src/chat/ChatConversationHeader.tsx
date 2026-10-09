import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * The head of the open conversation (Coach Workbench review, R1): its name,
 * its analyses, and the way to what it has made.
 *
 * It replaced a header that said "Training Coach" — the rail already names
 * the screen — over a separate strip reading "Reads: … AI: …". The open
 * conversation's name appeared nowhere outside the list, and the strip was a
 * button that did not look like one. The AI is not here, nor what Coach may
 * read, nor Coach settings: all are in the composer, where the next turn is
 * sent from — what it reads is the Permissions section of the AI chip's sheet.
 */
export function ChatConversationHeader({
  title,
  subtitle,
  onRename,
  analyses,
  creations,
  creationsOpen,
  onToggleCreations,
  trailing
}: {
  title: string;
  subtitle?: string;
  /** Absent while there is no conversation to rename. */
  onRename?: (title: string) => void;
  /** The conversation's analyses control, as the analyses feature draws it. */
  analyses: ReactNode;
  creations: number;
  creationsOpen: boolean;
  onToggleCreations: () => void;
  /** Anything a provider needs beside the rest, such as ChatGPT's Sign out. */
  trailing?: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setDraft(title);
  }, [title, editing]);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== title) onRename?.(next);
  };

  return (
    <div className="chat-header">
      <div className="chat-header-title">
        {editing ? (
          <input
            ref={inputRef}
            id="chat-conversation-title-input"
            className="chat-conversation-title-input"
            value={draft}
            aria-label="Conversation name"
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === "Enter") commit();
              if (event.key === "Escape") {
                setDraft(title);
                setEditing(false);
              }
            }}
          />
        ) : (
          <button
            type="button"
            className="chat-conversation-title"
            data-action="renameConversation"
            onClick={() => onRename && setEditing(true)}
            disabled={!onRename}
            title={onRename ? "Rename this conversation" : undefined}
          >
            {title}
          </button>
        )}
        {/* Always drawn, empty or not: a conversation with nothing under
            its name made the head a line shorter, and switching to it moved
            the list and the transcript up under the pointer. */}
        <span className="chat-conversation-subtitle">{subtitle}</span>
      </div>
      <div className="chat-header-end">
        {analyses}
        <button
          type="button"
          className="chat-creations-pill"
          aria-expanded={creationsOpen}
          aria-controls="chat-creations-panel"
          disabled={creations === 0}
          onClick={onToggleCreations}
          title={
            creations === 0
              ? "Nothing made in this conversation yet"
              : creationsOpen
                ? "Close the Workbench"
                : "Open the Workbench: what Coach made here"
          }
        >
          {creationsOpen ? (
            <PanelRightClose size={13} aria-hidden="true" />
          ) : (
            <PanelRightOpen size={13} aria-hidden="true" />
          )}
          Workbench
          <span className="chat-creations-count">{creations}</span>
        </button>
        {trailing}
      </div>
    </div>
  );
}
