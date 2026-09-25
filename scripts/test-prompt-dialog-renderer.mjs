// The Training Library's prompt dialog, mounted for real in Electron's Chromium.
//
// It exists because **Electron does not implement `window.prompt`** — it throws
// `prompt() is not supported.` from the renderer, which was verified against a
// real BrowserWindow before a line of this was written. Four flows reached for
// it (tagging a workout, tagging a plan, naming a duplicate, moving a missed
// session) and every one of them did nothing at all when clicked: an uncaught
// throw inside a React event handler is not caught by an error boundary, so
// there was no message anywhere, only a button that did not work.
//
// What is asserted here is the part a static scan cannot see — that the thing
// which replaced it actually behaves like a prompt:
//
// - It is a dialog to a screen reader, not only to the eye. The comparison
//   sheet beside it was `position: fixed` over the whole screen with no role,
//   no aria-modal and no Escape, and read as page content.
// - Typing works without reaching for the mouse: the field takes focus on
//   mount, and a text prompt selects what is in it, because every caller seeds
//   it with the value being replaced.
// - Submitting hands over what was typed. A prompt that needs a click on a
//   particular button is worse than the native one it replaced.
// - Escape cancels, and is caught in the **capture** phase so it still cancels
//   when the dialog opens over a surface with its own document-level Escape
//   listener — two listeners on one node are not separated by stopPropagation().
// - Pressing outside dismisses; pressing inside does not. The second half is
//   the one that breaks: a mousedown on the panel bubbles to the backdrop, so
//   selecting text in the field would close the dialog and throw the edit away.
// - A date prompt cannot be confirmed empty, because the value goes straight to
//   a COROS calendar write.
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { app, BrowserWindow } = require("electron");

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

app.commandLine.appendSwitch("no-sandbox");
app.disableHardwareAcceleration();

let win;

function harness(method, ...args) {
  const list = args.map((value) => JSON.stringify(value)).join(", ");
  return win.webContents
    .executeJavaScript(`window.__harness.${method}(${list})`, true)
    .catch((error) => {
      throw new Error(`harness ${method} failed: ${error.message}`);
    });
}

function evaluate(source) {
  return win.webContents.executeJavaScript(source, true);
}

async function settle() {
  for (let pass = 0; pass < 3; pass += 1) {
    await evaluate("new Promise((resolve) => setTimeout(resolve, 40))");
  }
}

async function mount(options = {}) {
  await harness("mount", "PromptDialog", options);
  await settle();
}

/** A key pressed on the document, the way a real one arrives. */
function pressOnDocument(key) {
  return evaluate(
    `document.dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(key)}, bubbles: true })), true`
  );
}

/** A mousedown on the first match, which is what the backdrop listens for. */
function mouseDown(selector) {
  return evaluate(
    `(() => {
       const element = document.querySelector(${JSON.stringify(selector)});
       if (!element) return false;
       element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
       return true;
     })()`
  );
}

const FIELD = ".tl-prompt-field input";
const SUBMIT = `.tl-dialog button[type="submit"]`;

async function main() {
  await app.whenReady();
  win = new BrowserWindow({
    show: false,
    width: 900,
    height: 700,
    webPreferences: { backgroundThrottling: false }
  });
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: /^(https?|wss?):/.test(details.url) });
  });
  await win.loadFile(path.join(repoRoot, "dist-harness", "index.html"));
  assert.equal(await harness("dev"), true, "the harness must be the dev build");

  // -------------------------------------------------------------------------
  // 1. It is a dialog, and the field is ready to type into
  // -------------------------------------------------------------------------
  {
    await mount({ initialValue: "tempo, threshold" });

    assert.equal(
      await harness("attr", ".tl-dialog", "role"),
      "dialog",
      "a fixed panel over the screen has to say it is a dialog"
    );
    assert.equal(await harness("attr", ".tl-dialog", "aria-modal"), "true");
    assert.ok(
      await harness("attr", ".tl-dialog", "aria-labelledby"),
      "the dialog must be named by its own heading"
    );

    assert.equal(
      await evaluate(
        `document.activeElement === document.querySelector(${JSON.stringify(FIELD)})`
      ),
      true,
      "the field takes focus on mount, or the prompt needs a click before a keystroke"
    );
    assert.equal(
      await evaluate(
        `(() => {
           const input = document.querySelector(${JSON.stringify(FIELD)});
           return input.selectionStart === 0 && input.selectionEnd === input.value.length;
         })()`
      ),
      true,
      "a text prompt selects what it was seeded with — every caller seeds it with the value being replaced"
    );
  }

  // -------------------------------------------------------------------------
  // 2. Submitting hands over what was typed
  // -------------------------------------------------------------------------
  {
    await mount({ initialValue: "old" });
    assert.equal(await harness("setValue", FIELD, "long run, base"), true);
    await settle();

    await evaluate(`document.querySelector(".tl-dialog").requestSubmit(), true`);
    await settle();

    const confirmed = await harness("calls", "prop:onConfirm");
    assert.equal(confirmed.length, 1, "submitting confirms exactly once");
    assert.deepEqual(confirmed[0].args, ["long run, base"], "it hands over what was typed");
    assert.equal(await harness("callCount", "prop:onCancel"), 0);
  }

  // -------------------------------------------------------------------------
  // 3. Escape cancels, from the document, in the capture phase
  // -------------------------------------------------------------------------
  {
    await mount({});
    await pressOnDocument("Escape");
    await settle();

    assert.equal(await harness("callCount", "prop:onCancel"), 1, "Escape cancels");
    assert.equal(await harness("callCount", "prop:onConfirm"), 0);

    /*
     * Capture, not bubble — and the difference only shows with the swallowing
     * listener on a node *between* the key and the document, which is exactly
     * where the surfaces this opens over put theirs. A bubble-phase listener on
     * `document` itself proves nothing: `stopPropagation` does not stop another
     * listener on the same node, so both implementations pass that.
     *
     * Here the container swallows the key on its way up. A capture-phase
     * document listener has already run by then; a bubble-phase one never runs
     * at all.
     */
    await evaluate(
      `(() => {
         const container = document.getElementById("root");
         container.addEventListener("keydown", (event) => event.stopPropagation());
         return true;
       })()`
    );
    await mount({});
    await evaluate(
      `(document.querySelector(${JSON.stringify(FIELD)})
         .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })), true)`
    );
    await settle();
    assert.equal(
      await harness("callCount", "prop:onCancel"),
      1,
      "Escape must still cancel when the surface the dialog opens over swallows the key on its way up"
    );
  }

  // -------------------------------------------------------------------------
  // 4. Pressing outside dismisses; pressing inside does not
  // -------------------------------------------------------------------------
  {
    await mount({});
    assert.equal(await mouseDown(".tl-dialog h2"), true);
    await settle();
    assert.equal(
      await harness("callCount", "prop:onCancel"),
      0,
      "a press inside the panel must not dismiss it — selecting text in the field would otherwise throw the edit away"
    );

    assert.equal(await mouseDown(".tl-dialog-backdrop"), true);
    await settle();
    assert.equal(await harness("callCount", "prop:onCancel"), 1, "a press outside dismisses");
  }

  // -------------------------------------------------------------------------
  // 5. A date prompt cannot be confirmed empty
  // -------------------------------------------------------------------------
  {
    await mount({ type: "date", initialValue: "", confirmLabel: "Move session" });
    assert.equal(
      await harness("attr", FIELD, "type"),
      "date",
      "a date is asked for with a date control, not a typed string"
    );
    assert.equal(
      await evaluate(`document.querySelector(${JSON.stringify(SUBMIT)}).disabled`),
      true,
      "an empty date goes straight to a COROS calendar write, so it cannot be confirmed"
    );

    await mount({ type: "date", initialValue: "2026-10-01", min: "2026-09-19" });
    assert.equal(await harness("attr", FIELD, "min"), "2026-09-19");
    assert.equal(
      await evaluate(`document.querySelector(${JSON.stringify(SUBMIT)}).disabled`),
      false
    );
  }

  console.log("prompt dialog renderer tests passed");
  app.exit(0);
}

main().catch((error) => {
  console.error(error);
  app.exit(1);
});
