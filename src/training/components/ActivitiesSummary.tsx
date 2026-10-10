import { useI18n } from "../../i18n/useI18n";
import { useMemo, useState, type KeyboardEvent } from "react";
import type { ActivityTotals } from "../activityFilters";
import { SPORT_COLOR_LABELS, type SportColorCategory } from "../sportColors";
import {
  formatDistanceMeters,
  formatDurationSpan,
  formatElevationMeters
} from "../formatters";
import { useUnitSystem } from "../../units/UnitSystemProvider";
import { formatCount, plural, t } from "../../i18n/core";

interface ActivitiesSummaryProps {
  totals: ActivityTotals;
  /** What the period selector says, e.g. "3 months" — the caption's subject. */
  periodLabel: string;
}

interface SummaryTile {
  key: string;
  label: string;
  value: string;
  caption: string;
}

/** "3.4 sessions a week", "One every 5 days" — a rate the athlete can picture. */
function perWeekPhrase(
  total: number,
  weeks: number,
  kind: "sessions" | "days"
): string {
  if (weeks <= 0 || total <= 0) {
    return t("activity.summary.nothing");
  }

  const perWeek = total / weeks;
  if (perWeek >= 1) {
    // One decimal at most, written in the language's digits by plural().
    const rounded = Math.round(perWeek * 10) / 10;
    return plural(`activity.summary.perWeek.${kind}` as const, rounded);
  }

  return plural("activity.summary.oneEvery", Math.round(7 / perWeek));
}

/** One sport's slice of the mix bar, and where along the bar it sits. */
interface MixBand {
  category: SportColorCategory;
  label: string;
  /** 0..1 — what the flex item grows by. */
  share: number;
  percent: number;
  count: number;
  /** Seconds. */
  duration: number;
  /** Middle of the band along the bar, 0..1: where its tooltip points. */
  centre: number;
}

/** "Running 68%, 30 sessions" — one band, spelled out for the bar's label. */
function bandPhrase(band: MixBand): string {
  return t("activity.summary.band", {
    sport: band.label,
    percent: band.percent,
    sessions: plural("activity.sessions", band.count)
  });
}

/**
 * What a filtered stretch of training adds up to, and how it is split between
 * sports.
 *
 * The mix bar is the one figure no other screen can draw: Running cannot see a
 * lifting week and Strength cannot see a running one, so the question "what
 * have I actually been doing" has only ever been answerable here.
 *
 * The bar answers the question on its own — a glance says "mostly running,
 * a third lifting" — and the percentages under it were a second line of text
 * above a list that is already the point of the screen. One band at a time
 * answers on hover instead: the band lifts out of the bar, its neighbours fall
 * back, and the figures appear under it. A list of all four said less per word
 * and cost a permanent line.
 *
 * Nothing is lost to a reader who cannot hover. The bar carries the whole mix
 * as its own label — which is why the bands are hidden from the accessibility
 * tree rather than read out twice — and the left and right arrows step through
 * them from one tab stop, so the tooltip is reachable without a pointer.
 */
export function ActivitiesSummary({
  totals,
  periodLabel
}: ActivitiesSummaryProps) {
  const { unitSystem } = useUnitSystem();
  const { locale } = useI18n();
  const mixTotal = totals.sports.reduce((sum, sport) => sum + sport.duration, 0);

  const bands = useMemo<MixBand[]>(() => {
    if (mixTotal <= 0) {
      return [];
    }

    let start = 0;
    return totals.sports.map((sport) => {
      const share = sport.duration / mixTotal;
      const centre = start + share / 2;
      start += share;
      return {
        category: sport.category,
        label: SPORT_COLOR_LABELS[sport.category],
        share,
        percent: Math.round(share * 100),
        count: sport.count,
        duration: sport.duration,
        centre
      };
    });
    // The bands carry their sport's name, so a new language rebuilds them.
  }, [mixTotal, totals.sports, locale]);

  /*
   * Held as an index rather than a category so the arrow keys have something
   * to step, and read back through `bands` so a filter change that drops the
   * sport being pointed at closes the tooltip instead of leaving it stranded.
   */
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const active = activeIndex === null ? null : (bands[activeIndex] ?? null);

  function stepBand(event: KeyboardEvent<HTMLDivElement>) {
    const delta =
      event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (delta === 0 || bands.length === 0) {
      return;
    }

    event.preventDefault();
    setActiveIndex((current) =>
      current === null
        ? delta > 0
          ? 0
          : bands.length - 1
        : Math.min(bands.length - 1, Math.max(0, current + delta))
    );
  }

  const tiles: SummaryTile[] = [
    {
      key: "sessions",
      label: t("activity.summary.sessions"),
      value: formatCount(totals.count),
      caption: perWeekPhrase(totals.count, totals.weeks, "sessions")
    },
    {
      key: "time",
      label: t("activity.m.time"),
      value: formatDurationSpan(totals.duration),
      caption:
        totals.weeks > 0 && totals.duration > 0
          ? t("activity.summary.aWeek", { value: formatDurationSpan(totals.duration / totals.weeks) })
          : t("activity.summary.nothing")
    },
    // A lifting-only history has no distance to show, and a column of "0 km"
    // is what the old table put in its place. Climb is the figure that still
    // means something when the distance is zero; days trained when neither is.
    totals.distance > 0
      ? {
          key: "distance",
          label: t("activity.m.distance"),
          value: formatDistanceMeters(totals.distance, unitSystem),
          caption:
            totals.elevationGain > 0
              ? t("activity.summary.climbed", { value: formatElevationMeters(totals.elevationGain, unitSystem) })
              : t("activity.summary.inPeriod", { period: periodLabel })
        }
      : {
          key: "days",
          label: t("activity.summary.daysTrained"),
          value: formatCount(totals.activeDays),
          caption: perWeekPhrase(totals.activeDays, totals.weeks, "days")
        },
    {
      key: "load",
      label: t("activity.m.trainingLoad"),
      value: totals.trainingLoad > 0 ? formatCount(Math.round(totals.trainingLoad)) : "—",
      caption:
        totals.trainingLoad > 0 && totals.weeks > 0
          ? t("activity.summary.aWeek", { value: formatCount(Math.round(totals.trainingLoad / totals.weeks)) })
          : t("activity.summary.loadCaption")
    }
  ];

  return (
    <section className="activities-summary" aria-label={t("activity.summary.label", { period: periodLabel })}>
      <div className="activities-summary-tiles">
        {tiles.map((tile) => (
          <div className="activities-summary-tile" key={tile.key}>
            <p className="activities-summary-label">{tile.label}</p>
            <p className="activities-summary-value">{tile.value}</p>
            <p className="activities-summary-caption">{tile.caption}</p>
          </div>
        ))}
      </div>

      {bands.length > 0 ? (
        <div className="activities-mix">
          {/*
            * Focusable as well as hoverable, and labelled in full, so the mix
            * can be read without reaching a single band.
            */}
          <div
            className={`activities-mix-bar${active ? " is-probing" : ""}`}
            role="img"
            tabIndex={0}
            aria-label={t("activity.summary.mix", { bands: bands.map(bandPhrase).join("; ") })}
            onMouseLeave={() => setActiveIndex(null)}
            onFocus={() => setActiveIndex((current) => current ?? 0)}
            onBlur={() => setActiveIndex(null)}
            onKeyDown={stepBand}
          >
            {bands.map((band, index) => (
              <i
                key={band.category}
                data-sport={band.category}
                className={index === activeIndex ? "is-active" : undefined}
                style={{ flexGrow: band.share }}
                onMouseEnter={() => setActiveIndex(index)}
              />
            ))}
          </div>

          {/*
            * The tooltip anchors its near edge to the band's centre and grows
            * towards the middle of the bar, so it cannot run off either end —
            * no measuring, and exact for the 1% sliver at the far right as
            * much as for the 68% block. The caret is what pins it to the band.
            */}
          {active ? (
            <>
              <span
                className="activities-mix-caret"
                style={{ left: `${active.centre * 100}%` }}
                aria-hidden="true"
              />
              <div
                className="activities-mix-tip"
                role="status"
                style={
                  /*
                   * Backed off by the caret's own inset so the arrow lands
                   * inside the panel rather than half off its corner, and
                   * floored at the bar's end so backing off cannot push it
                   * past the edge it was being kept inside.
                   */
                  active.centre <= 0.5
                    ? { left: `max(0px, calc(${active.centre * 100}% - 14px))` }
                    : {
                        right: `max(0px, calc(${(1 - active.centre) * 100}% - 14px))`
                      }
                }
              >
                <p className="activities-mix-tip-name">
                  <i data-sport={active.category} aria-hidden="true" />
                  {active.label}
                </p>
                <p className="activities-mix-tip-figures">
                  <strong>{active.percent}%</strong>
                  <span>
                    {plural("activity.sessions", active.count)}
                  </span>
                  <span>{formatDurationSpan(active.duration)}</span>
                </p>
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
