import { useMemo } from "react";
import type {
  ActivityDetailSummary,
  SwimStyleTotals,
  TrainingHubActivity
} from "../../electron/types";
import {
  secondsPer100m,
  styleDistancePerStroke,
  styleStrokeRate,
  styleStrokesPerLength,
  styleSwolf
} from "../../electron/swimDetail";
import { formatDistanceMeters } from "../training/formatters";
import { useUnitSystem } from "../units/UnitSystemProvider";
import {
  combineSwimStyles,
  formatDistancePerStroke,
  formatPer100,
  swimSummaryFor
} from "./swimMetrics";
import { SWIM_STYLE_LABELS } from "./swimType";
import { SWIM_STYLE_COLORS } from "./swimColors";
import { formatDecimal, t } from "../i18n/core";

interface SwimStrokePanelProps {
  /** Pool swims in the period: open water records no stroke. */
  swims: readonly TrainingHubActivity[];
  summaries: ReadonlyMap<string, ActivityDetailSummary>;
  /** Whether those summaries have all been read: until then an empty table is not yet an answer. */
  settled: boolean;
}

/**
 * The strokes the period was swum in, by distance, and how each one went —
 * the split a swimmer's log keeps: so much free, so much back, the kick sets.
 * Drills carry no stroke count, so their stroke figures stay empty.
 *
 * Read across pools, so its stroke figures are the ones that travel between
 * them — distance per stroke and stroke rate — and not SWOLF or strokes a
 * length, which a swim's own page states in its one pool.
 */
export function SwimStrokePanel({ swims, summaries, settled }: SwimStrokePanelProps) {
  const totals = useMemo(
    () =>
      combineSwimStyles(
        swims.flatMap((activity) => {
          const summary = swimSummaryFor(activity, summaries);
          return summary ? [summary] : [];
        })
      ),
    [summaries, swims]
  );

  return (
    <section className="panel run-block">
      <p className="running-eyebrow">{t("swim.strokes.title")}</p>
      {totals.length > 0 ? (
        <SwimStrokeTable totals={totals} />
      ) : (
        <p className="run-block-empty">{settled ? t("swim.strokes.none") : t("swim.reading")}</p>
      )}
      <p className="run-block-note">{t("swim.strokes.note")}</p>
    </section>
  );
}

interface SwimStrokeTableProps {
  totals: readonly SwimStyleTotals[];
  /**
   * One pool's strokes — a swim's own page — where SWOLF and strokes a length
   * mean something and take the place of the figures that travel.
   */
  onePool?: boolean;
}

/** The share bar and the table: a stroke a row, in the app's stroke order. */
export function SwimStrokeTable({ totals, onePool = false }: SwimStrokeTableProps) {
  const { unitSystem } = useUnitSystem();
  const meters = totals.reduce((sum, entry) => sum + entry.meters, 0);

  return (
    <>
      {totals.length > 1 ? (
        <div className="run-surface-bar">
          {totals.map((entry) => (
            <div
              key={entry.style}
              style={{
                flexGrow: Math.max(meters > 0 ? entry.meters / meters : 0, 0.02),
                background: SWIM_STYLE_COLORS[entry.style]
              }}
              title={t("swim.strokes.share", {
                style: SWIM_STYLE_LABELS[entry.style],
                percent: Math.round(meters > 0 ? (entry.meters / meters) * 100 : 0)
              })}
            />
          ))}
        </div>
      ) : null}

      <div className="run-table-scroll">
        <table className="run-list run-surface-table">
          <thead>
            <tr>
              <th scope="col">{t("swim.m.stroke")}</th>
              {/* The half-width panel reads the share off the bar above it. */}
              {onePool ? <th scope="col" className="is-numeric">{t("run.share")}</th> : null}
              <th scope="col" className="is-numeric">{t("activity.m.distance")}</th>
              <th scope="col" className="is-numeric">{t("activity.m.pace")}</th>
              {onePool ? (
                <>
                  <th scope="col" className="is-numeric" title={t("swim.m.strokesTitle")}>
                    {t("swim.m.strokesPerLength")}
                  </th>
                  <th scope="col" className="is-numeric" title={t("swim.m.swolfTitle")}>
                    {t("swim.m.swolf")}
                  </th>
                </>
              ) : (
                <th scope="col" className="is-numeric" title={t("swim.m.dpsTitle")}>
                  {t("swim.m.dps")}
                </th>
              )}
              <th scope="col" className="is-numeric" title={t("swim.m.strokeRateTitle")}>
                {t("swim.m.strokeRate")}
              </th>
            </tr>
          </thead>
          <tbody>
            {totals.map((entry) => {
              const strokesPerLength = styleStrokesPerLength(entry);
              const swolf = styleSwolf(entry);
              const rate = styleStrokeRate(entry);
              return (
                <tr key={entry.style}>
                  <td>
                    <span className="run-surface-swatch" style={{ background: SWIM_STYLE_COLORS[entry.style] }} />
                    {SWIM_STYLE_LABELS[entry.style]}
                  </td>
                  {onePool ? (
                    <td className="is-numeric">
                      {Math.round(meters > 0 ? (entry.meters / meters) * 100 : 0)}%
                    </td>
                  ) : null}
                  <td className="is-numeric">{formatDistanceMeters(entry.meters, unitSystem, true)}</td>
                  <td className="is-numeric">
                    {formatPer100(secondsPer100m(entry.seconds, entry.meters), unitSystem)}
                  </td>
                  {onePool ? (
                    <>
                      <td className="is-numeric">
                        {strokesPerLength === undefined ? "—" : formatDecimal(strokesPerLength, 1)}
                      </td>
                      <td className="is-numeric">{swolf === undefined ? "—" : formatDecimal(swolf, 0)}</td>
                    </>
                  ) : (
                    <td className="is-numeric">
                      {formatDistancePerStroke(styleDistancePerStroke(entry), unitSystem)}
                    </td>
                  )}
                  <td className="is-numeric">
                    {rate === undefined ? "—" : t("swim.rateValue", { value: Math.round(rate) })}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
