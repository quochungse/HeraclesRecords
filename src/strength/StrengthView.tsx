import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Info,
  Link2,
  Loader2,
  LockKeyhole,
  RefreshCw,
  Settings2
} from "lucide-react";
import type { CoachOpenRequest, TrainingHubStatus } from "../../electron/types";
import type { HeraclesRecordsApi } from "../heraclesrecords-api";
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
import { formatCount, plural, t } from "../i18n/core";
import { exerciseLabel } from "./strengthAnalytics";

interface StrengthViewProps {
  api: HeraclesRecordsApi;
  status: TrainingHubStatus | null;
  onOpenTraining: () => void;
  /** Dev view unlocks the muscle map's layer controls. */
  showDevelopmentTools?: boolean;
  /** Generated sample history, switched from the developer toolbar. */
  sampleMode?: boolean;
  /**
   * A session Activities handed over, to be selected rather than merely
   * listed. "Open in Strength" is pressed while looking at that session.
   */
  openRequest?: SportScreenRequest | null;
  /** Taken, so the same session is not re-selected on the next render. */
  onOpenRequestHandled?: () => void;
  /** Asks Coach about the session open, as the Calendar's Ask Coach does. */
  onAskCoach?: (request: CoachOpenRequest) => void;
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
  sampleMode: sampleModeRequested = false,
  openRequest = null,
  onOpenRequestHandled,
  onAskCoach
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
    initializing,
    pending,
    error,
    warnings,
    sampleMode,
    runSync,
    connectHevy,
    setHevyWarmups,
    disconnectHevy
  } = useStrengthData({ api, corosConnected, sampleMode: sampleModeRequested });

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
  // An empty history and a history that has not arrived look identical from
  // here, and only one of them is worth a headline. See `initializing`.
  const awaitingFirstSessions = !hasSessions && (initializing || loading);
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
      label: t("strength.summary.sessions"),
      parts: [{ value: String(summary.sessions) }],
      caption: cadencePhrase(summary.sessionsPerWeek) || t("strength.summary.nothing")
    },
    usesWeights
      ? {
          key: "lifted",
          label: t("strength.summary.lifted"),
          parts: totalWeightParts(summary.volumeKg, unitSystem),
          caption: plural("strength.summary.acrossSets", Math.round(summary.sets))
        }
      : {
          key: "sets",
          label: t("strength.summary.sets"),
          parts: [{ value: formatCount(Math.round(summary.sets)) }],
          caption: plural("strength.reps", Math.round(summary.reps))
        },
    {
      key: "time",
      label: t("strength.summary.time"),
      parts: durationParts(summary.durationSec),
      caption: hasSessions
        ? t("strength.summary.perSession", { time: formatSpan(summary.durationSec / summary.sessions) })
        : t("strength.summary.noTime")
    },
    {
      key: "heaviest",
      label: t("strength.summary.heaviest"),
      parts: summary.heaviestLift
        ? liftWeightParts(summary.heaviestLift.weightKg, unitSystem)
        : [{ value: "—" }],
      caption: summary.heaviestLift
        ? `${exerciseLabel(summary.heaviestLift.name)} × ${summary.heaviestLift.reps}`
        : t("strength.summary.noWeight")
    }
  ];

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
        <h2>{t("nav.strength")}</h2>
        <p>
          {!withControls
            ? t("strength.lead")
            : hasSessions
              ? plural("strength.trained", summary.sessions, { window: activeWindow.phrase })
              : awaitingFirstSessions
                ? t("strength.readingWindow", { window: activeWindow.phrase })
                : t("strength.leadWindow", { window: activeWindow.phrase })}
        </p>
      </div>
      <div className="strength-header-controls">
        {withControls ? (
          <>
          {/* Both folded. Seven chips between them is more than this header
              has room for, and neither is read often: the source is set once
              per athlete and the window once per session. Folded, each reads
              as what it currently is — which is what a header is for. */}
          <OptionGroup
            label={t("strength.source")}
            mode="collapsible"
            value={source}
            options={[
              {
                value: "combined",
                label: t("strength.combined"),
                disabled: !(corosConnected && hevyConnected)
              },
              { value: "hevy", label: "Hevy", disabled: !hevyConnected },
              { value: "coros", label: "COROS", disabled: !corosConnected }
            ]}
            onChange={setSource}
          />
          <OptionGroup
            label={t("strength.timeCovered")}
            mode="collapsible"
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
              {t("common.refresh")}
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
                {t("strength.connectHevy")}
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
          {t("strength.checking")}
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
          <h3>{t("strength.connect.title")}</h3>
          <p>{t("strength.connect.body")}</p>
          <div className="strength-connect-actions">
            <button
              type="button"
              className="primary-button"
              onClick={() => setHevyDialogOpen(true)}
            >
              <Link2 size={16} aria-hidden="true" />
              {t("strength.connectHevy")}
            </button>
            <button type="button" className="secondary-button" onClick={onOpenTraining}>
              {t("common.openOverview")}
            </button>
          </div>
        </section>

        {hevyDialog}
      </section>
    );
  }

  return (
    <section className="strength-view">
      {renderHeader(true)}
      {hevyDialog}

      {error && !sampleMode ? (
        <p className="strength-notice is-error" role="alert">
          {error}
        </p>
      ) : null}

      {!sampleMode
        ? warnings.map((warning) => (
            <p className="strength-notice is-warning" role="status" key={warning}>
              {t("strength.cachedInstead", { warning })}
            </p>
          ))
        : null}

      {pending > 0 && !sampleMode ? (
        <p className="strength-notice" role="status">
          <Loader2 className="spin" size={14} aria-hidden="true" />
          {plural("strength.pending", pending)}
        </p>
      ) : null}

      {hasSessions && genericSetCount > 0 ? (
        <p className="strength-notice is-attribution" role="note">
          <Info size={15} aria-hidden="true" />
          <span>
            {plural("strength.fullBodyExcluded", genericSetCount, {
              attributed: formatCount(attributedSetCount),
              working: formatCount(workingSetCount)
            })}
          </span>
        </p>
      ) : null}

      {awaitingFirstSessions ? (
        <section className="panel strength-card strength-blank" aria-busy="true">
          <h3>
            <Loader2 className="spin" size={16} aria-hidden="true" />
            {t("strength.reading.title")}
          </h3>
          <p>
            {t(`strength.reading.${source === "hevy" ? "hevy" : source === "coros" ? "coros" : "combined"}` as const, {
              window: activeWindow.phrase
            })}
          </p>
        </section>
      ) : !hasSessions ? (
        <section className="panel strength-card strength-blank">
          <h3>{t("strength.none.title", { window: activeWindow.phrase })}</h3>
          <p>{t("strength.none.body")}</p>
        </section>
      ) : (
        <>
          <section className="strength-summary" aria-label={t("strength.summaryLabel")}>
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
                aria-label={selectedEntry ? t("strength.sessionDetail") : t("strength.allSessions")}
              >
                {selectedEntry ? (
                  <StrengthSessionHeader
                    entry={selectedEntry}
                    showSource={source === "combined"}
                    onAskCoach={onAskCoach}
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
