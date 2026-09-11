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
import { StrictMode, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { UnitSystemProvider } from "../../src/units/UnitSystemProvider";
import { ThemeProvider } from "../../src/theme/ThemeProvider";
import { ChatView } from "../../src/chat/ChatView";
import { ConversationAnalyses } from "../../src/chat/analyses/ConversationAnalyses";
import { AnalysisDetailView } from "../../src/chat/analyses/AnalysisDetail";
import { ChatSettingsPanel } from "../../src/chat/ChatSettingsPanel";
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

const MOUNTS: Record<string, (options: Record<string, unknown>) => ReactElement> = {
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

  clickText(selector: string, text: string): boolean {
    const element = findByText(selector, text);
    element?.click();
    return Boolean(element);
  },

  /** What the page shouted while nobody was reading it. */
  consoleErrors: (): string[] => [...consoleErrors],

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
