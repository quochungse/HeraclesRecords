import { useMemo, useState } from "react";
import { PanelLeftClose, Pin, Plus, Search, X } from "lucide-react";
import type {
  ChatSessionSummary,
  CoachAnalysisSessionAttention
} from "../../electron/types";
import { ChatSessionRow } from "./ChatSessionRow";
import { groupChatSessions } from "./chatSessionGroups";

export function ChatHistoryPanel({
  sessions,
  activeSessionId,
  busy,
  attention,
  compactingSessionId,
  answeringSessionId,
  onCollapse,
  onNewChat,
  onSelectSession,
  onTogglePinSession,
  onRenameSession,
  onCompactSession,
  onShowSessionContext,
  onDeleteSession
}: {
  sessions: ChatSessionSummary[];
  activeSessionId: string | null;
  busy?: boolean;
  /** Coach attention per conversation, keyed by session id (9.3). */
  attention?: Map<string, CoachAnalysisSessionAttention>;
  /** The conversation a summariser turn is running for, if any. */
  compactingSessionId?: string | null;
  /** The conversation Coach is answering in: its row says so, the list stays open (UAT). */
  answeringSessionId?: string | null;
  onCollapse: () => void;
  onNewChat: () => void;
  onSelectSession: (sessionId: string) => void;
  onTogglePinSession: (sessionId: string, pinned: boolean) => void;
  onRenameSession: (sessionId: string, title: string) => void;
  onCompactSession: (sessionId: string) => void;
  /** Dev builds only: opens the context inspector for one conversation. */
  onShowSessionContext: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
}) {
  const [query, setQuery] = useState("");
  /* Search folds to an icon at the end of the New chat box (UAT, A2) and
     takes the whole box while it is open. */
  const [searchOpen, setSearchOpen] = useState(false);
  const searching = searchOpen || query.length > 0;
  const closeSearch = () => {
    setQuery("");
    setSearchOpen(false);
  };
  const filteredSessions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return sessions;
    }
    return sessions.filter(
      (session) =>
        // A summary may come without a preview (a conversation never written
        // in); searching must not throw on it and take the whole screen down.
        (session.title ?? "").toLowerCase().includes(normalized) ||
        (session.preview ?? "").toLowerCase().includes(normalized)
    );
  }, [query, sessions]);

  const groups = useMemo(
    () => groupChatSessions(filteredSessions),
    [filteredSessions]
  );

  return (
    <div className="chat-history-panel">
      <div className="chat-history-toolbar">
        <div className="chat-history-header">
          <h2 className="chat-history-title">Conversations</h2>
          <button
            type="button"
            className="chat-history-collapse-button"
            onClick={onCollapse}
            aria-expanded="true"
            aria-controls="chat-conversation-sidebar"
            aria-label="Collapse conversations"
            title="Collapse conversations"
          >
            <PanelLeftClose size={16} aria-hidden="true" />
          </button>
        </div>
        {/* One box at the head of the list (UAT, A2): New chat, in the accent's
            ink, and search folded to an icon at its end. */}
        {searching ? (
          <div className="chat-history-actions is-searching">
            <label className="chat-history-search-field">
              <Search size={14} aria-hidden="true" />
              <input
                type="search"
                value={query}
                autoFocus
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Escape") return;
                  event.stopPropagation();
                  closeSearch();
                }}
                placeholder="Search chats"
                aria-label="Search chats"
                spellCheck={false}
              />
            </label>
            <button
              type="button"
              className="chat-history-actions-icon"
              onClick={closeSearch}
              aria-label="Close search"
              title="Close search"
            >
              <X size={15} aria-hidden="true" />
            </button>
          </div>
        ) : (
          <div className="chat-history-actions">
            <button
              type="button"
              className="chat-history-new chat-new-chat-sidebar"
              onClick={onNewChat}
              disabled={busy}
              aria-label="New chat"
            >
              <Plus size={15} aria-hidden="true" />
              New chat
            </button>
            <span className="chat-history-actions-divider" aria-hidden="true" />
            <button
              type="button"
              className="chat-history-actions-icon"
              onClick={() => setSearchOpen(true)}
              aria-label="Search chats"
              title="Search chats"
            >
              <Search size={15} aria-hidden="true" />
            </button>
          </div>
        )}
      </div>

      <div className="chat-session-list">
        {groups.length === 0 ? (
          <p className="chat-history-empty">
            {query.trim() ? "No chats match your search." : "No conversations yet."}
          </p>
        ) : (
          groups.map((group) => (
            <section
              key={group.label}
              className={[
                "chat-session-group",
                group.label === "Pinned" ? "is-pinned-group" : ""
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <h3 className="chat-session-group-label">
                {group.label === "Pinned" ? (
                  <Pin size={11} aria-hidden="true" />
                ) : null}
                {group.label === "Pinned" ? "Pinned conversations" : group.label}
              </h3>
              <div className="chat-session-group-list">
                {group.sessions.map((session) => (
                  <ChatSessionRow
                    key={session.id}
                    session={session}
                    active={session.id === activeSessionId}
                    disabled={busy}
                    attention={attention?.get(session.id)}
                    compacting={compactingSessionId === session.id}
                    answering={answeringSessionId === session.id}
                    onSelect={() => onSelectSession(session.id)}
                    onTogglePin={() =>
                      onTogglePinSession(session.id, !session.pinnedAt)
                    }
                    onRename={(title) => onRenameSession(session.id, title)}
                    onCompact={() => onCompactSession(session.id)}
                    onShowContext={() => onShowSessionContext(session.id)}
                    onDelete={() => onDeleteSession(session.id)}
                  />
                ))}
              </div>
            </section>
          ))
        )}
      </div>


    </div>
  );
}
