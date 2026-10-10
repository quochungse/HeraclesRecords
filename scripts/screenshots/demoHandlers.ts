// Demo answers for the read side of the bridge.
import type {
  CorosProfile,
  CorosProfileSnapshot,
  TrainingHubAnalytics,
  TrainingHubDailyMetric,
  TrainingHubDashboard,
  TrainingHubStatus
} from "../../electron/types";
import { seededRandom } from "../../electron/sampleActivityKit";
import { scheduledEntries, upcomingWorkouts } from "./demoPlan";
import { reverseGeocode } from "./demoPlaces";
import { CHAT_SETTINGS, chatSessions, chatSession, planArtifacts, planDraftDocument, setCoachFirst } from "./demoCoach";
import { librarySnapshot, workoutForEdit, planById, EDITOR_CONTEXT } from "./demoLibrary";
import EXERCISE_MEDIA from "./exercise-media.json";
import { sleepHistory, sleepSummary, dailyHealth, nightSeries } from "./demoSleep";
import { buildSampleStrengthSessions } from "../../src/strength/sampleSessions";
import { allActivities, dayKey, daysAgoDate, realisticInput, TODAY } from "./demoData";

const STATUS: TrainingHubStatus = {
  authenticated: true,
  userId: "demo-athlete",
  regionId: "4",
  email: "alex@example.com",
  rememberCredentials: true
};

const hrZones = (ceilings: number[]) => ceilings.map((bpm, index) => ({ index, bpm }));

export const PROFILE: CorosProfile = {
  userId: "demo-athlete",
  nickname: "Alex Pham",
  email: "alex@example.com",
  countryCode: "VN",
  birthday: Number(`${Number(TODAY.slice(0, 4)) - 31}0923`),
  sex: 0,
  statureCm: 174,
  weightKg: 68,
  unit: 0,
  hrZoneType: 1,
  activityCount: 0,
  thresholds: {
    maxHr: 188,
    restingHr: 50,
    lthr: 171,
    thresholdPaceSecondsPerKm: 262,
    ftp: 245,
    zones: {
      maxHr: hrZones([122, 141, 160, 169, 179, 404]),
      restingHr: hrZones([133, 154, 168, 173, 183, 404]),
      lthr: hrZones([146, 157, 166, 171, 181, 404]),
      thresholdPace: [339, 305, 280, 263, 247, 164].map((paceSecondsPerKm, index) => ({ index, paceSecondsPerKm })),
      cyclePower: [135, 184, 220, 257, 294, 368, 900].map((watts, index) => ({ index, watts }))
    },
    ranges: {}
  }
};

// Daily metrics over the last 400 days, built off the activity list.
function dailyMetrics(days = 400): TrainingHubDailyMetric[] {
  const loadByDay = new Map<string, number>();
  const distByDay = new Map<string, number>();
  const durByDay = new Map<string, number>();
  for (const a of allActivities()) {
    const day = dayKey(new Date((a.startTime ?? 0) * 1000));
    loadByDay.set(day, (loadByDay.get(day) ?? 0) + (a.trainingLoad ?? 0));
    distByDay.set(day, (distByDay.get(day) ?? 0) + (a.distance ?? 0));
    durByDay.set(day, (durByDay.get(day) ?? 0) + (a.duration ?? 0));
  }
  const vo2 = [...(realisticInput.vo2Readings ?? [])].sort((a, b) => a.day.localeCompare(b.day));
  const vo2At = (day: string) => {
    let value: number | undefined;
    for (const reading of vo2) if (reading.day <= day) value = reading.value;
    return value;
  };
  const list: TrainingHubDailyMetric[] = [];
  let acute = 0;
  let chronic = 0;
  for (let d = days; d >= 0; d -= 1) {
    const day = dayKey(daysAgoDate(d));
    const r = seededRandom(`day-${day}`);
    const load = loadByDay.get(day) ?? 0;
    acute = acute + (load - acute) / 7;
    chronic = chronic + (load - chronic) / 42;
    const hrv = Math.round(68 + (r() - 0.5) * 10 - Math.max(0, acute - chronic) * 0.04);
    list.push({
      happenDay: day,
      trainingLoad: load,
      rhr: Math.round(49 + r() * 3 + Math.max(0, acute - chronic) * 0.01),
      avgSleepHrv: hrv,
      sleepHrvBase: 65,
      tiredRateNew: Math.round(Math.max(-30, Math.min(40, (acute - chronic) * 0.9))),
      tiredRateStateNew: 2,
      trainingLoadRatio: chronic > 0 ? Math.round((acute / chronic) * 100) / 100 : 1,
      staminaLevel: Math.round(chronic * 10) / 10,
      vo2max: vo2At(day) ?? 52,
      distance: distByDay.get(day) ?? 0,
      duration: durByDay.get(day) ?? 0
    });
  }
  return list;
}

let metricsCache: TrainingHubDailyMetric[] | null = null;
export function metrics(): TrainingHubDailyMetric[] {
  return (metricsCache ??= dailyMetrics());
}

function dashboard(): TrainingHubDashboard {
  const last = metrics().slice(-14);
  return {
    racePredictor: {
      staminaLevel: 72,
      recoveryPct: 58,
      aerobicEnduranceScore: 78,
      lactateThresholdCapacityScore: 71,
      anaerobicEnduranceScore: 64,
      anaerobicCapacityScore: 58,
      lthr: 171,
      ltsp: 262,
      runScoreList: [
        { distance: 5000, distanceLabel: "5K", predictSeconds: 1218, avgPace: 244 },
        { distance: 10000, distanceLabel: "10K", predictSeconds: 2541, avgPace: 254 },
        { distance: 21097.5, distanceLabel: "Half Marathon", predictSeconds: 5642, avgPace: 267 },
        { distance: 42195, distanceLabel: "Marathon", predictSeconds: 11925, avgPace: 283 }
      ]
    },
    rhr: 50,
    recoveryPct: 58,
    recoveryState: 3,
    fullRecoveryHours: 6,
    fitnessMaxHr: 188,
    runningLevelHr: 171,
    lthrZones: [146, 157, 166, 171, 181].map((hr, index) => ({ index, hr })),
    ltspZones: [339, 305, 280, 263, 247].map((pace, index) => ({ index, pace })),
    personalRecords: realisticInput.personalRecords ?? [],
    sleepHrv: {
      happenDay: TODAY,
      avgSleepHrv: 69,
      sleepHrvBase: 65,
      remainWearDays: 0,
      recentReadings: last.map((m) => ({ happenDay: m.happenDay, avgSleepHrv: m.avgSleepHrv, sleepHrvBase: 65 }))
    },
    sportDataCount: allActivities().length
  };
}

function analytics(): TrainingHubAnalytics {
  const dayList = metrics().slice(-180);
  const sports = new Map<number, { sportType: number; sportName?: string; distance: number; duration: number; count: number; trainingLoad: number }>();
  const cut = daysAgoDate(28).getTime() / 1000;
  for (const a of allActivities()) {
    if ((a.startTime ?? 0) < cut) continue;
    const s = sports.get(a.sportType) ?? { sportType: a.sportType, sportName: a.sportName, distance: 0, duration: 0, count: 0, trainingLoad: 0 };
    s.distance += a.distance ?? 0;
    s.duration += a.duration ?? 0;
    s.count += 1;
    s.trainingLoad += a.trainingLoad ?? 0;
    sports.set(a.sportType, s);
  }
  const zones = (values: number[]) => {
    const total = values.reduce((sum, v) => sum + v, 0);
    return values.map((value, index) => ({ index, value, ratio: Math.round((value / total) * 1000) / 10 }));
  };
  return {
    dayList,
    weekList: [],
    sportStatistics: [...sports.values()],
    zoneDistributions: {
      hrTrainingLoad: zones([180, 820, 610, 240, 160, 40]),
      hrDistance: zones([20, 140, 92, 30, 18, 3]),
      hrTime: zones([3.1, 15.6, 9.2, 2.6, 1.4, 0.3])
    },
    rpeDistribution: { buckets: [], coverage: { rated: 0, total: 0 } }
  };
}

export function demoHandlers(): Record<string, unknown> {
  const snapshot = (): CorosProfileSnapshot => ({
    profile: { ...PROFILE, activityCount: allActivities().length },
    dashboard: dashboard(),
    cachedAt: new Date().toISOString()
  });
  return {
    notifyRendererReady: async () => {},
    getSyncStatus: async () => ({ state: "ready", googleConnected: true, googleClientConfigured: true, deviceId: "demo-macbook", signedIn: true, ownership: "mine",
      loop: { pendingChanges: 0, lastPulledAt: new Date(Date.now() - 7 * 60_000).toISOString(), seed: { state: "done", entries: 18432, error: null } } }),
    prepareSyncVault: async () => "ready",
    googleDriveAccount: async () => ({ email: "alex@example.com", name: "Alex Pham", quota: { used: 6.4e9, limit: 15e9 } }),
    getTrainingHubStatus: async () => STATUS,
    getCorosProfileSnapshot: async () => snapshot(),
    getTrainingDashboard: async () => dashboard(),
    getTrainingAnalytics: async () => analytics(),
    getRacePredictor: async () => dashboard().racePredictor,
    getDailyMetrics: async (dates: string[]) => {
      const wanted = new Set(dates);
      return { dayList: metrics().filter((m) => wanted.size === 0 || wanted.has(m.happenDay)), weekList: [] };
    },
    getAppInfo: async () => ({ version: "1.1.0", userDataPath: "~/Library/Application Support/heracles-records" }),
    getAppUpdateStatus: async () => ({ supported: true, currentVersion: "1.1.0", status: "idle", autoCheck: true, autoDownload: false }),
    isWindowFullscreen: async () => false,
    setWindowBackground: async () => {},
    getHevyStatus: async () => ({ connected: false, includeWarmups: false }),
    getSampleData: async () => ({ rides: false, hikes: false, trailRuns: false }),
    getActivityFeelTypes: async () => ({}),
    getRpeLoadByDay: async () => ({}),
    getRpeBackfillStatus: async () => ({ pending: 0, running: false }),
    startRpeBackfill: async () => {},
    reverseGeocodeLocation: async (lat: number, lon: number) => reverseGeocode(lat, lon),
    rememberMilestones: async () => 0,
    getSleepHistory: async (req?: { days?: number }) => sleepHistory(req?.days ?? 400),
    getTrainingSleepData: async (days?: number) => sleepSummary(days ?? 28),
    getTrainingDailyHealthData: async (days?: number) => dailyHealth(days ?? 30),
    getSleepNightSeries: async (req: { happenDay: string }) => nightSeries(req.happenDay),
    syncStrengthHistory: async (req?: { days?: number }) => { const days = req?.days ?? 90; const sessions = buildSampleStrengthSessions(days); return { sessions, pending: 0, fetched: sessions.length, days, source: "coros" }; },
    listCoachAnalysisRuns: async () => [],
    getChatSettings: async () => CHAT_SETTINGS,
    saveChatSettings: async (s: unknown) => s,
    refreshChatModels: async () => ({ settings: CHAT_SETTINGS, errors: {} }),
    getChatAuthStatus: async () => ({ signedIn: false }),
    getClaudeCodeStatus: async () => ({ state: "not-installed", installed: false, authenticated: false, checkedAt: new Date().toISOString(), message: "" }),
    listChatSessions: async () => { try { setCoachFirst(localStorage.getItem("demo.coachFirst")); } catch {} return chatSessions(); },
    getChatSession: async (id: string) => chatSession(id),
    saveChatSession: async (id: string) => chatSessions().find((s) => s.id === id) ?? null,
    getConversationSettings: async (sessionId: string) => ({ sessionId, sources: { activities: true, sleep: true, zones: true } }),
    setConversationSettings: async (s: unknown) => s,
    getPlanArtifacts: async (ids: string[]) => planArtifacts(ids),
    getPlanDraftDocument: async () => planDraftDocument(),
    getPlanCalendarState: async (ids: string[]) => ids.includes("artifact-marathon") || ids.length ? [{ artifactId: "artifact-marathon", remotePlanId: "demo-run-plan", running: planDraftDocument(), matches: librarySnapshot().matches }] : [],
    syncPlanFromCoros: async () => ({ kind: "current" }),
    getCoachAnalysisSpend: async () => ({ monthStart: new Date().toISOString(), inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, countedTokens: 0, budget: null, countedRuns: 0, providerRuns: 0 }),
    getCoachAnalysisPause: async () => null,
    getBaseCoachInstructions: async () => "",
    compactChatContext: async () => ({ tailStart: 0, through: 0, rolled: false, failed: false, tailLength: 0, entryCount: 0 }),
    inspectChatContext: async () => null,
    getCorosMcpAccount: async () => ({ email: "alex@example.com" }),
    getPlanBriefs: async () => [],
    getScheduleChanges: async () => [],
    findChatSessionForDraft: async () => "c-plan",
    markCoachAnalysisSessionSeen: async () => 0,
    getTrainingLibrarySnapshot: async () => librarySnapshot(),
    listWorkoutExercises: async (sport: string) => sport === "strength" || sport === "hyrox"
      ? (EXERCISE_MEDIA as Array<{ id: string; name: string; coverUrls: string[]; videoUrls: string[] }>).map((e) => ({
          id: e.id, name: e.name, thumbnailUrl: e.coverUrls[0],
          media: [{ coverUrl: e.coverUrls[0], videoUrl: e.videoUrls[0] }]
        }))
      : [],
    listTrainingActivityMatches: async () => librarySnapshot().matches,
    getWorkoutForEdit: async (ref: { kind: string; programId?: string }) => workoutForEdit(ref),
    getWorkoutEditorContext: async () => EDITOR_CONTEXT,
    getNativeTrainingPlan: async (id: string) => planById(id),
    listTrainingLibraryWorkouts: async () => librarySnapshot().workouts,
    listLibraryWorkouts: async () => librarySnapshot().workouts,
    listScheduledWorkouts: async (startDay: string, endDay: string) => scheduledEntries(startDay, endDay),
    getUpcomingWorkouts: async (days?: number) => upcomingWorkouts(days ?? 14),

    publishSyncedLocalStorage: async () => ({ syncing: false, published: 0 }),
    getCorosMcpStatus: async () => ({ connected: true, authorized: true, tools: [] }),
    getMcpStatuses: async () => [{ id: "coros", name: "COROS", enabled: true, connected: true, authenticated: true, toolCount: 18 }],
    ensureMcpConnected: async () => [{ id: "coros", name: "COROS", enabled: true, connected: true, authenticated: true, toolCount: 18 }],
    getSportTypeMap: async () => [[100,"Run"],[102,"Trail Run"],[104,"Hike"],[200,"Road Bike"],[201,"Indoor Bike"],[203,"Gravel Bike"],[300,"Pool Swim"],[402,"Strength"]].map(([sportType, sportName]) => ({ sportType, sportName })),
  };
}
