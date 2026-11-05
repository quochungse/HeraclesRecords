import type { ReactNode } from "react";
import type { ShareBrandPosition, ShareMapStyle } from "./shareTypes";

/** The six logo places, drawn as a frame with a dot where the logo goes. */
export function BrandPositionIcon({ position }: { position: ShareBrandPosition }) {
  const x = position.endsWith("l") ? 4.5 : position.endsWith("r") ? 11.5 : 8;
  const y = position.startsWith("t") ? 4.5 : 13.5;
  return (
    <svg viewBox="0 0 16 18" width={16} height={18} aria-hidden="true">
      <rect x={1.5} y={1.5} width={13} height={15} rx={1.5} fill="none" stroke="currentColor" strokeWidth={1.2} />
      <circle cx={x} cy={y} r={1.8} fill="currentColor" />
    </svg>
  );
}

interface MapThumbPalette {
  land: string;
  park: string;
  water: string;
  road: string;
  casing: string;
  contour?: string;
}

/** Each map style's own colours, near enough to tell the three apart at a glance. */
const MAP_THUMB_PALETTES: Readonly<Record<ShareMapStyle, MapThumbPalette>> = {
  dark: { land: "#16181d", park: "#1b2621", water: "#0d1b29", road: "#454b55", casing: "#202329" },
  light: { land: "#f3f1ec", park: "#e1e9d6", water: "#c7dbe6", road: "#ffffff", casing: "#d8d3c8" },
  topo: { land: "#f2eedb", park: "#cfe2ad", water: "#9cc5e3", road: "#f4b26a", casing: "#c4864a", contour: "#c9a77a" }
};

const THUMB_ROADS = ["M-2 15 C 20 19, 44 8, 98 22", "M60 -2 C 54 16, 68 30, 62 50"];
const THUMB_CONTOURS = ["M-2 6 C 16 2, 30 12, 50 6 S 80 0, 98 8", "M-2 26 C 18 20, 36 30, 58 24 S 84 32, 98 28", "M20 50 C 30 40, 50 44, 70 38 S 90 44, 98 40"];

/** A map style's look, small: a picture of the ground it gives, not a map of anywhere. */
export function MapStyleThumb({ style }: { style: ShareMapStyle }) {
  const palette = MAP_THUMB_PALETTES[style];
  return (
    <svg className="share-bg-fill" viewBox="0 0 96 48" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect width={96} height={48} fill={palette.land} />
      <path d="M64 -1 L97 -1 L97 18 C 86 22, 74 16, 66 10 Z" fill={palette.park} />
      <path d="M-1 31 C 14 26, 22 37, 34 35 S 50 40, 54 49 L -1 49 Z" fill={palette.water} />
      {palette.contour
        ? THUMB_CONTOURS.map((d) => <path key={d} d={d} fill="none" stroke={palette.contour} strokeWidth={0.7} />)
        : null}
      {THUMB_ROADS.map((d) => (
        <path key={`${d}-casing`} d={d} fill="none" stroke={palette.casing} strokeWidth={4} />
      ))}
      {THUMB_ROADS.map((d) => (
        <path key={d} d={d} fill="none" stroke={palette.road} strokeWidth={2.4} />
      ))}
    </svg>
  );
}

export function Swatch({ color }: { color: string }) {
  return <span className="share-swatch" style={{ background: color }} aria-hidden="true" />;
}

interface ShareSwitchProps {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}

/** An on/off row: the checkbox itself drawn as a switch, so its focus ring is its own. */
export function ShareSwitch({ id, label, hint, checked, disabled, onChange }: ShareSwitchProps) {
  return (
    <label className="share-switch" htmlFor={id}>
      <span className="share-switch-text">
        <span>{label}</span>
        {hint ? <small>{hint}</small> : null}
      </span>
      <input
        id={id}
        type="checkbox"
        role="switch"
        checked={checked && !disabled}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}

interface ShareRangeProps {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}

export function ShareRange({ id, label, value, min, max, onChange }: ShareRangeProps) {
  return (
    <label className="share-range" htmlFor={id}>
      <span>{label}</span>
      <input id={id} type="range" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} />
      <output htmlFor={id}>{value}%</output>
    </label>
  );
}

export function ShareSection({ title, aside, children }: { title: string; aside?: string; children: ReactNode }) {
  return (
    <section className="share-section">
      <h3>
        {title}
        {aside ? <span>{aside}</span> : null}
      </h3>
      {children}
    </section>
  );
}
