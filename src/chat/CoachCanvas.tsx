import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  ArrowLeft,
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
import { creationStatus } from "./creationChoices";
import { supersededLine, type CreationVersion } from "./creationVersions";

/**
 * The canvas: where a coach's creations are read beside the conversation
 * rather than over it (docs/coach-plan-canvas.md, P1.4). Two modes — the
 * index of what Coach has made here, and one creation open — in one pane
 * that stands where the Creations list stood, and becomes a sheet over the
 * conversation when the window is too narrow for both.
 *
 * It reads with the Library reader's own pieces: the ridge, the week cards
 * with their seven columns, the session view. It edits nothing — the editor
 * is the one place a creation changes (D10) — and its buttons come from
 * `artifactActions`, the function the card's come from (D9).
 *
 * Loaded when first opened, with the library's stylesheet the week cards are
 * drawn by, as the plan editor is.
 */
export default function CoachCanvas({
  api,
  artifactId,
  creations,
  cards,
  versionIndex,
  documentFor,
  uploadingDraftId,
  editingDraftId,
  onOpen,
  onBack,
  onClose,
  onUpload,
  onEdit,
  onRestore,
  onRemove,
  onViewInChat,
  planSportStyle
}: {
  api?: CorosLinkApi;
  /** Any version's draft id of the creation open; null is the index. */
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
  onBack: () => void;
  onClose: () => void;
  onUpload: (
    draftId: string,
    destination: TrainingPlanDestination,
    scheduleDate?: string,
    keepInLibrary?: boolean
  ) => void;
  onEdit?: (draftId: string) => void;
  onRestore?: (draftId: string) => void;
  onRemove: (draftId: string) => void;
  onViewInChat: (draftId: string) => void;
  planSportStyle: (sport: PlanDraftPreview["entries"][number]["sport"]) => CSSProperties;
}) {
  const open = artifactId ? creationOf(artifactId, creations, versionIndex) : null;
  return (
    <aside
      id="chat-creations-panel"
      className={`chat-plan-panel chat-canvas${open ? " is-artifact" : ""}`}
      aria-label="Coach creations"
    >
      {open ? (
        <ArtifactView
          key={versionIndex.get(open.draftId)?.artifactId ?? open.draftId}
          api={api}
          newest={open}
          cards={cards}
          versionIndex={versionIndex}
          documentFor={documentFor}
          uploadingDraftId={uploadingDraftId}
          editing={Boolean(editingDraftId && sameCreation(editingDraftId, open.draftId, versionIndex))}
          canGoBack={creations.length > 1}
          onBack={onBack}
          onClose={onClose}
          onUpload={onUpload}
          onEdit={onEdit}
          onRestore={onRestore}
          onRemove={onRemove}
          onViewInChat={onViewInChat}
        />
      ) : (
        <CreationIndex
          creations={creations}
          onOpen={onOpen}
          onClose={onClose}
          planSportStyle={planSportStyle}
        />
      )}
    </aside>
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
  onOpen,
  onClose,
  planSportStyle
}: {
  creations: PlanDraftPreview[];
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
          const status = creationStatus(draft);
          const isWorkout = draft.artifactType === "workout";
          const primarySport = draft.entries[0]?.sport;
          const SportIcon = sportTheme(primarySport).icon;
          return (
            <li key={draft.draftId}>
              <button
                type="button"
                className="chat-plan-list-item"
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
  canGoBack,
  onBack,
  onClose,
  onUpload,
  onEdit,
  onRestore,
  onRemove,
  onViewInChat
}: {
  api?: CorosLinkApi;
  newest: PlanDraftPreview;
  cards: PlanDraftPreview[];
  versionIndex: ReadonlyMap<string, CreationVersion>;
  documentFor: (draftId: string) => TrainingPlanDocument | null | undefined;
  uploadingDraftId: string | null;
  editing: boolean;
  canGoBack: boolean;
  onBack: () => void;
  onClose: () => void;
  onUpload: (
    draftId: string,
    destination: TrainingPlanDestination,
    scheduleDate?: string,
    keepInLibrary?: boolean
  ) => void;
  onEdit?: (draftId: string) => void;
  onRestore?: (draftId: string) => void;
  onRemove: (draftId: string) => void;
  onViewInChat: (draftId: string) => void;
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

  // Escape steps back one layer, and only for a key pressed inside the pane:
  // the composer beside it has its own use for the key.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (!rootRef.current?.contains(event.target as Node)) return;
      if (openSession) setOpenSession(null);
      else if (confirming) setConfirming(false);
      else return;
      event.stopPropagation();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [openSession, confirming]);

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
  const status = creationStatus(newest);
  const title = shown.name || (isWorkout ? "Untitled workout" : "Untitled plan");

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
    <div className="chat-canvas-artifact" ref={rootRef}>
      <header className="chat-canvas-head">
        {canGoBack ? (
          <button
            type="button"
            className="icon-button"
            aria-label="All creations"
            title="All creations"
            onClick={onBack}
          >
            <ArrowLeft size={16} aria-hidden="true" />
          </button>
        ) : null}
        <div className="chat-canvas-title">
          <span className="chat-creation-kicker">
            {isWorkout ? "One-off workout" : "Training plan"}
            {shownInfo && shownInfo.version > 1 ? ` · v${shownInfo.version}` : ""}
          </span>
          <h2 title={title}>{title}</h2>
        </div>
        <span className="chat-creation-status" data-saved={status.saved ? "true" : "false"}>
          {status.label}
        </span>
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
              sessionView(openSession)
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
                    <WeekCard key={week.weekIndex} week={week} onOpen={setOpenSession} />
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
              onUpload={(destination, scheduleDate, keepInLibrary) =>
                onUpload(shown.draftId, destination, scheduleDate, keepInLibrary)
              }
              onEdit={onEdit && (latest || editing) ? () => onEdit(newest.draftId) : undefined}
              onRestore={onRestore ? () => onRestore(shown.draftId) : undefined}
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
