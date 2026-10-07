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
  type WeekToDateTotals
} from "../weeklyActivity";

interface WeekTotalsProps {
  totals: WeekToDateTotals;
  /** How the MCP server that serves the daily-health feed stood. */
  mcpState?: McpConnectionState;
}

const ICON_SIZE = 13;
const EMPTY_FIGURE = "–";

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
      <span className="week-totals-unit" key={`${index}-${part}`}>
        {part}
      </span>
    ) : (
      part
    )
  );
}

function formatWholeNumber(value?: number): string {
  if (value === undefined || !Number.isFinite(value)) {
    return EMPTY_FIGURE;
  }

  return Math.round(value).toLocaleString();
}

interface RowProps {
  icon: ReactNode;
  label: string;
  value: string;
  /** A unit not already inside `value` — the distance's km or mi. */
  unit?: string;
  /** What a row has to report on its own: the MCP state behind no steps. */
  notice?: string;
}

function Row({ icon, label, value, unit, notice }: RowProps) {
  const empty = value === EMPTY_FIGURE;

  return (
    <li className="week-totals-row">
      <span className="week-totals-label">
        <span className="week-totals-icon" aria-hidden="true">
          {icon}
        </span>
        {label}
      </span>
      <strong className={`week-totals-value${empty ? " is-empty" : ""}`}>
        {withUnitSuffixes(value)}
        {/* No unit on an absent figure: "– km" reads as a measurement of
            nothing, where "–" reads as the figure not having arrived. */}
        {unit && !empty ? <span className="week-totals-unit">{unit}</span> : null}
      </strong>
      {notice ? <span className="week-totals-notice">{notice}</span> : null}
    </li>
  );
}

/**
 * The week's four totals, Monday to today (`buildWeekToDateTotals`), beside the
 * Weekly Activity chart they total. One list rather than four tiles: they are
 * four figures of one kind for one week, so one box holds them and a hairline
 * divides them. Which days they cover is the panel's title.
 *
 * No per-figure hue, as before: hue in this app belongs to data that has one —
 * sport, sleep stage, heart-rate zone, load band.
 */
export function WeekTotals({ totals, mcpState }: WeekTotalsProps) {
  const { unitSystem } = useUnitSystem();
  // Only where the figure is actually missing: a week that already has step
  // counts in it is not a row with a problem to report.
  const stepsNeedMcp = isMcpFailure(mcpState) && totals.steps === undefined;
  const stepsNotice = !stepsNeedMcp
    ? undefined
    : mcpState === "unreachable"
      ? MCP_UNREACHABLE_LABEL
      : MCP_DAILY_HEALTH_TILE_DETAIL;

  return (
    <section className="week-totals" aria-label="This week's totals">
      <ul className="week-totals-list">
        <Row
          icon={<Flame size={ICON_SIZE} />}
          label="Load"
          value={formatWholeNumber(totals.trainingLoad)}
        />
        <Row
          icon={<Route size={ICON_SIZE} />}
          label="Distance"
          value={
            totals.distance !== undefined
              ? metersToDisplayDistance(totals.distance, unitSystem).toFixed(1)
              : EMPTY_FIGURE
          }
          unit={distanceUnit(unitSystem)}
        />
        <Row
          icon={<Timer size={ICON_SIZE} />}
          label="Duration"
          value={
            totals.duration !== undefined ? formatDurationTotal(totals.duration) : EMPTY_FIGURE
          }
        />
        <Row
          icon={<Footprints size={ICON_SIZE} />}
          label="Steps"
          value={formatWholeNumber(totals.steps)}
          notice={stepsNotice}
        />
      </ul>
    </section>
  );
}
