import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import {
  BookOpen,
  ChevronRight,
  MessageCircle,
  PanelRightClose,
  Trash2,
  X
} from "lucide-react";
import type {
  PlanArtifactVersion,
  PlanDraftPreview,
  PlanDraftSaveOptions,
  PlanRef,
  TrainingPlanDestination,
  TrainingPlanDocument
} from "../../electron/types";
import { planDiff } from "../../electron/planDiff";
import type { CorosLinkApi } from "../coroslink-api";
import { OptionGroup } from "../components/OptionGroup";
import { useUnitSystem } from "../units/UnitSystemProvider";
import { WeekCard } from "../training-library/PlanReader";
import { PlanSessionView } from "../training-library/PlanSessionView";
import { PlanWeekRidge } from "../training-library/PlanWeekRidge";
import { planSessions, readPlan } from "../training-library/planReaderModel";
import { sportTheme } from "../training-library/sportTheme";
import "../training-library/trainingLibrary.css";
import { creationFigures, datedForReading } from "./CoachCreationCard";
import { CreationActions } from "./CreationActions";
import type { CreationCalendar } from "./creationCalendar";
import { creationStatus } from "./creationChoices";
import { isOnCoros, supersededLine, type CreationVersion } from "./creationVersions";

/**
 * The canvas (docs/coach-plan-canvas.md, P1.4): the index of what Coach has
 * made in this conversation, in a column beside it that keeps its width, and
 * — when one is opened — that creation's details on a screen of their own.
 * The details used to open inside the column, which widened to hold a plan's
 * seven-day weeks and squeezed the conversation for as long as it was open;
 * a dialog gives the weeks the width they need and gives it back on close.
 *
 * The details read with the Library reader's own pieces: the ridge, the week
 * cards with their seven columns, the session view. They edit nothing — the
 * editor is the one place a creation changes (D10) — and the buttons come
 * from `artifactActions`, the function the card's come from (D9).
 *
 * Loaded when first opened, with the library's stylesheet the week cards are
 * drawn by, as the plan editor is.
 */
export default function CoachCanvas({
  api,
  listOpen,
  artifactId,
  creations,
  cards,
  versionIndex,
  documentFor,
  uploadingDraftId,
  editingDraftId,
  onOpen,
  onCloseList,
  onCloseDetails,
  onUpload,
  onEdit,
  onRestore,
  onRemove,
  onViewInChat,
  onCalendar,
  calendarOf,
  onAsk,
  planSportStyle
}: {
  api?: CorosLinkApi;
  /** Whether the index column is shown. */
  listOpen: boolean;
  /** Any version's draft id of the creation whose details are open, or null. */
  artifactId: string | null;
  /** The newest version of each creation, in the order they were made. */
  creations: PlanDraftPreview[];
  /** Every card still in the conversation, older versions included. */
  cards: PlanDraftPreview[];
  versionIndex: ReadonlyMap<string, CreationVersion>;
  documentFor: (draftId: string) => TrainingPlanDocument | null | undefined;
  uploadingDraftId: string | null;
  /** The creation whose editor is open, whose way on is back into it. */
  editingDraftId?: string | null;
  onOpen: (draftId: string) => void;
  onCloseList: () => void;
  onCloseDetails: () => void;
  onUpload: (
    draftId: string,
    destination: TrainingPlanDestination,
    scheduleDate?: string,
    keepInLibrary?: boolean,
    options?: PlanDraftSaveOptions
  ) => void;
  onEdit?: (draftId: string) => void;
  onRestore?: (draftId: string) => void;
  onRemove: (draftId: string) => void;
  onViewInChat: (draftId: string) => void;
  /** Opens the calendar dialog for a version. */
  onCalendar?: (draftId: string) => void;
  /** Where a creation stands on the calendar, by any version's draft id. */
  calendarOf?: (draftId: string) => CreationCalendar | undefined;
  /** Puts what the athlete pointed at beside the composer (P1.7). */
  onAsk?: (ref: PlanRef) => void;
  planSportStyle: (sport: PlanDraftPreview["entries"][number]["sport"]) => CSSProperties;
}) {
  const open = artifactId ? creationOf(artifactId, creations, versionIndex) : null;
  const artifactOf = (draftId: string) => versionIndex.get(draftId)?.artifactId ?? draftId;
  const openArtifact = open ? artifactOf(open.draftId) : null;
  return (
    <>
      {listOpen ? (
        <aside id="chat-creations-panel" className="chat-plan-panel chat-canvas" aria-label="Coach creations">
          <CreationIndex
            creations={creations}
            openId={openArtifact}
            artifactOf={artifactOf}
            onCorosOf={(draftId) => isOnCoros(versionIndex.get(draftId))}
            onOpen={onOpen}
            onClose={onCloseList}
            planSportStyle={planSportStyle}
          />
        </aside>
      ) : null}
      {open
        ? /* Portalled to <body>, as the Library's editor is: a fixed box inside
             the Coach panel is bounded by the shell's stacking context and
             drawn under the rail. `.coach-sheet` carries the library tokens
             the week cards need, below the band the plan editor opens in. */
          createPortal(
            <div className="coach-sheet">
              <div
                className="chat-canvas-backdrop"
                role="presentation"
                onMouseDown={(event) => {
                  if (event.target === event.currentTarget) onCloseDetails();
                }}
              >
                <ArtifactView
                  key={openArtifact}
                  api={api}
                  newest={open}
                  cards={cards}
                  versionIndex={versionIndex}
                  documentFor={documentFor}
                  uploadingDraftId={uploadingDraftId}
                  editing={Boolean(editingDraftId && sameCreation(editingDraftId, open.draftId, versionIndex))}
                  onClose={onCloseDetails}
                  onUpload={onUpload}
                  onEdit={onEdit}
                  onRestore={onRestore}
                  onRemove={onRemove}
                  onViewInChat={onViewInChat}
                  onCalendar={onCalendar}
                  calendar={calendarOf?.(open.draftId)}
                  onAsk={onAsk}
                />
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}

function sameCreation(
  left: string,
  right: string,
  versionIndex: ReadonlyMap<string, CreationVersion>
): boolean {
  const artifact = (id: string) => versionIndex.get(id)?.artifactId ?? id;
  return artifact(left) === artifact(right);
}

/** The newest version of the creation `draftId` belongs to, if it is listed. */
function creationOf(
  draftId: string,
  creations: PlanDraftPreview[],
  versionIndex: ReadonlyMap<string, CreationVersion>
): PlanDraftPreview | null {
  return creations.find((creation) => sameCreation(creation.draftId, draftId, versionIndex)) ?? null;
}

function CreationIndex({
  creations,
  openId,
  artifactOf,
  onCorosOf,
  onOpen,
  onClose,
  planSportStyle
}: {
  creations: PlanDraftPreview[];
  /** The creation whose details are open, marked in the list. */
  openId: string | null;
  artifactOf: (draftId: string) => string;
  onCorosOf: (draftId: string) => boolean;
  onOpen: (draftId: string) => void;
  onClose: () => void;
  planSportStyle: (sport: PlanDraftPreview["entries"][number]["sport"]) => CSSProperties;
}) {
  return (
    <>
      <header className="chat-plan-list-header">
        <div>
          <span className="chat-plan-panel-icon">
            <BookOpen size={15} aria-hidden="true" />
          </span>
          <div>
            <strong>Coach creations</strong>
            <span>Plans and one-off workouts</span>
          </div>
        </div>
        <div className="chat-plan-list-header-end">
          <strong className="chat-plan-list-count">{creations.length}</strong>
          <button
            type="button"
            className="icon-button"
            aria-label="Hide Coach creations"
            title="Hide Coach creations"
            onClick={onClose}
          >
            <PanelRightClose size={16} aria-hidden="true" />
          </button>
        </div>
      </header>
      <ol className="chat-plan-list">
        {creations.map((draft, index) => {
          const status = creationStatus(draft, onCorosOf(draft.draftId));
          const isWorkout = draft.artifactType === "workout";
          const primarySport = draft.entries[0]?.sport;
          const SportIcon = sportTheme(primarySport).icon;
          return (
            <li key={draft.draftId}>
              <button
                type="button"
                className="chat-plan-list-item"
                aria-current={openId === artifactOf(draft.draftId) ? "true" : undefined}
                onClick={() => onOpen(draft.draftId)}
                aria-label={`Open ${draft.name || `${isWorkout ? "workout" : "plan"} ${index + 1}`}`}
              >
                <span className="chat-plan-list-sport" style={planSportStyle(primarySport)}>
                  <SportIcon size={15} strokeWidth={2} aria-hidden="true" />
                </span>
                <span className="chat-plan-list-copy">
                  <span className="chat-plan-list-kicker">
                    {isWorkout ? "One-off workout" : "Training plan"}
                  </span>
                  <strong>{draft.name || (isWorkout ? "Untitled workout" : "Untitled plan")}</strong>
                  <span className="chat-plan-list-meta">
                    {!isWorkout ? (
                      <span>
                        {draft.entries.length} {draft.entries.length === 1 ? "session" : "sessions"}
                      </span>
                    ) : null}
                    <span data-status={status.saved ? "saved" : "draft"}>{status.label}</span>
                  </span>
                </span>
                <ChevronRight size={15} aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ol>
    </>
  );
}

type Tab = "plan" | "versions";

const AUTHOR_WORDS: Record<PlanArtifactVersion["author"], string> = {
  coach: "Coach",
  athlete: "You",
  coros: "Library"
};

function ArtifactView({
  api,
  newest,
  cards,
  versionIndex,
  documentFor,
  uploadingDraftId,
  editing,
  onClose,
  onUpload,
  onEdit,
  onRestore,
  onRemove,
  onViewInChat,
  onCalendar,
  calendar,
  onAsk
}: {
  api?: CorosLinkApi;
  newest: PlanDraftPreview;
  cards: PlanDraftPreview[];
  versionIndex: ReadonlyMap<string, CreationVersion>;
  documentFor: (draftId: string) => TrainingPlanDocument | null | undefined;
  uploadingDraftId: string | null;
  editing: boolean;
  onClose: () => void;
  onUpload: (
    draftId: string,
    destination: TrainingPlanDestination,
    scheduleDate?: string,
    keepInLibrary?: boolean,
    options?: PlanDraftSaveOptions
  ) => void;
  onEdit?: (draftId: string) => void;
  onRestore?: (draftId: string) => void;
  onRemove: (draftId: string) => void;
  onViewInChat: (draftId: string) => void;
  onCalendar?: (draftId: string) => void;
  calendar?: CreationCalendar;
  onAsk?: (ref: PlanRef) => void;
}) {
  const { unitSystem } = useUnitSystem();
  const info = versionIndex.get(newest.draftId);
  const siblings = info?.siblings ?? [];
  // null follows the newest version, so a revision that lands while the
  // canvas is open is what it shows; picking an older one pins it.
  const [pinned, setPinned] = useState<string | null>(null);
  const shownId = pinned && siblings.some((item) => item.draftId === pinned) ? pinned : newest.draftId;
  const shown = cards.find((card) => card.draftId === shownId) ?? newest;
  const shownInfo = versionIndex.get(shownId);
  const latest = shownId === newest.draftId;
  const [tab, setTab] = useState<Tab>("plan");
  const [openSession, setOpenSession] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const weeksRef = useRef<HTMLOListElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setOpenSession(null);
  }, [shownId]);

  // Escape steps back one layer — the session, the removal question, then the
  // screen itself. A dialog stacked over this one (the editor, the calendar)
  // holds the focus, so a key pressed there is left to it.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && target !== document.body) return;
      if (openSession) setOpenSession(null);
      else if (confirming) setConfirming(false);
      else closeRef.current();
      event.stopPropagation();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [openSession, confirming]);
  // The screen takes the focus as it opens, so Escape and Tab start inside it.
  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  const isWorkout = newest.artifactType === "workout";
  const planDocument = documentFor(shownId);
  const drawn = useMemo(
    () => (planDocument ? datedForReading(planDocument) : undefined),
    [planDocument]
  );
  const reading = useMemo(() => (drawn ? readPlan(drawn) : undefined), [drawn]);
  const figures = planDocument && !isWorkout ? creationFigures(planDocument) : undefined;
  const sessions = reading ? planSessions(reading) : [];
  const saved = siblings.some((item) => item.uploadedAt) || Boolean(newest.uploadedAt || newest.uploadResult);
  // Hidden rather than removed once any version is saved: the plan on COROS
  // names the draft that became it.
  const onCoros = isOnCoros(info);
  const status = creationStatus(newest, onCoros);
  const title = shown.name || (isWorkout ? "Untitled workout" : "Untitled plan");

  /**
   * What the athlete points at, as a line the coach and the chip can read:
   * the week with its dates when the plan has them, the day and the session.
   */
  const refTo = (scope: PlanRef["scope"], weekIndex?: number, entryId?: string): PlanRef => {
    const session = entryId ? sessions.find((item) => item.entry.id === entryId) : undefined;
    const week = session ? session.weekIndex : weekIndex;
    const readWeek = week !== undefined ? reading?.weeks[week] : undefined;
    const weekText = readWeek
      ? `Week ${readWeek.weekIndex + 1}${readWeek.stage ? ` (${readWeek.stage})` : ""}`
      : undefined;
    const sessionEntry = entryId ? planDocument?.entries.find((entry) => entry.id === entryId) : undefined;
    const label =
      scope === "plan"
        ? "the whole plan"
        : scope === "week"
          ? weekText ?? "a week"
          : [weekText, session?.dayLabel, session?.entry.title].filter(Boolean).join(" · ");
    return {
      artifactId: info?.artifactId ?? newest.draftId,
      draftId: shownId,
      ...(shownInfo ? { version: shownInfo.version } : {}),
      name: title,
      artifactType: isWorkout ? "workout" : "plan",
      scope,
      ...(week !== undefined ? { weekIndex: week } : {}),
      ...(sessionEntry ? { sessionKey: sessionEntry.workout.key || sessionEntry.id } : {}),
      label
    };
  };

  const sessionView = (id: string) => {
    const index = sessions.findIndex((session) => session.entry.id === id);
    const session = sessions[index];
    if (!session || !planDocument) return null;
    return (
      <PlanSessionView
        key={id}
        session={session}
        entry={planDocument.entries.find((entry) => entry.id === id)}
        planName={title}
        position={{ index, of: sessions.length }}
        unitSystem={unitSystem}
        api={api}
        onBack={isWorkout ? undefined : () => setOpenSession(null)}
        onStep={(direction) => {
          const next = sessions[index + direction];
          if (next) setOpenSession(next.entry.id);
        }}
      />
    );
  };

  const versionOptions = [...siblings].reverse().map((item) => ({
    value: item.draftId,
    label: `v${item.version}${item.draftId === newest.draftId ? " · newest" : ""}`
  }));

  return (
    <div
      className="chat-plan-panel chat-canvas chat-canvas-dialog"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      tabIndex={-1}
      ref={rootRef}
    >
      <header className="chat-canvas-head">
        <div className="chat-canvas-title">
          <span className="chat-creation-kicker">
            {isWorkout ? "One-off workout" : "Training plan"}
            {shownInfo && shownInfo.version > 1 ? ` · v${shownInfo.version}` : ""}
          </span>
          <h2 title={title}>{title}</h2>
        </div>
        <span className="chat-creation-status" data-saved={status.saved ? "true" : "false"}>
          {calendar?.running && status.saved ? "On calendar" : status.label}
        </span>
        {onAsk ? (
          <button
            type="button"
            className="chat-plan-panel-chat-link"
            data-action="askPlan"
            onClick={() => onAsk(refTo("plan"))}
            title="Ask Coach about this"
          >
            Ask Coach
          </button>
        ) : null}
        <button
          type="button"
          className="chat-plan-panel-chat-link"
          onClick={() => onViewInChat(shownId)}
          title="Show this in the conversation"
        >
          <MessageCircle size={14} aria-hidden="true" />
          In chat
        </button>
        <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
          <X size={18} aria-hidden="true" />
        </button>
      </header>

      {siblings.length > 1 ? (
        <div className="chat-canvas-bar">
          <OptionGroup<Tab>
            label="Show"
            size="sm"
            value={tab}
            onChange={setTab}
            options={[
              { value: "plan", label: isWorkout ? "Workout" : "Plan" },
              { value: "versions", label: `Versions · ${siblings.length}` }
            ]}
          />
          {tab === "plan" ? (
            <OptionGroup<string>
              label="Version"
              size="sm"
              mode="dropdown"
              value={shownId}
              onChange={(next) => setPinned(next === newest.draftId ? null : next)}
              options={versionOptions}
            />
          ) : null}
        </div>
      ) : null}

      <div className="chat-canvas-body">
        {tab === "versions" ? (
          <VersionList
            siblings={siblings}
            newestId={newest.draftId}
            shownId={shownId}
            documentFor={documentFor}
            onShow={(draftId) => {
              setPinned(draftId === newest.draftId ? null : draftId);
              setTab("plan");
            }}
          />
        ) : (
          <>
            {!latest && shownInfo ? (
              <p className="chat-canvas-older">{supersededLine(shownInfo)}</p>
            ) : null}
            {openSession ? (
              <>
                {onAsk ? (
                  <button
                    type="button"
                    className="chat-plan-panel-chat-link chat-canvas-ask-session"
                    data-action="askSession"
                    onClick={() => onAsk(refTo("session", undefined, openSession))}
                  >
                    Ask Coach about this session
                  </button>
                ) : null}
                {sessionView(openSession)}
              </>
            ) : isWorkout ? (
              sessions[0] ? (
                sessionView(sessions[0].entry.id)
              ) : (
                <p className="chat-canvas-loading">Loading the workout…</p>
              )
            ) : reading ? (
              <>
                {figures ? (
                  <dl className="chat-creation-figures">
                    <div>
                      <dt>Weeks</dt>
                      <dd>{figures.weeks}</dd>
                    </div>
                    <div>
                      <dt>Sessions a week</dt>
                      <dd>{figures.sessionsPerWeek}</dd>
                    </div>
                    <div>
                      <dt>Peak week</dt>
                      <dd>{figures.peakWeek}</dd>
                    </div>
                    <div>
                      <dt>Sports</dt>
                      <dd>{figures.sports}</dd>
                    </div>
                  </dl>
                ) : null}
                {reading.weeks.length > 2 ? (
                  <PlanWeekRidge
                    weeks={reading.weeks}
                    onJump={(weekIndex) =>
                      weeksRef.current
                        ?.querySelector<HTMLElement>(`[data-week="${weekIndex}"] h2`)
                        ?.focus()
                    }
                  />
                ) : null}
                {drawn?.description && drawn.description !== "Created in Training Coach." ? (
                  <p className="chat-canvas-overview">{drawn.description}</p>
                ) : null}
                <ol className="plan-reader-weeks" ref={weeksRef}>
                  {reading.weeks.map((week) => (
                    <WeekCard
                      key={week.weekIndex}
                      week={week}
                      onOpen={setOpenSession}
                      onAsk={onAsk ? () => onAsk(refTo("week", week.weekIndex)) : undefined}
                    />
                  ))}
                </ol>
              </>
            ) : (
              <p className="chat-canvas-loading">Loading the plan…</p>
            )}
          </>
        )}
      </div>

      <footer className="chat-canvas-foot">
        {confirming ? (
          <>
            <span className="chat-creation-modal-confirm">
              {saved
                ? "Hide this from the conversation? What was saved to COROS stays, and still links back here."
                : "Remove this from the conversation, every version of it? It has not been saved anywhere, so it is gone."}
            </span>
            <button type="button" className="chat-local-action" onClick={() => setConfirming(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="chat-local-action is-danger"
              onClick={() => onRemove(newest.draftId)}
            >
              <Trash2 size={14} aria-hidden="true" />
              {saved ? "Hide" : "Remove"}
            </button>
          </>
        ) : (
          <>
            <CreationActions
              draft={shown}
              uploading={uploadingDraftId === shown.draftId}
              latest={latest}
              editing={editing}
              saved={saved}
              onUpload={(destination, scheduleDate, keepInLibrary, options) =>
                onUpload(shown.draftId, destination, scheduleDate, keepInLibrary, options)
              }
              onCoros={onCoros}
              onEdit={onEdit && (latest || editing) ? () => onEdit(newest.draftId) : undefined}
              onRestore={onRestore ? () => onRestore(shown.draftId) : undefined}
              onCalendar={onCalendar && latest ? () => onCalendar(shown.draftId) : undefined}
              onCalendarNow={calendar?.running ?? false}
            />
            <button
              type="button"
              className="chat-local-action is-danger chat-creation-modal-remove"
              onClick={() => setConfirming(true)}
            >
              <Trash2 size={14} aria-hidden="true" />
              {saved ? "Hide" : "Remove"}
            </button>
          </>
        )}
      </footer>
    </div>
  );
}

/** Every version, newest first, with who made it and what it changed. */
function VersionList({
  siblings,
  newestId,
  shownId,
  documentFor,
  onShow
}: {
  siblings: PlanArtifactVersion[];
  newestId: string;
  shownId: string;
  documentFor: (draftId: string) => TrainingPlanDocument | null | undefined;
  onShow: (draftId: string) => void;
}) {
  const ordered = [...siblings].reverse();
  return (
    <ol className="chat-canvas-versions">
      {ordered.map((item) => {
        const parent =
          siblings.find((candidate) => candidate.draftId === item.parentDraftId) ??
          siblings[siblings.indexOf(item) - 1];
        const before = parent ? documentFor(parent.draftId) : undefined;
        const after = documentFor(item.draftId);
        const changes = before && after ? planDiff(before, after) : [];
        return (
          <li key={item.draftId} data-shown={item.draftId === shownId ? "true" : undefined}>
            <button type="button" className="chat-canvas-version" onClick={() => onShow(item.draftId)}>
              <span className="chat-canvas-version-head">
                <strong>v{item.version}</strong>
                <span>{AUTHOR_WORDS[item.author]}</span>
                {item.draftId === newestId ? <em>Newest</em> : null}
                <time dateTime={new Date(item.createdAt).toISOString()}>
                  {new Date(item.createdAt).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit"
                  })}
                </time>
              </span>
              {item.changeSummary ? <span className="chat-canvas-version-note">{item.changeSummary}</span> : null}
              {changes.length ? (
                <ul className="chat-canvas-version-changes">
                  {changes.map((change, index) => (
                    <li key={index} data-kind={change.kind}>
                      {change.text}
                    </li>
                  ))}
                </ul>
              ) : null}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
