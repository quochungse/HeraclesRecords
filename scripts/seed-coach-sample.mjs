// Sample Coach conversations for testing docs/coach-plan-canvas.md (P0–P3) by
// hand — without asking a model anything, so every run is the same and costs
// no tokens.
//
// It writes straight into the app's own database, the way Coach would have:
// conversations, their anchors, and the rows behind them (drafts and their
// versions, briefs and outlines, change sets). Cards are built by the real
// tools (`draft_training_plan`, `revise_training_plan`, `request_plan_brief`,
// `propose_schedule_changes`, …) and edits by the functions the editor calls,
// so what is checked in a turn is checked here too. Every name starts "Sample".
//
//   npm run sample:coach
//     Offline, every phase. Nothing is written to COROS; a card's Save does
//     write, and that is part of what can be tried (cleanup takes it off).
//
//     P0  cards, answers, saving: a one-shot dated plan, an undated programme,
//         one-off workouts dated and not, a date gone by, a plan with a session
//         in the past (no longer a one-shot), answered questions, a removed card, a card marked saved
//         (Hide rather than Remove), and entries a newer build wrote.
//     P1  versions and references: a plan in four versions (Coach, Coach's
//         revision, your edit, a restore — with Undo), a workout edited, a
//         question pointing at a week and a session, a card Coach attached
//         unasked, follow-up chips; and the stored oddities — a card from
//         before versions, two machines' versions of one plan, a version an
//         older build edited in place. The coach's creation index is printed.
//     P2  the pipeline: a brief still missing a field (in a conversation that
//         does not share sleep), a brief ready to draw, an outline drawn and
//         redrawn, and a plan written to it. Run the app with
//         `npm run dev:simulate-plan-ai` and Draw the outline / Write the
//         sessions cost nothing either.
//     P3  change sets and references: every state a line can be in, an
//         analysis's proposal, chips from the Calendar and the Library, and
//         creations for the canvas.
//
//   npm run sample:coach -- --only p0,p2
//     Just those phases. `npm run sample:coach-p3` is `--only p3`.
//
//   npm run sample:coach -- --live
//     Also, on COROS (signed in in the app):
//     P1  a plan saved to COROS and revised after, so its card offers
//         "Update COROS plan"; change it in the COROS app to watch it come back.
//     P3  temporary data in an empty three-week window at least four weeks
//         out — a plan on the calendar, four sessions of your own and a
//         library workout — and a conversation whose proposal moves, replaces,
//         removes and adds sessions of both, and a delete card for one. It
//         also prints what `list_training_plans` and `get_training_plan` answer.
//
//   npm run sample:coach -- --cleanup
//     Removes the conversations and every row behind them, and — signed in —
//     what is on COROS under a sample name: plans (taken off the calendar
//     first), calendar sessions from 60 days back to 300 ahead, and library
//     workouts whose name starts "Sample ·", "Sample own ·" or "Sample plan".
//     A plan Coach writes for you from the P2 brief is named by Coach, so it is
//     not recognised: delete that one yourself. What was made is listed in
//     `<userData>/coach-sample.json`.
//
// Close the app first: it holds the database open and would not see the new
// conversations until restarted anyway. The conversations are filed under the
// Coach provider you have selected, since the sidebar lists one provider's.
// Nothing here is published to sync: the rows are written on this machine only.
//
// HERACLES_USER_DATA=/path/to/userData overrides where the database is.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const LIVE = process.argv.includes("--live");
const CLEANUP = process.argv.includes("--cleanup");
const onlyAt = process.argv.indexOf("--only");
const PHASES = new Set(
  onlyAt >= 0 ? String(process.argv[onlyAt + 1] ?? "").toLowerCase().split(",").map((phase) => phase.trim()) : ["p0", "p1", "p2", "p3"]
);
if (![...PHASES].every((phase) => ["p0", "p1", "p2", "p3"].includes(phase))) {
  console.error("--only takes phases from p0,p1,p2,p3, comma-separated.");
  process.exit(1);
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = (file) => import(`${pathToFileURL(path.join(repoRoot, "dist-electron", file)).href}?cacheBust=${Date.now()}`);

/* userData is named after package.json's top-level `name` — see CLAUDE.md. */
function userDataDir() {
  if (process.env.HERACLES_USER_DATA) return process.env.HERACLES_USER_DATA;
  const name = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")).name;
  if (process.platform === "darwin") return path.join(os.homedir(), "Library/Application Support", name);
  if (process.platform === "win32") return path.join(process.env.APPDATA ?? "", name);
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"), name);
}

const userData = userDataDir();
if (!fs.existsSync(path.join(userData, "coroslink.sqlite"))) {
  console.error(`No app database in ${userData}. Run the app once, or set HERACLES_USER_DATA.`);
  process.exit(1);
}
const manifestPath = path.join(userData, "coach-sample.json");
/* What the P3-only script before this one wrote; cleanup reads it too. */
const legacyManifestPath = path.join(userData, "coach-p3-sample.json");

const database = await dist("database.js");
database.initializeDatabase(userData);
const history = await dist("chatHistoryStore.js");
const service = await dist("chatService.js");
const workoutTools = await dist("chatWorkoutTools.js");
const changes = await dist("chatScheduleChanges.js");
const briefs = await dist("chatPlanBriefs.js");
const generation = await dist("trainingPlanGeneration.js");
const simulation = await dist("trainingPlanSimulation.js");
const compaction = await dist("chatContextCompaction.js");
const hub = await dist("trainingHubService.js");
const adapter = await dist("corosTrainingPlanAdapter.js");
const library = await dist("trainingLibraryService.js");
const planTools = await dist("chatPlanTools.js");

const signedIn = () => Boolean(database.getSetting("trainingHub.accessToken") && database.getSetting("trainingHub.userId"));

// ---------------------------------------------------------------------------
// Days
// ---------------------------------------------------------------------------

const key = (date) =>
  `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
const iso = (day) => `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`;
const addDays = (date, days) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};
const noon = () => {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  return date;
};
const fromToday = (days) => key(addDays(noon(), days));
/** "Sun 27 Sep", spelled as the cards spell it — not by ICU, which writes "Sept" in some builds. */
const label = (day) => {
  const date = new Date(Number(day.slice(0, 4)), Number(day.slice(4, 6)) - 1, Number(day.slice(6, 8)), 12);
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][date.getDay()];
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][date.getMonth()];
  return `${weekday} ${date.getDate()} ${month}`;
};

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

/** What a sample put on COROS, by name. */
const SAMPLE_NAME = /^Sample (·|own ·|plan\b)/;

async function sweepCoros(windows) {
  const plans = await adapter.listNativeCorosPlans();
  for (const plan of plans) {
    if (plan.executeStatus === 1 && (SAMPLE_NAME.test(plan.name ?? "") || windows.planIds.has(plan.sourcePlanId))) {
      await adapter.quitNativeCorosPlan(plan.remoteId);
      console.log(`took "${plan.name}" off the calendar (${plan.remoteId})`);
    }
  }
  const ranges = [[fromToday(-60), fromToday(300)], ...windows.ranges];
  for (const [start, end] of ranges) {
    // A month at a time: the calendar is read in the spans the app reads it in.
    for (let from = start; from <= end; ) {
      const date = new Date(Number(from.slice(0, 4)), Number(from.slice(4, 6)) - 1, Number(from.slice(6, 8)), 12);
      const to = [key(addDays(date, 27)), end].sort()[0];
      for (const entry of await hub.listScheduledWorkoutEntries(from, to)) {
        if (!SAMPLE_NAME.test(entry.name)) continue;
        try {
          await hub.removeScheduledWorkout(entry);
          console.log(`removed "${entry.name}" from ${entry.happenDay}`);
        } catch (error) {
          console.log(`could not remove "${entry.name}" from ${entry.happenDay}: ${error.message}`);
        }
      }
      from = key(addDays(date, 28));
    }
  }
  for (const plan of await adapter.listNativeCorosPlans()) {
    if (SAMPLE_NAME.test(plan.name ?? "") || windows.planIds.has(plan.remoteId) || windows.planIds.has(plan.sourcePlanId)) {
      await adapter.deleteNativeCorosPlan(plan.remoteId);
      database.deleteCorosPlanCache(plan.remoteId);
      console.log(`deleted plan "${plan.name}" (${plan.remoteId})`);
    }
  }
  for (const id of windows.planIds) database.deleteCorosPlanCache(id);
  hub.invalidateLibraryWorkoutPrograms();
  for (const workout of await hub.listLibraryWorkouts()) {
    if (SAMPLE_NAME.test(workout.name)) {
      await hub.deleteWorkoutProgram(workout.id);
      console.log(`deleted library workout "${workout.name}"`);
    }
  }
}

async function cleanup() {
  const manifests = [manifestPath, legacyManifestPath].filter((file) => fs.existsSync(file));
  // COROS is swept by name, so a sweep needs no manifest: one left for later
  // (made signed out) or a card saved after an earlier cleanup is still found.
  if (!manifests.length && !signedIn()) {
    console.log("Nothing to clean up: no sample was made (or it was already removed).");
    return;
  }
  const windows = { ranges: [], planIds: new Set() };
  for (const file of manifests) {
    const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const sessionId of manifest.sessions ?? []) {
      service.deleteChatSessionById(sessionId);
      console.log(`removed conversation ${sessionId} and what it held`);
    }
    // A version the transcript does not name (none should be left, but a
    // conversation deleted in the app first leaves its rows to nobody).
    for (const draftId of manifest.drafts ?? []) database.deleteChatPlanDraft(draftId);
    for (const artifactId of manifest.artifacts ?? []) database.deleteChatPlanArtifactRow(artifactId);
    if (manifest.live) {
      const { start, end } = manifest.live;
      const past = new Date(Number(end.slice(0, 4)), Number(end.slice(4, 6)) - 1, Number(end.slice(6, 8)) + 28, 12);
      windows.ranges.push([start, key(past)]);
      for (const id of [manifest.live.templateId, manifest.live.runningId]) if (id) windows.planIds.add(id);
    }
    for (const id of manifest.corosPlans ?? []) windows.planIds.add(id);
  }
  if (signedIn()) await sweepCoros(windows);
  else console.log("Not signed in to COROS: anything a sample put there is left. Sign in and run --cleanup again to take it off.");
  for (const file of manifests) fs.rmSync(file);
  console.log("Sample removed.");
}

if (CLEANUP) {
  await cleanup();
  database.closeDatabase();
  process.exit(0);
}

for (const file of [manifestPath, legacyManifestPath]) {
  if (fs.existsSync(file)) {
    console.error(`A sample is already there (${file}). Remove it first: npm run sample:coach -- --cleanup`);
    process.exit(1);
  }
}
if (LIVE && !signedIn()) {
  // The session the app keeps, read as the verifier reads it: the status call
  // also asks the OS keychain, which is not there outside a window.
  console.error("--live needs COROS: sign in in the app first. Nothing was made.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

const provider = database.getSetting("chat.provider") || "claude-code";
const manifest = { createdAt: new Date().toISOString(), provider, sessions: [], drafts: [], artifacts: [], corosPlans: [] };
const saveManifest = () => fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
const made = [];

/** An empty conversation, recorded for cleanup before anything is written into it. */
function conversation(title, note) {
  const created = history.createChatSession(provider);
  history.setChatSessionTitle(created.id, title);
  manifest.sessions.push(created.id);
  saveManifest();
  made.push([title, note]);
  console.log(`conversation "${title}" (${created.id})`);
  return created.id;
}

/** Writes a conversation's entries, and records every draft and brief it holds for cleanup. */
function write(sessionId, entries) {
  history.saveChatSession(sessionId, entries);
  for (const entry of entries) {
    if (entry.kind === "planDraft") manifest.drafts.push(entry.draft.draftId);
    if (entry.kind === "planBrief") manifest.artifacts.push(entry.artifactId);
  }
  saveManifest();
  const stored = history.getChatSession(sessionId);
  if (stored.length !== entries.length) {
    throw new Error(`${entries.length} entries were written and ${stored.length} came back — the store dropped some.`);
  }
  return stored;
}

const user = (content, extra = {}) => ({ kind: "message", role: "user", content, ...extra });
const coach = (content, extra = {}) => ({ kind: "message", role: "assistant", content, ...extra });
const card = (draft) => ({ kind: "planDraft", draft });

/** The real draft tools, as a turn of this conversation calls them; the card each one shows. */
function creator(sessionId) {
  const cards = [];
  return async (name, args, options = {}) => {
    const result = JSON.parse(
      await workoutTools.handleChatWorkoutTool(name, args, {
        sessionId,
        allowUpcomingWorkouts: false,
        onPlanDraft: (preview) => cards.push(preview),
        ...options
      })
    );
    if (!result.ok) throw new Error(`${name} refused the sample: ${JSON.stringify(result)}`);
    return cards[cards.length - 1];
  };
}

const stepsOf = (minutes) => [
  { kind: "warmup", target_type: "time", target_duration_seconds: 600, intensity: { type: "none" } },
  { kind: "training", target_type: "time", target_duration_seconds: (minutes - 15) * 60, intensity: { type: "none" } },
  { kind: "cooldown", target_type: "time", target_duration_seconds: 300, intensity: { type: "none" } }
];
const run = (name, minutes, extra = {}) => ({
  key: name.toLowerCase().replace(/^sample · /, "").replace(/[^a-z0-9]+/g, "-"),
  name,
  sport: "run",
  steps: stepsOf(minutes),
  ...extra
});

/** A version's event line, as the editor's save or a restore leaves it. */
const planEvent = (written, action, name) => ({
  kind: "planEvent",
  event: {
    eventId: `sample-${action}-${written.preview.draftId}`,
    artifactId: written.artifactId,
    draftId: written.preview.draftId,
    action,
    author: "athlete",
    name: name ?? written.preview.name,
    artifactType: written.preview.artifactType ?? "plan",
    fromVersion: written.fromVersion,
    toVersion: written.toVersion,
    ...(written.changes.length ? { changes: written.changes } : {}),
    at: Date.now()
  }
});

/**
 * Moves a stored draft's days — the row, and the card that shows it — as if
 * it had been written that long ago. The tools refuse a day gone by, which is
 * the point of a card whose day has since passed.
 */
function shiftDays(preview, from, to) {
  // Each day in the three spellings a draft holds: the key, ISO, and the card's "Sun 27 Sep".
  const swap = (text) =>
    from.reduce(
      (out, day, index) =>
        [day, iso(day), label(day)].reduce((next, spelling, form) => {
          const replacement = [to[index], iso(to[index]), label(to[index])][form];
          return next.split(spelling).join(replacement);
        }, out),
      text
    );
  const record = database.getChatPlanDraft(preview.draftId);
  database.saveChatPlanDraft({
    ...record,
    planJson: swap(record.planJson),
    previewJson: swap(record.previewJson),
    ...(record.documentJson ? { documentJson: swap(record.documentJson) } : {})
  });
  return JSON.parse(swap(JSON.stringify(preview)));
}

// ===========================================================================
// P0 — cards, answers, saving
// ===========================================================================

if (PHASES.has("p0")) {
  const sessionId = conversation(
    "P0 sample · cards, answers, saving",
    "each card's buttons (P0.5), Edit on a workout (P0.4), answered questions (P0.3), Remove vs Hide (P0.8)"
  );
  const create = creator(sessionId);

  // One-shot: every session dated, first to last within 14 days.
  const oneShot = await create("draft_training_plan", {
    name: "Sample · Next five days",
    description: "Four sessions from tomorrow. Primary button: Put sessions on calendar.",
    workouts: [
      run("Sample · Easy 30", 30, { schedule_date: fromToday(1) }),
      run("Sample · Steady 40", 40, { schedule_date: fromToday(2) }),
      run("Sample · Easy 30 again", 30, { schedule_date: fromToday(4) }),
      run("Sample · Long 60", 60, { schedule_date: fromToday(5) })
    ]
  });
  // A programme: week and day, no dates — laid out by week, saved whole.
  const programme = await create("draft_training_plan", {
    name: "Sample · Six-week programme",
    description: "Undated: read by week and day, not as Unscheduled. Primary button: Save to COROS.",
    week_stages: [1, 2, 3, 4, 5, 6].map((week) => ({ week, stage: week < 5 ? "base" : "build" })),
    workouts: [1, 2, 3, 4, 5, 6].flatMap((week) => [
      run(`Sample · W${week} Easy`, 35 + week * 5, { key: `w${week}-easy`, week, day: "tue" }),
      run(`Sample · W${week} Steady`, 40 + week * 5, { key: `w${week}-steady`, week, day: "thu" }),
      run(`Sample · W${week} Long`, 60 + week * 10, { key: `w${week}-long`, week, day: "sun" })
    ])
  });
  // A plan written last week, one session already gone: no longer a one-shot, and never put on the calendar session by session.
  const writtenDays = [fromToday(1), fromToday(3), fromToday(5)];
  const staleDays = [fromToday(-2), fromToday(0), fromToday(2)];
  const lastWeek = shiftDays(
    await create("draft_training_plan", {
      name: "Sample · Plan with a day gone by",
      description: "Its first session was two days ago, so its sessions are not offered to the calendar one by one.",
      workouts: writtenDays.map((day, index) => run(`Sample · Session ${index + 1}`, 30 + index * 10, { schedule_date: day }))
    }),
    writtenDays,
    staleDays
  );
  // One-off workouts: dated ahead, undated, and dated but passed.
  const datedWorkout = await create("draft_workout", {
    workout: run("Sample · Tempo on a day", 45),
    calendar_date: fromToday(3)
  });
  const undatedWorkout = await create("draft_workout", { workout: run("Sample · Tempo any day", 40) });
  const passedWorkout = shiftDays(
    await create("draft_workout", { workout: run("Sample · Tempo, day passed", 40), calendar_date: fromToday(1) }),
    [fromToday(1)],
    [fromToday(-3)]
  );
  // Removed before it was saved: its row goes, the entry stays with `removedAt` and is not drawn.
  const removed = await create("draft_workout", { workout: run("Sample · Removed card", 30) });
  service.removePlanDraft(removed.draftId);
  // Marked saved (nothing is on COROS): its ⋯ offers Hide, and hiding leaves the row.
  const saved = await create("draft_workout", { workout: run("Sample · Marked saved", 30) });
  const savedAt = Date.now();
  database.markChatPlanDraftUploaded(saved.draftId, savedAt);

  write(sessionId, [
    user("Give me something for the next few days."),
    coach("Four sessions from tomorrow. The card sits under this answer, never above it."),
    card(oneShot),
    user("And a programme I can start later."),
    coach("Six weeks, undated: saved to COROS as one plan, then put on the calendar from there."),
    card(programme),
    {
      kind: "coachPrompt",
      prompt: {
        promptId: "sample-prompt-choice",
        question: "How many days a week can you train?",
        choices: [
          { id: "three", label: "3 days", response: "Three days a week." },
          { id: "four", label: "4 days", response: "Four days a week." },
          { id: "five", label: "5 days", response: "Five days a week." }
        ],
        allowCustom: true,
        answer: "Four days a week.",
        selectedChoiceId: "four",
        answeredAt: Date.now()
      }
    },
    {
      kind: "coachPrompt",
      prompt: {
        promptId: "sample-prompt-custom",
        question: "Anything I should avoid?",
        choices: [
          { id: "none", label: "Nothing", response: "Nothing to avoid." },
          { id: "knees", label: "Hills", response: "No hills, my knees don't like them." }
        ],
        allowCustom: true,
        answer: "No running on Wednesdays — I swim then.",
        answeredAt: Date.now()
      }
    },
    coach("Both questions above are answered, so each reads as one line: Asked … → the answer."),
    user("This one I wrote last week — can I still put it on the calendar?"),
    coach("Its first session has passed, so it is no longer a one-shot: Save to COROS leads, and Put sessions on calendar is not offered at all — COROS would refuse the day gone by."),
    card(lastWeek),
    user("Give me single sessions: one for a set day, one for any day."),
    coach("Dated ahead: Schedule for that day. Undated: Save to Workout Library. Both have Edit."),
    card(datedWorkout),
    card(undatedWorkout),
    coach("And one whose day has passed: the library leads, Schedule… asks for a new day."),
    card(passedWorkout),
    card({ ...removed, removedAt: Date.now() }),
    coach("A card marked saved (nothing is on COROS): its ⋯ offers Hide, not Remove."),
    card({ ...saved, uploadedAt: savedAt, uploadResult: { workoutsScheduled: 0, workoutsCreated: 1, destination: "workoutLibrary" } }),
    // Written by a newer build: an entry kind and a field this build does not know. Invisible, and kept.
    { kind: "sampleFromTheFuture", note: "An entry kind this build does not know: not drawn, not lost." },
    user("A question whose entry carries a field this build does not know.", { sampleFutureField: { kept: true } }),
    coach("(A sample answer.) Above this: an unknown kind and an unknown field, both kept on every save.")
  ]);
}

// ===========================================================================
// P1 — versions, edits, references
// ===========================================================================

async function writeCreationIndex(sessionId) {
  const entries = history.getChatSession(sessionId);
  const draftIds = entries.flatMap((entry) => (entry.kind === "planDraft" ? [entry.draft.draftId] : []));
  const index = compaction.creationIndex(entries, service.listPlanArtifactVersions(draftIds));
  console.log(`\nWhat Coach is told on every turn in this conversation (creationIndex):\n${index ?? "(nothing)"}\n`);
}

if (PHASES.has("p1")) {
  {
    const sessionId = conversation(
      "P1 sample · versions, edits, references",
      "four versions with Restore and Undo, an edited workout, week/session chips, an unasked card, follow-up chips"
    );
    const create = creator(sessionId);

    const v1 = await create("draft_training_plan", {
      name: "Sample · Base to 10k",
      description: "Three undated weeks toward a 10k. Written by the sample script; nothing is on COROS.",
      week_stages: [
        { week: 1, stage: "base" },
        { week: 2, stage: "base" },
        { week: 3, stage: "build" }
      ],
      workouts: [
        run("Easy 40", 40, { week: 1, day: "tue" }),
        run("Steady 45", 45, { week: 1, day: "thu" }),
        run("Long 70", 70, { week: 1, day: "sat" }),
        run("Easy 40 again", 40, { week: 2, day: "tue" }),
        run("Steady 50", 50, { week: 2, day: "thu" }),
        run("Long 80", 80, { week: 2, day: "sat" }),
        run("Easy 45", 45, { week: 3, day: "tue" }),
        run("Tempo 45", 45, { week: 3, day: "thu" }),
        run("Long 90", 90, { week: 3, day: "sun" })
      ],
      suggested_refinements: ["Make week 2 lighter", "Add strides", "Long runs on Sunday"]
    });
    const v2 = await create("revise_training_plan", {
      draft_id: v1.draftId,
      summary: "Long runs moved to Sunday, week 2 made lighter",
      ops: [
        { op: "move_session", key: "long-70", week: 1, day: "sun" },
        { op: "move_session", key: "long-80", week: 2, day: "sun" },
        { op: "replace_session", key: "steady-50", workout: run("Easy 35", 35) },
        { op: "set_week_stage", week: 3, stage: "peak" }
      ],
      suggested_refinements: ["Add a race week", "More hills"]
    });
    const document = workoutTools.planDraftDocument(v2.draftId);
    const v3 = await workoutTools.savePlanDraftEdit(
      v2.draftId,
      {
        ...document,
        name: "Sample · Base to 10k (my edit)",
        entries: document.entries.map((entry) =>
          entry.title === "Tempo 45" ? { ...entry, dayIndex: 2, title: "Tempo 40", workout: { ...entry.workout, name: "Tempo 40" } } : entry
        )
      },
      "metric"
    );
    if (v3.kind !== "written") throw new Error("The sample edit was refused as a conflict.");
    // Restoring v1 writes v4, on top of the newest: its event line carries Undo.
    const v4 = workoutTools.restorePlanDraftVersion(v1.draftId, "metric");

    const workout = await create("draft_workout", {
      workout: run("Sample · Tempo 35", 35),
      suggested_refinements: ["Make it a progression run"]
    });
    const workoutEdit = service.editWorkoutDraft(workout.draftId, { ...run("Sample · Tempo 40 (my edit)", 40), key: "tempo-35" }, "metric");
    if (workoutEdit.kind !== "written") throw new Error("The sample workout edit was refused as a conflict.");

    const unasked = await create("draft_workout", { workout: run("Sample · Shakeout 20", 20) });
    const artifactId = v1.draftId;
    const week2 = {
      artifactId,
      draftId: v4.preview.draftId,
      version: v4.toVersion,
      name: v4.preview.name,
      artifactType: "plan"
    };

    write(sessionId, [
      user("Build me three weeks toward a 10k."),
      coach("Three weeks: two of base, one of build. Open it to read it week by week."),
      card(v1),
      user("Put the long runs on Sunday and make week 2 lighter."),
      coach("Done — the card above folds into this version. Versions compares any two."),
      card(v2),
      planEvent(v3, "edited"),
      card(v3.preview),
      planEvent(v4, "restored"),
      card(v4.preview),
      {
        kind: "planRefs",
        refs: [
          { ...week2, scope: "week", weekIndex: 1, label: "Week 2" },
          { ...week2, scope: "session", weekIndex: 1, sessionKey: "long-80", label: "Week 2 · Sat · Long 80" }
        ]
      },
      user("Is this week too much, and is the long run too long?"),
      coach("(A sample answer.) The chips above this question are what Ask Coach on a week and on a session send."),
      user("And one tempo run I can do any day."),
      coach("Here it is; I made it 40 minutes after you asked."),
      card(workout),
      planEvent(workoutEdit, "edited"),
      card(workoutEdit.preview),
      user("How did this week go?"),
      coach("(A sample answer.) Steady week. I've attached a short shakeout for tomorrow — you did not ask for it; that is P1.9's unasked card."),
      card(unasked)
    ]);
    await writeCreationIndex(sessionId);
  }

  {
    const sessionId = conversation(
      "P1 sample · stored oddities",
      "a card from before versions, two machines' versions of one plan, a version an older build edited in place"
    );
    const create = creator(sessionId);

    // A row from before versions: no artifact, no version, no author.
    const legacy = await create("draft_workout", { workout: run("Sample · Card from before versions", 35) });
    const legacyRow = database.getChatPlanDraft(legacy.draftId);
    database.saveChatPlanDraft({
      draftId: legacyRow.draftId,
      planJson: legacyRow.planJson,
      previewJson: legacyRow.previewJson,
      createdAt: legacyRow.createdAt - 86_400_000
    });

    // Two machines each wrote a version 2 of one plan while offline.
    const fork = await create("draft_training_plan", {
      name: "Sample · Forked plan",
      description: "Version 2 was written on two machines at once: neither is lost, and the later one is the newest.",
      workouts: [
        run("Easy 40", 40, { week: 1, day: "tue" }),
        run("Long 70", 70, { week: 1, day: "sat" }),
        run("Easy 45", 45, { week: 2, day: "tue" }),
        run("Long 80", 80, { week: 2, day: "sat" })
      ]
    });
    const here = await create("revise_training_plan", {
      draft_id: fork.draftId,
      summary: "Long runs to Sunday (this machine)",
      ops: [
        { op: "move_session", key: "long-70", week: 1, day: "sun" },
        { op: "move_session", key: "long-80", week: 2, day: "sun" }
      ]
    });
    const hereRow = database.getChatPlanDraft(here.draftId);
    const otherDraftId = `sample-other-device-${Date.now()}`;
    const otherPreview = { ...JSON.parse(hereRow.previewJson), draftId: otherDraftId, name: "Sample · Forked plan (other machine)" };
    const otherPlan = { ...JSON.parse(hereRow.planJson), name: "Sample · Forked plan (other machine)" };
    database.saveChatPlanDraft({
      ...hereRow,
      draftId: otherDraftId,
      planJson: JSON.stringify(otherPlan),
      previewJson: JSON.stringify(otherPreview),
      documentJson: undefined,
      author: "athlete",
      changeSummary: "Renamed on the other machine",
      createdAt: hereRow.createdAt + 60_000
    });

    // An older build edited a version in place: the card is newer than its row.
    const inPlace = await create("draft_workout", { workout: run("Sample · Edited by an older build", 30) });
    const inPlaceRow = database.getChatPlanDraft(inPlace.draftId);
    const editedAt = inPlaceRow.createdAt + 120_000;
    const inPlacePlan = JSON.parse(inPlaceRow.planJson);
    const retitle = (text) => text.split("Sample · Edited by an older build").join("Sample · Edited by an older build (renamed there)");
    const inPlacePreview = { ...JSON.parse(retitle(inPlaceRow.previewJson)), editedAt };
    database.saveChatPlanDraft({
      ...inPlaceRow,
      planJson: retitle(JSON.stringify(inPlacePlan)),
      previewJson: JSON.stringify(inPlacePreview)
    });

    write(sessionId, [
      user("An old card, written before creations had versions."),
      coach("Read as a creation of one version."),
      card(JSON.parse(legacyRow.previewJson)),
      user("A plan both my machines changed while offline."),
      coach("Two version 2s: neither is lost. The later one is the newest; this machine's reads as replaced by a later v2."),
      card(fork),
      card(here),
      card(otherPreview),
      user("And one an older build of the app edited in place."),
      coach("Its card is newer than its row: it reads as edited by you, and Open shows the edit — the document is rebuilt from it."),
      card(inPlacePreview)
    ]);
    await writeCreationIndex(sessionId);
  }

  if (LIVE) {
    const sessionId = conversation(
      "P1 sample · saved to COROS (live)",
      "a plan saved to COROS then revised: Update COROS plan; change it in the COROS app and open the canvas"
    );
    const create = creator(sessionId);
    const v1 = await create("draft_training_plan", {
      name: "Sample · Saved plan",
      description: "Saved to COROS by the sample script. Remove with: npm run sample:coach -- --cleanup",
      workouts: [
        run("Easy 40", 40, { week: 1, day: "tue" }),
        run("Long 70", 70, { week: 1, day: "sat" }),
        run("Easy 45", 45, { week: 2, day: "tue" }),
        run("Long 80", 80, { week: 2, day: "sat" })
      ]
    });
    const result = await workoutTools.uploadPlanDraftById(v1.draftId, "metric", "nativePlan");
    // The creation names the plan by its document id, `coros:<remoteId>`.
    if (result.planId) manifest.corosPlans.push(result.planId.replace(/^coros:/, ""));
    saveManifest();
    const savedV1 = {
      ...v1,
      uploadedAt: Date.now(),
      uploadResult: {
        workoutsScheduled: result.workoutsScheduled,
        workoutsCreated: result.workoutsCreated,
        destination: result.destination,
        ...(result.planId ? { planId: result.planId } : {})
      }
    };
    const v2 = await create("revise_training_plan", {
      draft_id: v1.draftId,
      summary: "Week 2's long run moved to Sunday",
      ops: [{ op: "move_session", key: "long-80", week: 2, day: "sun" }]
    });
    console.log(`saved "Sample · Saved plan" to COROS as ${result.planId}`);
    write(sessionId, [
      user("Two weeks, and save it."),
      coach("Saved to COROS as one plan."),
      card(savedV1),
      user("Move week 2's long run to Sunday."),
      coach("Done: this version is not on COROS yet — Update COROS plan writes it over the saved one."),
      card(v2)
    ]);
  }
}

// ===========================================================================
// P2 — brief, outline, sessions
// ===========================================================================

if (PHASES.has("p2")) {
  const everything = { activities: true, sleep: true, zones: true };
  const outlineOf = (args) => {
    const parsed = generation.parsePlanOutline(args);
    if (!parsed.outline) throw new Error(`The simulated outline did not parse: ${parsed.errors.join(" ")}`);
    return parsed.outline;
  };
  const briefFor = (sessionId, args) => {
    let brief;
    const reply = JSON.parse(briefs.handleRequestPlanBrief(args, sessionId, (written) => (brief = written)));
    if (!reply.ok) throw new Error(`request_plan_brief refused the sample: ${reply.error}`);
    return { brief, reply };
  };
  const readyBrief = {
    goal_kind: "base",
    goal: "Sample · Build an aerobic base before winter",
    weeks: 6,
    sports: ["run"],
    level: "intermediate",
    days: [
      { kind: "rest" },
      { kind: "train", minutes: 45 },
      { kind: "train", minutes: 60 },
      { kind: "rest" },
      { kind: "train", minutes: 45 },
      { kind: "long", minutes: 100 },
      { kind: "flex", minutes: 40 }
    ],
    constraints: "No running on Wednesdays.",
    from_data: ["level"]
  };

  {
    const sessionId = conversation(
      "P2 sample · brief (incomplete)",
      "a brief missing race day, marked from chat/from data; the conversation does not share sleep (its ⚙)"
    );
    service.setConversationSettings({ sessionId, sources: { activities: true, sleep: false, zones: true } });
    const { brief, reply } = briefFor(sessionId, {
      goal_kind: "race",
      race_distance: "Half marathon",
      sports: ["run"],
      level: "custom",
      from_data: ["level"]
    });
    write(sessionId, [
      user("I want to run a half marathon."),
      coach(`I've set out a brief. Still open: ${reply.still_open.join(" ")} When is the race?`),
      { kind: "planBrief", artifactId: brief.artifactId }
    ]);
  }

  {
    const sessionId = conversation("P2 sample · brief ready", "a complete brief: Draw the outline from its card");
    const { brief } = briefFor(sessionId, readyBrief);
    write(sessionId, [
      user("Six weeks of base before winter, please. No running on Wednesdays."),
      coach("The brief is on the card; your level is read from your recent runs. Draw the outline when it looks right."),
      { kind: "planBrief", artifactId: brief.artifactId }
    ]);
  }

  {
    const sessionId = conversation(
      "P2 sample · outline drawn",
      "an outline drawn and redrawn (the first folds): Adjust outline, Redraw with a note, Write the sessions"
    );
    const { brief } = briefFor(sessionId, readyBrief);
    const request = { ...brief.request, sources: everything };
    const first = briefs.savePlanOutline(brief.artifactId, outlineOf(simulation.simulatedOutlineArgs(request)), "coach");
    const second = briefs.savePlanOutline(
      brief.artifactId,
      outlineOf(simulation.simulatedOutlineArgs(request, "make week 3 lighter")),
      "coach"
    );
    write(sessionId, [
      user("Six weeks of base before winter, please."),
      coach("The brief is on the card."),
      { kind: "planBrief", artifactId: brief.artifactId },
      user("Draw the outline"),
      coach("Six weeks rising gently, with a lighter fourth."),
      { kind: "planOutline", artifactId: brief.artifactId, outlineVersion: first.outline.version },
      user("Redraw the outline: make week 3 lighter"),
      coach("Redrawn — the first outline folds to a line above."),
      { kind: "planOutline", artifactId: brief.artifactId, outlineVersion: second.outline.version }
    ]);
  }

  {
    const sessionId = conversation(
      "P2 sample · plan written",
      "brief → outline → plan as one creation; the brief and outline cards now refuse changes"
    );
    const { brief } = briefFor(sessionId, readyBrief);
    const request = { ...brief.request, sources: everything };
    const drawn = briefs.savePlanOutline(brief.artifactId, outlineOf(simulation.simulatedOutlineArgs(request)), "coach");
    const planRequest = { ...request, outline: drawn.outline.outline };
    const problems = generation.planOutlineProblems(drawn.outline.outline, request);
    if (problems.length) throw new Error(`The simulated outline breaks the brief: ${problems.join(" ")}`);
    const plan = await creator(sessionId)(
      "draft_training_plan",
      { ...simulation.simulatedDraftArgs(planRequest), name: "Sample · Base build (simulated)" },
      { planRequest, planArtifactId: brief.artifactId }
    );
    write(sessionId, [
      user("Six weeks of base before winter, please."),
      coach("The brief is on the card."),
      { kind: "planBrief", artifactId: brief.artifactId },
      user("Draw the outline"),
      coach("Six weeks rising gently, with a lighter fourth."),
      { kind: "planOutline", artifactId: brief.artifactId, outlineVersion: drawn.outline.version },
      user("Write the sessions"),
      coach("Every session is written to the outline's weeks and hours. Open it to read it week by week."),
      card(plan)
    ]);
  }
}

// ===========================================================================
// P3 — change sets, analyses, references
// ===========================================================================

/**
 * A change set written as a row, lines in whatever state the test wants.
 * Sessions are fictional ids, so a line pressed here reads the calendar,
 * finds nothing, and goes out of date — nothing is written to COROS.
 */
function storedSet(sessionId, summary, lines) {
  const set = changes.createScheduleChangeSet({
    sessionId,
    summary,
    lines: lines.map(({ status: _status, reason: _reason, retry: _retry, settledAt: _at, ...line }) => line)
  });
  const record = database.getChatScheduleChanges([set.changeSetId])[0];
  const stored = JSON.parse(record.linesJson).map((line, index) => {
    const { status, reason, retry } = lines[index];
    return {
      ...line,
      ...(lines[index].extra ?? {}),
      ...(status ? { status } : {}),
      ...(reason ? { reason } : {}),
      ...(retry === false ? { retry: false } : {}),
      ...(status && status !== "proposed" ? { settledAt: new Date().toISOString() } : {})
    };
  });
  database.saveChatScheduleChange({ ...record, linesJson: JSON.stringify(stored) });
  return set.changeSetId;
}

const FAKE_PLAN = "sample-fictional-plan";
const ANALYSIS = {
  runId: "sample-run",
  automationId: "sample-analysis",
  name: "Post-activity debrief",
  triggerLabel: "After a run"
};
const fake = (idInPlan, day, name) => ({ planId: FAKE_PLAN, idInPlan: String(idInPlan), happenDay: day, name });

if (PHASES.has("p3")) {
  // --- every state a line can be in ---------------------------------------------------
  {
    const sessionId = conversation("P3 sample · card states", "every line state, a newer build's lines, a pre-P3 delete card");
    const d1 = fromToday(2);
    const d2 = fromToday(3);
    const d3 = fromToday(4);
    const states = storedSet(sessionId, "Every state a line can be in", [
      {
        op: "move",
        label: `Move "Long run" from ${label(d1)} to ${label(d2)}`,
        session: fake(1, d1, "Long run"),
        toDay: d2,
        status: "applied"
      },
      {
        op: "replace",
        label: `Replace "Tempo" on ${label(d2)} with "Easy 30"`,
        session: fake(2, d2, "Tempo"),
        workout: { key: "w1", name: "Easy 30", sport: "run", distance_km: 5 },
        status: "stale",
        reason: `The session on ${d2} is now "Hills", not "Tempo".`
      },
      {
        op: "remove",
        label: `Remove "Strides" from ${label(d2)}`,
        session: fake(3, d2, "Strides"),
        status: "failed",
        reason: "COROS did not answer. (Try again reads the calendar, finds nothing, and goes out of date.)"
      },
      {
        op: "replace",
        label: `Replace "Intervals" on ${label(d3)} with "Easy 40"`,
        session: fake(4, d3, "Intervals"),
        workout: { key: "w1", name: "Easy 40", sport: "run", distance_km: 6 },
        status: "failed",
        reason: "The new workout was added, but the old one could not be removed (Busy.).",
        retry: false
      },
      {
        op: "remove",
        label: `Remove "Recovery" from ${label(d3)}`,
        session: fake(5, d3, "Recovery"),
        status: "dismissed"
      },
      {
        op: "move",
        label: `Move "Fartlek" from ${label(d1)} to ${label(d3)} — press Apply: it is out of date`,
        session: fake(6, d1, "Fartlek"),
        toDay: d3
      },
      {
        op: "deleteWorkout",
        label: `Delete "Sample · gone" from the workout library — press Delete: it is out of date`,
        program: { id: "sample-fictional-program", name: "Sample · gone" }
      }
    ]);
    // Two lines a newer build wrote: an op and a status this build does not know. No buttons; kept as they are.
    const newer = storedSet(sessionId, "Written by a newer build", [
      { op: "remove", label: "A line of an op this build does not know (no buttons)", session: fake(7, d1, "X"), extra: { op: "swap" } },
      { op: "remove", label: "A line with a status this build does not know", session: fake(8, d1, "Y"), status: "queued" }
    ]);
    write(sessionId, [
      user("Show me every state a proposal line can be in."),
      coach("Applied, out of date, failed (one that may be tried again, one that may not), dismissed, and two still open."),
      { kind: "scheduleChange", changeSetId: states },
      user("And lines a newer version of the app wrote?"),
      coach("Drawn, and left alone."),
      { kind: "scheduleChange", changeSetId: newer },
      user("What about the delete cards from before?"),
      coach("They are drawn and can no longer delete anything."),
      {
        kind: "workoutDelete",
        preview: {
          requestId: "sample-legacy-delete",
          target: "scheduled",
          workoutName: "Old easy run",
          scheduleDate: iso(d1),
          summary: `Remove "Old easy run" from your calendar on ${label(d1)}`
        }
      }
    ]);
  }

  // --- an analysis's proposal, and what the calendar pointed at ------------------------
  {
    const sessionId = conversation("P3 sample · analysis and asks", "an analysis's proposal; chips from the Calendar and the Library");
    const day = fromToday(5);
    const proposal = storedSet(sessionId, "Ease tomorrow after a hard session", [
      {
        op: "remove",
        label: `Remove "Threshold" from ${label(day)} — press Remove: it is out of date`,
        session: fake(9, day, "Threshold")
      }
    ]);
    const monday = (() => {
      const date = noon();
      date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
      return key(date);
    })();
    write(sessionId, [
      user("Keep an eye on my training."),
      coach("I will look after every run and say when something should change."),
      // An analysis run: its playbook turn (drawn as a chip) and its answer, as the runner writes them.
      user("A new activity has just synced: Morning run (Run). Look at it against recent training.", { automation: ANALYSIS }),
      coach(
        "That session was harder than planned: heart rate sat in zone 4 for most of it. Tomorrow's threshold work should go.",
        { automation: ANALYSIS }
      ),
      { kind: "scheduleChange", changeSetId: proposal },
      {
        kind: "scheduleRefs",
        refs: [{ scope: "week", day: monday, label: `Week of ${label(monday)}` }]
      },
      user("How is this week looking? Anything I should adjust?"),
      coach("(A sample answer.) The anchor above this question is what the Calendar's week Ask Coach sends."),
      {
        kind: "scheduleRefs",
        refs: [
          { scope: "session", day: fromToday(-1), activityId: "sample-activity", label: `${label(fromToday(-1))} · Morning run` },
          { scope: "session", planId: "sample-plan", idInPlan: "4", label: "Tempo · Week 2 · Thu · Base block" }
        ]
      },
      user("Can you review it, and is the tempo next week still right?"),
      coach("(A sample answer.) An activity from the Calendar and a session from the Library reader, as chips.")
    ]);
  }

  // --- Coach creations, for the canvas -------------------------------------------------
  {
    const sessionId = conversation("P3 sample · creations", "a plan in three versions (Coach, Coach, you) and a one-off workout");
    const create = creator(sessionId);
    const v1 = await create("draft_training_plan", {
      name: "Sample · Three weeks to 10k",
      description: "Three weeks building an aerobic base toward a 10k. Written by the sample script; nothing is on COROS.",
      week_stages: [
        { week: 1, stage: "base" },
        { week: 2, stage: "base" },
        { week: 3, stage: "build" }
      ],
      workouts: [
        run("Easy 40", 40, { week: 1, day: "tue" }),
        run("Steady 45", 45, { week: 1, day: "thu" }),
        run("Long 70", 70, { week: 1, day: "sat" }),
        run("Easy 40 again", 40, { week: 2, day: "tue" }),
        run("Steady 50", 50, { week: 2, day: "thu" }),
        run("Long 80", 80, { week: 2, day: "sat" }),
        run("Easy 45", 45, { week: 3, day: "tue" }),
        run("Tempo 45", 45, { week: 3, day: "thu" }),
        run("Long 90", 90, { week: 3, day: "sun" })
      ],
      suggested_refinements: ["Make week 2 lighter", "Add strides", "Long runs on Sunday"]
    });
    const v2 = await create("revise_training_plan", {
      draft_id: v1.draftId,
      summary: "Long runs moved to Sunday, week 2 made lighter",
      ops: [
        { op: "move_session", key: "long-70", week: 1, day: "sun" },
        { op: "move_session", key: "long-80", week: 2, day: "sun" },
        { op: "replace_session", key: "steady-50", workout: run("Easy 35", 35) },
        { op: "set_week_stage", week: 3, stage: "peak" }
      ],
      suggested_refinements: ["Add a race week", "More hills"]
    });
    const document = workoutTools.planDraftDocument(v2.draftId);
    const saved = await workoutTools.savePlanDraftEdit(
      v2.draftId,
      {
        ...document,
        name: "Sample · Three weeks to 10k (my edit)",
        entries: document.entries.map((entry) =>
          entry.title === "Tempo 45" ? { ...entry, dayIndex: 2, title: "Tempo 40", workout: { ...entry.workout, name: "Tempo 40" } } : entry
        )
      },
      "metric"
    );
    if (saved.kind !== "written") throw new Error("The sample edit was refused as a conflict.");
    const workout = await create("draft_workout", {
      workout: run("Sample · Tempo 35", 35),
      suggested_refinements: ["Make it a progression run"]
    });
    write(sessionId, [
      user("Build me three weeks toward a 10k."),
      coach("Three weeks: two of base, one of build. Open it in the canvas to read it week by week."),
      card(v1),
      user("Put the long runs on Sunday and make week 2 lighter."),
      coach("Done — the card above folds into this version."),
      card(v2),
      planEvent(saved, "edited"),
      card(saved.preview),
      user("And give me one tempo run I can do any day."),
      coach("Here it is; save it to the library or put it on a day."),
      card(workout)
    ]);
  }

  // --- --live: temporary data on COROS, and a proposal to apply against it --------------
  if (LIVE) {
    /* A Monday at least four weeks out whose three weeks hold nothing. */
    let monday = addDays(noon(), 28);
    monday = addDays(monday, (8 - monday.getDay()) % 7);
    let window;
    for (let attempt = 0; attempt < 12 && !window; attempt += 1) {
      const start = key(monday);
      const end = key(addDays(monday, 20));
      if ((await hub.listScheduledWorkoutEntries(start, end)).length === 0) window = { start, end, monday };
      else monday = addDays(monday, 21);
    }
    if (!window) throw new Error("No empty three-week window found; not touching the calendar.");
    const day = (dayNo) => key(addDays(window.monday, dayNo));
    manifest.live = { start: window.start, end: window.end };
    saveManifest();
    console.log(`live window ${window.start}–${window.end} is empty`);

    const byDistance = (name, km) => ({ key: name, name, sport: "run", distance_km: km });

    // A plan on the calendar: Mon, Wed, Sat, and the next Tuesday.
    const planSessions = [
      [0, byDistance("Sample plan · Easy 5k", 5)],
      [2, byDistance("Sample plan · Tempo", 8)],
      [5, byDistance("Sample plan · Long run", 16)],
      [8, byDistance("Sample plan · Easy 6k", 6)]
    ];
    const programs = [];
    for (const [dayNo, workout] of planSessions) {
      programs.push({ dayNo, program: await hub.buildCalculatedPlanProgram(workout) });
    }
    const templateId = await adapter.createNativeCorosPlan({
      name: `Sample plan ${window.start} (delete me)`,
      overview: "Made by scripts/seed-coach-sample.mjs. Remove with: npm run sample:coach -- --cleanup",
      sessions: programs,
      weekStages: [{ weekNo: 1, stage: 2 }, { weekNo: 2, stage: 3 }]
    });
    manifest.live.templateId = templateId;
    saveManifest();
    const running = await adapter.executeNativeCorosPlan(templateId, window.start);
    manifest.live.runningId = running.remoteId;
    saveManifest();
    console.log(`sample plan ${templateId}, on the calendar as ${running.remoteId}`);

    // Sessions of your own: Tue, Thu, Fri, and the next Thursday; and a library workout
    // named like the last one, so one delete card holds both lines.
    const own = [
      [1, byDistance("Sample own · Strides", 4)],
      [3, byDistance("Sample own · Hills", 7)],
      [4, byDistance("Sample own · Recovery", 3)],
      [10, byDistance("Sample own · Intervals", 8)]
    ];
    for (const [dayNo, workout] of own) {
      await hub.createAndScheduleWorkout({ ...workout, save_to_library: false }, day(dayNo), "metric", false);
    }
    await hub.createLibraryWorkout(byDistance("Sample own · Intervals", 8));
    console.log("four sessions of your own and a library workout, all named \"Sample …\"");

    // The Library's cache, as opening the Library would fill it: the proposal's
    // labels and list_training_plans read the running plan from it.
    await library.getTrainingLibrarySnapshot();

    const calendar = await hub.listScheduledWorkoutEntries(window.start, window.end);
    const find = (name) => {
      const entry = calendar.find((candidate) => candidate.name === name);
      if (!entry) throw new Error(`"${name}" did not land on the calendar.`);
      return { plan_id: entry.planId, id_in_plan: entry.idInPlan, date: entry.happenDay };
    };

    const sessionId = conversation(
      "P3 sample · live changes (apply these)",
      `apply against real (temporary) COROS data in ${window.start}–${window.end}`
    );
    const cards = [];
    const tool = async (name, args) => {
      const result = JSON.parse(
        await workoutTools.handleChatWorkoutTool(name, args, {
          sessionId,
          onScheduleChange: (set) => cards.push(set.changeSetId)
        })
      );
      if (!result.ok) throw new Error(`${name} refused the sample: ${JSON.stringify(result)}`);
      return result;
    };

    const proposal = await tool("propose_schedule_changes", {
      summary: "I'm ill this week — ease it",
      changes: [
        { op: "move", session: find("Sample plan · Long run"), to_date: day(6) },
        { op: "replace", session: find("Sample plan · Tempo"), workout: byDistance("Sample plan · Easy 30", 5) },
        { op: "move", session: find("Sample own · Hills"), to_date: day(7) },
        { op: "replace", session: find("Sample own · Strides"), workout: byDistance("Sample own · Easy 20", 3) },
        { op: "remove", session: find("Sample own · Recovery") },
        { op: "add", to_date: day(9), workout: byDistance("Sample own · Shakeout", 3) }
      ]
    });
    const removal = await tool("delete_workout", {
      target: "both",
      schedule_date: day(10),
      workout_name: "Sample own · Intervals"
    });

    const longRun = find("Sample plan · Long run");
    write(sessionId, [
      user("I'm ill this week. Rearrange it for me."),
      coach(
        "Here is a gentler week. Apply the lines one at a time or all at once; the plan's sessions stay in the plan.\n\n" +
          proposal.lines.map((line) => `- ${line}`).join("\n")
      ),
      { kind: "scheduleChange", changeSetId: cards[0] },
      user("And take the intervals off, from the library too."),
      coach(`Staged: ${removal.lines.join("; ")}.`),
      { kind: "scheduleChange", changeSetId: cards[1] },
      {
        kind: "scheduleRefs",
        refs: [
          {
            scope: "session",
            day: longRun.date,
            planId: longRun.plan_id,
            idInPlan: longRun.id_in_plan,
            label: `${label(longRun.date)} · Sample plan · Long run`
          }
        ]
      },
      user("Is this long run too long?"),
      coach("(A sample answer.) The chip above this question is what the Calendar's Ask Coach on a session sends.")
    ]);

    // What Coach would read (P3.1), without a model.
    const listed = JSON.parse(await planTools.handleChatPlanTool("list_training_plans", {}, { sessionId }));
    console.log("\nlist_training_plans →");
    console.log(JSON.stringify(listed.plans.filter((plan) => plan.plan_id === templateId), null, 2));
    const read = JSON.parse(
      await planTools.handleChatPlanTool("get_training_plan", { plan_id: templateId, sessions: [longRun.id_in_plan] }, { sessionId })
    );
    console.log("\nget_training_plan →");
    console.log(JSON.stringify({ ...read, workouts: read.workouts?.map(({ workout_steps: _steps, ...rest }) => rest) }, null, 2));
  }
}

database.closeDatabase();
const width = Math.max(...made.map(([title]) => title.length));
console.log(`
Open the app → Coach. The conversations are filed under your "${provider}" provider:
${made.map(([title, note]) => `  ${title.padEnd(width)}  ${note}`).join("\n")}
Remove it all with: npm run sample:coach -- --cleanup`);
