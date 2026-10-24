import { Search, X } from "lucide-react";
import { OptionGroup } from "../../components/OptionGroup";
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
import { t } from "../../i18n/core";

const ACTIVITY_PERIOD_GROUP_OPTIONS = periodGroupOptions(ACTIVITY_PERIOD_DAYS);

interface ActivitiesFilterBarProps {
  filters: ActivityFilters;
  onChange: (filters: ActivityFilters) => void;
}

/**
 * The period and the search, beside the screen's title.
 *
 * The sports are not here: they are the legend under the mix bar, where each
 * one already stands with its share of the period, so the row of filter chips
 * that used to sit between the totals and the list said the same names twice.
 */
export function ActivitiesFilterBar({
  filters,
  onChange
}: ActivitiesFilterBarProps) {
  return (
    <div className="activities-filters">
      {/* A menu rather than a row of chips: the period is read every time the
          screen opens and changed a few times a session, and the title row
          holds nothing else but the search. */}
      <OptionGroup
        label={t("activity.filter.period")}
        mode="dropdown"
        className="activities-period"
        value={periodValue(filters.periodDays as PeriodDays)}
        options={ACTIVITY_PERIOD_GROUP_OPTIONS}
        onChange={(next) =>
          onChange({ ...filters, periodDays: periodDaysFromValue(next) })
        }
      />

      <div className="activities-search">
        <Search size={14} aria-hidden="true" />
        <input
          type="search"
          value={filters.query}
          placeholder={t("activity.filter.search")}
          aria-label={t("activity.filter.searchLabel")}
          onChange={(event) =>
            onChange({ ...filters, query: event.target.value })
          }
        />
        {filters.query.length > 0 ? (
          <button
            type="button"
            className="icon-button activities-search-clear"
            aria-label={t("activity.filter.clearSearch")}
            onClick={() => onChange({ ...filters, query: "" })}
          >
            <X size={14} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
