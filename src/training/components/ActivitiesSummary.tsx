import type { ActivityTotals } from "../activityFilters";
import type { FeelCoverage } from "../useActivityFeelTypes";
import { SPORT_COLOR_LABELS } from "../sportColors";
import {
  formatDistanceMeters,
  formatDurationSpan,
  formatElevationMeters
} from "../formatters";
import { useUnitSystem } from "../../units/UnitSystemProvider";

interface ActivitiesSummaryProps {
  totals: ActivityTotals;
  /** What the period selector says, e.g. "3 months" — the caption's subject. */
  periodLabel: string;
  /** How much of this stretch carries an end-of-activity feeling. */
  feelCoverage: FeelCoverage;
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
  singular: string,
  plural: string
): string {
  if (weeks <= 0 || total <= 0) {
    return "Nothing logged yet";
  }

  const perWeek = total / weeks;
  if (perWeek >= 1) {
    const rounded = perWeek.toFixed(1).replace(/\.0$/, "");
    return `${rounded} ${rounded === "1" ? singular : plural} a week`;
  }

  return `One every ${Math.round(7 / perWeek)} days`;
}

/**
 * What a filtered stretch of training adds up to, and how it is split between
 * sports.
 *
 * The mix bar is the one figure no other screen can draw: Running cannot see a
 * lifting week and Strength cannot see a running one, so the question "what
 * have I actually been doing" has only ever been answerable here.
 */
export function ActivitiesSummary({
  totals,
  periodLabel,
  feelCoverage: coverage
}: ActivitiesSummaryProps) {
  const { unitSystem } = useUnitSystem();
  const mixTotal = totals.sports.reduce((sum, sport) => sum + sport.duration, 0);

  const tiles: SummaryTile[] = [
    {
      key: "sessions",
      label: "Sessions",
      value: String(totals.count),
      caption: perWeekPhrase(totals.count, totals.weeks, "session", "sessions")
    },
    {
      key: "time",
      label: "Time",
      value: formatDurationSpan(totals.duration),
      caption:
        totals.weeks > 0 && totals.duration > 0
          ? `${formatDurationSpan(totals.duration / totals.weeks)} a week`
          : "Nothing logged yet"
    },
    // A lifting-only history has no distance to show, and a column of "0 km"
    // is what the old table put in its place. Climb is the figure that still
    // means something when the distance is zero; days trained when neither is.
    totals.distance > 0
      ? {
          key: "distance",
          label: "Distance",
          value: formatDistanceMeters(totals.distance, unitSystem),
          caption:
            totals.elevationGain > 0
              ? `${formatElevationMeters(totals.elevationGain, unitSystem)} climbed`
              : `In ${periodLabel.toLowerCase()}`
        }
      : {
          key: "days",
          label: "Days trained",
          value: String(totals.activeDays),
          caption: perWeekPhrase(totals.activeDays, totals.weeks, "day", "days")
        },
    {
      key: "load",
      label: "Training load",
      value: totals.trainingLoad > 0 ? Math.round(totals.trainingLoad).toLocaleString() : "—",
      caption:
        totals.trainingLoad > 0 && totals.weeks > 0
          ? `${Math.round(totals.trainingLoad / totals.weeks).toLocaleString()} a week`
          : "COROS scores this per session"
    }
  ];

  return (
    <section className="activities-summary" aria-label={`Training in ${periodLabel}`}>
      <div className="activities-summary-tiles">
        {tiles.map((tile) => (
          <div className="activities-summary-tile" key={tile.key}>
            <p className="activities-summary-label">{tile.label}</p>
            <p className="activities-summary-value">{tile.value}</p>
            <p className="activities-summary-caption">{tile.caption}</p>
          </div>
        ))}
      </div>

      {mixTotal > 0 ? (
        <div className="activities-mix">
          <div className="activities-mix-bar" aria-hidden="true">
            {totals.sports.map((sport) => (
              <i
                key={sport.category}
                data-sport={sport.category}
                style={{ flexGrow: sport.duration / mixTotal }}
              />
            ))}
          </div>
          <ul className="activities-mix-legend">
            {totals.sports.map((sport) => (
              <li key={sport.category}>
                <i data-sport={sport.category} aria-hidden="true" />
                <span>{SPORT_COLOR_LABELS[sport.category]}</span>
                <strong>{Math.round((sport.duration / mixTotal) * 100)}%</strong>
                <em>
                  {sport.count} {sport.count === 1 ? "session" : "sessions"}
                </em>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/*
       * Where the RPE figures elsewhere in the app are actually built from.
       * `rpeLoad` turns a 1..5 feeling into a Foster session load and the
       * heatmap draws it; a third of a block going unrated is a hole in that
       * chart, and no screen said so. Only sessions COROS has been asked about
       * are counted — the backfill's remainder is unknown, not unrated.
       */}
      {coverage.checked > 0 && coverage.rated < coverage.checked ? (
        <p className="activities-coverage" role="note">
          Rated {coverage.rated} of {coverage.checked} sessions. The rest carry
          no RPE, so they count nothing towards session load.
        </p>
      ) : null}
    </section>
  );
}
