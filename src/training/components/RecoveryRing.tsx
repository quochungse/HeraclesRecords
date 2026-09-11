import { useEffect, useState } from "react";
import { TrainingSummaryTiles } from "./TrainingSummaryTiles";
import { recoveryTone } from "../parsers";
import { MCP_DAILY_HEALTH_NOTICE } from "../../mcp/mcpNotice";
import type { TrainingSummaryMetrics } from "../types";

interface RecoveryRingProps {
  summary: TrainingSummaryMetrics;
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

export function RecoveryRing({ summary }: RecoveryRingProps) {
  const [isReady, setIsReady] = useState(false);
  const recovery = summary.recoveryPct ?? 0;
  const percent = Math.max(0, Math.min(100, recovery));
  const hasData = percent > 0;
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const targetOffset = circumference - (percent / 100) * circumference;
  const tone = hasData ? recoveryTone(percent) : "neutral";
  const { label, message } = readinessCopy(tone);
  // A tile's one line can say a figure needs MCP but not where to connect it,
  // so that is said once underneath. Either figure missing counts — one feed.
  const dailyHealthNeedsMcp =
    summary.mcpConnected === false &&
    (summary.steps === undefined || summary.calories === undefined);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setIsReady(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <section className={`panel training-ring-panel tone-${tone}`}>
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
          summary={summary}
          layout="stack"
          metrics={["load", "heart", "steps", "calories"]}
          className="training-ring-metrics"
        />

        {dailyHealthNeedsMcp ? (
          <p className="training-ring-message is-quiet">
            {MCP_DAILY_HEALTH_NOTICE}
          </p>
        ) : null}
      </div>
    </section>
  );
}
