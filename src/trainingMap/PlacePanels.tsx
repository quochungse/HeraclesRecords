import { ChevronLeft, MapPin, ZoomIn } from "lucide-react";
import { Area, AreaChart, ResponsiveContainer } from "recharts";
import type { UIEvent } from "react";
import { OptionGroup } from "../components/OptionGroup";
import { useUnitSystem } from "../units/UnitSystemProvider";
import {
  distanceUnit,
  elevationUnit,
  metersToDisplayDistance,
  metersToElevation,
} from "../units/units";
import { coordinateLabel, type PlaceLabel } from "./placeLabels";
import {
  formatDayNear,
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

function formatPlaceDuration(seconds: number): string {
  const totalMinutes = Math.max(0, Math.round(seconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) {
    return `${minutes} min`;
  }
  return minutes > 0 ? `${hours} h ${minutes} m` : `${hours} h`;
}

interface PlaceDetailProps {
  place: PlaceSummary;
  label: PlaceLabel;
  zooming: boolean;
  /** The street map is already open: there is nothing closer to zoom to. */
  streetMode: boolean;
  onBack: () => void;
  onZoomIn: () => void;
}

export function PlaceDetail({
  place,
  label,
  zooming,
  streetMode,
  onBack,
  onZoomIn,
}: PlaceDetailProps) {
  const { unitSystem } = useUnitSystem();
  const hasClimb = place.elevationMeters > 0;
  const trend = [...place.activities].reverse().map((activity, order) => ({
    order,
    value: hasClimb
      ? metersToElevation(Math.max(0, activity.elevationGain ?? 0), unitSystem)
      : metersToDisplayDistance(Math.max(0, activity.distance ?? 0), unitSystem),
  }));
  const distance = metersToDisplayDistance(
    place.distanceMeters,
    unitSystem,
  ).toLocaleString(undefined, { maximumFractionDigits: 1 });
  return (
    <div className="training-map-place" key={place.key}>
      <button type="button" className="training-map-place-back" onClick={onBack}>
        <ChevronLeft size={16} aria-hidden="true" />
        All places
      </button>
      <header className="training-map-place-header">
        <span className="training-map-place-icon" aria-hidden="true">
          <MapPin size={18} />
        </span>
        <div>
          <h2>{label.city}</h2>
          <p>{label.country}</p>
        </div>
      </header>

      <dl className="training-map-place-metrics">
        <div>
          <dt>Activities</dt>
          <dd>{place.activities.length.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Distance</dt>
          <dd>
            {distance} <small>{distanceUnit(unitSystem)}</small>
          </dd>
        </div>
        <div>
          <dt>Time</dt>
          <dd>{formatPlaceDuration(place.durationSeconds)}</dd>
        </div>
        <div>
          <dt>Last visited</dt>
          <dd>{formatDayNear(place.lastVisitedMs)}</dd>
        </div>
      </dl>

      <div className="training-map-location-trend">
        <div>
          <span>{hasClimb ? "Elevation gained" : "Distance trend"}</span>
          <strong>
            {hasClimb
              ? `${Math.round(metersToElevation(place.elevationMeters, unitSystem)).toLocaleString()} ${elevationUnit(unitSystem)}`
              : `${distance} ${distanceUnit(unitSystem)}`}
          </strong>
        </div>
        {trend.length > 1 ? (
          <div className="training-map-location-chart" aria-hidden="true">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend}>
                <defs>
                  <linearGradient
                    id="trainingMapLocationFill"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop offset="0%" stopColor="var(--map-accent)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="var(--map-accent)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="var(--map-accent)"
                  strokeWidth={1.8}
                  fill="url(#trainingMapLocationFill)"
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="training-map-trend-empty">
            More activities will build a location trend.
          </p>
        )}
        {streetMode ? null : (
          <button
            type="button"
            className={`training-map-view-action${zooming ? " is-zooming" : ""}`}
            onClick={onZoomIn}
            disabled={zooming}
          >
            {zooming ? "Zooming in" : "Zoom in"}
            <ZoomIn size={15} aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}
