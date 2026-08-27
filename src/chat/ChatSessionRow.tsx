import { MoreHorizontal, Pin, PinOff, Trash2, Zap } from "lucide-react";
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
  CoachAutomationSessionAttention
} from "../../electron/types";
import { formatSessionRelativeTime } from "./chatSessionGroups";

const MENU_WIDTH = 180;
const MENU_GAP = 6;
const VIEWPORT_MARGIN = 8;
/** Used only for the first placement pass, before the menu can be measured. */
const MENU_ESTIMATED_HEIGHT = 92;

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
  onTogglePin,
  onDelete
}: {
  session: ChatSessionSummary;
  pinned: boolean;
  disabled?: boolean;
  onTogglePin: () => void;
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
  attention,
  onSelect,
  onTogglePin,
  onDelete
}: {
  session: ChatSessionSummary;
  active: boolean;
  disabled?: boolean;
  /** 9.3: whether a coach speaks here, and whether it has said something new. */
  attention?: CoachAutomationSessionAttention;
  onSelect: () => void;
  onTogglePin: () => void;
  onDelete: () => void;
}) {
  const pinned = Boolean(session.pinnedAt);
  // A run that has landed but not been read is worth marking even once the
  // binding is gone: the answer is still sitting in the conversation.
  const unread = attention?.unread ?? 0;
  const attached = attention?.attached ?? false;

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
        if (!disabled) onSelect();
      }}
      onKeyDown={(event) => {
        // Enter/Space on the actions trigger must not also open the chat.
        if (disabled || event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      title={session.preview || session.title}
    >
      <span className="chat-session-row-body">
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
              className="chat-session-row-automation-mark"
              size={11}
              role="img"
              aria-label={
                attached
                  ? "An automation coach writes into this conversation"
                  : "An automation coach wrote into this conversation"
              }
            />
          ) : null}
          {session.title}
        </span>
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
          onTogglePin={onTogglePin}
          onDelete={handleDelete}
        />
      </span>
    </div>
  );
}
