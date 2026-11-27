import { useMemo } from "react";
import type { ActivityDetailSummary, TrainingHubActivity } from "../../electron/types";
import { formatDurationSpan } from "../training/formatters";
import { climbKindBreakdown, type ClimbScales } from "./climbMetrics";
import { CLIMB_KIND_LABELS } from "./climbType";
import { climbKindColors } from "./climbColors";
import { t } from "../i18n/core";

interface ClimbKindPanelProps {
  /** Deliberately unfiltered by kind: this panel *is* the split by kind. */
  sessions: readonly TrainingHubActivity[];
  summaries: ReadonlyMap<string, ActivityDetailSummary>;
  scales: ClimbScales;
  /** Whether the summaries have all been read: until then a figure that needs them is on its way. */
  settled: boolean;
}

/**
 * Indoor routes, boulders and outdoor days side by side: how the sessions
 * divided, what each kind climbed and the hardest it sent. The one block the
 * kind filter does not narrow — the comparison is the content, as on
 * Hiking's kinds.
 */
export function ClimbKindPanel({ sessions, summaries, scales, settled }: ClimbKindPanelProps) {
  const palette = useMemo(() => climbKindColors(), []);
  const breakdown = useMemo(() => climbKindBreakdown(sessions, summaries, scales), [scales, sessions, summaries]);

  if (breakdown.length === 0) {
    return null;
  }

  return (
    <section className="panel run-block">
      <p className="running-eyebrow">{t("climb.kinds")}</p>

      {breakdown.length > 1 ? (
        <div className="run-surface-bar">
          {breakdown.map((entry) => (
            <div
              key={entry.kind}
              style={{ flexGrow: Math.max(entry.share, 0.02), background: palette[entry.kind] }}
              title={t("climb.kindShare", { kind: CLIMB_KIND_LABELS[entry.kind], percent: Math.round(entry.share * 100) })}
            />
          ))}
        </div>
      ) : null}

      <div className="run-table-scroll">
        <table className="run-list run-surface-table">
          <thead>
            <tr>
              <th scope="col">{t("climb.kind")}</th>
              <th scope="col" className="is-numeric">{t("climb.sessions")}</th>
              <th scope="col" className="is-numeric">{t("climb.climbs")}</th>
              <th scope="col" className="is-numeric">{t("climb.list.hardest")}</th>
              <th scope="col" className="is-numeric" title={t("climb.list.sentTitle")}>
                {t("climb.list.sent")}
              </th>
              <th scope="col" className="is-numeric">{t("climb.climbingTime")}</th>
            </tr>
          </thead>
          <tbody>
            {breakdown.map((entry) => {
              // Read off the sessions' summaries: still reading is not none.
              const none = settled ? "—" : "…";
              return (
                <tr key={entry.kind}>
                  <td>
                    <span className="run-surface-swatch" style={{ background: palette[entry.kind] }} />
                    {CLIMB_KIND_LABELS[entry.kind]}
                  </td>
                  <td className="is-numeric">{entry.sessions}</td>
                  <td className="is-numeric">{entry.climbs > 0 ? entry.climbs : none}</td>
                  <td className="is-numeric">{entry.hardest ?? none}</td>
                  <td className="is-numeric">
                    {entry.sent ? `${Math.round((entry.sent.sent / entry.sent.marked) * 100)}%` : none}
                  </td>
                  <td className="is-numeric">
                    {entry.climbingSeconds > 0 ? formatDurationSpan(entry.climbingSeconds) : none}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="run-block-note">{t("climb.kindsNote")}</p>
    </section>
  );
}
