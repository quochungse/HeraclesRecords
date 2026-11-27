// The Climbing screen's arithmetic: COROS's grades and the ladder they are
// converted on, a climbing session read out of COROS's payload (laps, rests,
// an outdoor day's stages and pitches), the summary kept of it, and what the
// screen and the Personal Records board make of the climbs.
//
// Runs under Electron for the reason test-swim-metrics does: the module graph
// has extensionless imports, so the resolver hook comes along too.
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const bust = `?cacheBust=${Date.now()}`;
const moduleUrl = (...parts) => `${pathToFileURL(path.join(repoRoot, ...parts)).href}${bust}`;

const {
  CLIMB_SYSTEM,
  climbGradeOf,
  gradeNameOnLadder,
  ladderRungs,
  onsightLadder,
  recordedGradeName,
  rungIndexFor
} = await import(moduleUrl("electron", "climbGrades.ts"));
const {
  CLIMB_SUMMARY_VERSION,
  climbStyleOf,
  climbSummaryOf,
  isClimbSportType,
  isSend,
  parseClimbDetail
} = await import(moduleUrl("electron", "climbDetail.ts"));
const {
  buildClimbWeeks,
  climbKindBreakdown,
  climbRecords,
  climbScales,
  gradeName,
  gradePyramid,
  hardestSend,
  sendRate,
  summariseClimbs,
  wallFigures
} = await import(moduleUrl("src", "climbing", "climbMetrics.ts"));
const { sportScreenFor } = await import(moduleUrl("src", "navigation", "sportScreens.ts"));
const { sportColorCategory } = await import(moduleUrl("src", "training", "sportColors.ts"));
const { buildRecordBoard } = await import(moduleUrl("src", "records", "personalBests.ts"));
const { needsRecordsSummary } = await import(moduleUrl("src", "records", "milestones.ts"));

// --- What a climb is -------------------------------------------------------------

for (const code of [800, 801, 802, 10003]) {
  assert.equal(isClimbSportType(code), true, `${code} is climbing`);
  assert.equal(sportScreenFor(code), "climbing", `${code} opens on Climbing`);
  assert.equal(sportColorCategory(code), "climb", `${code} wears the climbing colour`);
}
assert.equal(isClimbSportType(105), false, "a mountain climb is a hike");
assert.equal(isClimbSportType(undefined), false);

// COROS's CLIMB_STYLE: 0 redpoint, 1 onsight, 2 flash, 3 attempt, 5 repeat, 255 not recorded.
assert.deepEqual(
  [0, 1, 2, 3, 5, 255, 9, undefined].map(climbStyleOf),
  ["redpoint", "onsight", "flash", "attempt", "repeat", "unrecorded", "unrecorded", "unrecorded"]
);
assert.deepEqual(
  ["onsight", "flash", "redpoint", "repeat", "attempt", "unrecorded"].map(isSend),
  [true, true, true, true, false, false]
);

// --- Grades, as COROS's tables read them ------------------------------------------

const indoor6b = climbGradeOf(800, CLIMB_SYSTEM.french, 8);
assert.deepEqual(indoor6b, { family: "route", system: 2, index: 8, name: "6b", ladder: 9 });
// 5.6 covers the ladder's first four steps; its step is the top one.
assert.equal(climbGradeOf(800, CLIMB_SYSTEM.yds, 0)?.ladder, 4);
// Outdoors the rope ladder sits two steps higher: an outdoor 6b is an indoor 6b.
const outdoor6b = climbGradeOf(802, CLIMB_SYSTEM.french, 10);
assert.equal(outdoor6b?.name, "6b");
assert.equal(outdoor6b?.ladder, indoor6b.ladder, "an outdoor grade lands on the indoor ladder");
assert.equal(climbGradeOf(802, CLIMB_SYSTEM.french, 0), undefined, "jugging the rope is not a graded climb");
assert.equal(climbGradeOf(802, CLIMB_SYSTEM.french, 1)?.name, "@easy");
// A boulder is on a ladder of its own.
assert.deepEqual(climbGradeOf(801, CLIMB_SYSTEM.vScale, 3), { family: "boulder", system: 7, index: 3, name: "V3", ladder: 5 });
assert.equal(climbGradeOf(801, CLIMB_SYSTEM.font, 3)?.name, "6A");
// No grade: a scale of 0 is "not set", an index of 255 "none", another sport has none.
assert.equal(climbGradeOf(800, 0, 4), undefined);
assert.equal(climbGradeOf(800, 2, 255), undefined);
assert.equal(climbGradeOf(100, 2, 4), undefined);
assert.equal(climbGradeOf(800, 2, 99), undefined, "an index past the scale is no grade");

// Converted through the ladder, as COROS's getGradingGradeByCommonGrade does.
assert.equal(gradeNameOnLadder("route", CLIMB_SYSTEM.yds, 9), "5.10b");
assert.equal(gradeNameOnLadder("route", CLIMB_SYSTEM.french, 9), "6b");
assert.equal(gradeNameOnLadder("route", CLIMB_SYSTEM.uiaa, 12), "VIII-", "a grade covering two steps answers both");
assert.equal(gradeNameOnLadder("route", CLIMB_SYSTEM.uiaa, 11), "VIII-");
assert.equal(gradeNameOnLadder("boulder", CLIMB_SYSTEM.font, 5), "6A+");
assert.equal(gradeNameOnLadder("route", CLIMB_SYSTEM.french, 0), "4a", "below the ladder is its first rung");
assert.equal(gradeNameOnLadder("route", CLIMB_SYSTEM.french, 99), "9b+", "past it, its last");
// British trad is free climbing, on the route ladder: E2 covers outdoor 10–11.
assert.equal(climbGradeOf(802, CLIMB_SYSTEM.ukTrad, 7)?.name, "E2");
assert.equal(climbGradeOf(802, CLIMB_SYSTEM.ukTrad, 7)?.ladder, 9);
// Aid, ice and mixed are named, never ranked: an A3 pitch is no 5.12b.
assert.equal(climbGradeOf(802, CLIMB_SYSTEM.aid, 3), undefined);
assert.equal(climbGradeOf(802, CLIMB_SYSTEM.ice, 5), undefined);
assert.equal(climbGradeOf(802, CLIMB_SYSTEM.mixed, 7), undefined);
assert.equal(recordedGradeName(802, CLIMB_SYSTEM.aid, 3), "A3");
assert.equal(recordedGradeName(802, CLIMB_SYSTEM.ice, 5), "WI5");
// One sport, one ladder: an indoor route graded on a boulder scale is ungraded, and the other way round.
assert.equal(climbGradeOf(800, CLIMB_SYSTEM.vScale, 3), undefined);
assert.equal(climbGradeOf(801, CLIMB_SYSTEM.french, 8), undefined);
// The rows are the scales COROS's settings offer; another falls back to its default.
assert.equal(ladderRungs("route", CLIMB_SYSTEM.ukTrad)[0].name, "5.6");
assert.equal(ladderRungs("boulder", CLIMB_SYSTEM.french)[0].name, "V0");
assert.equal(onsightLadder("route", CLIMB_SYSTEM.french, 8), 9);
assert.equal(onsightLadder("boulder", CLIMB_SYSTEM.vScale, 2), 3);

// --- A session read out of COROS's payload ------------------------------------------

const start = 178_421_000_00; // hundredths of a second, as COROS stamps a lap
const lap = (at, seconds, fields) => ({
  startTimestamp: start + at * 100,
  endTimestamp: start + (at + seconds) * 100,
  time: seconds * 100,
  ...fields
});
const indoorRaw = {
  summary: { sportType: 800, startTimestamp: start },
  lapList: [
    {
      type: 2,
      lapItemList: [
        lap(0, 600, { mode: 3 }),
        lap(600, 150, { mode: 1, gradingSystem: 2, hardestGrade: 6, style: 2, falls: 0, elevGain: 13.5, avgHr: 128, maxHr: 141 }),
        lap(750, 300, { mode: 3 }),
        lap(1050, 240, { mode: 1, gradingSystem: 2, hardestGrade: 10, style: 3, falls: 2, elevGain: 15, avgHr: 146, maxHr: 170 }),
        lap(1290, 360, { mode: 3 }),
        lap(1650, 260, { mode: 1, gradingSystem: 2, hardestGrade: 10, style: 0, falls: 0, elevGain: 15, avgHr: 150, maxHr: 174 }),
        lap(1910, 200, { mode: 1, gradingSystem: 0, hardestGrade: 255, style: 255 })
      ]
    }
  ]
};
const indoor = parseClimbDetail(indoorRaw, { sportType: 800 });
assert.equal(indoor.climbs.length, 4, "rest laps are not climbs");
assert.deepEqual(indoor.climbs.map((climb) => climb.style), ["flash", "attempt", "redpoint", "unrecorded"]);
assert.deepEqual(indoor.climbs.map((climb) => climb.startSeconds), [600, 1050, 1650, 1910]);
assert.deepEqual(indoor.climbs.map((climb) => climb.restAfter), [300, 360, 0, undefined]);
assert.equal(indoor.climbs[3].system, undefined, "an ungraded climb keeps no grade");
assert.equal(indoor.climbingSeconds, 850);
assert.equal(indoor.restSeconds, 1260);
assert.equal(indoor.falls, 2);
assert.equal(indoor.heightMeters, 43.5);
assert.equal(indoor.climbs[1].maxHr, 170);
assert.equal(parseClimbDetail(indoorRaw, { sportType: 300 }), undefined, "a swim is no climb");
const empty = parseClimbDetail({ summary: { sportType: 801 }, lapList: [] }, { sportType: 801 });
assert.deepEqual(empty.climbs, [], "a session with no laps still answers, with no climbs");

// An outdoor day: the approach and the descent are walking; pitches gather into routes.
const outdoorRaw = {
  summary: { sportType: 802, startTimestamp: start },
  lapList: [
    {
      type: 2,
      lapItemList: [
        lap(0, 1500, { mode: 1, sportStage: 0 }),
        lap(1500, 400, { mode: 1, sportStage: 1, routeIndex: 1, gradingSystem: 2, hardestGrade: 9, style: 255, falls: 0, elevGain: 22 }),
        lap(1900, 450, { mode: 1, sportStage: 1, routeIndex: 1, gradingSystem: 2, hardestGrade: 11, style: 1, falls: 1, elevGain: 25 }),
        lap(2350, 900, { mode: 3, sportStage: 1 }),
        lap(3250, 500, { mode: 1, sportStage: 1, routeIndex: 2, gradingSystem: 2, hardestGrade: 12, style: 3, falls: 1, elevGain: 28 }),
        lap(3750, 1200, { mode: 1, sportStage: 2 })
      ]
    }
  ]
};
const outdoor = parseClimbDetail(outdoorRaw, { sportType: 802 });
assert.equal(outdoor.climbs.length, 2, "two routes, the walk in and out left out");
assert.equal(outdoor.climbs[0].pitches, 2);
assert.equal(outdoor.climbs[0].seconds, 850, "a route's pitches add up");
assert.equal(outdoor.climbs[0].gradeIndex, 11, "a route is graded by its hardest pitch");
assert.equal(outdoor.climbs[0].style, "onsight", "and goes as its last marked pitch went");
assert.equal(outdoor.climbs[0].falls, 1);
assert.equal(outdoor.climbs[0].heightMeters, 47);
assert.equal(outdoor.climbs[1].pitches, undefined);
// A day of approach laps alone climbed nothing, as COROS's web app reads stages.
const walkOnly = parseClimbDetail(
  { summary: { sportType: 802, startTimestamp: start }, lapList: [{ type: 2, lapItemList: [lap(0, 1500, { mode: 1, sportStage: 0 })] }] },
  { sportType: 802 }
);
assert.deepEqual(walkOnly.climbs, []);
// A lap whose time reads 0 is timed by its stamps.
const stamped = parseClimbDetail(
  {
    summary: { sportType: 800, startTimestamp: start },
    lapList: [{ type: 2, lapItemList: [{ ...lap(0, 95, { mode: 1, style: 2 }), time: 0 }] }]
  },
  { sportType: 800 }
);
assert.equal(stamped.climbs[0].seconds, 95);

const summary = climbSummaryOf(indoor);
assert.equal(summary.version, CLIMB_SUMMARY_VERSION);
assert.deepEqual(summary.climbs[1], { system: 2, gradeIndex: 10, style: "attempt", seconds: 240, falls: 2, heightMeters: 15 });
assert.equal(summary.climbingSeconds, 850);

// --- The screen's figures --------------------------------------------------------------

const DAY = 86_400;
const nowMs = Date.UTC(2026, 10, 26, 12) ; // a Thursday
const nowS = nowMs / 1000;
const session = (id, sportType, daysAgo, climbs, duration = 5400) => ({
  activity: { activityId: id, sportType, startTime: nowS - daysAgo * DAY, duration, name: id },
  summary: {
    activityId: id,
    fingerprint: "f",
    summaryVersion: 1,
    computedAt: 0,
    climbVersion: CLIMB_SUMMARY_VERSION,
    climb: {
      version: CLIMB_SUMMARY_VERSION,
      climbs,
      climbingSeconds: climbs.reduce((sum, climb) => sum + climb.seconds, 0),
      falls: climbs.reduce((sum, climb) => sum + (climb.falls ?? 0), 0)
    }
  }
});
const route = (gradeIndex, style, seconds = 180, falls) => ({ system: 2, gradeIndex, style, seconds, ...(falls ? { falls } : {}) });
const problem = (gradeIndex, style, seconds = 60) => ({ system: 7, gradeIndex, style, seconds });
const sessions = [
  session("a", 800, 1, [route(6, "flash"), route(8, "redpoint"), route(10, "attempt", 200, 2), route(10, "redpoint")]),
  session("b", 801, 2, [problem(2, "flash"), problem(4, "attempt"), problem(3, "redpoint"), problem(1, "unrecorded")], 3600),
  session("c", 800, 9, [route(7, "onsight"), route(9, "flash"), route(11, "attempt", 240, 1)]),
  session("unread", 800, 3, [])
];
const activities = sessions.map((entry) => entry.activity);
const summaries = new Map(sessions.filter((entry) => entry.activity.activityId !== "unread").map((entry) => [entry.activity.activityId, entry.summary]));

const records = climbRecords(activities, summaries);
assert.equal(records.length, 11, "the unread session adds nothing");
assert.equal(records[0].activity.activityId, "c", "oldest session first");

// The scale: COROS's setting first, else the scale most climbs were graded in.
assert.deepEqual(climbScales(undefined, records), { route: 2, boulder: 7, onsight: {} });
const scales = climbScales(
  { climbSettings: { indoorClimb: { system: 1, gradeIndex: 8 }, bouldering: { system: 8, gradeIndex: 4 } } },
  records
);
assert.equal(scales.route, 1);
assert.equal(scales.boulder, 8);
assert.equal(scales.onsight.route, 12, "5.11a onsight");
assert.equal(scales.onsight.boulder, 5, "6A+ onsight");
assert.equal(gradeName("route", 11, scales), "5.10d");

const french = climbScales(undefined, records);
const routeSend = hardestSend(records, "route");
assert.equal(routeSend.activity.activityId, "a", "6c sent on a; the 6c+ on c was an attempt");
assert.equal(gradeName("route", routeSend.ladder, french), "6c");
assert.equal(gradeName("boulder", hardestSend(records, "boulder").ladder, french), "V3");
assert.deepEqual(sendRate(records, "route"), { sent: 5, marked: 7 });
assert.deepEqual(sendRate(records, "boulder"), { sent: 2, marked: 3 }, "a climb nobody marked counts in neither");

const pyramid = gradePyramid(records, "route", french);
assert.deepEqual(pyramid.rows.map((row) => row.name), ["6c+", "6c", "6b+", "6b", "6a+", "6a"], "hardest first, easiest climbed last");
assert.deepEqual(pyramid.rows[1].counts, { firstGo: 0, worked: 1, attempt: 1, unrecorded: 0 });
assert.equal(pyramid.graded, 7);
assert.equal(pyramid.sent, 5);
const withOnsight = gradePyramid(records, "route", { ...french, onsight: { route: 13 } });
assert.equal(withOnsight.rows[0].name, "7a", "the onsight grade stretches the rows to reach it");
assert.equal(withOnsight.rows[0].onsight, true);
assert.equal(withOnsight.rows[0].total, 0);
const boulders = gradePyramid(records, "boulder", french);
assert.deepEqual(boulders.rows.map((row) => row.name), ["V4", "V3", "V2", "V1"]);
assert.equal(boulders.ungraded, 0);

const totals = summariseClimbs(activities, summaries);
assert.equal(totals.sessions, 4);
assert.equal(totals.read, 3);
assert.equal(totals.climbs, 11);
assert.equal(totals.falls, 3);

const weeks = buildClimbWeeks(activities, summaries, { weeks: 2, nowMs });
assert.equal(weeks.length, 2);
const thisWeek = weeks[1];
assert.equal(thisWeek.sessions, 3, "a, b and the unread one this week (Monday the 23rd on)");
assert.equal(thisWeek.unread, 1);
assert.equal(thisWeek.climbs, 8);
assert.equal(thisWeek.byKind.boulder.climbs, 4);
assert.equal(thisWeek.hardest.route, 11);
assert.equal(weeks[0].sessions, 1);

const kinds = climbKindBreakdown(activities, summaries, french);
assert.deepEqual(kinds.map((entry) => entry.kind), ["indoor", "boulder"]);
assert.equal(kinds[0].sessions, 3);
assert.equal(kinds[0].hardest, "6c");
assert.equal(kinds[1].hardest, "V3");

const wall = wallFigures(activities, summaries);
assert.ok(wall.share > 0 && wall.share < 1);
assert.equal(wall.avgProblemSeconds, 60);

// --- Personal Records: the hardest send of each ladder -----------------------------------

const board = buildRecordBoard({ activities, groups: [], fell: new Map(), summaries });
assert.deepEqual(board.climbing.map((entry) => [entry.key, entry.mark.grade, entry.mark.style]), [
  ["route", "6c", "redpoint"],
  ["boulder", "V3", "redpoint"]
]);
assert.equal(board.climbing[0].mark.activity.activityId, "a");
assert.deepEqual(buildRecordBoard({ activities, groups: [], fell: new Map() }).climbing, [], "no summaries, no climbing records");

// The hall reads a climb's summary for its climbs, not a distance.
assert.equal(needsRecordsSummary({ sportType: 800, distance: 0 }, undefined), true);
assert.equal(needsRecordsSummary({ sportType: 800, distance: 0 }, { climbVersion: CLIMB_SUMMARY_VERSION }), false);
assert.equal(needsRecordsSummary({ sportType: 402, distance: 0 }, undefined), false, "strength still needs nothing");

console.log("climb metrics: ok");
