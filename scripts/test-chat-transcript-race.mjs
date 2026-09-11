// The window racing its own writes, executed rather than reasoned about.
//
// Reported from a packaged build: the athlete asked "Phân tích buổi tập gần
// đây của tôi", watched it work and print a chart, and then the whole turn came
// off the screen leaving only the question. Reopening the app did not bring it
// back.
//
// The mechanism needs three things to line up, which is why nothing caught it:
// a sync pull carrying `chat_sessions` has to land *during* a turn, the turn
// has to end (the pull's re-read is deliberately deferred to exactly that
// moment), and the re-read has to reach SQLite before the turn's own save does.
// The row then still holds the transcript as it was before the turn — the
// question is saved at send time, the answer only at the end — and the reload
// put that on screen. It also cancelled the pending save that held the answer,
// so the only copy of it was dropped.
//
// Runs the real ChatView in Electron's Chromium against the harness stub, with
// the stub keeping the row so that "a read taken before a write lands does not
// see the write" is a property of the test and not an assumption of it.
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { app, BrowserWindow } = require("electron");

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

app.commandLine.appendSwitch("no-sandbox");
app.disableHardwareAcceleration();

const CHAT_SETTINGS = {
  provider: "claude-code",
  chatgpt: {},
  anthropic: { model: "claude-opus-5", effort: "high", hasApiKey: false },
  claudeCode: {
    useAppScopedAuth: true,
    effort: "high",
    permissions: {
      recentActivities: true,
      trainingMetrics: true,
      upcomingWorkouts: true,
      sleepData: false,
      fullActivityFiles: false
    }
  },
  local: {
    baseUrl: "http://localhost:11434/v1",
    model: "",
    hasApiKey: false,
    toolsEnabled: true
  },
  sidebarOpen: true,
  visualizationsEnabled: true,
  customInstructions: ""
};

const SESSION = {
  id: "s1",
  title: "Phân tích buổi tập",
  provider: "claude-code",
  createdAt: "2026-09-11T06:00:00.000Z",
  updatedAt: "2026-09-11T06:00:00.000Z"
};

const BASE_SCRIPT = {
  __persistChatSessions: true,
  getChatAuthStatus: { signedIn: true },
  getChatSettings: CHAT_SETTINGS,
  getClaudeCodeStatus: { state: "connected" },
  getCorosMcpStatus: { connected: false },
  getMcpStatuses: [],
  listChatSessions: [SESSION],
  getChatSession: [],
  listCoachAnalysisSessionAttention: [],
  listCoachAnalysesForSession: [],
  sendChat: null,
  compactChatContext: null
};

let win;

function harness(method, ...args) {
  const list = args.map((value) => JSON.stringify(value)).join(", ");
  return win.webContents
    .executeJavaScript(`window.__harness.${method}(${list})`, true)
    .catch((error) => {
      throw new Error(`harness ${method} failed: ${error.message}`);
    });
}

async function waitFor(read, what, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  for (;;) {
    last = await read();
    if (last) return last;
    if (Date.now() > deadline) {
      assert.fail(`timed out waiting for: ${what} (last saw ${JSON.stringify(last)})`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** Effects, promises and the 300 ms persist debounce, all settled. */
async function settle() {
  for (let pass = 0; pass < 8; pass += 1) {
    await win.webContents.executeJavaScript(
      "new Promise((resolve) => setTimeout(resolve, 60))",
      true
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function main() {
  await app.whenReady();
  win = new BrowserWindow({
    show: false,
    width: 1600,
    height: 1200,
    // A hidden window has its timers throttled, and this suite is all debounces.
    webPreferences: { backgroundThrottling: false }
  });
  await win.loadFile(path.join(repoRoot, "dist-harness", "index.html"));
  assert.equal(
    await win.webContents.executeJavaScript("typeof window.__harness", true),
    "object",
    "the harness page has to be built before it can be driven"
  );
  assert.equal(await harness("dev"), true, "the harness must be the dev build");

  // -------------------------------------------------------------------------
  // A sync pull landing mid-turn must not take the answer off the screen
  // -------------------------------------------------------------------------
  {
    await harness("mount", "ChatView", {}, BASE_SCRIPT);
    await waitFor(
      () => harness("exists", ".chat-composer textarea"),
      "ChatView renders its composer"
    );
    // The conversation ChatView opened on mount has to be the one being saved,
    // or the rest of this proves nothing about the row.
    await waitFor(
      () => harness("callCount", "getChatSession"),
      "the conversation is open"
    );

    await harness("setValue", ".chat-composer textarea", "Phân tích buổi tập gần đây của tôi");
    await harness("click", ".chat-send");
    const sent = await waitFor(
      async () => (await harness("calls", "sendChat"))[0],
      "the turn reaches main"
    );
    const requestId = sent.args[0];

    // The question is on disk from here — that is why it is the one thing that
    // survived on the athlete's screen.
    await settle();
    const rowAfterSend = await harness("calls", "saveChatSession");
    assert.ok(
      rowAfterSend.some((call) =>
        JSON.stringify(call.args[1]).includes("Phân tích buổi tập gần đây")
      ),
      "the athlete's question is saved at send time"
    );

    await harness("emit", "onChatStreamStart", { requestId });

    // The chart the athlete watched arrive. A tool writes it straight into the
    // timeline mid-turn, and nothing saves it there: the autosave is held down
    // for the whole turn, so until the turn ends this card exists only on
    // screen. That is what makes it the thing a re-read can destroy.
    await harness("emit", "onChatStreamInfo", {
      requestId,
      kind: "fitnessTrend",
      preview: {
        previewId: "trend-1",
        windowDays: 7,
        trendPoints: [
          { date: "2026-09-09", label: "Wed", trainingLoad: 120, rhr: 47 },
          { date: "2026-09-10", label: "Thu", trainingLoad: 240, rhr: 48 }
        ]
      }
    });
    await waitFor(
      () => harness("exists", ".chat-row-assistant"),
      "the chart card is on screen"
    );

    // The pull. Mid-turn it must defer rather than re-read, which is the part
    // that already worked — and the part that lands the re-read on the exact
    // tick the turn ends.
    await harness("emit", "onSyncChanged", {
      tables: ["chat_sessions"],
      pulled: 1,
      applied: 1
    });
    await settle();
    assert.equal(
      await harness("exists", ".chat-row-assistant"),
      true,
      "a pull mid-turn must not disturb the turn on screen"
    );

    // The turn ends with no answer — the "stop" in the report. `finishStreaming`
    // writes nothing when there is no final text, so the only copy of the chart
    // is still the one on screen, and the whole turn now rests on the autosave
    // that the end of the turn releases. The deferred re-read fires on this
    // same tick, and used to cancel exactly that save.
    await harness("emit", "onChatStreamDone", { requestId, fullText: "" });
    await settle();

    assert.equal(
      await harness("exists", ".chat-row-assistant"),
      true,
      "the chart must survive the re-read the pull deferred to this moment"
    );
    assert.match(
      (await harness("text", ".chat-transcript")) ?? "",
      /Phân tích buổi tập gần đây/,
      "and so must the question"
    );

    // The screen is only half of it: reopening the app did not bring the turn
    // back either, because the cancelled save was the only copy. Whatever is on
    // screen has to have reached the row.
    const saves = await harness("calls", "saveChatSession");
    const lastSave = saves[saves.length - 1];
    assert.ok(
      JSON.stringify(lastSave.args[1]).includes("trend-1"),
      "the last thing written to the row must still contain the chart"
    );

    const errors = (await harness("consoleErrors")).filter(
      (line) => !/not wrapped in act/i.test(line)
    );
    assert.deepEqual(errors, [], "a turn ending under a pull must not log");
  }

  // -------------------------------------------------------------------------
  // And the same read, arriving the other way
  // -------------------------------------------------------------------------
  // An analysis run finishing re-reads the transcript immediately, mid-turn and
  // on purpose — it writes into the row from the main process, so waiting would
  // let the athlete's turn save over it. That path reaches the same reload, so
  // it has to keep the athlete's own entries too.
  {
    await harness("mount", "ChatView", {}, BASE_SCRIPT);
    await waitFor(
      () => harness("exists", ".chat-composer textarea"),
      "ChatView renders its composer"
    );
    await harness("setValue", ".chat-composer textarea", "Tuần này thế nào");
    await harness("click", ".chat-send");
    const sent = await waitFor(
      async () => (await harness("calls", "sendChat"))[0],
      "the turn reaches main"
    );

    await harness("emit", "onChatStreamStart", { requestId: sent.args[0] });
    await harness("emit", "onCoachAnalysisRunUpdate", {
      id: "r1",
      analysisId: "a1",
      status: "success",
      triggerKind: "schedule",
      sessionId: "s1",
      startedAt: "2026-09-11T06:30:00.000Z"
    });
    await settle();

    assert.match(
      (await harness("text", ".chat-transcript")) ?? "",
      /Tuần này thế nào/,
      "a run reloading mid-turn must not take the athlete's question off the screen"
    );
  }

  // -------------------------------------------------------------------------
  // A row that already carries a duplicated card still renders
  // -------------------------------------------------------------------------
  // The store no longer writes duplicates, but rows written before it stopped
  // are still on disk — one conversation replays eight entries of its own
  // history, two chart cards sharing a `previewId` among them — and a row can
  // also arrive from another machine. Keyed on the id alone, React warned
  // "Encountered two children with the same key" on opening it and is free to
  // drop or duplicate the row; the transcript has to show what it holds.
  {
    const card = {
      kind: "fitnessTrend",
      preview: {
        previewId: "fitness-trends:dup",
        windowDays: 7,
        trendPoints: [
          { date: "2026-09-09", label: "Wed", trainingLoad: 120 },
          { date: "2026-09-10", label: "Thu", trainingLoad: 240 }
        ]
      }
    };
    await harness("mount", "ChatView", {}, {
      ...BASE_SCRIPT,
      __persistChatSessions: false,
      getChatSession: [
        { kind: "message", role: "user", content: "Phân tích buổi chạy trước" },
        card,
        { kind: "message", role: "assistant", content: "Lần một." },
        card,
        { kind: "message", role: "assistant", content: "Lần hai." }
      ]
    });
    await waitFor(
      async () => (await harness("count", ".chat-visual-card")) === 2,
      "both copies of the card are on screen"
    );
    const keyWarnings = (await harness("consoleErrors")).filter((line) =>
      /same key/i.test(line)
    );
    assert.deepEqual(keyWarnings, [], "a duplicated card must not collide on its key");
  }

  console.log("chat transcript race tests passed");
}

main().then(
  () => app.exit(0),
  (error) => {
    console.error(error);
    app.exit(1);
  }
);
