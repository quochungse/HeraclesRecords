import { Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/**
 * Search, folded down to its magnifier until it is reached for.
 *
 * It lives in the list's own header, beside the filter chips and the layout
 * switch — a line with no width to spare — and it is the one control up there
 * you only reach for once you already know the name you are looking for.
 * Both tabs of the library take the same one: the Plans header used to spell
 * a plain always-open field of its own, which wore `.tl-search` without ever
 * setting `data-open` — so the box stayed at its folded 30px and clipped the
 * field it held. So at rest it is the magnifier alone and the field opens
 * out of it.
 *
 * **It is one element in two states, not two elements.** Swapping a button for
 * a field gives the field nothing to animate from: it mounts at its full width
 * and simply appears. So the box is always here and its width is what changes,
 * which is also what keeps the magnifier at the same pixel throughout — the
 * same rule the collapsible chips follow.
 *
 * It folds again on Escape, on losing focus and on being cleared, but **only
 * while it is empty**: a folded field with a query still in it hides the
 * reason the list is short, which is the whole of what a filter has to say.
 */
export function CollapsibleSearch({
  value,
  onChange,
  label
}: {
  value: string;
  onChange: (next: string) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const expanded = open || value.length > 0;

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const fold = () => {
    onChange("");
    setOpen(false);
  };

  return (
    <div className="tl-search" data-open={expanded ? "true" : "false"}>
      <button
        type="button"
        className="tl-search-icon"
        aria-label={label}
        aria-expanded={expanded}
        onClick={() => setOpen((current) => !current || value.length > 0)}
      >
        <Search size={14} aria-hidden="true" />
      </button>
      <input
        ref={inputRef}
        value={value}
        placeholder={label}
        aria-label={label}
        /* Out of the tab order while folded, so Tab reaches the magnifier and
           not a field nobody can see. */
        tabIndex={expanded ? 0 : -1}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          /* Stopped here rather than left to bubble: the dialogs this screen
             opens close on Escape from their own listener on `document`, and
             while the field has the keyboard the key means "drop the search". */
          event.stopPropagation();
          fold();
        }}
        /* Only when empty. The clear button below is the other way out, and it
           only exists while there is something to clear — so a blur on the way
           to pressing it never folds the field out from under the click. */
        onBlur={() => {
          if (!value) setOpen(false);
        }}
      />
      {value ? (
        <button
          type="button"
          className="tl-search-clear"
          aria-label="Clear search"
          onClick={fold}
        >
          <X size={12} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
