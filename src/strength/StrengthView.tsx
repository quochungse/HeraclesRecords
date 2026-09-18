import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FlaskConical,
  Info,
  Link2,
  Loader2,
  LockKeyhole,
  RefreshCw,
  Settings2
} from "lucide-react";
import type { TrainingHubStatus } from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";
import type { SportScreenRequest } from "../training/types";
import { epochMsFromCorosTime } from "../training/activityWindow";
import { StrengthHero } from "./StrengthHero";
import { StrengthHevyDialog } from "./StrengthHevyDialog";
import { ExerciseExplorer } from "./ExerciseExplorer";
import { StrengthOverviewPanels } from "./StrengthOverviewPanels";
import { AGGREGATE_SELECTION, StrengthSessionList } from "./StrengthSessionList";
import {
  StrengthAggregateHeader,
  StrengthAggregateRecords,
  StrengthSessionCoverage,
  StrengthSessionExercises,
  StrengthSessionHeader
} from "./StrengthSessionDetail";
import { analyticsCoverage, buildStrengthSessionIndex, sessionHeat } from "./sessionAnalytics";
import { StrengthVolumeLandmarks } from "./StrengthVolumeLandmarks";
import { StrengthWeeklyChart } from "./StrengthWeeklyChart";
import {
  cadencePhrase,
  durationParts,
  formatSpan,
  liftWeightParts,
  totalWeightParts,
  type FigurePart
} from "./strengthFormat";
import { OptionGroup } from "../components/OptionGroup";
import {
  periodDaysFromValue,
  periodGroupOptions,
  periodValue,
  type PeriodDays
} from "../preferences/periodScale";
import {
  STRENGTH_PERIOD_DAYS,
  WINDOW_OPTIONS,
  activeStrengthWindow,
  useStrengthData
} from "./useStrengthData";
import "./strength.css";
import "./exerciseExplorer.css";
import { useUnitSystem } from "../units/UnitSystemProvider";

interface StrengthViewProps {
  api: CorosLinkApi;
  status: TrainingHubStatus | null;
  onOpenTraining: () => void;
  /** Dev view unlocks the generated sample history. */
  showDevelopmentTools?: boolean;
  /**
   * A session Activities handed over, to be selected rather than merely
   * listed. "Open in Strength" is pressed while looking at that session.
   */
  openRequest?: SportScreenRequest | null;
  /** Taken, so the same session is not re-selected on the next render. */
  onOpenRequestHandled?: () => void;
}

const STRENGTH_PERIOD_OPTIONS = periodGroupOptions(STRENGTH_PERIOD_DAYS);

function Figure({ parts }: { parts: FigurePart[] }) {
  return (
    <p className="strength-figure">
      {parts.map((part) => (
        <span key={`${part.value}-${part.unit ?? ""}`}>
          <strong>{part.value}</strong>
          {part.unit ? <em>{part.unit}</em> : null}
        </span>
      ))}
    </p>
  );
}

export function StrengthView({
  api,
  status,
  onOpenTraining,
  showDevelopmentTools = false,
  openRequest = null,
  onOpenRequestHandled
}: StrengthViewProps) {
  const { unitSystem } = useUnitSystem();
  const corosConnected = Boolean(status?.authenticated);

  const {
    days,
    setDays,
    source,
    setSource,
    hevyStatus,
    hevyStatusLoading,
    hevyConnected,
    anyConnected,
    sessions,
    analytics,
    loading,
    pending,
    error,
    warnings,
    sampleMode,
    setSampleMode,
    runSync,
    connectHevy,
    setHevyWarmups,
    disconnectHevy
  } = useStrengthData({ api, corosConnected, showDevelopmentTools });

  const [hevyDialogOpen, setHevyDialogOpen] = useState(false);
  const [selectedExerciseName, setSelectedExerciseName] = useState<string | null>(null);
  const [pickedSelection, setPickedSelection] = useState<string | null>(null);

  /*
   * A session Activities handed over.
   *
   * The id is picked straight away and the request cleared, without waiting for
   * the history to load: `selection` below already falls back to "All sessions"
   * for an id the index does not hold, so the row selects itself the moment its
   * session arrives. Holding the request instead would need a second piece of
   * state saying whether the load had settled, and `loading` reads false in the
   * gap before the first sync starts.
   *
   * The window is widened first where it has to be. Activities lists the whole
   * history and this screen keeps a window of its own — four weeks, for some
   * athletes — so a session from March would otherwise not be among the ones it
   * is being asked to select from.
   */
  useEffect(() => {
    if (!openRequest) {
      return;
    }

    const startedAt = epochMsFromCorosTime(openRequest.startTime);
    if (startedAt !== undefined) {
      const ageDays = (Date.now() - startedAt) / 86_400_000;
      if (ageDays > days) {
        // The narrowest window that reaches back far enough. None does for a
        // session over a year old, and the window is then left alone rather
        // than widened to no purpose.
        const wider = WINDOW_OPTIONS.find(
          (option) => option.days !== null && option.days >= ageDays
        );
        if (wider?.days != null) {
          setDays(wider.days);
        }
      }
    }

    setPickedSelection(openRequest.activityId);
    onOpenRequestHandled?.();
  }, [days, onOpenRequestHandled, openRequest, setDays]);

  const closeHevyDialog = useCallback(() => setHevyDialogOpen(false), []);

  const selectedExercise = selectedExerciseName
    ? analytics.exercises.find((exercise) => exercise.name === selectedExerciseName) ?? null
    : null;
  const openExercise = useCallback((name: string) => setSelectedExerciseName(name), []);
  const closeExercise = useCallback(() => setSelectedExerciseName(null), []);

  const activeWindow = activeStrengthWindow(days);
  const summary = analytics.summary;
  const hasSessions = summary.sessions > 0;
  const coverage = analyticsCoverage(analytics);
  const attributedSetCount = Math.round(coverage.attributed);
  const genericSetCount = Math.round(coverage.generic);
  const workingSetCount = Math.round(coverage.working);
  // A history of dips and pull-ups carries no load, so the page switches to
  // counting sets rather than showing a column of zeroes.
  const usesWeights = summary.volumeKg > 0;

  // Every session analysed once, rebuilt only when the history itself changes.
  const sessionIndex = useMemo(() => buildStrengthSessionIndex(sessions), [sessions]);
  // "All sessions" is where the screen opens: the window as a whole, with the
  // sessions that make it up listed beside it.
  const selection =
    pickedSelection !== null &&
    (pickedSelection === AGGREGATE_SELECTION || sessionIndex.byId.has(pickedSelection))
      ? pickedSelection
      : AGGREGATE_SELECTION;
  const selectedEntry =
    selection === AGGREGATE_SELECTION ? undefined : sessionIndex.byId.get(selection);
  const explorable = useMemo(
    () => new Set(analytics.exercises.map((exercise) => exercise.name)),
    [analytics.exercises]
  );

  const summaryItems: { key: string; label: string; parts: FigurePart[]; caption: string }[] = [
    {
      key: "sessions",
      label: "Sessions",
      parts: [{ value: String(summary.sessions) }],
      caption: cadencePhrase(summary.sessionsPerWeek) || "Nothing logged yet"
    },
    usesWeights
      ? {
          key: "lifted",
          label: "Weight lifted",
          parts: totalWeightParts(summary.volumeKg, unitSystem),
          caption: `Across ${Math.round(summary.sets).toLocaleString()} sets`
        }
      : {
          key: "sets",
          label: "Sets",
          parts: [{ value: Math.round(summary.sets).toLocaleString() }],
          caption: `${Math.round(summary.reps).toLocaleString()} reps`
        },
    {
      key: "time",
      label: "Time lifting",
      parts: durationParts(summary.durationSec),
      caption: hasSessions
        ? `About ${formatSpan(summary.durationSec / summary.sessions)} a session`
        : "No time logged"
    },
    {
      key: "heaviest",
      label: "Heaviest lift",
      parts: summary.heaviestLift
        ? liftWeightParts(summary.heaviestLift.weightKg, unitSystem)
        : [{ value: "—" }],
      caption: summary.heaviestLift
        ? `${summary.heaviestLift.name} × ${summary.heaviestLift.reps}`
        : "Nothing with weight on it yet"
    }
  ];

  const sampleButton = showDevelopmentTools ? (
    <button
      type="button"
      className="strength-sample-button"
      onClick={() => setSampleMode(true)}
    >
      <FlaskConical size={14} aria-hidden="true" />
      Preview with sample data
    </button>
  ) : null;

  const hevyDialog = hevyDialogOpen ? (
    <StrengthHevyDialog
      status={hevyStatus}
      connected={hevyConnected}
      corosConnected={corosConnected}
      onConnect={connectHevy}
      onSetWarmups={setHevyWarmups}
      onDisconnect={disconnectHevy}
      onClose={closeHevyDialog}
    />
  ) : null;

  // The controls only appear once there is something to control: on the
  // connect screen a window picker and a Refresh button would both be dead.
  const renderHeader = (withControls: boolean) => (
    <header className="strength-header">
      <div className="strength-title">
        <h2>Strength</h2>
        <p>
          {!withControls
            ? "Your lifting, muscle by muscle."
            : hasSessions
              ? `You trained ${summary.sessions} ${
                  summary.sessions === 1 ? "time" : "times"
                } in ${activeWindow.phrase}.`
              : `Your lifting from ${activeWindow.phrase}, muscle by muscle.`}
        </p>
      </div>
      <div className="strength-header-controls">
        {withControls ? (
          <>
          <OptionGroup
            label="Strength source"
            value={source}
            options={[
              {
                value: "combined",
                label: "Combined",
                disabled: !(corosConnected && hevyConnected)
              },
              { value: "hevy", label: "Hevy", disabled: !hevyConnected },
              { value: "coros", label: "COROS", disabled: !corosConnected }
            ]}
            onChange={setSource}
          />
          {/* Folded: four windows, and the source picker beside it already
              spends the header's width. The source stays open because it
              decides what the screen is about, which is the distinction this
              screen drew for itself in colour and now draws in shape. */}
          <OptionGroup
            label="Time covered"
            mode="collapsible"
            tone="quiet"
            value={periodValue(days as PeriodDays)}
            options={STRENGTH_PERIOD_OPTIONS}
            onChange={(next) => setDays(periodDaysFromValue(next) ?? 90)}
          />
          </>
        ) : null}
        <div className="strength-header-actions">
          {withControls ? (
            <button
              type="button"
              className="strength-action"
              disabled={loading || sampleMode}
              onClick={() => void runSync(true)}
            >
              {loading ? (
                <Loader2 className="spin" size={14} aria-hidden="true" />
              ) : (
                <RefreshCw size={14} aria-hidden="true" />
              )}
              Refresh
            </button>
          ) : null}
          <button
            type="button"
            className="strength-action"
            onClick={() => setHevyDialogOpen(true)}
          >
            {hevyConnected ? (
              <>
                <span className="strength-hevy-dot" aria-hidden="true" />
                <Settings2 size={14} aria-hidden="true" />
                Hevy
              </>
            ) : (
              <>
                <Link2 size={14} aria-hidden="true" />
                Connect Hevy
              </>
            )}
          </button>
        </div>
      </div>
    </header>
  );

  if (hevyStatusLoading && !corosConnected && !sampleMode) {
    return (
      <section className="strength-view">
        {renderHeader(false)}
        <p className="strength-notice" role="status">
          <Loader2 className="spin" size={14} aria-hidden="true" />
          Checking strength connections…
        </p>
        {hevyDialog}
      </section>
    );
  }

  if (!anyConnected && !sampleMode) {
    return (
      <section className="strength-view">
        {renderHeader(false)}

        <section className="panel strength-card strength-connect">
          <span className="strength-connect-icon" aria-hidden="true">
            <LockKeyhole size={22} />
          </span>
          <h3>Connect a strength source</h3>
          <p>
            Import completed workouts from Hevy, read sessions from COROS
            Training Hub, or connect both for one combined history.
          </p>
          <div className="strength-connect-actions">
            <button
              type="button"
              className="primary-button"
              onClick={() => setHevyDialogOpen(true)}
            >
              <Link2 size={16} aria-hidden="true" />
              Connect Hevy
            </button>
            <button type="button" className="secondary-button" onClick={onOpenTraining}>
              Open Overview
            </button>
          </div>
        </section>

        {sampleButton ? (
          <div className="strength-sample-cta">{sampleButton}</div>
        ) : null}
        {hevyDialog}
      </section>
    );
  }

  return (
    <section className="strength-view">
      {renderHeader(true)}
      {hevyDialog}

      {sampleMode ? (
        <p className="strength-notice is-sample" role="status">
          <FlaskConical size={14} aria-hidden="true" />
          Showing generated sample data, not your training.
          <button type="button" onClick={() => setSampleMode(false)}>
            Exit preview
          </button>
        </p>
      ) : null}

      {error && !sampleMode ? (
        <p className="strength-notice is-error" role="alert">
          {error}
        </p>
      ) : null}

      {!sampleMode
        ? warnings.map((warning) => (
            <p className="strength-notice is-warning" role="status" key={warning}>
              {warning} Showing the most recent cached workouts instead.
            </p>
          ))
        : null}

      {pending > 0 && !sampleMode ? (
        <p className="strength-notice" role="status">
          <Loader2 className="spin" size={14} aria-hidden="true" />
          Reading {pending} more session{pending === 1 ? "" : "s"} from COROS.
          The map fills in as they arrive.
        </p>
      ) : null}

      {hasSessions && genericSetCount > 0 ? (
        <p className="strength-notice is-attribution" role="note">
          <Info size={15} aria-hidden="true" />
          <span>
            {`COROS recorded ${genericSetCount.toLocaleString()} working ${
              genericSetCount === 1 ? "set" : "sets"
            } only as Full Body, so ${genericSetCount === 1 ? "it is" : "they are"} excluded from the map. Specific attribution is available for ${attributedSetCount.toLocaleString()} of ${workingSetCount.toLocaleString()} working sets.`}
          </span>
        </p>
      ) : null}

      {sampleButton && !sampleMode ? (
        <div className="strength-sample-cta">{sampleButton}</div>
      ) : null}

      {!hasSessions ? (
        <section className="panel strength-card strength-blank">
          <h3>No strength sessions in {activeWindow.phrase}</h3>
          <p>
            Sessions appear here a few minutes after they sync from your watch.
            Try a longer stretch of time if you know you&apos;ve been lifting.
          </p>
        </section>
      ) : (
        <>
          <section className="strength-summary" aria-label="Your training so far">
            {summaryItems.map((item) => (
              <div key={item.key} className="strength-summary-item">
                <p className="strength-summary-label">{item.label}</p>
                <Figure parts={item.parts} />
                <p className="strength-summary-caption">{item.caption}</p>
              </div>
            ))}
          </section>

          <div className="strength-split">
            <aside className="panel strength-card strength-split-list">
              <StrengthSessionList
                sessions={sessions}
                index={sessionIndex}
                selected={selection}
                onSelect={setPickedSelection}
                windowLabel={activeWindow.label}
                showSource={source === "combined"}
              />
            </aside>
            <div className="strength-split-detail">
              {/*
               * Four slots in a fixed order. Only the first and last change type
               * between a session and "All sessions", so the body map in the
               * second keeps its WebGL renderer across every selection.
               */}
              <article
                className="strength-session-detail"
                aria-label={selectedEntry ? "Session detail" : "All sessions"}
              >
                {selectedEntry ? (
                  <StrengthSessionHeader
                    entry={selectedEntry}
                    showSource={source === "combined"}
                  />
                ) : (
                  <StrengthAggregateHeader
                    sessionCount={sessions.length}
                    windowLabel={activeWindow.label}
                    windowPhrase={activeWindow.phrase}
                  />
                )}
                <StrengthHero
                  analytics={selectedEntry?.analytics ?? analytics}
                  source={source}
                  showDevelopmentTools={showDevelopmentTools}
                  scope={selectedEntry ? "session" : "window"}
                  resolveHeat={
                    selectedEntry ? (metric) => sessionHeat(selectedEntry, metric) : undefined
                  }
                />
                {selectedEntry ? <StrengthSessionCoverage entry={selectedEntry} /> : null}
                {selectedEntry ? (
                  <StrengthSessionExercises
                    entry={selectedEntry}
                    explorable={explorable}
                    onOpenExercise={openExercise}
                  />
                ) : (
                  <StrengthAggregateRecords
                    sessions={sessions}
                    index={sessionIndex}
                    windowPhrase={activeWindow.phrase}
                    onSelectSession={setPickedSelection}
                  />
                )}
              </article>
            </div>
          </div>

          <StrengthWeeklyChart
            weeks={analytics.weeks}
            days={days}
            usesWeights={usesWeights}
          />

          <StrengthVolumeLandmarks analytics={analytics} windowDays={days} />

          <StrengthOverviewPanels
            analytics={analytics}
            onOpenExercise={openExercise}
          />
        </>
      )}
      {selectedExercise ? (
        <ExerciseExplorer
          exercise={selectedExercise}
          exercises={analytics.exercises}
          sessions={sessions}
          unitSystem={unitSystem}
          onSelect={openExercise}
          onClose={closeExercise}
        />
      ) : null}
    </section>
  );
}
