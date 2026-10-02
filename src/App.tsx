import { AlertCircle, CheckCircle2, Loader2, RefreshCw, X } from "lucide-react";
import {
  Children,
  Component,
  type ComponentProps,
  type ComponentType,
  type ErrorInfo,
  type FormEvent,
  type ReactNode,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  CoachOpenRequest,
  TrainingHubActivity,
  TrainingHubActivityDetail,
  TrainingHubActivityFileType,
  TrainingHubAnalytics,
  TrainingHubDailyHealthSummary,
  TrainingHubDailyMetrics,
  TrainingHubDashboard,
  TrainingHubSleepSummary,
  TrainingHubSportType,
  TrainingHubStatus,
  TrainingHubUpcomingWorkout,
  AppUpdateSnapshot,
} from "../electron/types";
import { TRAINING_HUB_EXPORT_FORMATS } from "../electron/types";
import { buildTrainingHubSnapshot } from "./training/parsers";
import { fetchTrainingDashboard, fetchUpcomingWorkouts } from "./training/api";
import {
  TRAINING_HEATMAP_DAYS,
  TRAINING_TREND_MAX_DAYS
} from "./training/chartConfig";
import { recentTrainingHubDateList } from "./training/formatters";
import type {
  SportScreenRequest,
  TrainingHubDetailRequest,
  TrainingHubLoadStatus,
  TrainingHubSnapshot,
} from "./training/types";
import type { HeraclesRecordsApi } from "./heraclesrecords-api";
import { applySyncedLocalStorageOps } from "./settings/syncLocalStorage";
import { startLocalStoragePublisher } from "./settings/localStoragePublisher";
import { subscribeToToasts } from "./toast";
import { isMcpFailure } from "./mcp/mcpNotice";
import { UpdateAvailablePrompt } from "./components/UpdateAvailablePrompt";
import {
  AppSidebar,
  createInitialSidebarExpanded,
} from "./components/AppSidebar";
import { DeveloperToolbar } from "./components/DeveloperToolbar";
import { PRIMARY_NAV_ITEMS, type PrimaryView } from "./navigation/primaryNav";
import {
  getPrimaryViewLabel,
  readStartupView,
  saveStartupView,
} from "./navigation/startupView";
import {
  readHiddenSportScreens,
  saveHiddenSportScreens,
  sportScreenFor,
  type SportScreen,
} from "./navigation/sportScreens";
import { CalendarSkeleton } from "./calendar/CalendarSkeleton";
import { TrainingLibrarySkeleton } from "./training-library/TrainingLibrarySkeleton";
import { SettingsView } from "./settings/SettingsView";
import { useTimeOfDayGreeting } from "./hooks/useTimeOfDayGreeting";
import { selectOverviewGreeting } from "./overviewGreeting";
import { useUnitSystem } from "./units/UnitSystemProvider";
import { useHallOfRecords } from "./records/useHallOfRecords";
import { useRecordsNotices } from "./records/useRecordsNotices";
import {
  isSampleRecordsActivity,
  type RecordsSamplePreset,
} from "./records/sampleRecords";
import { LabourCelebration, LabourToastCard } from "./records/LabourNotices";
import appLogo from "../build/icon.png";
import changelogMarkdown from "../CHANGELOG.md?raw";

type View = PrimaryView;
const IS_DEVELOPMENT_BUILD = import.meta.env.DEV;

const LazyTrainingOverview = lazy(() =>
  import("./training/TrainingOverview").then(({ TrainingOverview }) => ({
    default: TrainingOverview,
  })),
);
const LazyActivitiesView = lazy(() =>
  import("./training/ActivitiesView").then(({ ActivitiesView }) => ({
    default: ActivitiesView,
  })),
);
/**
 * A lazy screen whose chunk can be fetched ahead of its first visit.
 *
 * `lazy()` suspends on its first render however warm the module is — its
 * factory hands back a promise, and a promise settles a tick later — so a
 * preload alone still flashed the fallback for a frame. Once `preload` has
 * landed, a mount renders the module's component directly and never touches
 * Suspense. Which one a mount uses is fixed when it mounts: a component type
 * that changed under a mounted screen would remount it and drop its state.
 * A failed preload is forgotten, so the visit retries rather than inheriting
 * the failure.
 */
function preloadableLazy<C extends ComponentType<any>>(
  factory: () => Promise<{ default: C }>,
) {
  type Module = { default: C };
  type Props = ComponentProps<C>;
  let loaded: C | undefined;
  let pending: Promise<Module> | undefined;
  const preload = (): Promise<Module> =>
    (pending ??= factory().then(
      (module) => {
        loaded = module.default;
        return module;
      },
      (error: unknown): never => {
        pending = undefined;
        throw error;
      },
    ));
  const Lazy = lazy(preload);
  function PreloadableSurface(props: Props) {
    const [Surface] = useState<ComponentType<Props>>(
      () => (loaded ?? Lazy) as ComponentType<Props>,
    );
    return <Surface {...props} />;
  }
  return Object.assign(PreloadableSurface, { preload });
}

const LazyTrainingLibraryView = preloadableLazy(() =>
  import("./training-library/TrainingLibraryView").then(({ TrainingLibraryView }) => ({
    default: TrainingLibraryView,
  })),
);
const LazyRunningView = lazy(() =>
  import("./running/RunningView").then(({ RunningView }) => ({
    default: RunningView,
  })),
);
const LazyCyclingView = lazy(() =>
  import("./cycling/CyclingView").then(({ CyclingView }) => ({
    default: CyclingView,
  })),
);
const LazyHikingView = lazy(() =>
  import("./hiking/HikingView").then(({ HikingView }) => ({
    default: HikingView,
  })),
);
const LazyStrengthView = lazy(() =>
  import("./strength/StrengthView").then(({ StrengthView }) => ({
    default: StrengthView,
  })),
);
const LazySleepDetailsView = lazy(() =>
  import("./sleep/SleepDetailsView").then(({ SleepDetailsView }) => ({
    default: SleepDetailsView,
  })),
);
const LazyCalendarView = preloadableLazy(() =>
  import("./calendar/CalendarView").then(({ CalendarView }) => ({
    default: CalendarView,
  })),
);
const LazyChatView = lazy(() =>
  import("./chat/ChatView").then(({ ChatView }) => ({ default: ChatView })),
);
const LazyProfileView = lazy(() =>
  import("./profile/ProfileView").then(({ ProfileView }) => ({
    default: ProfileView,
  })),
);
const LazyTrainingMapView = lazy(() =>
  import("./trainingMap/TrainingMapView").then(({ TrainingMapView }) => ({
    default: TrainingMapView,
  })),
);
const LazyHallOfRecordsView = lazy(() =>
  import("./records/HallOfRecordsView").then(({ HallOfRecordsView }) => ({
    default: HallOfRecordsView,
  })),
);

function DeferredSurfaceFallback({ label }: { label: string }) {
  return (
    <div className="empty-state" role="status" aria-live="polite">
      <Loader2 className="spin" size={24} aria-hidden="true" />
      <span>Loading {label}…</span>
    </div>
  );
}

class TrainingLibraryErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Training Library render failed", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    // Uses the global .empty-state: the library's own stylesheet ships with the
    // lazy chunk, which may be exactly what failed to load.
    return (
      <section className="empty-state" role="alert">
        <AlertCircle size={28} aria-hidden="true" />
        <strong>Training Library could not render</strong>
        <span>{this.state.error.message}</span>
        <button
          type="button"
          className="primary-button"
          onClick={() => this.setState({ error: null })}
        >
          Try again
        </button>
      </section>
    );
  }
}

function getLatestReleasePreview(changelog: string): {
  version: string;
  previousVersion: string;
  releaseNotes: string;
} {
  const sections = changelog
    .split(/^## /m)
    .slice(1)
    .map((part) => {
      const newline = part.indexOf("\n");
      const header = (newline === -1 ? part : part.slice(0, newline)).trim();
      const body = (newline === -1 ? "" : part.slice(newline + 1)).trim();
      const version = header.match(/^\[([^\]]+)\]/)?.[1]?.trim() ?? "";
      return { version, body };
    })
    .filter(
      (section) =>
        section.version.length > 0 &&
        section.version.toLowerCase() !== "unreleased",
    );

  const latest = sections[0];
  if (!latest) {
    return {
      version: "0.0.0-dev-preview",
      previousVersion: "0.0.0",
      releaseNotes: "No released changelog entries found.",
    };
  }

  return {
    version: `${latest.version}-dev-preview`,
    previousVersion: sections[1]?.version ?? latest.version,
    releaseNotes: `## Version ${latest.version}\n\n${latest.body}`,
  };
}

const DEV_UPDATE_PREVIEW = getLatestReleasePreview(changelogMarkdown);
const TRAINING_HISTORY_PAGE_SIZE = 100;
const TRAINING_HISTORY_MAX_PAGES = 100;

async function listAllTrainingHubActivities(
  api: HeraclesRecordsApi
): Promise<TrainingHubActivity[]> {
  const activities: TrainingHubActivity[] = [];
  for (let page = 1; page <= TRAINING_HISTORY_MAX_PAGES; page += 1) {
    const batch = await api.listTrainingHubActivities(
      page,
      TRAINING_HISTORY_PAGE_SIZE
    );
    activities.push(...batch);
    if (batch.length < TRAINING_HISTORY_PAGE_SIZE) {
      break;
    }
  }
  return activities;
}

export default function App() {
  const api: HeraclesRecordsApi | undefined = window.heraclesRecords;
  const [activeView, setActiveView] = useState<View>(readStartupView);
  /**
   * `.content` is one scroller shared by every screen, so a screen used to open
   * at whatever depth the last one was left at — leaving Settings scrolled down
   * opened Overview with its title cut off. Each screen opens at its top; the
   * screens that keep a scroll of their own (a sport page's list) keep it in
   * their own scroller.
   */
  const contentRef = useRef<HTMLElement>(null);
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
  }, [activeView]);
  const [startupView, setStartupView] = useState<View>(readStartupView);
  const [hiddenSportScreens, setHiddenSportScreens] = useState<SportScreen[]>(
    readHiddenSportScreens,
  );
  const [sidebarExpanded, setSidebarExpanded] = useState(
    createInitialSidebarExpanded,
  );
  const [showDevelopmentTools, setShowDevelopmentTools] = useState(
    IS_DEVELOPMENT_BUILD,
  );
  const [devUpdatePreviewKey, setDevUpdatePreviewKey] = useState<
    number | undefined
  >(undefined);
  const devUpdatePreviewSequenceRef = useRef(0);
  /**
   * A fake "update available" snapshot for the dev-only Test update button.
   * It shadows the real snapshot rather than overwriting it, so main can keep
   * pushing real status underneath and clearing the simulation needs no
   * refetch. Renderer state only — a restart drops it.
   */
  const [devUpdateSimulation, setDevUpdateSimulation] =
    useState<AppUpdateSnapshot | null>(null);
  /** The Strength screen's generated sample history, switched from the toolbar. */
  const [strengthSampleMode, setStrengthSampleMode] = useState(false);
  /** The Hall of Records' sample history, switched from the toolbar. */
  const [recordsSample, setRecordsSample] = useState<RecordsSamplePreset | null>(null);
  const [sidebarOverlayOpen, setSidebarOverlayOpen] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }

    return window.matchMedia("(max-width: 720px)").matches;
  });
  const [coachStreaming, setCoachStreaming] = useState(false);
  /**
   * Runs an analysis started on its own, keyed by run id. An auto run happens
   * in the main process and never touches the composer, so `coachStreaming` --
   * which only ever reports what the athlete typed -- leaves the nav dot dark
   * for exactly the runs the athlete had no other way of noticing.
   *
   * Watched here rather than in ChatView because ChatView is not mounted until
   * the Coach view is first opened: a run firing while the athlete sits on
   * Overview would otherwise have no listener at all.
   */
  const [runningAnalysisIds, setRunningAnalysisIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [coachMounted, setCoachMounted] = useState(activeView === "coach");
  const [coachPrefill, setCoachPrefill] = useState<string | CoachOpenRequest | null>(null);
  /* Ask Coach from another screen (Calendar, Library, Activities, Running,
     Strength): Coach opens and asks where the question goes. */
  const askCoach = useCallback((request?: string | CoachOpenRequest) => {
    setCoachPrefill(request ?? null);
    setActiveView("coach");
  }, []);
  const [calendarRefreshToken, setCalendarRefreshToken] = useState(0);
  const mcpAutoConnectAttemptedRef = useRef(false);
  const trainingCoreLoadSequenceRef = useRef(0);
  const trainingWellnessLoadSequenceRef = useRef(0);
  const [trainingHubStatus, setTrainingHubStatus] =
    useState<TrainingHubStatus | null>(null);
  const [trainingHubEmail, setTrainingHubEmail] = useState("");
  const [trainingHubPassword, setTrainingHubPassword] = useState("");
  const [trainingHubRemember, setTrainingHubRemember] = useState(true);
  // When the COROS account has 2FA enabled, holds the email awaiting a code.
  const [trainingHub2faEmail, setTrainingHub2faEmail] = useState<string | null>(
    null,
  );
  const [trainingHub2faCode, setTrainingHub2faCode] = useState("");
  const [trainingHubActivities, setTrainingHubActivities] = useState<
    TrainingHubActivity[]
  >([]);
  const [trainingHubActivitiesStatus, setTrainingHubActivitiesStatus] =
    useState<TrainingHubLoadStatus>("pending");
  /**
   * Where the *snapshot* load stands, which the activity status cannot answer:
   * the two are separate requests and the trend panels read the snapshot. Until
   * this existed, `snapshot === null` was the only thing Overview had, and it
   * says the same thing during a load, after a failure and for an athlete with
   * no history — so every launch drew "No HRV readings" for as long as COROS
   * took to reply.
   */
  const [trainingHubSnapshotStatus, setTrainingHubSnapshotStatus] =
    useState<TrainingHubLoadStatus>("pending");
  const [trainingHubAnalytics, setTrainingHubAnalytics] =
    useState<TrainingHubAnalytics | null>(null);
  const [trainingHubDashboard, setTrainingHubDashboard] =
    useState<TrainingHubDashboard | null>(null);
  const [trainingHubDailyMetrics, setTrainingHubDailyMetrics] =
    useState<TrainingHubDailyMetrics | null>(null);
  const [trainingHubSportTypes, setTrainingHubSportTypes] = useState<
    TrainingHubSportType[]
  >([]);
  const [trainingHubUpcomingWorkouts, setTrainingHubUpcomingWorkouts] =
    useState<TrainingHubUpcomingWorkout[]>([]);
  const [trainingHubActivityDetail, setTrainingHubActivityDetail] =
    useState<TrainingHubActivityDetail | null>(null);
  const [trainingHubDetailRequest, setTrainingHubDetailRequest] =
    useState<TrainingHubDetailRequest | null>(null);
  // The activity whose detail was asked for last. A reply for any other one is
  // stale — the athlete has moved on — and is dropped rather than shown.
  const latestDetailRequestRef = useRef<string | null>(null);
  const [selectedTrainingHubActivity, setSelectedTrainingHubActivity] =
    useState<TrainingHubActivity | null>(null);
  /*
   * A session Activities handed to a sport's own screen, waiting for that screen
   * to mount and take it. It is held here rather than passed as an argument
   * because those screens are lazy: the view switches first and the component
   * arrives a tick later, with nowhere for an argument to have waited.
   */
  const [sportScreenRequest, setSportScreenRequest] =
    useState<SportScreenRequest | null>(null);
  const [trainingHubSleepData, setTrainingHubSleepData] =
    useState<TrainingHubSleepSummary | null>(null);
  const [trainingHubDailyHealthData, setTrainingHubDailyHealthData] =
    useState<TrainingHubDailyHealthSummary | null>(null);
  const [sleepConnecting, setSleepConnecting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [appUpdateSnapshot, setAppUpdateSnapshot] = useState<AppUpdateSnapshot>(
    {
      supported: false,
      currentVersion: "0.0.0",
      status: "idle",
      autoCheck: true,
      autoDownload: true,
    },
  );
  const installAcceptedVersionRef = useRef<string | null>(null);
  const effectiveUpdateSnapshot = devUpdateSimulation ?? appUpdateSnapshot;


  /* The two screens most opened from a cold start are fetched once the first
     paint has settled, so a visit after that mounts them directly — no
     fallback at all. A visit before it still draws the screen's own skeleton,
     never the generic spinner. */
  useEffect(() => {
    const preload = () => {
      void LazyCalendarView.preload().catch(() => undefined);
      void LazyTrainingLibraryView.preload().catch(() => undefined);
    };
    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(preload, { timeout: 2000 });
      return () => window.cancelIdleCallback(handle);
    }
    const timer = window.setTimeout(preload, 500);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (!api) {
      return;
    }

    void api.getAppUpdateStatus().then(setAppUpdateSnapshot);
    return api.onAppUpdateStatus(setAppUpdateSnapshot);
  }, [api]);

  // Applying a pull's localStorage half belongs here rather than in the Sync
  // panel, which is where it used to live: the main process drains the queue
  // when it sends this event and keeps no second copy, so a change that arrived
  // with any other view on screen was discarded. The panel still renders the
  // notice — it just no longer owns the only chance to act on one.
  useEffect(() => {
    if (!api) return;
    return api.onSyncChanged((change) => {
      applySyncedLocalStorageOps(change.localStorage);
      // The rail is drawn from state, and a toggle builds on that state: left
      // stale, the next one would write back over what the other machine hid.
      const hidden = readHiddenSportScreens();
      setHiddenSportScreens((current) =>
        current.join() === hidden.join() ? current : hidden,
      );
      setStartupView(readStartupView());
    });
  }, [api]);

  // The same half on its way out. Theme, units, sport colours and every view
  // preference live only in the renderer, so without this they arrive from the
  // other machine but never leave this one.
  useEffect(() => {
    if (!api) return;
    return startLocalStoragePublisher(api);
  }, [api]);

  // Tell the main process this window is listening — and only once every effect
  // above has run, which is what `setTimeout` buys: mount effects all fire
  // inside the same commit, so a call made from within one of them could beat a
  // subscription declared below it, and the push it unblocks would arrive
  // before there was anything to receive it.
  //
  // Unconditional on purpose. This used to ride along on a call only
  // development builds make, so no packaged build ever announced itself and
  // every unasked-for push — merged sync writes, a COROS session restored at
  // start-up — was dropped for the whole run.
  useEffect(() => {
    if (!api) return;
    const timer = window.setTimeout(() => {
      void api.notifyRendererReady().catch(() => undefined);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [api]);

  useEffect(() => {
    const acceptedVersion = installAcceptedVersionRef.current;
    if (!acceptedVersion) {
      return;
    }

    if (
      appUpdateSnapshot.status === "downloaded" &&
      appUpdateSnapshot.availableVersion === acceptedVersion
    ) {
      installAcceptedVersionRef.current = null;
      handleInstallUpdate();
      return;
    }

    if (appUpdateSnapshot.status === "error") {
      installAcceptedVersionRef.current = null;
      setError(
        appUpdateSnapshot.error ?? "Could not download the update.",
      );
    }
  }, [
    appUpdateSnapshot.availableVersion,
    appUpdateSnapshot.error,
    appUpdateSnapshot.status,
  ]);

  // Tag the document with the host OS so the header can clear the macOS
  // traffic lights that overlay it.
  useEffect(() => {
    document.documentElement.dataset.platform = api?.platform ?? "";
  }, [api]);

  useEffect(() => {
    if (!api?.onWindowFullscreenChange) {
      return;
    }

    const syncFullscreen = (fullscreen: boolean) => {
      if (fullscreen) {
        document.documentElement.dataset.windowFullscreen = "true";
      } else {
        delete document.documentElement.dataset.windowFullscreen;
      }
    };

    void api.isWindowFullscreen?.().then(syncFullscreen);
    return api.onWindowFullscreenChange(syncFullscreen);
  }, [api]);

  /**
   * The Coach nav dot for runs nobody asked for. A run already in flight when
   * this window opened is seeded from the run log -- `cancelStaleCoachAnalysisRuns`
   * settles the rows left over from a previous launch at startup, so anything
   * still `running` really is.
   */
  useEffect(() => {
    if (!api?.onCoachAnalysisRunUpdate) {
      return;
    }
    let cancelled = false;
    void api
      .listCoachAnalysisRuns({ statuses: ["running"] })
      .then((runs) => {
        if (cancelled) return;
        // Merged rather than replaced: a run that started while this lookup was
        // in flight is already in the set, and is not in the answer.
        setRunningAnalysisIds((current) => {
          const next = new Set(current);
          for (const run of runs) next.add(run.id);
          return next;
        });
      })
      .catch(() => undefined);
    const unsubscribe = api.onCoachAnalysisRunUpdate((run) => {
      setRunningAnalysisIds((current) => {
        const running = run.status === "running";
        if (running === current.has(run.id)) {
          return current;
        }
        const next = new Set(current);
        if (running) {
          next.add(run.id);
        } else {
          next.delete(run.id);
        }
        return next;
      });
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [api]);

  /** Either kind of coach work: the athlete's turn, or an analysis's. */
  const coachBusy = coachStreaming || runningAnalysisIds.size > 0;

  useEffect(() => {
    if (activeView === "coach") {
      setCoachMounted(true);
    }
  }, [activeView]);

  const clearTrainingHubData = useCallback(() => {
    trainingCoreLoadSequenceRef.current += 1;
    trainingWellnessLoadSequenceRef.current += 1;
    setTrainingHubActivities([]);
    setTrainingHubActivitiesStatus("pending");
    setTrainingHubSnapshotStatus("pending");
    setTrainingHubAnalytics(null);
    setTrainingHubDashboard(null);
    setTrainingHubDailyMetrics(null);
    setTrainingHubSportTypes([]);
    setTrainingHubUpcomingWorkouts([]);
    setTrainingHubActivityDetail(null);
    setTrainingHubDetailRequest(null);
    latestDetailRequestRef.current = null;
    setSelectedTrainingHubActivity(null);
    setTrainingHubSleepData(null);
    setTrainingHubDailyHealthData(null);
    setSleepConnecting(false);
  }, []);

  const applyTrainingHubStatus = useCallback((status: TrainingHubStatus) => {
    setTrainingHubStatus(status);
    if (status.email) {
      setTrainingHubEmail(status.email);
    }
    setTrainingHubRemember(status.rememberCredentials ?? true);
  }, []);

  const loadTrainingHubData = useCallback(async () => {
    if (!api) {
      return;
    }

    const loadSequence = ++trainingCoreLoadSequenceRef.current;
    setTrainingHubSnapshotStatus("pending");
    const publish = <T,>(
      request: Promise<T>,
      onFulfilled: (value: T) => void,
      onRejected: () => void,
    ): Promise<void> =>
      request.then(
        (value) => {
          if (trainingCoreLoadSequenceRef.current === loadSequence) {
            onFulfilled(value);
          }
        },
        (error: unknown) => {
          if (trainingCoreLoadSequenceRef.current === loadSequence) {
            onRejected();
          }
          throw error;
        },
      );

    // The three the snapshot is built from, marked as they land rather than
    // read back out of `results` by index: the array's order is an ordinary
    // edit away from changing, and nothing would report it.
    let snapshotArrived = false;
    const publishSnapshotPart = <T,>(
      request: Promise<T>,
      onFulfilled: (value: T) => void,
      onRejected: () => void,
    ): Promise<void> =>
      publish(
        request,
        (value) => {
          snapshotArrived = true;
          onFulfilled(value);
        },
        onRejected,
      );

    const dateList = recentTrainingHubDateList(TRAINING_HEATMAP_DAYS);
    const results = await Promise.allSettled([
      publish(
        listAllTrainingHubActivities(api),
        (activities) => {
          setTrainingHubActivities(activities);
          setTrainingHubActivitiesStatus("ready");
        },
        () => {
          setTrainingHubActivities([]);
          setTrainingHubActivitiesStatus("failed");
        },
      ),
      publishSnapshotPart(
        api.getTrainingAnalytics(),
        setTrainingHubAnalytics,
        () => setTrainingHubAnalytics(null),
      ),
      publishSnapshotPart(
        fetchTrainingDashboard(api),
        setTrainingHubDashboard,
        () => setTrainingHubDashboard(null),
      ),
      publishSnapshotPart(
        api.getDailyMetrics(dateList),
        setTrainingHubDailyMetrics,
        () => setTrainingHubDailyMetrics(null),
      ),
      publish(
        api.getSportTypeMap(),
        setTrainingHubSportTypes,
        () => setTrainingHubSportTypes([]),
      ),
      publish(
        fetchUpcomingWorkouts(api, 14),
        setTrainingHubUpcomingWorkouts,
        () => setTrainingHubUpcomingWorkouts([]),
      ),
    ]);

    if (trainingCoreLoadSequenceRef.current === loadSequence) {
      // One of the three answering is enough for the panels to have something
      // real to draw; none of them is a failure, not an athlete who has never
      // trained — and the two must not read alike, which is the whole point.
      setTrainingHubSnapshotStatus(snapshotArrived ? "ready" : "failed");
    }

    const failures = results
      .filter((result) => result.status === "rejected")
      .map((result) => toErrorMessage(result.reason));

    if (results.every((result) => result.status === "rejected")) {
      throw new Error(failures[0] ?? "Training Hub data could not be loaded.");
    }
  }, [api]);

  // The calendar writes straight to COROS, so nothing in the core load above
  // hears about it -- and that load runs once per launch. Only the upcoming
  // workouts move, so re-read that one slice instead of the whole set; the
  // sequence guard is shared with loadTrainingHubData so a logout or a full
  // reload started meanwhile still has the last word.
  const refreshUpcomingWorkouts = useCallback(async () => {
    if (!api) {
      return;
    }

    const loadSequence = trainingCoreLoadSequenceRef.current;
    try {
      const workouts = await fetchUpcomingWorkouts(api, 14);
      if (trainingCoreLoadSequenceRef.current === loadSequence) {
        setTrainingHubUpcomingWorkouts(workouts);
      }
    } catch {
      // Keep whatever the panel last read: the calendar itself already
      // reported the write, and blanking the card would be the louder lie.
    }
  }, [api]);

  // A calendar write made outside the Calendar view has to reach both readers:
  // Overview's card off App state, and the Calendar's own range cache.
  const handleExternalScheduleChange = useCallback(() => {
    void refreshUpcomingWorkouts();
    setCalendarRefreshToken((token) => token + 1);
  }, [refreshUpcomingWorkouts]);

  const ensureTrainingHubMcp = useCallback(async () => {
    if (!api || mcpAutoConnectAttemptedRef.current) {
      return;
    }

    const mcpStatus = await api.getCorosMcpStatus();
    if (mcpStatus.connected && mcpStatus.authorized) {
      return;
    }

    mcpAutoConnectAttemptedRef.current = true;

    try {
      // Silent only. A dead MCP session must not throw a login window at the
      // athlete on launch; the Coach view asks before anything interactive.
      await api.ensureMcpConnected();
    } catch {
      // Sleep panel degrades gracefully when MCP is unavailable.
    }
  }, [api]);

  const loadTrainingHubWellnessData = useCallback(async () => {
    if (!api) {
      return;
    }

    const loadSequence = ++trainingWellnessLoadSequenceRef.current;
    setSleepConnecting(true);

    try {
      await ensureTrainingHubMcp();
      if (trainingWellnessLoadSequenceRef.current !== loadSequence) {
        return;
      }

      // One MCP call whatever the window, so ask for the whole span the trend
      // charts can be switched to — Overview's sleep chart offers a 30-day
      // chip, and a shorter fetch would leave its second half empty. Daily
      // health is asked a week, because Overview's step tile sums Monday to
      // today; `latest` still sorts by date, so today's figures stay today's.
      const [sleepResult, dailyHealthResult] = await Promise.allSettled([
        api.getTrainingSleepData(TRAINING_TREND_MAX_DAYS),
        api.getTrainingDailyHealthData(7),
      ]);

      if (trainingWellnessLoadSequenceRef.current !== loadSequence) {
        return;
      }

      setTrainingHubSleepData(
        sleepResult.status === "fulfilled" ? sleepResult.value : null,
      );
      setTrainingHubDailyHealthData(
        dailyHealthResult.status === "fulfilled"
          ? dailyHealthResult.value
          : null,
      );
    } finally {
      if (trainingWellnessLoadSequenceRef.current === loadSequence) {
        setSleepConnecting(false);
      }
    }
  }, [api, ensureTrainingHubMcp]);

  // Coming back to Overview after a load MCP was down for: run it again, so a
  // server connected in Settings fills the panels rather than only correcting
  // their copy. Nothing pushes an MCP status change (`mcp:*` is all invoke).
  //
  // Either feed is enough to trigger it, and it has to be: daily health always
  // attempts a connection, so its state reports a failed attempt, while sleep is
  // often served from cache and answers with `corosMcpAvailability()` — which
  // reads ready on stored tokens COROS may since have rejected. Gating on sleep
  // alone meant the retry never ran in exactly the case that needs it: steps and
  // calories saying "connect MCP" while sleep called the server fine.
  //
  // Both failures count. `"unreachable"` is the one worth retrying most — the
  // server is there and did not answer this time — and `"disconnected"` covers
  // a server connected in Settings while this screen was elsewhere.
  //
  // No loop: a still-dead retry writes the same state, and those values are the
  // deps. The Sleep screen needs none of this — its hook fetches on mount.
  const wellnessMissedMcp =
    isMcpFailure(trainingHubSleepData?.mcpState) ||
    isMcpFailure(trainingHubDailyHealthData?.mcpState);

  useEffect(() => {
    if (!api || activeView !== "overview" || !wellnessMissedMcp) {
      return;
    }

    void loadTrainingHubWellnessData();
  }, [api, activeView, wellnessMissedMcp, loadTrainingHubWellnessData]);

  // A COROS failure the athlete should see, or the wreckage of a load that was
  // doomed before it started.
  //
  // Start-up checks the stored token while the renderer is already mounting, so
  // the first load can go out against a token COROS has disowned and come back
  // as a fistful of errors. The restore that discovers this reloads everything
  // a second or two later, which makes those failures noise — and "COROS
  // session expired. Log in again." is worse than noise when the app is at that
  // moment logging back in by itself. So ask whether one is under way, from the
  // main process rather than from the status in state, which was read before
  // any of this began.
  const reportTrainingHubError = useCallback(
    async (caught: unknown) => {
      if (api) {
        const status = await api.getTrainingHubStatus().catch(() => null);
        if (status?.restoring) {
          return;
        }
      }
      setError(toErrorMessage(caught));
    },
    [api],
  );

  const refreshTrainingHub = useCallback(async () => {
    if (!api) {
      return;
    }

    const status = await api.getTrainingHubStatus();
    applyTrainingHubStatus(status);

    // Signed out *and* restoring is neither state this branch handles: there is
    // no session to load from, and emptying the screens would blank data the
    // re-login is seconds from refilling — while showing a sign-in form for a
    // session nobody has to sign into. Wait instead;
    // `onTrainingHubSessionChanged` calls this again the moment it lands.
    //
    // Restoring while still signed in is a different thing and deliberately
    // not caught here: start-up is only *checking* a token that is probably
    // fine, and holding back would tax every ordinary launch with the round
    // trip. Load optimistically — `reportTrainingHubError` is what keeps a
    // check that goes the other way from putting its wreckage on screen.
    if (status.restoring && !status.authenticated) {
      return;
    }

    if (status.authenticated) {
      void loadTrainingHubWellnessData();
      await loadTrainingHubData();
    } else {
      clearTrainingHubData();
    }
  }, [
    api,
    applyTrainingHubStatus,
    clearTrainingHubData,
    loadTrainingHubData,
    loadTrainingHubWellnessData,
  ]);

  useEffect(() => {
    // Overview hosts the sign-in surface now, so both screens want a fresh status.
    if (
      !api ||
      (activeView !== "training" &&
        activeView !== "overview" &&
        activeView !== "running" &&
        activeView !== "cycling" &&
        activeView !== "hiking")
    ) {
      return;
    }
    void api
      .getTrainingHubStatus()
      .then(applyTrainingHubStatus)
      .catch((caught) => setError(toErrorMessage(caught)));
  }, [activeView, api, applyTrainingHubStatus]);


  // A COROS session that came or went without anyone here asking: the main
  // process re-logged in from saved credentials at start-up, or a login on
  // another of the athlete's machines invalidated this one's token mid-session.
  //
  // The status arrives with the event, so the sign-in surface is right
  // immediately; the reload behind it fills the screens a restore just made
  // possible, and empties the ones an expiry just invalidated. Without this the
  // effect above is the only refresh there is, and it waits for a change of
  // view — leaving Overview claiming a connection that no longer exists.
  useEffect(() => {
    if (!api) return;
    return api.onTrainingHubSessionChanged((status) => {
      applyTrainingHubStatus(status);
      void refreshTrainingHub().catch((caught) =>
        reportTrainingHubError(caught),
      );
    });
  }, [
    api,
    applyTrainingHubStatus,
    refreshTrainingHub,
    reportTrainingHubError,
  ]);

  const handleTrainingHubActivityDetail = useCallback(
    async (activity: TrainingHubActivity) => {
      if (!api) {
        return;
      }

      const { activityId } = activity;
      const busyKey = `training-detail:${activityId}`;
      latestDetailRequestRef.current = activityId;
      setBusy(busyKey);
      setError(null);
      setMessage(null);
      setSelectedTrainingHubActivity(activity);
      setTrainingHubDetailRequest({ activityId, status: "pending" });

      // Two requests can be in flight at once — open one run, go back, open
      // another — and they need not land in order. The older reply used to
      // overwrite the newer detail, and its `setBusy(null)` cleared the busy
      // flag the newer request still held, which Running read as "finished
      // with nothing" and answered with a failure panel mid-load.
      const isLatest = () => latestDetailRequestRef.current === activityId;
      try {
        const detail = await api.getTrainingHubActivityDetail(
          activityId,
          activity.sportType,
          activity,
        );
        if (isLatest()) {
          setTrainingHubActivityDetail(detail);
          setTrainingHubDetailRequest({ activityId, status: "ready" });
        }
      } catch (caught) {
        if (isLatest()) {
          setError(toErrorMessage(caught));
          setTrainingHubDetailRequest({ activityId, status: "failed" });
        }
      } finally {
        // Only this request's own flag: anything else started meanwhile — a
        // newer detail, a refresh — owns `busy` now.
        setBusy((current) => (current === busyKey ? null : current));
      }
    },
    [api],
  );

  /*
   * Open the Activities screen on something rather than on an empty pane.
   *
   * Gated on that screen being the one in front: a detail is a ~2.2 MB payload
   * to parse and this used to fire the moment the activity list landed, on
   * every launch, whatever the athlete was actually looking at. Running and the
   * globe each choose their own activity, so neither is waiting on this.
   */
  useEffect(() => {
    if (!api || activeView !== "training" || trainingHubActivities.length === 0) {
      return;
    }

    const selectedId = selectedTrainingHubActivity?.activityId;
    if (
      selectedId &&
      trainingHubActivities.some(
        (activity) => activity.activityId === selectedId,
      )
    ) {
      return;
    }

    void handleTrainingHubActivityDetail(trainingHubActivities[0]);
  }, [
    api,
    activeView,
    trainingHubActivities,
    selectedTrainingHubActivity?.activityId,
    handleTrainingHubActivityDetail,
  ]);

  // Decorative animations and polling stay hot even when nobody is looking;
  // flag the backgrounded state so CSS can pause them and refreshes can skip.
  //
  // The condition is *hidden*, never unfocused. Dozens of enter animations run
  // `fill-mode: both` from `opacity: 0`, so an element is invisible until its
  // animation actually plays — and pausing on blur froze every one of them
  // where it started. A window a desktop opens behind the terminal that
  // launched it (GNOME/Wayland routinely does) therefore came up with nothing
  // painted but the background, and only clicking it lifted the class and let
  // the first frame run, which read as the app refusing to start until it was
  // activated. A hidden window has nothing to reveal, so pausing there is free.
  useEffect(() => {
    const update = () => {
      document.body.classList.toggle("is-backgrounded", document.hidden);
    };
    update();
    document.addEventListener("visibilitychange", update);
    return () => {
      document.removeEventListener("visibilitychange", update);
    };
  }, []);

  useEffect(() => {
    if (!api) {
      return;
    }

    void refreshTrainingHub().catch((caught) => {
      void reportTrainingHubError(caught);
    });
  }, [api, refreshTrainingHub, reportTrainingHubError]);

  async function handleCheckForUpdates() {
    if (!api) {
      return;
    }

    if (devUpdateSimulation) {
      setMessage(
        `Test update ${devUpdateSimulation.availableVersion} is available.`,
      );
      return;
    }

    setBusy("update-check");
    setError(null);
    try {
      const snapshot = await api.checkForAppUpdates();
      setAppUpdateSnapshot(snapshot);

      if (!snapshot.supported) {
        // checkForAppUpdates() returns the snapshot untouched when the updater
        // is disabled, so nothing below would fire and the click would look
        // broken.
        setMessage("Updates are only available in installed builds.");
      } else if (snapshot.status === "not-available") {
        setMessage("You're on the latest version.");
      } else if (snapshot.status === "error") {
        setError(snapshot.error ?? "Could not check for updates.");
      }
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  function handleInstallUpdate() {
    if (devUpdateSimulation) {
      setMessage(
        "Test update install skipped — the development build has no updater.",
      );
      return;
    }

    void api
      ?.quitAndInstallUpdate()
      .then((result) => {
        if (result?.installMethod === "manual") {
          setMessage(
            "Opened the GitHub download page. Install the new build over Heracles Records in Applications.",
          );
        }
      })
      .catch((caught) => {
        setError(toErrorMessage(caught));
      });
  }

  async function handleDownloadUpdate() {
    if (devUpdateSimulation) {
      // Jump straight to "ready to install" so the downloaded-state UI is
      // reachable; nothing is fetched.
      setDevUpdateSimulation({ ...devUpdateSimulation, status: "downloaded" });
      setMessage(
        `Test update ${devUpdateSimulation.availableVersion} is ready to install. Nothing was downloaded.`,
      );
      return;
    }

    if (!api) {
      return;
    }

    setBusy("update-download");
    setError(null);
    try {
      const snapshot = await api.downloadAppUpdate();
      setAppUpdateSnapshot(snapshot);

      if (snapshot.status === "error") {
        setError(snapshot.error ?? "Could not download the update.");
      }
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  function handleAcceptAvailableUpdate(version: string) {
    if (devUpdateSimulation) {
      setDevUpdatePreviewKey(undefined);
      setMessage(
        `Test update ${version} accepted. No files were downloaded in the development build.`,
      );
      return;
    }

    installAcceptedVersionRef.current = version;

    if (
      appUpdateSnapshot.status === "downloaded" &&
      appUpdateSnapshot.availableVersion === version
    ) {
      installAcceptedVersionRef.current = null;
      handleInstallUpdate();
      return;
    }

    // electron-updater starts this itself when auto-download is enabled.
    // Otherwise the explicit acceptance starts the download here.
    if (
      appUpdateSnapshot.status !== "downloading" &&
      !(
        appUpdateSnapshot.status === "available" &&
        appUpdateSnapshot.autoDownload
      )
    ) {
      void handleDownloadUpdate();
    }
  }

  /**
   * Turns the simulated update on and off. It holds for the session so the
   * Settings update button, its popover and the prompt can all be exercised
   * in a dev build; a restart clears it because nothing is persisted.
   */
  function toggleDevUpdateSimulation() {
    if (!IS_DEVELOPMENT_BUILD) {
      return;
    }

    if (devUpdateSimulation) {
      setDevUpdateSimulation(null);
      setDevUpdatePreviewKey(undefined);
      setMessage("Test update cleared. Showing the real update status again.");
      return;
    }

    devUpdatePreviewSequenceRef.current += 1;
    setDevUpdatePreviewKey(devUpdatePreviewSequenceRef.current);
    setDevUpdateSimulation({
      supported: true,
      currentVersion:
        appUpdateSnapshot.currentVersion === "0.0.0"
          ? DEV_UPDATE_PREVIEW.previousVersion
          : appUpdateSnapshot.currentVersion,
      status: "available",
      availableVersion: DEV_UPDATE_PREVIEW.version,
      releaseNotes: DEV_UPDATE_PREVIEW.releaseNotes,
      autoCheck: appUpdateSnapshot.autoCheck,
      autoDownload: false,
    });
  }

  /** Dismissing the prompt closes it but leaves the simulation running. */
  function dismissDevUpdatePreview() {
    setDevUpdatePreviewKey(undefined);
  }

  async function handleUpdatePreferencesChange(prefs: {
    autoCheck?: boolean;
    autoDownload?: boolean;
  }) {
    if (!api) {
      return;
    }

    try {
      const snapshot = await api.setUpdatePreferences(prefs);
      setAppUpdateSnapshot(snapshot);
      setDevUpdateSimulation((current) =>
        current
          ? {
              ...current,
              autoCheck: snapshot.autoCheck,
              autoDownload: snapshot.autoDownload,
            }
          : current,
      );
    } catch (caught) {
      setError(toErrorMessage(caught));
    }
  }

  async function finishTrainingHubConnect(
    status: TrainingHubStatus,
    successMessage: string,
  ) {
    setTrainingHubStatus(status);
    setTrainingHub2faEmail(null);
    setTrainingHub2faCode("");
    setMessage(successMessage);
    void loadTrainingHubWellnessData();
    await loadTrainingHubData();
  }

  async function handleTrainingHubLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!api) {
      return;
    }

    setBusy("training-login");
    setError(null);
    setMessage(null);

    try {
      const result = await api.loginTrainingHub(
        trainingHubEmail,
        trainingHubPassword,
        trainingHubRemember,
      );
      if (result.twoFactorRequired) {
        setTrainingHub2faEmail(result.email ?? trainingHubEmail);
        setTrainingHub2faCode("");
        setMessage("Enter the verification code we emailed you.");
      } else {
        await finishTrainingHubConnect(
          result.status,
          "COROS Training Hub connected.",
        );
      }
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setTrainingHubPassword("");
      setBusy(null);
    }
  }

  async function handleTrainingHubVerify2fa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!api) {
      return;
    }

    setBusy("training-verify");
    setError(null);
    setMessage(null);

    try {
      const status = await api.verifyTrainingHubTwoFactor(trainingHub2faCode);
      await finishTrainingHubConnect(status, "COROS Training Hub connected.");
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function handleTrainingHubResend2fa() {
    if (!api) {
      return;
    }

    setBusy("training-resend");
    setError(null);

    try {
      await api.resendTrainingHubTwoFactorCode();
      setMessage("We sent a new verification code to your email.");
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  function handleTrainingHubCancel2fa() {
    void api?.cancelTrainingHubTwoFactor().catch((caught) => {
      setError(toErrorMessage(caught));
    });
    setTrainingHub2faEmail(null);
    setTrainingHub2faCode("");
    setError(null);
    setMessage(null);
  }

  async function handleTrainingHubReconnect() {
    if (!api) {
      return;
    }

    setBusy("training-reconnect");
    setError(null);
    setMessage(null);

    try {
      const result = await api.reconnectTrainingHub();
      if (result.twoFactorRequired) {
        setTrainingHub2faEmail(result.email ?? trainingHubStatus?.email ?? null);
        setTrainingHub2faCode("");
        setMessage("Enter the verification code we emailed you.");
      } else {
        await finishTrainingHubConnect(
          result.status,
          "COROS Training Hub connected with your saved account.",
        );
      }
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function handleTrainingHubLogout() {
    if (!api) {
      return;
    }

    setBusy("training-logout");
    setError(null);
    setMessage(null);

    try {
      setTrainingHubStatus(await api.logoutTrainingHub());
      clearTrainingHubData();
      setMessage("COROS Training Hub disconnected.");
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  /**
   * Running's "Try again", after the activity list failed to arrive.
   *
   * Not `handleTrainingHubRefresh`, whose success message is only withheld when
   * *every* COROS request fails. The list failing while something else loads
   * therefore reads "analytics refreshed" — shown beside a panel still saying
   * the activities did not load. The screen shows the outcome itself (the list,
   * or the same panel again), so this reports failures and claims nothing.
   */
  async function handleRunningActivitiesRetry() {
    setBusy("training-refresh");
    setError(null);
    setMessage(null);

    try {
      await refreshTrainingHub();
    } catch (caught) {
      await reportTrainingHubError(caught);
    } finally {
      setBusy(null);
    }
  }

  async function handleTrainingHubRefresh() {
    setBusy("training-refresh");
    setError(null);
    setMessage(null);

    try {
      await refreshTrainingHub();
      setMessage("COROS Training Hub analytics refreshed.");
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  /**
   * Overview's Refresh.
   *
   * The same COROS reload the connection card triggers — same `busy` key, so
   * the "Syncing data" pill and the Settings button agree with this one.
   *
   * Errors go through `reportTrainingHubError`, which keeps the start-up
   * re-login's wreckage off screen: a launch can have this button pressed while
   * the stored token is still being probed.
   */
  async function handleOverviewRefresh() {
    setBusy("training-refresh");
    setError(null);
    setMessage(null);

    try {
      await refreshTrainingHub();
      setMessage("Refreshed.");
    } catch (caught) {
      await reportTrainingHubError(caught);
    } finally {
      setBusy(null);
    }
  }

  async function handleTrainingHubExport(
    activity: TrainingHubActivity,
    fileType: TrainingHubActivityFileType,
  ) {
    if (!api) {
      return;
    }

    const format = TRAINING_HUB_EXPORT_FORMATS.find(
      (item) => item.fileType === fileType,
    );

    setBusy(`training-file:${activity.activityId}:${fileType}`);
    setError(null);
    setMessage(null);

    try {
      const result = await api.exportTrainingHubActivityFile(
        activity.activityId,
        activity.sportType,
        fileType,
        activity.name,
      );

      if (result.saved) {
        setMessage(
          `Saved ${format?.label ?? "activity"} file to ${result.filePath}.`,
        );
      }
    } catch (caught) {
      setError(toErrorMessage(caught));
      const status = await api.getTrainingHubStatus();
      setTrainingHubStatus(status);
      if (!status.authenticated) {
        clearTrainingHubData();
      }
    } finally {
      setBusy(null);
    }
  }

  const isOverviewDashboard = activeView === "overview";
  const trainingHubSnapshot = useMemo<TrainingHubSnapshot | null>(() => {
    if (
      !trainingHubAnalytics &&
      !trainingHubDashboard &&
      !trainingHubDailyMetrics
    ) {
      return null;
    }

    return buildTrainingHubSnapshot(
      trainingHubAnalytics,
      trainingHubDashboard,
      trainingHubDailyMetrics,
      trainingHubSleepData,
      trainingHubDailyHealthData,
    );
  }, [
    trainingHubAnalytics,
    trainingHubDashboard,
    trainingHubDailyMetrics,
    trainingHubSleepData,
    trainingHubDailyHealthData,
  ]);

  const { unitSystem } = useUnitSystem();
  /*
   * The Hall of Records is worked out here rather than in its screen: the
   * rail's "new" count and the labour notifications have to know what was
   * reached while the athlete is somewhere else. It is all local reads; what
   * costs a request runs only while the screen is open.
   */
  const hallOfRecords = useHallOfRecords({
    api,
    activities: trainingHubActivities,
    activitiesStatus: trainingHubActivitiesStatus,
    snapshot: trainingHubSnapshot,
    snapshotStatus: trainingHubSnapshotStatus,
    connected: Boolean(trainingHubStatus?.authenticated),
    visible: activeView === "records",
    unitSystem,
    sample: recordsSample,
  });
  const recordsNotices = useRecordsNotices({
    records: hallOfRecords,
    onRecordsScreen: activeView === "records",
  });
  /* The tab the hall opens on when something sent the athlete to a part of
     it — the celebration's "See the Twelve Labours". Taken once, on mount. */
  const [recordsTabRequest, setRecordsTabRequest] = useState<
    "timeline" | "labours" | null
  >(null);

  // Kick the RPE backfill and poll until the window is fully fetched, merging
  // freshly-cached sRPE into the daily metrics so the trend chart's RPE series
  // fills in live.
  useEffect(() => {
    if (!api || !trainingHubStatus?.authenticated || !trainingHubDailyMetrics) {
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const mergeRpe = (record: Record<string, number>) => {
      if (Object.keys(record).length === 0) {
        return;
      }
      setTrainingHubDailyMetrics((prev) => {
        if (!prev) {
          return prev;
        }
        const byDay = new Map(prev.dayList.map((day) => [day.happenDay, day]));
        for (const [happenDay, load] of Object.entries(record)) {
          const existing = byDay.get(happenDay);
          if (existing) {
            byDay.set(happenDay, { ...existing, rpeLoad: load });
          } else {
            byDay.set(happenDay, { happenDay, rpeLoad: load });
          }
        }
        const dayList = [...byDay.values()].sort((a, b) =>
          a.happenDay.localeCompare(b.happenDay)
        );
        return { ...prev, dayList };
      });
    };

    const tick = async () => {
      try {
        const [status, record] = await Promise.all([
          api.getRpeBackfillStatus(),
          api.getRpeLoadByDay()
        ]);
        if (cancelled) {
          return;
        }
        mergeRpe(record);
        if (status.pending > 0 || status.running) {
          timer = setTimeout(tick, 3000);
        }
      } catch {
        // Transient; stop polling quietly.
      }
    };

    void api.startRpeBackfill();
    void tick();

    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
    // Re-run when the metrics window is (re)loaded or auth changes.
  }, [api, trainingHubStatus?.authenticated, trainingHubDailyMetrics !== null]);

  function handleStartupViewChange(view: View) {
    setStartupView(view);
    saveStartupView(view);
    setMessage(
      `Startup view set to ${getPrimaryViewLabel(view)}. It will open on next launch.`,
    );
  }

  function handleHiddenSportScreensChange(hidden: SportScreen[]) {
    setHiddenSportScreens(hidden);
    saveHiddenSportScreens(hidden);
    // A hidden startup screen opens Overview, and the menu says so now rather
    // than on the next launch. The stored choice is not rewritten, so showing
    // the screen again brings it back.
    setStartupView(readStartupView());
  }

  /**
   * Hands a session to the screen built for its sport. Every door to a sport
   * screen goes through here, so none of them opens one the athlete took off
   * the rail: that answers false and opens nothing.
   */
  function openSportScreen(request: SportScreenRequest): boolean {
    if (hiddenSportScreens.includes(request.view)) {
      return false;
    }
    setSportScreenRequest(request);
    setActiveView(request.view);
    return true;
  }

  /*
   * An activity opened from another screen — a session the Library's plan
   * was trained as, a milestone in the Hall of Records: on the screen built for
   * its sport, the way Activities hands one over, and in Activities itself for
   * a swim, anything else with no screen of its own, or a sport whose screen
   * the athlete took off the rail.
   */
  function openActivityFrom(activityId: string, from: PrimaryView) {
    const activity = trainingHubActivities.find(
      (candidate) => candidate.activityId === activityId
    );
    const view = activity ? sportScreenFor(activity.sportType) : null;
    if (
      activity &&
      view &&
      openSportScreen({ view, activityId, startTime: activity.startTime, from })
    ) {
      return;
    }
    if (activity) {
      void handleTrainingHubActivityDetail(activity);
      setActiveView("training");
    } else {
      setMessage("That activity is not in the loaded history yet. Opening Activities.");
      setActiveView("training");
    }
  }

  function handleDevelopmentViewToggle() {
    const nextVisible = !showDevelopmentTools;
    setShowDevelopmentTools(nextVisible);
    if (!nextVisible) {
      // Leaving dev view drops the preview, so generated data can never
      // linger in the production view.
      setStrengthSampleMode(false);
      setRecordsSample(null);
      const developmentOnlyViews = new Set(
        PRIMARY_NAV_ITEMS.filter((item) => item.developmentOnly).map(
          (item) => item.id,
        ),
      );
      if (developmentOnlyViews.has(activeView)) {
        setActiveView("overview");
      }
      if (developmentOnlyViews.has(startupView)) {
        setStartupView("overview");
        saveStartupView("overview");
      }
    }
  }

  const { toasts, dismissToast } = useToaster(message, error);

  // The rail's identity row. The snapshot is served from the main process's
  // hour-long cache, so asking for it here costs no COROS request; a failure
  // just leaves the row on the account's email, which is already to hand.
  const [athleteIdentity, setAthleteIdentity] = useState<{
    name: string | null;
    avatarUrl: string | null;
  }>({ name: null, avatarUrl: null });

  useEffect(() => {
    if (!api || !trainingHubStatus?.authenticated) {
      setAthleteIdentity({ name: null, avatarUrl: null });
      return;
    }

    let cancelled = false;
    void api
      .getCorosProfileSnapshot()
      .then((snapshot) => {
        if (cancelled) {
          return;
        }
        setAthleteIdentity({
          name: snapshot.profile.nickname?.trim() || null,
          avatarUrl: snapshot.profile.avatarUrl ?? null,
        });
      })
      .catch(() => {
        // The rail falls back to the email; nothing here is worth a toast.
      });

    return () => {
      cancelled = true;
    };
  }, [api, trainingHubStatus?.authenticated]);

  const athleteName =
    athleteIdentity.name ??
    trainingHubStatus?.email?.split("@")[0]?.trim() ??
    null;

  return (
    <div className="app">
      {IS_DEVELOPMENT_BUILD ? (
        <DeveloperToolbar
          api={api}
          developmentViewActive={showDevelopmentTools}
          onDevelopmentViewToggle={handleDevelopmentViewToggle}
          updateSimulationActive={devUpdateSimulation !== null}
          onToggleUpdateSimulation={toggleDevUpdateSimulation}
          strengthSampleActive={strengthSampleMode}
          onStrengthSampleChange={setStrengthSampleMode}
          recordsSample={recordsSample}
          onRecordsSampleChange={setRecordsSample}
          onError={setError}
        />
      ) : (
        // Packaged builds have no toolbar. macOS still floats its traffic
        // lights over the window and the app owns its title bar there, so a
        // bare drag strip keeps that corner clear and the window movable; it
        // renders on every platform so the layout stays uniform.
        <div className="app-titlebar-drag" />
      )}

      <div className="app-body">
        <AppSidebar
          activeView={activeView}
          onChange={setActiveView}
          coachBusy={coachBusy}
          newCounts={{ records: recordsNotices.freshCount }}
          showDevelopmentItems={showDevelopmentTools}
          hiddenViews={hiddenSportScreens}
          athleteName={athleteName}
          athleteAvatarUrl={athleteIdentity.avatarUrl}
          appLogo={appLogo}
          expanded={sidebarExpanded}
          onExpandedChange={setSidebarExpanded}
          overlayOpen={sidebarOverlayOpen}
          onOverlayOpenChange={setSidebarOverlayOpen}
        />

        <main
          ref={contentRef}
          className={[
            "content",
            isOverviewDashboard && "content-overview",
            (activeView === "coach" || activeView === "library" || activeView === "training" || activeView === "running" || activeView === "cycling" || activeView === "hiking") && "content-fill",
          ]
            .filter(Boolean)
            .join(" ")}
        >
        {!api ? (
          <BridgeMissing />
        ) : (
          <>
            {activeView === "overview" ? (
              <OverviewTab
                onRefresh={() => void handleOverviewRefresh()}
                refreshing={busy === "training-refresh"}
                trainingOverview={
                  <div className="dashboard-block">
                    <Suspense
                      fallback={<DeferredSurfaceFallback label="training" />}
                    >
                      <LazyTrainingOverview
                        api={api}
                        status={trainingHubStatus}
                        email={trainingHubEmail}
                        password={trainingHubPassword}
                        remember={trainingHubRemember}
                        twoFactorEmail={trainingHub2faEmail}
                        twoFactorCode={trainingHub2faCode}
                        onTwoFactorCodeChange={setTrainingHub2faCode}
                        onVerifyTwoFactor={handleTrainingHubVerify2fa}
                        onResendTwoFactor={handleTrainingHubResend2fa}
                        onCancelTwoFactor={handleTrainingHubCancel2fa}
                        activities={trainingHubActivities}
                        upcomingWorkouts={trainingHubUpcomingWorkouts}
                        sportTypes={trainingHubSportTypes}
                        snapshot={trainingHubSnapshot}
                        snapshotStatus={trainingHubSnapshotStatus}
                        activitiesStatus={trainingHubActivitiesStatus}
                        busy={busy}
                        sleepConnecting={sleepConnecting}
                        onOpenSleepDetails={() => setActiveView("sleep")}
                        onEmailChange={setTrainingHubEmail}
                        onPasswordChange={setTrainingHubPassword}
                        onRememberChange={setTrainingHubRemember}
                        onLogin={handleTrainingHubLogin}
                        onReconnect={handleTrainingHubReconnect}
                        showStrength={!hiddenSportScreens.includes("strength")}
                      />
                    </Suspense>
                  </div>
                }
                trainingConnected={Boolean(trainingHubStatus?.authenticated)}
                trainingActivities={trainingHubActivities}
                trainingUpcomingWorkouts={trainingHubUpcomingWorkouts}
                trainingSnapshot={trainingHubSnapshot}
                trainingSportTypes={trainingHubSportTypes}
              />
            ) : null}
            {activeView === "training" ? (
              <Suspense fallback={<DeferredSurfaceFallback label="activities" />}>
                <LazyActivitiesView
                  api={api}
                  status={trainingHubStatus}
                  activities={trainingHubActivities}
                  activitiesStatus={trainingHubActivitiesStatus}
                  sportTypes={trainingHubSportTypes}
                  activityDetail={trainingHubActivityDetail}
                  selectedActivity={selectedTrainingHubActivity}
                  detailRequest={trainingHubDetailRequest}
                  busy={busy}
                  onLoadDetail={handleTrainingHubActivityDetail}
                  onExportFile={handleTrainingHubExport}
                  onConnect={() => setActiveView("overview")}
                  onRetry={() => void handleRunningActivitiesRetry()}
                  hiddenSportScreens={hiddenSportScreens}
                  onOpenSportScreen={(request) => {
                    openSportScreen({ ...request, from: "training" });
                  }}
                  onAskCoach={askCoach}
                />
              </Suspense>
            ) : null}
            {activeView === "library" ? (
              <TrainingLibraryErrorBoundary>
                <Suspense
                  fallback={
                    trainingHubStatus?.authenticated ? (
                      <TrainingLibrarySkeleton />
                    ) : (
                      <DeferredSurfaceFallback label="Training Library" />
                    )
                  }
                >
                  <LazyTrainingLibraryView
                    api={api}
                    status={trainingHubStatus}
                    onOpenTraining={() => setActiveView("overview")}
                    onOpenCoach={askCoach}
                    onMessage={setMessage}
                    onError={setError}
                    onScheduleChanged={handleExternalScheduleChange}
                    /* A planned session that was trained, opened as the
                       activity it became. */
                    onOpenActivity={(activityId) => openActivityFrom(activityId, "library")}
                  />
                </Suspense>
              </TrainingLibraryErrorBoundary>
            ) : null}
            {activeView === "running" ? (
              <Suspense fallback={<DeferredSurfaceFallback label="running" />}>
                <LazyRunningView
                  api={api}
                  activities={trainingHubActivities}
                  connected={Boolean(trainingHubStatus?.authenticated)}
                  restoring={Boolean(trainingHubStatus?.restoring)}
                  activitiesStatus={trainingHubActivitiesStatus}
                  detail={trainingHubActivityDetail}
                  detailRequest={trainingHubDetailRequest}
                  snapshot={trainingHubSnapshot}
                  busy={busy}
                  onRetryActivities={() => void handleRunningActivitiesRetry()}
                  onSelectActivity={handleTrainingHubActivityDetail}
                  onOpenOverview={() => setActiveView("overview")}
                  openRequest={
                    sportScreenRequest?.view === "running"
                      ? sportScreenRequest
                      : null
                  }
                  onOpenRequestHandled={() => setSportScreenRequest(null)}
                  onReturn={setActiveView}
                  onAskCoach={askCoach}
                />
              </Suspense>
            ) : null}
            {activeView === "cycling" ? (
              <Suspense fallback={<DeferredSurfaceFallback label="cycling" />}>
                <LazyCyclingView
                  api={api}
                  activities={trainingHubActivities}
                  connected={Boolean(trainingHubStatus?.authenticated)}
                  restoring={Boolean(trainingHubStatus?.restoring)}
                  activitiesStatus={trainingHubActivitiesStatus}
                  detail={trainingHubActivityDetail}
                  detailRequest={trainingHubDetailRequest}
                  snapshot={trainingHubSnapshot}
                  busy={busy}
                  onRetryActivities={() => void handleRunningActivitiesRetry()}
                  onSelectActivity={handleTrainingHubActivityDetail}
                  onOpenOverview={() => setActiveView("overview")}
                  openRequest={
                    sportScreenRequest?.view === "cycling"
                      ? sportScreenRequest
                      : null
                  }
                  onOpenRequestHandled={() => setSportScreenRequest(null)}
                  onReturn={setActiveView}
                  onAskCoach={askCoach}
                />
              </Suspense>
            ) : null}
            {activeView === "hiking" ? (
              <Suspense fallback={<DeferredSurfaceFallback label="hiking" />}>
                <LazyHikingView
                  api={api}
                  activities={trainingHubActivities}
                  connected={Boolean(trainingHubStatus?.authenticated)}
                  restoring={Boolean(trainingHubStatus?.restoring)}
                  activitiesStatus={trainingHubActivitiesStatus}
                  detail={trainingHubActivityDetail}
                  detailRequest={trainingHubDetailRequest}
                  snapshot={trainingHubSnapshot}
                  busy={busy}
                  onRetryActivities={() => void handleRunningActivitiesRetry()}
                  onSelectActivity={handleTrainingHubActivityDetail}
                  onOpenOverview={() => setActiveView("overview")}
                  openRequest={
                    sportScreenRequest?.view === "hiking"
                      ? sportScreenRequest
                      : null
                  }
                  onOpenRequestHandled={() => setSportScreenRequest(null)}
                  onReturn={setActiveView}
                  onAskCoach={askCoach}
                />
              </Suspense>
            ) : null}
            {activeView === "strength" ? (
              <Suspense fallback={<DeferredSurfaceFallback label="strength" />}>
                <LazyStrengthView
                  api={api}
                  status={trainingHubStatus}
                  showDevelopmentTools={
                    IS_DEVELOPMENT_BUILD && showDevelopmentTools
                  }
                  sampleMode={
                    IS_DEVELOPMENT_BUILD &&
                    showDevelopmentTools &&
                    strengthSampleMode
                  }
                  onOpenTraining={() => setActiveView("overview")}
                  openRequest={
                    sportScreenRequest?.view === "strength"
                      ? sportScreenRequest
                      : null
                  }
                  onOpenRequestHandled={() => setSportScreenRequest(null)}
                  onAskCoach={askCoach}
                />
              </Suspense>
            ) : null}
            {activeView === "sleep" ? (
              <Suspense fallback={<DeferredSurfaceFallback label="sleep" />}>
                <LazySleepDetailsView
                  api={api}
                  connected={Boolean(trainingHubStatus?.authenticated)}
                  trendPoints={trainingHubSnapshot?.trendPoints ?? []}
                  trendPointsLoading={
                    trainingHubSnapshotStatus === "pending" && !trainingHubSnapshot
                  }
                  onOpenOverview={() => setActiveView("overview")}
                />
              </Suspense>
            ) : null}
            {activeView === "profile" ? (
              <Suspense fallback={<DeferredSurfaceFallback label="Personal" />}>
                <LazyProfileView
                  api={api}
                  status={trainingHubStatus}
                  snapshot={trainingHubSnapshot}
                  onOpenOverview={() => setActiveView("overview")}
                  onMessage={setMessage}
                  onError={setError}
                />
              </Suspense>
            ) : null}
            {activeView === "places" ? (
              <Suspense
                fallback={<DeferredSurfaceFallback label="training map" />}
              >
                <LazyTrainingMapView
                  activities={trainingHubActivities}
                  connected={Boolean(trainingHubStatus?.authenticated)}
                  detail={trainingHubActivityDetail}
                  onSelectActivity={handleTrainingHubActivityDetail}
                  onOpenOverview={() => setActiveView("overview")}
                />
              </Suspense>
            ) : null}
            {activeView === "records" ? (
              <Suspense
                fallback={<DeferredSurfaceFallback label="Hall of Records" />}
              >
                <LazyHallOfRecordsView
                  api={api}
                  records={hallOfRecords}
                  activities={trainingHubActivities}
                  connected={Boolean(trainingHubStatus?.authenticated)}
                  newIds={recordsNotices.visitNew}
                  requestedTab={recordsTabRequest}
                  onTabRequestHandled={() => setRecordsTabRequest(null)}
                  onOpenActivity={(activity) =>
                    isSampleRecordsActivity(activity.activityId)
                      ? setMessage(
                          "A sample milestone: its activity exists only in the sample, so there is no page to open.",
                        )
                      : openActivityFrom(activity.activityId, "records")
                  }
                  onOpenOverview={() => setActiveView("overview")}
                  retrying={busy === "training-refresh"}
                  onRetryActivities={() => void handleRunningActivitiesRetry()}
                />
              </Suspense>
            ) : null}
            {activeView === "settings" ? (
              <SettingsView
                api={api}
                updateSnapshot={effectiveUpdateSnapshot}
                updateBusy={busy === "update-check"}
                updateDownloading={busy === "update-download"}
                onCheckForUpdates={() => void handleCheckForUpdates()}
                onDownloadUpdate={() => void handleDownloadUpdate()}
                onInstallUpdate={handleInstallUpdate}
                onUpdatePreferencesChange={handleUpdatePreferencesChange}
                onError={setError}
                startupView={startupView}
                onStartupViewChange={handleStartupViewChange}
                hiddenSportScreens={hiddenSportScreens}
                onHiddenSportScreensChange={handleHiddenSportScreensChange}
                showDevelopmentTools={showDevelopmentTools}
                trainingStatus={trainingHubStatus}
                trainingBusy={busy}
                onTrainingRefresh={handleTrainingHubRefresh}
                onTrainingLogout={handleTrainingHubLogout}
                onTrainingSignIn={() => setActiveView("overview")}
              />
            ) : null}
            {activeView === "calendar" ? (
              <Suspense
                fallback={
                  trainingHubStatus?.authenticated ? (
                    <CalendarSkeleton />
                  ) : (
                    <DeferredSurfaceFallback label="calendar" />
                  )
                }
              >
                <LazyCalendarView
                  api={api}
                  status={trainingHubStatus}
                  sportTypes={trainingHubSportTypes}
                  refreshToken={calendarRefreshToken}
                  onMessage={setMessage}
                  onError={setError}
                  onOpenTraining={() => setActiveView("overview")}
                  onOpenCoach={askCoach}
                  onScheduleChanged={refreshUpcomingWorkouts}
                />
              </Suspense>
            ) : null}
            {coachMounted || activeView === "coach" ? (
              <div
                className={[
                  "content-coach-panel",
                  activeView !== "coach" && "view-panel-hidden",
                ]
                  .filter(Boolean)
                  .join(" ")}
                aria-hidden={activeView !== "coach"}
              >
                <Suspense
                  fallback={<DeferredSurfaceFallback label="Coach" />}
                >
                  <LazyChatView
                    api={api}
                    onError={setError}
                    onPlanUploaded={() => {
                      void loadTrainingHubData();
                      setCalendarRefreshToken((token) => token + 1);
                    }}
                    onActivityChange={setCoachStreaming}
                    pendingPrompt={coachPrefill}
                    onPendingPromptConsumed={() => setCoachPrefill(null)}
                    onMessage={setMessage}
                    active={activeView === "coach"}
                  />
                </Suspense>
              </div>
            ) : null}
          </>
        )}
      </main>
      </div>

      <UpdateAvailablePrompt
        snapshot={effectiveUpdateSnapshot}
        onAccept={handleAcceptAvailableUpdate}
        onDecline={
          devUpdatePreviewKey === undefined
            ? undefined
            : dismissDevUpdatePreview
        }
        previewKey={devUpdatePreviewKey}
      />
      <Toaster toasts={toasts} onDismiss={dismissToast}>
        {recordsNotices.toasts.map(({ announcement, labour }) => (
          <LabourToastCard
            key={announcement.key}
            announcement={announcement}
            labour={labour}
            onOpen={() => {
              recordsNotices.dismissToast(announcement.key);
              setActiveView("records");
            }}
            onDismiss={() => recordsNotices.dismissToast(announcement.key)}
          />
        ))}
      </Toaster>
      {recordsNotices.celebration ? (
        <LabourCelebration
          labour={recordsNotices.celebration.labour}
          completed={recordsNotices.celebration.completed}
          onSeeLabours={() => {
            recordsNotices.closeCelebration();
            setRecordsTabRequest("labours");
            setActiveView("records");
          }}
          onClose={recordsNotices.closeCelebration}
        />
      ) : null}
    </div>
  );
}

interface OverviewTabProps {
  /** The training panels, handed in ready-made so App keeps the ~20 props. */
  trainingOverview: ReactNode;
  trainingConnected: boolean;
  /**
   * Re-reads COROS.
   *
   * The one entry point on this screen for that. COROS is what changes when the
   * athlete finishes a run — so before this button the only way to see a new
   * activity was to quit the app and open it again. The connection card kept a
   * Refresh when it moved into Settings, which is two screens away from the one
   * showing the stale numbers.
   */
  onRefresh: () => void;
  /** Drives the spinner; also true while the same refresh runs from Settings. */
  refreshing: boolean;
  trainingActivities: TrainingHubActivity[];
  /** Feeds the contextual subtitle only — the panels get their own copies. */
  trainingUpcomingWorkouts: TrainingHubUpcomingWorkout[];
  trainingSnapshot: TrainingHubSnapshot | null;
  trainingSportTypes: TrainingHubSportType[];
}

/** What the subtitle says when nothing else is known yet. */
const OVERVIEW_FALLBACK_SUBTITLE = "Here is where your training stands today.";

function OverviewTab({
  trainingOverview,
  trainingConnected,
  onRefresh,
  refreshing,
  trainingActivities,
  trainingUpcomingWorkouts,
  trainingSnapshot,
  trainingSportTypes,
}: OverviewTabProps) {
  const greeting = useTimeOfDayGreeting();
  const { unitSystem } = useUnitSystem();
  // `greeting` is a dependency on purpose: it flips at the morning/afternoon/
  // evening boundaries, which is exactly when the subtitle should turn over.
  const subtitle = useMemo(
    () =>
      selectOverviewGreeting(
        {
          trainingConnected,
          upcomingWorkouts: trainingUpcomingWorkouts,
          activities: trainingActivities,
          sportTypes: trainingSportTypes,
          summary: trainingSnapshot?.summary ?? null,
          sleep: trainingSnapshot?.sleep ?? null,
          unitSystem,
        },
        OVERVIEW_FALLBACK_SUBTITLE,
      ),
    [
      greeting,
      trainingConnected,
      trainingUpcomingWorkouts,
      trainingActivities,
      trainingSportTypes,
      trainingSnapshot,
      unitSystem,
    ],
  );

  return (
    <div className="dashboard">
      <header className="dashboard-welcome dashboard-block">
        <div>
          <h1 className="dashboard-greeting">{greeting}</h1>
          <p className="dashboard-subtitle">{subtitle}</p>
        </div>
        <button
          className="icon-button dashboard-welcome-action"
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          title={refreshing ? "Refreshing…" : "Refresh COROS data"}
          aria-label={refreshing ? "Refreshing" : "Refresh"}
          aria-busy={refreshing}
        >
          <RefreshCw
            size={16}
            aria-hidden="true"
            className={refreshing ? "spin" : ""}
          />
        </button>
      </header>

      {trainingOverview}
    </div>
  );
}

interface ToastItem {
  id: number;
  kind: "success" | "error";
  text: string;
}

const TOAST_DURATION: Record<ToastItem["kind"], number> = {
  success: 4500,
  error: 7000,
};

// Drives the floating toast stack from the app's existing message/error state,
// so every setMessage/setError call surfaces as an auto-dismissing toast
// instead of a banner that shoves the layout down.
function useToaster(message: string | null, error: string | null) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextIdRef = useRef(0);
  const timersRef = useRef(new Map<number, number>());
  const lastMessageRef = useRef<string | null>(null);
  const lastErrorRef = useRef<string | null>(null);

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
    const timer = timersRef.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const pushToast = useCallback(
    (kind: ToastItem["kind"], text: string) => {
      const id = (nextIdRef.current += 1);
      setToasts((current) => [...current.slice(-2), { id, kind, text }]);
      const timer = window.setTimeout(
        () => dismissToast(id),
        TOAST_DURATION[kind],
      );
      timersRef.current.set(id, timer);
    },
    [dismissToast],
  );

  // Refs guard against StrictMode's double-invoke and repeated identical values
  // (e.g. the same COROS error twice) while still re-toasting after the source clears.
  useEffect(() => {
    if (message && message !== lastMessageRef.current) {
      pushToast("success", message);
    }
    lastMessageRef.current = message;
  }, [message, pushToast]);

  useEffect(() => {
    if (error && error !== lastErrorRef.current) {
      pushToast("error", error);
    }
    lastErrorRef.current = error;
  }, [error, pushToast]);

  // Toasts raised from outside App's own message/error state — nested views
  // that have no path to it. Same stack, same auto-dismiss.
  useEffect(() => subscribeToToasts(pushToast), [pushToast]);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      timers.clear();
    };
  }, []);

  return { toasts, dismissToast };
}

function Toaster({
  toasts,
  onDismiss,
  children,
}: {
  toasts: ToastItem[];
  onDismiss: (id: number) => void;
  /** Toasts of another shape that share the stack: the labour notices. */
  children?: ReactNode;
}) {
  const hasExtra = Children.toArray(children).length > 0;
  if (toasts.length === 0 && !hasExtra) {
    return null;
  }

  return (
    <div className="toast-stack" role="region" aria-label="Notifications">
      {children}
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastCard({
  toast,
  onDismiss,
}: {
  toast: ToastItem;
  onDismiss: (id: number) => void;
}) {
  return (
    <div
      className={`toast toast--${toast.kind}`}
      role={toast.kind === "error" ? "alert" : "status"}
    >
      <span className="toast-icon" aria-hidden="true">
        {toast.kind === "error" ? (
          <AlertCircle size={18} />
        ) : (
          <CheckCircle2 size={18} />
        )}
      </span>
      <span className="toast-text">{toast.text}</span>
      <button
        className="toast-close"
        type="button"
        aria-label="Dismiss notification"
        onClick={() => onDismiss(toast.id)}
      >
        <X size={15} aria-hidden="true" />
      </button>
      <span
        className="toast-progress"
        style={{ animationDuration: `${TOAST_DURATION[toast.kind]}ms` }}
        aria-hidden="true"
      />
    </div>
  );
}

function BridgeMissing() {
  return (
    <section className="panel">
      <div className="empty-state">
        <AlertCircle size={26} aria-hidden="true" />
        <strong>Electron bridge unavailable</strong>
        <span>Run the app with npm run dev or npm start.</span>
      </div>
    </section>
  );
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
