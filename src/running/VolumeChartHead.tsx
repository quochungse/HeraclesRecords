import { OptionGroup, type OptionGroupOption } from "../components/OptionGroup";
import { plural, t } from "../i18n/core";
import { MotionFigure } from "../motion/MotionFigure";

/**
 * The head of a sport's weekly volume chart, the same on Running, Cycling,
 * Hiking and Swimming: what the bars add up to and over how many weeks, the
 * same span a year earlier, and the measure the bars are drawn in. A period
 * rolls its figures; another measure slides them (`motion="slide"`).
 */
export function VolumeChartHead<Measure extends string>({
  totalText,
  total,
  weeks,
  lastYear,
  measure,
  options,
  onMeasureChange
}: {
  /** The bars' sum as it is written, and as a number for the way it rolls. */
  totalText: string;
  total: number;
  weeks: number;
  /** The same weeks a year earlier; absent when nothing was recorded then. */
  lastYear?: { text: string; value: number };
  measure: Measure;
  options: readonly OptionGroupOption<Measure>[];
  onMeasureChange: (measure: Measure) => void;
}) {
  return (
    <header className="run-block-head">
      <div>
        <p className="running-eyebrow">{t("run.volume.title")}</p>
        <h3>
          <MotionFigure text={totalText} value={total} />
          <span className="run-block-sub">
            {" "}
            <MotionFigure text={plural("run.volume.over", weeks)} value={weeks} />
          </span>
        </h3>
      </div>
      <div className="sport-volume-aside">
        {lastYear ? (
          <p className="run-block-aside">
            {t("run.volume.yearAgo")}{" "}
            <strong>
              <MotionFigure text={lastYear.text} value={lastYear.value} />
            </strong>
          </p>
        ) : null}
        <OptionGroup
          label={t("run.volume.measure")}
          motion="slide"
          value={measure}
          options={options}
          onChange={onMeasureChange}
        />
      </div>
    </header>
  );
}
