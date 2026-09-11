import type { ReactNode } from "react";
import { Flame, Footprints, Route, Timer } from "lucide-react";
import { MCP_DAILY_HEALTH_TILE_DETAIL } from "../../mcp/mcpNotice";
import { distanceUnit, metersToDisplayDistance } from "../../units/units";
import { useUnitSystem } from "../../units/UnitSystemProvider";
import { formatDurationTotal, type WeekToDateTotals } from "../weeklyActivity";

interface TrainingSummaryTilesProps {
  totals: WeekToDateTotals;
  /** Whether MCP served the daily-health feed the step count comes from. */
  mcpConnected?: boolean;
  className?: string;
}

/** Which tone class a tile wears; the palettes live in `styles.css`. */
type TrainingSummaryMetric = "load" | "steps" | "distance" | "duration";

const ICON_SIZE = 13;

interface StatCardProps {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
  tone: TrainingSummaryMetric;
}

function StatCard({ icon, label, value, detail, tone }: StatCardProps) {
  return (
    <section className={`training-stat-card is-widget tone-${tone}`}>
      <div className="training-stat-card__icon" aria-hidden="true">
        {icon}
      </div>
      <p className="training-stat-card__label">{label}</p>
      <strong
        className={`training-stat-card__value${
          value === "–" ? " is-empty" : ""
        }`}
      >
        {value}
      </strong>
      <span className="training-stat-card__detail">{detail}</span>
    </section>
  );
}

function formatWholeNumber(value?: number): string {
  if (value === undefined || !Number.isFinite(value)) {
    return "–";
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
  mcpConnected,
  className
}: TrainingSummaryTilesProps) {
  const { unitSystem } = useUnitSystem();
  // Only where the figure is actually missing: a week that already has step
  // counts in it is not a tile with a problem to report.
  const stepsNeedMcp = mcpConnected === false && totals.steps === undefined;
  const unit = distanceUnit(unitSystem);
  const tilesClassName = ["training-summary-tiles is-stack", className ?? ""]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={tilesClassName}>
      <StatCard
        icon={<Flame size={ICON_SIZE} />}
        label="Load"
        value={formatWholeNumber(totals.trainingLoad)}
        detail="this week"
        tone="load"
      />

      <StatCard
        icon={<Footprints size={ICON_SIZE} />}
        label="Steps"
        value={formatWholeNumber(totals.steps)}
        detail={stepsNeedMcp ? MCP_DAILY_HEALTH_TILE_DETAIL : "this week"}
        tone="steps"
      />

      <StatCard
        icon={<Route size={ICON_SIZE} />}
        label="Distance"
        value={
          totals.distance !== undefined
            ? metersToDisplayDistance(totals.distance, unitSystem).toFixed(1)
            : "–"
        }
        detail={`${unit} this week`}
        tone="distance"
      />

      <StatCard
        icon={<Timer size={ICON_SIZE} />}
        label="Duration"
        value={
          totals.duration !== undefined
            ? formatDurationTotal(totals.duration)
            : "–"
        }
        detail="this week"
        tone="duration"
      />
    </div>
  );
}
