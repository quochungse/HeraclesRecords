import { useMemo } from "react";
import type { ActivityDetailSummary, TrainingHubActivity } from "../../electron/types";
import { formatDecimal, t } from "../i18n/core";
import { formatClimbClock, wallFigures } from "./climbMetrics";

interface ClimbWallPanelProps {
  sessions: readonly TrainingHubActivity[];
  summaries: ReadonlyMap<string, ActivityDetailSummary>;
  settled: boolean;
}

/**
 * How a session is spent: the share of it on the wall, how long a route and a
 * problem take, the time off the wall per climb — resting, belaying, reading
 * the next line — and how often a climb ends in a fall.
 */
export function ClimbWallPanel({ sessions, summaries, settled }: ClimbWallPanelProps) {
  const figures = useMemo(() => wallFigures(sessions, summaries), [sessions, summaries]);
  const share = figures.share;

  const cells: Array<{ label: string; value: string; title?: string }> = [];
  if (figures.avgRouteSeconds !== undefined) {
    cells.push({ label: t("climb.wall.route"), value: formatClimbClock(figures.avgRouteSeconds) });
  }
  if (figures.avgProblemSeconds !== undefined) {
    cells.push({ label: t("climb.wall.problem"), value: formatClimbClock(figures.avgProblemSeconds) });
  }
  if (figures.restPerClimb !== undefined) {
    cells.push({ label: t("climb.wall.rest"), value: formatClimbClock(figures.restPerClimb), title: t("climb.wall.restTitle") });
  }
  if (figures.fallsPerClimb !== undefined) {
    cells.push({ label: t("climb.wall.falls"), value: formatDecimal(figures.fallsPerClimb, 2) });
  }

  return (
    <section className="panel run-block">
      <header className="run-block-head">
        <div>
          <p className="running-eyebrow">{t("climb.wall.title")}</p>
          <h3>
            {share !== undefined ? `${Math.round(share * 100)}%` : ""}
            <span className="run-block-sub">
              {" "}
              {share !== undefined ? t("climb.wall.share") : settled ? t("climb.wall.none") : t("climb.reading")}
            </span>
          </h3>
        </div>
      </header>
      {share !== undefined ? (
        <div className="climb-wall-bar" aria-hidden="true">
          <span className="climb-wall-on" style={{ flexGrow: share }} />
          <span className="climb-wall-off" style={{ flexGrow: 1 - share }} />
        </div>
      ) : null}
      {cells.length > 0 ? (
        <div className="climb-wall-cells">
          {cells.map((cell) => (
            <div className="running-stat" key={cell.label} title={cell.title}>
              <span>{cell.label}</span>
              <strong>{cell.value}</strong>
            </div>
          ))}
        </div>
      ) : null}
      <p className="run-block-note">{t("climb.wall.note")}</p>
    </section>
  );
}
