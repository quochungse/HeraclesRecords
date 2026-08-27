import { useMemo, useState } from "react";
import { Loader2, PanelLeftClose, Pin, Plus, Search } from "lucide-react";
import type {
  ChatSessionSummary,
  CoachAutomationSessionAttention
} from "../../electron/types";
import { ChatSessionRow } from "./ChatSessionRow";
import { groupChatSessions } from "./chatSessionGroups";

export function ChatHistoryPanel({
  sessions,
  activeSessionId,
  busy,
  attention,
  onCollapse,
  onNewChat,
  onSelectSession,
  onTogglePinSession,
  onDeleteSession
}: {
  sessions: ChatSessionSummary[];
  activeSessionId: string | null;
  busy?: boolean;
  /** Coach attention per conversation, keyed by session id (9.3). */
  attention?: Map<string, CoachAutomationSessionAttention>;
  onCollapse: () => void;
  onNewChat: () => void;
  onSelectSession: (sessionId: string) => void;
  onTogglePinSession: (sessionId: string, pinned: boolean) => void;
  onDeleteSession: (sessionId: string) => void;
}) {
  const [query, setQuery] = useState("");

  const filteredSessions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return sessions;
    }
    return sessions.filter(
      (session) =>
        session.title.toLowerCase().includes(normalized) ||
        session.preview.toLowerCase().includes(normalized)
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
          <p className="eyebrow">Conversations</p>
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
        <button
          type="button"
          className="chat-new-chat chat-new-chat-sidebar"
          onClick={onNewChat}
          disabled={busy}
        >
          <Plus size={14} aria-hidden="true" />
          New chat
        </button>
        <label className="chat-history-search">
          <Search size={14} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search chats"
            spellCheck={false}
          />
        </label>
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
                    onSelect={() => onSelectSession(session.id)}
                    onTogglePin={() =>
                      onTogglePinSession(session.id, !session.pinnedAt)
                    }
                    onDelete={() => onDeleteSession(session.id)}
                  />
                ))}
              </div>
            </section>
          ))
        )}
      </div>

      {busy ? (
        <div className="chat-sidebar-busy" aria-hidden="true">
          <Loader2 className="chat-spinner" size={16} />
        </div>
      ) : null}
    </div>
  );
}
