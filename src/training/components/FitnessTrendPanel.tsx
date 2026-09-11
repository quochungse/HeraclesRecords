import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Check, ChevronDown } from "lucide-react";
import type { TrainingHubActivity } from "../../../electron/types";
import { formatHappenDayLabel } from "../formatters";
import { mergeTrainingDayLists } from "../parsers";
import type { TrainingHubSnapshot } from "../types";
import {
  buildWeeklyActivitySeries,
  buildWeeklyActivityYAxisTicks,
  enrichDayListWithActivityTotals,
  formatWeeklyActivityAxisTick,
  getWeeklyActivityMetricLabel,
  getWeeklyActivityYAxisUnitLabel,
  weeklyActivitySportLegend,
  WEEKLY_ACTIVITY_METRICS,
  type WeeklyActivityMetric
} from "../weeklyActivity";
import { useUnitSystem } from "../../units/UnitSystemProvider";
import {
  defineSelectionPreference,
  readSelectionPreference,
  selectionIsArrayOf,
  selectionIsOneOf,
  useSelectionPreference
} from "../../preferences/selectionPreferences";

const FITNESS_METRIC_PREFERENCE =
  defineSelectionPreference<WeeklyActivityMetric>({
    key: "training.weeklyMetric",
    defaultValue: "distance",
    validate: selectionIsOneOf(WEEKLY_ACTIVITY_METRICS)
  });

/**
 * The chart used to stack up to three metrics at once, so the stored preference
 * is an array under a different key. It is read only as the scalar's fallback,
 * which keeps an athlete on the metric they last chose rather than resetting
 * them to distance the first time they open the redesigned chart.
 */
const LEGACY_FITNESS_METRICS_PREFERENCE =
  defineSelectionPreference<WeeklyActivityMetric[]>({
    key: "training.weeklyMetrics",
    defaultValue: ["distance"],
    validate: selectionIsArrayOf(selectionIsOneOf(WEEKLY_ACTIVITY_METRICS), {
      minLength: 1,
      unique: true
    })
  });

interface FitnessTrendPanelProps {
  snapshot: TrainingHubSnapshot | null;
  activities?: TrainingHubActivity[];
}

interface MetricSelectProps {
  selected: WeeklyActivityMetric;
  onChange: (next: WeeklyActivityMetric) => void;
}

/**
 * Picks the one metric the columns measure. Deliberately colourless: hue on this
 * chart belongs to the sport a block stands for, and a swatch here would claim
 * it stands for the unit instead.
 */
function MetricSelect({ selected, onChange }: MetricSelectProps) {
  const { unitSystem } = useUnitSystem();
  const rootRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div className="metric-select" ref={rootRef}>
      <button
        type="button"
        className="metric-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
      >
        <span className="metric-select-label">
          {getWeeklyActivityMetricLabel(selected, unitSystem)}
        </span>
        <ChevronDown
          className={
            isOpen ? "metric-select-icon is-open" : "metric-select-icon"
          }
          size={16}
          strokeWidth={2.4}
          aria-hidden="true"
        />
      </button>

      {isOpen ? (
        <div className="metric-select-menu" role="listbox">
          {WEEKLY_ACTIVITY_METRICS.map((metric) => {
            const isSelected = metric === selected;

            return (
              <button
                type="button"
                key={metric}
                className={
                  isSelected
                    ? "metric-select-option is-selected"
                    : "metric-select-option"
                }
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  onChange(metric);
                  setIsOpen(false);
                }}
              >
                <span className="metric-select-check">
                  {isSelected ? (
                    <Check size={13} strokeWidth={3} aria-hidden="true" />
                  ) : null}
                </span>
                <span>{getWeeklyActivityMetricLabel(metric, unitSystem)}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function FitnessTrendPanel({
  snapshot,
  activities = []
}: FitnessTrendPanelProps) {
  const { unitSystem } = useUnitSystem();
  const [barsVisible, setBarsVisible] = useState(false);
  const legacyMetric = useMemo(
    () => readSelectionPreference(LEGACY_FITNESS_METRICS_PREFERENCE).value[0],
    []
  );
  const [selectedMetric, setSelectedMetric] = useSelectionPreference(
    FITNESS_METRIC_PREFERENCE,
    legacyMetric
  );
  const dayList = useMemo(
    () =>
      enrichDayListWithActivityTotals(
        mergeTrainingDayLists(
          snapshot?.dailyMetrics ?? null,
          snapshot?.analytics ?? null
        ),
        activities
      ),
    [snapshot, activities]
  );
  const series = useMemo(
    () =>
      buildWeeklyActivitySeries(
        dayList,
        selectedMetric,
        new Date(),
        unitSystem,
        activities
      ),
    [activities, dayList, selectedMetric, unitSystem]
  );
  // Columns are coloured by sport, so the week needs a key naming them.
  const sportLegend = useMemo(
    () => weeklyActivitySportLegend(series.days),
    [series]
  );

  const maxValue = series.yMax || 1;
  const yAxisTicks = useMemo(
    () => buildWeeklyActivityYAxisTicks(maxValue),
    [maxValue]
  );
  const yAxisUnitLabel = getWeeklyActivityYAxisUnitLabel(
    selectedMetric,
    series.yAxisUnit
  );
  const hasData = series.hasData;

  useEffect(() => {
    setBarsVisible(false);
    const frame = requestAnimationFrame(() => setBarsVisible(true));
    return () => cancelAnimationFrame(frame);
  }, [selectedMetric, hasData]);

  return (
    <section className="panel training-fitness-panel">
      <div className="training-fitness-header">
        <p className="eyebrow">Weekly Activity</p>
        <div className="training-metric-select-wrap">
          <MetricSelect selected={selectedMetric} onChange={setSelectedMetric} />
        </div>
      </div>

      {/* The sport key, and nothing else: the week's totals already have a home
          in the summary tiles above, where every metric is on screen at once. */}
      <div className="training-fitness-legends" aria-hidden="true">
        <ul className="training-chart-sport-legend training-fitness-sport-legend">
          {sportLegend.map((entry) => (
            <li className="training-fitness-legend-item" key={entry.key}>
              <span
                className="training-chart-legend-swatch"
                style={
                  {
                    "--swatch-color": entry.category
                      ? `var(--sport-${entry.category})`
                      : "var(--text-muted)"
                  } as CSSProperties
                }
              />
              {entry.label}
            </li>
          ))}
        </ul>
      </div>

      {hasData ? (
        <div
          className="training-fitness-chart"
          role="img"
          aria-label={`Weekly activity chart for ${series.metricLabel.toLowerCase()}, by sport.`}
        >
          <div className="training-fitness-y-axis" aria-hidden="true">
            {yAxisUnitLabel ? (
              <span className="training-fitness-y-unit">{yAxisUnitLabel}</span>
            ) : null}
            <div className="training-fitness-y-ticks">
              {[...yAxisTicks].reverse().map((tick) => (
                <span key={tick} className="training-fitness-y-tick">
                  {formatWeeklyActivityAxisTick(
                    tick,
                    selectedMetric,
                    series.yAxisUnit
                  )}
                </span>
              ))}
            </div>
          </div>

          <div className="training-fitness-plot">
            <div className="training-fitness-grid-lines" aria-hidden="true">
              {yAxisTicks.map((tick) => (
                <span
                  key={tick}
                  className="training-fitness-grid-line"
                  style={{ bottom: `${(tick / maxValue) * 100}%` }}
                />
              ))}
            </div>

            <div
              className="training-fitness-bars"
              role="list"
              aria-label="Weekly activity for the current calendar week"
            >
              {series.days.map((bar, dayIndex) => {
                const fullLabel = formatHappenDayLabel(bar.happenDay);
                const barHasValue = bar.value > 0;
                const stackTotal =
                  bar.segments.reduce(
                    (sum, segment) => sum + segment.value,
                    0
                  ) || 1;
                const heightPct = barHasValue
                  ? Math.max(10, (bar.value / maxValue) * 100)
                  : 0;

                return (
                  <span
                    key={bar.happenDay}
                    className={`training-fitness-day${
                      barHasValue ? "" : " is-empty"
                    }${bar.isToday ? " is-today" : ""}`}
                    role="listitem"
                    // A rest day has no tooltip to open, so it is not a tab
                    // stop either — landing on one would be a stop that does
                    // nothing.
                    tabIndex={barHasValue ? 0 : undefined}
                    aria-label={`${fullLabel}: ${
                      bar.segments.length > 0
                        ? bar.segments
                            .map(
                              (segment) =>
                                `${segment.label} ${segment.displayValue}`
                            )
                            .join(", ")
                        : `${series.metricLabel} ${bar.displayValue}`
                    }`}
                  >
                    <span className="training-fitness-bar-group">
                      <span
                        className={[
                          "training-fitness-bar",
                          bar.segments.length > 0 ? "is-stacked" : "",
                          barHasValue ? "" : "is-empty"
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        style={{
                          height:
                            barsVisible && barHasValue
                              ? `${heightPct}%`
                              : undefined,
                          transitionDelay: `${dayIndex * 60}ms`
                        }}
                      >
                        {bar.segments.map((segment) => (
                          <span
                            key={segment.key}
                            className={`training-fitness-segment${
                              segment.category ? "" : " is-residual"
                            }`}
                            style={
                              {
                                // Percentage points of the stack, not the raw
                                // value: flex-basis is 0, and grow factors
                                // summing to less than 1 hand out only that
                                // fraction of the column — which left a duration
                                // bar of 0.84 hours with a sixth of itself empty
                                // above the blocks.
                                flexGrow: Math.max(
                                  (segment.value / stackTotal) * 100,
                                  0.01
                                ),
                                ...(segment.category
                                  ? {
                                      "--segment-color": `var(--sport-${segment.category})`
                                    }
                                  : {})
                              } as CSSProperties
                            }
                          />
                        ))}
                      </span>
                    </span>
                    <span className="training-fitness-date">
                      {bar.weekdayLabel}
                    </span>
                    {/* One row per block, in the order they stack, named by
                        sport rather than by the unit on the axis — the axis
                        already says what is measured. A day holding two
                        sessions reads as two rows, the way it draws as two
                        blocks. A day with a figure but no activity behind it
                        falls back to the metric, because there is no sport to
                        name; a day with nothing at all gets no tooltip, since
                        "Duration: —" is the empty slot saying it twice. */}
                    {barHasValue ? (
                      <span className="training-fitness-tooltip" role="tooltip">
                        <strong>{fullLabel}</strong>
                        {bar.segments.length > 0 ? (
                          bar.segments.map((segment) => (
                            <span
                              key={segment.key}
                              className="training-fitness-tooltip-row"
                            >
                              <span
                                className="training-fitness-swatch"
                                style={
                                  {
                                    background: segment.category
                                      ? `var(--sport-${segment.category})`
                                      : "var(--text-muted)"
                                  } as CSSProperties
                                }
                              />
                              <span className="training-fitness-tooltip-text">
                                {segment.label}: {segment.displayValue}
                              </span>
                            </span>
                          ))
                        ) : (
                          <span className="training-fitness-tooltip-row">
                            {series.metricLabel}: {bar.displayValue}
                          </span>
                        )}
                      </span>
                    ) : null}
                  </span>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        <p className="training-empty-state">No weekly activity data yet.</p>
      )}
    </section>
  );
}
