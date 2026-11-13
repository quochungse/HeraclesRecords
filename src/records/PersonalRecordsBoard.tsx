import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode
} from "react";
import { Mountain, Route } from "lucide-react";
import type { UnitSystem } from "../../electron/types";
import {
  formatDistanceValue,
  formatElevationValue,
  formatPaceValue
} from "../../electron/unitSystem";
import { OptionGroup } from "../components/OptionGroup";
import { periodLabel } from "../preferences/periodScale";
import {
  defineSelectionPreference,
  useSelectionPreference
} from "../preferences/selectionPreferences";
import { formatDurationSeconds } from "../training/formatters";
import { useUnitSystem } from "../units/UnitSystemProvider";
import { getIntlLocale, plural, t } from "../i18n/core";
import { useI18n } from "../i18n/useI18n";
import { dateOfDay, formatDayShort } from "./milestones";
import {
  RECORD_PERIODS,
  RECORD_PERIOD_DAYS,
  daysFrom,
  type BeyondKey,
  type DistanceRecord,
  type FarthestMark,
  type RecordBoard,
  type RecordPeriod,
  type RecordRun
} from "./personalBests";
import { LaurelWreath } from "./recordsIcons";

type SessionRef = NonNullable<RecordRun["activity"]>;

/** The history chart's height: fixed, so the detail is one height whatever it holds. */
const CHART_HEIGHT = 184;

const RECORD_PERIOD_PREFERENCE = defineSelectionPreference<RecordPeriod>({
  key: "records.personalRecordsPeriod",
  defaultValue: "all",
  validate: (value): value is RecordPeriod =>
    typeof value === "string" && (RECORD_PERIODS as readonly string[]).includes(value)
});

const BEYOND_LABEL: Readonly<Record<BeyondKey, () => string>> = {
  ride: () => t("records.pr.beyond.ride"),
  swim: () => t("records.pr.beyond.swim"),
  hike: () => t("records.pr.beyond.hike"),
  rideClimb: () => t("records.pr.beyond.rideClimb")
};

interface PersonalRecordsBoardProps {
  board: RecordBoard;
  /** Local `YYYYMMDD`. */
  today: string;
  onOpenActivity: (activity: SessionRef) => void;
}

/**
 * The Hall of Records' Personal Records page: the distances with a record in
 * the chosen period beside the chosen one's detail — what the list does not
 * say: where it was set, how long it has stood, the record it beat and how
 * it fell — then the farthest and highest.
 *
 * Both columns keep one height whichever record is open: the list has a row
 * for every distance the board can hold, and the detail is fixed in what it
 * draws, so pressing another row changes words, never the layout.
 */
export function PersonalRecordsBoard({ board, today, onOpenActivity }: PersonalRecordsBoardProps) {
  useI18n();
  const { unitSystem } = useUnitSystem();
  const [period, setPeriod] = useSelectionPreference(RECORD_PERIOD_PREFERENCE);
  const [chosen, setChosen] = useState<string | null>(null);

  const running = board.distances.some((row) => row.best.all);
  if (!running && !board.longestRun && board.beyond.length === 0) {
    return (
      <section className="panel records-empty">
        <h2>{t("records.pr.empty.title")}</h2>
        <p>{t("records.pr.empty.body")}</p>
      </section>
    );
  }

  // Every distance is listed; only one with a record in the period opens.
  const listed = board.distances.filter((row) => row.best[period]);
  const row =
    listed.find((entry) => entry.key === chosen) ??
    listed.find((entry) => entry.key === board.bestByStandard) ??
    listed[0];

  return (
    <div className="records-pr">
      {running ? (
        <>
          <div className="records-pr-head">
            <p className="records-section-label">{t("records.pr.running")}</p>
            <OptionGroup<RecordPeriod>
              label={t("records.pr.period")}
              value={period}
              onChange={setPeriod}
              options={RECORD_PERIODS.map((value) => ({
                value,
                get label() {
                  return periodLabel(RECORD_PERIOD_DAYS[value]);
                }
              }))}
            />
          </div>
          <div className="records-pr-board">
            <div
              className="panel records-pr-list"
              role="group"
              aria-label={t("records.pr.distances")}
              style={{ "--records-pr-rows": board.distances.length } as CSSProperties}
            >
              {board.distances.map((entry) => (
                <DistanceRow
                  key={entry.key}
                  row={entry}
                  period={period}
                  selected={entry.key === row?.key}
                  unitSystem={unitSystem}
                  onSelect={() => setChosen(entry.key)}
                />
              ))}
            </div>
            {row ? (
              <RecordDetail
                row={row}
                period={period}
                unitSystem={unitSystem}
                today={today}
                onOpenActivity={onOpenActivity}
              />
            ) : (
              <section className="panel records-pr-none-period">
                <p>{t("records.pr.emptyPeriod")}</p>
              </section>
            )}
          </div>
        </>
      ) : null}

      {board.longestRun || board.mostClimb ? (
        <div className="records-pr-farthest">
          {board.longestRun ? (
            <FarthestCard
              icon={<Route size={18} aria-hidden="true" />}
              label={t("records.pr.longestRun")}
              value={formatDistanceValue(board.longestRun.meters, unitSystem)}
              mark={board.longestRun}
              onOpenActivity={onOpenActivity}
            />
          ) : null}
          {board.mostClimb ? (
            <FarthestCard
              icon={<Mountain size={18} aria-hidden="true" />}
              label={t("records.pr.mostClimb")}
              value={formatElevationValue(board.mostClimb.meters, unitSystem)}
              mark={board.mostClimb}
              onOpenActivity={onOpenActivity}
            />
          ) : null}
        </div>
      ) : null}

      {board.beyond.length > 0 ? (
        <div className="panel records-pr-beyond">
          {board.beyond.map(({ key, mark }) => (
            <div key={key} className="records-pr-beyond-cell">
              <span className="records-eyebrow">{BEYOND_LABEL[key]()}</span>
              <Figure
                text={
                  key === "rideClimb"
                    ? formatElevationValue(mark.meters, unitSystem)
                    : formatDistanceValue(mark.meters, unitSystem, { swim: key === "swim" })
                }
              />
              <SessionLine mark={mark} onOpenActivity={onOpenActivity} />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// --- The list -----------------------------------------------------------------------

function DistanceRow({
  row,
  period,
  selected,
  unitSystem,
  onSelect
}: {
  row: DistanceRecord;
  period: RecordPeriod;
  selected: boolean;
  unitSystem: UnitSystem;
  onSelect: () => void;
}) {
  const mark = row.best[period];
  const gain = mark && period === "all" ? lastGain(row) : undefined;
  return (
    <button
      type="button"
      className="records-pr-row"
      aria-pressed={selected}
      disabled={!mark}
      onClick={onSelect}
    >
      <span className="records-pr-row-label">{row.label}</span>
      <span className="records-pr-row-figure">
        <strong>{mark ? formatDurationSeconds(mark.seconds) : "—"}</strong>
        <small>
          {mark
            ? paceOf(row, mark, unitSystem)
            : period === "all"
              ? t("records.pr.noneYet")
              : t("records.pr.noneInPeriod")}
          {gain !== undefined ? (
            <>
              {" · "}
              <b title={t("records.pr.gainTitle")}>{t("records.pr.gain", { gap: formatDurationSeconds(gain) })}</b>
            </>
          ) : null}
        </small>
      </span>
      {mark ? (
        <span className="records-pr-row-spark" aria-hidden="true">
          {row.history.length > 0 ? <RecordChart history={row.history} distance={row.distance} compact /> : null}
        </span>
      ) : null}
    </button>
  );
}

/** How much the last record took off the one before, when it is the standing one. */
function lastGain(row: DistanceRecord): number | undefined {
  const { history } = row;
  const last = history[history.length - 1];
  const before = history[history.length - 2];
  const standing = row.best.all;
  if (!last || !before || !standing || Math.abs(last.seconds - standing.seconds) > 1) return undefined;
  return before.seconds - last.seconds;
}

function paceOf(row: DistanceRecord, mark: RecordRun, unitSystem: UnitSystem): string {
  return formatPaceValue(mark.seconds / (row.distance / 1000), unitSystem);
}

// --- The detail ---------------------------------------------------------------------

/**
 * What the row does not say. The row has the time and the pace; the detail has
 * where and when it was set, how long it has stood (or, in a shorter period,
 * how far it is off the all-time record), and the record it beat.
 */
function RecordDetail({
  row,
  period,
  unitSystem,
  today,
  onOpenActivity
}: {
  row: DistanceRecord;
  period: RecordPeriod;
  unitSystem: UnitSystem;
  today: string;
  onOpenActivity: (activity: SessionRef) => void;
}) {
  const mark = row.best[period] as RecordRun;
  const record = row.best.all;
  const atRecord = !record || Math.abs(record.seconds - mark.seconds) <= 1;
  const { history } = row;
  // The record it beat: what it took off it is the gain worth knowing.
  const before = history[history.length - 2];
  const gain = lastGain(row);

  return (
    <section className="panel records-pr-detail" aria-label={row.label}>
      <div className="records-pr-plaque">
        <div className="records-pr-plaque-head">
          <div>
            <p className="records-pr-eyebrow">
              {period === "all"
                ? t("records.pr.record")
                : t("records.pr.bestIn", { period: periodLabel(RECORD_PERIOD_DAYS[period]) })}
            </p>
            <h3 className="records-pr-distance">{row.label}</h3>
          </div>
          <span className="records-pr-wreath">
            <LaurelWreath size={36} />
          </span>
        </div>
        <dl className="records-pr-stats">
          <Stat
            label={t("records.pr.setOn")}
            value={formatDayShort(mark.day)}
            sub={
              mark.activity ? (
                <button
                  type="button"
                  className="records-pr-link"
                  onClick={() => onOpenActivity(mark.activity as SessionRef)}
                >
                  {mark.name ?? t("records.openSession")}
                </button>
              ) : (
                mark.name
              )
            }
          />
          {atRecord ? (
            <Stat
              label={t("records.pr.standingFor")}
              value={plural("records.pr.days", Math.max(0, daysFrom(mark.day, today)))}
            />
          ) : (
            <Stat
              label={t("records.pr.offRecord")}
              value={`+${formatDurationSeconds(mark.seconds - (record as RecordRun).seconds)}`}
              sub={t("records.pr.recordIs", { time: formatDurationSeconds((record as RecordRun).seconds) })}
            />
          )}
          {atRecord && before && gain !== undefined ? (
            <Stat
              label={t("records.pr.previous")}
              value={t("records.pr.gain", { gap: formatDurationSeconds(gain) })}
              sub={`${formatDurationSeconds(before.seconds)} · ${formatDayShort(before.day)}`}
            />
          ) : null}
        </dl>
      </div>
      <div className="records-pr-history">
        <p className="records-section-label">{t("records.pr.howItFell")}</p>
        {history.length > 0 ? (
          <RecordChart history={history} distance={row.distance} unitSystem={unitSystem} />
        ) : (
          <p className="records-pr-nohistory">{t("records.pr.noHistory")}</p>
        )}
      </div>
    </section>
  );
}

/** One figure of the detail: a label, the figure, and a line under it — always a line, so every cell is one height. */
function Stat({ label, value, sub }: { label: string; value: string; sub?: ReactNode }) {
  return (
    <div className="records-pr-stat">
      <dt>{label}</dt>
      <dd className="records-pr-stat-value">{value}</dd>
      <dd className="records-pr-stat-sub">{sub ?? " "}</dd>
    </div>
  );
}

// --- The chart ----------------------------------------------------------------------

type ChartPoint = { run: RecordRun; x: number; y: number };

/**
 * A smooth line through the points that never swings past them (monotone in
 * x, Fritsch–Carlson tangents): a record only ever gets faster, and a curve
 * that overshot would draw a time nobody ran.
 */
function monotonePath(points: readonly ChartPoint[]): string {
  const at = (point: ChartPoint) => `${point.x.toFixed(1)} ${point.y.toFixed(1)}`; // i18n-ignore: SVG path coordinates
  const first = points[0] as ChartPoint;
  if (points.length === 1) return `M ${at(first)}`;
  const gaps = points.slice(1).map((point, index) => point.x - (points[index] as ChartPoint).x);
  const slopes = points
    .slice(1)
    .map((point, index) => (gaps[index] ? (point.y - (points[index] as ChartPoint).y) / (gaps[index] as number) : 0));
  const tangents = points.map((_, index) => {
    if (index === 0) return slopes[0] as number;
    if (index === points.length - 1) return slopes[index - 1] as number;
    const before = slopes[index - 1] as number;
    const after = slopes[index] as number;
    if (before * after <= 0) return 0;
    const left = gaps[index - 1] as number;
    const right = gaps[index] as number;
    return (3 * (left + right)) / ((2 * right + left) / before + (right + 2 * left) / after);
  });
  let path = `M ${at(first)}`;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1] as ChartPoint;
    const to = points[index] as ChartPoint;
    const third = (gaps[index - 1] as number) / 3;
    const c1 = { x: from.x + third, y: from.y + (tangents[index - 1] as number) * third };
    const c2 = { x: to.x - third, y: to.y - (tangents[index] as number) * third };
    path += ` C ${c1.x.toFixed(1)} ${c1.y.toFixed(1)}, ${c2.x.toFixed(1)} ${c2.y.toFixed(1)}, ${at(to)}`; // i18n-ignore: SVG path coordinates
  }
  return path;
}

/**
 * A record's history: a line through every time it fell, faster higher, from
 * the first to the last. Pointed at — or stepped through with the arrow keys —
 * a record says its time, pace, run and what it took off the one before.
 *
 * The full chart is drawn at its box's own width (measured) and a fixed
 * height, so its words stay their size and the detail one height; the row's
 * sparkline is a drawing scaled to its cell.
 */
function RecordChart({
  history,
  distance,
  unitSystem,
  compact = false
}: {
  history: readonly RecordRun[];
  distance: number;
  unitSystem?: UnitSystem;
  compact?: boolean;
}) {
  // React's ids carry characters a `url(#…)` reference does not survive.
  const fadeId = `records-pr-fade-${useId().replace(/[^\w-]/g, "")}`;
  const [active, setActive] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState(0);
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (compact || !wrap) return;
    setMeasured(wrap.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setMeasured(wrap.clientWidth));
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [compact]);
  const width = compact ? 90 : Math.max(measured, 1);
  const height = compact ? 28 : CHART_HEIGHT;
  const left = compact ? 3 : 44;
  const right = compact ? 5 : 48;
  const top = compact ? 4 : 22;
  const bottom = compact ? 4 : 24;

  // From the first record to the last; a history of one day, or a few, is
  // given a fortnight around it so its points do not sit on the edges.
  const firstDay = dateOfDay((history[0] as RecordRun).day).getTime();
  const lastDay = dateOfDay((history[history.length - 1] as RecordRun).day).getTime();
  const spread = Math.max(0, 86_400_000 * 14 - (lastDay - firstDay)) / 2;
  const start = firstDay - spread;
  const end = lastDay + spread;
  const seconds = history.map((run) => run.seconds);
  let low = Math.min(...seconds);
  let high = Math.max(...seconds);
  if (high - low < 1) {
    low *= 0.96;
    high *= 1.04;
  }
  const pad = (high - low) * 0.12;
  low -= pad;
  high += pad;

  const x = (time: number) => left + ((time - start) / (end - start)) * (width - left - right);
  const y = (value: number) => top + ((value - low) / (high - low)) * (height - top - bottom);
  const points: ChartPoint[] = history.map((run) => ({ run, x: x(dateOfDay(run.day).getTime()), y: y(run.seconds) }));
  const last = points[points.length - 1] as ChartPoint;
  const line = monotonePath(points);
  const floor = height - bottom;
  const area = `${line} V ${floor} H ${(points[0] as ChartPoint).x.toFixed(1)} Z`; // i18n-ignore: SVG path coordinates

  // Years along a long history; months along one that fits in about a year,
  // every other month past half of one.
  const ticks: Array<{ key: string; label: string; x: number }> = [];
  if (!compact) {
    const days = (end - start) / 86_400_000;
    if (days > 400) {
      for (let year = new Date(start).getFullYear() + 1; year <= new Date(end).getFullYear(); year += 1) {
        ticks.push({ key: String(year), label: String(year), x: x(new Date(year, 0, 1).getTime()) });
      }
    } else {
      const step = days > 200 ? 2 : 1;
      const month = new Intl.DateTimeFormat(getIntlLocale(), { month: "short" });
      const from = new Date(start);
      for (let at = new Date(from.getFullYear(), from.getMonth() + 1, 1); at.getTime() <= end; at = new Date(at.getFullYear(), at.getMonth() + step, 1)) {
        ticks.push({ key: at.toISOString(), label: month.format(at), x: x(at.getTime()) });
      }
    }
  }

  // The record nearest the pointer along the time axis.
  const pointAt = (event: PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const at = ((event.clientX - box.left) / box.width) * width;
    let nearest = 0;
    points.forEach((point, index) => {
      if (Math.abs(point.x - at) < Math.abs((points[nearest] as ChartPoint).x - at)) nearest = index;
    });
    setActive(nearest);
  };
  const step = (event: KeyboardEvent<SVGSVGElement>) => {
    const move =
      event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : event.key === "Home" ? -points.length : event.key === "End" ? points.length : 0;
    if (move === 0) return;
    event.preventDefault();
    setActive((current) => Math.min(points.length - 1, Math.max(0, (current ?? points.length - 1) + move)));
  };

  // A row pressed while one was pointed at has fewer points, perhaps.
  const shown = active === null ? null : (points[active] ?? null);
  const before = active !== null && active > 0 ? (points[active - 1] as ChartPoint) : null;

  const drawing = (
    <svg
      className={compact ? "records-pr-chart is-compact" : "records-pr-chart"}
      viewBox={`0 0 ${width} ${height}`}
      {...(compact
        ? { "aria-hidden": true }
        : {
            role: "img",
            "aria-label": t("records.pr.chart"),
            tabIndex: 0,
            onPointerMove: pointAt,
            onPointerLeave: () => setActive(null),
            onFocus: () => setActive((current) => current ?? points.length - 1),
            onBlur: () => setActive(null),
            onKeyDown: step
          })}
    >
      <defs>
        <linearGradient id={fadeId} x1="0" x2="0" y1="0" y2="1">
          <stop className="records-pr-chart-stop" offset="0" stopOpacity={compact ? 0.22 : 0.28} />
          <stop className="records-pr-chart-stop" offset="1" stopOpacity="0" />
        </linearGradient>
      </defs>
      {ticks.map((tick) => (
        <g key={tick.key} className="records-pr-chart-tick">
          <line x1={tick.x} x2={tick.x} y1={top} y2={floor} />
          <text x={tick.x + 4} y={height - 6}>{tick.label}</text>
        </g>
      ))}
      {!compact ? (
        <g>
          <text x={0} y={top + 8}>{t("records.pr.faster")}</text>
          <text x={0} y={floor}>{t("records.pr.slower")}</text>
        </g>
      ) : null}
      <path d={area} fill={`url(#${fadeId})`} />
      <path className="records-pr-chart-line" d={line} />
      {shown ? <line className="records-pr-chart-guide" x1={shown.x} x2={shown.x} y1={top} y2={floor} /> : null}
      {points.map((point, index) => (
        <circle
          key={`${point.run.day}-${index}`}
          className={[
            "records-pr-chart-dot",
            index === points.length - 1 ? "is-last" : "",
            index === active ? "is-active" : ""
          ].filter(Boolean).join(" ")}
          cx={point.x}
          cy={point.y}
          r={compact ? (index === points.length - 1 ? 2.6 : 1.6) : index === active ? 6 : index === points.length - 1 ? 5 : 3.5}
        />
      ))}
      {!compact && active === null ? (
        <text className="records-pr-chart-value" x={last.x + 7} y={last.y - 9}>
          {formatDurationSeconds(last.run.seconds)}
        </text>
      ) : null}
    </svg>
  );
  if (compact) return drawing;

  // The tooltip stands over its point, turned in where it would leave the
  // chart: percentages of the drawing, which is the wrapper's own box.
  const across = shown ? shown.x / width : 0;
  const down = shown ? shown.y / height : 0;
  return (
    <div ref={wrapRef} className="records-pr-chart-wrap">
      {measured > 0 ? drawing : null}
      {shown ? (
        <div
          className="records-pr-tip"
          role="status"
          style={{
            left: `${across * 100}%`,
            top: `${down * 100}%`,
            transform: `translate(${across > 0.7 ? "-100%" : across < 0.3 ? "0%" : "-50%"}, ${down < 0.4 ? "14px" : "calc(-100% - 14px)"})`
          }}
        >
          <strong>{formatDurationSeconds(shown.run.seconds)}</strong>
          <span>
            {unitSystem ? `${formatPaceValue(shown.run.seconds / (distance / 1000), unitSystem)} · ` : ""}
            {formatDayShort(shown.run.day)}
          </span>
          {shown.run.name ? <span className="records-pr-tip-name">{shown.run.name}</span> : null}
          <em>
            {before
              ? t("records.pr.tipGain", { gap: formatDurationSeconds(before.run.seconds - shown.run.seconds) })
              : t("records.pr.tipFirst")}
          </em>
        </div>
      ) : null}
    </div>
  );
}

// --- The farthest -------------------------------------------------------------------

function FarthestCard({
  icon,
  label,
  value,
  mark,
  onOpenActivity
}: {
  icon: ReactNode;
  label: string;
  value: string;
  mark: FarthestMark;
  onOpenActivity: (activity: SessionRef) => void;
}) {
  return (
    <div className="panel records-pr-far">
      <span className="records-pr-far-icon">{icon}</span>
      <div>
        <span className="records-eyebrow">{label}</span>
        <Figure text={value} />
        <SessionLine mark={mark} onOpenActivity={onOpenActivity} />
      </div>
    </div>
  );
}

/** "42.4 km" as a figure and a quieter unit. */
function Figure({ text }: { text: string }) {
  const index = text.lastIndexOf(" ");
  return (
    <p className="records-pr-figure">
      {index < 0 ? text : text.slice(0, index)}
      {index < 0 ? null : <span>{text.slice(index + 1)}</span>}
    </p>
  );
}

/** The session it was done in, which opens it, and the day. */
function SessionLine({
  mark,
  onOpenActivity
}: {
  mark: FarthestMark;
  onOpenActivity: (activity: SessionRef) => void;
}) {
  return (
    <p className="records-pr-session">
      {mark.activity ? (
        <button
          type="button"
          className="records-pr-link"
          onClick={() => onOpenActivity(mark.activity as SessionRef)}
        >
          {mark.name ?? t("records.openSession")}
        </button>
      ) : mark.name ? (
        <span>{mark.name}</span>
      ) : null}
      <span>{formatDayShort(mark.day)}</span>
    </p>
  );
}
