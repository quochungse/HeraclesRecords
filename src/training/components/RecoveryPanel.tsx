import { Suspense, lazy, type CSSProperties } from "react";
import { recoveryTone } from "../parsers";
import { figureToneFor, levelInFrame } from "../body/bodyFigureMath";
import { PHYSIQUE_LABEL, readPhysique } from "../body/physique";
import type { CorosProfile } from "../../../electron/types";
import type { TrainingSummaryMetrics } from "../types";

// The baked bodies (175 KB) stay out of Overview's chunk; the panel's words do
// not wait on them.
const LazyBodyFigure = lazy(() =>
  import("../body/BodyFigure").then(({ BodyFigure }) => ({ default: BodyFigure }))
);

/** The level label never climbs so high that its words leave the stage. */
const LEVEL_LABEL_CEILING = 0.8;

interface RecoveryPanelProps {
  summary: TrainingSummaryMetrics;
  /**
   * The snapshot has not arrived. Without it the panel falls to its neutral
   * tone, whose line is "Sync your watch to see live recovery guidance here" —
   * a job for the athlete, handed to them on every launch while the app was
   * mid-request and about to fill the figure in by itself.
   */
  loading?: boolean;
  /** The COROS profile, for the figure's sex, height and weight. */
  profile: CorosProfile | null;
  /** The profile has answered, or failed to. Until then no figure is drawn. */
  profileSettled: boolean;
}

function readinessCopy(
  tone: "low" | "mid" | "high" | "neutral"
): { label: string; message: string } {
  switch (tone) {
    case "high":
      return {
        label: "Ready",
        message:
          "Recovery is strong. You're cleared for a hard session."
      };
    case "mid":
      return {
        label: "Moderate",
        message: "Recovery is climbing back. Keep today's effort easy to moderate."
      };
    case "low":
      return {
        label: "Recover",
        message:
          "Recovery is low. Prioritise rest and sleep before your next hard effort."
      };
    default:
      return {
        label: "Waiting",
        message: "Sync your watch to see live recovery guidance here."
      };
  }
}

export function RecoveryPanel({
  summary,
  loading = false,
  profile,
  profileSettled
}: RecoveryPanelProps) {
  // Rounded once, so the figure, its colour and its words read one number.
  const percent = Math.round(Math.max(0, Math.min(100, summary.recoveryPct ?? 0)));
  const hasData = percent > 0;
  // The words follow COROS's three bands; the colour has a fourth for 100%.
  const tone = figureToneFor(percent);
  const waiting = loading && !hasData;
  const { label, message } = waiting
    ? { label: "Reading", message: "Reading your recovery from COROS…" }
    : readinessCopy(hasData ? recoveryTone(percent) : "neutral");
  const body = readPhysique(profile);
  // Under the figure's feet; where the stage is wide enough to hold them
  // beside the figure, on the fill line instead (halfway up with no level).
  const labelBottom = hasData
    ? Math.min(levelInFrame(percent / 100), LEVEL_LABEL_CEILING)
    : 0.5;
  const figureDescription = [
    body.physique ? `${PHYSIQUE_LABEL[body.physique]} build` : null,
    hasData ? `${percent}% recovery` : label
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <section
      className={`panel training-recovery-panel tone-${tone}`}
      aria-busy={waiting || undefined}
    >
      <div className="training-recovery-header">
        <p className="eyebrow">Your physique</p>
      </div>

      <div className="training-recovery-content">
        <div className="recovery-figure" role="img" aria-label={figureDescription}>
          {profileSettled ? (
            <Suspense fallback={null}>
              <LazyBodyFigure
                sex={body.sex}
                physique={body.physique ?? "medium"}
                level={hasData ? percent : undefined}
                tone={tone}
              />
            </Suspense>
          ) : null}
          <div
            className="recovery-figure-level"
            style={{ "--level-bottom": `${labelBottom * 100}%` } as CSSProperties}
            aria-hidden="true"
          >
            <strong>{hasData ? `${percent}%` : "–"}</strong>
            <span>{label}</span>
          </div>
        </div>

        <p className="training-recovery-message">{message}</p>
      </div>
    </section>
  );
}
