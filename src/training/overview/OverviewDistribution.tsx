import { useMemo, type CSSProperties } from "react";
import type {
  TrainingHubActivity,
  TrainingHubAnalytics,
  TrainingHubThresholdZone,
  TrainingHubZoneDistributionEntry
} from "../../../electron/types";
import { OptionGroup } from "../../components/OptionGroup";
import {
  defineSelectionPreference,
  selectionIsOneOf,
  useSelectionPreference
} from "../../preferences/selectionPreferences";
import { periodLabel } from "../../preferences/periodScale";
import { zoneName } from "../../i18n/zoneNames";
import { formatDurationSpan } from "../formatters";
import { formatHeartRateZoneRange, type HeartRateZoneModel } from "../heartRateZoneModel";
import { SPORT_COLOR_LABELS } from "../sportColors";
import { zoneColor, zoneLabel } from "../components/routeColoring";
import { zoneNamesFor } from "../zoneTime";
import { formatCount, t } from "../../i18n/core";
import { useI18n } from "../../i18n/useI18n";
import { useLoadSource } from "../loadSource";
import {
  DISTRIBUTION_DAYS,
  intensityShares,
  sportLoadShares,
  zoneShares
} from "./distributionModel";

type ZoneMeasure = "time" | "trainingLoad";

const ZONE_MEASURE = defineSelectionPreference<ZoneMeasure>({
  key: "overview.zoneMeasure",
  defaultValue: "time",
  validate: selectionIsOneOf(["time", "trainingLoad"])
});

/** The 80/20 rule's line: four fifths of the time easy. */
const EASY_TARGET = 0.8;

/**
 * Below this share a sport's segment is too narrow to stand its name under,
 * except the last, which runs back into the room before it.
 */
const LABELLED_SHARE = 0.07;

const NO_ZONES: readonly TrainingHubZoneDistributionEntry[] = [];

function whole(value: number): string {
  return formatCount(Math.round(value));
}

function percent(share: number): string {
  return `${Math.round(share * 100)}%`;
}

/**
 * Training load distribution: the last four weeks' load by sport, in the
 * chosen load (strength at Heracles Training Load when that is chosen), then COROS's own time (or load) in each heart-rate zone,
 * read first as the easy share against the 80/20 line and then zone by zone.
 */
export function OverviewDistribution({
  activities,
  analytics,
  hrZoneModel,
  lthrZones,
  loading = false
}: {
  activities: TrainingHubActivity[];
  analytics: TrainingHubAnalytics | null;
  hrZoneModel: HeartRateZoneModel | null;
  lthrZones: TrainingHubThresholdZone[];
  loading?: boolean;
}) {
  useI18n();
  const [measure, setMeasure] = useSelectionPreference(ZONE_MEASURE);
  const { source: loadSource } = useLoadSource();
  const bySport = useMemo(
    () => sportLoadShares(activities, undefined, undefined, loadSource),
    [activities, loadSource]
  );
  const entries =
    measure === "time"
      ? (analytics?.zoneDistributions.hrTime ?? NO_ZONES)
      : (analytics?.zoneDistributions.hrTrainingLoad ?? NO_ZONES);
  const byZone = useMemo(() => zoneShares(entries), [entries]);
  // The zones are the account's own model, as the Running screen reads them.
  const family = hrZoneModel?.family ?? "lthr";
  const zones = hrZoneModel?.zones ?? lthrZones;
  const names = zoneNamesFor(family);
  const split = intensityShares(byZone.rows, family);
  const figure = (value: number) => (measure === "time" ? formatDurationSpan(value) : whole(value));
  // A narrow sport in the middle of the bar has no room for its name under
  // its segment: the names then read as a legend, each with its colour, as
  // they do in a narrow section whatever the shares (overview.css).
  const crowded = bySport.sports.some(
    (sport, index) => index < bySport.sports.length - 1 && sport.share < LABELLED_SHARE
  );

  return (
    <section className="overview-section" aria-labelledby="overview-dist-title">
      <div className="overview-section-head">
        <h2 id="overview-dist-title" className="overview-section-title">
          {t("overview.distribution.title")}
        </h2>
        <span className="overview-section-aside">{periodLabel(DISTRIBUTION_DAYS)}</span>
      </div>

      <div className="panel overview-dist">
        <div className="overview-dist-part">
          <p className="overview-dist-head">
            <strong>{t("overview.distribution.bySport")}</strong>
            {bySport.total > 0 ? (
              <span className="overview-dist-aside">
                {t("overview.distribution.loadTotal", { load: whole(bySport.total) })}
              </span>
            ) : null}
          </p>
          {bySport.total > 0 ? (
            <>
              <div className="overview-dist-sports" aria-hidden="true">
                {bySport.sports.map((sport) => (
                  <i
                    key={sport.category}
                    data-sport={sport.category}
                    style={{ flex: sport.share } as CSSProperties}
                  />
                ))}
              </div>
              <ul className={`overview-dist-sport-labels${crowded ? " is-legend" : ""}`}>
                {bySport.sports.map((sport) => (
                  <li
                    key={sport.category}
                    data-sport={sport.category}
                    style={{ "--share": sport.share } as CSSProperties}
                  >
                    {SPORT_COLOR_LABELS[sport.category]}
                    <span className="figure">{percent(sport.share)}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="overview-dist-empty">
              {loading ? t("overview.zones.reading") : t("overview.distribution.noLoad")}
            </p>
          )}
        </div>

        <div className="overview-dist-part">
          <div className="overview-dist-head">
            <strong>{t("overview.distribution.byZone")}</strong>
            {hrZoneModel ? <span className="overview-dist-aside">· {hrZoneModel.label}</span> : null}
            <OptionGroup
              label={t("overview.distribution.measure")}
              tone="quiet"
              size="xs"
              value={measure}
              options={[
                { value: "time", label: t("overview.zones.time") },
                { value: "trainingLoad", label: t("overview.tiles.load") }
              ]}
              onChange={setMeasure}
            />
          </div>

          {byZone.rows.length > 0 ? (
            <div className="overview-dist-body">
              <div className="overview-dist-summary">
                <p className="overview-dist-easy">
                  <span className="figure">
                    {Math.round(split.easy * 100)}
                    <small>%</small>
                  </span>
                  <span>{t("overview.distribution.easy")}</span>
                </p>
                <p className="overview-dist-caption">
                  {measure === "time"
                    ? t("overview.distribution.ofTime", { time: formatDurationSpan(byZone.total) })
                    : t("overview.distribution.ofLoad", { load: whole(byZone.total) })}
                </p>
                <div className="overview-dist-split" aria-hidden="true">
                  <div className="overview-dist-split-bar">
                    <i data-intensity="easy" style={{ flex: split.easy }} />
                    <i data-intensity="moderate" style={{ flex: split.moderate }} />
                    <i data-intensity="hard" style={{ flex: split.hard }} />
                  </div>
                  <b style={{ left: `${EASY_TARGET * 100}%` }} />
                </div>
                <p className="overview-dist-legend">
                  <span data-intensity="easy">
                    {t("overview.distribution.easyShare", { percent: percent(split.easy) })}
                  </span>
                  <span data-intensity="moderate">
                    {t("overview.distribution.moderateShare", { percent: percent(split.moderate) })}
                  </span>
                  <span data-intensity="hard">
                    {t("overview.distribution.hardShare", { percent: percent(split.hard) })}
                  </span>
                </p>
              </div>

              <ul className="overview-dist-zones" aria-label={t("overview.distribution.byZone")}>
                {byZone.rows.map((row) => {
                  const label = names?.[row.position];
                  return (
                    <li key={row.position}>
                      <span className="overview-dist-zone">{zoneLabel(row.position)}</span>
                      <span className="overview-dist-zone-name">
                        {label ? zoneName(label) : t("overview.zones.zone", { n: row.position + 1 })}
                        {zones.length > 0 ? (
                          <span>{formatHeartRateZoneRange(zones, row.position)}</span>
                        ) : null}
                      </span>
                      <i
                        aria-hidden="true"
                        style={{ "--zone-fill": `${row.share * 100}%`, "--zone-colour": zoneColor(row.position) } as CSSProperties}
                      />
                      <span className="figure">{figure(row.value)}</span>
                      <span className="overview-dist-zone-share">{percent(row.share)}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : (
            <p className="overview-dist-empty">
              {loading ? t("overview.zones.reading") : t("overview.zones.hrEmpty")}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
