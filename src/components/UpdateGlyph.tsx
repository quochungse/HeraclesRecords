import { useId } from "react";

interface UpdateGlyphProps {
  size?: number;
  /** The arrow rises through the ring on a loop while work is under way. */
  active?: boolean;
}

/**
 * A circle with an arrow pointing up — lucide's `circle-arrow-up`, drawn by hand
 * because the arrow has to move on its own: while an update downloads or
 * installs it climbs out of the top of the ring and comes back in at the
 * bottom, clipped to the ring so it never draws over the stroke.
 */
export function UpdateGlyph({ size = 16, active = false }: UpdateGlyphProps) {
  // useId's spelling has changed between React versions (`:r0:`, `«r0»`,
  // `_r_0_`); only word characters are safe inside `url(#…)`.
  const clipId = `update-glyph-clip-${useId().replace(/[^\w-]/g, "")}`;

  return (
    <svg
      className={["update-glyph", active ? "is-active" : ""].filter(Boolean).join(" ")}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <defs>
        <clipPath id={clipId}>
          <circle cx="12" cy="12" r="8.5" />
        </clipPath>
      </defs>
      <circle cx="12" cy="12" r="10" />
      <g clipPath={`url(#${clipId})`}>
        <g className="update-glyph-arrow">
          <path d="M12 16V8" />
          <path d="m8 12 4-4 4 4" />
        </g>
      </g>
    </svg>
  );
}
