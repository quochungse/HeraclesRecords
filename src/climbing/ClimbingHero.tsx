import { useMemo } from "react";
import type { ActivityDetailSummary, TrainingHubActivity } from "../../electron/types";
import type { ClimbFamily } from "../../electron/climbGrades";
import { DeltaChip } from "../running/RunningHero";
import { MotionFigure } from "../motion/MotionFigure";
import { isSend } from "../../electron/climbDetail";
import {
  buildClimbWeeks,
  gradeName,
  hardestSend,
  recordsWithin,
  sendRate,
  type ClimbRecord,
  type ClimbScales
} from "./climbMetrics";
import { CLIMB_STYLE_LABELS } from "./climbType";
import { getIntlLocale, plural, t } from "../i18n/core";

interface ClimbingHeroProps {
  /**
   * Sessions matching the kind filter, over the whole history — "this week",
   * its baseline and the twelve-week figures look back spans the period
   * filter must not cut short.
   */
  sessions: readonly TrainingHubActivity[];
  /** The climbs of those sessions whose summaries are read (`climbRecords`). */
  records: readonly ClimbRecord[];
  summaries: ReadonlyMap<string, ActivityDetailSummary>;
  /** Whether those summaries have all been read: until then a missing figure is on its way. */
  settled: boolean;
  scales: ClimbScales;
  /** The page's clock, so every block agrees on which week is "this" one. */
  nowMs: number;
}

/** Weeks the baseline averages over, plus the current one being compared. */
const BASELINE_WEEKS = 4;
/** The calendar weeks the hardest send is read over: a block of training. */
export const CLIMB_HERO_WEEKS = 12;
/** The calendar weeks the send rate is read over. */
const SEND_RATE_WEEKS = 4;

const FAMILIES: readonly ClimbFamily[] = ["route", "boulder"];

/**
 * The four figures a climber opens the screen for.
 *
 * The week is counted in climbs — routes and problems, sent or not — and the
 * sessions they took. Then the grades, each said twice, a route's and a
 * boulder's, because the two scales measure different things: the hardest
 * send of the last twelve weeks, the share of what was tried that was sent,
 * and the onsight grade the athlete set in COROS, which COROS's own climbing
 * workouts are written against.
 */
export function ClimbingHero({ sessions, records, summaries, settled, scales, nowMs }: ClimbingHeroProps) {
  const thisWeek = useMemo(() => {
    const weeks = buildClimbWeeks(sessions, summaries, { weeks: BASELINE_WEEKS + 1, nowMs });
    const current = weeks[weeks.length - 1];
    const past = weeks.slice(0, -1);
    if (!current) return null;
    // Weeks off the wall count as the zeros they were; climbs only where every week was read.
    const read = weeks.every((week) => week.unread === 0);
    const baseline = past.length > 0 ? past.reduce((sum, week) => sum + week.climbs, 0) / past.length : 0;
    return { current, read, ...(read && baseline > 0 ? { deltaRatio: (current.climbs - baseline) / baseline } : {}) };
  }, [sessions, summaries, nowMs]);

  const recent = useMemo(() => recordsWithin(records, CLIMB_HERO_WEEKS, nowMs), [records, nowMs]);
  const lastMonth = useMemo(() => recordsWithin(records, SEND_RATE_WEEKS, nowMs), [records, nowMs]);

  const hardest = useMemo(
    () => FAMILIES.flatMap((family) => {
      const record = hardestSend(recent, family);
      return record?.ladder !== undefined ? [{ family, record, name: gradeName(family, record.ladder, scales) }] : [];
    }),
    [recent, scales]
  );
  const rates = useMemo(
    () => FAMILIES.flatMap((family) => {
      const rate = sendRate(lastMonth, family);
      return rate.marked > 0 ? [{ family, ...rate }] : [];
    }),
    [lastMonth]
  );
  const onsight = FAMILIES.flatMap((family) => {
    const ladder = scales.onsight[family];
    return ladder !== undefined ? [{ family, name: gradeName(family, ladder, scales), above: abovesOf(recent, family, ladder) }] : [];
  });

  const count = thisWeek?.current.sessions ?? 0;
  const climbs = thisWeek?.current.climbs ?? 0;
  const reading = t("climb.reading");

  return (
    <section className="run-hero">
      <div className="run-hero-card">
        <span className="run-hero-label">{t("activity.hero.thisWeek")}</span>
        <strong className="run-hero-value">
          <MotionFigure
            text={count === 0 ? "—" : thisWeek?.current.unread && !settled ? "…" : plural("climb.climbCount", climbs)}
          />
        </strong>
        <div className="run-hero-foot">
          <span>{plural("climb.sessionCount", count)}</span>
          {thisWeek?.deltaRatio !== undefined ? <DeltaChip ratio={thisWeek.deltaRatio} /> : null}
        </div>
      </div>

      <div className="run-hero-card" title={t("climb.hero.hardestTitle")}>
        <span className="run-hero-label">{t("climb.hero.hardest")}</span>
        <strong className="run-hero-value">
          <MotionFigure text={hardest.length > 0 ? hardest.map((entry) => entry.name).join(" · ") : "—"} />
        </strong>
        <div className="run-hero-foot">
          <span className="climb-hero-name">
            {hardest.length > 0
              ? hardest.map((entry) => sentOn(entry.record)).join(" · ")
              : settled
                ? t("climb.hero.hardestNone")
                : reading}
          </span>
        </div>
      </div>

      <div className="run-hero-card" title={t("climb.hero.sendRateTitle")}>
        <span className="run-hero-label">{t("climb.hero.sendRate")}</span>
        <strong className="run-hero-value">
          <MotionFigure
            text={rates.length > 0 ? rates.map((entry) => `${Math.round((entry.sent / entry.marked) * 100)}%`).join(" · ") : "—"}
          />
        </strong>
        <div className="run-hero-foot">
          <span>
            {rates.length > 0
              ? rates
                  .map((entry) =>
                    t(entry.family === "boulder" ? "climb.hero.sentProblems" : "climb.hero.sentRoutes", {
                      sent: entry.sent,
                      marked: entry.marked
                    })
                  )
                  .join(" · ")
              : settled
                ? t("climb.hero.sendRateNone")
                : reading}
          </span>
        </div>
      </div>

      <div className="run-hero-card" title={t("climb.hero.onsightTitle")}>
        <span className="run-hero-label">{t("climb.hero.onsight")}</span>
        <strong className="run-hero-value">
          <MotionFigure text={onsight.length > 0 ? onsight.map((entry) => entry.name).join(" · ") : "—"} />
        </strong>
        <div className="run-hero-foot">
          <span>
            {onsight.length === 0
              ? t("climb.hero.onsightNone")
              : !settled
                ? reading
                : plural("climb.hero.onsightAbove", onsight.reduce((sum, entry) => sum + entry.above, 0))}
          </span>
        </div>
      </div>
    </section>
  );
}

/** "Redpoint, Nov 19": how the grade went and the day. */
function sentOn(record: ClimbRecord): string {
  const day = new Date((record.activity.startTime ?? 0) * 1000).toLocaleDateString(getIntlLocale(), {
    month: "short",
    day: "numeric"
  });
  return t("climb.hero.sentOn", { style: CLIMB_STYLE_LABELS[record.style], day });
}

/** Sends harder than the onsight grade, on one ladder. */
function abovesOf(records: readonly ClimbRecord[], family: ClimbFamily, ladder: number): number {
  return records.filter(
    (record) => record.family === family && record.ladder !== undefined && record.ladder > ladder && isSend(record.style)
  ).length;
}
