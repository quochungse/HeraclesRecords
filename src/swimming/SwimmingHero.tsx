import { useMemo } from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import type { ActivityDetailSummary, TrainingHubActivity } from "../../electron/types";
import { formatDistanceMeters, formatTrainingTableWhen } from "../training/formatters";
import { useUnitSystem } from "../units/UnitSystemProvider";
import { DeltaChip } from "../running/RunningHero";
import {
  bestEffortIn,
  buildSwimWeeks,
  criticalSwimSpeed,
  formatPer100,
  formatPoolLength,
  poolsSwum,
  techniqueWindow
} from "./swimMetrics";
import { formatDecimal, plural, t } from "../i18n/core";

interface SwimmingHeroProps {
  /**
   * Swims matching the kind filter, over the whole history — "this week", its
   * baseline and the twelve-week figures look back spans the period filter
   * must not cut short.
   */
  swims: readonly TrainingHubActivity[];
  summaries: ReadonlyMap<string, ActivityDetailSummary>;
  /** The page's clock, so every block agrees on which week is "this" one. */
  nowMs: number;
}

/** Weeks the baseline averages over, plus the current one being compared. */
const BASELINE_WEEKS = 4;
/** The window CSS and the best 100 are read over: a block of training. */
export const SWIM_HERO_DAYS = 84;
/** The window SWOLF is read over, against the one before it. */
const SWOLF_DAYS = 28;

/**
 * The four figures a swimmer opens the screen for.
 *
 * Running's hero layout with a swimmer's cards. The week is read in metres.
 * Critical Swim Speed is the swimmer's threshold — the pace a long set is
 * held at, and what a coach writes a set against — worked out from the
 * fastest 200 and 400 swum without stopping, as a CSS test is. SWOLF is the
 * swimmer's efficiency figure, read in one length of pool on freestyle,
 * where a lower number is the better one. And the best 100, the distance
 * every swimmer knows their time for.
 */
export function SwimmingHero({ swims, summaries, nowMs }: SwimmingHeroProps) {
  const { unitSystem } = useUnitSystem();

  const thisWeek = useMemo(() => {
    const weeks = buildSwimWeeks(swims, { weeks: BASELINE_WEEKS + 1, nowMs });
    const current = weeks[weeks.length - 1];
    const past = weeks.slice(0, -1);
    if (!current) {
      return null;
    }
    // Weeks out of the water count as the zeros they were.
    const baseline =
      past.length > 0 ? past.reduce((sum, week) => sum + week.distance, 0) / past.length : 0;
    return { current, ...(baseline > 0 ? { deltaRatio: (current.distance - baseline) / baseline } : {}) };
  }, [swims, nowMs]);

  const css = useMemo(() => {
    const window = { days: SWIM_HERO_DAYS, nowMs };
    const t200 = bestEffortIn(swims, summaries, 200, window);
    const t400 = bestEffortIn(swims, summaries, 400, window);
    const speed = t200 && t400 ? criticalSwimSpeed(t200.seconds, t400.seconds) : undefined;
    return { t200, t400, speed };
  }, [nowMs, summaries, swims]);

  const swolf = useMemo(() => {
    const recentPools = poolsSwum(
      swims.filter((activity) => (activity.startTime ?? 0) * 1000 >= nowMs - SWIM_HERO_DAYS * 86_400_000),
      summaries
    );
    const pool = recentPools[0];
    if (!pool) {
      return null;
    }
    return {
      pool,
      ...techniqueWindow(swims, summaries, "swolf", { days: SWOLF_DAYS, nowMs, poolLength: pool.poolLength })
    };
  }, [nowMs, summaries, swims]);

  const best100 = useMemo(
    () => bestEffortIn(swims, summaries, 100, { days: SWIM_HERO_DAYS, nowMs }),
    [nowMs, summaries, swims]
  );

  const count = thisWeek?.current.count ?? 0;

  return (
    <section className="run-hero">
      <div className="run-hero-card">
        <span className="run-hero-label">{t("activity.hero.thisWeek")}</span>
        <strong className="run-hero-value">
          {count > 0 ? formatDistanceMeters(thisWeek?.current.distance, unitSystem, true) : "—"}
        </strong>
        <div className="run-hero-foot">
          <span>{plural("swim.count", count)}</span>
          {thisWeek?.deltaRatio !== undefined ? <DeltaChip ratio={thisWeek.deltaRatio} /> : null}
        </div>
      </div>

      <div className="run-hero-card" title={t("swim.hero.cssTitle")}>
        <span className="run-hero-label">{t("swim.hero.css")}</span>
        <strong className="run-hero-value">
          {css.speed ? formatPer100(css.speed.secondsPer100, unitSystem) : "—"}
        </strong>
        <div className="run-hero-foot">
          <span>
            {css.speed && css.t200 && css.t400
              ? t("swim.hero.cssFrom", {
                  t200: formatClock(css.t200.seconds),
                  t400: formatClock(css.t400.seconds)
                })
              : t("swim.hero.cssNone")}
          </span>
        </div>
      </div>

      <div className="run-hero-card" title={t("swim.hero.swolfTitle")}>
        <span className="run-hero-label">{t("swim.hero.swolf")}</span>
        <strong className="run-hero-value">
          {swolf?.median !== undefined ? formatDecimal(swolf.median, 0) : "—"}
        </strong>
        <div className="run-hero-foot">
          <span>
            {swolf
              ? t("swim.hero.swolfFoot", { pool: formatPoolLength(swolf.pool.poolLength, swolf.pool.poolUnit) })
              : t("swim.hero.swolfNone")}
          </span>
          {swolf?.median !== undefined && swolf.previous !== undefined ? (
            <SwolfDelta change={swolf.median - swolf.previous} />
          ) : null}
        </div>
      </div>

      <div className="run-hero-card" title={t("swim.hero.best100Title")}>
        <span className="run-hero-label">{t("swim.hero.best100")}</span>
        <strong className="run-hero-value">{best100 ? formatClock(best100.seconds) : "—"}</strong>
        <div className="run-hero-foot">
          <span className="swim-hero-name" title={best100?.activity.name}>
            {best100
              ? `${best100.activity.name?.trim() || t("swim.type.pool")} · ${formatTrainingTableWhen(best100.activity.startTime)}`
              : t("swim.hero.best100None")}
          </span>
        </div>
      </div>
    </section>
  );
}

/** `1:38.4` under ten minutes, `12:05` above — how a swimmer writes a time. */
export function formatClock(seconds: number): string {
  if (seconds < 600) {
    const whole = Math.floor(seconds);
    const tenths = Math.round((seconds - whole) * 10);
    const carried = tenths === 10 ? whole + 1 : whole;
    return `${Math.floor(carried / 60)}:${String(carried % 60).padStart(2, "0")}.${tenths === 10 ? 0 : tenths}`;
  }
  const rounded = Math.round(seconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const rest = String(rounded % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

/**
 * SWOLF against the window before: a fall is the good news, so it wears the
 * colour a rise does on every other card.
 */
export function SwolfDelta({ change }: { change: number }) {
  const rounded = Math.round(change);
  if (rounded === 0) {
    return (
      <span className="run-delta tone-flat">
        <Minus size={12} aria-hidden="true" /> {t("activity.delta.level")}
      </span>
    );
  }
  const better = rounded < 0;
  return (
    <span className={`run-delta ${better ? "tone-up" : "tone-down"}`} title={t("swim.hero.swolfDelta")}>
      {better ? <ArrowDownRight size={12} aria-hidden="true" /> : <ArrowUpRight size={12} aria-hidden="true" />}
      {Math.abs(rounded)}
    </span>
  );
}
