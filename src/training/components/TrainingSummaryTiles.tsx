import type { ReactNode } from "react";
import { Flame, Footprints, Route, Timer } from "lucide-react";
import {
  MCP_DAILY_HEALTH_TILE_DETAIL,
  MCP_UNREACHABLE_LABEL,
  isMcpFailure,
  type McpConnectionState
} from "../../mcp/mcpNotice";
import { distanceUnit, metersToDisplayDistance } from "../../units/units";
import { useUnitSystem } from "../../units/UnitSystemProvider";
import {
  formatDurationTotal,
  formatWeekToDateRange,
  type WeekToDateTotals
} from "../weeklyActivity";

interface TrainingSummaryTilesProps {
  totals: WeekToDateTotals;
  /** How the MCP server that serves the daily-health feed stood. */
  mcpState?: McpConnectionState;
  className?: string;
}

const ICON_SIZE = 13;
const EMPTY_FIGURE = "–";

interface StatCardProps {
  icon: ReactNode;
  label: string;
  value: string;
  /** A unit not already inside `value` — the distance's km or mi. */
  unit?: string;
  /**
   * The one thing a tile has left to report on its own, which today is the MCP
   * state behind a missing step count. The timeframe is deliberately not here:
   * it belongs to the four together and is said once above them.
   */
  notice?: string;
}

/**
 * Unit letters inside an already-formatted figure — the `h` and `m` of
 * "5h 12m". They take the same suffix treatment the distance unit does, so all
 * four figures read as one set rather than as two conventions side by side.
 */
function withUnitSuffixes(value: string): ReactNode {
  const parts = value.match(/[^A-Za-z]+|[A-Za-z]+/g);
  if (!parts || parts.length === 1) {
    return value;
  }

  return parts.map((part, index) =>
    /[A-Za-z]/.test(part) ? (
      <span className="training-stat-card__unit" key={`${index}-${part}`}>
        {part}
      </span>
    ) : (
      part
    )
  );
}

/**
 * All four tiles wear the same treatment, and there is no per-metric tone to
 * pass. They used to carry one Tailwind pastel each — peach, sky, pink,
 * lavender — which read as four kinds of thing when they are four totals of
 * one kind, for one week. Hue in this app belongs to data that has a hue:
 * sport, sleep stage, heart-rate zone, load band. See the note above
 * `.training-stat-card` in styles.css.
 *
 * Two rows, not three. The third row said "this week" on every tile — four
 * readings of one fact, and five counting the Distance tile, which had its unit
 * riding along on the same line and so left `36.7` standing alone as the
 * figure. The unit is now on the figure and the week is stated once above the
 * group, which leaves the third row for a tile that genuinely has something of
 * its own to say.
 */
function StatCard({ icon, label, value, unit, notice }: StatCardProps) {
  const empty = value === EMPTY_FIGURE;

  return (
    <section
      className={`training-stat-card is-widget${notice ? " has-notice" : ""}`}
    >
      <div className="training-stat-card__icon" aria-hidden="true">
        {icon}
      </div>
      <p className="training-stat-card__label">{label}</p>
      <strong
        className={`training-stat-card__value${empty ? " is-empty" : ""}`}
      >
        {withUnitSuffixes(value)}
        {/* No unit on an absent figure: "– km" reads as a measurement of
            nothing, where "–" reads as the figure not having arrived. */}
        {unit && !empty ? (
          <span className="training-stat-card__unit">{unit}</span>
        ) : null}
      </strong>
      {notice ? (
        <span className="training-stat-card__detail">{notice}</span>
      ) : null}
    </section>
  );
}

function formatWholeNumber(value?: number): string {
  if (value === undefined || !Number.isFinite(value)) {
    return EMPTY_FIGURE;
  }

  return Math.round(value).toLocaleString();
}

/**
 * The four weekly figures under the recovery ring, each a Monday-to-today total
 * — see `buildWeekToDateTotals`. The set is fixed and so is the stacked layout:
 * this sits in one column of Training Intelligence and nowhere else, and a
 * per-tile opt-out or a second layout would be a branch no screen takes.
 */
export function TrainingSummaryTiles({
  totals,
  mcpState,
  className
}: TrainingSummaryTilesProps) {
  const { unitSystem } = useUnitSystem();
  // Only where the figure is actually missing: a week that already has step
  // counts in it is not a tile with a problem to report.
  const stepsNeedMcp = isMcpFailure(mcpState) && totals.steps === undefined;
  const stepsNotice = !stepsNeedMcp
    ? undefined
    : mcpState === "unreachable"
      ? MCP_UNREACHABLE_LABEL
      : MCP_DAILY_HEALTH_TILE_DETAIL;
  const unit = distanceUnit(unitSystem);
  const groupClassName = ["training-summary-group", className ?? ""]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={groupClassName}>
      <div className="training-summary-group__head">
        <span className="training-summary-group__when">This week</span>
        {/* The days the totals actually cover, which "this week" never said:
            they stop at today, not on Sunday. */}
        <span className="training-summary-group__range">
          {formatWeekToDateRange()}
        </span>
      </div>

      <div className="training-summary-tiles is-stack">
        <StatCard
          icon={<Flame size={ICON_SIZE} />}
          label="Load"
          value={formatWholeNumber(totals.trainingLoad)}
        />

        <StatCard
          icon={<Footprints size={ICON_SIZE} />}
          label="Steps"
          value={formatWholeNumber(totals.steps)}
          notice={stepsNotice}
        />

        <StatCard
          icon={<Route size={ICON_SIZE} />}
          label="Distance"
          value={
            totals.distance !== undefined
              ? metersToDisplayDistance(totals.distance, unitSystem).toFixed(1)
              : EMPTY_FIGURE
          }
          unit={unit}
        />

        <StatCard
          icon={<Timer size={ICON_SIZE} />}
          label="Duration"
          value={
            totals.duration !== undefined
              ? formatDurationTotal(totals.duration)
              : EMPTY_FIGURE
          }
        />
      </div>
    </div>
  );
}
