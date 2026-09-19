import { AlertCircle, ChevronLeft, ChevronRight, Play } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WorkoutExerciseOption } from "../../electron/types";
import { MUSCLE_BY_ID, resolveExerciseTargets } from "../strength/muscles";

interface ExercisePreviewProps {
  option?: WorkoutExerciseOption;
  /** Resolved display name; drives both the heading and the muscle lookup. */
  name: string;
  /** Show which muscles the movement trains, from the anatomy rule set. */
  showTargets?: boolean;
  /**
   * Start the clip as it mounts.
   *
   * The default follows the viewer's reduced-motion setting, because the
   * editor puts this on screen the moment an exercise is chosen rather than
   * on request. The Calendar's workout view passes `true`: there the clip is
   * behind a click, so it has already been asked for, and a demonstration the
   * viewer opened and then has to press play on is a control for nothing.
   *
   * Looping is not gated either way — a one-second clip that stops after one
   * pass shows the movement once and then a frozen figure — and a click on
   * the plate stops it, which is the escape reduced motion is owed.
   */
  autoPlay?: boolean;
  className?: string;
}

/** Muscles within this much of the top share are the movement's prime movers. */
const PRIMARY_SHARE_TOLERANCE = 0.02;
const MAX_LISTED_MUSCLES = 6;

/**
 * The movement plate: a demonstration clip, one angle at a time, plus what the
 * movement trains. COROS ships the clips on a white cyclorama, so the stage is
 * a light plate rather than a dark well — the video meets its own background
 * instead of a letterbox.
 */
export function ExercisePreview({
  option,
  name,
  showTargets = false,
  autoPlay,
  className = ""
}: ExercisePreviewProps) {
  const reducedMotion = useReducedMotion();
  const startsPlaying = autoPlay ?? !reducedMotion;
  const videoRef = useRef<HTMLVideoElement>(null);
  const [angleIndex, setAngleIndex] = useState(0);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [paused, setPaused] = useState(true);

  const angles = useMemo(
    () => option?.media?.filter((entry) => entry.videoUrl) ?? [],
    [option]
  );
  const angle = angles[angleIndex] ?? angles[0];

  const targets = useMemo(
    () => (showTargets ? resolveExerciseTargets(name) : undefined),
    [name, showTargets]
  );
  const muscles = useMemo(() => {
    const activations = targets?.activations ?? [];
    if (activations.length === 0) return [];
    const top = Math.max(...activations.map((entry) => entry.share));
    return activations.slice(0, MAX_LISTED_MUSCLES).map((entry) => ({
      id: entry.muscle,
      label: MUSCLE_BY_ID[entry.muscle].label,
      anatomy: MUSCLE_BY_ID[entry.muscle].anatomy,
      isPrime: entry.share >= top - PRIMARY_SHARE_TOLERANCE
    }));
  }, [targets]);

  useEffect(() => {
    setAngleIndex(0);
    setStatus("loading");
  }, [option?.id]);

  useEffect(() => {
    setStatus("loading");
  }, [angle?.videoUrl]);

  /**
   * The clip carries no browser control bar — it is a loop of a movement, not
   * a film, and the bar sat across the bottom third of the plate with a
   * scrubber for a one-second clip. The plate itself is the control: click to
   * play or pause, with the glyph shown only while it is stopped.
   *
   * It stays a real button so it can be reached by keyboard, which the control
   * bar was previously the only way to do.
   */
  const togglePlayback = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      // A play() that the browser refuses rejects; nothing here depends on it
      // succeeding, and the paused state follows the element either way.
      void video.play().catch(() => undefined);
    } else {
      video.pause();
    }
  }, []);

  if (!angle?.videoUrl) return null;

  return (
    <section
      className={`exercise-preview ${className}`.trim()}
      aria-label={`${name || "Exercise"} demonstration`}
    >
      <div className="exercise-preview-stage">
        {status === "loading" ? (
          <div className="exercise-preview-status" role="status">
            <span className="exercise-preview-spinner" aria-hidden="true" />
            <strong>Loading demonstration</strong>
          </div>
        ) : null}
        {status === "error" ? (
          <div className="exercise-preview-status is-error" role="alert">
            <AlertCircle size={20} aria-hidden="true" />
            <strong>Demonstration unavailable</strong>
            {angles.length > 1 ? <span>Try another angle.</span> : null}
          </div>
        ) : null}
        <video
          key={angle.videoUrl}
          ref={videoRef}
          className={status === "ready" ? "is-ready" : ""}
          src={angle.videoUrl}
          poster={angle.coverUrl ?? option?.thumbnailUrl}
          autoPlay={startsPlaying}
          muted
          loop
          playsInline
          preload="metadata"
          onLoadedData={() => setStatus("ready")}
          onError={() => setStatus("error")}
          onPlay={() => setPaused(false)}
          onPause={() => setPaused(true)}
          aria-label={`${name || "Exercise"} demonstration, angle ${angleIndex + 1} of ${angles.length}`}
        />
        {status === "ready" ? (
          <button
            type="button"
            className={`exercise-preview-toggle ${paused ? "is-paused" : ""}`}
            aria-label={paused ? "Play demonstration" : "Pause demonstration"}
            onClick={togglePlayback}
          >
            <span className="exercise-preview-play" aria-hidden="true">
              <Play size={20} strokeWidth={2.4} />
            </span>
          </button>
        ) : null}
      </div>

      {angles.length > 1 ? (
        <div className="exercise-preview-angles">
          <button
            type="button"
            aria-label="Show previous angle"
            onClick={() => setAngleIndex((current) => (current - 1 + angles.length) % angles.length)}
          >
            <ChevronLeft size={15} aria-hidden="true" />
          </button>
          <span aria-live="polite">Angle {angleIndex + 1} of {angles.length}</span>
          <button
            type="button"
            aria-label="Show next angle"
            onClick={() => setAngleIndex((current) => (current + 1) % angles.length)}
          >
            <ChevronRight size={15} aria-hidden="true" />
          </button>
        </div>
      ) : null}

      {showTargets && targets?.mobility ? (
        <p className="exercise-preview-note">Mobility work. It carries no training load.</p>
      ) : null}

      {showTargets && muscles.length > 0 ? (
        <div className="exercise-preview-targets">
          <h5>Trains</h5>
          <ul>
            {muscles.map((muscle) => (
              <li key={muscle.id} className={muscle.isPrime ? "is-prime" : ""} title={muscle.anatomy}>
                {muscle.label}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
