import type { StrengthSession, UnitSystem } from "../../electron/types";
import { kilogramsToDisplayWeight, weightUnit } from "../units/units";

export function formatSessionDate(startTime?: number): string {
  if (!startTime) {
    return "Unknown date";
  }
  const date = new Date(startTime * 1000);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" })
  });
}

export function formatSyncTime(value?: string): string {
  if (!value) return "Not synced yet";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Not synced yet"
    : `Last synced ${date.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
      })}`;
}

export function sessionSourceLabel(session: StrengthSession): string | undefined {
  if (session.source === "combined") return "Hevy + COROS";
  if (session.source === "hevy") return "Hevy";
  if (session.source === "coros") return "COROS";
  return undefined;
}

export interface FigurePart {
  value: string;
  unit?: string;
}

/**
 * Big-figure formatting: the number and its unit are separate so the unit can
 * be set smaller and quieter than the digits it belongs to.
 */
export function totalWeightParts(kg: number, unitSystem: UnitSystem): FigurePart[] {
  if (unitSystem === "metric" && kg >= 1000) {
    const tonnes = kg / 1000;
    return [
      {
        value: tonnes >= 10 ? Math.round(tonnes).toLocaleString() : tonnes.toFixed(1),
        unit: "tonnes"
      }
    ];
  }
  const display = kilogramsToDisplayWeight(kg, unitSystem);
  return [{ value: Math.round(display).toLocaleString(), unit: weightUnit(unitSystem) }];
}

/** A single lift keeps its half-kilo; a season's tonnage does not. */
export function liftWeightParts(kg: number, unitSystem: UnitSystem): FigurePart[] {
  const display = kilogramsToDisplayWeight(kg, unitSystem);
  return [
    {
      value: Number.isInteger(display)
        ? display.toLocaleString()
        : display.toFixed(1),
      unit: weightUnit(unitSystem)
    }
  ];
}

export function formatTotalWeight(kg: number, unitSystem: UnitSystem): string {
  return totalWeightParts(kg, unitSystem)
    .map((part) => `${part.value} ${part.unit ?? ""}`.trim())
    .join(" ");
}

export function formatLiftWeight(kg: number, unitSystem: UnitSystem): string {
  return liftWeightParts(kg, unitSystem)
    .map((part) => `${part.value} ${part.unit ?? ""}`.trim())
    .join(" ");
}

export function durationParts(seconds: number): FigurePart[] {
  const total = Math.max(0, Math.round(seconds));
  let hours = Math.floor(total / 3600);
  let minutes = Math.round((total % 3600) / 60);
  if (minutes === 60) {
    hours += 1;
    minutes = 0;
  }
  if (hours === 0) {
    return [{ value: String(minutes), unit: "min" }];
  }
  if (minutes === 0) {
    return [{ value: String(hours), unit: "h" }];
  }
  return [
    { value: String(hours), unit: "h" },
    { value: String(minutes), unit: "min" }
  ];
}

/** Compact form of the same duration, for running text: "52 min", "1h 4m". */
export function formatSpan(seconds: number): string {
  const parts = durationParts(seconds);
  if (parts.length === 1 && parts[0].unit === "min") {
    return `${parts[0].value} min`;
  }
  return parts.map((part) => `${part.value}${part.unit?.charAt(0) ?? ""}`).join(" ");
}

export function cadencePhrase(sessionsPerWeek: number): string {
  if (sessionsPerWeek <= 0) {
    return "";
  }
  if (sessionsPerWeek >= 1) {
    return `About ${sessionsPerWeek.toFixed(1).replace(/\.0$/, "")} a week`;
  }
  return `About one every ${Math.round(7 / sessionsPerWeek)} days`;
}
