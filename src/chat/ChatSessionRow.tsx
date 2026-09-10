import {
  Bug,
  Layers,
  Loader2,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Trash2,
  Zap
} from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent
} from "react";
import { createPortal } from "react-dom";
import type {
  ChatSessionSummary,
  CoachAnalysisSessionAttention
} from "../../electron/types";
import { formatSessionRelativeTime } from "./chatSessionGroups";

const MENU_WIDTH = 180;
const MENU_GAP = 6;
const VIEWPORT_MARGIN = 8;
/**
 * `import.meta.env.DEV` is a compile-time constant, so the inspector's menu
 * item and its handler are dropped from a production bundle rather than merely
 * hidden in one.
 */
const IS_DEVELOPMENT_BUILD = import.meta.env.DEV;

/**
 * Used only for the first placement pass, before the menu can be measured — so
 * it has to count the dev item, or a menu near the bottom of the screen flips
 * on its second frame in exactly the build where it is opened most.
 */
const MENU_ESTIMATED_HEIGHT = IS_DEVELOPMENT_BUILD ? 192 : 158;

/**
 * The chat view rescopes part of the palette (see `.chat-view` in styles.css),
 * which a popover mounted on <body> would otherwise miss.
 */
const PORTAL_THEME_VARIABLES = [
  "--surface",
  "--glass-border",
  "--glass-bg-hover",
  "--text-primary",
  "--error-text",
  "--error-bg",
  "--radius-sm",
  "--radius-md",
  "--shadow-elevated"
] as const;

type PortalTheme = CSSProperties & Record<`--${string}`, string>;

/**
 * The session list scrolls and clips its own overflow, so the popover is
 * portaled to the body and positioned against the trigger instead.
 */
function ChatSessionRowMenu({
  session,
  pinned,
  disabled,
  compacting,
  onTogglePin,
  onRename,
  onCompact,
  onShowContext,
  onDelete
}: {
  session: ChatSessionSummary;
  pinned: boolean;
  disabled?: boolean;
  /** A summariser turn is running for this conversation. */
  compacting?: boolean;
  onTogglePin: () => void;
  /** Turns the row's title into an input; the row owns the edit itself. */
  onRename: () => void;
  onCompact: () => void;
  onShowContext: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<CSSProperties | null>(null);
  const [theme, setTheme] = useState<PortalTheme>({});
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }

    const place = () => {
      if (!triggerRef.current) return;
      const trigger = triggerRef.current.getBoundingClientRect();
      const height = menuRef.current?.offsetHeight || MENU_ESTIMATED_HEIGHT;
      const opensUp =
        trigger.bottom + MENU_GAP + height > window.innerHeight - VIEWPORT_MARGIN &&
        trigger.top - MENU_GAP - height > VIEWPORT_MARGIN;
      setPosition({
        left: Math.max(
          VIEWPORT_MARGIN,
          Math.min(
            trigger.right - MENU_WIDTH,
            window.innerWidth - MENU_WIDTH - VIEWPORT_MARGIN
          )
        ),
        top: opensUp ? trigger.top - MENU_GAP - height : trigger.bottom + MENU_GAP,
        width: MENU_WIDTH
      });

      const computed = window.getComputedStyle(triggerRef.current);
      setTheme(
        Object.fromEntries(
          PORTAL_THEME_VARIABLES.map((name) => [
            name,
            computed.getPropertyValue(name)
          ])
        ) as PortalTheme
      );
    };

    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !triggerRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    // A body-level popover cannot follow the row once the list scrolls.
    const handleScroll = () => setOpen(false);

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const runAction = (event: MouseEvent, action: () => void) => {
    event.stopPropagation();
    setOpen(false);
    action();
  };

  const menu = (
    <div
      className="chat-session-row-popover"
      ref={menuRef}
      role="menu"
      aria-label={`Actions for ${session.title}`}
      style={{
        ...theme,
        ...(position ?? { left: 0, top: 0, width: MENU_WIDTH }),
        visibility: position ? "visible" : "hidden"
      }}
    >
      <button
        type="button"
        role="menuitem"
        onClick={(event) => runAction(event, onTogglePin)}
      >
        {pinned ? (
          <PinOff size={15} aria-hidden="true" />
        ) : (
          <Pin size={15} aria-hidden="true" />
        )}
        {pinned ? "Unpin" : "Pin"}
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={(event) => runAction(event, onRename)}
      >
        <Pencil size={15} aria-hidden="true" />
        Rename
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={compacting || session.messageCount === 0}
        title="Summarise the older turns so the next message costs less"
        onClick={(event) => runAction(event, onCompact)}
      >
        {compacting ? (
          <Loader2 className="chat-spinner" size={15} aria-hidden="true" />
        ) : (
          <Layers size={15} aria-hidden="true" />
        )}
        Compact context
      </button>
      {IS_DEVELOPMENT_BUILD ? (
        <button
          type="button"
          role="menuitem"
          title="What the next message would actually send"
          onClick={(event) => runAction(event, onShowContext)}
        >
          <Bug size={15} aria-hidden="true" />
          Show context history
          <span className="chat-session-row-dev-tag">Dev</span>
        </button>
      ) : null}
      <button
        className="is-danger"
        type="button"
        role="menuitem"
        onClick={(event) => runAction(event, onDelete)}
      >
        <Trash2 size={15} aria-hidden="true" />
        Delete
      </button>
    </div>
  );

  return (
    <>
      <button
        type="button"
        className={[
          "chat-session-row-menu-trigger",
          open ? "is-open" : ""
        ]
          .filter(Boolean)
          .join(" ")}
        ref={triggerRef}
        aria-label={`Actions for ${session.title}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Conversation actions"
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((current) => !current);
        }}
      >
        <MoreHorizontal size={15} aria-hidden="true" />
      </button>
      {open && typeof document !== "undefined"
        ? createPortal(menu, document.body)
        : null}
    </>
  );
}

export function ChatSessionRow({
  session,
  active,
  disabled,
  compacting,
  attention,
  onSelect,
  onTogglePin,
  onRename,
  onCompact,
  onShowContext,
  onDelete
}: {
  session: ChatSessionSummary;
  active: boolean;
  disabled?: boolean;
  /** A summariser turn is running for this conversation. */
  compacting?: boolean;
  /** 9.3: whether a coach speaks here, and whether it has said something new. */
  attention?: CoachAnalysisSessionAttention;
  onSelect: () => void;
  onTogglePin: () => void;
  /** Called with the trimmed new title, only when it actually changed. */
  onRename: (title: string) => void;
  onCompact: () => void;
  onShowContext: () => void;
  onDelete: () => void;
}) {
  // The rename happens in place: the title turns into an input on this row
  // rather than opening a dialog over a list the user is scanning.
  const [draft, setDraft] = useState<string | null>(null);
  const renaming = draft !== null;
  const pinned = Boolean(session.pinnedAt);
  // A run that has landed but not been read is worth marking even once the
  // binding is gone: the answer is still sitting in the conversation.
  const unread = attention?.unread ?? 0;
  const attached = attention?.attached ?? false;

  const commitRename = () => {
    if (draft === null) return;
    const next = draft.trim();
    setDraft(null);
    if (next && next !== session.title) onRename(next);
  };

  const handleDelete = () => {
    if (
      session.messageCount === 0 ||
      window.confirm(`Delete "${session.title}"?`)
    ) {
      onDelete();
    }
  };

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      className={[
        "chat-session-row",
        active ? "is-active" : "",
        pinned ? "is-pinned" : "",
        unread > 0 ? "has-unread" : "",
        disabled ? "is-disabled" : ""
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={() => {
        if (!disabled && !renaming) onSelect();
      }}
      onKeyDown={(event) => {
        // Enter/Space on the actions trigger must not also open the chat.
        if (disabled || renaming || event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      title={session.preview || session.title}
    >
      <span className="chat-session-row-body">
        {renaming ? (
          <input
            className="chat-session-row-title-input"
            type="text"
            value={draft ?? ""}
            aria-label="Conversation title"
            // The store truncates past 48 characters; stop short of that so a
            // rename never comes back with an ellipsis the user did not type.
            maxLength={48}
            spellCheck={false}
            autoFocus
            onChange={(event) => setDraft(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
            // The row is a button: a click or a key here must stay local.
            onClick={(event) => event.stopPropagation()}
            onBlur={commitRename}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Enter") {
                event.preventDefault();
                commitRename();
              } else if (event.key === "Escape") {
                event.preventDefault();
                setDraft(null);
              }
            }}
          />
        ) : (
          <span className="chat-session-row-title">
            {pinned ? (
              <Pin
                className="chat-session-row-pin-mark"
                size={11}
                aria-hidden="true"
              />
            ) : null}
            {attached || unread > 0 ? (
              <Zap
                className="chat-session-row-analysis-mark"
                size={11}
                role="img"
                aria-label={
                  attached
                    ? "An analysis coach writes into this conversation"
                    : "An analysis coach wrote into this conversation"
                }
              />
            ) : null}
            {session.title}
          </span>
        )}
        {session.preview ? (
          <span className="chat-session-row-preview">{session.preview}</span>
        ) : null}
      </span>
      <span className="chat-session-row-meta">
        <span className="chat-session-row-time-line">
          {/* The dot is what stops the row reordering for no visible reason: an
              auto run changes the transcript, so it bumps the conversation to
              the top of the list (9.3). */}
          {unread > 0 ? (
            <span
              className="chat-session-row-unread"
              role="img"
              aria-label={`${unread} unread coach ${unread === 1 ? "run" : "runs"}`}
            />
          ) : null}
          <span className="chat-session-row-time">
            {formatSessionRelativeTime(session.updatedAt)}
          </span>
        </span>
        <ChatSessionRowMenu
          session={session}
          pinned={pinned}
          disabled={disabled}
          compacting={compacting}
          onTogglePin={onTogglePin}
          onRename={() => setDraft(session.title)}
          onCompact={onCompact}
          onShowContext={onShowContext}
          onDelete={handleDelete}
        />
      </span>
    </div>
  );
}
