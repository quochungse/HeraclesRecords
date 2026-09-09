import { formatSleepDurationMinutes } from "../../training/formatters";
import { drawableStages, timeInBedMinutes } from "../sleepStages";
import type { TrainingHubSleepRecord } from "../../../electron/types";

interface SleepStageDonutProps {
  record: TrainingHubSleepRecord;
}

const RADIUS = 62;
const STROKE = 14;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
/** A hairline of background between slices, so two dark stages stay countable. */
const GAP_DEGREES = 1.6;

/**
 * Time in bed, split by stage. The centre reads the whole — which is time in
 * bed, not time asleep, because awake time is one of the four slices; the
 * header above states time asleep, and the two differing is the point.
 */
export function SleepStageDonut({ record }: SleepStageDonutProps) {
  const slices = drawableStages(record);
  const total = slices.reduce((sum, slice) => sum + slice.weight, 0);
  const inBed = timeInBedMinutes(record);

  if (total <= 0) {
    return (
      <div className="sleep-donut is-empty" role="img" aria-label="No stage breakdown">
        <p>No stage breakdown for this night.</p>
      </div>
    );
  }

  let offsetDegrees = -90;

  return (
    <div className="sleep-donut">
      <svg viewBox="0 0 160 160" role="img" aria-label="Sleep stages by share of the night">
        <circle
          className="sleep-donut-track"
          cx="80"
          cy="80"
          r={RADIUS}
          fill="none"
          strokeWidth={STROKE}
        />
        {slices.map((slice) => {
          const share = slice.weight / total;
          const sweep = Math.max(0, share * 360 - GAP_DEGREES);
          const dash = (sweep / 360) * CIRCUMFERENCE;
          const rotation = offsetDegrees;
          offsetDegrees += share * 360;

          return (
            <circle
              key={slice.key}
              className={`sleep-donut-slice ${slice.className}`}
              cx="80"
              cy="80"
              r={RADIUS}
              fill="none"
              strokeWidth={STROKE}
              strokeLinecap="butt"
              strokeDasharray={`${dash} ${CIRCUMFERENCE - dash}`}
              transform={`rotate(${rotation} 80 80)`}
            >
              <title>{`${slice.label}: ${formatSleepDurationMinutes(slice.minutes)}`}</title>
            </circle>
          );
        })}
      </svg>
      <div className="sleep-donut-centre">
        <span>Total time</span>
        <strong>{formatSleepDurationMinutes(inBed)}</strong>
      </div>
    </div>
  );
}
