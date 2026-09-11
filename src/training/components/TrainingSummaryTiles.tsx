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
  layout?: "row" | "stack";
  metrics?: TrainingSummaryMetric[];
  className?: string;
}

type TrainingSummaryMetric = "load" | "steps" | "distance" | "duration";

interface StatCardProps {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
  variant?: "bar" | "widget";
  tone?: TrainingSummaryMetric;
}

function StatCard({
  icon,
  label,
  value,
  detail,
  variant = "bar",
  tone = "load"
}: StatCardProps) {
  if (variant === "widget") {
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

  return (
    <section className={`training-stat-card tone-${tone}`}>
      <div className="training-stat-card__icon" aria-hidden="true">
        {icon}
      </div>
      <p className="training-stat-card__label">{label}</p>
      <span className="training-stat-card__detail">{detail}</span>
      <strong className="training-stat-card__value">{value}</strong>
    </section>
  );
}

function formatWholeNumber(value?: number): string {
  if (value === undefined || !Number.isFinite(value)) {
    return "–";
  }

  return Math.round(value).toLocaleString();
}

/** Every tile is a Monday-to-today total; see `buildWeekToDateTotals`. */
export function TrainingSummaryTiles({
  totals,
  mcpConnected,
  layout = "row",
  metrics = ["load", "steps", "distance", "duration"],
  className
}: TrainingSummaryTilesProps) {
  const { unitSystem } = useUnitSystem();
  const variant = layout === "stack" ? "widget" : "bar";
  /** The two wordings every tile carries, picked once rather than per tile. */
  const copy = (widget: string, bar: string) =>
    variant === "widget" ? widget : bar;
  // Only where the figure is actually missing: a week that already has step
  // counts in it is not a tile with a problem to report.
  const stepsNeedMcp = mcpConnected === false && totals.steps === undefined;
  const unit = distanceUnit(unitSystem);
  const iconSize = variant === "widget" ? 13 : 16;
  const tilesClassName = [
    "training-summary-tiles",
    layout === "stack" ? "is-stack" : "",
    className ?? ""
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={tilesClassName}>
      {metrics.includes("load") ? (
        <StatCard
          icon={<Flame size={iconSize} />}
          label={copy("Load", "Training Load")}
          value={formatWholeNumber(totals.trainingLoad)}
          detail={copy("this week", "training load this week")}
          variant={variant}
          tone="load"
        />
      ) : null}

      {metrics.includes("steps") ? (
        <StatCard
          icon={<Footprints size={iconSize} />}
          label="Steps"
          value={formatWholeNumber(totals.steps)}
          detail={
            stepsNeedMcp
              ? MCP_DAILY_HEALTH_TILE_DETAIL
              : copy("this week", "steps this week")
          }
          variant={variant}
          tone="steps"
        />
      ) : null}

      {metrics.includes("distance") ? (
        <StatCard
          icon={<Route size={iconSize} />}
          label="Distance"
          value={
            totals.distance !== undefined
              ? metersToDisplayDistance(totals.distance, unitSystem).toFixed(1)
              : "–"
          }
          detail={`${unit} this week`}
          variant={variant}
          tone="distance"
        />
      ) : null}

      {metrics.includes("duration") ? (
        <StatCard
          icon={<Timer size={iconSize} />}
          label="Duration"
          value={
            totals.duration !== undefined
              ? formatDurationTotal(totals.duration)
              : "–"
          }
          detail={copy("this week", "time trained this week")}
          variant={variant}
          tone="duration"
        />
      ) : null}
    </div>
  );
}
