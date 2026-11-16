/*
 * The half-circle dial the Personal screen's fitness cards share, drawn the
 * way COROS's Training Hub draws its Running Fitness dial: segments left to
 * right with a 1° gap after each, rounded at the two ends, and a needle on a
 * faint track inside the ring, its tip at the ring. A segment's colour comes
 * from the card (`data-level`, 1 on the left).
 */

const CENTER_X = 120;
const CENTER_Y = 96;
const RADIUS = 84;
/** The needle's track, inside the ring (COROS: 72 against 85). */
const TRACK_RADIUS = 71;
/** The needle, from its round base to its tip just inside the ring. */
const NEEDLE_BASE = 64;
const NEEDLE_TIP = 81.5;
const NEEDLE_BASE_HALF = 1.9;
const NEEDLE_TIP_HALF = 0.4;
/** The gap after each segment, in degrees of arc. */
const GAP = 1;
/** The sliver at each end that carries the round cap, in degrees. */
const CAP = 0.36;

function pointAt(angle: number, radius: number) {
  const radians = (angle * Math.PI) / 180;

  return {
    x: CENTER_X + radius * Math.cos(radians),
    y: CENTER_Y - radius * Math.sin(radians)
  };
}

/** An arc clockwise from `from` to `to`, in degrees (180 is the left end). */
function arcPath(from: number, to: number, radius = RADIUS): string {
  const start = pointAt(from, radius);
  const end = pointAt(to, radius);

  return [
    `M ${start.x.toFixed(2)} ${start.y.toFixed(2)}`, // i18n-ignore: an SVG path
    `A ${radius} ${radius} 0 0 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}` // i18n-ignore: an SVG path
  ].join(" ");
}

/** The needle lying along +x; rotated into place around the centre. */
const NEEDLE_PATH = [
  `M ${NEEDLE_BASE} ${-NEEDLE_BASE_HALF}`, // i18n-ignore: an SVG path
  `L ${NEEDLE_TIP} ${-NEEDLE_TIP_HALF}`, // i18n-ignore: an SVG path
  `A ${NEEDLE_TIP_HALF} ${NEEDLE_TIP_HALF} 0 0 1 ${NEEDLE_TIP} ${NEEDLE_TIP_HALF}`, // i18n-ignore: an SVG path
  `L ${NEEDLE_BASE} ${NEEDLE_BASE_HALF}`, // i18n-ignore: an SVG path
  `A ${NEEDLE_BASE_HALF} ${NEEDLE_BASE_HALF} 0 0 1 ${NEEDLE_BASE} ${-NEEDLE_BASE_HALF} Z` // i18n-ignore: an SVG path
].join(" ");

interface SegmentedDialProps {
  /** Each segment's share of the half circle, left to right. */
  weights: readonly number[];
  /** Where the needle stands, 0 (left end) to 1 (right end); none when absent. */
  position?: number;
  /** The figure under the arc. */
  value: string;
  /** What a screen reader says for the whole dial. */
  label: string;
}

export function SegmentedDial({ weights, position, value, label }: SegmentedDialProps) {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const angleAt = (share: number) => 180 - Math.max(0, Math.min(1, share)) * 180;
  let reached = 0;
  const segments = weights.map((weight, index) => {
    const from = angleAt(reached / total);
    reached += weight;
    const last = index === weights.length - 1;

    return { from, to: angleAt(reached / total) + (last ? 0 : GAP) };
  });
  const needleAngle = position === undefined ? undefined : angleAt(position);

  return (
    <div className="segmented-dial" role="img" aria-label={label}>
      <svg viewBox="0 0 240 100" aria-hidden="true">
        <path className="segmented-dial-track" d={arcPath(180, 0, TRACK_RADIUS)} />
        {segments.map((segment, index) => (
          <path
            key={index}
            className="segmented-dial-segment"
            data-level={index + 1}
            d={arcPath(segment.from, segment.to)}
          />
        ))}
        <path
          className="segmented-dial-segment is-cap"
          data-level={1}
          d={arcPath(180, 180 - CAP)}
        />
        <path
          className="segmented-dial-segment is-cap"
          data-level={weights.length}
          d={arcPath(CAP, 0)}
        />
        {needleAngle !== undefined ? (
          <path
            className="segmented-dial-needle"
            d={NEEDLE_PATH}
            transform={`translate(${CENTER_X} ${CENTER_Y}) rotate(${(-needleAngle).toFixed(2)})`}
          />
        ) : null}
      </svg>
      <strong className="segmented-dial-value figure">{value}</strong>
    </div>
  );
}
