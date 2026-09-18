import { Check, ChevronDown } from "lucide-react";
import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState
} from "react";
import { createPortal } from "react-dom";

export type SelectOption<T extends string> = {
  value: T;
  label: string;
  /**
   * Extra wording shown only in the open menu. The trigger stays on `label`, so
   * a long qualifier can describe an option without widening the closed pill.
   */
  detail?: string;
};

export interface SelectDropdownProps<T extends string> {
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  label: string;
  className?: string;
  menuClassName?: string;
  renderIcon?: (value: T) => ReactNode;
  disabled?: boolean;
  portal?: boolean;
  title?: string;
  /**
   * Floor for the open menu's width, over and above the trigger's own. Raise it
   * for options whose text would otherwise wrap over several lines; the closed
   * trigger is unaffected.
   */
  minMenuWidth?: number;
}

interface MenuPosition {
  left: number;
  top: number;
  minWidth: number;
  maxWidth: number;
  maxHeight: number;
  transform?: string;
}

type PortalTheme = CSSProperties & Record<`--${string}`, string>;

/*
 * Carried onto the portalled menu because it hangs off <body> and so inherits
 * from :root, not from the scope the trigger sits in — the Coach rail
 * redefines --accent and --surface for itself, and a menu that missed them
 * came out in the app's colours inside a screen wearing its own.
 */
const PORTAL_THEME_VARIABLES = [
  "--menu-surface",
  "--surface",
  "--glass-border",
  "--glass-bg-hover",
  "--text-primary",
  "--text-secondary",
  "--accent",
  "--accent-soft",
  "--accent-strong",
  "--radius-sm"
] as const;

/**
 * The gap between the trigger and the menu, and the margin the menu keeps from
 * the edge of the window. Named because the height arithmetic spends both.
 */
const MENU_GAP = 6;
const VIEWPORT_MARGIN = 8;

export function SelectDropdown<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
  menuClassName,
  renderIcon,
  disabled = false,
  portal = false,
  title,
  minMenuWidth
}: SelectDropdownProps<T>) {
  const dropdownId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const typeaheadRef = useRef({ query: "", updatedAt: 0 });
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedValue, setHighlightedValue] = useState<T>(value);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
  const [portalTheme, setPortalTheme] = useState<PortalTheme>({});
  const selectedOption = options.find((option) => option.value === value);
  const selectedLabel = selectedOption?.label ?? "Select";
  const selectedIcon = renderIcon?.(value);
  // A boolean rather than the array itself, because this feeds the position
  // callback: `options` is rebuilt by most callers on every render, and a
  // callback that changed with it would re-run the layout effect, which sets
  // state, which renders again — a loop with no exit.
  const hasDetail = options.some((option) => option.detail !== undefined);
  const labelId = `${dropdownId}-label`;
  const valueId = `${dropdownId}-value`;
  const menuId = `${dropdownId}-menu`;

  const openMenu = useCallback(() => {
    setIsOpen(true);
  }, []);

  /**
   * Closing is immediate. There was a 180ms window where the menu stayed
   * mounted to play a close animation out, which is the one thing a picker
   * should not spend time on: the choice is made, and the list sitting there
   * fading is in the way of reading the result of it.
   */
  const closeMenu = useCallback(() => {
    setIsOpen(false);
  }, []);

  const updateMenuPosition = useCallback(() => {
    if (!portal || !triggerRef.current) return;

    const trigger = triggerRef.current.getBoundingClientRect();
    const computedStyle = window.getComputedStyle(triggerRef.current);

    /*
     * The menu is sized by its own content — `width: max-content` in the
     * stylesheet — between a floor and a cap given here. The floor is the
     * trigger, so the open list never comes out narrower than the control it
     * belongs to; anything wider than that is the list's own doing.
     *
     * It used to be handed one width, max(trigger, 220px), which was wrong in
     * both directions at once: a period pill 90px wide opened a 220px menu that
     * was half empty, and a list of model names was ellipsised inside the same
     * 220px. Neither number was measured.
     *
     * The cap is the window, except where an option carries a `detail` — that
     * is a sentence, and a sentence has no natural width, so `max-content`
     * would run it off the screen. Those menus cap at the floor instead, which
     * is what `.app-select-option-label.has-detail` wraps inside; their caller
     * raises the floor to suit (ModelSwitch asks for 420).
     */
    const viewportCap = window.innerWidth - VIEWPORT_MARGIN * 2;
    const minWidth = Math.min(
      Math.max(trigger.width, minMenuWidth ?? 0),
      viewportCap
    );
    const maxWidth = hasDetail ? minWidth : viewportCap;

    /*
     * The height the list actually wants, not a number picked in advance. It
     * used to be capped at 280px whatever the list held, so a nine-sport
     * picker and every model list opened already scrolled — with the scrollbar
     * as the only sign there was more. `scrollHeight` is the content, and the
     * border it does not include is added back, so a list that fits shows a
     * menu exactly as tall as itself and no scrollbar at all. What is left
     * bounding it is the window, which is a real limit rather than a guess.
     */
    const menu = menuRef.current;
    // Only trusted once the menu has been laid out. Before that there is
    // nothing to read, and a height taken from a box with no width reports
    // every label wrapped onto its own lines — several times the real one,
    // which would open every menu at the full height of the window.
    const measured = menu !== null && menu.clientWidth > 0;
    const border = measured ? menu.offsetHeight - menu.clientHeight : 0;

    const roomBelow = window.innerHeight - trigger.bottom - VIEWPORT_MARGIN;
    const roomAbove = trigger.top - VIEWPORT_MARGIN;
    const availableBelow = Math.max(96, roomBelow - MENU_GAP);
    const availableAbove = Math.max(96, roomAbove - MENU_GAP);
    const wanted = measured ? menu.scrollHeight + border : availableBelow;
    const opensUp = roomBelow < Math.min(wanted, 180) && roomAbove > roomBelow;
    const availableRoom = opensUp ? availableAbove : availableBelow;

    // Keeping it on screen needs the width it settled at, which only the
    // second pass knows; the first uses the floor, which is the trigger's own
    // and so is already where the menu belongs.
    const width = measured ? menu.offsetWidth : minWidth;

    setMenuPosition({
      left: Math.max(
        VIEWPORT_MARGIN,
        Math.min(trigger.left, window.innerWidth - width - VIEWPORT_MARGIN)
      ),
      top: opensUp ? trigger.top - MENU_GAP : trigger.bottom + MENU_GAP,
      minWidth,
      maxWidth,
      maxHeight: Math.min(wanted, availableRoom),
      transform: opensUp ? "translateY(-100%)" : undefined
    });
    setPortalTheme({
      ...(Object.fromEntries(
        PORTAL_THEME_VARIABLES.map((name) => [
          name,
          computedStyle.getPropertyValue(name)
        ])
      ) as PortalTheme),
      // The open list reads at the size the closed control does. Portalled to
      // <body>, the menu inherits the page's 14px, so a 12px pill used to open
      // a 14px list — the same control in two type sizes, a step apart.
      "--app-select-font-size": computedStyle.fontSize
    });
  }, [portal, minMenuWidth, hasDetail]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setHighlightedValue(value);

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        closeMenu();
      }
    }

    function handleDocumentKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape" || event.key === "Tab") {
        closeMenu();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleDocumentKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleDocumentKeyDown);
    };
  }, [closeMenu, isOpen, value]);

  useLayoutEffect(() => {
    if (!isOpen || !portal) {
      setMenuPosition(null);
      return;
    }

    updateMenuPosition();
    // Measured twice: the first pass runs before the menu has been laid out at
    // the width this pass gives it, and a list that wraps is taller at 200px
    // than it was at its natural width. The second reading is the one that
    // decides whether it scrolls.
    const frame = window.requestAnimationFrame(updateMenuPosition);

    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(updateMenuPosition);
    if (triggerRef.current) observer?.observe(triggerRef.current);
    if (menuRef.current) observer?.observe(menuRef.current);
    window.addEventListener("resize", updateMenuPosition);
    // A portalled menu is positioned in viewport coordinates, so anything that
    // scrolls underneath moves the trigger out from under it. `capture` is what
    // reaches the scroll of a panel or dialog, which does not bubble to window.
    window.addEventListener("scroll", updateMenuPosition, true);

    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [isOpen, portal, updateMenuPosition]);

  function moveHighlight(direction: 1 | -1) {
    if (options.length === 0) {
      return;
    }

    const currentIndex = options.findIndex(
      (option) => option.value === highlightedValue
    );
    const fallbackIndex = options.findIndex((option) => option.value === value);
    const startIndex =
      currentIndex >= 0 ? currentIndex : Math.max(fallbackIndex, 0);
    const nextIndex = (startIndex + direction + options.length) % options.length;
    const nextOption = options[nextIndex];

    if (nextOption) {
      setHighlightedValue(nextOption.value);
    }
  }

  function selectOption(nextValue: T) {
    onChange(nextValue);
    setHighlightedValue(nextValue);
    closeMenu();
  }

  function handleTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (disabled) {
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();

      if (!isOpen) {
        openMenu();
        setHighlightedValue(value);
        return;
      }

      moveHighlight(event.key === "ArrowDown" ? 1 : -1);
      return;
    }

    if (isOpen && (event.key === "Home" || event.key === "End")) {
      event.preventDefault();
      const option = event.key === "Home" ? options[0] : options[options.length - 1];
      if (option) setHighlightedValue(option.value);
      return;
    }

    if ((event.key === "Enter" || event.key === " ") && isOpen) {
      event.preventDefault();
      selectOption(highlightedValue);
      return;
    }

    if (event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      const now = Date.now();
      const previous = typeaheadRef.current;
      const query = `${now - previous.updatedAt > 700 ? "" : previous.query}${event.key}`.toLocaleLowerCase();
      typeaheadRef.current = { query, updatedAt: now };
      const match = options.find((option) => option.label.toLocaleLowerCase().startsWith(query));
      if (match) {
        openMenu();
        setHighlightedValue(match.value);
      }
    }
  }

  const menu = isOpen ? (
    <div
      className={[
        "app-select-menu",
        portal ? "is-portaled" : "",
        menuClassName
      ]
        .filter(Boolean)
        .join(" ")}
      id={menuId}
      ref={menuRef}
      role="listbox"
      aria-label={label}
      data-side={menuPosition?.transform ? "top" : "bottom"}
      style={portal ? ({
        ...portalTheme,
        left: menuPosition?.left ?? 0,
        top: menuPosition?.top ?? 0,
        minWidth: menuPosition?.minWidth ?? 0,
        maxWidth: menuPosition?.maxWidth ?? "100%",
        maxHeight: menuPosition?.maxHeight ?? 280,
        transform: menuPosition?.transform,
        visibility: menuPosition ? "visible" : "hidden"
      } satisfies CSSProperties) : undefined}
    >
      <div className="app-select-menu-list">
        {options.map((option) => {
          const isSelected = option.value === value;
          const isActive = option.value === highlightedValue;
          const optionIcon = renderIcon?.(option.value);

          return (
            <button
              type="button"
              className={[
                "app-select-option",
                isSelected ? "is-selected" : "",
                isActive ? "is-active" : ""
              ]
                .filter(Boolean)
                .join(" ")}
              data-value={option.value}
              id={`${dropdownId}-option-${String(option.value)}`}
              key={option.value}
              role="option"
              aria-selected={isSelected}
              onClick={() => selectOption(option.value)}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setHighlightedValue(option.value)}
            >
              <span className="app-select-option-content">
                {optionIcon ? (
                  <span className="app-select-leading-icon" aria-hidden="true">
                    {optionIcon}
                  </span>
                ) : null}
                <span
                  className={[
                    "app-select-option-label",
                    option.detail ? "has-detail" : ""
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  {option.detail
                    ? `${option.label} (${option.detail})`
                    : option.label}
                </span>
              </span>
              {isSelected ? (
                <Check
                  className="app-select-option-check"
                  size={15}
                  strokeWidth={2.6}
                  aria-hidden="true"
                />
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  ) : null;

  return (
    <div
      className={["app-select", className].filter(Boolean).join(" ")}
      data-value={value}
      ref={rootRef}
    >
      <span className="sr-only" id={labelId}>
        {label}
      </span>
      <button
        type="button"
        role="combobox"
        className="app-select-trigger"
        ref={triggerRef}
        aria-controls={menuId}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-activedescendant={isOpen && options.length ? `${dropdownId}-option-${String(highlightedValue)}` : undefined}
        aria-labelledby={`${labelId} ${valueId}`}
        disabled={disabled}
        title={title}
        onClick={() => {
          if (!disabled) {
            if (isOpen) {
              closeMenu();
            } else {
              openMenu();
            }
          }
        }}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className="app-select-value" id={valueId}>
          {selectedIcon ? (
            <span className="app-select-leading-icon" aria-hidden="true">
              {selectedIcon}
            </span>
          ) : null}
          <span className="app-select-value-label">{selectedLabel}</span>
        </span>
        <ChevronDown
          className={isOpen ? "app-select-icon is-open" : "app-select-icon"}
          size={17}
          strokeWidth={2.4}
          aria-hidden="true"
        />
      </button>

      {portal && menu && typeof document !== "undefined"
        ? createPortal(menu, document.body)
        : menu}
    </div>
  );
}
