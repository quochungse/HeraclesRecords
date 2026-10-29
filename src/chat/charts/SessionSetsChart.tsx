import { useMemo } from "react";
import { Area, AreaChart, ReferenceArea, Tooltip, XAxis, YAxis } from "recharts";
import type { TooltipContentProps } from "recharts";
import type {
  ActivityVisualStrengthExercise,
  TrainingHubActivitySeriesPoint,
  UnitSystem
} from "../../../electron/types";
import { ChartWhenNear } from "./ChartWhenNear";
import { trainingChartMargin, trainingChartTooltipStyle } from "../../training/chartConfig";
import { useChartColors } from "../../training/useChartColors";
import { ChartAreaGradient } from "../../training/components/trendChartParts";
import { activityAxisTicks, formatXTick } from "../../training/activityAxis";
import { formatDurationSeconds } from "../../training/formatters";
import { resolveExerciseName } from "../../training/exerciseNames";
import { t } from "../../i18n/core";
import { formatSessionSet } from "../sessionSetsFormat";

/*
 * Heart rate through a session recorded set by set — a strength session, a
 * Hybrid Fitness one — with each set drawn as a band where it was done and each
 * exercise numbered over its sets, as the table under the chart numbers it.
 * Hovering reads the exercise, the set and what it held, which is what the
 * "Point 1, Point 2" of a card with no clock never could.
 */

/** Room above the plot for the exercise numbers. */
const MARGIN = { ...trainingChartMargin, top: 20 };
/** An exercise's number is left off when it would sit on the one before it. */
const MIN_LABEL_GAP = 0.035;

interface SetSpan {
  from: number;
  to: number;
  exercise: number;
  set: number;
  kind: "set" | "rest";
}

interface ExerciseSpan {
  from: number;
  to: number;
  number: number;
  labelled: boolean;
}

function SetsTooltip({
  active,
  payload,
  label,
  spans,
  exercises,
  unitSystem
}: TooltipContentProps & {
  spans: SetSpan[];
  exercises: ActivityVisualStrengthExercise[];
  unitSystem: UnitSystem;
}) {
  if (!active || !payload?.length || typeof label !== "number") {
    return null;
  }
  const hr = payload[0]?.value;
  const at = spans.find((span) => label >= span.from && label <= span.to);
  const exercise = at ? exercises[at.exercise] : undefined;
  const set = at && exercise ? exercise.setList?.[at.set] : undefined;
  const started = spans.length > 0 && label > spans[0]!.from;
  const ended = spans.length > 0 && label > spans[spans.length - 1]!.to;

  return (
    <div className="training-chart-tooltip">
      <span className="training-chart-tooltip-label">{formatDurationSeconds(label)}</span>
      {exercise ? (
        <strong className="chat-sets-tooltip-name">
          {`${at!.exercise + 1}. ${resolveExerciseName(exercise.nameKey, exercise.rawName)}`}
        </strong>
      ) : null}
      <ul className="training-chart-tooltip-rows">
        {at && set ? (
          <li className="training-chart-tooltip-row">
            <span className="training-chart-tooltip-key">
              {at.kind === "set"
                ? t("chat.chart.setOf", { n: at.set + 1, total: exercise!.setList!.length })
                : t("chat.chart.restAfter", { n: at.set + 1 })}
            </span>
            <strong>
              {at.kind === "set"
                ? formatSessionSet(set, unitSystem)
                : formatDurationSeconds(set.restSeconds)}
            </strong>
          </li>
        ) : started && !ended ? (
          <li className="training-chart-tooltip-row">
            <span className="training-chart-tooltip-key">{t("chat.chart.between")}</span>
          </li>
        ) : null}
        <li className="training-chart-tooltip-row">
          <span className="training-chart-tooltip-key">{t("activity.m.heartRate")}</span>
          <strong>{typeof hr === "number" ? `${Math.round(hr)} bpm` : "—"}</strong>
        </li>
      </ul>
    </div>
  );
}

export function SessionSetsChart({
  series,
  exercises,
  gradientId,
  unitSystem
}: {
  series: TrainingHubActivitySeriesPoint[];
  exercises: ActivityVisualStrengthExercise[];
  gradientId: string;
  unitSystem: UnitSystem;
}) {
  const { colors, activeDot } = useChartColors();

  const data = useMemo(
    () =>
      series.flatMap((point) =>
        point.elapsed !== undefined && point.hr !== undefined ? [{ t: point.elapsed, value: point.hr }] : []
      ),
    [series]
  );

  const { spans, exerciseSpans, end } = useMemo(() => {
    const spans: SetSpan[] = [];
    const exerciseSpans: ExerciseSpan[] = [];
    exercises.forEach((exercise, exerciseIndex) => {
      const sets = exercise.setList ?? [];
      sets.forEach((set, setIndex) => {
        const done = set.start + set.seconds;
        spans.push({ from: set.start, to: done, exercise: exerciseIndex, set: setIndex, kind: "set" });
        if (set.restSeconds) {
          spans.push({
            from: done,
            to: done + set.restSeconds,
            exercise: exerciseIndex,
            set: setIndex,
            kind: "rest"
          });
        }
      });
      if (sets.length > 0) {
        const last = sets[sets.length - 1]!;
        exerciseSpans.push({
          from: sets[0]!.start,
          to: last.start + last.seconds,
          number: exerciseIndex + 1,
          labelled: false
        });
      }
    });
    spans.sort((left, right) => left.from - right.from);
    const end = Math.max(data[data.length - 1]?.t ?? 0, ...spans.map((span) => span.to));
    let lastLabel = -Infinity;
    for (const span of exerciseSpans) {
      const centre = (span.from + span.to) / 2;
      if (end > 0 && (centre - lastLabel) / end >= MIN_LABEL_GAP) {
        span.labelled = true;
        lastLabel = centre;
      }
    }
    return { spans, exerciseSpans, end };
  }, [data, exercises]);

  const ticks = useMemo(() => activityAxisTicks(0, end, "elapsed", unitSystem), [end, unitSystem]);

  if (data.length < 2) {
    return null;
  }

  return (
    <div className="chat-visual-chart-shell">
      <ChartWhenNear>
        <AreaChart data={data} margin={MARGIN}>
          <defs>
            <ChartAreaGradient id={gradientId} />
          </defs>
          <XAxis
            dataKey="t"
            type="number"
            domain={[0, end]}
            ticks={ticks}
            tickFormatter={(value: number) => formatXTick("elapsed", value, unitSystem)}
            tick={{ fill: colors.text, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            minTickGap={24}
          />
          <YAxis
            tick={{ fill: colors.text, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={36}
            domain={["auto", "auto"]}
          />
          {spans
            .filter((span) => span.kind === "set")
            .map((span) => (
              <ReferenceArea
                key={`set-${span.exercise}-${span.set}`}
                x1={span.from}
                x2={span.to}
                fill={colors.accent}
                fillOpacity={0.22}
                ifOverflow="hidden"
              />
            ))}
          {exerciseSpans.map((span) => (
            <ReferenceArea
              key={`exercise-${span.number}`}
              x1={span.from}
              x2={span.to}
              fill="none"
              stroke="none"
              ifOverflow="visible"
              label={
                span.labelled
                  ? { value: String(span.number), position: "top", fill: colors.text, fontSize: 11 }
                  : undefined
              }
            />
          ))}
          <Tooltip
            content={(props) => (
              <SetsTooltip {...props} spans={spans} exercises={exercises} unitSystem={unitSystem} />
            )}
            cursor={{ stroke: colors.cursor }}
            contentStyle={trainingChartTooltipStyle}
          />
          <Area
            type="monotone"
            dataKey="value"
            name={t("activity.m.heartRate")}
            stroke={colors.accentBright}
            fill={`url(#${gradientId})`}
            strokeWidth={2}
            dot={false}
            activeDot={activeDot}
            isAnimationActive={false}
          />
        </AreaChart>
      </ChartWhenNear>
    </div>
  );
}
