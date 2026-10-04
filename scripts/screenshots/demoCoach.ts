// Demo Coach: settings, conversations and their cards, in English.
import type {
  ActivityVisualLapPoint,
  ChatSessionSummary,
  ChatSettings,
  PersistedChatEntry,
  PlanArtifactVersion,
  PlanDraftPreview,
  TrainingHubActivitySeriesPoint,
  TrainingPlanDocument,
  TrainingTrendPoint
} from "../../electron/types";
import { decimate } from "../../electron/sampleActivityKit";
import { sampleRoadRunDetail } from "./sampleRoadRuns";
import { allActivities, dayKey, daysAgoDate } from "./demoData";
import { metrics } from "./demoHandlers";
import { sleepRecords } from "./demoSleep";
import { librarySnapshot, sessionSteps } from "./demoLibrary";
import { PLAN_NAME, planSessions, sessionDay } from "./demoPlan";

const MODEL = "claude-opus-5-5";

export const CHAT_SETTINGS: ChatSettings = {
  provider: "claude-api",
  chatgpt: {},
  anthropic: { model: MODEL, effort: "high", hasApiKey: true },
  claudeCode: {
    effort: "high",
    permissions: { recentActivities: true, trainingMetrics: true, upcomingWorkouts: true, sleepData: true, fullActivityFiles: false }
  },
  openRouter: { model: "", hasApiKey: false },
  local: { baseUrl: "http://127.0.0.1:11434/v1", model: "", hasApiKey: false, toolsEnabled: true },
  modelCatalogs: {
    anthropic: {
      fetchedAt: new Date().toISOString(),
      models: [
        { value: "claude-opus-5-5", label: "Claude Opus 5.5", efforts: ["low", "medium", "high", "max"], adaptiveThinking: true },
        { value: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", efforts: ["low", "medium", "high"], adaptiveThinking: true },
        { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" }
      ]
    }
  } as ChatSettings["modelCatalogs"],
  sidebarOpen: true,
  visualizationsEnabled: true,
  compactContext: { enabled: true, limit: 60, keep: 20, detail: "balanced" } as ChatSettings["compactContext"],
  coachStyle: "neutral" as ChatSettings["coachStyle"]
};

// ------------------------------------------------------------ the intervals --

const pad = (n: number) => String(n).padStart(2, "0");
const pace = (s: number) => `${Math.floor(s / 60)}:${pad(Math.round(s % 60))}`;

function intervalRun() {
  const activity = allActivities().find((a) => a.activityId.startsWith("sample-road-") && a.name?.startsWith("6 × 1 km"));
  if (!activity) throw new Error("no interval run");
  const detail = sampleRoadRunDetail(activity.activityId);
  const series = detail.series ?? [];
  const bounds: Array<{ label: string; from: number; to: number }> = [{ label: "WU", from: 0, to: 2400 }];
  let at = 2400;
  for (let i = 0; i < 6; i += 1) {
    bounds.push({ label: `R${i + 1}`, from: at, to: at + 1000 });
    at += 1000;
    if (i < 5) {
      bounds.push({ label: `J${i + 1}`, from: at, to: at + 400 });
      at += 400;
    }
  }
  bounds.push({ label: "CD", from: at, to: Math.max(at + 1, detail.distance ?? at + 2000) });
  const laps: ActivityVisualLapPoint[] = bounds.map((b, index) => {
    const points = series.filter((p) => (p.distance ?? 0) >= b.from && (p.distance ?? 0) < b.to);
    const first = points[0];
    const last = points[points.length - 1];
    const duration = first && last ? points.length : 0;
    const hrs = points.map((p) => p.hr ?? 0).filter(Boolean);
    const cad = points.map((p) => p.cadence ?? 0).filter(Boolean);
    return {
      index: index + 1,
      distance: b.to - b.from,
      duration,
      pace: duration / ((b.to - b.from) / 1000),
      avgHr: Math.round(hrs.reduce((s, x) => s + x, 0) / Math.max(1, hrs.length)),
      maxHr: Math.max(0, ...hrs),
      avgCadence: Math.round(cad.reduce((s, x) => s + x, 0) / Math.max(1, cad.length))
    };
  });
  return { activity, detail, laps, bounds };
}

function intervalEntries(): PersistedChatEntry[] {
  const { activity, detail, laps, bounds } = intervalRun();
  const reps = laps.filter((_, i) => bounds[i]!.label.startsWith("R"));
  const jogs = laps.filter((_, i) => bounds[i]!.label.startsWith("J"));
  const series: TrainingHubActivitySeriesPoint[] = decimate((detail.series ?? []).filter((p) => (p.pace ?? 0) > 0 && (p.pace ?? 0) < 480), 360);
  const repPaces = reps.map((r) => pace(r.pace ?? 0)).join(", ");
  const fastest = Math.min(...reps.map((r) => r.pace ?? 999));
  const slowest = Math.max(...reps.map((r) => r.pace ?? 0));
  const peak = Math.max(...reps.map((r) => r.maxHr ?? 0));
  const repHr = Math.round(reps.reduce((s, r) => s + (r.avgHr ?? 0), 0) / reps.length);
  const inBand = reps.filter((r) => (r.pace ?? 0) >= 239.5 && (r.pace ?? 0) <= 255.5).length;
  const quickest = reps.reduce((best, r, i) => ((r.pace ?? 999) < (reps[best]!.pace ?? 999) ? i : best), 0);
  const jogHr = Math.round(jogs.reduce((s, j) => s + (j.avgHr ?? 0), 0) / jogs.length);
  const startIso = new Date((activity.startTime ?? 0) * 1000).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return [
    { kind: "message", role: "user", content: "How did Tuesday's 6 × 1 km session go? Was I on target?" },
    {
      kind: "activityVisual",
      preview: {
        previewId: "pv-intervals",
        activityId: activity.activityId,
        sportType: 100,
        name: activity.name,
        startTime: startIso,
        avgHr: activity.avgHr,
        maxHr: activity.maxHr,
        sections: {
          pace: { series },
          hr: { chartKind: "series", series },
        }
      }
    },
    {
      kind: "message",
      role: "assistant",
      model: MODEL,
      usage: { inputTokens: 18_420, outputTokens: 612 },
      content: [
        inBand === 6 ? `A strong session — all six reps landed inside the 4:00–4:15 /km band the plan asked for.` : `A good session — ${inBand} of six reps landed inside the 4:00–4:15 /km band the plan asked for.`,
        ``,
        `- **Reps:** ${repPaces} /km. The spread is only ${Math.round(slowest - fastest)} s from fastest to slowest, which is the even pacing you want ten weeks out from a marathon.`,
        `- **Heart rate:** reps averaged ${repHr} bpm and peaked at ${peak} — ${Math.round((peak / 188) * 100)}% of your max, where 1 km repeats should sit.`,
        `- **Recoveries:** you settled to ${jogHr} bpm in the 400 m jogs, so each rep started from a similar place.`,
        `- **Load:** ${activity.trainingLoad} TL against the ${144} the plan expected.`,
        ``,
        quickest <= 1 ? `**One thing to change:** rep ${quickest + 1} was your quickest. Start the first two at the slow end of the band and let the last two come down — you will finish with more in hand.` : `**One thing to keep:** your quickest rep was number ${quickest + 1} — pacing from the slow end of the band and finishing strong is exactly right.`,
        ``,
        `Next is Sunday's **20 km long run**. Keep it easy at 5:50–6:10 /km; you have yesterday's hill repeats in your legs.`
      ].join("\n")
    }
  ];
}

function recoveryEntries(): PersistedChatEntry[] {
  const days = metrics().slice(-28);
  const sleeps = new Map(sleepRecords(30).map((r) => [r.happenDay, r]));
  const trendPoints: TrainingTrendPoint[] = days.map((m) => {
    const d = new Date(Number(m.happenDay.slice(0, 4)), Number(m.happenDay.slice(4, 6)) - 1, Number(m.happenDay.slice(6, 8)));
    const s = sleeps.get(m.happenDay);
    return {
      date: m.happenDay,
      label: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      trainingLoad: m.trainingLoad,
      avgSleepHrv: m.avgSleepHrv,
      sleepHrvBase: m.sleepHrvBase,
      rhr: m.rhr,
      sleepMinutes: s?.totalMinutes,
      sleepScore: s?.score
    };
  });
  const last7 = days.slice(-7);
  const hrv7 = Math.round(last7.reduce((s, m) => s + (m.avgSleepHrv ?? 0), 0) / 7);
  const rhr7 = Math.round(last7.reduce((s, m) => s + (m.rhr ?? 0), 0) / 7);
  const ratio = days[days.length - 1]?.trainingLoadRatio ?? 1.1;
  const lastNight = sleepRecords(1)[0]!;
  const h = Math.floor((lastNight.totalMinutes ?? 0) / 60);
  return [
    { kind: "message", role: "user", content: "Am I recovered enough for the long run tomorrow?" },
    { kind: "fitnessTrend", preview: { previewId: "pv-trend", trendPoints, windowDays: 28 } },
    {
      kind: "message",
      role: "assistant",
      model: MODEL,
      usage: { inputTokens: 21_960, outputTokens: 388 },
      content: [
        `Yes — the signals line up.`,
        ``,
        `- **HRV** has averaged ${hrv7} ms over the last week, ${hrv7 >= 65 ? "just above" : "in line with"} your 65 ms baseline.`,
        `- **Resting HR** is steady at ${rhr7} bpm — no upward creep after this week's two hard days.`,
        `- **Sleep:** ${h}h ${pad((lastNight.totalMinutes ?? 0) % 60)}m last night with a score of ${lastNight.score}.`,
        `- **Load ratio** sits at ${ratio.toFixed(2)}, inside the 0.8–1.3 range where fitness builds without piling on fatigue.`,
        ``,
        `Run it as planned. If your heart rate sits above 150 bpm on the flat in the first 5 km, take that as the cue to back off.`
      ].join("\n")
    }
  ];
}

// ------------------------------------------------------------- the plan chat --

const DRAFT_ID = "draft-marathon-v1";
const ARTIFACT_ID = "artifact-marathon";

function marathonPreview(): PlanDraftPreview {
  const sessions = planSessions();
  return {
    draftId: DRAFT_ID,
    artifactType: "plan",
    name: PLAN_NAME,
    summary:
      "12 weeks to race day: two base weeks, a long build with Tuesday quality and Saturday marathon-pace work, a 30 km peak in week 9 and a two-week taper.",
    entries: sessions.map((s, index) => ({
      key: `marathon-${index + 1}`,
      name: s.name,
      sport: "run",
      scheduleDate: `${sessionDay(s).slice(0, 4)}-${sessionDay(s).slice(4, 6)}-${sessionDay(s).slice(6, 8)}`,
      volume: `${s.km} km`,
      saveToLibrary: false,
      workoutType: s.kind,
      source: { key: `marathon-${index + 1}`, name: s.name, sport: "run", steps: sessionSteps(s) }
    })),
    conflicts: [],
    warnings: [],
    uploadedAt: Date.now() - 12 * 86_400_000,
    uploadResult: { workoutsScheduled: sessions.length, workoutsCreated: 0, destination: "nativePlanAndCalendar", planId: "demo-run-plan" }
  } as PlanDraftPreview;
}

function planEntries(): PersistedChatEntry[] {
  return [
    {
      kind: "message",
      role: "user",
      content:
        "I'm running the Hanoi Marathon on December 13 and I'd like to go under 3:20. Can you build me a 12-week plan around my current training? Four runs a week, long runs on Sunday, and keep my two gym sessions."
    },
    {
      kind: "message",
      role: "assistant",
      model: MODEL,
      content: [
        `Your last 12 weeks give us a good base to build from: 35–45 km a week, a 1:35 half on September 6 and a threshold of 4:22 /km. Sub-3:20 is 4:44 /km — ambitious but realistic off this block.`,
        ``,
        `Here is the plan. It keeps your Monday and Thursday gym sessions and never puts a hard run the day after one.`
      ].join("\n")
    },
    { kind: "planDraft", draft: marathonPreview() },
    {
      kind: "message",
      role: "assistant",
      model: MODEL,
      usage: { inputTokens: 32_400, outputTokens: 2_910 },
      content: [
        `**How it is built**`,
        ``,
        `- **Weeks 1–2 · Base** — easy volume back to 40 km, one tempo, one set of 1 km reps.`,
        `- **Weeks 3–7 · Build** — Tuesday alternates tempo and 1 km reps; marathon-pace 2 × 5 km on Saturdays from week 5.`,
        `- **Weeks 8–10 · Peak** — long runs of 28 and 30 km, with week 10 a step back.`,
        `- **Weeks 11–12 · Race** — volume drops by a third, the intensity stays.`,
        ``,
        `Every 3rd week is lighter, and the long run never jumps more than 4 km week to week.`
      ].join("\n")
    },
    { kind: "message", role: "user", content: "Looks great. Put it on my calendar starting last Monday." },
    {
      kind: "message",
      role: "assistant",
      model: MODEL,
      content: `Done — it's saved to your COROS account and running on the calendar from ${new Date(Number(sessionDay(planSessions()[0]!).slice(0, 4)), Number(sessionDay(planSessions()[0]!).slice(4, 6)) - 1, Number(sessionDay(planSessions()[0]!).slice(6, 8)) - 1).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}. Your watch will pick up each session the day before.`
    }
  ];
}

// --------------------------------------------------------------- the list --

interface DemoSession {
  summary: ChatSessionSummary;
  entries: () => PersistedChatEntry[];
}

const iso = (daysAgo: number, hour: number, minute = 0) => daysAgoDate(daysAgo, hour, minute).toISOString();

function sessions(): DemoSession[] {
  const make = (id: string, title: string, preview: string, updated: string, count: number, entries: () => PersistedChatEntry[], pinned = false): DemoSession => ({
    summary: { id, provider: "claude-api", title, preview, updatedAt: updated, createdAt: updated, messageCount: count, pinnedAt: pinned ? updated : null },
    entries
  });
  const list = [
    make("c-intervals", "Tuesday's 6 × 1 km session", "A strong session — every rep landed inside the band…", iso(0, 9, 12), 3, intervalEntries),
    make("c-recovery", "Ready for Sunday's long run?", "Yes — the signals line up…", iso(0, 8, 40), 3, recoveryEntries),
    make("c-plan", "Hanoi Marathon plan", "Done — it's saved to your COROS account…", iso(12, 20, 40), 6, planEntries, true),
    make("c-pacing", "Race-day pacing for sub-3:20", "Even splits at 4:44 /km, with the first 5 km…", iso(2, 21, 5), 4, () => []),
    make("c-knee", "Knee niggle after the long run", "Nothing in your cadence or ground contact…", iso(5, 19, 30), 6, () => []),
    make("c-ride", "Easy rides on rest days?", "Yes, if they stay under 125 bpm…", iso(9, 7, 50), 4, () => []),
    make("c-week", "Weekly debrief", "Week 37: 52 km, load ratio 1.12…", iso(6, 20, 0), 8, () => []),
    make("c-strength", "Gym work in a marathon block", "Keep both sessions, but move the heavy one…", iso(18, 18, 15), 4, () => []),
    make("c-heat", "Training in the heat", "Your pace at 140 bpm drops about 8 s/km…", iso(24, 12, 30), 6, () => [])
  ];
  return list;
}

let first = "c-intervals";
export function setCoachFirst(id: string | null): void {
  if (id) first = id;
}

export function chatSessions(): ChatSessionSummary[] {
  const all = sessions().map((s) => s.summary);
  return [...all.filter((s) => s.id === first), ...all.filter((s) => s.id !== first)];
}

export function chatSession(id: string): PersistedChatEntry[] {
  return sessions().find((s) => s.summary.id === id)?.entries() ?? [];
}

export function planArtifacts(draftIds: string[]): PlanArtifactVersion[] {
  if (!draftIds.includes(DRAFT_ID)) return [];
  return [
    {
      draftId: DRAFT_ID,
      artifactId: ARTIFACT_ID,
      version: 1,
      author: "coach",
      name: PLAN_NAME,
      createdAt: Date.now() - 12 * 86_400_000,
      uploadedAt: Date.now() - 12 * 86_400_000,
      remotePlanId: "demo-run-plan"
    }
  ];
}

export function planDraftDocument(): TrainingPlanDocument {
  return librarySnapshot().plans[0]!;
}

export { dayKey };
