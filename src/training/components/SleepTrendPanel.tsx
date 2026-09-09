import { useMemo, type CSSProperties } from "react";
import { MoonStar } from "lucide-react";
import {
  TRAINING_SHORT_TREND_DAYS,
  TRAINING_TREND_WINDOWS,
  type TrainingTrendWindow
} from "../chartConfig";
import {
  defineSelectionPreference,
  selectionIsOneOf,
  useSelectionPreference
} from "../../preferences/selectionPreferences";
import { useChartColors } from "../useChartColors";
import type { TrainingTrendPoint } from "../types";
import { SleepTrendChart } from "../../sleep/components/SleepTrendChart";
import { EmptyChartNotice, TrendWindowToggle } from "./trendChartParts";
import type { TrainingHubSleepRecord } from "../../../electron/types";

const SLEEP_WINDOW_PREFERENCE = defineSelectionPreference<TrainingTrendWindow>({
  key: "training.sleepTrendWindow",
  defaultValue: TRAINING_SHORT_TREND_DAYS,
  validate: selectionIsOneOf(TRAINING_TREND_WINDOWS)
});

/**
 * Colors come from the chart palette rather than the CSS accent tokens: the
 * app's `--accent` is switchable from Settings (gold by default) while the
 * chart's own accent is not, so a swatch reading that token painted the bars
 * a color they have never been.
 */
function SleepTrendLegend() {
  const { colors } = useChartColors();

  return (
    <div className="training-chart-legend" aria-hidden="true">
      <span className="training-chart-legend-item">
        <span
          className="training-chart-legend-swatch is-series"
          style={
            {
              "--swatch-color": colors.accent,
              "--swatch-fill": colors.accentSoft
            } as CSSProperties
          }
          aria-hidden="true"
        />
        Asleep
      </span>
      <span className="training-chart-legend-item">
        <span
          className="training-chart-legend-line is-series is-solid"
          style={{ "--swatch-color": colors.gold } as CSSProperties}
        />
        Score
      </span>
    </div>
  );
}

/**
 * The Sleep screen's length-and-score chart, on Overview. It reads the trend
 * points rather than the raw sleep summary because those are already one row
 * per night with naps and partial windows folded out — see
 * `mergeSleepIntoTrendPoints`. Bars are not wired to open a night here: this
 * panel sits on a screen that has nowhere to open one.
 */
export function SleepTrendPanel({ points }: { points: TrainingTrendPoint[] }) {
  const { metrics } = useChartColors();
  const [trendWindow, setTrendWindow] = useSelectionPreference(
    SLEEP_WINDOW_PREFERENCE
  );

  const records = useMemo<TrainingHubSleepRecord[]>(
    () =>
      points
        .slice(-trendWindow)
        .filter(
          (point) =>
            point.sleepMinutes !== undefined || point.sleepScore !== undefined
        )
        .map((point) => ({
          happenDay: point.date,
          totalMinutes: point.sleepMinutes,
          score: point.sleepScore
        })),
    [points, trendWindow]
  );

  return (
    <section className="panel training-chart-panel" data-metric="sleep">
      <div className="section-heading compact training-chart-heading">
        <div>
          <p className="eyebrow">Sleep Trend</p>
          <h2>Last {trendWindow} days</h2>
        </div>
        <div className="training-chart-heading-side">
          <TrendWindowToggle
            options={TRAINING_TREND_WINDOWS}
            value={trendWindow}
            onChange={setTrendWindow}
            label="Sleep trend range"
          />
          <SleepTrendLegend />
        </div>
      </div>
      {records.length > 1 ? (
        <div className="training-chart-shell">
          <SleepTrendChart records={records} height="100%" />
        </div>
      ) : (
        <EmptyChartNotice
          icon={MoonStar}
          palette={metrics.sleep}
          title="No sleep trend yet"
        >
          A trend needs more than one night. Sync sleep from COROS and it fills
          in here.
        </EmptyChartNotice>
      )}
    </section>
  );
}
