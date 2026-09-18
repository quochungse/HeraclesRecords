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
  mcpState?: McpConnectionState;
  /** The training snapshot both panels read has not arrived yet. */
  loading?: boolean;
  /** The MCP wellness load is still running, which only sleep waits on. */
  sleepLoading?: boolean;
}

/**
 * The two trend panels that share the last row of Overview. A training-load bar
 * chart used to lead this grid and take a full row on its own; it and everything
 * that drew it are gone, which is why the grid carries no positional rules —
 * two panels, two columns, and no odd one out to span.
 */
export function TrainingTrendCharts({
  points,
  mcpState,
  loading = false,
  sleepLoading = false
}: TrainingTrendChartsProps) {
  return (
    <div className="training-chart-grid">
      <HrvBaselineChart points={points} loading={loading} />

      <SleepTrendPanel
        points={points}
        mcpState={mcpState}
        loading={loading || sleepLoading}
      />
    </div>
  );
}
