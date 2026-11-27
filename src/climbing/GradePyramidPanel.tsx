import { useMemo } from "react";
import type { ClimbFamily } from "../../electron/climbGrades";
import { OptionGroup } from "../components/OptionGroup";
import { gradeName, gradePyramid, type ClimbRecord, type ClimbScales } from "./climbMetrics";
import { CLIMB_FAMILY_LABELS } from "./climbType";
import type { ClimbStyleGroup } from "./climbColors";
import { plural, t } from "../i18n/core";

interface GradePyramidPanelProps {
  /** The climbs of the sessions on screen, every family. */
  records: readonly ClimbRecord[];
  /** The families those climbs were graded in, routes first. */
  families: readonly ClimbFamily[];
  family: ClimbFamily;
  onFamilyChange: (family: ClimbFamily) => void;
  scales: ClimbScales;
  settled: boolean;
}

/** The segments of a row, sent first go first: the order a climber reads them in. */
const SEGMENTS: readonly ClimbStyleGroup[] = ["firstGo", "worked", "attempt", "unrecorded"];

const SEGMENT_LABEL: Readonly<Record<ClimbStyleGroup, () => string>> = {
  firstGo: () => t("climb.group.firstGo"),
  worked: () => t("climb.group.worked"),
  attempt: () => t("climb.style.attempt"),
  unrecorded: () => t("climb.style.unrecorded")
};

/**
 * Every graded climb of the period, one row a grade, hardest on top: sent on
 * the first go (onsight or flash), sent after working it (redpoint or a
 * repeat), not sent, and not marked. A pyramid is how a climber reads their
 * level — a broad base of sends under the hardest grades — and its rows are
 * the scale the athlete climbs in, every grade recorded in another converted
 * through COROS's ladder. Routes and boulders each have their own.
 */
export function GradePyramidPanel({
  records,
  families,
  family,
  onFamilyChange,
  scales,
  settled
}: GradePyramidPanelProps) {
  const pyramid = useMemo(() => gradePyramid(records, family, scales), [family, records, scales]);
  const widest = Math.max(1, ...pyramid.rows.map((row) => row.total));
  const present = SEGMENTS.filter((segment) => pyramid.rows.some((row) => row.counts[segment] > 0));

  return (
    <section className="panel run-block climb-pyramid">
      <header className="run-block-head">
        <div>
          <p className="running-eyebrow">{t("climb.pyramid.title")}</p>
          <h3>
            {pyramid.hardest?.ladder !== undefined ? (
              <>
                {gradeName(family, pyramid.hardest.ladder, scales)}
                <span className="run-block-sub">
                  {" "}
                  {t(family === "boulder" ? "climb.pyramid.captionProblems" : "climb.pyramid.captionRoutes", {
                    sent: pyramid.sent,
                    graded: pyramid.graded
                  })}
                </span>
              </>
            ) : (
              <span className="run-block-sub">
                {!settled ? t("climb.reading") : pyramid.graded === 0 ? t("climb.pyramid.none") : t("climb.pyramid.noSend")}
              </span>
            )}
          </h3>
        </div>
        {families.length > 1 ? (
          <OptionGroup
            label={t("climb.family.label")}
            motion="slide"
            value={family}
            options={families.map((entry) => ({ value: entry, label: CLIMB_FAMILY_LABELS[entry] }))}
            onChange={(next) => onFamilyChange(next as ClimbFamily)}
          />
        ) : null}
      </header>

      {pyramid.rows.length > 0 ? (
        <ol className="climb-pyramid-rows">
          {pyramid.rows.map((row) => (
            <li key={row.name} className={row.onsight ? "is-onsight" : undefined}>
              <span className="climb-pyramid-grade">{row.name}</span>
              <span className="climb-pyramid-bar" aria-hidden="true">
                {SEGMENTS.map((segment) =>
                  row.counts[segment] > 0 ? (
                    <span
                      key={segment}
                      className={`climb-segment climb-group-${segment}`}
                      style={{ width: `${(row.counts[segment] / widest) * 100}%` }}
                      title={`${SEGMENT_LABEL[segment]()} ${row.counts[segment]}`}
                    />
                  ) : null
                )}
              </span>
              <span className="climb-pyramid-count">{row.total}</span>
              <span className="climb-pyramid-tag">{row.onsight ? t("climb.pyramid.onsight") : ""}</span>
            </li>
          ))}
        </ol>
      ) : null}

      {present.length > 0 ? (
        <div className="run-legend">
          {present.map((segment) => (
            <span key={segment}>
              <i className={`is-bar climb-group-${segment}`} />
              {SEGMENT_LABEL[segment]()}
            </span>
          ))}
        </div>
      ) : null}
      <p className="run-block-note">
        {pyramid.ungraded > 0
          ? `${t("climb.pyramid.note")} ${plural("climb.pyramid.ungraded", pyramid.ungraded)}`
          : t("climb.pyramid.note")}
      </p>
    </section>
  );
}
