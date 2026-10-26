import { useId, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import { formatCount, formatDecimal, getIntlLocale, t } from "../../i18n/core";
import { getLocalHappenDayKey } from "../formatters";
import {
  formatDistanceMeters,
  formatDurationSpan,
  formatElevationMeters,
} from "../formatters";
import { useUnitSystem } from "../../units/UnitSystemProvider";
import type { RunWeek } from "../../running/runMetrics";
import { OverviewChartTooltip } from "./OverviewChartTooltip";

export function overviewTone(color: string): CSSProperties {
  return { "--overview-tone": color } as CSSProperties;
}

export function overviewDate(day: string): string {
  return new Date(
    +day.slice(0, 4),
    +day.slice(4, 6) - 1,
    +day.slice(6),
  ).toLocaleDateString(getIntlLocale(), { day: "numeric", month: "short" });
}

export function OverviewHeading({
  title,
  onOpen,
  children,
  icon,
}: {
  title: string;
  onOpen?: () => void;
  children?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <header className="overview-section-heading">
      <h2>
        {icon}
        {title}
      </h2>
      {children}
      {onOpen && (
        <button type="button" className="overview-entry" onClick={onOpen} aria-label={`${t("common.details")} · ${title}`}>
          {t("common.details")}
          <ArrowUpRight size={14} aria-hidden="true" />
        </button>
      )}
    </header>
  );
}

export function OverviewStat({
  label,
  value,
  unit,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
}) {
  return (
    <div className="overview-stat">
      <span>{label}</span>
      <strong>
        {value}
        {unit && <small>{unit}</small>}
      </strong>
    </div>
  );
}

export function OverviewCardHeader({
  title,
  icon,
  onOpen,
}: {
  title: string;
  icon?: ReactNode;
  onOpen?: () => void;
}) {
  return (
    <header className="overview-card-header">
      <p className="eyebrow">
        {icon}
        {title}
      </p>
      {onOpen && (
        <button
          type="button"
          className="overview-icon-entry"
          onClick={onOpen}
          aria-label={`${t("common.details")} · ${title}`}
        >
          <ArrowUpRight size={16} aria-hidden="true" />
        </button>
      )}
    </header>
  );
}

export function OverviewVolumeChart({
  values,
  labels,
  color,
  unit,
  title,
  weeks,
}: {
  values: number[];
  labels: string[];
  color: string;
  unit: string;
  title: string;
  weeks: readonly Pick<
    RunWeek,
    | "weekStartMs"
    | "distance"
    | "duration"
    | "trainingLoad"
    | "count"
    | "elevationGain"
  >[];
}) {
  const [active, setActive] = useState<number | null>(null);
  const [anchor, setAnchor] = useState({ x: 0, y: 0 });
  const tooltipId = useId();
  const { unitSystem } = useUnitSystem();
  const brief = active === null ? undefined : weeks[active];
  const range = (week: (typeof weeks)[number]) => {
    const end = new Date(week.weekStartMs);
    end.setDate(end.getDate() + 6);
    const first = overviewDate(getLocalHappenDayKey(new Date(week.weekStartMs)));
    const last = overviewDate(getLocalHappenDayKey(new Date(Math.min(+end, Date.now()))));
    return `${first} – ${last}`;
  };
  const max = Math.max(1, ...values) * 1.24;
  return (
    <div className="overview-volume">
      <div className="overview-chart-heading">
        <span>
          {title} <small>({unit})</small>
        </span>
        <small>{t("overview.briefing.weeks")}</small>
      </div>
      <svg
        viewBox="0 0 500 130"
        role="group"
        aria-label={`${title} · ${unit}. ${values.map((v, i) => `${labels[i]}: ${formatDecimal(v, 1)}`).join("; ")}`}
      >
        {[0, 0.5, 1].map((p, i) => (
          <g key={i}>
            <line x1="45" x2="490" y1={100 - p * 84} y2={100 - p * 84} />
            <text x="38" y={103 - p * 84} textAnchor="end">
              {max < 10
                ? formatDecimal(p * max, 1)
                : formatCount(Math.round(p * max))}
            </text>
          </g>
        ))}
        {values.map((v, i) => (
          <g
            key={i}
            tabIndex={0}
            role="img"
            aria-label={`${labels[i]}: ${formatDecimal(v, 1)} ${unit}`}
            aria-describedby={active === i ? tooltipId : undefined}
            onPointerEnter={(e) => {
              setActive(i);
              setAnchor({ x: e.clientX, y: e.clientY });
            }}
            onPointerMove={(e) => {
              setActive(i);
              setAnchor({ x: e.clientX, y: e.clientY });
            }}
            onPointerLeave={() => setActive(null)}
            onFocus={(e) => {
              const box = e.currentTarget.getBoundingClientRect();
              setActive(i);
              setAnchor({ x: box.x + box.width / 2, y: box.y });
            }}
            onBlur={() => setActive(null)}
            onClick={(e) => {
              const box = e.currentTarget.getBoundingClientRect();
              setAnchor({ x: box.x + box.width / 2, y: box.y });
              setActive(i);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") setActive(null);
            }}
          >
            <rect
              x={64 + i * 85}
              y={100 - (v / max) * 84}
              width="41"
              height={(v / max) * 84}
              rx="3"
              fill={color}
              fillOpacity={active === i ? 0.9 : i === values.length - 1 ? 0.18 : 0.65}
              stroke={i === values.length - 1 ? color : "none"}
              strokeDasharray={i === values.length - 1 ? "3 2" : undefined}
            />
            <text
              className="overview-chart-value"
              x={84.5 + i * 85}
              y={100 - (v / max) * 84 - 7}
              textAnchor="middle"
            >
              {max < 10 ? formatDecimal(v, 1) : formatCount(Math.round(v))}
            </text>
            <text x={84.5 + i * 85} y="122" textAnchor="middle">
              {i === values.length - 1
                ? t("activity.hero.thisWeek")
                : labels[i]}
            </text>
            <rect
              x={50 + i * 85}
              y="0"
              width="70"
              height="130"
              fill="transparent"
            />
          </g>
        ))}
      </svg>
      {brief && active !== null && (
        <OverviewChartTooltip id={tooltipId} anchor={anchor} onDismiss={() => setActive(null)}>
          <strong>{range(brief)}</strong>
          <dl>
            <div>
              <dt>{t("overview.tiles.distance")}</dt>
              <dd>{formatDistanceMeters(brief.distance, unitSystem)}</dd>
            </div>
            <div>
              <dt>{t("overview.tiles.duration")}</dt>
              <dd>{formatDurationSpan(brief.duration)}</dd>
            </div>
            <div>
              <dt>{t("overview.trainingLoad")}</dt>
              <dd>{formatCount(Math.round(brief.trainingLoad))}</dd>
            </div>
            <div>
              <dt>{t("strength.summary.sessions")}</dt>
              <dd>{formatCount(brief.count)}</dd>
            </div>
            <div>
              <dt>{t("activity.m.climb")}</dt>
              <dd>{formatElevationMeters(brief.elevationGain, unitSystem)}</dd>
            </div>
          </dl>
        </OverviewChartTooltip>
      )}
    </div>
  );
}

export function weekLabels(weeks: readonly { weekStartMs: number }[]) {
  return weeks.map((week) =>
    overviewDate(getLocalHappenDayKey(new Date(week.weekStartMs))),
  );
}
