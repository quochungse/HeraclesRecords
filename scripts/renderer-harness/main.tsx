/**
 * The renderer harness (section 11, phase 3 item 2).
 *
 * Every phase-2 UAT bug was renderer wiring that type-checked, and the only
 * cover any of it had was a regex over the source. A regex says the code is
 * present; it cannot say it runs, and three of those assertions passed against
 * genuinely broken code until they were mutated.
 *
 * This page mounts the **real** components against a stubbed `CorosLinkApi`
 * and exposes a small command surface on `window.__harness`. The driver
 * (`scripts/test-coach-analysis-renderer.mjs`) runs in Electron's main
 * process, loads this page into a hidden window, and asserts in node. Nothing
 * here asserts anything: keeping the assertions on the node side is what lets
 * the suite read like every other `test-*.mjs` and fail with the same output.
 *
 * It runs under Electron rather than a DOM emulation because Electron is
 * already a dev dependency and already hosts a suite (`coach-analysis-sql`),
 * so this costs no new dependency — and because the bugs being chased are the
 * kind a real browser has: effects, event order, and a console nobody read.
 */
import { StrictMode, useState, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { UnitSystemProvider } from "../../src/units/UnitSystemProvider";
import { ThemeProvider } from "../../src/theme/ThemeProvider";
import { ChatView } from "../../src/chat/ChatView";
import { ConversationAnalyses } from "../../src/chat/analyses/ConversationAnalyses";
import { AnalysisDetailView } from "../../src/chat/analyses/AnalysisDetail";
import { ChatSettingsPanel } from "../../src/chat/ChatSettingsPanel";
import { RunningView } from "../../src/running/RunningView";
import { ActivitiesSummary } from "../../src/training/components/ActivitiesSummary";
import { SleepDetailsView } from "../../src/sleep/SleepDetailsView";
import { PromptDialog } from "../../src/training-library/PromptDialog";
import { clampTagInput } from "../../src/training-library/tagInput";
import { PlanReader } from "../../src/training-library/PlanReader";
import { PlanEditor } from "../../src/training-library/PlanEditor";
import { startDraft } from "../../src/training-library/planDraft";
import { ConfirmDialog } from "../../src/training-library/ConfirmDialog";
import { WorkoutWorkspace } from "../../src/training-library/WorkoutWorkspace";
import { TrainingLibraryView } from "../../src/training-library/TrainingLibraryView";
import { ExercisePickerDialog } from "../../src/calendar/ExercisePickerDialog";
import { AddWorkoutModal } from "../../src/calendar/AddWorkoutModal";
import type { CorosLinkApi } from "../../src/coroslink-api";

// ---------------------------------------------------------------------------
// What the driver said should happen
// ---------------------------------------------------------------------------

interface RecordedCall {
  method: string;
  args: unknown[];
}

/**
 * Scripted answers, by method name. A value is returned as-is; the driver
 * cannot send functions across `executeJavaScript`, so a method whose answer
 * has to depend on its arguments is expressed as a **table** instead: a plain
 * object of `JSON.stringify(firstArg)` → answer, under `script.__byArg`.
 */
type Script = Record<string, unknown>;

let script: Script = {};
const calls: RecordedCall[] = [];
const listeners = new Map<string, Set<(payload: unknown) => void>>();
const consoleErrors: string[] = [];

/**
 * Calls the driver has deliberately left hanging, by method name.
 *
 * A run outlives the click that started it — that is the whole of 10's "Run now
 * reflects the run, not the promise" — so a test about what the screen does
 * *while* a fan-out is in flight needs the fan-out to still be in flight. A stub
 * that resolves immediately cannot express that.
 */
const pending = new Map<string, (value: unknown) => void>();

function scriptedAnswer(method: string, args: unknown[]): unknown {
  const table = (script.__byArg as Record<string, Record<string, unknown>>)?.[
    method
  ];
  if (table) {
    const key = JSON.stringify(args[0] ?? null);
    if (key in table) return table[key];
    if ("*" in table) return table["*"];
  }
  return script[method];
}

/**
 * Every method the components reach for, recorded and answered. A Proxy rather
 * than a hand-written double on purpose: `CorosLinkApi` is ~200 methods and a
 * component reaching for one nobody thought to stub should get `undefined` and
 * carry on, not take the harness down — the same as a preload that is one
 * version behind.
 */
/**
 * The transcript row, for tests about the window racing its own writes.
 *
 * Opt-in via `__persistChatSessions`, because most tests want a fixed answer
 * from `getChatSession` and would be confused by one that moves. With it on,
 * `saveChatSession` keeps what it was given and `getChatSession` hands it back
 * — which is the one property of the real store those races turn on: a read
 * taken before a write lands does not see the write.
 */
const chatRows = new Map<string, unknown[]>();

function chatRowAnswer(method: string, args: unknown[]): unknown | undefined {
  if (script.__persistChatSessions !== true) return undefined;
  const id = typeof args[0] === "string" ? args[0] : null;
  if (!id) return undefined;
  if (method === "saveChatSession") {
    chatRows.set(id, (args[1] as unknown[]) ?? []);
    return { id, title: "row", updatedAt: new Date().toISOString() };
  }
  if (method === "getChatSession") {
    return chatRows.get(id) ?? (scriptedAnswer(method, args) as unknown[]) ?? [];
  }
  return undefined;
}

function createStubApi(): CorosLinkApi {
  const cache = new Map<string, unknown>();
  return new Proxy({} as CorosLinkApi, {
    get(_target, property) {
      if (typeof property !== "string") return undefined;
      const cached = cache.get(property);
      if (cached) return cached;

      // `on*` is the push half of the bridge, and the half every one of the
      // phase-2 bugs was on. The driver fires these by name.
      const value = property.startsWith("on")
        ? (callback: (payload: unknown) => void) => {
            let set = listeners.get(property);
            if (!set) listeners.set(property, (set = new Set()));
            set.add(callback);
            return () => {
              set?.delete(callback);
            };
          }
        : (...args: unknown[]) => {
            calls.push({ method: property, args });
            const row = chatRowAnswer(property, args);
            if (row !== undefined) return Promise.resolve(row);
            const answer = scriptedAnswer(property, args);
            if (answer === "__pending") {
              return new Promise((resolve) => pending.set(property, resolve));
            }
            return Promise.resolve(answer);
          };
      cache.set(property, value);
      return value;
    }
  });
}

const api = createStubApi();

// ---------------------------------------------------------------------------
// The components under test
// ---------------------------------------------------------------------------

/**
 * A prop callback the driver can assert on. It lands in the same `calls` log
 * as an api call, under `prop:<name>`, because "did the component tell its
 * parent" is the same kind of question as "did it tell main".
 */
const spy = (name: string) => (...args: unknown[]) => {
  calls.push({ method: `prop:${name}`, args });
};

/**
 * The app stylesheet, loaded only by mounts that assert on layout.
 *
 * Every other suite here has always run without it, and pulling it in for all
 * of them would change the ground their assertions stand on. It is imported
 * lazily, the first time such a mount is asked for, and the driver waits on
 * `appStylesReady` before it measures anything.
 */
let appStylesReady = false;
function loadAppStyles() {
  if (appStylesReady) return;
  void import("../../src/styles.css").then(() => {
    appStylesReady = true;
  });
}

/**
 * The same, plus the Activities stylesheet.
 *
 * `activities.css` is imported by `ActivitiesView`, not by the pieces it is
 * built from, so a mount of one of those pieces on its own gets none of its
 * styling — and a layout assertion would then be measuring unstyled boxes and
 * passing. Kept apart from `loadAppStyles` so the suites that predate it go on
 * standing on exactly the ground they were written against.
 */
/** The same, plus the Training Library's own stylesheet. */
function loadLibraryStyles() {
  if (appStylesReady) return;
  void Promise.all([
    import("../../src/styles.css"),
    import("../../src/training-library/trainingLibrary.css")
  ]).then(() => {
    appStylesReady = true;
  });
}

function loadActivitiesStyles() {
  if (appStylesReady) return;
  void Promise.all([
    import("../../src/styles.css"),
    import("../../src/training/activities.css")
  ]).then(() => {
    appStylesReady = true;
  });
}

function PlanEditorHarness({ options }: { options: Record<string, unknown> }) {
  const [draft, setDraft] = useState(() => startDraft(options.plan as never));
  return (
    <div
      className="tl-plan-modal-backdrop"
      style={{
        position: "relative",
        inset: "auto",
        padding: 0,
        width: `${(options.width as number | undefined) ?? 1180}px`,
        height: `${(options.height as number | undefined) ?? 800}px`
      }}
    >
      <div className="tl-plan-modal">
        <PlanEditor
          api={api}
          draft={draft}
          onDraftChange={setDraft}
          workouts={(options.workouts as never) ?? []}
          isNew={(options.isNew as boolean | undefined) ?? false}
          onSave={async (plan) => {
            spy("onSave")(plan);
          }}
          onSaveDraft={async (plan) => {
            spy("onSaveDraft")(plan);
          }}
          onClose={spy("onClose")}
        />
      </div>
    </div>
  );
}

const MOUNTS: Record<string, (options: Record<string, unknown>) => ReactElement> = {
  // Inside the same column the app gives it — `.content.content-fill` clips, so
  // the page has to scroll itself — at a fixed height, because every layout
  // trap this screen has hit only exists in a column that cannot grow.
  RunningView: (options) => {
    loadAppStyles();
    return (
      <main
        className="content content-fill"
        style={{
          height: `${(options.height as number | undefined) ?? 700}px`,
          // The column's width, not the window's: a hidden window ignores being
          // resized, and the column is what this layout responds to anyway.
          ...(typeof options.width === "number" ? { width: `${options.width}px` } : {})
        }}
      >
        <RunningView
          api={api}
          activities={(options.activities as never) ?? []}
          connected={(options.connected as boolean | undefined) ?? true}
          restoring={false}
          activitiesStatus={(options.activitiesStatus as never) ?? "ready"}
          detail={(options.detail as never) ?? null}
          detailRequest={(options.detailRequest as never) ?? null}
          snapshot={(options.snapshot as never) ?? null}
          busy={(options.busy as string | null | undefined) ?? null}
          onSelectActivity={spy("onSelectActivity")}
          onRetryActivities={spy("onRetryActivities")}
          onOpenOverview={spy("onOpenOverview")}
        />
      </main>
    );
  },
  /*
   * The summary strip on its own, inside the class that scopes its tokens.
   * Everything asserted about it is geometry — a tooltip that must not leave
   * the bar, a bar that must not move what is under it — so it is mounted at a
   * stated width rather than the window's.
   */
  /*
   * The Training Library's replacement for `window.prompt`, which Electron does
   * not implement. Mounted with the library stylesheet because what is asserted
   * about it is behaviour a hidden window still has — focus, Escape, submit,
   * and which mousedown dismisses it.
   */
  PromptDialog: (options) => {
    loadLibraryStyles();
    return (
      <PromptDialog
        title={(options.title as string | undefined) ?? "Tag this workout"}
        description={options.description as string | undefined}
        label={(options.label as string | undefined) ?? "Tags, separated by commas"}
        initialValue={(options.initialValue as string | undefined) ?? ""}
        type={(options.type as "text" | "date" | undefined) ?? "text"}
        min={options.min as string | undefined}
        /* The tag dialogs' own sanitizer, named rather than passed: a function
           cannot cross the harness's JSON mount options. */
        sanitize={options.sanitize === "tags" ? clampTagInput : undefined}
        confirmLabel={(options.confirmLabel as string | undefined) ?? "Save"}
        onConfirm={spy("onConfirm")}
        onCancel={spy("onCancel")}
      />
    );
  },
  /*
   * The plan reader in a column that cannot grow, which is the only place its
   * layout is interesting: it scrolls itself, and a day row is a two-column
   * grid whose label gutter has to hold at every width.
   */
  PlanReader: (options) => {
    loadLibraryStyles();
    return (
      <main
        className="content content-fill"
        style={{
          display: "flex",
          height: `${(options.height as number | undefined) ?? 700}px`,
          ...(typeof options.width === "number" ? { width: `${options.width}px` } : {})
        }}
      >
        <PlanReader
          plan={options.plan as never}
          matches={(options.matches as never) ?? []}
          offline={(options.offline as boolean | undefined) ?? false}
          loadingFull={(options.loadingFull as boolean | undefined) ?? false}
          duplicating={(options.duplicating as boolean | undefined) ?? false}
          /* A date cannot cross the mount options, so the clock travels as a string. */
          today={typeof options.today === "string" ? new Date(options.today) : undefined}
          onBack={spy("onBack")}
          onEdit={spy("onEdit")}
          onDuplicate={spy("onDuplicate")}
          onCalendar={spy("onCalendar")}
          onFavorite={spy("onFavorite")}
          onArchive={spy("onArchive")}
          onDelete={spy("onDelete")}
          onOpenActivity={spy("onOpenActivity")}
        />
      </main>
    );
  },
  /*
   * The plan editor inside the backdrop it is portalled into in the app,
   * because that is where half of its bugs lived: the library's button rules
   * were scoped to the view, and the backdrop is outside it. Pinned to a stated
   * size rather than fixed over the window, so the width the weeks get is the
   * test's to choose. The draft is held here, as the view holds it.
   */
  PlanEditor: (options) => {
    loadLibraryStyles();
    return <PlanEditorHarness options={options} />;
  },
  /*
   * The whole library screen, snapshot scripted through
   * `getTrainingLibrarySnapshot`. The reader and the session view are layers
   * over the index, so their geometry is only honest with the scrim, the sheet
   * and the index underneath actually there.
   */
  TrainingLibraryView: (options) => {
    loadLibraryStyles();
    return (
      <main
        className="content content-fill"
        style={{
          display: "flex",
          height: `${(options.height as number | undefined) ?? 900}px`
        }}
      >
        <TrainingLibraryView
          api={api}
          status={{ authenticated: true } as never}
          onOpenTraining={spy("onOpenTraining")}
          onOpenCoach={spy("onOpenCoach")}
          onMessage={spy("onMessage")}
          onError={spy("onError")}
          onScheduleChanged={spy("onScheduleChanged")}
          onOpenActivity={spy("onOpenActivity")}
        />
      </main>
    );
  },
  /*
   * The Workouts tab in a column that cannot grow, which is where its layout
   * is interesting: the list and the detail pane split the width, and the
   * detail pane draws the Calendar's own workout view.
   */
  WorkoutWorkspace: (options) => {
    loadLibraryStyles();
    return (
      <main
        className="content content-fill"
        style={{
          display: "flex",
          height: `${(options.height as number | undefined) ?? 700}px`,
          ...(typeof options.width === "number" ? { width: `${options.width}px` } : {})
        }}
      >
        <section className="training-library-view">
          <WorkoutWorkspace
            api={api}
            workouts={(options.workouts as never) ?? []}
            onRefresh={async () => undefined}
            onMessage={spy("onMessage")}
            onError={spy("onError")}
          />
        </section>
      </main>
    );
  },
  /** The whole Create-workout dialog, portal and all. Mounted for the narrow
      layout, which is a single scrolling column and has twice grown an overlap
      the wide one cannot have. */
  AddWorkoutModal: (options) => {
    loadAppStyles();
    return (
      <AddWorkoutModal
        api={api}
        dateKey={(options.dateKey as string | undefined) ?? "20991231"}
        sportTypes={(options.sportTypes as never) ?? []}
        libraryOnly={(options.libraryOnly as boolean | undefined) ?? true}
        onClose={spy("onClose")}
        onScheduled={spy("onScheduled")}
        onError={spy("onError")}
      />
    );
  },
  /** The exercise library screen. It portals to `document.body`, so nothing
      here wraps it — the driver measures it where it lands. */
  ExercisePickerDialog: (options) => {
    loadAppStyles();
    return (
      <ExercisePickerDialog
        title={(options.title as string | undefined) ?? "Exercise"}
        options={(options.options as never) ?? []}
        selectedId={options.selectedId as string | undefined}
        loading={(options.loading as boolean | undefined) ?? false}
        onPick={spy("onPick")}
        onClose={spy("onClose")}
      />
    );
  },
  ConfirmDialog: (options) => {
    loadLibraryStyles();
    return (
      <ConfirmDialog
        title={(options.title as string | undefined) ?? "Discard unsaved changes?"}
        description={options.description as string | undefined}
        confirmLabel={(options.confirmLabel as string | undefined) ?? "Discard changes"}
        cancelLabel={options.cancelLabel as string | undefined}
        danger={(options.danger as boolean | undefined) ?? false}
        onConfirm={spy("onConfirm")}
        onCancel={spy("onCancel")}
      />
    );
  },
  ActivitiesSummary: (options) => {
    loadActivitiesStyles();
    return (
      <div
        className="activities-view"
        style={{ width: `${(options.width as number | undefined) ?? 1200}px` }}
      >
        <ActivitiesSummary
          totals={options.totals as never}
          periodLabel={(options.periodLabel as string | undefined) ?? "3 months"}
        />
      </div>
    );
  },
  /*
   * The Sleep screen, in a column of a stated height.
   *
   * What is asserted on it is geometry and traffic: the curve's box must not
   * shrink while a night's samples are on their way, and a night this screen
   * has already been shown must not be asked for again. `sleep.css` arrives
   * with the view itself; `styles.css` does not, and without it the boxes are
   * unstyled and every height measured is a different page's.
   */
  SleepDetailsView: (options) => {
    loadAppStyles();
    return (
      <main
        className="content"
        style={{
          height: `${(options.height as number | undefined) ?? 900}px`,
          // The column's width, not the window's. The metric tiles are an
          // `auto-fit` grid, so how many land in a row — and therefore which
          // one is at an edge — is decided here.
          ...(typeof options.width === "number" ? { width: `${options.width}px` } : {})
        }}
      >
        <SleepDetailsView
          api={api}
          connected={(options.connected as boolean | undefined) ?? true}
          trendPoints={(options.trendPoints as never) ?? []}
          onOpenOverview={spy("onOpenOverview")}
        />
      </main>
    );
  },
  ChatView: (options) => (
    <ChatView
      api={api}
      onError={spy("onError") as () => void}
      // The Coach panel stays mounted behind other views, so "mounted" and "on
      // screen" are two different props' worth of question and a test has to be
      // able to ask the second one.
      active={(options.active as boolean | undefined) ?? true}
      onActivityChange={spy("onActivityChange") as (active: boolean) => void}
    />
  ),
  AnalysisDetailView: (options) => (
    <AnalysisDetailView
      api={api}
      analysisId={(options.analysisId as string | undefined) ?? "a1"}
      provider="claude-code"
      initialTab={
        (options.tab as "settings" | "runs" | undefined) ?? "settings"
      }
      onBack={spy("onBack")}
      onChanged={spy("onChanged")}
    />
  ),
  // The feature-wide analysis controls — the pause and the monthly ceiling —
  // live in Settings now that there is no analyses screen to host them.
  ChatSettingsPanel: () => (
    <ChatSettingsPanel
      api={api}
      chatSettings={{
        provider: "claude-code",
        chatgpt: {} as never,
        anthropic: {} as never,
        claudeCode: {} as never,
        openRouter: {} as never,
        local: {} as never,
        customInstructions: "",
        compactContext: { enabled: true, limit: 60, keep: 20 }
      }}
      coachModelsSummary=""
      onOpenCoachModels={spy("onOpenCoachModels")}
      onUpdateChatSettings={spy("onUpdateChatSettings")}
    />
  ),
  ConversationAnalyses: (options) => (
    <ConversationAnalyses
      api={api}
      sessionId={(options.sessionId as string | null) ?? "s1"}
      onChanged={spy("onChanged")}
      onCreateAnalysis={spy("onCreateAnalysis")}
      onOpenAnalysis={spy("onOpenAnalysis")}
    />
  )
};

// ---------------------------------------------------------------------------
// The command surface the driver talks to
// ---------------------------------------------------------------------------

let root: Root | null = null;
/** What the last `mount` asked for, so `setProps` can re-render the same thing. */
let mounted: { name: string; options: Record<string, unknown> } | null = null;

function query(selector: string): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(selector)];
}

/**
 * Elements are matched by their visible text rather than by index, because an
 * index is a claim about layout and none of these tests are about layout.
 */
function findByText(selector: string, text: string): HTMLElement | undefined {
  return query(selector).find((element) =>
    (element.textContent ?? "").includes(text)
  );
}

/**
 * StrictMode on purpose: it double-invokes effects, which is how a subscription
 * that never unsubscribes and an effect that is not idempotent both announce
 * themselves.
 *
 * Both providers are the app's own, not stubs. They are the contexts these
 * components read, and they throw without them — which is the harness earning
 * its keep before it has asserted anything.
 *
 * `ThemeProvider` is here because the chart cards read the theme to pick their
 * colours. Without it a transcript carrying one renders as
 * "useTheme must be used within a ThemeProvider" and takes the whole transcript
 * down with it, which reads in a test as the entries never having arrived.
 */
function renderMounted() {
  if (!root || !mounted) return;
  root.render(
    <StrictMode>
      <ThemeProvider>
        <UnitSystemProvider>
          {MOUNTS[mounted.name](mounted.options)}
        </UnitSystemProvider>
      </ThemeProvider>
    </StrictMode>
  );
}

const harness = {
  /** Mounts one component. `script` replaces whatever the last test set. */
  mount(name: string, options: Record<string, unknown> = {}, next: Script = {}) {
    harness.unmount();
    script = next;
    calls.length = 0;
    consoleErrors.length = 0;
    chatRows.clear();
    const container = document.getElementById("root") as HTMLElement;
    pending.clear();
    mounted = { name, options };
    root = createRoot(container);
    renderMounted();
  },

  /**
   * Re-renders the mounted component with changed props, keeping its state.
   *
   * A remount would answer a different question: whether the surface gets it
   * right on a fresh mount. What a prop test is about is the surface reacting
   * to the parent changing its mind — the athlete switching away from the Coach
   * view and back — with everything the component has learned still in place.
   */
  setProps(patch: Record<string, unknown>) {
    if (!mounted) return false;
    mounted = { ...mounted, options: { ...mounted.options, ...patch } };
    renderMounted();
    return true;
  },

  /**
   * Changes what main would answer from here on, without remounting.
   *
   * The point of a push test is that the *main process* changed and the surface
   * has to notice — so the driver has to be able to move that world between the
   * mount read and the push. Merged rather than replaced, so a test says only
   * what it changed.
   */
  setScript(patch: Script) {
    script = { ...script, ...patch };
  },

  /** Answers a call the script left hanging. */
  resolvePending(method: string, value: unknown = null): boolean {
    const resolve = pending.get(method);
    if (!resolve) return false;
    pending.delete(method);
    resolve(value);
    return true;
  },

  unmount() {
    root?.unmount();
    root = null;
    mounted = null;
    listeners.clear();
    (document.getElementById("root") as HTMLElement).innerHTML = "";
  },

  calls: (method?: string): RecordedCall[] =>
    method ? calls.filter((entry) => entry.method === method) : [...calls],

  callCount: (method: string): number =>
    calls.filter((entry) => entry.method === method).length,

  /** Forgets the log, so a "did it re-read" question is about what came after. */
  clearCalls() {
    calls.length = 0;
  },

  /** Fires a push from main. Returns how many listeners heard it. */
  emit(channel: string, payload: unknown): number {
    const set = listeners.get(channel);
    set?.forEach((callback) => callback(payload));
    return set?.size ?? 0;
  },

  exists: (selector: string): boolean => query(selector).length > 0,
  count: (selector: string): number => query(selector).length,
  text: (selector: string): string | null =>
    query(selector)[0]?.textContent?.trim() ?? null,

  attr: (selector: string, name: string, nth = 0): string | null =>
    query(selector)[nth]?.getAttribute(name) ?? null,

  /** Types into a controlled input or textarea the way React's onChange expects. */
  setValue(selector: string, value: string): boolean {
    const element = query(selector)[0] as HTMLInputElement | undefined;
    if (!element) return false;
    // React installs its own value setter on the element; going through the
    // prototype's is what makes it notice the change rather than swallow it.
    //
    // Which prototype is not a detail: a textarea's `value` setter lives on
    // `HTMLTextAreaElement`, and calling the input one on it throws "Illegal
    // invocation" rather than doing nothing — which is how the chat composer,
    // the only multi-line field on any of these screens, was unreachable.
    const setter = Object.getOwnPropertyDescriptor(
      element instanceof window.HTMLTextAreaElement
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype,
      "value"
    )?.set;
    setter?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  },

  focus(selector: string): boolean {
    const element = query(selector)[0] as HTMLElement | undefined;
    if (!element) return false;
    element.focus();
    // `focusin`, the mirror of `blur` below. A hidden window's document is not
    // the focused one, and Chromium holds the focus *events* back until it is —
    // so `.focus()` moves `activeElement` and React hears nothing.
    element.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    return document.activeElement === element;
  },

  /**
   * Points at an element the way React hears it.
   *
   * `onMouseEnter` is not a DOM event: React synthesises it from the delegated
   * `mouseover`/`mouseout` pair, so a dispatched `mouseenter` is swallowed and
   * the handler never runs. `relatedTarget` is what says where the pointer came
   * from, and React reads it to decide which enters and leaves to fire.
   */
  hover(selector: string, nth = 0): boolean {
    const element = query(selector)[nth];
    if (!element) return false;
    element.dispatchEvent(
      new MouseEvent("mouseover", { bubbles: true, relatedTarget: document.body })
    );
    return true;
  },

  /** Takes the pointer off, to `document.body`, which is outside everything. */
  unhover(selector: string, nth = 0): boolean {
    const element = query(selector)[nth];
    if (!element) return false;
    element.dispatchEvent(
      new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body })
    );
    return true;
  },

  keyDown(selector: string, key: string): boolean {
    const element = query(selector)[0];
    if (!element) return false;
    element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    return true;
  },

  /** One computed style value, for assertions about what a state class did. */
  style(selector: string, property: string, nth = 0): string | null {
    const element = query(selector)[nth];
    return element ? window.getComputedStyle(element).getPropertyValue(property) : null;
  },

  blur(selector: string): boolean {
    const element = query(selector)[0];
    if (!element) return false;
    // `focusout`, not `blur`: React delegates from the root, and `blur` does
    // not bubble there — a synthetic one is swallowed and `onBlur` never runs.
    element.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    return true;
  },

  value: (selector: string): string | null =>
    (query(selector)[0] as HTMLInputElement | undefined)?.value ?? null,

  click(selector: string): boolean {
    const element = query(selector)[0];
    element?.click();
    return Boolean(element);
  },

  /**
   * The nth match, for a list whose rows differ only in the data on them. The
   * text of a sleep night is a date, and asserting against a date computed twice
   * proves less than picking the row by where it sits in the run.
   */
  clickNth(selector: string, nth: number): boolean {
    const element = query(selector)[nth];
    element?.click();
    return Boolean(element);
  },

  clickText(selector: string, text: string): boolean {
    const element = findByText(selector, text);
    element?.click();
    return Boolean(element);
  },

  /** What the page shouted while nobody was reading it. */
  consoleErrors: (): string[] => [...consoleErrors],

  /** Whether a layout mount's stylesheet has finished loading. */
  appStylesReady: (): boolean => appStylesReady,

  /** Sets a scroll position, for tests about where a page returns to. */
  scrollTo(selector: string, top: number): number | null {
    const element = query(selector)[0];
    if (!element) return null;
    element.scrollTop = top;
    return element.scrollTop;
  },

  scrollTop: (selector: string): number | null => query(selector)[0]?.scrollTop ?? null,

  /** A box, rounded, for assertions about how big something ended up. */
  rect(
    selector: string,
    nth = 0
  ): { width: number; height: number; top: number; left: number; right: number } | null {
    const box = query(selector)[nth]?.getBoundingClientRect();
    return box
      ? {
          width: Math.round(box.width),
          height: Math.round(box.height),
          top: Math.round(box.top),
          left: Math.round(box.left),
          right: Math.round(box.right)
        }
      : null;
  },

  /**
   * One metric tile, found by the label it sits under, with whatever its hover
   * note holds. The tiles are a grid whose order follows the data, so naming
   * one by its label is the only way to ask about it that survives a tile being
   * added beside it.
   */
  metricTile(
    label: string
  ): { label: string; value: string; note: string | null } | null {
    const tile = query(".sleep-metric, .sleep-detail-metric").find(
      (element) =>
        (element.querySelector("dt")?.textContent ?? "").trim().toLowerCase() ===
        label.toLowerCase()
    );
    if (!tile) return null;
    return {
      label,
      value: (tile.querySelector("dd")?.textContent ?? "").trim(),
      note: tile.querySelector(".sleep-metric-note")?.textContent ?? null
    };
  },

  /**
   * Every hover note inside one row, measured against that row.
   *
   * A note is transparent until it is pointed at, and opacity is not what puts
   * it off the panel — its box is laid out either way, which is what makes this
   * answerable without hovering each one in turn.
   */
  noteBounds(rowSelector: string): Array<{
    side: string | null;
    left: number;
    right: number;
    rowLeft: number;
    rowRight: number;
  }> {
    const row = query(rowSelector)[0];
    if (!row) return [];
    const bounds = row.getBoundingClientRect();
    return [...row.querySelectorAll<HTMLElement>(".sleep-metric-note")].map(
      (note) => {
        const box = note.getBoundingClientRect();
        return {
          side: note.getAttribute("data-note-side"),
          left: Math.round(box.left),
          right: Math.round(box.right),
          rowLeft: Math.round(bounds.left),
          rowRight: Math.round(bounds.right)
        };
      }
    );
  },

  /** How far an element's content runs past its own box, horizontally. */
  overflowX(selector: string): number | null {
    const element = query(selector)[0];
    return element ? element.scrollWidth - element.clientWidth : null;
  },

  /**
   * Takes the clock out of every transition and animation on the page.
   *
   * A hidden window lays out but does not paint, and a transition is driven by
   * frames — so a transitioned property read after a state change is whatever
   * the last frame left behind, which in this window arrives when it arrives. A
   * test about *what a state looks like* has no business waiting on that; one
   * about the animation itself could not run here at all.
   */
  freezeAnimations(): boolean {
    if (document.getElementById("harness-freeze")) return true;
    const style = document.createElement("style");
    style.id = "harness-freeze";
    style.textContent =
      "*, *::before, *::after { transition-duration: 0s !important; " +
      "animation-duration: 0s !important; animation-delay: 0s !important; }";
    document.head.append(style);
    return true;
  },

  /** Proves the driver is talking to the dev build, so React's warnings exist. */
  dev: (): boolean => import.meta.env.DEV
};

const nativeError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  consoleErrors.push(args.map((arg) => String(arg)).join(" "));
  nativeError(...args);
};
window.addEventListener("error", (event) => {
  consoleErrors.push(`uncaught: ${event.message}`);
});
window.addEventListener("unhandledrejection", (event) => {
  consoleErrors.push(`unhandled rejection: ${String(event.reason)}`);
});

Object.assign(window as never, { __harness: harness });
