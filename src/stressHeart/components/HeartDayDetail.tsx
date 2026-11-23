import { useId, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { ChevronRight } from "lucide-react";
import type {
  ActivityDetailSummary,
  CorosProfileZoneFamily,
  StressHeartDay,
  TrainingHubActivityDetail,
  TrainingHubSleepRecord
} from "../../../electron/types";
import { resolveSportName } from "../../training/sportTypes";
import { sportColorCategory } from "../../training/sportColors";
import { formatSleepDurationMinutes } from "../../training/formatters";
import { heartRateZoneFamily, heartRateZoneTime, type ZoneTimeRow } from "../../training/zoneTime";
import { zoneName } from "../../i18n/zoneNames";
import { useI18n } from "../../i18n/useI18n";
import {
  HEART_DAY_SCALE,
  clockOf,
  dayDate,
  heartScaleAt,
  restingAgainstWeek,
  type LaneSession
} from "../stressHeartModel";
import { BPM, DayTip, type TipRow } from "./trendParts";
import { ZoneRows } from "./ZoneRows";

interface HeartDayDetailProps {
  day: string;
  record: StressHeartDay | undefined;
  byDay: ReadonlyMap<string, StressHeartDay>;
  /** The night that ended this morning, when it carries a heart rate. */
  night: TrainingHubSleepRecord | undefined;
  sessions: LaneSession[];
  /** Each session's detail: its highest heart rate and its own zones. */
  details: ReadonlyMap<string, TrainingHubActivityDetail | null>;
  /** Each session's stored summary, whose heart rate answers before the detail does. */
  summaries: ReadonlyMap<string, ActivityDetailSummary>;
  /** The account's zone model, for a session COROS scored with no model named. */
  accountFamily?: CorosProfileZoneFamily;
  isToday: boolean;
}

/** A zone's bounds as the Running screen writes them. */
function zoneRange(row: ZoneTimeRow): string | undefined {
  if (row.easyEdge !== undefined && row.hardEdge !== undefined) return `${Math.round(row.easyEdge)}–${Math.round(row.hardEdge)} ${BPM}`;
  if (row.hardEdge !== undefined) return `≤ ${Math.round(row.hardEdge)} ${BPM}`;
  if (row.easyEdge !== undefined) return `≥ ${Math.round(row.easyEdge)} ${BPM}`;
  return undefined;
}

function bpm(value: number): string {
  return `${Math.round(value)} ${BPM}`;
}

interface LadderRow {
  key: string;
  label: string;
  low?: number;
  average?: number;
  high?: number;
  tone: "day" | "asleep" | "session";
  sportColor?: string;
  /** What the hover card says about the row. */
  heading: string;
  tip: TipRow[];
}

/**
 * One day's heart rate: its resting heart rate (set by the night, so stated
 * even for today), COROS's range for the day, and a ladder of where it sat —
 * the whole day, asleep and each session — on one scale, with the resting rate
 * drawn through it. A row says what it holds when pointed at. COROS sends no
 * heart rate through the day, only these figures. Today states no average
 * (`stressHeartModel.ts`).
 *
 * Each session below carries its own time in its zones, folded until opened.
 */
export function HeartDayDetail({
  day,
  record,
  byDay,
  night,
  sessions,
  details,
  summaries,
  accountFamily,
  isToday
}: HeartDayDetailProps) {
  const { t, intl } = useI18n();
  const ladderRef = useRef<HTMLDivElement | null>(null);
  const [pointed, setPointed] = useState<{ key: string; x: number; y: number } | null>(null);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const idBase = useId();
  const when = new Intl.DateTimeFormat(intl, { weekday: "long", month: "short", day: "numeric" }).format(dayDate(day));
  const resting = record?.restingHr;
  const delta = restingAgainstWeek(byDay, day);
  const dayAverage = isToday ? undefined : record?.avgHr;
  // COROS's own figures for the day, as it sends them.
  const dayLow = record?.minHr;
  const dayHigh = record?.maxHr;

  const tipRow = (key: string, name: string, color: string, value: number | undefined): TipRow[] =>
    value !== undefined ? [{ key, name, color, value: bpm(value) }] : [];
  // Lowest and highest are one line: "HR 48–157 bpm".
  const rangeRow = (color: string, lowest: number | undefined, highest: number | undefined): TipRow[] =>
    lowest !== undefined && highest !== undefined
      ? [{
          key: "range",
          name: t("heart.tip.range"),
          color,
          value: t("heart.figure.rangeBpm", { low: Math.round(lowest), high: Math.round(highest) })
        }]
      : [];
  const restingRow = tipRow("resting", t("heart.figure.restingHr"), "var(--heart-rate-resting)", resting);

  const rows: LadderRow[] = [];
  if (dayLow !== undefined && dayHigh !== undefined) {
    const color = "var(--heart-rate)";
    rows.push({
      key: "day",
      label: t("heart.ladder.day"),
      low: dayLow,
      average: dayAverage,
      high: dayHigh,
      tone: "day",
      heading: isToday ? t("heart.ladder.daySoFar") : t("heart.ladder.day"),
      tip: [...rangeRow(color, dayLow, dayHigh), ...tipRow("average", t("heart.tip.average"), color, dayAverage), ...restingRow]
    });
  }
  if (night?.avgHr !== undefined) {
    const color = "var(--sleep-hr)";
    rows.push({
      key: "asleep",
      label: t("heart.ladder.asleep"),
      low: night.minHr,
      average: night.avgHr,
      high: night.maxHr,
      tone: "asleep",
      heading:
        night.sleepStart && night.sleepEnd
          ? t("heart.ladder.asleepAt", { start: night.sleepStart, end: night.sleepEnd })
          : t("heart.ladder.asleep"),
      tip: [
        ...rangeRow(color, night.minHr, night.maxHr),
        ...tipRow("average", t("heart.tip.average"), color, night.avgHr),
        ...restingRow
      ]
    });
  }
  for (const session of sessions) {
    const activity = session.activity;
    // The list carries a session's average but never its highest: that is
    // the detail's.
    const detail = details.get(activity.activityId);
    const known = summaries.get(activity.activityId)?.heartRate;
    const average = detail?.avgHr ?? known?.avg ?? activity.avgHr;
    const highest = detail?.maxHr ?? known?.max ?? activity.maxHr;
    if (average === undefined && highest === undefined) continue;
    const color = `var(--sport-${sportColorCategory(activity.sportType)})`;
    rows.push({
      key: activity.activityId,
      label: `${clockOf(Math.round(session.from))} ${resolveSportName(activity) ?? ""}`.trim(),
      average,
      high: highest,
      tone: "session",
      sportColor: color,
      heading: activity.name?.trim() || resolveSportName(activity) || "",
      tip: [
        {
          key: "time",
          name: t("heart.tip.time"),
          color,
          value: `${clockOf(Math.round(session.from))}–${clockOf(Math.round(session.to))}`
        },
        ...tipRow("average", t("heart.tip.average"), color, average),
        ...tipRow("high", t("heart.tip.highest"), color, highest)
      ]
    });
  }

  // The list rows' scale, so a row's strip is this ladder in small.
  const at = heartScaleAt;
  const pointedRow = pointed ? rows.find((row) => row.key === pointed.key) : undefined;

  function point(event: PointerEvent<HTMLDivElement>, key: string) {
    const box = ladderRef.current?.getBoundingClientRect();
    if (!box) return;
    setPointed({ key, x: event.clientX - box.left, y: event.clientY - box.top });
  }

  function toggle(id: string) {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <article className="stress-day-detail" aria-label={t("heart.detail.aria")}>
      <header className="stress-day-detail-header">
        <div>
          <p className="stress-day-detail-date">{isToday ? t("stress.detail.todaySoFar", { day: when }) : when}</p>
          <div className="stress-day-detail-lead">
            <strong className="stress-day-detail-figure is-resting">
              {resting !== undefined ? Math.round(resting) : "–"}
            </strong>
            <span className="stress-day-detail-unit">
              {resting !== undefined ? t("heart.detail.resting") : t("heart.detail.noResting")}
            </span>
          </div>
          <p className="stress-day-detail-sub">
            {delta === undefined
              ? " "
              : delta === 0
                ? t("heart.detail.sameAsWeek")
                : t("heart.detail.vsWeek", { delta: `${delta > 0 ? "+" : "−"}${Math.abs(delta)} ${BPM}` })}
          </p>
        </div>

        <dl className="stress-day-figures">
          {/* Daily and sleep heart rate, alike: lowest to highest, the average under it. */}
          <div className="stress-day-figure is-day">
            <dt>{t("heart.figure.dailyHr")}</dt>
            <dd>
              <strong>
                {dayLow !== undefined && dayHigh !== undefined ? `${Math.round(dayLow)}–${Math.round(dayHigh)}` : "–"}
                <small>{BPM}</small>
              </strong>
              <span>
                {isToday
                  ? t("heart.figure.soFar")
                  : dayAverage !== undefined
                    ? t("heart.figure.avgBpm", { bpm: Math.round(dayAverage) })
                    : "\u00a0"}
              </span>
            </dd>
          </div>
          <div className="stress-day-figure is-asleep">
            <dt>{t("heart.figure.sleepHr")}</dt>
            <dd>
              <strong>
                {night?.minHr !== undefined && night.maxHr !== undefined
                  ? `${Math.round(night.minHr)}–${Math.round(night.maxHr)}`
                  : night?.avgHr !== undefined
                    ? Math.round(night.avgHr)
                    : "–"}
                <small>{BPM}</small>
              </strong>
              <span>
                {night?.avgHr !== undefined
                  ? t("heart.figure.avgBpm", { bpm: Math.round(night.avgHr) })
                  : t("heart.figure.noNight")}
              </span>
            </dd>
          </div>
        </dl>
      </header>

      {rows.length > 0 ? (
        <div
          ref={ladderRef}
          className="heart-ladder"
          role="img"
          aria-label={rows
            .map((row) => `${row.heading}: ${row.tip.map((line) => `${line.name} ${line.value}`).join(", ")}`)
            .join("; ")}
          onPointerLeave={() => setPointed(null)}
        >
          {rows.map((row) => (
            <div
              key={row.key}
              className={`heart-ladder-row is-${row.tone}${pointed?.key === row.key ? " is-pointed" : ""}`}
              onPointerMove={(event) => point(event, row.key)}
            >
              <span className="heart-ladder-label">{row.label}</span>
              <span
                className="heart-ladder-track"
                style={row.sportColor ? ({ "--heart-ladder-color": row.sportColor } as CSSProperties) : undefined}
              >
                {resting !== undefined ? <b className="heart-ladder-resting" style={{ left: at(resting) }} /> : null}
                {row.low !== undefined && row.high !== undefined ? (
                  <i
                    className="heart-ladder-range"
                    style={{ left: at(row.low), width: `calc(${at(row.high)} - ${at(row.low)})` }}
                  />
                ) : row.average !== undefined && row.high !== undefined ? (
                  <i
                    className="heart-ladder-range"
                    style={{ left: at(row.average), width: `calc(${at(row.high)} - ${at(row.average)})` }}
                  />
                ) : null}
                {row.average !== undefined ? <em className="heart-ladder-average" style={{ left: at(row.average) }} /> : null}
              </span>
            </div>
          ))}
          <div className="heart-ladder-row is-axis" aria-hidden="true">
            <span />
            <span className="heart-ladder-track">
              {HEART_DAY_SCALE.ticks.map((tick) => (
                <small key={tick} style={{ left: at(tick) }}>
                  {tick}
                </small>
              ))}
            </span>
          </div>
          {pointed && pointedRow ? (
            <div
              className={`heart-ladder-tip${pointed.x > (ladderRef.current?.clientWidth ?? 0) - 240 ? " is-left" : ""}`}
              style={{ left: pointed.x, top: pointed.y }}
              aria-hidden="true"
            >
              <DayTip heading={pointedRow.heading} rows={pointedRow.tip} />
            </div>
          ) : null}
        </div>
      ) : (
        <p className="stress-day-note">{t("heart.detail.nothing")}</p>
      )}

      {sessions.length > 0 ? (
        <section className="heart-sessions" aria-label={t("heart.sessions.title")}>
          <h3 className="stress-pane-title">{t("heart.sessions.title")}</h3>
          {sessions.map((session) => {
            const activity = session.activity;
            const detail = details.get(activity.activityId);
            const zones =
              detail && detail.hrZones.length > 0
                ? heartRateZoneTime(detail.hrZones, heartRateZoneFamily(detail.hrZoneType, accountFamily))
                : [];
            const known = summaries.get(activity.activityId)?.heartRate;
            const average = detail?.avgHr ?? known?.avg ?? activity.avgHr;
            const highest = detail?.maxHr ?? known?.max ?? activity.maxHr;
            const expanded = open.has(activity.activityId);
            const panelId = `${idBase}-${activity.activityId}`;
            const name = activity.name?.trim() || resolveSportName(activity) || "";
            return (
              <article key={activity.activityId} className={`heart-session${expanded ? " is-open" : ""}`}>
                <button
                  type="button"
                  className="heart-session-head"
                  aria-expanded={expanded}
                  aria-controls={panelId}
                  onClick={() => toggle(activity.activityId)}
                >
                  <ChevronRight size={14} className="heart-session-chevron" aria-hidden="true" />
                  <i
                    aria-hidden="true"
                    style={{ "--heart-session-color": `var(--sport-${sportColorCategory(activity.sportType)})` } as CSSProperties}
                  />
                  <strong>{name}</strong>
                  <span>
                    {t("heart.sessions.when", {
                      time: `${clockOf(Math.round(session.from))}–${clockOf(Math.round(session.to))}`,
                      duration: formatSleepDurationMinutes((activity.duration ?? 0) / 60)
                    })}
                  </span>
                  <span className="heart-session-hr">
                    {highest !== undefined
                      ? t("heart.sessions.avgMax", {
                          avg: average !== undefined ? Math.round(average) : "–",
                          max: Math.round(highest)
                        })
                      : average !== undefined
                        ? t("heart.sessions.avg", { avg: Math.round(average) })
                        : null}
                  </span>
                </button>
                {expanded ? (
                  <div id={panelId} className="heart-session-zones">
                    {detail === undefined ? (
                      <p className="stress-day-note">{t("heart.sessions.loading")}</p>
                    ) : zones.length === 0 ? (
                      <p className="stress-day-note">{t("heart.sessions.noZones")}</p>
                    ) : (
                      <ZoneRows
                        compact
                        label={t("heart.sessions.zonesAria", { name })}
                        rows={zones.map((row) => ({
                          position: row.position,
                          name: row.label ? zoneName(row.label) : t("overview.zones.zone", { n: row.position + 1 }),
                          range: zoneRange(row),
                          seconds: row.seconds,
                          share: row.share
                        }))}
                      />
                    )}
                  </div>
                ) : null}
              </article>
            );
          })}
        </section>
      ) : null}
    </article>
  );
}
