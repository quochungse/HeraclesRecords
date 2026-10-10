import type { ReactNode } from "react";
import { Flame, Footprints, Route, Timer } from "lucide-react";
import {
  mcpDailyHealthTileDetail,
  mcpUnreachableLabel,
  isMcpFailure,
  type McpConnectionState
} from "../../mcp/mcpNotice";
import { distanceUnit, metersToDisplayDistance } from "../../units/units";
import { useUnitSystem } from "../../units/UnitSystemProvider";
import {
  formatDurationTotal,
  type WeekToDateTotals
} from "../weeklyActivity";
import { formatCount, formatDecimal, t } from "../../i18n/core";
import { useI18n } from "../../i18n/useI18n";

interface WeekTotalsProps {
  totals: WeekToDateTotals;
  /** How the MCP server that serves the daily-health feed stood. */
  mcpState?: McpConnectionState;
}

export const WEEK_TOTALS_ICON_SIZE = 13;
export const EMPTY_FIGURE = "–";

/**
 * Unit letters inside an already-formatted figure — the `h` and `m` of
 * "5h 12m". They take the same suffix treatment the distance unit does, so all
 * four figures read as one set rather than as two conventions side by side.
 */
function withUnitSuffixes(value: string): ReactNode {
  // Letters in any script: a unit is "h" here and "giờ" or "時間" elsewhere.
  const parts = value.match(/[^\p{L}]+|\p{L}+/gu);
  if (!parts || parts.length === 1) {
    return value;
  }

  return parts.map((part, index) =>
    /\p{L}/u.test(part) ? (
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

  return formatCount(Math.round(value));
}

interface RowProps {
  icon: ReactNode;
  label: string;
  value: string;
  /** A unit not already inside `value` — the distance's km or mi. */
  unit?: string;
  /** What a row has to report on its own: the MCP state behind no steps. */
  notice?: string;
  /** What the figure is over, on hover — the nights an average counts. */
  hover?: string;
}

/** One figure of a totals column. The Sleep card's column is built of these too. */
export function WeekTotalsRow({ icon, label, value, unit, notice, hover }: RowProps) {
  const empty = value === EMPTY_FIGURE;

  return (
    <li className="week-totals-row">
      <span className="week-totals-label">
        <span className="week-totals-icon" aria-hidden="true">
          {icon}
        </span>
        {label}
      </span>
      <strong
        className={`week-totals-value${empty ? " is-empty" : ""}`}
        title={hover}
      >
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
  useI18n();
  const { unitSystem } = useUnitSystem();
  // Only where the figure is actually missing: a week that already has step
  // counts in it is not a row with a problem to report.
  const stepsNeedMcp = isMcpFailure(mcpState) && totals.steps === undefined;
  const stepsNotice = !stepsNeedMcp
    ? undefined
    : mcpState === "unreachable"
      ? mcpUnreachableLabel()
      : mcpDailyHealthTileDetail();

  return (
    <section className="week-totals" aria-label={t("overview.weekTotals.aria")}>
      <ul className="week-totals-list">
        <WeekTotalsRow
          icon={<Flame size={WEEK_TOTALS_ICON_SIZE} />}
          label={t("overview.tiles.load")}
          value={formatWholeNumber(totals.trainingLoad)}
        />
        <WeekTotalsRow
          icon={<Route size={WEEK_TOTALS_ICON_SIZE} />}
          label={t("overview.tiles.distance")}
          value={
            totals.distance !== undefined
              ? formatDecimal(metersToDisplayDistance(totals.distance, unitSystem), 1)
              : EMPTY_FIGURE
          }
          unit={distanceUnit(unitSystem)}
        />
        <WeekTotalsRow
          icon={<Timer size={WEEK_TOTALS_ICON_SIZE} />}
          label={t("overview.tiles.duration")}
          value={
            totals.duration !== undefined ? formatDurationTotal(totals.duration) : EMPTY_FIGURE
          }
        />
        <WeekTotalsRow
          icon={<Footprints size={WEEK_TOTALS_ICON_SIZE} />}
          label={t("overview.tiles.steps")}
          value={formatWholeNumber(totals.steps)}
          notice={stepsNotice}
        />
      </ul>
    </section>
  );
}
