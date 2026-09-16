import { Search, X } from "lucide-react";
import {
  ACTIVITY_PERIOD_OPTIONS,
  type ActivityFilters
} from "../activityFilters";
import { SPORT_COLOR_LABELS, type SportColorCategory } from "../sportColors";

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
      <div
        className="activities-period"
        role="radiogroup"
        aria-label="Period"
      >
        {ACTIVITY_PERIOD_OPTIONS.map((option) => {
          const active = filters.periodDays === option.days;
          return (
            <button
              key={option.label}
              type="button"
              role="radio"
              aria-checked={active}
              className={`activities-period-option${active ? " is-active" : ""}`}
              onClick={() => onChange({ ...filters, periodDays: option.days })}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      {available.length > 1 ? (
        <div className="activities-sports" aria-label="Sports">
          {available.map((category) => {
            const active = filters.sports.includes(category);
            return (
              <button
                key={category}
                type="button"
                aria-pressed={active}
                data-sport={category}
                className={`activities-sport-toggle${active ? " is-active" : ""}`}
                onClick={() => toggleSport(category)}
              >
                <i aria-hidden="true" />
                {SPORT_COLOR_LABELS[category]}
              </button>
            );
          })}
        </div>
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
