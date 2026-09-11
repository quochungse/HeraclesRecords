import { HrvBaselineChart } from "./HrvBaselineChart";
import { SleepTrendPanel } from "./SleepTrendPanel";
import type { McpConnectionState } from "../../mcp/mcpNotice";
import type { TrainingTrendPoint } from "../types";

interface TrainingTrendChartsProps {
  points: TrainingTrendPoint[];
  /**
   * Only the sleep panel reads it: HRV and RHR are web-API series and are
   * unaffected by an MCP server being down.
   */
  mcpConnected?: McpConnectionState;
}

/**
 * The two trend panels that share a row. The training load chart used to lead
 * this grid and take the row above on its own; it was removed from Overview,
 * which is why the grid has no positional rules left — two panels, two columns.
 * `trainingLoadBars.ts` and its suite are what drew it, and still stand.
 */
export function TrainingTrendCharts({
  points,
  mcpConnected
}: TrainingTrendChartsProps) {
  return (
    <div className="training-chart-grid">
      <HrvBaselineChart points={points} />

      <SleepTrendPanel points={points} mcpConnected={mcpConnected} />
    </div>
  );
}
