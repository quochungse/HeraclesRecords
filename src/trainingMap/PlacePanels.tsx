import { ChevronDown, ChevronLeft, Map as MapIcon } from "lucide-react";
import { useState, type UIEvent } from "react";
import { OptionGroup } from "../components/OptionGroup";
import {
  STAGE_NUMERALS,
  nextOpenStage,
  type LabourState,
} from "../records/labours";
import { LabourEmblem } from "../records/recordsIcons";
import {
  SPORT_COLOR_LABELS,
  sportColorCategory,
} from "../training/sportColors";
import { resolveSportName } from "../training/sportTypes";
import { useUnitSystem } from "../units/UnitSystemProvider";
import {
  distanceUnit,
  elevationUnit,
  metersToDisplayDistance,
  metersToElevation,
} from "../units/units";
import type { PlaceLabel } from "./placeLabels";
import {
  activityTimestampMs,
  formatDayNear,
  formatMonthYear,
  placeLabelFor,
  sportMix,
  visitsByMonth,
  type PlaceSort,
  type PlaceSummary,
} from "./placeSummaries";
import { formatCount, getIntlLocale, plural, t } from "../i18n/core";
import { useI18n } from "../i18n/useI18n";
import { labourShort, labourStage } from "../records/labourWords";

/** The three sizes the globe's legend draws, by a place's share of the busiest. */
function intensityTier(count: number, maxCount: number): "low" | "medium" | "high" {
  const intensity = Math.sqrt(count / Math.max(1, maxCount));
  return intensity >= 0.7 ? "high" : intensity >= 0.35 ? "medium" : "low";
}

interface PlaceListProps {
  places: readonly PlaceSummary[];
  labels: Readonly<Record<string, PlaceLabel>>;
  sort: PlaceSort;
  /** The place pointed at, here or on the globe: its row lights up. */
  hoveredKey: string | null;
  onHover: (key: string | null) => void;
  onSortChange: (sort: PlaceSort) => void;
  onSelect: (place: PlaceSummary) => void;
  /** How many rows the list has been scrolled down to: name as far as that. */
  onScrolledTo: (rows: number) => void;
}

export function PlaceList({
  places,
  labels,
  sort,
  hoveredKey,
  onHover,
  onSortChange,
  onSelect,
  onScrolledTo,
}: PlaceListProps) {
  useI18n();
  const maxCount = places.reduce(
    (max, place) => Math.max(max, place.activities.length),
    0,
  );
  // The rows are one height, so the bottom of the view is that share of them.
  const handleScroll = (event: UIEvent<HTMLOListElement>) => {
    const list = event.currentTarget;
    const bottom = list.scrollTop + list.clientHeight;
    onScrolledTo(Math.ceil((bottom / list.scrollHeight) * places.length));
  };
  return (
    <>
      <header className="training-map-places-head">
        <h2>
          {t("map.places")} <span>{formatCount(places.length)}</span>
        </h2>
        <OptionGroup<PlaceSort>
          label={t("map.sort.label")}
          value={sort}
          onChange={onSortChange}
          options={[
            { value: "recent", label: t("map.sort.recent") },
            { value: "visits", label: t("map.mostVisited") },
          ]}
        />
      </header>
      <div className="training-map-places-columns" aria-hidden="true">
        <span />
        <span>{t("map.col.place")}</span>
        <span>{t("map.col.visits")}</span>
        <span>{t("map.col.last")}</span>
      </div>
      <ol className="training-map-places" onScroll={handleScroll}>
        {places.map((place) => {
          const label = placeLabelFor(place.cluster, labels);
          const count = place.activities.length;
          return (
            <li key={place.key}>
              <button
                type="button"
                className={`training-map-place-row${place.key === hoveredKey ? " is-hovered" : ""}`}
                onClick={() => onSelect(place)}
                onPointerEnter={() => onHover(place.key)}
                onPointerLeave={() => onHover(null)}
                onFocus={() => onHover(place.key)}
                onBlur={() => onHover(null)}
              >
                <i
                  className={`training-map-place-dot is-${intensityTier(count, maxCount)}`}
                  aria-hidden="true"
                />
                <span className="training-map-place-name">
                  <strong>{label.city}</strong>
                  <small>{label.country}</small>
                </span>
                <span
                  className="training-map-place-count"
                  aria-label={plural("map.visits", count)}
                >
                  {formatCount(count)}
                </span>
                <span className="training-map-place-last">
                  {formatDayNear(place.lastVisitedMs)}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </>
  );
}

/**
 * The labour this screen is the record of: places trained in, as the Hall of
 * Records counts them (all time, whatever period the map shows), written the
 * way its Within reach cards write a stage being worked on.
 */
export function PlaceLabourCard({
  labour,
  onOpen,
}: {
  labour: LabourState;
  onOpen: () => void;
}) {
  useI18n();
  const id = labour.definition.id;
  const next = nextOpenStage(labour);
  const ratio = next?.progress?.ratio;
  return (
    <button type="button" className="training-map-labour" onClick={onOpen}>
      <LabourEmblem id={labour.definition.id} reached={labour.reached} size="chip" />
      <span className="training-map-labour-text">
        <span className="training-map-labour-eyebrow">
          {next ? `${labourShort(id)} · ${STAGE_NUMERALS[next.stage]}` : labourShort(id)}
        </span>
        <strong>{next ? labourStage(id, next.stage) : t("map.labour.allReached")}</strong>
        {ratio !== undefined ? (
          <span className="training-map-labour-bar" aria-hidden="true">
            <span style={{ width: `${Math.round(ratio * 100)}%` }} />
          </span>
        ) : null}
        {next?.progress ? (
          <span className="training-map-labour-foot">
            <span>{next.progress.text}</span>
            {ratio !== undefined ? (
              <span>{t("records.p.there", { percent: Math.round(ratio * 100) })}</span>
            ) : null}
          </span>
        ) : null}
      </span>
    </button>
  );
}

function formatPlaceDuration(seconds: number): string {
  const totalMinutes = Math.max(0, Math.round(seconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) {
    return t("units.min", { m: minutes });
  }
  return minutes > 0
    ? t("units.duration.hm", { h: hours, m: minutes })
    : t("units.duration.h", { h: hours });
}

/** Rows shown before "Show all": a place's latest few are what is asked for. */
const ACTIVITIES_SHOWN = 5;

interface PlaceDetailProps {
  place: PlaceSummary;
  label: PlaceLabel;
  zooming: boolean;
  /** The street map is already open: there is nothing closer to go to. */
  streetMode: boolean;
  onBack: () => void;
  onStreetView: () => void;
  onOpenActivity: (activityId: string) => void;
  /** The row pointed at, so the street map can bring its route forward. */
  onHoverActivity: (activityId: string | null) => void;
}

export function PlaceDetail({
  place,
  label,
  zooming,
  streetMode,
  onBack,
  onStreetView,
  onOpenActivity,
  onHoverActivity,
}: PlaceDetailProps) {
  useI18n();
  const { unitSystem } = useUnitSystem();
  const [showAll, setShowAll] = useState(false);

  const count = place.activities.length;
  const mix = sportMix(place.activities);
  const months = count >= 3 ? visitsByMonth(place.activities, Date.now()) : [];
  const busiest = months.reduce((max, month) => Math.max(max, month.count), 0);
  const lastLit = months.reduce(
    (last, month, index) => (month.count > 0 ? index : last),
    -1,
  );
  const shown = showAll
    ? place.activities
    : place.activities.slice(0, ACTIVITIES_SHOWN);
  const distance = (meters: number) =>
    new Intl.NumberFormat(getIntlLocale(), { maximumFractionDigits: 1 }).format(
      metersToDisplayDistance(meters, unitSystem),
    );
  const climb = (meters: number) =>
    formatCount(Math.round(metersToElevation(meters, unitSystem)));
  const when =
    count === 1
      ? formatDayNear(place.lastVisitedMs)
      : t("map.place.when", {
          first: formatMonthYear(place.firstVisitedMs),
          last: formatDayNear(place.lastVisitedMs),
        });

  return (
    <div className="training-map-place">
      <button type="button" className="training-map-place-back" onClick={onBack}>
        <ChevronLeft size={16} aria-hidden="true" />
        {t("map.place.all")}
      </button>
      <header className="training-map-place-header">
        <h2>{label.city}</h2>
        <p>
          {label.country} · {when}
        </p>
      </header>

      <dl className="training-map-place-metrics">
        <div>
          <dt>{t("map.loc.activities")}</dt>
          <dd>{formatCount(count)}</dd>
        </div>
        <div>
          <dt>{t("map.loc.distance")}</dt>
          <dd>
            {distance(place.distanceMeters)} <small>{distanceUnit(unitSystem)}</small>
          </dd>
        </div>
        <div>
          <dt>{t("map.loc.time")}</dt>
          <dd>{formatPlaceDuration(place.durationSeconds)}</dd>
        </div>
        <div>
          <dt>{t("map.place.climb")}</dt>
          <dd>
            {climb(place.elevationMeters)} <small>{elevationUnit(unitSystem)}</small>
          </dd>
        </div>
      </dl>

      <div className="training-map-place-mix">
        <div className="training-map-place-mix-bar" aria-hidden="true">
          {mix.map((share) => (
            <span
              key={share.category}
              style={{
                width: `${(share.count / count) * 100}%`,
                background: `var(--sport-${share.category})`,
              }}
            />
          ))}
        </div>
        <ul aria-label={t("map.place.sports")}>
          {mix.map((share) => (
            <li key={share.category}>
              <i
                aria-hidden="true"
                style={{ background: `var(--sport-${share.category})` }}
              />
              {SPORT_COLOR_LABELS[share.category]} <strong>{formatCount(share.count)}</strong>
            </li>
          ))}
        </ul>
      </div>

      {months.length > 1 ? (
        <div className="training-map-place-visits">
          <span className="training-map-place-label">{t("map.place.byMonth")}</span>
          <div
            className="training-map-place-visit-bars"
            role="img"
            aria-label={t("map.place.byMonthAria", {
              from: formatMonthYear(months[0].monthMs),
              to: formatMonthYear(months[months.length - 1].monthMs),
              busiest,
            })}
          >
            {months.map((month, index) => (
              <span
                key={month.monthMs}
                className={
                  month.count === 0
                    ? "is-empty"
                    : index === lastLit
                      ? "is-latest"
                      : undefined
                }
                style={{
                  height:
                    month.count === 0
                      ? undefined
                      : `${Math.round(6 + (month.count / busiest) * 30)}px`,
                }}
                title={`${formatMonthYear(month.monthMs)}: ${month.count}`}
              />
            ))}
          </div>
          <div className="training-map-place-visit-axis" aria-hidden="true">
            <span>{formatMonthYear(months[0].monthMs)}</span>
            <span>{formatMonthYear(months[months.length - 1].monthMs)}</span>
          </div>
        </div>
      ) : null}

      {streetMode ? null : (
        <button
          type="button"
          className={`training-map-view-action${zooming ? " is-zooming" : ""}`}
          onClick={onStreetView}
          disabled={zooming}
        >
          <MapIcon size={16} aria-hidden="true" />
          {zooming ? t("map.place.openingStreet") : t("map.place.street")}
        </button>
      )}

      <section className="training-map-place-activities" aria-label={t("map.place.activitiesHere")}>
        <span className="training-map-place-label">{t("map.place.activitiesHere")}</span>
        <ul>
          {shown.map((activity) => {
            const category = sportColorCategory(activity.sportType);
            const sport =
              resolveSportName(activity) ?? SPORT_COLOR_LABELS[category];
            const facts = [
              sport,
              activity.distance ? `${distance(activity.distance)} ${distanceUnit(unitSystem)}` : null,
              activity.elevationGain
                ? `${climb(activity.elevationGain)} ${elevationUnit(unitSystem)}`
                : null,
            ].filter(Boolean);
            return (
              <li
                key={activity.activityId}
                onPointerEnter={() => onHoverActivity(activity.activityId)}
                onPointerLeave={() => onHoverActivity(null)}
              >
                <div>
                  <button
                    type="button"
                    className="training-map-place-activity-title"
                    onClick={() => onOpenActivity(activity.activityId)}
                    onFocus={() => onHoverActivity(activity.activityId)}
                    onBlur={() => onHoverActivity(null)}
                  >
                    {activity.name?.trim() || sport}
                  </button>
                  <span>
                    <i
                      aria-hidden="true"
                      style={{ background: `var(--sport-${category})` }}
                    />
                    {facts.join(" · ")}
                  </span>
                </div>
                <time>
                  {formatDayNear(activityTimestampMs(activity.startTime))}
                </time>
              </li>
            );
          })}
        </ul>
        {count > ACTIVITIES_SHOWN ? (
          <button
            type="button"
            className="training-map-place-more"
            onClick={() => setShowAll((current) => !current)}
            aria-expanded={showAll}
          >
            {showAll ? t("map.place.showFewer") : t("map.place.showAll", { count: formatCount(count) })}
            <ChevronDown size={14} aria-hidden="true" />
          </button>
        ) : null}
      </section>
    </div>
  );
}
