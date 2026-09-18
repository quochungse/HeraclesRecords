import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState
} from "react";
import { SelectDropdown, type SelectOption } from "./SelectDropdown";

/**
 * The one way to offer a choice between options in this app.
 *
 * It exists because the same control had been written thirty times. A period
 * picker on Running, one on Activities, one on Strength, one on the Data
 * screen — each with its own class, its own chip height, its own font weight,
 * and its own answer to what "the last three months" is called. Three of them
 * even disagreed about which ARIA role a group of mutually exclusive buttons
 * takes. None of that was decided; it accumulated, because writing the markup
 * by hand is easy and noticing that it already exists somewhere else is not.
 *
 * Three modes, and the mode is a layout decision rather than a different
 * control — the choice, the state and the keyboard behaviour are identical
 * across all three:
 *
 *   expanded    every option on screen. The default, and what a filter should
 *               be whenever it fits: one click to change, nothing hidden.
 *   collapsible at rest it is the selected chip alone; clicking opens the row
 *               in place, pushing whatever sits beside it. For a header that
 *               is already full, or a list too long to leave open.
 *   dropdown    a trigger and a floating menu, for a list that cannot be a row
 *               at all — nine sports, a watch model, a collection.
 *
 * `mode` is the caller's, and there is deliberately no automatic fallback from
 * `expanded` to `collapsible` when a row does not fit. It was written that way
 * first and it oscillates: the measurement that says "this does not fit" can
 * only be taken while the row is laid out in full, and folding it makes the
 * same measurement say it fits, which unfolds it, which makes it not fit. Every
 * way around that is worse than the problem — a hidden twin of the row to
 * measure against, or a width remembered from a layout that has since changed.
 * A screen that cannot spare the width says `mode="collapsible"`, which its
 * author knows and a measurement has to guess.
 *
 * Multi-select lives in `OptionChips` below rather than behind a flag on this
 * one. They differ in more than arity: several pressed chips inside a single
 * track read as a broken segmented control, so the multi variant has no track,
 * and its ARIA is `aria-pressed` on separate buttons rather than one
 * radiogroup.
 */

export type OptionGroupMode = "expanded" | "collapsible" | "dropdown";

export interface OptionGroupOption<T extends string> {
  value: T;
  label: string;
  /** Sits before the label. Give it `aria-hidden`; the label carries the name. */
  icon?: ReactNode;
  /** Shown only in the dropdown menu, where there is room to qualify a choice. */
  detail?: string;
  disabled?: boolean;
  /** Native tooltip. Use it for a qualifier, never for the only copy of a fact. */
  title?: string;
}

export interface OptionGroupProps<T extends string> {
  options: readonly OptionGroupOption<T>[];
  value: T;
  /**
   * The chip that produced the change rides along, because a caller sometimes
   * needs where the choice was made rather than only what it was — the theme
   * switch animates the swap out of the point that was pressed. It is the
   * element and not a rect or an event: a rect goes stale and an event says
   * nothing when the arrow keys moved the selection.
   */
  onChange: (next: T, from?: HTMLButtonElement) => void;
  /** Names the group for a screen reader. Required: a bare row of chips says nothing. */
  label: string;
  mode?: OptionGroupMode;
  /** `sm` is the header default (28px); `md` (32px) suits a form row. */
  size?: "sm" | "md";
  /**
   * Draws the icons alone and leaves each label to the screen reader. Only for
   * options whose icon is unmistakable on its own — a grid and a list — and
   * never as a way to fit labels that are simply too long, which is what the
   * collapsible mode is for.
   */
  iconOnly?: boolean;
  /**
   * `accent` marks the chosen chip with a wash of the accent and the accent's
   * own ink — the Calendar's Month/Week switch, which is where the mark comes
   * from. `quiet` keeps it neutral, for a filter narrowing something the screen
   * already shows.
   */
  tone?: "accent" | "quiet";
  /**
   * Spans the row and splits it equally between the options. For a labelled
   * form row, where every input beside it is already full width and a chip row
   * that keeps its text width ends in dead space — two options at two
   * different sizes, which nobody chose. It is stated rather than measured for
   * the reason `mode` is: the author knows whether the control owns its row.
   * Nothing in `dropdown` mode, which already fills whatever holds it.
   */
  fill?: boolean;
  className?: string;
  disabled?: boolean;
}

const MODE_CLASS: Record<OptionGroupMode, string> = {
  expanded: "option-group--expanded",
  collapsible: "option-group--collapsible",
  dropdown: "option-group--dropdown"
};

export function OptionGroup<T extends string>({
  options,
  value,
  onChange,
  label,
  mode = "expanded",
  size = "sm",
  tone = "accent",
  iconOnly = false,
  fill = false,
  className,
  disabled = false
}: OptionGroupProps<T>) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const leadRef = useRef<HTMLButtonElement>(null);
  const restRef = useRef<HTMLDivElement>(null);
  /** Set by a selection, so focus returns to the lead only when the athlete chose. */
  const returnFocusRef = useRef(false);

  const selected =
    options.find((option) => option.value === value) ?? options[0] ?? null;

  const close = useCallback(() => {
    setOpen(false);
  }, []);

  useEffect(() => {
    if (mode !== "collapsible" || !open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!trackRef.current?.contains(event.target as Node)) close();
    };
    // Escape is caught on the way down, not on the way up. A collapsible group
    // can sit inside a dialog that closes on Escape from its own listener on
    // `document` — the Profile zone families do — and two listeners on the same
    // node are not separated by stopPropagation(), so the athlete would have
    // folded the chips and closed the dialog with one key. Capturing stops it
    // before it ever reaches the bubble phase those listeners are in.
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      returnFocusRef.current = true;
      close();
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [mode, open, close]);

  // Focus follows the fold: opening puts the keyboard on the row that just
  // appeared, and choosing hands it back to the chip that replaced it. It
  // deliberately does not move when the group closes because the pointer went
  // elsewhere — taking focus back then would steal it from wherever it went.
  useEffect(() => {
    if (mode !== "collapsible") return;
    if (open) {
      restRef.current
        ?.querySelector<HTMLButtonElement>('[aria-checked="true"]')
        ?.focus();
      return;
    }
    if (returnFocusRef.current) {
      returnFocusRef.current = false;
      leadRef.current?.focus();
    }
  }, [mode, open]);

  if (mode === "dropdown") {
    const selectOptions: SelectOption<T>[] = options.map((option) => ({
      value: option.value,
      label: option.label,
      ...(option.detail === undefined ? {} : { detail: option.detail })
    }));
    const renderIcon = options.some((option) => option.icon)
      ? (current: T) =>
          options.find((option) => option.value === current)?.icon ?? null
      : undefined;

    return (
      <SelectDropdown
        value={value}
        options={selectOptions}
        onChange={onChange}
        label={label}
        disabled={disabled}
        portal
        className={[
          "app-select--pill",
          "option-group-select",
          `option-group--${size}`,
          className
        ]
          .filter(Boolean)
          .join(" ")}
        {...(renderIcon ? { renderIcon } : {})}
      />
    );
  }

  /**
   * Arrow keys move through the options and take the selection with them,
   * which is what a radiogroup does — Tab reaches the group, arrows choose
   * inside it, so a keyboard never has to step through four chips to leave.
   */
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (step === 0) return;

    const selectable = options.filter((option) => !option.disabled);
    if (selectable.length < 2) return;

    event.preventDefault();
    const index = selectable.findIndex((option) => option.value === value);
    const next =
      selectable[(index + step + selectable.length) % selectable.length]!;

    const target = event.currentTarget.querySelector<HTMLButtonElement>(
      `[data-option="${CSS.escape(next.value)}"]`
    );
    onChange(next.value, target ?? undefined);
    target?.focus();
  };

  const renderOption = (option: OptionGroupOption<T>, inRest: boolean) => {
    const isSelected = option.value === value;
    return (
      <button
        key={option.value}
        type="button"
        role="radio"
        data-option={option.value}
        aria-checked={isSelected}
        disabled={disabled || option.disabled}
        // Roving tabindex: the group is one tab stop, and it is the selected
        // chip. A folded group's row is not reachable by Tab at all.
        tabIndex={isSelected && (mode === "expanded" || open) ? 0 : -1}
        {...(option.title ? { title: option.title } : {})}
        onClick={(event) => {
          onChange(option.value, event.currentTarget);
          if (inRest) {
            returnFocusRef.current = true;
            close();
          }
        }}
      >
        {option.icon}
        <span className={iconOnly ? "sr-only" : "option-group-label"}>
          {option.label}
        </span>
      </button>
    );
  };

  const classes = [
    "option-group",
    MODE_CLASS[mode],
    `option-group--${size}`,
    tone === "quiet" ? "option-group--quiet" : "",
    iconOnly ? "option-group--icon" : "",
    fill ? "option-group--fill" : "",
    disabled ? "is-disabled" : "",
    className
  ]
    .filter(Boolean)
    .join(" ");

  if (mode === "collapsible") {
    return (
      <div
        ref={trackRef}
        className={classes}
        data-open={open ? "true" : "false"}
      >
        {/* The lead is the selected chip and nothing else — no caret. At rest
            this reads as the current value first and as a control second,
            which is the right order for something that is mostly read and
            occasionally changed. The track around it and its hover are what
            say it opens. */}
        <div className="option-group-lead">
          <div className="option-group-lead-inner">
            <button
              ref={leadRef}
              type="button"
              className="option-group-trigger"
              aria-expanded={open}
              aria-label={`${label}: ${selected?.label ?? ""}`}
              disabled={disabled}
              onClick={() => setOpen(true)}
            >
              {selected?.icon}
              <span className="option-group-label">{selected?.label}</span>
            </button>
          </div>
        </div>
        <div className="option-group-rest">
          <div
            ref={restRef}
            className="option-group-rest-inner"
            role="radiogroup"
            aria-label={label}
            aria-hidden={!open}
            onKeyDown={onKeyDown}
          >
            {options.map((option) => renderOption(option, true))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={trackRef}
      className={classes}
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
    >
      {options.map((option) => renderOption(option, false))}
    </div>
  );
}

export interface OptionChipsProps<T extends string> {
  options: readonly OptionGroupOption<T>[];
  /** Empty means "every option", never "none" — the caller decides what that filters to. */
  values: readonly T[];
  onToggle: (value: T) => void;
  label: string;
  size?: "sm" | "md";
  className?: string;
  disabled?: boolean;
  /**
   * A colour the chip wears when pressed, per option — a sport, a channel, a
   * stage. Hue here is data, so it is the caller's to supply; chrome has none.
   */
  colorOf?: (value: T) => string | undefined;
}

/** The multi-select variant: separate chips, no shared track, `aria-pressed`. */
export function OptionChips<T extends string>({
  options,
  values,
  onToggle,
  label,
  size = "sm",
  className,
  disabled = false,
  colorOf
}: OptionChipsProps<T>) {
  return (
    <div
      className={["option-chips", `option-group--${size}`, className]
        .filter(Boolean)
        .join(" ")}
      role="group"
      aria-label={label}
    >
      {options.map((option) => {
        const pressed = values.includes(option.value);
        const color = colorOf?.(option.value);
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={pressed}
            disabled={disabled || option.disabled}
            {...(option.title ? { title: option.title } : {})}
            {...(color
              ? {
                  style: {
                    "--option-chip-color": color
                  } as CSSProperties
                }
              : {})}
            onClick={() => onToggle(option.value)}
          >
            {color ? <i className="option-chip-dot" aria-hidden="true" /> : null}
            {option.icon}
            <span className="option-group-label">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
