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
  // A settled turn is drawn as it is, not faded in from nothing
  // -------------------------------------------------------------------------
  // Reported: the moment the coach finished, the new answer vanished, and came
  // back on the first scroll or click in the transcript. Measured over CDP in
  // the running app: 100 ms after the end, the answer row and the card it asked
  // were both at `opacity: 0` under `chat-row-enter` — the streaming bubble had
  // been swapped for freshly mounted rows, which faded in again from nothing,
  // and on a window getting no frames the fade never ran.
  {
    const nextCard = {
      promptId: "card-next",
      question: "Muốn xem gì tiếp?",
      allowCustom: false,
      choices: [
        { id: "n1", label: "Khối lượng tuần", response: "Khối lượng tuần" },
        { id: "n2", label: "Buổi Easy T6", response: "Buổi Easy T6" }
      ]
    };
    await harness("mount", "ChatView", {}, BASE_SCRIPT);
    await waitFor(
      () => harness("exists", ".chat-composer textarea"),
      "ChatView renders its composer"
    );
    await harness("setValue", ".chat-composer textarea", "Tuần này thế nào?");
    await harness("click", ".chat-send");
    const sent = await waitFor(
      async () => (await harness("calls", "sendChat"))[0],
      "the turn reaches main"
    );
    const requestId = sent.args[0];
    await harness("emit", "onChatStreamStart", { requestId });
    await harness("emit", "onChatStreamToken", { requestId, delta: "Tuần này ổn định." });
    await harness("emit", "onChatStreamInfo", { requestId, kind: "coachPrompt", prompt: nextCard });
    await harness("emit", "onChatStreamDone", { requestId, fullText: "Tuần này ổn định." });
    await settle();

    assert.equal(
      await harness("count", ".chat-row.is-settled"),
      2,
      "the answer and the card it asked replace the bubble in place"
    );
    assert.equal(
      await harness("exists", ".chat-row-user.is-settled"),
      false,
      "the athlete's own message still makes its entrance"
    );

    // Held, not recomputed: the re-read below replaces every entry object, and
    // a row that lost the marker would have its animation restarted — the blink
    // this exists to remove, one reload later.
    await harness("emit", "onSyncChanged", { tables: ["chat_sessions"], pulled: 1, applied: 1 });
    await settle();
    assert.match(
      (await harness("text", ".chat-transcript")) ?? "",
      /Tuần này ổn định\./,
      "the re-read keeps the answer"
    );
    assert.equal(
      await harness("count", ".chat-row.is-settled"),
      2,
      "and the rows stay drawn in place across it"
    );
  }

  // -------------------------------------------------------------------------
  // A turn that fails after answering keeps the answer
  // -------------------------------------------------------------------------
  // Reported: ask → answer and a question card → pick a choice → the coach
  // answers and asks again → the second answer vanishes, and the first card is
  // back to unanswered, which looked like the coach's next question. Stored
  // that way, so reopening the app did not bring it back.
  //
  // The turn had ended in `chat:streamError` after its answer had streamed in
  // full — Claude Code's turn cap lands on exactly the round after a question —
  // and the error handler threw the whole turn away and reset the card.
  const pickCard = {
    kind: "coachPrompt",
    prompt: {
      promptId: "card-1",
      question: "Bạn muốn mình phân tích tiếp phần nào?",
      allowCustom: false,
      choices: [
        { id: "c1", label: "Buổi Strength T4", response: "Buổi Strength T4" },
        { id: "c2", label: "Tổng kết khối lượng chạy", response: "Tổng kết khối lượng chạy" }
      ]
    }
  };
  const openingRow = [
    { kind: "message", role: "user", content: "Phân tích buổi tập gần đây của tôi" },
    { kind: "message", role: "assistant", content: "Câu trả lời thứ nhất." },
    pickCard
  ];

  {
    await harness("mount", "ChatView", {}, { ...BASE_SCRIPT, getChatSession: openingRow });
    await waitFor(
      () => harness("exists", ".chat-coach-prompt-choice"),
      "the question card offers its choices"
    );
    await harness("click", ".chat-coach-prompt-choice");
    const sent = await waitFor(
      async () => (await harness("calls", "sendChat"))[0],
      "picking a choice resumes the turn"
    );
    const requestId = sent.args[0];

    await harness("emit", "onChatStreamStart", { requestId });
    await harness("emit", "onChatStreamToken", {
      requestId,
      delta: "Câu trả lời thứ hai: buổi Strength T4 nhẹ."
    });
    await harness("emit", "onChatStreamInfo", {
      requestId,
      kind: "coachPrompt",
      prompt: {
        promptId: "card-2",
        question: "Tiếp theo muốn xem gì?",
        allowCustom: false,
        choices: [
          { id: "d1", label: "Khối lượng tuần", response: "Khối lượng tuần" },
          { id: "d2", label: "Buổi Easy T6", response: "Buổi Easy T6" }
        ]
      }
    });
    await harness("emit", "onChatStreamError", {
      requestId,
      message: "error_max_turns",
      usage: { inputTokens: 40_000, outputTokens: 1_200 }
    });
    await settle();

    const onScreen = (await harness("text", ".chat-transcript")) ?? "";
    assert.match(
      onScreen,
      /Câu trả lời thứ hai: buổi Strength T4 nhẹ\./,
      "an answer that streamed in full must survive an error that lands after it"
    );
    assert.match(onScreen, /Tiếp theo muốn xem gì\?/, "and so must the card it asked");
    assert.match(onScreen, /Coach stopped before finishing/, "with the cut-off said out loud");
    // An answered card is not drawn at all, so "stays answered" reads on screen
    // as "is gone". The first card coming back is precisely what the athlete
    // saw: the reset card reappearing looked like the coach's next question.
    assert.equal(
      await harness("count", ".chat-coach-prompt"),
      1,
      "only the new card is waiting — the one the athlete answered stays answered"
    );
    assert.doesNotMatch(
      onScreen,
      /Bạn muốn mình phân tích tiếp phần nào\?/,
      "the answered card must not come back as if it were a new question"
    );

    const saves = await harness("calls", "saveChatSession");
    const stored = saves[saves.length - 1].args[1];
    assert.ok(
      stored.some((entry) => entry.content === "Câu trả lời thứ hai: buổi Strength T4 nhẹ."),
      "and it is what reached the row, or a reload takes it away again"
    );
    assert.equal(
      stored.find((entry) => entry.prompt?.promptId === "card-1")?.prompt.answer,
      "Buổi Strength T4",
      "with the athlete's choice still on the card"
    );
  }

  // The other half: an error before anything reached the athlete still undoes
  // the turn, so the card is theirs to answer again rather than a dead end.
  {
    await harness("mount", "ChatView", {}, { ...BASE_SCRIPT, getChatSession: openingRow });
    await waitFor(
      () => harness("exists", ".chat-coach-prompt-choice"),
      "the question card offers its choices"
    );
    await harness("click", ".chat-coach-prompt-choice");
    const sent = await waitFor(
      async () => (await harness("calls", "sendChat"))[0],
      "picking a choice resumes the turn"
    );
    await harness("emit", "onChatStreamStart", { requestId: sent.args[0] });
    await harness("emit", "onChatStreamError", {
      requestId: sent.args[0],
      message: "connection reset"
    });
    await settle();
    assert.match(
      (await harness("text", ".chat-transcript")) ?? "",
      /Bạn muốn mình phân tích tiếp phần nào\?/,
      "with nothing produced, the card goes back to waiting for an answer"
    );
    assert.equal(await harness("exists", ".chat-coach-prompt-choice"), true);
    assert.doesNotMatch(
      (await harness("text", ".chat-transcript")) ?? "",
      /Coach stopped before finishing/,
      "and there is no truncated answer to put a notice under"
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
