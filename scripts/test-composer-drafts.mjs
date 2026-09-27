/**
 * Two things the Coach Workbench UAT asked to be kept, held down here:
 *
 * 1. A conversation's unsent question — its words and the references waiting
 *    beside them — survives leaving the conversation (`composerDrafts.ts`).
 *    Each conversation keeps its own, an empty draft is removed rather than
 *    stored, and a sent or deleted conversation lets it go.
 * 2. Pressing a calendar day opens what is on it (`daySelection`): nothing on
 *    an empty day, the one thing itself when there is one — exactly what its
 *    chip opens — and the day as a whole otherwise.
 *
 * Runs through Electron only so `--experimental-strip-types` is available on
 * a Node built without Amaro; it touches no SQLite and no window.
 */
import assert from "node:assert/strict";

// A localStorage for the module to write to.
const backing = new Map();
globalThis.localStorage = {
  getItem: (key) => (backing.has(key) ? backing.get(key) : null),
  setItem: (key, value) => backing.set(key, String(value)),
  removeItem: (key) => backing.delete(key)
};

const {
  COMPOSER_DRAFTS_KEY,
  clearComposerDraft,
  loadComposerDraft,
  saveComposerDraft
} = await import("../src/chat/composerDrafts.ts");
const { dayItems, daySelection } = await import("../src/calendar/calendarTypes.ts");

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------
const week = { artifactId: "a", draftId: "d", name: "Base", artifactType: "plan", scope: "week", weekIndex: 1, label: "Week 2" };
const day = { scope: "day", day: "20260927", label: "Sat 27 Sep" };

assert.equal(loadComposerDraft("s1"), undefined, "nothing is kept for a conversation never written in");

saveComposerDraft("s1", { text: "Is this too much?", refs: [week], scheduleRefs: [] }, 1);
saveComposerDraft("s2", { text: "", refs: [], scheduleRefs: [day] }, 2);
assert.deepEqual(loadComposerDraft("s1"), { text: "Is this too much?", refs: [week], scheduleRefs: [], updatedAt: 1 });
assert.deepEqual(loadComposerDraft("s2")?.scheduleRefs, [day], "a reference alone is a draft worth keeping");

saveComposerDraft("s1", { text: "   ", refs: [], scheduleRefs: [] }, 3);
assert.equal(loadComposerDraft("s1"), undefined, "an emptied draft is removed, not stored empty");
assert.ok(loadComposerDraft("s2"), "and the other conversation keeps its own");

clearComposerDraft("s2");
assert.equal(backing.has(COMPOSER_DRAFTS_KEY), false, "the key goes when no draft is left");

backing.set(COMPOSER_DRAFTS_KEY, "not json");
assert.equal(loadComposerDraft("s1"), undefined, "an unreadable store reads as empty");
saveComposerDraft("s3", { text: "hi", refs: [], scheduleRefs: [] }, 4);
assert.equal(loadComposerDraft("s3")?.text, "hi", "and is replaced on the next save");

for (let index = 0; index < 45; index += 1) {
  saveComposerDraft(`many-${index}`, { text: `q${index}`, refs: [], scheduleRefs: [] }, 100 + index);
}
assert.equal(Object.keys(JSON.parse(backing.get(COMPOSER_DRAFTS_KEY))).length, 40, "only the newest forty are kept");
assert.equal(loadComposerDraft("many-0"), undefined, "the oldest go first");
assert.equal(loadComposerDraft("many-44")?.text, "q44");

// ---------------------------------------------------------------------------
// Calendar days
// ---------------------------------------------------------------------------
const planned = { planId: "P", idInPlan: "1", name: "Easy run", happenDay: "20260927" };
const run = { activityId: "A1", name: "Morning run", sportType: 100 };
const ride = { activityId: "A2", name: "Commute", sportType: 200 };
const calendarDay = (overrides) => ({
  dateKey: "20260927",
  inMonth: true,
  isToday: false,
  isPast: true,
  scheduled: [],
  activities: [],
  pairs: [],
  unplannedActivities: [],
  ...overrides
});

assert.equal(daySelection(calendarDay({})), null, "an empty day does not open");

const onlyPlanned = calendarDay({ scheduled: [planned], pairs: [{ scheduled: planned, targets: {} }] });
assert.deepEqual(daySelection(onlyPlanned), { kind: "scheduled", day: onlyPlanned, entry: planned }, "one planned session opens itself");

const onlyDone = calendarDay({ scheduled: [planned], activities: [run], pairs: [{ scheduled: planned, activity: run, targets: {} }] });
assert.deepEqual(daySelection(onlyDone), { kind: "activity", day: onlyDone, activity: run }, "a planned session that was done opens as the activity, as its chip does");

const onlyExtra = calendarDay({ activities: [ride], unplannedActivities: [ride] });
assert.deepEqual(daySelection(onlyExtra), { kind: "activity", day: onlyExtra, activity: ride });

const busy = calendarDay({
  scheduled: [planned],
  activities: [run, ride],
  pairs: [{ scheduled: planned, activity: run, targets: {} }],
  unplannedActivities: [ride]
});
assert.deepEqual(daySelection(busy), { kind: "day", day: busy }, "two things open the day as a whole");
assert.deepEqual(
  dayItems(busy).map((item) => (item.kind === "activity" ? item.activity.activityId : item.entry.idInPlan)),
  ["A1", "A2"],
  "in the order the cell draws them"
);

console.log("composer drafts and calendar day tests passed");
