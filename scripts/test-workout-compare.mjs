// What a proposed change changes: two workouts set against each other
// (`src/calendar/workoutCompare.ts`), and a proposal set against the one
// before it (`changesSincePrevious` in `src/chat/scheduleChangeModel.ts`).
//
// Held:
//   * a step that kept its place and name states only what changed of it;
//   * a repeat's count is a change of its head, its untouched steps are not;
//   * a step added or removed is that, and the steps around it stay matched;
//   * two workouts that read the same differ in nothing;
//   * a later proposal marks each line new, changed or as before against the
//     nearest earlier answer's untouched set that names the same sessions,
//     and names what it left out;
//   * a set with an applied line, or one naming nothing in common, is no
//     earlier draft.
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const load = (...parts) => import(`${pathToFileURL(path.join(repoRoot, ...parts)).href}?cacheBust=${Date.now()}`);
const { compareWorkoutInputs, comparisonLines } = await load("src", "calendar", "workoutCompare.ts");
const { changesSincePrevious, lineCompare, lineViews, sincePreviousSummary } = await load("src", "chat", "scheduleChangeModel.ts");

let passed = 0;
const test = (name, run) => {
  run();
  passed += 1;
  console.log(`ok - ${name}`);
};

const pace = (low, high) => ({ type: "pace", lowSecondsPerKm: low, highSecondsPerKm: high, displayUnit: "km" });
const run = (kind, meters, intensity) => ({
  kind,
  target_type: "distance",
  target_distance_meters: meters,
  ...(intensity ? { intensity } : {})
});
const rest = (seconds) => ({ kind: "rest", target_type: "time", target_duration_seconds: seconds });
const tempo = (repeat, low, high, extra = []) => ({
  key: "k",
  name: "Tempo",
  sport: "run",
  steps: [
    run("warmup", 2000),
    { repeat, steps: [run("training", 1000, pace(low, high)), rest(90)] },
    ...extra,
    run("cooldown", 2000)
  ]
});
const options = { unitSystem: "metric" };

test("a repeat's count and one step's pace are the only differences", () => {
  const comparison = compareWorkoutInputs(tempo(6, 260, 270), tempo(5, 270, 280), options);
  assert.ok(comparison?.differs);
  assert.deepEqual(
    comparison.rows.map((row) => row.status),
    ["same", "changed", "changed", "same", "same"]
  );
  const lines = comparisonLines(comparison);
  const steps = lines.filter((line) => !["Distance", "Duration"].includes(line.name ?? ""));
  assert.equal(steps.length, 2);
  assert.equal(steps[0].name, undefined, "a repeat's head is said whole");
  assert.match(steps[0].from, /6/);
  assert.match(steps[0].to, /5/);
  assert.match(steps[1].from, /4:20/);
  assert.match(steps[1].to, /4:30/);
  assert.doesNotMatch(steps[1].from, /1\.00 km/, "the distance did not change and is not restated");
  // The session is a kilometre shorter, and says so.
  const distance = lines.find((line) => line.name === "Distance");
  assert.ok(distance, "the session's distance changed");
  assert.notEqual(distance.from, distance.to);
});

test("a step added keeps the steps around it matched", () => {
  const comparison = compareWorkoutInputs(tempo(5, 270, 280), tempo(5, 270, 280, [run("training", 400, pace(240, 250))]), options);
  assert.deepEqual(
    comparison.rows.map((row) => row.status),
    ["same", "same", "same", "same", "added", "same"]
  );
  const [added] = comparisonLines(comparison).filter((line) => line.status === "added");
  assert.match(added.to, /400 m/);
  const removed = compareWorkoutInputs(tempo(5, 270, 280, [run("training", 400)]), tempo(5, 270, 280), options);
  assert.deepEqual(removed.rows.filter((row) => row.status !== "same").map((row) => row.status), ["removed"]);
});

test("a name and a description are the workout's own differences", () => {
  const before = tempo(5, 270, 280);
  const comparison = compareWorkoutInputs(before, { ...before, name: "Tempo, eased", description: "Back off if the legs are heavy" }, options);
  assert.deepEqual(comparison.fields.map((field) => field.field), ["name", "description"]);
  assert.ok(comparison.rows.every((row) => row.status === "same"));
});

test("two workouts that read the same differ in nothing", () => {
  const comparison = compareWorkoutInputs(tempo(5, 270, 280), { ...tempo(5, 270, 280), key: "other", schedule_date: "20261120" }, options);
  assert.equal(comparison.differs, false);
  assert.deepEqual(comparisonLines(comparison), []);
});

// --- a proposal against the one before it ---

const session = (id, day, name = id) => ({ planId: "p", idInPlan: id, happenDay: day, name });
const line = (lineId, op, extra = {}) => ({ lineId, op, label: `${op} ${lineId}`, status: "proposed", ...extra });
const set = (changeSetId, lines) => ({ changeSetId, summary: "", lines, createdAt: "", updatedAt: "" });
const transcript = (...ids) =>
  ids.flatMap((id) => [
    { kind: "message", role: "user", text: "q" },
    { kind: "message", role: "assistant", text: "a" },
    { kind: "scheduleChange", changeSetId: id }
  ]);

const first = set("sc-1", [
  line("l1", "patch", { session: session("tempo", "20261119"), workout: tempo(4, 270, 280) }),
  line("l2", "move", { session: session("long", "20261121"), toDay: "20261122" }),
  line("l3", "remove", { session: session("strength", "20261118") })
]);
const second = set("sc-2", [
  line("l1", "patch", { session: session("tempo", "20261119"), workout: tempo(5, 270, 280) }),
  line("l2", "add", { toDay: "20261120", workout: { key: "e", name: "Easy 5 km", sport: "run", steps: [run("training", 5000)] } }),
  line("l3", "move", { session: session("long", "20261121"), toDay: "20261122" })
]);

test("a later proposal is marked line by line against the one before it", () => {
  const since = changesSincePrevious(transcript("sc-1", "sc-2"), "sc-2", { "sc-1": first, "sc-2": second });
  assert.ok(since);
  assert.equal(since.lines.l1.mark, "changed");
  assert.equal(since.lines.l1.previous, first.lines[0]);
  assert.equal(since.lines.l2.mark, "new");
  assert.equal(since.lines.l3.mark, "same");
  assert.deepEqual(since.dropped.map((dropped) => dropped.lineId), ["l3"]);
  assert.deepEqual(since.counts, { new: 1, changed: 1, same: 1, dropped: 1 });
  assert.equal(sincePreviousSummary(since.counts), "1 new · 1 changed · 1 as before · 1 dropped");
});

test("the first proposal, a restated one and one on other sessions revise nothing", () => {
  const sets = { "sc-1": first, "sc-2": second };
  assert.equal(changesSincePrevious(transcript("sc-1", "sc-2"), "sc-1", sets), undefined);
  assert.equal(changesSincePrevious(transcript("sc-1", "sc-2"), "sc-2", { "sc-1": first, "sc-2": { ...first, changeSetId: "sc-2" } }), undefined);
  const elsewhere = set("sc-3", [line("l1", "remove", { session: session("swim", "20261125") })]);
  assert.equal(changesSincePrevious(transcript("sc-1", "sc-3"), "sc-3", { "sc-1": first, "sc-3": elsewhere }), undefined);
});

test("a set between still being read keeps an older one from standing in", () => {
  const sets = { "sc-1": first, "sc-1b": null, "sc-2": second };
  assert.equal(changesSincePrevious(transcript("sc-1", "sc-1b", "sc-2"), "sc-2", sets), undefined);
  // Read, and about other sessions, it is passed over.
  const elsewhere = set("sc-1b", [line("l1", "remove", { session: session("swim", "20261125") })]);
  assert.ok(changesSincePrevious(transcript("sc-1", "sc-1b", "sc-2"), "sc-2", { ...sets, "sc-1b": elsewhere }));
});

test("a step whose kind alone changed says so", () => {
  const before = { key: "k", name: "Easy", sport: "run", steps: [{ ...run("training", 1000), name: "Jog" }] };
  const after = { ...before, steps: [{ ...run("cooldown", 1000), name: "Jog" }] };
  const [changed] = comparisonLines(compareWorkoutInputs(before, after, options));
  assert.equal(changed.name, "Jog");
  assert.notEqual(changed.from, changed.to);
  assert.notEqual(changed.from, "—");
});

test("a set with an applied line is not an earlier draft", () => {
  const acted = { ...first, lines: first.lines.map((item, index) => (index === 1 ? { ...item, status: "applied" } : item)) };
  assert.equal(changesSincePrevious(transcript("sc-1", "sc-2"), "sc-2", { "sc-1": acted, "sc-2": second }), undefined);
  // Dismissed when the later one was applied, it is still what the later one revised.
  const dismissed = { ...first, lines: first.lines.map((item) => ({ ...item, status: "dismissed" })) };
  assert.ok(changesSincePrevious(transcript("sc-1", "sc-2"), "sc-2", { "sc-1": dismissed, "sc-2": second }));
});

test("a line's dialog sets the session against what the line makes of it", () => {
  const patch = line("l1", "patch", {
    session: session("tempo", "20261119"),
    workout: tempo(5, 270, 280),
    before: tempo(6, 260, 270),
    patch: { ref: { kind: "scheduled", happenDay: "20261119", planId: "p", idInPlan: "tempo", planProgramId: "" }, revision: "r", changes: {} }
  });
  assert.deepEqual(lineCompare(lineViews(patch)), { before: "current", after: "proposed" });
  // Applied, the calendar holds what was written; the session as it stood is the line's own copy.
  const applied = lineViews({ ...patch, status: "applied" });
  assert.deepEqual(applied.map((view) => view.id), ["before", "current"]);
  assert.deepEqual(lineCompare(applied), { before: "before", after: "current" });
  const replaced = lineViews(line("l2", "replace", { status: "applied", session: session("tempo", "20261119"), workout: tempo(5, 270, 280), before: tempo(6, 260, 270) }));
  assert.deepEqual(lineCompare(replaced), { before: "before", after: "proposed" });
  // A line from before the session was kept has only what it wrote.
  assert.equal(lineCompare(lineViews(line("l3", "replace", { status: "applied", session: session("tempo", "20261119"), workout: tempo(5, 270, 280) }))), undefined);
  assert.equal(lineCompare(lineViews(line("l4", "add", { toDay: "20261120", workout: tempo(5, 270, 280) }))), undefined);
});

console.log(`${passed} passed`);
