/**
 * A plan's tile draws one small picture: a ridge of its weeks, so a plan can
 * be recognised by its silhouette. It measures what `ridgeMeasure` picks, as
 * the reader's own ridge does.
 *
 * `BulletRidge` stood beside it — planned load against completed — and went
 * with the Adherence tab it was drawn for. Compliance is a figure on a plan's
 * row now (`planCompliance.ts`), not a chart of its own.
 *
 * It keeps to a single hue. Height carries the number; nothing else is encoded.
 */

/** Bars below this share of the peak still get a visible stub. */
const MINIMUM_SHARE = 0.09;
/** Only the leading bars stagger, so long plans still settle quickly. */
const STAGGER_LIMIT = 22;

interface RidgeProps {
  /** One value per week, in week order. */
  values: number[];
  /** 1-based peak week from the plan summary, marked at full strength. */
  peakWeek?: number;
  /** Names the quantity, e.g. "load" or "sessions". Used for the tooltip. */
  unit: string;
  /**
   * The accent hue is reserved for training load. A plan with no load data
   * falls back to session counts, which is drawn in grey so the column's
   * heading is never contradicted by a bar that looks like load.
   */
  variant: "load" | "count";
  /** Full sentence for assistive technology. */
  label: string;
}

export function Ridge({ values, peakWeek, unit, variant, label }: RidgeProps) {
  if (values.length === 0) {
    return <span className="tl-ridge is-blank" aria-label="No weeks">&mdash;</span>;
  }

  const peak = Math.max(...values);

  return (
    <span
      className={`tl-ridge${variant === "count" ? " is-count" : ""}`}
      role="img"
      aria-label={label}
    >
      {values.map((value, index) => {
        const share = peak > 0 ? value / peak : 0;
        const marked = peakWeek !== undefined && index === peakWeek - 1 && value > 0;
        return (
          <span
            key={index}
            className={`tl-ridge-bar${value > 0 ? "" : " is-empty"}${marked ? " is-peak" : ""}`}
            style={{
              "--tl-bar-height": value > 0 ? `${Math.max(share, MINIMUM_SHARE) * 100}%` : "2px",
              "--tl-bar-index": index < STAGGER_LIMIT ? index : STAGGER_LIMIT
            } as React.CSSProperties}
          >
            <span className="sr-only">
              Week {index + 1}: {Math.round(value)} {unit}
            </span>
          </span>
        );
      })}
    </span>
  );
}
