/**
 * The ⋯ menu the plan screens share.
 *
 * It was the reader's own, and the editor needed the same thing three times
 * over — for a week, for a session and for the kind of session to create —
 * so it moved here rather than being written again with a different idea of
 * which key closes it.
 *
 * Escape and a press outside close it. Escape is stopped here so it does not
 * go on to close the reader, or the editor, behind it.
 */
import { MoreHorizontal, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export interface PlanMenuItem {
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
  title?: string;
  /** A hairline above this item: the start of a different kind of action. */
  separated?: boolean;
}

interface PlanMenuProps {
  items: PlanMenuItem[];
  /** Names the trigger and the menu, e.g. "Actions for week 3". */
  label?: string;
  /** The trigger's face. Defaults to the ⋯ glyph in an icon button. */
  trigger?: ReactNode;
  triggerClassName?: string;
  className?: string;
  /** Which edge of the trigger the menu hangs from. */
  align?: "start" | "end";
}

export function PlanMenu({
  items,
  label = "More actions",
  trigger,
  triggerClassName = "icon-button",
  className,
  align = "end"
}: PlanMenuProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus();
    const onPress = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPress);
    return () => document.removeEventListener("mousedown", onPress);
  }, [open]);

  if (!items.length) return null;

  const close = () => {
    setOpen(false);
    button.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (!open) return;
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const options = Array.from(
      root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? []
    );
    const at = options.indexOf(document.activeElement as HTMLElement);
    const next = event.key === "ArrowDown" ? at + 1 : at - 1;
    options[(next + options.length) % options.length]?.focus();
  };

  return (
    <div
      className={`plan-more${className ? ` ${className}` : ""}${open ? " is-open" : ""}`}
      ref={root}
      onKeyDown={onKeyDown}
    >
      <button
        ref={button}
        type="button"
        className={triggerClassName}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {trigger ?? <MoreHorizontal size={16} />}
      </button>
      {open ? (
        <div
          className={`plan-more-menu${align === "start" ? " is-start" : ""}`}
          role="menu"
          aria-label={label}
        >
          {items.map((item) => (
            <button
              type="button"
              role="menuitem"
              key={item.label}
              className={[item.danger ? "is-danger" : "", item.separated ? "is-separated" : ""]
                .filter(Boolean)
                .join(" ") || undefined}
              disabled={item.disabled}
              title={item.title}
              onClick={() => {
                close();
                item.onSelect();
              }}
            >
              <item.icon size={14} aria-hidden="true" />
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
