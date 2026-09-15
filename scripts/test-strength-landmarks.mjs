/**
 * Weekly sets per muscle against the 10–20 landmark: which weeks count, and
 * how a muscle is judged.
 *
 * The weeks are the trap. MuscleStat.weekly only lists weeks that held a
 * session, so averaging it skips rest weeks and overstates every muscle; the
 * week in progress always reads short; and a week the window only partly
 * reaches has days missing that look like rest. Each is pinned below.
 *
 * `now` is fixed, never the real clock, so the suite cannot expire.
 *
 * Run: npm run test:strength-landmarks
 * (Electron, because this machine's Node has no Amaro for --experimental-strip-types.)
 */
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const bust = Date.now();
const load = async (...segments) => {
  const url = pathToFileURL(path.join(repoRoot, ...segments));
  return import(`${url.href}?cacheBust=${bust}`);
};

const { MUSCLES, resolveExerciseTargets } = await load("src", "strength", "muscles.ts");
const { buildStrengthAnalytics, nextWeekStartMs, previousWeekStartMs, startOfWeekMs } = await load(
  "src",
  "strength",
  "strengthAnalytics.ts"
);
const { buildWeeklyVolumeLandmarks, landmarkStatus, landmarkWeeks, LANDMARK_WEEKS } = await load(
  "src",
  "strength",
  "strengthLandmarks.ts"
);

// Local dates: the app buckets weeks on the machine's own Mondays.
const at = (year, month, day, hour = 12) => new Date(year, month - 1, day, hour).getTime();
const weekStartsOf = (weeks) =>
  weeks.map((week) => {
    const date = new Date(week.weekStart * 1000);
    return `${date.getMonth() + 1}-${date.getDate()}`;
  });

// Mon 2026-09-14 starts the week in progress.
const WEDNESDAY = at(2026, 9, 16);
const THURSDAY = at(2026, 9, 17);

// ---- Which weeks count ----

assert.deepEqual(
  weekStartsOf(landmarkWeeks(90, WEDNESDAY)),
  ["8-17", "8-24", "8-31", "9-7"],
  "the last four whole weeks, never the week in progress"
);
assert.equal(landmarkWeeks(365, WEDNESDAY).length, LANDMARK_WEEKS);

// 30 days back from Thursday lands on a Tuesday: that week is only partly loaded.
assert.deepEqual(weekStartsOf(landmarkWeeks(30, THURSDAY)), ["8-24", "8-31", "9-7"]);
// ...while from Wednesday it lands exactly on a Monday, and that week is whole.
assert.deepEqual(weekStartsOf(landmarkWeeks(30, WEDNESDAY)), ["8-17", "8-24", "8-31", "9-7"]);

// A window too short to hold one finished week has nothing to judge.
assert.deepEqual(landmarkWeeks(7, WEDNESDAY), []);

// ---- Averages ----

const LEG_CURL = "Lying Leg Curls";
assert.equal(
  resolveExerciseTargets(LEG_CURL).activations.find((a) => a.muscle === "hamstrings")?.share,
  1,
  "fixture: every leg curl set is a whole hamstring set"
);

const session = (id, ms, setCount) => ({
  activityId: id,
  sportType: 402,
  startTime: Math.floor(ms / 1000),
  detail: {
    summary: { sets: setCount, totalReps: 0, totalWeightKg: 0, exercises: 1, calories: 0, durationSec: 3600 },
    exercises: [
      {
        nameKey: LEG_CURL,
        sets: setCount,
        totalReps: setCount * 10,
        entries: Array.from({ length: setCount }, () => ({
          reps: 10,
          weightKg: 40,
          workSec: 40,
          restSec: 90,
          calories: 5
        }))
      }
    ]
  }
});

{
  const history = [
    session("w1", at(2026, 8, 18), 12), // week of Aug 17
    session("w2", at(2026, 8, 26), 14), // week of Aug 24
    // week of Aug 31: rest
    session("w4a", at(2026, 9, 8), 6), // week of Sep 7, two sessions
    session("w4b", at(2026, 9, 11), 8),
    session("now", at(2026, 9, 15), 30), // week in progress: ignored
    session("old", at(2026, 8, 12), 30) // before the four weeks: ignored
  ];
  const analytics = buildStrengthAnalytics(history, 90);
  const landmarks = buildWeeklyVolumeLandmarks(analytics, 90, WEDNESDAY);
  const hamstrings = landmarks.muscles.find((m) => m.muscle === "hamstrings");

  assert.deepEqual(hamstrings.weekly, [12, 14, 0, 14], "a rest week is a zero, not a gap");
  assert.equal(hamstrings.average, 10, "(12 + 14 + 0 + 14) / 4, not / 3");
  assert.equal(hamstrings.status, "within");

  assert.deepEqual(
    landmarks.muscles.map((m) => m.muscle),
    MUSCLES.map((m) => m.id),
    "every muscle, in anatomical order"
  );
  const quads = landmarks.muscles.find((m) => m.muscle === "quads");
  assert.equal(quads.average, 0);
  assert.equal(quads.status, "below");
  assert.equal(
    landmarks.counts.below + landmarks.counts.within + landmarks.counts.above,
    MUSCLES.length
  );
}

// ---- Judging ----

assert.equal(landmarkStatus(9.9), "below");
assert.equal(landmarkStatus(10), "within");
assert.equal(landmarkStatus(20), "within");
assert.equal(landmarkStatus(20.1), "above");

{
  // 39.8 sets over four weeks is 9.95 a week: shown as 10.0, so judged as 10.0.
  const history = [
    session("a", at(2026, 8, 18), 10),
    session("b", at(2026, 8, 25), 10),
    session("c", at(2026, 9, 1), 10),
    { ...session("d", at(2026, 9, 8), 10) }
  ];
  history[3].detail.exercises[0].entries.pop(); // 9 sets
  const analytics = buildStrengthAnalytics(history, 90);
  // Nudge the week's credit to 9.8 without a fractional-set fixture.
  analytics.muscleById.hamstrings.weekly = analytics.muscleById.hamstrings.weekly.map((point) =>
    point.sets === 9 ? { ...point, sets: 9.8 } : point
  );
  const hamstrings = buildWeeklyVolumeLandmarks(analytics, 90, WEDNESDAY).muscles.find(
    (m) => m.muscle === "hamstrings"
  );
  assert.equal(hamstrings.average, 10);
  assert.equal(hamstrings.status, "within", "judged on the figure the panel shows");
}

assert.equal(buildWeeklyVolumeLandmarks(buildStrengthAnalytics([], 7), 7, WEDNESDAY), null);

// ---- Stepping a week across a daylight-saving change ----

// Every bucket in the app is keyed by startOfWeekMs, which is local midnight on
// a Monday. Stepping by a flat 7 × 86 400 000 ms lands an hour off that key the
// moment the clocks move, and each week after it stays shifted — the week reads
// as a rest week and the weekly chart draws the rest of the window as empty.
// Switched last, so nothing above is read on a different clock.
process.env.TZ = "Europe/Berlin";

{
  const mondayNoon = (year, month, day) => new Date(year, month - 1, day, 12).getTime();
  const isSnapped = (ms) => ms === startOfWeekMs(ms);

  // Clocks go forward Sun 2026-03-29 and back Sun 2026-10-25 in this zone.
  for (const [year, month, day] of [
    [2026, 3, 23],
    [2026, 10, 19]
  ]) {
    const from = startOfWeekMs(mondayNoon(year, month, day));
    assert.equal(new Date(from).getDay(), 1, "fixture: the walk starts on a Monday");

    let at = from;
    for (let week = 0; week < 6; week += 1) {
      const next = nextWeekStartMs(at);
      assert.ok(isSnapped(next), `week ${week + 1} after ${new Date(from)} drifted off its key`);
      assert.equal(new Date(next).getDay(), 1, "still a Monday");
      assert.equal(previousWeekStartMs(next), at, "the step reverses exactly");
      at = next;
    }

    // The flat step is what this replaced: it is off by an hour past the change.
    const flat = from + 7 * 86_400_000 * 5;
    assert.ok(!isSnapped(flat), "fixture: the flat step really does miss the key here");
  }
}

console.log("strength landmarks OK");
