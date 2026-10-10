// npm run test:stored-text
//
// Text that is stored stays English, and the screen says it again in the
// language on screen (docs/i18n-plan.md, "Never store a translated string").
// This holds the places that do that by hand rather than through a key:
//
//   1. a change line's label names its plan once, in the label's own
//      parentheses, and names none when the label has none;
//   2. the "Coach stopped before finishing" notice is stored in English and
//      drawn translated, with a fixed main-process sentence inside it;
//   3. `screenSentence` says a fixed main-process sentence in the language on
//      screen and leaves anything else as it came;
//   4. two language picks in quick succession end on the one picked last;
//   5. a label table built with `messageRecord` answers nothing for an id it
//      does not hold, not `Object.prototype`'s members;
//   6. the coverage scanner reads a keyword inside a sentence as a word.
//
// Launched through Electron with `--experimental-strip-types` and the resolver
// hook, because the chat modules import extensionless `.ts` (CLAUDE.md).

import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const load = (relative) => import(pathToFileURL(path.join(repoRoot, relative)).href);

const core = await load("src/i18n/core.ts");
const { planOf, changeLineLabel } = await load("src/chat/scheduleChangeModel.ts");
const { stoppedEarlyNotice, displayStoredNotice } = await load("src/chat/storedNotice.ts");
const { scanSource } = await load("scripts/lib/i18n-coverage.mjs");

// --- 1. A change line's plan ----------------------------------------------------

assert.equal(planOf('Move "Easy run" (Base plan) from Tue 29 Sep to Thu 1 Oct', "Easy run"), " (Base plan)");
assert.equal(planOf('Remove "Easy run" (Base plan) from Tue 29 Sep', "Easy run"), " (Base plan)");
assert.equal(planOf('Replace "Easy run" (Base plan) on Tue 29 Sep with "Tempo"', "Easy run"), " (Base plan)");
// No plan: a workout whose name says "on" or "from" is not taken for one.
assert.equal(planOf('Replace "Easy run" on Tue 29 Sep with "Run on hills"', "Easy run"), "");
assert.equal(planOf('Move "Easy run" from Tue 29 Sep to Thu 1 Oct', "Easy run"), "");
assert.equal(planOf('Remove "Easy run" from the calendar on Tue 29 Sep', "Easy run"), "");

await core.switchLocaleForTest("vi");
const move = {
  op: "move",
  status: "proposed",
  label: 'Move "Easy run" (Base plan) from Tue 29 Sep to Thu 1 Oct',
  session: { planId: "p", idInPlan: "1", happenDay: "20260929", name: "Easy run" },
  toDay: "20261001"
};
const said = changeLineLabel(move);
assert.ok(said.includes(" (Base plan) "), `the plan is named once, in single parentheses: ${said}`);
assert.ok(!said.includes("(("), `no doubled parentheses: ${said}`);

// --- 2. The stopped-early notice ----------------------------------------------------

const fixedReason = "Add an OpenRouter API key in Coach settings first.";
const stored = stoppedEarlyNotice(fixedReason);
assert.equal(stored, `Coach stopped before finishing: ${fixedReason}`, "stored in English whatever the language");
const shown = displayStoredNotice(stored);
assert.ok(!shown.startsWith("Coach stopped"), `drawn in the language on screen: ${shown}`);
assert.ok(shown.includes(core.t("main.coach.openRouterKey")), `the fixed sentence inside is translated too: ${shown}`);
// A provider's own words inside the notice are drawn as they came.
assert.ok(displayStoredNotice(stoppedEarlyNotice("overloaded_error")).endsWith("overloaded_error"));
// An ordinary answer is left alone.
assert.equal(displayStoredNotice("Run easy today."), "Run easy today.");

// --- 3. screenSentence ----------------------------------------------------------------

assert.equal(core.screenSentence("Nothing was deleted."), core.t("main.coros.nothingDeleted"));
assert.notEqual(core.screenSentence("Nothing was deleted."), "Nothing was deleted.");
assert.equal(core.screenSentence("COROS said no."), "COROS said no.");

// --- 4. Two picks in quick succession -------------------------------------------------

// Vietnamese is loaded already (above) and Japanese is not, so the pick made
// first is the one whose chunk lands last: applied as it lands, it would win.
await core.switchLocaleForTest("en");
await Promise.all([core.setLocale("ja"), core.setLocale("vi")]);
assert.equal(core.getLocale(), "vi", "the language picked last wins, whichever chunk arrives first");
await core.switchLocaleForTest("en");

// --- 5. messageRecord ------------------------------------------------------------------

const labels = core.messageRecord({ road: "run.surface.road" });
assert.equal(labels.road, "Road");
assert.equal("toString" in labels, false);
assert.equal(labels["constructor"], undefined);

// --- 6. The coverage scanner ------------------------------------------------------------

assert.deepEqual(
  scanSource('const a = <div className="x">Preparing the FIT export…</div>;', "a.tsx").map((hit) => hit.text),
  ["Preparing the FIT export…"],
  "a sentence that holds a keyword is still text"
);
assert.deepEqual(scanSource("const a = () => { if (x) { return <p>{v}</p>; } };", "a.tsx"), []);

console.log("stored text: change lines, notices, screen sentences, locale picks and the scanner hold");
