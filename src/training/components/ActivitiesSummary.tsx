import { useI18n } from "../../i18n/useI18n";
import { useMemo, useState, type KeyboardEvent } from "react";
import { OptionChips } from "../../components/OptionGroup";
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
  /** Everything the filters admit: what the four figures add up. */
  totals: ActivityTotals;
  /**
   * The period alone, before a sport or a search narrows it: what the bar and
   * its legend draw. Omitted, it is `totals`. A legend that is also the sport
   * filter cannot be drawn from the narrowed set, or picking one sport would
   * leave only its chip and a search that matched nothing would leave none.
   */
  mix?: ActivityTotals;
  /** What the period selector says, e.g. "3 months" — the caption's subject. */
  periodLabel: string;
  /** The sports picked in the legend; empty means every sport. */
  selectedSports?: readonly SportColorCategory[];
  /** Without it the legend is not drawn and the bar stands alone. */
  onToggleSport?: (category: SportColorCategory) => void;
  /** Offered while anything narrows the list — a sport or a search. */
  onClearFilters?: () => void;
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

/** "48%", and "<1%" for a sliver that would otherwise read as nothing. */
function sharePhrase(share: number): string {
  const percent = Math.round(share * 100);
  return percent === 0 && share > 0 ? "<1%" : `${percent}%`;
}

/**
 * What a filtered stretch of training adds up to, and how it is split between
 * sports.
 *
 * The four totals are figures on the page rather than four boxes: they are one
 * statement about one period, and a card each read as four things to compare.
 * On paper the strip is a white sheet of its own, because figures written
 * straight on the grey canvas sank into it.
 *
 * The mix bar is the one figure no other screen can draw: Running cannot see a
 * lifting week and Strength cannot see a running one, so the question "what
 * have I actually been doing" has only ever been answerable here.
 *
 * Its legend is the sport filter. The filter used to be a row of chips of its
 * own under the bar, naming the same sports a second time with nothing to say
 * about them; a chip now carries its sport's share, so one line both reads the
 * mix and narrows the list. The bar keeps the rest on hover — one band at a
 * time lifts out, its neighbours fall back, and its sessions and time appear
 * under it.
 *
 * Nothing is lost to a reader who cannot hover. The bar carries the whole mix
 * as its own label — which is why the bands are hidden from the accessibility
 * tree rather than read out twice — and the left and right arrows step through
 * them from one tab stop, so the tooltip is reachable without a pointer.
 */
export function ActivitiesSummary({
  totals,
  mix = totals,
  periodLabel,
  selectedSports = [],
  onToggleSport,
  onClearFilters
}: ActivitiesSummaryProps) {
  const { unitSystem } = useUnitSystem();
  const { locale } = useI18n();
  const mixTotal = mix.sports.reduce((sum, sport) => sum + sport.duration, 0);

  const bands = useMemo<MixBand[]>(() => {
    if (mixTotal <= 0) {
      return [];
    }

    let start = 0;
    return mix.sports.map((sport) => {
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
  }, [mixTotal, mix.sports, locale]);

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

  const filtering = selectedSports.length > 0;

  /*
   * A search or a sport that matches nothing is not an empty history, so the
   * captions do not say "Nothing logged yet" under it — three times over. The
   * list beside it says what happened; the captions keep their line, empty, so
   * the strip does not jump as the last letter is typed.
   */
  const noMatch = totals.count === 0 && onClearFilters !== undefined;

  /*
   * One chip per sport in the period, each with its share, plus any sport
   * still picked that the period no longer holds — a filter that cannot be
   * seen cannot be taken off. A single sport and nothing picked is no choice
   * at all, and draws no legend.
   */
  const legend = useMemo(() => {
    if (!onToggleSport) {
      return [];
    }
    const chips = bands.map((band) => ({
      value: band.category,
      label: band.label,
      detail: sharePhrase(band.share)
    }));
    for (const category of selectedSports) {
      if (!chips.some((chip) => chip.value === category)) {
        chips.push({ value: category, label: SPORT_COLOR_LABELS[category], detail: "0%" });
      }
    }
    return chips.length > 1 || filtering ? chips : [];
  }, [bands, selectedSports, filtering, onToggleSport]);

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
            <p className="activities-summary-caption">
              {noMatch ? "\u00a0" : tile.caption}
            </p>
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
                className={
                  [
                    index === activeIndex ? "is-active" : "",
                    filtering && !selectedSports.includes(band.category)
                      ? "is-filtered-out"
                      : ""
                  ]
                    .filter(Boolean)
                    .join(" ") || undefined
                }
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

      {legend.length > 0 || onClearFilters ? (
        <div className="activities-legend">
          {legend.length > 0 && onToggleSport ? (
            <OptionChips
              label={t("activity.filter.sports")}
              className="activities-sports"
              options={legend}
              values={selectedSports}
              colorOf={(category) => `var(--sport-${category})`}
              onToggle={(category) => onToggleSport(category as SportColorCategory)}
            />
          ) : null}
          {/*
           * A filter that hides everything looks exactly like a screen with no
           * data, so the way back out is stated rather than left to be worked
           * out from an empty list.
           */}
          {onClearFilters ? (
            <button
              type="button"
              className="activities-clear-filters"
              onClick={onClearFilters}
            >
              {t("activity.filter.clear")}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
