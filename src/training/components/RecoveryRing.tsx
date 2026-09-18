import { useEffect, useState } from "react";
import { TrainingSummaryTiles } from "./TrainingSummaryTiles";
import { recoveryTone } from "../parsers";
import { MCP_DAILY_HEALTH_SUBJECT, isMcpFailure, mcpNotice } from "../../mcp/mcpNotice";
import type { TrainingSummaryMetrics } from "../types";
import type { WeekToDateTotals } from "../weeklyActivity";

interface RecoveryRingProps {
  summary: TrainingSummaryMetrics;
  weekTotals: WeekToDateTotals;
  /**
   * The snapshot has not arrived. Without it the ring falls to its neutral
   * tone, whose line is "Sync your watch to see live recovery guidance here" —
   * a job for the athlete, handed to them on every launch while the app was
   * mid-request and about to fill the ring in by itself.
   */
  loading?: boolean;
}

function readinessCopy(
  tone: "low" | "mid" | "high" | "neutral"
): { label: string; message: string } {
  switch (tone) {
    case "high":
      return {
        label: "Ready",
        message:
          "Recovery is strong. You're cleared for a hard session."
      };
    case "mid":
      return {
        label: "Moderate",
        message: "Recovery is climbing back. Keep today's effort easy to moderate."
      };
    case "low":
      return {
        label: "Recover",
        message:
          "Recovery is low. Prioritise rest and sleep before your next hard effort."
      };
    default:
      return {
        label: "Waiting",
        message: "Sync your watch to see live recovery guidance here."
      };
  }
}

export function RecoveryRing({
  summary,
  weekTotals,
  loading = false
}: RecoveryRingProps) {
  const [isReady, setIsReady] = useState(false);
  const recovery = summary.recoveryPct ?? 0;
  const percent = Math.max(0, Math.min(100, recovery));
  const hasData = percent > 0;
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const targetOffset = circumference - (percent / 100) * circumference;
  const tone = hasData ? recoveryTone(percent) : "neutral";
  const waiting = loading && !hasData;
  const { label, message } = waiting
    ? { label: "Reading", message: "Reading your recovery from COROS…" }
    : readinessCopy(tone);
  // A tile's one line can say the step count needs MCP but not where to
  // connect it, so that is said once underneath.
  const dailyHealthMcpNotice =
    isMcpFailure(summary.mcpState) && weekTotals.steps === undefined
      ? mcpNotice(MCP_DAILY_HEALTH_SUBJECT, summary.mcpState)
      : null;

  useEffect(() => {
    const frame = requestAnimationFrame(() => setIsReady(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <section
      className={`panel training-ring-panel tone-${tone}`}
      aria-busy={waiting || undefined}
    >
      <div className="training-ring-header">
        <p className="eyebrow">Recovery</p>
      </div>

      <div className="training-ring-content">
        <div
          className={`storage-ring training-recovery-ring${
            isReady ? " is-ready" : ""
          }`}
          aria-label={`${Math.round(percent)}% recovery`}
        >
          <svg viewBox="0 0 128 128" aria-hidden="true">
            <circle className="storage-ring-track" cx="64" cy="64" r={radius} />
            <circle
              className="storage-ring-progress training-recovery-ring-progress"
              cx="64"
              cy="64"
              r={radius}
              strokeDasharray={circumference}
              strokeDashoffset={isReady ? targetOffset : circumference}
              transform="rotate(-90 64 64)"
            />
          </svg>
          <div className="storage-ring-label">
            <strong>{hasData ? `${Math.round(percent)}%` : "–"}</strong>
            <span>{label}</span>
          </div>
        </div>

        <p className="training-ring-message">{message}</p>

        <TrainingSummaryTiles
          totals={weekTotals}
          mcpState={summary.mcpState}
          className="training-ring-metrics"
        />

        {dailyHealthMcpNotice ? (
          <p className="training-ring-message is-quiet">{dailyHealthMcpNotice}</p>
        ) : null}
      </div>
    </section>
  );
}
