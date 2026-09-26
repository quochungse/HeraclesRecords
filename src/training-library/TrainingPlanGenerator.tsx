import {
  AlertTriangle,
  ArrowRight,
  CalendarPlus,
  Check,
  LoaderCircle,
  RotateCw,
  Sparkles,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  CoachOpenRequest,
  ChatAuthStatus,
  ChatProvider,
  ChatSettings,
  ClaudeCodeStatus,
  TrainingPlanDataSources,
  TrainingPlanDocument,
  TrainingPlanGenerationRequest,
  TrainingPlanOutline,
  TrainingPlanOutlineRevision
} from "../../electron/types";
import {
  firstPlanMonday,
  generationRequestProblems,
  trainingPlanCoachHandoff,
  type TrainingPlanGenerationField,
  type TrainingPlanGenerationProblem
} from "../../electron/trainingPlanGeneration";
import type { CorosLinkApi } from "../coroslink-api";
import { COACH_PROVIDER_LABELS, coachProviderReadiness } from "../chat/CoachModelsPanel";
import { useUnitSystem } from "../units/UnitSystemProvider";
import { ConfirmDialog } from "./ConfirmDialog";
import { EMPTY_NOTES, noteHandOver, notePassed, noteRead, noteSnapshot, noteText, readLine } from "./runTrail";
import { TrainingPlanCalendarDialog } from "./TrainingPlanCalendarDialog";
import { GeneratorGoalStep } from "./GeneratorGoalStep";
import { GeneratorOutlineStep } from "./GeneratorOutlineStep";
import { GeneratorProviderPanel, PROVIDER_FIX } from "./GeneratorProviderPanel";
import { GeneratorDone, GeneratorRun, type Finished, type RunState } from "./GeneratorRun";
import { GeneratorWeekStep } from "./GeneratorWeekStep";
import {
  DEFAULT_GENERATOR_FORM,
  SOURCES,
  STEP_FIELDS,
  outlineKey,
  planSnapshot,
  requestFromForm,
  spanSentence,
  type GeneratorForm,
  type GeneratorStep
} from "./planGeneratorModel";
import {
  requestRuntime,
  runtimeFromSettings,
  runtimeModelOptions,
  runtimeSummary,
  settingsWithRuntime,
  type GeneratorRuntime
} from "./planGeneratorRuntime";

interface TrainingPlanGeneratorProps {
  api: CorosLinkApi;
  onClose: () => void;
  /**
   * A finished plan, already kept as a library draft (or not, when keeping it
   * failed — `draftId` is then absent), for the library to list.
   */
  onKept: (plan: TrainingPlanDocument, draftId?: string) => void;
  /**
   * Edit plan: the plan editor opens over the generator, which stays as it
   * is underneath — hidden while `covered` — so closing the editor comes back
   * to the last step.
   */
  onOpenPlan: (plan: TrainingPlanDocument, draftId?: string) => void;
  /** The editor opened by Edit plan is on screen: the generator is hidden and hears no Escape. */
  covered?: boolean;
  /** The plan as the editor last kept it as a draft, which the last step then shows. */
  editedDraft?: { draftId: string; plan: TrainingPlanDocument } | null;
  /** Saved to COROS from the last step — the draft is gone, the plan is listed. */
  onSaved: (plan: TrainingPlanDocument) => void;
  /** Put on the calendar from the last step: `plan` is the saved plan, not its running copy. */
  onScheduled: (plan: TrainingPlanDocument) => void;
  /** Open plan: the generator closes and the reader opens on the saved plan. */
  onReadPlan: (plan: TrainingPlanDocument) => void;
  onOpenCoach: (prompt?: string | CoachOpenRequest) => void;
}

/** A sign-in status nobody has asked for yet, one on its way, or its answer. */
type StatusRead<T> = { state: "unread" } | { state: "reading" } | { state: "read"; value: T | null };

const NAV: readonly { step: GeneratorStep; label: string }[] = [
  { step: "goal", label: "Goal" },
  { step: "week", label: "Your week" },
  { step: "outline", label: "Outline" },
  { step: "writing", label: "Sessions" }
];

/**
 * The AI plan generator: the goal, then the athlete's week, then Coach writes
 * the sessions — and the plan is kept as a library draft before anything else
 * happens, so closing the dialog on the last step loses nothing.
 */
export function TrainingPlanGenerator({
  api,
  onClose,
  onKept,
  onOpenPlan,
  onSaved,
  onScheduled,
  onReadPlan,
  onOpenCoach,
  covered = false,
  editedDraft
}: TrainingPlanGeneratorProps) {
  const { unitSystem } = useUnitSystem();
  const firstMonday = useMemo(() => firstPlanMonday(), []);
  const [form, setForm] = useState<GeneratorForm>(DEFAULT_GENERATOR_FORM);
  const [step, setStep] = useState<GeneratorStep>("goal");
  const [touched, setTouched] = useState<ReadonlySet<string>>(() => new Set());
  const [attempted, setAttempted] = useState<ReadonlySet<GeneratorStep>>(() => new Set());
  const [run, setRun] = useState<RunState | null>(null);
  const [now, setNow] = useState(() => Date.now());
  /* Why the last run ended without its result, and which run it was, so
     "Try again" repeats that one. */
  const [failure, setFailure] = useState<{ message: string; kind: RunState["kind"] } | null>(null);
  /* The outline, and the request it was drawn for: one whose request has
     changed since is stale, and is drawn again rather than written to. */
  const [outline, setOutline] = useState<{ outline: TrainingPlanOutline; key: string } | null>(null);
  const [selectedWeek, setSelectedWeek] = useState(0);
  const [outlineNote, setOutlineNote] = useState("");
  const [finished, setFinished] = useState<Finished | null>(null);
  const activeRequestId = useRef<string | null>(null);
  const generating = run !== null;

  /* Coach's settings and what each provider's sign-in says, read on open; a
     sign-in status stays unread (and its provider "Checking") until needed. */
  const [chatSettings, setChatSettings] = useState<ChatSettings | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [authRead, setAuthRead] = useState<StatusRead<ChatAuthStatus>>({ state: "unread" });
  const [claudeRead, setClaudeRead] = useState<StatusRead<ClaudeCodeStatus>>({ state: "unread" });
  const [runtime, setRuntime] = useState<GeneratorRuntime | null>(null);
  const [keepForChat, setKeepForChat] = useState(false);
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  /* The plan as COROS saved it. A ref as well as state: the calendar's Try
     again after a failed add asks for it again, from a closure older than the
     save, and must get the same plan rather than write a second one. */
  const savedRef = useRef<TrainingPlanDocument | null>(null);

  /* Edits kept in the editor opened by Edit plan become the plan shown here. */
  useEffect(() => {
    if (!editedDraft) return;
    setFinished((current) =>
      current && !current.saved && (current.draftId === undefined || current.draftId === editedDraft.draftId)
        ? { ...current, plan: editedDraft.plan, draftId: editedDraft.draftId, keepError: undefined }
        : current
    );
  }, [editedDraft]);
  /** Sources switched on the outline step, waiting on the athlete's yes to redraw it. */
  const [pendingSources, setPendingSources] = useState<TrainingPlanDataSources | null>(null);

  const update = (patch: Partial<GeneratorForm>, field?: string) => {
    setForm((current) => ({ ...current, ...patch }));
    if (field) setTouched((current) => (current.has(field) ? current : new Set(current).add(field)));
  };

  const request = useMemo<TrainingPlanGenerationRequest>(() => requestFromForm(form, firstMonday), [firstMonday, form]);
  const freshOutline = outline && outline.key === outlineKey(request) ? outline.outline : null;
  const problems = useMemo(() => generationRequestProblems(request, new Date()), [request]);
  const stepOf = (field: TrainingPlanGenerationField): "goal" | "week" =>
    STEP_FIELDS.goal.includes(field) ? "goal" : "week";
  const problemsOf = (target: "goal" | "week") => problems.filter((problem) => stepOf(problem.field) === target);
  const problemOf = (field: string): string | undefined => {
    const problem = problems.find((candidate) => candidate.field === field);
    return problem && (attempted.has(stepOf(problem.field)) || touched.has(field)) ? problem.message : undefined;
  };

  /*
   * Ready means the credential a provider needs is in place — the rule Coach
   * and Settings already use (`coachProviderReadiness`), so the three never
   * disagree. The sign-in statuses cost a round trip each (Claude Code's asks
   * the CLI), so only the provider in use is read on open; the others are read
   * when the AI panel opens and lists them. Each is asked once, whatever
   * renders or effects repeat: StrictMode runs an effect twice with the same
   * closure, where state still says "unread".
   */
  const statusAsked = useRef(new Set<ChatProvider>());
  const readStatuses = (providers: readonly ChatProvider[]) => {
    const ask = (provider: ChatProvider) => {
      if (!providers.includes(provider) || statusAsked.current.has(provider)) return false;
      statusAsked.current.add(provider);
      return true;
    };
    if (ask("chatgpt")) {
      setAuthRead({ state: "reading" });
      void api.getChatAuthStatus().then(
        (value) => setAuthRead({ state: "read", value }),
        () => setAuthRead({ state: "read", value: null })
      );
    }
    if (ask("claude-code")) {
      setClaudeRead({ state: "reading" });
      void api.getClaudeCodeStatus().then(
        (value) => setClaudeRead({ state: "read", value }),
        () => setClaudeRead({ state: "read", value: null })
      );
    }
  };
  useEffect(() => {
    let active = true;
    void api.getChatSettings().then(
      (settings) => {
        if (!active) return;
        setChatSettings(settings);
        setRuntime(runtimeFromSettings(settings));
      },
      (cause) => { if (active) setSettingsError(cause instanceof Error ? cause.message : String(cause)); }
    );
    return () => { active = false; };
  }, [api]);
  useEffect(() => {
    if (runtime) readStatuses([runtime.provider]);
  }, [runtime?.provider]);

  const claudeStatus = claudeRead.state === "read" ? claudeRead.value : null;
  /* `undefined` while a status is unread or on its way; one that failed to
     read counts as not ready. */
  const readiness = useMemo<Partial<Record<ChatProvider, boolean>>>(() => {
    if (!chatSettings) return {};
    const ready = coachProviderReadiness(chatSettings, authRead.state === "read" ? authRead.value : null, claudeStatus);
    return {
      ...ready,
      chatgpt: authRead.state === "read" ? ready.chatgpt : undefined,
      "claude-code": claudeRead.state === "read" ? ready["claude-code"] : undefined
    };
  }, [authRead, chatSettings, claudeRead, claudeStatus]);
  const providerReady = runtime ? readiness[runtime.provider] : undefined;
  const ready = providerReady === true;

  const openAiPanel = () => {
    readStatuses(["chatgpt", "claude-code"]);
    setAiPanelOpen(true);
  };
  /* Done keeps the choice for this plan; with the box ticked it becomes
     Coach's too, written the way Coach's own pickers write it. */
  const closeAiPanel = () => {
    setAiPanelOpen(false);
    if (keepForChat && chatSettings && runtime) {
      const next = settingsWithRuntime(chatSettings, runtime);
      setChatSettings(next);
      void api.saveChatSettings(next).then(setChatSettings, (cause) =>
        setSettingsError(cause instanceof Error ? cause.message : String(cause))
      );
    }
  };

  /* Progress only: how the run ends is the answer to `generateTrainingPlan`. */
  useEffect(() => {
    const advance = (requestId: string, next: (current: RunState) => Partial<RunState>) =>
      setRun((current) => {
        if (!current || current.requestId !== requestId) return current;
        const patch = next(current);
        return { ...current, ...patch, stage: Math.max(current.stage, patch.stage ?? current.stage) };
      });
    const offStart = api.onChatStreamStart((payload) => {
      advance(payload.requestId, () => ({ activity: "Reading your training" }));
    });
    const designing = (current: RunState): Partial<RunState> =>
      current.stage < 1 ? { stage: 1, activity: current.kind === "outline" ? "Drawing the outline" : "Designing the plan" } : {};
    const offToken = api.onChatStreamToken((payload) => {
      advance(payload.requestId, (current) => ({ ...designing(current), notes: noteText(current.notes, payload.delta, "text") }));
    });
    const offInfo = api.onChatStreamInfo((payload) => {
      if (payload.kind === "thinking") {
        advance(payload.requestId, (current) => ({ ...designing(current), notes: noteText(current.notes, payload.delta, "thinking") }));
      } else if (payload.kind === "context" && payload.snapshotIncluded) {
        advance(payload.requestId, (current) => ({ notes: noteSnapshot(current.notes) }));
      } else if (payload.kind === "mcp" && payload.status === "call") {
        const tool = payload.tool?.split("__").at(-1);
        if (tool === "propose_plan_outline" || tool === "draft_training_plan") {
          advance(payload.requestId, (current) => ({
            stage: 2,
            attempts: current.attempts + 1,
            notes: noteHandOver(current.notes, tool === "propose_plan_outline" ? "outline" : "plan", current.attempts + 1),
            activity: current.attempts > 0
              ? "Correcting what the check found"
              : tool === "propose_plan_outline" ? "Checking the outline against your week" : "Writing the sessions"
          }));
        } else {
          advance(payload.requestId, (current) => ({ activity: readLine(payload.tool)[0], notes: noteRead(current.notes, payload.tool) }));
        }
      } else if (payload.kind === "planDraft") {
        advance(payload.requestId, (current) => ({ stage: 3, activity: "Every session fits what you asked for", notes: notePassed(current.notes) }));
      }
    });
    return () => { offStart(); offToken(); offInfo(); };
  }, [api]);

  useEffect(() => {
    if (!run) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [run?.requestId]);

  useEffect(() => () => {
    const requestId = activeRequestId.current;
    if (requestId) void api.cancelChat(requestId);
  }, [api]);

  /** Where a run returns to when it ends without its result: the outline when there is one to go back to, else the week. */
  const returnStep = (): GeneratorStep => (freshOutline ? "outline" : "week");

  /** Ends the run and steps back, with everything in the form kept. */
  const stop = () => {
    const requestId = activeRequestId.current;
    activeRequestId.current = null;
    setRun(null);
    setStep(returnStep());
    if (requestId) void api.cancelChat(requestId);
  };

  const close = () => {
    if (generating) stop();
    onClose();
  };

  /* Escape steps back one layer: out of the AI panel, out of a run, then out. */
  const escapeRef = useRef<() => void>(close);
  escapeRef.current = covered ? () => undefined : aiPanelOpen ? closeAiPanel : generating ? stop : close;
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      escapeRef.current();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, []);

  /* After the step it lives on has rendered, which may be the next frame. */
  const focusField = (field: string) => {
    window.setTimeout(() => {
      const element = document.getElementById(`plan-generator-${field}`);
      const target = element?.matches("input, textarea, button")
        ? element
        : element?.querySelector<HTMLElement>("input, textarea, button:not(:disabled)");
      target?.focus();
    }, 0);
  };

  /* A step with problems is not left: they are shown on the step that owns
     them, and the first one takes focus. */
  const holdOn = (target: "goal" | "week", among: readonly TrainingPlanGenerationProblem[] = problems): boolean => {
    const first = among.find((problem) => stepOf(problem.field) === target);
    if (!first) return false;
    setAttempted((current) => new Set(current).add(target));
    setStep(target);
    focusField(first.field);
    return true;
  };

  /** A plan that came back is kept as a library draft first, so nothing is lost if the dialog closes. */
  const keep = async (plan: TrainingPlanDocument) => {
    setFinished({ plan, keeping: true });
    try {
      const record = await api.saveTrainingPlanDraft({ plan });
      setFinished({ plan: record.plan, draftId: record.id, keeping: false });
      onKept(record.plan, record.id);
    } catch (cause) {
      setFinished({ plan, keeping: false, keepError: cause instanceof Error ? cause.message : String(cause) });
      onKept(plan);
    }
  };

  const errorText = (cause: unknown) =>
    (cause instanceof Error ? cause.message : String(cause)).replace(/^Error invoking remote method '[^']+': Error:\s*/, "");
  const withRuntime = (value: TrainingPlanGenerationRequest): TrainingPlanGenerationRequest => {
    const override = runtime && chatSettings ? requestRuntime(runtime, chatSettings) : undefined;
    return override ? { ...value, runtime: override } : value;
  };

  /** Starts a run: the dialog moves to where it is drawn, and the old failure goes. */
  const begin = (kind: RunState["kind"], nextStep: GeneratorStep): string => {
    const requestId = `training-plan-${crypto.randomUUID()}`;
    activeRequestId.current = requestId;
    setFailure(null);
    setStep(nextStep);
    setRun({ kind, requestId, startedAt: Date.now(), stage: 0, activity: "Gathering your training context", attempts: 0, notes: EMPTY_NOTES });
    return requestId;
  };
  /** Whether this run is still the one on screen; ends it when it is. */
  const settleRun = (requestId: string): boolean => {
    if (activeRequestId.current !== requestId) return false;
    activeRequestId.current = null;
    setRun(null);
    return true;
  };

  /**
   * The outline turn — or, with a revision, the outline redrawn as asked.
   * `nextForm` is a form this render has not caught up with yet: the one a
   * confirmed change of sources is about to become.
   */
  const drawOutline = async (revision?: TrainingPlanOutlineRevision, nextForm?: GeneratorForm) => {
    if (generating || !ready) return;
    const drawn = nextForm ? requestFromForm(nextForm, firstMonday) : request;
    const drawnProblems = nextForm ? generationRequestProblems(drawn, new Date()) : problems;
    if (holdOn("goal", drawnProblems) || holdOn("week", drawnProblems)) return;
    const back = revision ? "outline" : "week";
    const requestId = begin("outline", "outline");
    const key = outlineKey(drawn);
    try {
      const result = await api.outlineTrainingPlan(requestId, withRuntime(drawn), unitSystem, revision);
      if (!settleRun(requestId)) return;
      if (result.ok) {
        setOutline({ outline: result.outline, key });
        setSelectedWeek(0);
        setOutlineNote("");
        setStep("outline");
      } else {
        setStep(back);
        if (result.reason !== "cancelled") setFailure({ message: result.message, kind: "outline" });
      }
    } catch (cause) {
      if (!settleRun(requestId)) return;
      setStep(back);
      setFailure({ message: errorText(cause), kind: "outline" });
    }
  };

  const generate = async () => {
    if (generating || !ready || !freshOutline) return;
    if (holdOn("goal") || holdOn("week")) return;
    const requestId = begin("plan", "writing");
    try {
      const result = await api.generateTrainingPlan(requestId, withRuntime({ ...request, outline: freshOutline }), unitSystem);
      if (!settleRun(requestId)) return;
      if (result.ok) {
        setStep("done");
        await keep(result.plan);
      } else {
        setStep("outline");
        if (result.reason !== "cancelled") setFailure({ message: result.message, kind: "plan" });
      }
    } catch (cause) {
      if (!settleRun(requestId)) return;
      setStep("outline");
      setFailure({ message: errorText(cause), kind: "plan" });
    }
  };

  /* What a pending change of sources would leave the form unable to do — "From
     my data" with the activities withheld — said before it is agreed to. */
  const pendingSourcesProblem = pendingSources
    ? generationRequestProblems(requestFromForm({ ...form, sources: pendingSources }, firstMonday), new Date())[0]?.message
    : undefined;

  const confirmSources = () => {
    if (!pendingSources) return;
    const nextForm = { ...form, sources: pendingSources };
    setPendingSources(null);
    update({ sources: pendingSources }, "difficulty");
    void drawOutline(undefined, nextForm);
  };

  const tryAgain = () => {
    if (failure?.kind === "plan") void generate();
    else void drawOutline();
  };

  const openInEditor = () => {
    if (finished && !finished.keeping) onOpenPlan(finished.plan, finished.draftId);
  };

  /*
   * The last step's two ways onto COROS. Save writes the plan as it is (the
   * draft is let go once it is there); Add to calendar asks for the day first
   * — previewed from the draft, since the plan is not on COROS yet — and saves
   * and schedules it as one answer.
   */
  const saveToCoros = async (): Promise<TrainingPlanDocument> => {
    if (savedRef.current) return savedRef.current;
    if (!finished) throw new Error("There is no plan to save.");
    const result = await api.saveTrainingPlanToCoros({
      plan: finished.plan,
      unitSystem,
      draftId: finished.draftId,
      origin: "coach"
    });
    /* A plan written here names no COROS plan, so nothing can have moved under it. */
    if (!result.ok) throw new Error("COROS answered with a plan this one does not know.");
    savedRef.current = result.plan;
    setFinished((current) => (current ? { ...current, saved: result.plan, saveError: undefined } : current));
    onSaved(result.plan);
    return result.plan;
  };

  const savePlan = async () => {
    if (!finished || finished.keeping || finished.saving || finished.saved) return;
    setFinished((current) => (current ? { ...current, saving: true, saveError: undefined } : current));
    try {
      await saveToCoros();
    } catch (cause) {
      setFinished((current) => (current ? { ...current, saveError: errorText(cause) } : current));
    } finally {
      setFinished((current) => (current ? { ...current, saving: false } : current));
    }
  };

  const addToCalendar = async () => {
    if (!finished || finished.keeping || finished.saving || finished.scheduled) return;
    /* Only a kept draft can be previewed before it is saved; a plan that
       could not be kept is saved first, then asked for its day. */
    if (!finished.draftId && !finished.saved) {
      await savePlan();
      if (!savedRef.current) return;
    }
    setCalendarOpen(true);
  };

  const next = () => {
    if (step === "goal") {
      if (!holdOn("goal")) setStep("week");
    } else if (step === "week") {
      if (freshOutline) {
        if (!holdOn("week")) setStep("outline");
      } else {
        void drawOutline();
      }
    } else if (step === "outline") {
      void generate();
    } else if (step === "done") {
      void addToCalendar();
    }
  };

  const back = () => {
    if (run) stop();
    else if (step === "week") setStep("goal");
    else if (step === "outline") setStep("week");
  };

  const reachable = (target: GeneratorStep): boolean => {
    if (generating || step === "done") return false;
    if (target === "goal") return true;
    if (target === "week") return problemsOf("goal").length === 0;
    if (target === "outline") return Boolean(freshOutline) && problems.length === 0;
    return false;
  };

  /* The footer says what the step still needs, before Next is pressed. */
  const notReady = "Pick an AI that is set up to write the plan.";
  const footerHint = run
    ? run.kind === "outline" ? "Stopping keeps everything you filled in." : "Stopping keeps the outline and everything you filled in."
    : step === "goal"
      ? problemsOf("goal")[0]?.message ?? "Next: the days and time you have."
      : step === "week"
        ? problemsOf("week")[0]?.message
          ?? problemsOf("goal")[0]?.message
          ?? (ready || providerReady === undefined ? "Coach reads your training and drafts the plan's shape first." : notReady)
        : step === "outline"
          ? ready || providerReady === undefined ? "Looks right? Coach writes every session to this outline." : notReady
          : null;
  const nextLabel = run
    ? run.kind === "outline" ? "Drawing…" : "Writing…"
    : step === "goal"
      ? "Your week"
      : step === "week"
        ? freshOutline ? "The outline" : failure?.kind === "outline" ? "Try again" : "Draft the outline"
        : step === "outline"
          ? failure?.kind === "plan" ? "Try again" : "Write the sessions"
          : "Add to calendar";
  const nextDisabled = Boolean(run)
    || (step === "week" && !freshOutline && !ready)
    || (step === "outline" && !ready)
    || (step === "done" && (!finished || finished.keeping || Boolean(finished.saving)));
  const navIndex = step === "done" ? NAV.length : NAV.findIndex((item) => item.step === step);
  const snapshot = planSnapshot(form, request);

  return (
    <div className="plan-generator-backdrop" hidden={covered}>
      <section className="plan-generator" role="dialog" aria-modal="true" aria-labelledby="plan-generator-title">
        <header>
          <span className="plan-generator-title-icon"><Sparkles size={16} /></span>
          <div className="plan-generator-heading">
            <p className="tl-eyebrow">Training Coach</p>
            <h2 id="plan-generator-title">Generate a training plan</h2>
          </div>
          <nav className="plan-generator-steps" aria-label="Steps">
            {NAV.map((item, index) => {
              const done = index < navIndex;
              const current = index === navIndex;
              return (
                <button
                  type="button"
                  key={item.step}
                  className={`${done ? "is-done" : ""}${current ? " is-current" : ""}`}
                  aria-current={current ? "step" : undefined}
                  disabled={current || !reachable(item.step)}
                  onClick={() => {
                    if (item.step === "week" && holdOn("goal")) return;
                    setStep(item.step);
                  }}
                >
                  <span>{done ? <Check size={10} /> : index + 1}</span>
                  {item.label}
                </button>
              );
            })}
          </nav>
          <button type="button" className="icon-button" aria-label="Close plan generator" onClick={close}><X size={17} /></button>
        </header>

        <div className={`plan-generator-body${step === "done" ? " is-done" : ""}`}>
          {/* Gone once the plan is written: what it was written with is
              settled, and the plan wants the whole width. */}
          {step === "done" ? null : (
          <aside className="plan-generator-status">
            <p className="tl-eyebrow">Provider</p>
            {!runtime || !chatSettings ? (
              <div className={`plan-generator-provider${settingsError ? " is-blocked" : ""}`}>
                <span className="plan-generator-provider-text"><strong>{settingsError ? "Training Coach" : "Checking Training Coach"}</strong><small>{settingsError ?? "Using Coach's provider"}</small></span>
              </div>
            ) : (
              <button
                type="button"
                className={`plan-generator-provider${providerReady === true ? " is-ready" : providerReady === false ? " is-blocked" : ""}`}
                aria-haspopup="dialog"
                disabled={generating}
                onClick={openAiPanel}
              >
                <span className="plan-generator-provider-text">
                  <strong>{COACH_PROVIDER_LABELS[runtime.provider]}</strong>
                  <small>
                    {providerReady === false
                      ? (runtime.provider === "claude-code" && claudeStatus?.message) || PROVIDER_FIX[runtime.provider]
                      : `${runtimeSummary(runtime, runtimeModelOptions(runtime.provider, chatSettings, claudeStatus))} · ${runtime.provider === chatSettings.provider && !requestRuntime(runtime, chatSettings) ? "Coach's settings" : "this plan only"}`}
                  </small>
                </span>
                <span className="plan-generator-provider-change">Change</span>
              </button>
            )}

            {/* What Coach may read for this plan. A source switched off is
                withheld from the tools and from the snapshot the turn starts
                from, not merely left out of the prompt. */}
            <p className="tl-eyebrow plan-generator-aside-eyebrow">What Coach reads</p>
            <ul className="plan-generator-sources">
              {SOURCES.map((source) => {
                const on = form.sources[source.value];
                return (
                  <li key={source.value}>
                    <span>
                      <strong id={`plan-generator-source-${source.value}`}>{source.label}</strong>
                      <small>{on ? source.detail : "Not shared with this plan"}</small>
                    </span>
                    <button
                      type="button"
                      role="switch"
                      className="plan-generator-source"
                      aria-checked={on}
                      aria-labelledby={`plan-generator-source-${source.value}`}
                      disabled={generating}
                      onClick={() => {
                        const sources = { ...form.sources, [source.value]: !on };
                        // The outline on screen was drawn from what Coach
                        // could read, so a change there means drawing it again.
                        if (step === "outline" && freshOutline) setPendingSources(sources);
                        else update({ sources }, "difficulty");
                      }}
                    >
                      <span />
                    </button>
                  </li>
                );
              })}
            </ul>

            <p className="tl-eyebrow plan-generator-aside-eyebrow">Plan</p>
            <dl className="plan-generator-snapshot">
              {snapshot.map((row) => (
                <div key={row.label}>
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
          </aside>
          )}

          <div className="plan-generator-form">
            {failure && !run && (step === "week" || step === "outline") ? (
              <div className="plan-generator-failure" role="alert">
                <AlertTriangle size={17} aria-hidden="true" />
                <div>
                  <strong>{failure.kind === "outline" ? "No outline this time" : "No plan this time"}</strong>
                  <p>{failure.message}</p>
                </div>
                <div className="plan-generator-failure-actions">
                  <button type="button" className="ghost-button" disabled={!ready} onClick={tryAgain}><RotateCw size={14} /> Try again</button>
                  <button type="button" className="ghost-button" onClick={() => onOpenCoach(trainingPlanCoachHandoff(request))}>Continue in Coach <ArrowRight size={14} /></button>
                </div>
              </div>
            ) : null}

            {step === "goal" ? (
              <GeneratorGoalStep form={form} firstMonday={firstMonday} update={update} problemOf={problemOf} spanSentence={spanSentence(request)} />
            ) : step === "week" ? (
              <GeneratorWeekStep form={form} firstMonday={firstMonday} update={update} problemOf={problemOf} spanSentence={spanSentence(request)} />
            ) : run ? (
              <GeneratorRun run={run} now={now} outline={freshOutline ?? undefined} />
            ) : step === "outline" && freshOutline ? (
              <GeneratorOutlineStep
                outline={freshOutline}
                startDate={request.startDate}
                lengthChosen={request.goalKind !== "race" && request.weeks === undefined}
                selected={selectedWeek}
                onSelect={setSelectedWeek}
                note={outlineNote}
                onNote={setOutlineNote}
                onRedraw={() => void drawOutline({ outline: freshOutline, note: outlineNote })}
                redrawDisabled={!outlineNote.trim() || !ready}
              />
            ) : step === "done" && finished ? (
              <GeneratorDone finished={finished} />
            ) : null}
          </div>
        </div>

        <footer>
          {footerHint ? <p className="plan-generator-footer-hint">{footerHint}</p> : null}
          {run || step === "week" || step === "outline" ? (
            <button type="button" className="ghost-button" onClick={back}>{run ? "Stop" : "Back"}</button>
          ) : (
            <button type="button" className="ghost-button" disabled={Boolean(finished?.saving)} onClick={close}>{step === "done" ? "Close" : "Cancel"}</button>
          )}
          {step === "done" && finished ? (
            <>
              {finished.saved ? (
                <button
                  type="button"
                  className={finished.scheduled ? "primary-button" : "ghost-button"}
                  onClick={() => onReadPlan(finished.saved!)}
                >
                  Open plan
                </button>
              ) : (
                <>
                  <button type="button" className="ghost-button" disabled={finished.keeping || finished.saving} onClick={openInEditor}>
                    Edit plan
                  </button>
                  <button type="button" className="ghost-button plan-generator-save" disabled={finished.keeping || finished.saving} onClick={() => void savePlan()}>
                    {finished.saving ? <LoaderCircle className="is-spinning" size={14} /> : null}
                    {finished.saving ? "Saving…" : "Save to COROS"}
                  </button>
                </>
              )}
            </>
          ) : null}
          {step === "done" && finished?.scheduled ? null : (
          <button type="button" className="primary-button" disabled={nextDisabled} onClick={next}>
            {run ? <LoaderCircle className="is-spinning" size={15} /> : (step === "week" && !freshOutline) || step === "outline" ? <Sparkles size={15} /> : null}
            {step === "done" ? <CalendarPlus size={15} /> : null}
            {nextLabel}
            {step === "goal" ? <ArrowRight size={14} /> : null}
          </button>
          )}
        </footer>
        {aiPanelOpen && chatSettings && runtime ? (
          <GeneratorProviderPanel
            settings={chatSettings}
            readiness={readiness}
            claudeStatus={claudeStatus}
            runtime={runtime}
            keepForChat={keepForChat}
            onChange={setRuntime}
            onKeepForChatChange={setKeepForChat}
            onDone={closeAiPanel}
            onOpenCoach={() => { setAiPanelOpen(false); onOpenCoach(); }}
          />
        ) : null}
      </section>
      {calendarOpen && finished ? (
        <TrainingPlanCalendarDialog
          api={api}
          plan={finished.saved ?? { ...finished.plan, id: finished.draftId ?? finished.plan.id }}
          saveFirst={finished.saved ? undefined : saveToCoros}
          defaultStartDay={request.startDate.replace(/-/g, "")}
          onClose={() => setCalendarOpen(false)}
          onAdded={() => {
            setCalendarOpen(false);
            setFinished((current) => (current ? { ...current, scheduled: true } : current));
            if (savedRef.current) onScheduled(savedRef.current);
          }}
        />
      ) : null}
      {pendingSources ? (
        <ConfirmDialog
          title="Redraw the outline?"
          description="Coach drew this outline from what it could read. Changing that means drawing it again: the outline on screen, and any change you asked Coach for, are replaced."
          warning={pendingSourcesProblem ? `${pendingSourcesProblem} Fix that first, then draw the outline again.` : undefined}
          confirmLabel={pendingSourcesProblem ? "Change and fix it" : "Redraw outline"}
          cancelLabel="Keep this outline"
          onConfirm={confirmSources}
          onCancel={() => setPendingSources(null)}
        />
      ) : null}
    </div>
  );
}
