import {
  napMinutes,
  napWindowsOf,
  windowDurationMinutes
} from "../../electron/sleepMetrics";
import {
  formatSleepClockRange,
  formatSleepDurationMinutes
} from "../training/formatters";
import type { TrainingHubSleepRecord } from "../../electron/types";

/**
 * What the Naps and Wake-ups tiles say, and what hovering one adds.
 *
 * Both tiles live in a fixed grid on two different screens, so their value has
 * to fit one line and their detail has to go somewhere else. Hover is that
 * somewhere: the tile answers "how much", the hover answers "when" — which for
 * a day of several naps is a list COROS sends in full and nothing was showing.
 */

/** Each nap's clock, in the order COROS listed them. */
export function napClocks(record: TrainingHubSleepRecord): string[] {
  return napWindowsOf(record)
    .map((window) => formatSleepClockRange(window.start, window.end))
    .filter((clock): clock is string => Boolean(clock));
}

/** One line per nap: the clock it ran on, and how long that is. */
function napLines(record: TrainingHubSleepRecord): string[] {
  const windows = napWindowsOf(record);

  return windows
    .map((window, index) => {
      const clock = formatSleepClockRange(window.start, window.end);
      if (!clock) {
        return undefined;
      }

      // Arithmetic on the two clocks already on the line, not a figure of
      // COROS's own: it sends a total for the day and a window per nap, and
      // never a length per nap.
      const minutes = windowDurationMinutes(window);
      const label = windows.length > 1 ? `Nap ${index + 1} · ` : "";
      return minutes !== undefined
        ? `${label}${clock} (${formatSleepDurationMinutes(minutes)})`
        : `${label}${clock}`;
    })
    .filter((line): line is string => line !== undefined);
}

/**
 * The tile's own value. One nap fits its clock beside the duration; several do
 * not, so they are counted here and listed on hover.
 */
export function formatNapValue(record: TrainingHubSleepRecord): string {
  const minutes = napMinutes(record);
  if (minutes === undefined) {
    return "No data";
  }

  if (minutes <= 0) {
    return "None";
  }

  const duration = formatSleepDurationMinutes(minutes);
  const clocks = napClocks(record);

  if (clocks.length === 1) {
    return `${duration} · ${clocks[0]}`;
  }

  return clocks.length > 1 ? `${duration} · ${clocks.length} naps` : duration;
}

/**
 * Every nap, one per line, or nothing when the tile already said it all.
 *
 * A single nap's clock is on the tile, so repeating it under the pointer would
 * be a tooltip that adds nothing.
 */
export function napHover(record: TrainingHubSleepRecord): string | undefined {
  const lines = napLines(record);
  return lines.length > 1 ? lines.join("\n") : undefined;
}
