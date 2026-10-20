import type { CSSProperties } from "react";
import type { SessionIntensity } from "../../../electron/types";
import { formatDecimal, t, type MessageKey } from "../../i18n/core";
import { useI18n } from "../../i18n/useI18n";
import { zoneName } from "../../i18n/zoneNames";
import { formatDurationSpan } from "../formatters";
import {
  TRAINING_BENEFITS,
  trainingBenefit,
  type BenefitZoneFamily,
  type RepSize,
  type SessionFormat,
  type TrainingBenefit,
  type TrainingBenefitReading
} from "../trainingBenefit";
import { zoneNamesFor } from "../zoneTime";
import { zoneColor } from "./routeColoring";

const BENEFIT_KEYS: Readonly<Record<TrainingBenefit, MessageKey>> = {
  recovery: "activity.benefit.recovery",
  aerobic: "activity.benefit.aerobic",
  tempo: "activity.benefit.tempo",
  threshold: "activity.benefit.threshold",
  vo2max: "activity.benefit.vo2max",
  anaerobic: "activity.benefit.anaerobic"
};

const MEASURE_KEYS: Readonly<Record<"pace" | "hr" | "both", MessageKey>> = {
  pace: "activity.benefit.measure.pace",
  hr: "activity.benefit.measure.hr",
  both: "activity.benefit.measure.both"
};

export function trainingBenefitName(benefit: TrainingBenefit): string {
  return t(BENEFIT_KEYS[benefit]);
}

/**
 * A benefit's zone, by the name its rank carries on COROS's reserve and pace
 * scales — the names Daniels' paces line up with, whatever model numbers the
 * account's heart-rate zones.
 */
function rankZoneName(benefit: TrainingBenefit): string {
  const rank = TRAINING_BENEFITS.indexOf(benefit);
  const label = zoneNamesFor("restingHr")?.[rank];
  return label ? zoneName(label) : t("overview.zones.zone", { n: rank + 1 });
}

/** "8′", "1′30″", "20″"; "400 m", "1.6 km". Metric, as reps are set on a track. */
function formatRepSize(size: RepSize): string {
  if (size.unit === "meters") {
    return size.value >= 1000
      ? `${formatDecimal(Math.round(size.value / 100) / 10, 1).replace(/[.,]0$/, "")} km`
      : `${Math.max(50, Math.round(size.value / 50) * 50)} m`;
  }
  if (size.value < 60) return `${Math.round(size.value)}″`;
  const seconds = Math.round(size.value / 5) * 5;
  const rest = seconds % 60;
  const minutes = (seconds - rest) / 60;
  return rest === 0 ? `${minutes}′` : `${minutes}′${String(rest).padStart(2, "0")}″`;
}

export function sessionFormatText(format: SessionFormat): string {
  if (format.kind === "long") {
    return t(format.ride ? "activity.benefit.format.longRide" : "activity.benefit.format.longRun");
  }
  return t(
    format.kind === "strides" ? "activity.benefit.format.strides" : "activity.benefit.format.intervals",
    { count: format.count, size: formatRepSize(format.size) }
  );
}

/** Which seconds the label was read from, in words. */
export function trainingBenefitReason(reading: TrainingBenefitReading): string {
  const { basis, primary } = reading;
  const measure = t(MEASURE_KEYS[basis.measure]);
  if (basis.kind === "reps") {
    return t("activity.benefit.reason.reps", { count: basis.count, zone: rankZoneName(primary), measure });
  }
  const percent = Math.round(basis.share * 100);
  if (primary === "recovery") {
    return t("activity.benefit.reason.recovery", { percent, zone: rankZoneName("recovery"), measure });
  }
  if (primary === "aerobic") {
    return t("activity.benefit.reason.easy", { percent, zone: rankZoneName("tempo"), measure });
  }
  return t("activity.benefit.reason.up", {
    time: formatDurationSpan(basis.seconds),
    zone: rankZoneName(primary),
    percent,
    measure
  });
}

/**
 * One benefit, in the colour of the zone its rank stands for, so Threshold is
 * one colour on every account whichever model numbers its zones.
 */
export function TrainingBenefitChip({ benefit }: { benefit: TrainingBenefit }) {
  useI18n();
  const name = trainingBenefitName(benefit);
  return (
    <span
      className="benefit-chip"
      style={{ "--zone-color": zoneColor(TRAINING_BENEFITS.indexOf(benefit)) } as CSSProperties}
      title={t("activity.benefit.primaryTitle", { benefit: name })}
    >
      {name}
    </span>
  );
}

/** The session's shape — Intervals 3 × 8′, Strides 5 × 20″, Long run — outlined beside the benefit. */
export function SessionFormatChip({ format }: { format: SessionFormat }) {
  useI18n();
  return (
    <span className="benefit-chip is-format" title={t("activity.benefit.formatTitle")}>
      {sessionFormatText(format)}
    </span>
  );
}

/** The benefit and the session's shape, as one pair wherever a session is labelled. */
export function TrainingBenefitChips({ reading }: { reading: TrainingBenefitReading }) {
  return (
    <>
      <TrainingBenefitChip benefit={reading.primary} />
      {reading.format ? <SessionFormatChip format={reading.format} /> : null}
    </>
  );
}

/** A list row's label, from its stored intensity — or nothing, as `trainingBenefit` decides. */
export function ActivityBenefitChips({
  sportType,
  intensity,
  family
}: {
  sportType: number | undefined;
  intensity: SessionIntensity | undefined;
  family: BenefitZoneFamily | undefined;
}) {
  const reading = trainingBenefit(sportType, intensity, family);
  return reading ? <TrainingBenefitChips reading={reading} /> : null;
}

/** "Threshold: 3 reps in the Threshold zone, read on pace" — under the zones it was read from. */
export function TrainingBenefitReason({ reading }: { reading: TrainingBenefitReading }) {
  useI18n();
  return (
    <p className="benefit-reason">
      {t("activity.benefit.why", {
        benefit: trainingBenefitName(reading.primary),
        reason: trainingBenefitReason(reading)
      })}
    </p>
  );
}
