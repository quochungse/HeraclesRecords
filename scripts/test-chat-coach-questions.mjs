// Coach's questions asked together (up to three, `request_coach_input`), run
// in the real ChatView against the harness stub: drawn as one card, picked one
// by one without a turn each, sent in one turn with what was left blank said
// to be skipped, put back if that turn never answers, and closed by words
// typed in the composer instead.
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { app, BrowserWindow } = require("electron");

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

app.commandLine.appendSwitch("no-sandbox");
app.disableHardwareAcceleration();

const BASE_SCRIPT = {
  __persistChatSessions: true,
  getChatAuthStatus: { signedIn: true },
  getChatSettings: {
    provider: "claude-code",
    chatgpt: {},
    anthropic: { model: "claude-opus-5", effort: "high", hasApiKey: false },
    claudeCode: { effort: "high" },
    local: { baseUrl: "http://localhost:11434/v1", model: "", hasApiKey: false, toolsEnabled: true },
    openRouter: { model: "openrouter/auto", hasApiKey: false },
    sidebarOpen: true,
    visualizationsEnabled: true,
    customInstructions: ""
  },
  getClaudeCodeStatus: { state: "connected" },
  getCorosMcpStatus: { connected: false },
  getMcpStatuses: [],
  listChatSessions: [{
    id: "s1",
    title: "Tuần này",
    provider: "claude-code",
    createdAt: "2026-11-03T06:00:00.000Z",
    updatedAt: "2026-11-03T06:00:00.000Z"
  }],
  getChatSession: [],
  listCoachAnalysisSessionAttention: [],
  listCoachAnalysesForSession: [],
  sendChat: null,
  compactChatContext: null
};

const question = (promptId, text, labels) => ({
  promptId,
  question: text,
  allowCustom: true,
  choices: labels.map((label, index) => ({ id: `${promptId}-${index}`, label, response: `${label}.` }))
});

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
    if (Date.now() > deadline) assert.fail(`timed out waiting for: ${what} (last saw ${JSON.stringify(last)})`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function settle() {
  for (let pass = 0; pass < 8; pass += 1) {
    await win.webContents.executeJavaScript("new Promise((resolve) => setTimeout(resolve, 60))", true);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

const disabled = (selector) =>
  win.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(selector)})?.disabled ?? null`, true);

/** A turn asked from the composer, answered with these questions. */
async function turnAsking(words, prompts) {
  const before = await harness("callCount", "sendChat");
  await harness("setValue", ".chat-composer textarea", words);
  await harness("click", ".chat-send");
  const sent = await waitFor(async () => (await harness("calls", "sendChat"))[before], "the turn reaches main");
  const requestId = sent.args[0];
  await harness("emit", "onChatStreamStart", { requestId });
  await harness("emit", "onChatStreamToken", { requestId, delta: "Chủ nhật ổn." });
  for (const prompt of prompts) await harness("emit", "onChatStreamInfo", { requestId, kind: "coachPrompt", prompt });
  await harness("emit", "onChatStreamDone", { requestId, fullText: "Chủ nhật ổn." });
  await settle();
}

const SEND = ".chat-coach-prompt-foot .chat-plan-upload";

async function main() {
  await app.whenReady();
  win = new BrowserWindow({ show: false, width: 1600, height: 1200, webPreferences: { backgroundThrottling: false } });
  await win.loadFile(path.join(repoRoot, "dist-harness", "index.html"));
  assert.equal(await harness("dev"), true, "the harness must be the dev build");

  await harness("mount", "ChatView", {}, BASE_SCRIPT);
  await waitFor(() => harness("exists", ".chat-composer textarea"), "ChatView renders its composer");

  // Three questions are one card, waiting on three answers.
  await turnAsking("Phân tích tuần này", [
    question("q1", "Chủ nhật bạn nạp bao nhiêu carb mỗi giờ?", ["40–45 g, bụng ổn", "Khoảng 30 g"]),
    question("q2", "Vì sao thứ Năm bỏ buổi easy?", ["Bận", "Mệt, hơi ốm"]),
    question("q3", "Gym mai bạn tập gì?", ["Giữ lịch", "Dời vai tay"])
  ]);
  assert.equal(await harness("count", ".chat-coach-prompt"), 1, "the questions of one call are one card");
  assert.equal(await harness("count", ".chat-coach-prompt-item"), 3);
  assert.match((await harness("text", ".chat-waiting-bar")) ?? "", /3 things waiting on you/, "each question still counts");
  assert.equal(await disabled(SEND), true, "nothing picked, nothing to send");
  assert.notEqual(
    await win.webContents.executeJavaScript(`document.querySelector(".chat-composer textarea").placeholder`, true),
    "Type another answer…",
    "next to several questions, typed words are a message, not an answer"
  );

  // Every question has a field for words of the athlete's own, in plain sight;
  // on this card the words wait for Send, so a field has no send of its own.
  assert.equal(await harness("count", ".chat-coach-prompt-field input"), 3);
  assert.equal(await harness("count", ".chat-coach-prompt-field-send"), 0);

  // Picking and writing send nothing; Send then sends one turn.
  const THIRD_FIELD = ".chat-coach-prompt-item:nth-child(3) .chat-coach-prompt-field input";
  await harness("setValue", THIRD_FIELD, "Dời vai tay sang thứ Sáu");
  await harness("keyDown", THIRD_FIELD, "Enter");
  assert.equal(await harness("clickText", ".chat-coach-prompt-choice", "40–45 g, bụng ổn"), true);
  assert.equal(await harness("callCount", "sendChat"), 1, "a pick is not a turn");
  assert.match((await harness("text", ".chat-coach-prompt-foot")) ?? "", /2 of 3 answered · anything left blank is skipped/);
  assert.equal(await disabled(SEND), false);

  // A turn that never answers puts the card back, picks and all.
  await harness("click", SEND);
  let sent = await waitFor(async () => (await harness("calls", "sendChat"))[1], "the answers go in one turn");
  await harness("emit", "onChatStreamStart", { requestId: sent.args[0] });
  await harness("emit", "onChatStreamError", { requestId: sent.args[0], message: "Claude is unreachable" });
  await settle();
  assert.equal(await harness("count", ".chat-coach-prompt-item"), 3, "the card comes back");
  assert.equal(await harness("value", THIRD_FIELD), "Dời vai tay sang thứ Sáu", "with what was written");
  assert.equal(await harness("count", ".chat-coach-prompt-choice.is-selected"), 1, "and what was picked");

  await harness("click", SEND);
  sent = await waitFor(async () => (await harness("calls", "sendChat"))[2], "sent again");
  const wire = sent.args[1];
  assert.deepEqual(wire.slice(-2).map((message) => message.role), ["assistant", "user"], "the transcript ends on the athlete");
  assert.match(wire.at(-2).content, /^I need the athlete's answers before continuing:\n1\. Chủ nhật/);
  assert.equal(wire.at(-1).content, "1. 40–45 g, bụng ổn.\n2. (no answer)\n3. Dời vai tay sang thứ Sáu");
  await harness("emit", "onChatStreamStart", { requestId: sent.args[0] });
  await harness("emit", "onChatStreamDone", { requestId: sent.args[0], fullText: "Vậy giữ 40–45 g." });
  await settle();
  assert.equal(await harness("count", ".chat-coach-prompt"), 0, "the card is answered");
  assert.equal(await harness("count", ".chat-asked-row"), 3, "each question keeps its line");
  assert.equal(await harness("text", ".chat-asked-answer.is-skipped"), "Skipped");
  assert.equal(await harness("exists", ".chat-waiting-bar"), false);

  // Words typed beside a card of several questions are a message of their own,
  // and close the card: what was picked goes with them, the rest is skipped.
  await turnAsking("Còn tuần sau?", [
    question("r1", "Tuần sau có đi công tác không?", ["Có", "Không"]),
    question("r2", "Long run để sáng hay chiều?", ["Sáng", "Chiều"])
  ]);
  assert.equal(await harness("clickText", ".chat-coach-prompt-choice", "Sáng"), true);
  await harness("setValue", ".chat-composer textarea", "Lên lịch luôn đi");
  await harness("click", ".chat-send");
  sent = await waitFor(async () => (await harness("calls", "sendChat"))[4], "the message goes");
  assert.deepEqual(
    sent.args[1].slice(-3).map((message) => [message.role, message.content.split("\n")[0]]),
    [
      ["assistant", "I need the athlete's answers before continuing:"],
      ["user", "1. (no answer)"],
      ["user", "Lên lịch luôn đi"]
    ]
  );
  await harness("emit", "onChatStreamStart", { requestId: sent.args[0] });
  await harness("emit", "onChatStreamDone", { requestId: sent.args[0], fullText: "Đây là lịch." });
  await settle();
  assert.equal(await harness("count", ".chat-coach-prompt"), 0, "the card closed");
  assert.equal(await harness("count", ".chat-asked-answer.is-skipped"), 2, "one skipped before, one now");

  // A single question is answered by one press, as it always was.
  await turnAsking("Buổi mai?", [question("s1", "Mai chạy sáng hay tối?", ["Sáng", "Tối"])]);
  assert.equal(await harness("exists", ".chat-coach-prompt-foot"), false, "one question has no Send");
  assert.equal(await harness("clickText", ".chat-coach-prompt-choice", "Tối"), true);
  sent = await waitFor(async () => (await harness("calls", "sendChat"))[6], "one press sends");
  assert.equal(sent.args[1].at(-1).content, "Tối.");
  await harness("emit", "onChatStreamStart", { requestId: sent.args[0] });
  await harness("emit", "onChatStreamDone", { requestId: sent.args[0], fullText: "Tối thì nhẹ." });
  await settle();

  // Or words in its field: Enter sends them as the answer, and the arrow beside
  // them waits for words before it can.
  await turnAsking("Còn thứ Bảy?", [question("s2", "Thứ Bảy tập gym lúc nào?", ["Sáng", "Chiều"])]);
  assert.equal(await disabled(".chat-coach-prompt-field-send"), true, "no words, nothing to send");
  await harness("setValue", ".chat-coach-prompt-field input", "Sau giờ làm, khoảng 18h");
  assert.equal(await disabled(".chat-coach-prompt-field-send"), false);
  await harness("keyDown", ".chat-coach-prompt-field input", "Enter");
  sent = await waitFor(async () => (await harness("calls", "sendChat"))[8], "Enter sends the words");
  assert.deepEqual(sent.args[1].slice(-2).map((message) => message.content), [
    "I need the athlete's answer before continuing:\nThứ Bảy tập gym lúc nào?\n- Sáng\n- Chiều",
    "Sau giờ làm, khoảng 18h"
  ]);

  assert.deepEqual(await harness("consoleErrors"), [], "nothing complained");

  // A waiting card straddling the top of the drawn window (the last 40
  // entries) still shows, at its first question inside the window.
  {
    const talk = (n) => ({ kind: "message", role: n % 2 ? "assistant" : "user", content: `Tin ${n}` });
    const entries = [
      ...Array.from({ length: 20 }, (_, n) => talk(n)),
      ...["w1", "w2", "w3"].map((id) => ({ kind: "coachPrompt", prompt: question(id, `Câu ${id}?`, ["Có", "Không"]) })),
      ...Array.from({ length: 39 }, (_, n) => talk(n + 20))
    ];
    await harness("mount", "ChatView", {}, { ...BASE_SCRIPT, getChatSession: entries });
    await waitFor(() => harness("exists", ".chat-coach-prompt-list"), "the straddling card is drawn");
    assert.equal(await harness("count", ".chat-coach-prompt-item"), 3, "with every question on it");
    assert.deepEqual(await harness("consoleErrors"), []);
  }
  console.log("chat coach questions tests passed");
}

main().then(
  () => app.exit(0),
  (error) => {
    console.error(error);
    app.exit(1);
  }
);
