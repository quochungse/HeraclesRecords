import { Search, X } from "lucide-react";
import { OptionChips, OptionGroup } from "../../components/OptionGroup";
import {
  periodDaysFromValue,
  periodGroupOptions,
  periodValue,
  type PeriodDays
} from "../../preferences/periodScale";
import {
  ACTIVITY_PERIOD_DAYS,
  type ActivityFilters
} from "../activityFilters";
import { SPORT_COLOR_LABELS, type SportColorCategory } from "../sportColors";

const ACTIVITY_PERIOD_GROUP_OPTIONS = periodGroupOptions(ACTIVITY_PERIOD_DAYS);

interface ActivitiesFilterBarProps {
  filters: ActivityFilters;
  /** Only the sports the athlete has actually done — see `sportsPresent`. */
  available: readonly SportColorCategory[];
  /** How many activities the current filters admit, for the live count. */
  matched: number;
  onChange: (filters: ActivityFilters) => void;
}

export function ActivitiesFilterBar({
  filters,
  available,
  matched,
  onChange
}: ActivitiesFilterBarProps) {
  function toggleSport(category: SportColorCategory) {
    const next = filters.sports.includes(category)
      ? filters.sports.filter((entry) => entry !== category)
      : [...filters.sports, category];
    onChange({ ...filters, sports: next });
  }

  const narrowed =
    filters.sports.length > 0 || filters.query.trim().length > 0;

  return (
    <div className="activities-filters">
      {/* Folded at rest: the period is read every time the screen opens and
          changed a few times a session, and the search field beside it is
          worth more room than three chips nobody is looking at. */}
      <OptionGroup
        label="Period"
        mode="collapsible"
        className="activities-period"
        value={periodValue(filters.periodDays as PeriodDays)}
        options={ACTIVITY_PERIOD_GROUP_OPTIONS}
        onChange={(next) =>
          onChange({ ...filters, periodDays: periodDaysFromValue(next) })
        }
      />

      {available.length > 1 ? (
        <OptionChips
          label="Sports"
          className="activities-sports"
          options={available.map((category) => ({
            value: category,
            label: SPORT_COLOR_LABELS[category]
          }))}
          values={filters.sports}
          colorOf={(category) => `var(--sport-${category})`}
          onToggle={(category) => toggleSport(category as SportColorCategory)}
        />
      ) : null}

      <div className="activities-search">
        <Search size={14} aria-hidden="true" />
        <input
          type="search"
          value={filters.query}
          placeholder="Search by name or sport"
          aria-label="Search activities"
          onChange={(event) =>
            onChange({ ...filters, query: event.target.value })
          }
        />
        {filters.query.length > 0 ? (
          <button
            type="button"
            className="icon-button activities-search-clear"
            aria-label="Clear search"
            onClick={() => onChange({ ...filters, query: "" })}
          >
            <X size={14} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {/*
       * A filter that hides everything looks exactly like a screen with no
       * data, so the count and the way back out are stated rather than left to
       * be worked out from an empty list.
       */}
      {narrowed ? (
        <p className="activities-filters-status" role="status">
          <span>
            {matched} {matched === 1 ? "match" : "matches"}
          </span>
          <button
            type="button"
            onClick={() =>
              onChange({ ...filters, sports: [], query: "" })
            }
          >
            Clear filters
          </button>
        </p>
      ) : null}
    </div>
  );
}
