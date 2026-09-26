// Sample Coach conversations for testing P3 of docs/coach-plan-canvas.md by
// hand — without asking a model anything, so every run is the same and costs
// no tokens.
//
// It writes straight into the app's own database, the way Coach would have:
// conversations, their anchors and the change sets behind them. The cards are
// built by the real tools (`propose_schedule_changes`, `delete_workout`), so
// what is checked in a turn is checked here too.
//
//   npm run sample:coach-p3
//     Offline. Two conversations whose cards show every state a line can be
//     in, a proposal left by an analysis, what the calendar and the Library
//     point at, a delete card from before change sets, and lines a newer
//     build wrote. Nothing on COROS is written; pressing Apply or Try again on
//     these reads COROS and finds nothing, so every line goes "out of date".
//
//   npm run sample:coach-p3 -- --live
//     Also puts temporary data on COROS in an empty three-week window at
//     least four weeks out — a plan on the calendar, four sessions of your
//     own and a library workout, every name starting "Sample" — and a third
//     conversation whose proposal moves, replaces, removes and adds sessions
//     of both, and a delete card for one. Applying them is the test: a plan's
//     session moved or replaced must stay in its plan (Library → the plan →
//     its sessions), one of your own moves by add-then-delete. It also prints
//     what `list_training_plans` and `get_training_plan` answer, as Coach
//     would read them.
//
//   npm run sample:coach-p3 -- --cleanup
//     Removes everything the last run made: the conversations and their
//     change sets, and with --live the plan, the calendar window and the
//     library workout. What was made is listed in
//     `<userData>/coach-p3-sample.json`.
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
const manifestPath = path.join(userData, "coach-p3-sample.json");

const database = await dist("database.js");
database.initializeDatabase(userData);
const history = await dist("chatHistoryStore.js");
const service = await dist("chatService.js");
const workoutTools = await dist("chatWorkoutTools.js");
const changes = await dist("chatScheduleChanges.js");
const hub = await dist("trainingHubService.js");
const adapter = await dist("corosTrainingPlanAdapter.js");
const library = await dist("trainingLibraryService.js");
const planTools = await dist("chatPlanTools.js");

// ---------------------------------------------------------------------------
// Days
// ---------------------------------------------------------------------------

const key = (date) =>
  `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
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
const label = (day) => {
  const date = new Date(Number(day.slice(0, 4)), Number(day.slice(4, 6)) - 1, Number(day.slice(6, 8)), 12);
  return date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
};

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

async function cleanup() {
  if (!fs.existsSync(manifestPath)) {
    console.log("Nothing to clean up: no sample was made (or it was already removed).");
    return;
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  for (const sessionId of manifest.sessions ?? []) {
    service.deleteChatSessionById(sessionId);
    console.log(`removed conversation ${sessionId} and its change sets`);
  }
  const live = manifest.live;
  if (live) {
    for (const plan of await adapter.listNativeCorosPlans()) {
      if (plan.executeStatus === 1 && plan.sourcePlanId === live.templateId) {
        await adapter.quitNativeCorosPlan(plan.remoteId);
        console.log(`took the sample plan off the calendar (${plan.remoteId})`);
      }
    }
    // Only what the sample put there — every name starts "Sample" — and four
    // weeks past the window, where a session dragged on the Calendar may be.
    const past = new Date(Number(live.end.slice(0, 4)), Number(live.end.slice(4, 6)) - 1, Number(live.end.slice(6, 8)) + 28, 12);
    for (const entry of await hub.listScheduledWorkoutEntries(live.start, key(past))) {
      if (!/^Sample\b/.test(entry.name)) {
        console.log(`left "${entry.name}" on ${entry.happenDay} alone — the sample did not put it there`);
        continue;
      }
      await hub.removeScheduledWorkout(entry);
      console.log(`removed "${entry.name}" from ${entry.happenDay}`);
    }
    const listed = new Set((await adapter.listNativeCorosPlans()).map((plan) => plan.remoteId));
    for (const id of [live.runningId, live.templateId].filter(Boolean)) {
      if (listed.has(id)) {
        await adapter.deleteNativeCorosPlan(id);
        console.log(`deleted sample plan ${id}`);
      }
      database.deleteCorosPlanCache(id);
    }
    hub.invalidateLibraryWorkoutPrograms();
    for (const workout of await hub.listLibraryWorkouts()) {
      if (/^Sample\b/.test(workout.name)) {
        await hub.deleteWorkoutProgram(workout.id);
        console.log(`deleted library workout "${workout.name}"`);
      }
    }
  }
  fs.rmSync(manifestPath);
  console.log("Sample removed.");
}

if (CLEANUP) {
  await cleanup();
  database.closeDatabase();
  process.exit(0);
}

if (fs.existsSync(manifestPath)) {
  console.error(`A sample is already there (${manifestPath}). Remove it first: npm run sample:coach-p3 -- --cleanup`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

const provider = database.getSetting("chat.provider") || "claude-code";
const manifest = { createdAt: new Date().toISOString(), provider, sessions: [] };
const saveManifest = () => fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

/** An empty conversation, recorded for cleanup before anything is written into it. */
function conversation(title) {
  const created = history.createChatSession(provider);
  history.setChatSessionTitle(created.id, title);
  manifest.sessions.push(created.id);
  saveManifest();
  console.log(`conversation "${title}" (${created.id})`);
  return created.id;
}

const user = (content, extra = {}) => ({ kind: "message", role: "user", content, ...extra });
const coach = (content, extra = {}) => ({ kind: "message", role: "assistant", content, ...extra });

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

// --- A: every state a line can be in -------------------------------------------------

{
  const sessionId = conversation("P3 sample · card states");
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
  history.saveChatSession(sessionId, [
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
        scheduleDate: `${d1.slice(0, 4)}-${d1.slice(4, 6)}-${d1.slice(6)}`,
        summary: `Remove "Old easy run" from your calendar on ${label(d1)}`
      }
    }
  ]);
}

// --- B: an analysis's proposal, and what the calendar pointed at ---------------------------

{
  const sessionId = conversation("P3 sample · analysis and asks");
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
  history.saveChatSession(sessionId, [
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

// ---------------------------------------------------------------------------
// --live: temporary data on COROS, and a proposal to apply against it
// ---------------------------------------------------------------------------

if (LIVE) {
  // The session the app keeps, read as the verifier reads it: the status call
  // also asks the OS keychain, which is not there outside a window.
  if (!database.getSetting("trainingHub.accessToken") || !database.getSetting("trainingHub.userId")) {
    console.error("Not signed in to COROS in the app; the live sample needs it. The offline sample is made.");
    database.closeDatabase();
    process.exit(1);
  }

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

  const run = (name, km) => ({ key: name, name, sport: "run", distance_km: km });

  // A plan on the calendar: Mon, Wed, Sat, and the next Tuesday.
  const planSessions = [
    [0, run("Sample plan · Easy 5k", 5)],
    [2, run("Sample plan · Tempo", 8)],
    [5, run("Sample plan · Long run", 16)],
    [8, run("Sample plan · Easy 6k", 6)]
  ];
  const programs = [];
  for (const [dayNo, workout] of planSessions) {
    programs.push({ dayNo, program: await hub.buildCalculatedPlanProgram(workout) });
  }
  const templateId = await adapter.createNativeCorosPlan({
    name: `Sample plan ${window.start} (delete me)`,
    overview: "Made by scripts/seed-coach-p3-sample.mjs. Remove with: npm run sample:coach-p3 -- --cleanup",
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
    [1, run("Sample own · Strides", 4)],
    [3, run("Sample own · Hills", 7)],
    [4, run("Sample own · Recovery", 3)],
    [10, run("Sample own · Intervals", 8)]
  ];
  for (const [dayNo, workout] of own) {
    await hub.createAndScheduleWorkout({ ...workout, save_to_library: false }, day(dayNo), "metric", false);
  }
  await hub.createLibraryWorkout(run("Sample own · Intervals", 8));
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

  const sessionId = conversation("P3 sample · live changes (apply these)");
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
      { op: "replace", session: find("Sample plan · Tempo"), workout: run("Sample plan · Easy 30", 5) },
      { op: "move", session: find("Sample own · Hills"), to_date: day(7) },
      { op: "replace", session: find("Sample own · Strides"), workout: run("Sample own · Easy 20", 3) },
      { op: "remove", session: find("Sample own · Recovery") },
      { op: "add", to_date: day(9), workout: run("Sample own · Shakeout", 3) }
    ]
  });
  const removal = await tool("delete_workout", {
    target: "both",
    schedule_date: day(10),
    workout_name: "Sample own · Intervals"
  });

  const longRun = find("Sample plan · Long run");
  history.saveChatSession(sessionId, [
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

database.closeDatabase();
console.log(`
Open the app → Coach. The conversations are filed under your "${provider}" provider:
  P3 sample · card states          every line state, a newer build's lines, a pre-P3 delete card
  P3 sample · analysis and asks    an analysis's proposal; chips from the Calendar and the Library${LIVE ? `
  P3 sample · live changes         apply against real (temporary) COROS data in ${manifest.live.start}–${manifest.live.end}` : ""}
Remove it all with: npm run sample:coach-p3 -- --cleanup`);
