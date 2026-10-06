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
import { coordinateLabel, type PlaceLabel } from "./placeLabels";
import {
  activityTimestampMs,
  formatDayNear,
  formatMonthYear,
  sportMix,
  visitsByMonth,
  type PlaceSort,
  type PlaceSummary,
} from "./placeSummaries";

/** The three sizes the globe's legend draws, by a place's share of the busiest. */
function intensityTier(count: number, maxCount: number): "low" | "medium" | "high" {
  const intensity = Math.sqrt(count / Math.max(1, maxCount));
  return intensity >= 0.7 ? "high" : intensity >= 0.35 ? "medium" : "low";
}

export function placeLabelOf(
  place: PlaceSummary,
  labels: Readonly<Record<string, PlaceLabel>>,
): PlaceLabel {
  return labels[place.key] ?? coordinateLabel(place.bucket);
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
  /** The list scrolled close to its end: name the next rows. */
  onNearEnd: () => void;
}

export function PlaceList({
  places,
  labels,
  sort,
  hoveredKey,
  onHover,
  onSortChange,
  onSelect,
  onNearEnd,
}: PlaceListProps) {
  const maxCount = places.reduce(
    (max, place) => Math.max(max, place.activities.length),
    0,
  );
  const handleScroll = (event: UIEvent<HTMLOListElement>) => {
    const list = event.currentTarget;
    if (list.scrollTop + list.clientHeight > list.scrollHeight - 160) {
      onNearEnd();
    }
  };
  return (
    <>
      <header className="training-map-places-head">
        <h2>
          Places <span>{places.length.toLocaleString()}</span>
        </h2>
        <OptionGroup<PlaceSort>
          label="Sort places"
          value={sort}
          onChange={onSortChange}
          options={[
            { value: "recent", label: "Recent" },
            { value: "visits", label: "Most visited" },
          ]}
        />
      </header>
      <div className="training-map-places-columns" aria-hidden="true">
        <span />
        <span>Place</span>
        <span>Visits</span>
        <span>Last</span>
      </div>
      <ol className="training-map-places" onScroll={handleScroll}>
        {places.map((place) => {
          const label = placeLabelOf(place, labels);
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
                  aria-label={`${count} ${count === 1 ? "visit" : "visits"}`}
                >
                  {count.toLocaleString()}
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
  const next = nextOpenStage(labour);
  const ratio = next?.progress?.ratio;
  return (
    <button type="button" className="training-map-labour" onClick={onOpen}>
      <LabourEmblem id={labour.definition.id} reached={labour.reached} size="chip" />
      <span className="training-map-labour-text">
        <span className="training-map-labour-eyebrow">
          {next
            ? `${labour.definition.short} · ${STAGE_NUMERALS[next.stage]}`
            : labour.definition.short}
        </span>
        <strong>{next ? next.title : "All three stages reached"}</strong>
        {ratio !== undefined ? (
          <span className="training-map-labour-bar" aria-hidden="true">
            <span style={{ width: `${Math.round(ratio * 100)}%` }} />
          </span>
        ) : null}
        {next?.progress ? (
          <span className="training-map-labour-foot">
            <span>{next.progress.text}</span>
            {ratio !== undefined ? <span>{Math.round(ratio * 100)}% there</span> : null}
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
    return `${minutes} min`;
  }
  return minutes > 0 ? `${hours} h ${minutes} m` : `${hours} h`;
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
    metersToDisplayDistance(meters, unitSystem).toLocaleString(undefined, {
      maximumFractionDigits: 1,
    });
  const climb = (meters: number) =>
    Math.round(metersToElevation(meters, unitSystem)).toLocaleString();
  const when =
    count === 1
      ? formatDayNear(place.lastVisitedMs)
      : `since ${formatMonthYear(place.firstVisitedMs)} · last ${formatDayNear(place.lastVisitedMs)}`;

  return (
    <div className="training-map-place">
      <button type="button" className="training-map-place-back" onClick={onBack}>
        <ChevronLeft size={16} aria-hidden="true" />
        All places
      </button>
      <header className="training-map-place-header">
        <h2>{label.city}</h2>
        <p>
          {label.country} · {when}
        </p>
      </header>

      <dl className="training-map-place-metrics">
        <div>
          <dt>Activities</dt>
          <dd>{count.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Distance</dt>
          <dd>
            {distance(place.distanceMeters)} <small>{distanceUnit(unitSystem)}</small>
          </dd>
        </div>
        <div>
          <dt>Time</dt>
          <dd>{formatPlaceDuration(place.durationSeconds)}</dd>
        </div>
        <div>
          <dt>Climb</dt>
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
        <ul aria-label="Sports trained here">
          {mix.map((share) => (
            <li key={share.category}>
              <i
                aria-hidden="true"
                style={{ background: `var(--sport-${share.category})` }}
              />
              {SPORT_COLOR_LABELS[share.category]} <strong>{share.count.toLocaleString()}</strong>
            </li>
          ))}
        </ul>
      </div>

      {months.length > 1 ? (
        <div className="training-map-place-visits">
          <span className="training-map-place-label">Visits by month</span>
          <div
            className="training-map-place-visit-bars"
            role="img"
            aria-label={`Visits by month from ${formatMonthYear(months[0].monthMs)} to ${formatMonthYear(months[months.length - 1].monthMs)}, at most ${busiest} in a month`}
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
          {zooming ? "Opening street view" : "Street view"}
        </button>
      )}

      <section className="training-map-place-activities" aria-label="Activities here">
        <span className="training-map-place-label">Activities here</span>
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
            {showAll ? "Show fewer" : `Show all ${count.toLocaleString()}`}
            <ChevronDown size={14} aria-hidden="true" />
          </button>
        ) : null}
      </section>
    </div>
  );
}
