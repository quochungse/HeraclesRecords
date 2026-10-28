import { Suspense, lazy, type CSSProperties } from "react";
import { recoveryTone } from "../parsers";
import { figureColourFor } from "../body/bodyFigureMath";
import { DEFAULT_SHAPE, readFirmness, readPhysique, type Vo2Reading } from "../body/physique";
import { getLocalHappenDayKey } from "../formatters";
import { useFigureSample } from "../body/sampleFigure";
import type { CorosProfile } from "../../../electron/types";
import type { TrainingSummaryMetrics } from "../types";
import { formatDecimal, t } from "../../i18n/core";
import { useI18n } from "../../i18n/useI18n";

// The baked bodies (175 KB) stay out of Overview's chunk; the column's words
// do not wait on them.
const LazyBodyFigure = lazy(() =>
  import("../body/BodyFigure").then(({ BodyFigure }) => ({ default: BodyFigure }))
);

/** COROS's three recovery bands, in its words; a reading still on its way says so. */
function recoveryWord(tone: "low" | "mid" | "high" | "neutral", waiting: boolean): string {
  if (waiting) {
    return t("overview.recovery.reading.label");
  }
  switch (tone) {
    case "high":
      return t("overview.recovery.high.label");
    case "mid":
      return t("overview.recovery.mid.label");
    case "low":
      return t("overview.recovery.low.label");
    default:
      return t("overview.recovery.waiting.label");
  }
}

/**
 * The Readiness panel's first column, Recovery: the athlete's figure lit from
 * the feet up to COROS's recovery %, the figure drawn as the Recovery card drew
 * it (styles.css, `.recovery-figure`), and the reading under its feet. The
 * whole column is the stage, and it is a subgrid of the panel, so the figure
 * takes the rows the Sleep and This week columns lay out beside it, whatever
 * height they come to.
 */
export function TodayPhysique(props: {
  summary: TrainingSummaryMetrics;
  /** The snapshot has not arrived; the reading says it is on its way. */
  loading?: boolean;
  /** The COROS profile, for the figure's sex, height and weight. */
  profile: CorosProfile | null;
  /** The profile has answered, or failed to. Until then no figure is drawn. */
  profileSettled: boolean;
  /** COROS's VO2max by day, which tones the figure (`readFirmness`). */
  vo2Readings: readonly Vo2Reading[];
}) {
  useI18n();
  // A development build's Sample menu can stand in for the profile and the
  // recovery % (sampleFigure.ts); otherwise this is COROS's answer as given.
  const sample = useFigureSample();
  const summary = sample ? { ...props.summary, recoveryPct: sample.recoveryPct } : props.summary;
  const loading = sample ? false : (props.loading ?? false);
  const profile = sample ? sample.profile : props.profile;
  const profileSettled = sample ? true : props.profileSettled;
  const today = getLocalHappenDayKey();
  const vo2Readings = sample
    ? sample.vo2max !== undefined
      ? [{ day: today, value: sample.vo2max }]
      : []
    : props.vo2Readings;
  // Rounded once, so the figure, its colour and its words read one number.
  const percent = Math.round(Math.max(0, Math.min(100, summary.recoveryPct ?? 0)));
  const hasData = percent > 0;
  // The words follow COROS's three bands; the colour runs with the figure.
  const colour = figureColourFor(percent);
  const word = recoveryWord(hasData ? recoveryTone(percent) : "neutral", loading && !hasData);
  const body = readPhysique(profile);
  const firmness = readFirmness(profile, vo2Readings, today);
  const figureDescription = [
    body.shape !== undefined
      ? t("overview.physique.drawnFrom", {
          height: profile?.statureCm ?? "",
          // In the language's own decimal mark: "72,5" in German.
          weight:
            profile?.weightKg !== undefined
              ? formatDecimal(profile.weightKg, Number.isInteger(profile.weightKg) ? 0 : 1)
              : ""
        })
      : null,
    hasData ? t("overview.recovery.percent", { percent }) : word
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <div
      className={`overview-physique training-recovery-panel${colour ? "" : " tone-neutral"}`}
      style={colour ? ({ "--recovery-tone": colour } as CSSProperties) : undefined}
      aria-busy={(loading && !hasData) || undefined}
    >
      <div className="overview-physique-head">
        <p className="eyebrow">{t("overview.recovery.title")}</p>
      </div>
      <div className="overview-physique-stage">
        <div className="recovery-figure" role="img" aria-label={figureDescription}>
          {profileSettled ? (
            <Suspense fallback={null}>
              <LazyBodyFigure
                sex={body.sex}
                shape={body.shape ?? DEFAULT_SHAPE}
                firmness={firmness}
                level={hasData ? percent : undefined}
              />
            </Suspense>
          ) : null}
        </div>
        <p className="overview-physique-reading">
          <span className="figure">{hasData ? `${percent}%` : "–"}</span>
          <span>{word}</span>
        </p>
      </div>
    </div>
  );
}
