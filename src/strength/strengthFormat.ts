import type { StrengthSession, UnitSystem } from "../../electron/types";
import { kilogramsToDisplayWeight, weightUnit } from "../units/units";
import { formatCount, formatDecimal, getIntlLocale, t } from "../i18n/core";

export function formatSessionDate(startTime?: number): string {
  if (!startTime) {
    return t("strength.unknownDate");
  }
  const date = new Date(startTime * 1000);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(getIntlLocale(), {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" })
  });
}

export function formatSyncTime(value?: string): string {
  if (!value) return t("strength.notSynced");
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? t("strength.notSynced")
    : t("strength.lastSynced", {
        time: date.toLocaleString(getIntlLocale(), {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit"
        })
      });
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
        value: tonnes >= 10 ? formatCount(Math.round(tonnes)) : formatDecimal(tonnes, 1),
        unit: t("strength.unit.tonnes")
      }
    ];
  }
  const display = kilogramsToDisplayWeight(kg, unitSystem);
  return [{ value: formatCount(Math.round(display)), unit: weightUnit(unitSystem) }];
}

/** A single lift keeps its half-kilo; a season's tonnage does not. */
export function liftWeightParts(kg: number, unitSystem: UnitSystem): FigurePart[] {
  const display = kilogramsToDisplayWeight(kg, unitSystem);
  return [
    {
      value: Number.isInteger(display)
        ? formatCount(display)
        : formatDecimal(display, 1),
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
    return [{ value: String(minutes), unit: t("strength.unit.min") }];
  }
  if (minutes === 0) {
    return [{ value: String(hours), unit: t("strength.unit.h") }];
  }
  return [
    { value: String(hours), unit: t("strength.unit.h") },
    { value: String(minutes), unit: t("strength.unit.min") }
  ];
}

/** Compact form of the same duration, for running text: "52 min", "1h 4m". */
export function formatSpan(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  let hours = Math.floor(total / 3600);
  let minutes = Math.round((total % 3600) / 60);
  if (minutes === 60) {
    hours += 1;
    minutes = 0;
  }
  if (hours === 0) {
    return t("units.min", { m: minutes });
  }
  return minutes === 0
    ? t("units.duration.h", { h: hours })
    : t("units.duration.hm", { h: hours, m: minutes });
}

export function cadencePhrase(sessionsPerWeek: number): string {
  if (sessionsPerWeek <= 0) {
    return "";
  }
  if (sessionsPerWeek >= 1) {
    return t("strength.cadence.perWeek", {
      count: Number.isInteger(Math.round(sessionsPerWeek * 10) / 10)
        ? formatCount(Math.round(sessionsPerWeek))
        : formatDecimal(sessionsPerWeek, 1)
    });
  }
  return t("strength.cadence.everyDays", { days: Math.round(7 / sessionsPerWeek) });
}
