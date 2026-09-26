import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  net,
  powerMonitor,
  safeStorage,
  session,
  shell
} from "electron";
import type { OpenDialogOptions } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createDefaultSyncDeps,
  SyncService
} from "./sync/syncService";
import { GoogleOAuth } from "./sync/googleOAuth";
import { GoogleDriveProvider } from "./sync/googleDriveProvider";
import { SyncLoop } from "./sync/syncLoop";
import { SqliteSyncTarget } from "./sync/sqliteSyncTarget";
import { tablesTouched, type ApplyResult } from "./sync/syncEngine";
import { attachSyncSink } from "./sync/syncBridge";
import { createSqliteRecordVersions } from "./sync/recordVersions";
import { createSqliteOutbox } from "./sync/outbox";
import { attachAnalysisLeases } from "./sync/automationLease";
import {
  captureSyncableState,
  collectFullStateEntries,
  publishFullState
} from "./sync/fullState";
import type { SyncableStateCapture } from "./sync/fullState";
import {
  commitPublishedLocalStorage,
  diffLocalStorage,
  noteAppliedLocalStorage
} from "./sync/localStorageSync";
import type {
  LocalStoragePublishResult,
  SyncLoopStatus,
  SyncSeedStatus,
  SyncVaultState
} from "./sync/syncTypes";
import { SYNC_LOOP_SETTINGS } from "./sync/syncLoop";
import {
  BACKUP_EXTENSION,
  BACKUP_OPEN_EXTENSIONS,
  defaultBackupFileName,
  inspectBackupFile,
  requireBackupAccount,
  restoreBackupFile,
  writeBackupFile
} from "./backup/backupService";
import type { RestoreMode } from "./backup/backupTypes";
import { deviceId as syncDeviceId } from "./sync/deviceIdentity";
import {
  initializeActivityDetailCache,
  sweepActivityDetailCache
} from "./activityDetailCache";
import { initializeCorosLocale } from "./corosLocale";
import {
  clearDownloadTransferredByFileName,
  deleteDownload,
  getDownloadById,
  hasAvailableDownloadForUrl,
  deleteSettings,
  getSetting,
  initializeDatabase,
  listDownloads,
  markDownloadTransferred,
  readTrainingActivityFeelTypes,
  setSetting
} from "./database";
import {
  downloadAudio,
  downloadCombinedTrack,
  getBinaryStatus
} from "./downloadService";
import {
  cancelJob,
  clearCompletedJobs,
  clearJob,
  clearTerminalJobsForUrl,
  enqueueDownloads,
  listJobs,
  setJobListener
} from "./downloadQueue";
import {
  getSpotifyConfig,
  getSpotifyStatus,
  listSpotifyPlaylists,
  listSpotifyPlaylistTracks,
  listSpotifySyncState,
  loginSpotify,
  logoutSpotify,
  saveSpotifyConfig,
  syncSpotifyPlaylist
} from "./spotifyService";
import {
  cancelActivityBackup,
  getActivityBackupProgress,
  setActivityBackupProgressListener,
  startActivityBackup
} from "./activityBackupService";
import { getAppInfo, openAppStorageLocation } from "./appInfoService";
import {
  backfillFeelTypes,
  getDailyMetrics,
  getRacePredictor,
  getRpeBackfillStatus,
  getRpeLoadByDay,
  getSportTypeMap,
  getTrainingAnalytics,
  getTrainingDashboard,
  fetchTrainingHubActivityFile,
  getTrainingHubActivityDetail,
  getTrainingHubActivityDetailRaw,
  readActivityDetailSummaries,
  syncActivityDetailSummaries,
  getCorosProfileSnapshot,
  getTrainingHubStatus,
  getUpcomingWorkouts,
  listTrainingHubActivities,
  listScheduledWorkoutEntries,
  listLibraryWorkouts,
  refreshWorkoutCaches,
  duplicateLibraryWorkout,
  listWorkoutExercises,
  getWorkoutEditorContext,
  scheduleLibraryWorkout,
  createAndScheduleWorkout,
  createLibraryWorkout,
  rescheduleScheduledWorkout,
  removeScheduledWorkout,
  getWorkoutForEdit,
  previewWorkoutEdit,
  saveWorkoutEdit,
  loginTrainingHub,
  verifyTrainingHubTwoFactor,
  resendTrainingHubTwoFactorCode,
  cancelTrainingHubTwoFactor,
  logoutTrainingHub,
  reconnectTrainingHub,
  restoreTrainingHubSessionAtStartup,
  setTrainingHubSessionListener,
  updateCorosProfile,
  uploadActivityFitToCoros,
  uploadTrainingPlan
} from "./trainingHubService";
import { syncStrengthHistory } from "./strengthHistoryService";
import {
  connectHevy,
  disconnectHevy,
  getHevyStatus,
  updateHevySettings
} from "./hevyService";
import type {
  CorosProfilePatch,
  HevySettingsInput,
  SaveChatSessionOptions,
  StrengthHistoryRequest,
  TrainingHubStatus,
  TrainingPlanGenerationRequest,
  TrainingPlanOutlineRevision,
  UnitSystem,
  WorkoutSport
} from "./types";
import {
  deletePlanFromCoros,
  deleteTrainingLibraryWorkouts,
  discardPlanDraft,
  duplicatePlanOnCoros,
  getNativeTrainingPlan,
  getTrainingLibrarySnapshot,
  libraryWorkoutAsPlanSession,
  listActivityMatches,
  previewPlanOnCalendar,
  putPlanOnCalendar,
  listTrainingLibraryWorkouts,
  refreshTrainingActivityMatches,
  saveManualActivityMatch,
  savePlanDraft,
  savePlanToCoros,
  syncPlanToCalendar,
  takePlanOffCalendar,
  updateWorkoutMetadata,
  updateTrainingPlanMetadata
} from "./trainingLibraryService";
import { normalizeUnitSystem } from "./unitSystem.js";
import {
  getIntervalsStatus,
  connectIntervals,
  disconnectIntervals,
  listIntervalsActivities,
  downloadIntervalsFit,
  recordIntervalsImport,
  getRecentlyImportedIds,
  RECENT_IMPORT_WINDOW_MS
} from "./intervalsService";
import { isAlreadyOnCoros } from "./intervalsMatch";
import { reverseGeocodeLocation } from "./reverseGeocodeService";
import { buildManualTcx } from "./tcxBuilder";
import type {
  CombinedDownloadResult,
  DownloadJob,
  DownloadQueueItem,
  SpotifyConfig,
  TrainingHubActivity,
  TrainingHubActivityFileType,
  TrainingHubExportResult,
  WatchConnectionSmokeOptionId,
  YouTubeMusicConfig,
  IntervalsActivityWithStatus,
  ManualActivityInput,
  WatchTransferProgress
} from "./types";
import {
  deleteWatchTrack,
  getWatchConnectionSmokeOption,
  getWatchStatus,
  setWatchConnectionSmokeOption,
  transferFileToWatch
} from "./watchService";
import {
  configureYouTubeBrowserSession,
  registerYouTubeBrowserHandlers,
  resetYouTubeBrowserSession
} from "./youtubeBrowserService";
import {
  configureYouTubeMusicBrowserSession,
  registerYouTubeMusicBrowserHandlers,
  resetYouTubeMusicBrowserSession
} from "./youtubeMusicBrowserService";
import {
  downloadFromYouTubeBrowser,
  downloadMultipleFromYouTubeBrowser,
  getYouTubeHistory,
  saveYouTubeVisit
} from "./youtubeService";
import {
  logoutYouTubeMusic,
  getYouTubeMusicConfig,
  getYouTubeMusicStatus,
  loginYouTubeMusic,
  listYouTubeMusicLibrary,
  saveYouTubeMusicConfig,
  saveYouTubeMusicAuth,
  syncYouTubeMusicLibrary
} from "./youtubeMusicService";
import {
  fetchAppleMusicPlaylist,
  getAppleMusicStatus,
  listAppleMusicPlaylists,
  logoutAppleMusic,
  saveAppleMusicAuth,
  saveAppleMusicCapturedHeaders
} from "./appleMusicService";
import {
  configureAppleMusicBrowserSession,
  registerAppleMusicBrowserHandlers,
  resetAppleMusicBrowserSession
} from "./appleMusicBrowserService";
import {
  loadApplePodcast,
  searchApplePodcasts
} from "./applePodcastsService";
import {
  checkForAppUpdates,
  downloadAppUpdate,
  getAppUpdateSnapshot,
  initializeAppUpdater,
  quitAndInstallUpdate,
  setUpdaterPreferences
} from "./updaterService";
import {
  startCoachActivityWatcher,
  stopCoachActivityWatcher
} from "./coachActivityWatcher";
import {
  startCoachAnalysisScheduler,
  stopCoachAnalysisScheduler
} from "./coachAnalysisScheduler";
import {
  CoachAnalysisError,
  cancelStaleCoachAnalysisRuns,
  createCoachAnalysis,
  deleteCoachAnalysis,
  getCoachAnalysis,
  listCoachAnalysisRuns,
  listCoachAnalysisSummariesForSession,
  listCoachAnalysisSessionAttention,
  markCoachAnalysisRunsSeen,
  markCoachAnalysisSessionSeen,
  reorderCoachAnalyses,
  setCoachAnalysisEnabled,
  updateCoachAnalysis
} from "./coachAnalysisStore";
import {
  cancelAnalysisRun,
  emitAnalysisChanged,
  emitAnalysisUpdate,
  getAnalysisPause,
  getAnalysisSpend,
  resumeAnalyses,
  runAnalysisNow,
  setAnalysisBudget
} from "./coachAnalysisService";
import { setChatSessionTitle } from "./chatHistoryStore";
import {
  cancelChat,
  createChatSessionForProvider,
  createWindowSink,
  deleteChatSessionById,
  detectLocalChatServers,
  beginClaudeCodeLogin,
  cancelClaudeCodeLogin,
  awaitClaudeCodeLogin,
  submitClaudeCodeLoginCode,
  openClaudeCodeLoginUrl,
  revokeClaudeCodeLogin,
  getClaudeCodeConnectionStatus,
  getChatAuthStatus,
  getChatSessionEntries,
  getChatSettings,
  listChatSessionsForProvider,
  loginChat,
  logoutChat,
  saveChatSessionEntries,
  saveChatSettings,
  setChatSessionPinnedById,
  testClaudeCodeConnection,
  testAnthropicApiConnection,
  testLocalChatConnection,
  testOpenRouterConnection,
  uploadTrainingPlanDraft,
  editWorkoutDraft,
  removePlanDraft,
  listPlanArtifactVersions,
  restorePlanVersion,
  syncPlanFromCoros,
  listPlanCalendarStates,
  streamConversationTurn,
  getConversationSettings,
  setConversationSettings,
  listConversationPlanBriefs,
  editPlanBrief,
  findChatSessionForDraft,
  editPlanDraft,
  generateTrainingPlan,
  outlineTrainingPlan,
  getPlanDraftDocument,
  confirmWorkoutDelete
} from "./chatService";
import {
  compactChatSessionContext,
  inspectChatSessionContext
} from "./chatContextService";
import { buildBaseCoachInstructions } from "./chatCoachContext";
import {
  OPENROUTER_KEYS_URL,
  OPENROUTER_MODELS_URL
} from "./openRouterProvider";
import {
  pruneDeleteRequestStore
} from "./chatWorkoutTools";
import {
  connectCorosMcp,
  disconnectCorosMcp,
  getCorosMcpStatus,
  listCorosMcpTools
} from "./corosMcpService";
import {
  connectMcpServer,
  disconnectMcpServer,
  ensureAllMcpConnected,
  getMcpStatuses,
  reconnectAllMcpServers
} from "./mcpClientManager";
import {
  addMcpServer,
  getMcpServer,
  listMcpServers,
  removeMcpServer,
  setMcpBearer,
  updateMcpServer
} from "./mcpServersStore";
import { getTrainingDailyHealthData } from "./dailyHealthDataService";
import {
  clearSleepHistoryCache,
  getCachedSleepSummary,
  getSleepHistory
} from "./sleepHistoryService";
import { clearSleepSeriesCache, getSleepNightSeries } from "./sleepSeriesService";
import type {
  AnthropicApiConfig,
  ChatMessage,
  ChatProvider,
  ChatSettings,
  CoachAnalysisCreateResult,
  CoachAnalysisInput,
  CoachAnalysisPatch,
  CoachAnalysisRunQuery,
  CorosTrainingPlanDraftInput,
  LocalChatConfig,
  OpenRouterConfig,
  PersistedChatEntry,
  PlanWorkoutEntryInput,
  RunWorkoutEditorDraft,
  WorkoutEditRef
} from "./types";

// userData lives at <appData>/Heracles Records, the default Electron derives
// from the product name. Data from the pre-rename <appData>/coroslink folder
// was copied across once, by hand, in August 2026; that folder is still on disk
// and is not read any more.

let mainWindow: BrowserWindow | undefined;
let rendererReady = false;

/** Matches --bg-base in styles.css; updated when the renderer theme changes. */
const DEFAULT_WINDOW_BACKGROUND = "#05080b";
let currentWindowBackground = DEFAULT_WINDOW_BACKGROUND;

const TRAFFIC_LIGHT_WINDOWED = { x: 18, y: 18 };
const TRAFFIC_LIGHT_FULLSCREEN = { x: 16, y: 12 };

function applyWindowBackground(color: string): void {
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
    return;
  }

  currentWindowBackground = color;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setBackgroundColor(color);
  }
}

function syncTrafficLightPosition(fullscreen: boolean): void {
  if (process.platform !== "darwin" || !mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.setWindowButtonPosition(
    fullscreen ? TRAFFIC_LIGHT_FULLSCREEN : TRAFFIC_LIGHT_WINDOWED
  );
}

function notifyWindowFullscreen(fullscreen: boolean): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("window:fullscreenChanged", fullscreen);
  }
}

// Turns an activity name into a filesystem-safe base name for export downloads.
function sanitizeExportFileName(name?: string): string {
  if (!name) {
    return "";
  }

  return name
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function formatYyyymmddDay(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function pickLatestTrainingHubActivity(
  activities: TrainingHubActivity[]
): TrainingHubActivity | undefined {
  const validActivities = activities.filter(
    (activity) =>
      activity.activityId.trim().length > 0 &&
      Number.isFinite(activity.sportType)
  );
  if (validActivities.length === 0) {
    return undefined;
  }

  return validActivities.reduce((latest, activity) => {
    const latestStart = latest.startTime ?? Number.NEGATIVE_INFINITY;
    const activityStart = activity.startTime ?? Number.NEGATIVE_INFINITY;
    return activityStart > latestStart ? activity : latest;
  });
}

async function exportTrainingHubActivityFileToDisk(
  activity: TrainingHubActivity,
  fileType: TrainingHubActivityFileType,
  suggestedName?: string
): Promise<TrainingHubExportResult> {
  const { format, content } = await fetchTrainingHubActivityFile(
    activity.activityId,
    activity.sportType,
    fileType
  );

  const baseName =
    sanitizeExportFileName(suggestedName ?? activity.name) ||
    `activity-${activity.activityId}`;
  const defaultPath = `${baseName}.${format.extension}`;

  const saveOptions = {
    defaultPath,
    filters: [
      { name: `${format.label} file`, extensions: [format.extension] }
    ]
  };
  const result =
    mainWindow && !mainWindow.isDestroyed()
      ? await dialog.showSaveDialog(mainWindow, saveOptions)
      : await dialog.showSaveDialog(saveOptions);

  const metadata = {
    activityId: activity.activityId,
    activityName: activity.name,
    activityStartTime: activity.startTime,
    fileType,
    formatLabel: format.label
  };

  if (result.canceled || !result.filePath) {
    return { saved: false, ...metadata };
  }

  await fs.promises.writeFile(result.filePath, content);
  return { saved: true, filePath: result.filePath, ...metadata };
}

function getAppIconPath(): string | undefined {
  const candidates =
    process.platform === "darwin"
      ? ["icon.icns", "icon.png"]
      : process.platform === "win32"
        ? ["icon.ico", "icon.png"]
        : ["icon.png", "icon.icns"];

  for (const fileName of candidates) {
    const iconPath = path.join(__dirname, "../build", fileName);
    if (fs.existsSync(iconPath)) {
      return iconPath;
    }
  }

  return undefined;
}

function applyAppIcon(): void {
  const iconPath = getAppIconPath();
  if (!iconPath) {
    return;
  }

  if (process.platform === "darwin" && app.dock) {
    try {
      app.dock.setIcon(iconPath);
    } catch {
      // A bad/missing dock icon (e.g. in dev) must not abort app startup.
    }
  }
}

const ALLOWED_PERMISSIONS = new Set([
  // Lets the renderer copy text (e.g. the Spotify Redirect URI) via
  // navigator.clipboard.writeText.
  "clipboard-sanitized-write"
]);

/**
 * The app has no menu of its own, and Electron builds a default one — File,
 * Edit, View, Window, Help — whenever none is set. On Windows and Linux that
 * strip lives *inside* the window, above the app's own chrome, and everything
 * on it is either a browser control the app does not want exposed (Reload,
 * Toggle Developer Tools) or a duplicate of something the UI already offers.
 *
 * macOS keeps the default. There the menu is the system menu bar rather than a
 * strip in the window, so it costs the layout nothing, and clearing it takes
 * the Edit roles with it — which is where Cmd+C/V/X in a text field come from
 * on that platform. Windows and Linux get those from Chromium directly, so
 * removing the menu there loses no editing shortcut.
 */
function hideDefaultApplicationMenu(): void {
  if (process.platform === "darwin") {
    return;
  }

  Menu.setApplicationMenu(null);
}

function configureAppPermissions(): void {
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, permission, callback) => {
      callback(ALLOWED_PERMISSIONS.has(permission));
    }
  );

  session.defaultSession.setPermissionCheckHandler((_webContents, permission) =>
    ALLOWED_PERMISSIONS.has(permission)
  );
}

function createWindow(): void {
  const iconPath = getAppIconPath();

  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 640,
    title: "Heracles Records",
    ...(iconPath ? { icon: iconPath } : {}),
    backgroundColor: DEFAULT_WINDOW_BACKGROUND,
    // Let the app's own header act as the title bar so the macOS traffic
    // lights sit directly on it instead of a separate OS chrome strip.
    ...(process.platform === "darwin"
      ? {
          titleBarStyle: "hiddenInset" as const,
          trafficLightPosition: { x: 18, y: 18 }
        }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      sandbox: false
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("did-start-loading", () => {
    rendererReady = false;
  });
  mainWindow.webContents.on("did-finish-load", () => {
    // A window is what the sync loop's `appActive` condition is asking about,
    // so its arrival is what un-pauses polling — nothing else calls `resume()`,
    // and without this a Mac whose window was closed once never pulled again
    // for the rest of the process's life.
    //
    // Anything queued for the renderer is delivered from `markRendererReady`
    // instead: the page having loaded does not mean React has attached its
    // listeners, and a send into nothing would drop writes there is only one
    // copy of.
    syncLoopInstance?.resume();
  });
  mainWindow.on("closed", () => {
    rendererReady = false;
    mainWindow = undefined;
  });
  // macOS fullscreen exposes the window background in the title-bar inset;
  // re-apply after transitions so it stays in sync with the active theme.
  mainWindow.on("enter-full-screen", () => {
    applyWindowBackground(currentWindowBackground);
    syncTrafficLightPosition(true);
    notifyWindowFullscreen(true);
  });
  mainWindow.on("leave-full-screen", () => {
    applyWindowBackground(currentWindowBackground);
    syncTrafficLightPosition(false);
    notifyWindowFullscreen(false);
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  initializeAppUpdater(mainWindow);
}

/**
 * Deletes what the Maps, Watch Faces and Gear screens left on disk.
 *
 * Their SQLite tables are dropped when the database opens, and these are the
 * files those rows described — downloaded COROS map packages (often a gigabyte
 * of them), route GPX, saved watchface projects and the archives built from
 * them. Nothing reads any of it, and an install that had used those screens
 * would otherwise carry the whole of it forever with nothing in the app even
 * naming the folders. Best effort: a folder that will not delete is not worth
 * a failed launch, and the next one tries again.
 */
async function removeRetiredFeatureStorage(): Promise<void> {
  const retired = [
    "map-cache",
    "routes",
    "watchface-projects",
    "watchface-archives",
    "watchface-share-imports",
    "community-watchface-imports"
  ];
  for (const name of retired) {
    const target = path.join(app.getPath("userData"), name);
    try {
      if (!fs.existsSync(target)) continue;
      await fs.promises.rm(target, { recursive: true, force: true });
      console.log(`[cleanup] removed retired storage: ${name}`);
    } catch (error) {
      console.warn(`[cleanup] could not remove ${name}`, error);
    }
  }
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

/**
 * Let WebGL fall back to software rendering when the GPU cannot serve it.
 *
 * The map styles this app ships are vector ones, drawn by MapLibre through
 * WebGL, and `createBaseLayer` drops to a raster street map when WebGL is
 * missing — a *light* map, because no keyless dark raster style exists. So on a
 * machine whose driver Chromium refuses ("WebGL2 blocklisted", seen on a Linux
 * box with an NVIDIA card under Wayland), every map in the app turned bright
 * white in the dark theme, with no error anywhere to say why.
 *
 * Since Chrome 127 that fallback is off unless asked for. Asking for it costs
 * nothing where a GPU works — Chromium still prefers the real one — and where
 * it does not, a slow correct map beats a fast wrong-coloured one. Must be set
 * before `whenReady`.
 */
app.commandLine.appendSwitch("enable-unsafe-swiftshader");

app.whenReady().then(() => {
  if (!hasSingleInstanceLock) return;
  hideDefaultApplicationMenu();
  configureAppPermissions();
  configureYouTubeBrowserSession();
  registerYouTubeBrowserHandlers();
  configureYouTubeMusicBrowserSession();
  // Saving runs the ytmusicapi Python bridge, so guard against overlapping runs
  // if several youtubei requests slip through before the first save finishes.
  let youtubeMusicCaptureInFlight = false;
  registerYouTubeMusicBrowserHandlers((headerBlock) => {
    if (youtubeMusicCaptureInFlight) {
      return;
    }
    youtubeMusicCaptureInFlight = true;
    void saveYouTubeMusicAuth(headerBlock)
      .then((status) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("youtubeMusic:authCaptured", { status });
        }
      })
      .catch((error) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("youtubeMusic:authCaptured", {
            error: error instanceof Error ? error.message : String(error)
          });
        }
      })
      .finally(() => {
        youtubeMusicCaptureInFlight = false;
      });
  });
  configureAppleMusicBrowserSession();
  registerAppleMusicBrowserHandlers((headers) => {
    // Fires on every amp-api call; only tell the renderer when the stored
    // credentials actually change (e.g. the media-user-token first appears).
    const { status, changed } = saveAppleMusicCapturedHeaders(headers);
    if (changed && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("appleMusic:authCaptured", status);
    }
  });
  initializeDatabase(app.getPath("userData"));
  // COROS's string table, for official plans that name their sessions by key.
  initializeCorosLocale(app.getPath("userData"));
  // Activity details are files beside the database, not rows in it: 2.5 MB
  // each, 98% sample series, and the rows sync.
  initializeActivityDetailCache(app.getPath("userData"));
  // Once per launch, because nothing else reclaims anything: the cap is only
  // checked when a detail is written, so an athlete who fills the directory and
  // then stops opening runs — or signs out — keeps whatever is there for good.
  // A scan of a few thousand files costs a millisecond or two.
  sweepActivityDetailCache();
  pruneDeleteRequestStore();
  registerIpcHandlers();
  setJobListener((jobs) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("youtube:jobsUpdate", jobs);
    }
  });
  setTrainingHubSessionListener((status) => {
    announceTrainingHubSessionChanged(status);
  });
  setActivityBackupProgressListener((progress) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("trainingHub:backupProgress", progress);
    }
  });
  createWindow();
  applyAppIcon();
  void removeRetiredFeatureStorage();

  // Silently restore previously-authorized MCP sessions (COROS + any other
  // configured servers), no browser popup.
  void ensureAllMcpConnected();

  // Sync follows the app process too. A folder vault opens without anyone
  // typing anything, so waiting for the Settings screen to be visited would
  // mean a machine left on the Overview never synced at all — and the
  // analysis lease below would never attach.
  //
  // The COROS re-login goes first, and the vault waits on it, because the
  // vault's owner *is* the COROS account: a `prepare()` that ran while the
  // session was still missing answers `signed-out`, stops the loop, and nothing
  // starts it again for the rest of the run. With nothing to restore — the
  // usual case — the restore returns without touching the network, so this
  // costs the launch nothing.
  void (async () => {
    // The status itself needs no forwarding from here: the service announces it
    // through `setTrainingHubSessionListener` above, which is the same path a
    // mid-session expiry takes. What this wants is only whether it happened.
    let restored = false;
    try {
      const result = await restoreTrainingHubSessionAtStartup();
      restored = result.restored;
    } catch (error) {
      console.warn("[trainingHub] startup COROS re-login could not run", error);
    }

    try {
      await prepareSync();
    } catch (error) {
      console.warn("[sync] could not open the vault at startup", error);
      return;
    }

    // Signed out, this machine published nothing and pulled nothing, so the
    // other one has been the only writer. Ask for its changes now instead of
    // waiting out the idle interval. Only after a restore: an ordinary launch
    // already polls from `start()`, and a second pass would buy nothing.
    if (restored) {
      syncLoopInstance?.resume();
    }
  })();

  // Waking from sleep is the one moment worth polling immediately rather than
  // waiting out the idle interval: the machine has been away, so there is very
  // likely something to pull, and its network came back a moment ago.
  powerMonitor.on("resume", () => syncLoopInstance?.resume());

  // Coach analyses follow the app process, not the window: with the window
  // closed on macOS they keep running, and the athlete sees the results as
  // unread next time a window exists. Deliberately not wired to createWindow.
  // A run in flight when the app quit has nothing left to finish it, so the
  // run log would show it spinning forever (section 10).
  cancelStaleCoachAnalysisRuns();
  startCoachActivityWatcher();
  startCoachAnalysisScheduler();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

/**
 * How long quit will wait for the sync queue before giving up on it.
 *
 * A ceiling, not a budget: the ordinary quit pays none of it, because a device
 * with nothing outstanding never gets here. It exists for the link that neither
 * answers nor fails — a captive portal, a VPN half-way down — where the upload
 * would otherwise hold the window open until TCP gave up on its own.
 */
const QUIT_FLUSH_TIMEOUT_MS = 5_000;

/** Whether the flush below has already been asked for. `app.quit()` re-fires
 *  `before-quit`, so without this the second pass would start a second one. */
let quitFlushStarted = false;

app.on("before-quit", (event) => {
  // Idempotent, both, which is what lets the quit be cancelled and retried
  // below without them running against half-torn-down state.
  stopCoachActivityWatcher();
  stopCoachAnalysisScheduler();

  const loop = syncLoopInstance;
  // The fast path, and the common one: nothing queued, nothing in the air, so
  // the app closes exactly as quickly as it did before this existed.
  if (quitFlushStarted || !loop?.hasUnpushedChanges) return;
  quitFlushStarted = true;

  // A change waits `FLUSH_DEBOUNCE_MS` before it is even attempted, so a turn
  // written and an app closed in the same breath used to reach the vault never.
  // That is not merely "the other machine is behind": the merge writes the
  // vault's winner into SQLite without asking what the row currently holds, so
  // the *next launch* would pull a foreign copy of that record straight over
  // the local one — see the pull rule in CLAUDE.md. Getting the queue out is
  // what keeps the vault's copy the newest one.
  event.preventDefault();
  loop.stop();
  void (async () => {
    try {
      await Promise.race([
        loop.flushBeforeQuit(),
        new Promise((resolve) => setTimeout(resolve, QUIT_FLUSH_TIMEOUT_MS))
      ]);
    } catch (error) {
      console.warn("[sync] could not flush the queue on quit", error);
    }
    // A macrotask, so Electron has finished processing the cancelled quit
    // before a second one is asked for.
    setImmediate(() => app.quit());
  })();
});

// Built on first use, because it reads settings and so needs the database to be
// open. One instance for the life of the process; it caches nothing itself, so
// there is no state to reset when the destination changes.
let syncServiceInstance: SyncService | null = null;
let googleOAuthInstance: GoogleOAuth | null = null;

const electronSecretStorage = {
  isAvailable: () => safeStorage.isEncryptionAvailable(),
  encrypt: (plaintext: string) =>
    safeStorage.encryptString(plaintext).toString("base64"),
  decrypt: (encoded: string) =>
    safeStorage.decryptString(Buffer.from(encoded, "base64"))
};

function googleOAuth(): GoogleOAuth {
  googleOAuthInstance ??= new GoogleOAuth({
    fetch: globalThis.fetch,
    // The system browser, not a BrowserWindow: Google refuses embedded webviews.
    openExternal: (url) => shell.openExternal(url),
    getSetting,
    setSetting,
    deleteSettings,
    secretStorage: electronSecretStorage,
    now: () => Date.now()
  });
  return googleOAuthInstance;
}

function syncService(): SyncService {
  syncServiceInstance ??= new SyncService(
    createDefaultSyncDeps(
      { getSetting, setSetting },
      {
        isConnected: () => googleOAuth().isConnected(),
        isClientConfigured: () => googleOAuth().client() !== null,
        makeProvider: () =>
          new GoogleDriveProvider({
            fetch: globalThis.fetch,
            accessToken: () => googleOAuth().accessToken()
          })
      }
    )
  );
  return syncServiceInstance;
}

// The two-way loop. Built only once a destination is configured, because there
// is nowhere for it to write before then. Tied to the app lifecycle rather than
// to a window: a backup in flight should finish even if the user closes the
// last one.
let syncLoopInstance: SyncLoop | null = null;

/**
 * How the one-off publish of this machine's existing data went, this session.
 *
 * In memory rather than persisted, and that is the right scope: the durable
 * fact is `sync.seededVaultId`, which says the vault has been seeded. This says
 * what happened *since this app started*, which is what the panel needs in
 * order to show a failure while the person is still looking at it.
 */
let syncSeedStatus: SyncSeedStatus = {
  state: "pending",
  entries: 0,
  error: null
};
const syncTarget = new SqliteSyncTarget();

/**
 * What a pull merged, waiting for a renderer to tell.
 *
 * The localStorage half of a pull has always been queued — `SqliteSyncTarget`
 * holds it, because the main process cannot perform those writes itself. The
 * counts and the table names had no such queue: they arrived as arguments and
 * were dropped whole when the window was not ready, and the `did-finish-load`
 * follow-up then announced `0, 0`. So a pull that landed during startup or a
 * reload told the renderer nothing at all, and the screens that should have
 * re-read their tables kept the copies they had for the life of the process.
 *
 * Accumulated rather than replaced: two pulls can land before the window is
 * ready, and the second one's tables do not cover the first one's.
 */
let pendingSyncChange: {
  applied: number;
  deleted: number;
  tables: Set<string>;
} = { applied: 0, deleted: 0, tables: new Set() };

/** Record what a merge wrote and offer it to the renderer. */
function noteSyncApplied(result: ApplyResult): void {
  pendingSyncChange.applied += result.applied;
  pendingSyncChange.deleted += result.deleted;
  // `setting` and `localStorage` entries are left out by `tablesTouched`: they
  // name a key, not a table. The first reaches the renderer through whatever
  // reads that setting, the second travels in the event's own `localStorage`
  // half.
  for (const table of tablesTouched(result.merged)) {
    pendingSyncChange.tables.add(table);
  }
  sendSyncChanged();
}

/**
 * Hand a pull's results to the renderer, localStorage writes included.
 *
 * Nothing is drained without a renderer to drain it into. `SqliteSyncTarget`
 * queues localStorage operations because the main process cannot reach
 * `window.localStorage`, and it is the only copy — so taking them while nobody
 * is listening loses them outright. That is not hypothetical: the loop is tied
 * to the app, not to a window, so a Mac with its window closed keeps pulling.
 *
 * `rendererReady`, not merely a live `mainWindow`. A `BrowserWindow` exists from
 * `createWindow()` onward, but `webContents.send` before `did-finish-load`
 * reaches no listener — so a pull landing during startup or a reload used to
 * drain the queue into nothing and lose exactly what this guard is here to
 * protect.
 *
 * Called again from `markRendererReady`, which is what delivers anything that
 * accumulated while there was nowhere to send it.
 */
function sendSyncChanged(): void {
  if (!mainWindow || mainWindow.isDestroyed() || !rendererReady) return;
  const localStorage = syncTarget.drainLocalStorage();
  const { applied, deleted, tables } = pendingSyncChange;
  if (localStorage.length === 0 && applied === 0 && deleted === 0) return;
  pendingSyncChange = { applied: 0, deleted: 0, tables: new Set() };

  // Fold these into the published snapshot before the renderer writes them.
  // The renderer publishes by comparing its localStorage against what this
  // machine last sent, so a merged value left out of that snapshot would read
  // as a local edit on the next pass and be published straight back — the
  // bounce `syncBridge` avoids for rows by writing them through the raw
  // database. That trick is unavailable here: the write happens in the
  // renderer, so the snapshot is corrected instead.
  if (localStorage.length > 0 && syncLoopInstance) {
    noteAppliedLocalStorage(localStorage, {
      getSetting,
      setSetting,
      nextHlc: syncLoopInstance.nextHlc
    });
  }

  mainWindow.webContents.send("sync:changed", {
    applied,
    deleted,
    tables: [...tables],
    localStorage
  });
}

/**
 * Publish the renderer's preferences, if any of them moved.
 *
 * The renderer sends the whole of what policy allows rather than individual
 * edits; the diff against the last published snapshot is what turns that into
 * changes. An unchanged set produces nothing, which is the point — see
 * `localStorageSync.ts` for why republishing everything would have the machine
 * that launched most recently win every preference.
 */
function publishRendererLocalStorage(
  entries: Readonly<Record<string, string>>
): LocalStoragePublishResult {
  const loop = syncLoopInstance;
  // Sync is off, or the vault is unreachable. Not an error — most machines are
  // in this state — but the renderer must not read it as delivery. It remembers
  // what it last sent to avoid pointless work, and a `syncing: false` answer
  // recorded as sent would mean the preferences of a machine that switched sync
  // on mid-session never went out at all, because nothing about them had
  // changed since.
  if (!loop) return { syncing: false, published: 0 };

  const deps = { getSetting, setSetting, nextHlc: loop.nextHlc };
  const changes = diffLocalStorage(entries, deps);
  if (changes.entries.length === 0) return { syncing: true, published: 0 };

  loop.enqueue(changes.entries);
  // Recorded as published as soon as it is queued, not once it is uploaded: a
  // failed flush puts the batch back on the queue rather than dropping it, so
  // the entries are not lost, and re-diffing them would only mint a second set
  // of timestamps for the same values.
  commitPublishedLocalStorage(entries, deps);
  return { syncing: true, published: changes.entries.length };
}

/**
 * The renderer has mounted and is listening.
 *
 * Announced by the renderer rather than inferred from `did-finish-load`, which
 * fires when the page loaded and says nothing about whether React has attached
 * its IPC listeners yet. One flag serves both callers: the deep link that was
 * waiting for a window, and the inbound sync writes that were waiting for
 * somewhere to be applied.
 */
function markRendererReady(): void {
  rendererReady = true;
  sendSyncChanged();
  flushTrainingHubSessionChanged();
}

/**
 * A change of COROS session nobody clicked for, waiting for someone to tell.
 *
 * Held rather than sent for the reason `sendSyncChanged` holds its queue: a
 * `webContents.send` before the renderer's listeners exist reaches nobody. Only
 * the newest one is kept, which is all the renderer wants — this carries a whole
 * status, not a delta, so an older one has nothing left to say.
 *
 * Losing it costs no data, only accuracy: the sign-in surface would keep
 * whatever it last read until the athlete changed view. That is exactly the
 * wrongness this push exists to remove, so it is worth queueing.
 */
let pendingTrainingHubSessionChange: TrainingHubStatus | null = null;

function announceTrainingHubSessionChanged(status: TrainingHubStatus): void {
  pendingTrainingHubSessionChange = status;
  flushTrainingHubSessionChanged();
}

function flushTrainingHubSessionChanged(): void {
  const status = pendingTrainingHubSessionChange;
  if (!status) return;
  if (!mainWindow || mainWindow.isDestroyed() || !rendererReady) return;
  pendingTrainingHubSessionChange = null;
  mainWindow.webContents.send("trainingHub:sessionChanged", status);
}

function stopSyncLoop(): void {
  syncSeedStatus = { state: "pending", entries: 0, error: null };
  attachSyncSink(null);
  attachAnalysisLeases(null);
  syncLoopInstance?.stop();
  syncLoopInstance = null;
}

/**
 * Check the destination and start the loop.
 *
 * This is the whole of "turn sync on": it runs at launch and again whenever the
 * folder or the backend changes. Nothing is asked of the user, so the only
 * reason it comes back short of "ready" is a destination that did not answer.
 */
async function prepareSync(): Promise<SyncVaultState> {
  const state = await syncService().prepare();
  if (state === "ready") {
    startSyncLoop();
  } else if (state === "signed-out" || state === "wrong-owner") {
    // The two states where carrying on is not merely unproductive but wrong:
    // nobody is signed in, or the vault holds another account's data. A loop
    // left running would keep publishing into it. `unreachable` is deliberately
    // not here — the loop already handles a destination that comes and goes,
    // and tearing it down would drop the queue's reason to exist.
    stopSyncLoop();
  }
  return state;
}

function startSyncLoop(): SyncLoop | null {
  const service = syncService();
  if (syncLoopInstance) return syncLoopInstance;
  if (!service.isReady) return null;

  const loop = new SyncLoop({
    provider: () => service.dataProvider(),
    target: syncTarget,
    deviceId: syncDeviceId,
    deviceName: () => os.hostname(),
    getSetting,
    setSetting,
    now: () => Date.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (handle) => clearTimeout(handle as NodeJS.Timeout),
    recordVersions: createSqliteRecordVersions(),
    outbox: createSqliteOutbox(),
    conditions: () => ({
      // A hidden window means nobody is looking, so there is nothing to poll
      // for; `resume()` picks it up again when the window comes back.
      appActive: Boolean(mainWindow && !mainWindow.isDestroyed()),
      online: net.isOnline()
    }),
    onApplied: (result) => {
      // Tell the renderer what to re-read, and hand it the localStorage writes
      // the main process cannot perform itself. Queued rather than sent: the
      // loop follows the app lifecycle, so on macOS it keeps pulling with every
      // window closed, and there is no second copy of either half anywhere.
      // `markRendererReady` is what delivers them once a window is listening.
      noteSyncApplied(result);
    },
    onError: (error) => console.warn("[sync] loop error", error)
  });

  // Changes made anywhere in the app now flow into this loop.
  attachSyncSink({
    enqueue: (entries) => loop.enqueue(entries),
    nextHlc: loop.nextHlc
  });

  // Analyses sync, so the same 6am job now exists on every machine. Without
  // a lease all of them would run it.
  attachAnalysisLeases({
    enabled: () => service.isReady,
    provider: () => service.dataProvider(),
    deviceId: syncDeviceId,
    now: () => Date.now(),
    onSkipped: (analysisId, holder) =>
      console.info(`[sync] analysis ${analysisId} is running on ${holder}`),
    onLeaseLost: (analysisId) =>
      console.warn(
        `[sync] lost the lease for analysis ${analysisId} mid-run; ` +
          `another device may have taken it over`
      )
  });

  loop.start();
  syncLoopInstance = loop;

  // The oplog only ever learned about records written while it was running, so
  // on a machine that has been in use for months it starts out describing
  // almost nothing. Publish what is already here, once per vault.
  void seedVaultIfNeeded(loop, service);

  return loop;
}

/**
 * Put this machine's existing data into the vault the first time it joins one.
 *
 * Keyed on the vault's id rather than on "have we ever seeded": pointing at a
 * different vault is a different account's worth of history, and it needs the
 * same publish. Moving a vault — renaming the folder, swapping to Drive — keeps
 * its id and so does not seed again.
 *
 * The flag is set only after every batch is up. A run that dies halfway
 * republishes everything next time, which costs bandwidth and nothing else:
 * entries are addressed by primary key, so the second attempt supersedes what
 * the first managed to write rather than duplicating it.
 */
async function seedVaultIfNeeded(
  loop: SyncLoop,
  service: ReturnType<typeof syncService>
): Promise<void> {
  try {
    const vaultId = await service.vaultId();
    if (service.hasSeeded(vaultId)) {
      syncSeedStatus = { state: "done", entries: 0, error: null };
      return;
    }

    syncSeedStatus = { state: "publishing", entries: 0, error: null };
    const entries = collectFullStateEntries(loop.nextHlc);
    const published = await publishFullState(loop, entries);
    service.markSeeded(vaultId);
    syncSeedStatus = {
      state: "done",
      entries: published.entries,
      error: null
    };
    console.info(
      `[sync] published ${published.entries} existing records into vault ` +
        `${vaultId} across ${published.batches} batches`
    );
  } catch (error) {
    // Never fatal: the app works offline and the next launch tries again. What
    // must not happen is marking the vault seeded when it is not — or letting
    // the failure pass unseen, which is how months of history quietly stay put
    // on a machine whose panel says everything is fine.
    const reason = error instanceof Error ? error.message : String(error);
    syncSeedStatus = { state: "failed", entries: 0, error: reason };
    console.warn("[sync] could not publish this machine's existing data", error);
  }
}

/**
 * Re-check the vault now that an account has signed in.
 *
 * Sync is owned by an account, so it cannot start until one exists — and the
 * alternative to this is telling the person to restart the app, which they
 * would have no way of knowing to do.
 *
 * Never allowed to fail a sign-in: an unreachable vault is a sync problem, and
 * the person is signed in either way.
 */
async function resumeSyncForAccount(): Promise<void> {
  try {
    await prepareSync();
  } catch (error) {
    console.warn("[sync] could not re-check the vault after signing in", error);
  }
}

/** What the change loop is doing, or null when none is running. */
function syncLoopStatus(): SyncLoopStatus | null {
  const loop = syncLoopInstance;
  if (!loop) return null;
  return {
    pendingChanges: loop.pendingCount,
    lastPulledAt: getSetting(SYNC_LOOP_SETTINGS.lastPulledAt) ?? null,
    seed: syncSeedStatus
  };
}

/**
 * Announce a restore to the other machines.
 *
 * `applySnapshot` writes through the raw database so a merge cannot echo back
 * out — which also means it mints no timestamps, and to the merge rules the
 * restore never happened. Left alone, the next pull would replay the log over
 * the top of it and quietly undo the whole thing.
 *
 * So the restored state is republished with fresh timestamps: it now outranks
 * everything already in the log, and the other machines follow. `before` is
 * what this computer held a moment ago, which is the only way to know what the
 * restore *removed* — a set for what remains says nothing about what went.
 */
async function republishAfterRestore(
  before: SyncableStateCapture
): Promise<void> {
  const loop = syncLoopInstance;
  if (!loop) return;

  try {
    const entries = collectFullStateEntries(loop.nextHlc, { before });
    const published = await publishFullState(loop, entries);
    // A restore states the whole of this machine's data, so whatever the seed
    // would have said has just been said.
    const service = syncService();
    service.markSeeded(await service.vaultId());
    console.info(
      `[sync] republished ${published.entries} records after a restore`
    );
  } catch (error) {
    console.warn("[sync] could not republish after a restore", error);
  }
}

function registerIpcHandlers(): void {
  ipcMain.handle("window:setBackground", (_event, color: string) => {
    applyWindowBackground(color);
  });

  ipcMain.handle("window:isFullscreen", () => mainWindow?.isFullScreen() ?? false);

  ipcMain.handle("watch:getStatus", () => getWatchStatus());

  ipcMain.handle("watch:getConnectionSmokeOption", () =>
    getWatchConnectionSmokeOption()
  );

  ipcMain.handle(
    "watch:setConnectionSmokeOption",
    (_event, optionId: WatchConnectionSmokeOptionId) =>
      setWatchConnectionSmokeOption(optionId)
  );

  ipcMain.handle("watch:deleteTrack", async (_event, relativePath: string) => {
    await deleteWatchTrack(relativePath);
    clearDownloadTransferredByFileName(path.basename(relativePath));
    return getWatchStatus();
  });

  ipcMain.handle("watch:transferLocalTrack", async (_event, id: string) => {
    const download = getDownloadById(id);
    if (!download) {
      throw new Error("Local track was not found.");
    }

    const trackName = path.basename(download.filePath);
    const copiedTrack = await transferFileToWatch(
      download.filePath,
      ({ copiedBytes, totalBytes }) => {
        if (!mainWindow || mainWindow.isDestroyed()) {
          return;
        }
        mainWindow.webContents.send("watch:transferProgress", {
          id,
          name: trackName,
          copiedBytes,
          totalBytes,
          progress: totalBytes > 0 ? Math.min(copiedBytes / totalBytes, 1) : 0
        } satisfies WatchTransferProgress);
      }
    );
    markDownloadTransferred(id);

    return {
      copiedTrack,
      watch: await getWatchStatus()
    };
  });

  ipcMain.handle("downloads:list", () => listDownloads());

  ipcMain.handle("downloads:downloadAudio", (_event, url: string) =>
    downloadAudio(url)
  );

  ipcMain.handle(
    "downloads:delete",
    (_event, id: string, removeFile: boolean) => {
      const download = getDownloadById(id);
      deleteDownload(id, removeFile);

      if (download && !hasAvailableDownloadForUrl(download.url)) {
        clearTerminalJobsForUrl(download.url);
      }

      return listDownloads();
    }
  );

  ipcMain.handle("binaries:getStatus", () => getBinaryStatus());

  ipcMain.handle("youtube:listHistory", () => getYouTubeHistory());

  ipcMain.handle(
    "youtube:recordVisit",
    (_event, url: string, title?: string) => saveYouTubeVisit(url, title)
  );

  ipcMain.handle(
    "youtube:download",
    (_event, url: string, title?: string) =>
      downloadFromYouTubeBrowser(url, title)
  );

  ipcMain.handle("youtube:downloadMultiple", (_event, items) =>
    downloadMultipleFromYouTubeBrowser(items)
  );

  ipcMain.handle(
    "youtube:enqueueDownload",
    (_event, items: DownloadQueueItem[]): DownloadJob[] =>
      enqueueDownloads(items)
  );

  ipcMain.handle(
    "music:downloadCombined",
    (
      event,
      id: string,
      name: string,
      items: DownloadQueueItem[]
    ): Promise<CombinedDownloadResult> =>
      downloadCombinedTrack(id, name, items, (update) => {
        event.sender.send("music:combinedProgress", { id, ...update });
      })
  );

  ipcMain.handle("youtube:listJobs", (): DownloadJob[] => listJobs());

  ipcMain.handle("youtube:clearJob", (_event, id: string): DownloadJob[] =>
    clearJob(id)
  );

  ipcMain.handle("youtube:cancelJob", (_event, id: string): DownloadJob[] =>
    cancelJob(id)
  );

  ipcMain.handle("youtube:clearCompletedJobs", (): DownloadJob[] =>
    clearCompletedJobs()
  );

  ipcMain.handle("youtube:resetSession", () => resetYouTubeBrowserSession());

  ipcMain.handle("youtubeMusic:getConfig", () => getYouTubeMusicConfig());

  ipcMain.handle(
    "youtubeMusic:saveConfig",
    (_event, config: YouTubeMusicConfig) => saveYouTubeMusicConfig(config)
  );

  ipcMain.handle("youtubeMusic:getStatus", () => getYouTubeMusicStatus());

  ipcMain.handle("youtubeMusic:saveAuth", (_event, headersRaw: string) =>
    saveYouTubeMusicAuth(headersRaw)
  );

  ipcMain.handle("youtubeMusic:login", () => loginYouTubeMusic());

  ipcMain.handle("youtubeMusic:resetBrowserSession", () =>
    resetYouTubeMusicBrowserSession()
  );

  ipcMain.handle("youtubeMusic:logout", () => logoutYouTubeMusic());

  ipcMain.handle("youtubeMusic:listLibrary", () => listYouTubeMusicLibrary());

  ipcMain.handle("youtubeMusic:syncLibrary", () => syncYouTubeMusicLibrary());

  ipcMain.handle("chat:getAuthStatus", () => getChatAuthStatus());

  ipcMain.handle("chat:getSettings", () => getChatSettings());

  ipcMain.handle("chat:getBaseCoachInstructions", () =>
    buildBaseCoachInstructions()
  );

  ipcMain.handle("chat:saveSettings", (_event, settings: ChatSettings) =>
    saveChatSettings(settings)
  );

  ipcMain.handle("chat:testLocalConnection", (_event, config?: LocalChatConfig) =>
    testLocalChatConnection(config)
  );

  ipcMain.handle(
    "chat:testAnthropicConnection",
    (_event, config?: Partial<AnthropicApiConfig>) =>
      testAnthropicApiConnection(config)
  );

  ipcMain.handle("chat:openAnthropicKeyGuide", () =>
    shell.openExternal("https://console.anthropic.com/settings/keys")
  );

  ipcMain.handle("chat:detectLocalServers", (_event, apiKey?: string) =>
    detectLocalChatServers(apiKey)
  );

  ipcMain.handle(
    "chat:testOpenRouterConnection",
    (_event, config?: OpenRouterConfig) => testOpenRouterConnection(config)
  );

  ipcMain.handle("chat:openOpenRouterKeys", () =>
    shell.openExternal(OPENROUTER_KEYS_URL)
  );

  ipcMain.handle("chat:openOpenRouterModels", () =>
    shell.openExternal(OPENROUTER_MODELS_URL)
  );

  ipcMain.handle("chat:getClaudeCodeStatus", () =>
    getClaudeCodeConnectionStatus()
  );

  ipcMain.handle("chat:startClaudeCodeLogin", () => beginClaudeCodeLogin());

  ipcMain.handle("chat:awaitClaudeCodeLogin", () => awaitClaudeCodeLogin());

  ipcMain.handle("chat:submitClaudeCodeLoginCode", (_event, code: string) =>
    submitClaudeCodeLoginCode(code)
  );

  ipcMain.handle("chat:cancelClaudeCodeLogin", () => cancelClaudeCodeLogin());

  ipcMain.handle("chat:openClaudeCodeLoginUrl", () => openClaudeCodeLoginUrl());

  ipcMain.handle("chat:revokeClaudeCodeLogin", () => revokeClaudeCodeLogin());

  ipcMain.handle("chat:testClaudeCodeConnection", () =>
    testClaudeCodeConnection()
  );

  ipcMain.handle("chat:openClaudeCodeSetupGuide", () =>
    shell.openExternal("https://code.claude.com/docs/en/quickstart")
  );

  ipcMain.handle("chat:login", () => loginChat(mainWindow));

  ipcMain.handle("chat:logout", () => logoutChat());

  // Kicks off streaming; assistant text is pushed via chat:stream* events.
  ipcMain.handle(
    "chat:send",
    (_event, requestId: string, messages: ChatMessage[], unitSystem?: UnitSystem, sessionId?: string) =>
      streamConversationTurn(
        createWindowSink(mainWindow),
        requestId,
        messages,
        normalizeUnitSystem(unitSystem),
        typeof sessionId === "string" && sessionId ? sessionId : undefined
      )
  );
  ipcMain.handle("chat:planBriefs", (_event, artifactIds: string[]) => listConversationPlanBriefs(artifactIds));
  ipcMain.handle(
    "chat:updatePlanBrief",
    (_event, artifactId: string, request: import("./types").PlanBriefRequest) => editPlanBrief(artifactId, request)
  );
  ipcMain.handle("chat:conversationSettings", (_event, sessionId: string) =>
    getConversationSettings(sessionId)
  );
  ipcMain.handle("chat:setConversationSettings", (_event, settings: import("./types").ConversationSettings) =>
    setConversationSettings(settings)
  );

  ipcMain.handle("chat:cancel", (_event, requestId: string) =>
    cancelChat(requestId)
  );

  // The window hands over its live transcript, in-flight turn included: reading
  // it back from disk here would race the window's own saves. `entries` is
  // omitted only by the conversation menu, which can act on a thread the window
  // has never opened.
  ipcMain.handle(
    "chat:compactContext",
    (
      _event,
      sessionId: string,
      entries?: PersistedChatEntry[],
      options?: { force?: boolean }
    ) => compactChatSessionContext(sessionId, entries, options ?? {})
  );

  // Dev-build inspector. Plans and stops: no roll, no write, no provider call —
  // looking at the context must not change it or bill for the look.
  ipcMain.handle(
    "chat:inspectContext",
    (_event, sessionId: string, entries?: PersistedChatEntry[]) =>
      inspectChatSessionContext(sessionId, entries)
  );

  ipcMain.handle("chat:listSessions", (_event, provider: ChatProvider) =>
    listChatSessionsForProvider(provider)
  );

  ipcMain.handle("chat:getSession", (_event, sessionId: string) =>
    getChatSessionEntries(sessionId)
  );

  ipcMain.handle("chat:createSession", (_event, provider: ChatProvider) =>
    createChatSessionForProvider(provider)
  );

  ipcMain.handle(
    "chat:saveSession",
    (
      _event,
      sessionId: string,
      entries: PersistedChatEntry[],
      options?: SaveChatSessionOptions
    ) => saveChatSessionEntries(sessionId, entries, options)
  );

  ipcMain.handle(
    "chat:setSessionPinned",
    (_event, sessionId: string, pinned: boolean) =>
      setChatSessionPinnedById(sessionId, pinned)
  );

  ipcMain.handle("chat:deleteSession", (_event, sessionId: string) => {
    deleteChatSessionById(sessionId);
  });

  // Renaming leaves updatedAt alone. Nothing in the analysis feature calls
  // this any more — nothing in the analysis feature creates or titles a
  // conversation — but the
  // chat sidebar does, which is whose channel it was to begin with.
  ipcMain.handle(
    "chat:renameSession",
    (_event, sessionId: string, title: string) =>
      setChatSessionTitle(sessionId, title)
  );

  // ----- Coach analyses -----
  //
  // One analysis lives in one conversation, so every read here is either
  // "this conversation's analyses" or "this one analysis". There is no list
  // of all of them, because there is no screen that shows one.

  ipcMain.handle("analysis:listForSession", (_event, sessionId: string) =>
    listCoachAnalysisSummariesForSession(sessionId)
  );

  ipcMain.handle("analysis:get", (_event, analysisId: string) =>
    getCoachAnalysis(analysisId)
  );

  // Create answers with a result rather than throwing: the refusal codes are
  // UI copy, and an Error crossing IPC arrives with its `code` stripped.
  ipcMain.handle(
    "analysis:create",
    (_event, input: CoachAnalysisInput): CoachAnalysisCreateResult => {
      try {
        const analysis = createCoachAnalysis(input);
        emitAnalysisChanged(analysis);
        return { ok: true, analysis };
      } catch (error) {
        if (error instanceof CoachAnalysisError) {
          return { ok: false, code: error.code, message: error.message };
        }
        throw error;
      }
    }
  );

  // Every change goes out on the wire, so a surface showing the analysis — the
  // row in the conversation header, its own detail screen — follows the edit
  // instead of waiting for something unrelated to refresh it.
  ipcMain.handle(
    "analysis:update",
    (_event, analysisId: string, patch: CoachAnalysisPatch) => {
      const analysis = updateCoachAnalysis(analysisId, patch);
      // An edit against an id that no longer exists answers null and changed
      // nothing; there is no news in that.
      emitAnalysisChanged(analysis);
      return analysis;
    }
  );

  ipcMain.handle(
    "analysis:setEnabled",
    (_event, analysisId: string, enabled: boolean) => {
      const analysis = setCoachAnalysisEnabled(analysisId, enabled);
      emitAnalysisChanged(analysis);
      return analysis;
    }
  );

  ipcMain.handle("analysis:delete", (_event, analysisId: string) => {
    // Read before the delete: the push names the conversation it was in, and
    // after the row is gone there is nothing left to read that from.
    const analysis = getCoachAnalysis(analysisId);
    deleteCoachAnalysis(analysisId);
    if (analysis) {
      // Null is the whole point here: a surface cannot re-read an analysis
      // that is gone, so the push has to say so rather than leave it to a 404.
      emitAnalysisUpdate({
        analysisId,
        sessionId: analysis.sessionId,
        analysis: null
      });
    }
  });

  ipcMain.handle(
    "analysis:reorder",
    (_event, sessionId: string, analysisIds: string[]) =>
      reorderCoachAnalyses(sessionId, analysisIds)
  );

  ipcMain.handle("analysis:runNow", (_event, analysisId: string) =>
    runAnalysisNow(analysisId)
  );

  ipcMain.handle(
    "analysis:listRuns",
    (_event, filter?: CoachAnalysisRunQuery) =>
      listCoachAnalysisRuns(filter ?? {})
  );

  // Stop means the trigger, not the run it was pressed on: an activity
  // catch-up is a sequence of runs and stopping one used to leave the rest to
  // run (10). The run's own stream is still aborted — that is where the id
  // comes in.
  ipcMain.handle("analysis:cancelRun", (_event, runId: string) => {
    cancelAnalysisRun(runId);
  });

  // Section 10's pause: read on mount, then followed by push. The renderer
  // needs both because the trip usually happens with no window open at all —
  // a scheduled run finding COROS asking for a login code at 07:30.
  ipcMain.handle("analysis:getPause", () => getAnalysisPause());

  ipcMain.handle("analysis:resume", () => resumeAnalyses());

  // 13: what the analyses have cost this month, and the ceiling.
  ipcMain.handle("analysis:getSpend", () => getAnalysisSpend());

  ipcMain.handle(
    "analysis:setBudget",
    (_event, budget: number | null) => setAnalysisBudget(budget)
  );

  ipcMain.handle("analysis:markSeen", (_event, runIds: string[]) =>
    markCoachAnalysisRunsSeen(runIds)
  );

  ipcMain.handle("analysis:sessionAttention", () =>
    listCoachAnalysisSessionAttention()
  );

  ipcMain.handle(
    "analysis:markSessionSeen",
    (_event, sessionId: string) => markCoachAnalysisSessionSeen(sessionId)
  );

  ipcMain.handle("chatMcp:getStatus", () => getCorosMcpStatus());

  ipcMain.handle("chatMcp:connect", () => connectCorosMcp(mainWindow));

  ipcMain.handle("chatMcp:disconnect", () => disconnectCorosMcp());

  ipcMain.handle("chatMcp:listTools", () => listCorosMcpTools());

  // Generic MCP server registry.
  ipcMain.handle("mcp:listServers", () => listMcpServers());
  ipcMain.handle("mcp:addServer", (_event, input) => addMcpServer(input));
  ipcMain.handle("mcp:updateServer", async (_event, id: string, patch) => {
    const existing = getMcpServer(id);
    if (!existing) {
      throw new Error(`Unknown MCP server "${id}".`);
    }
    const updated = updateMcpServer(id, patch);
    const connectionChanged =
      updated.url !== existing.url ||
      updated.transport !== existing.transport ||
      updated.authType !== existing.authType ||
      updated.scope !== existing.scope;
    if (!updated.enabled || connectionChanged) {
      await disconnectMcpServer(id, {
        clearAuthorization: connectionChanged
      });
    }
    return updated;
  });
  ipcMain.handle("mcp:removeServer", async (_event, id: string) => {
    const existing = getMcpServer(id);
    if (!existing) return;
    if (existing.builtin) {
      removeMcpServer(id);
      return;
    }
    await disconnectMcpServer(id);
    removeMcpServer(id);
  });
  ipcMain.handle("mcp:connect", (_event, id: string) =>
    connectMcpServer(id, true, mainWindow)
  );
  ipcMain.handle("mcp:disconnect", async (_event, id: string) => {
    const server = getMcpServer(id);
    await disconnectMcpServer(id);
    if (server?.authType === "none") {
      updateMcpServer(id, { enabled: false });
    }
  });
  ipcMain.handle("mcp:statuses", () => getMcpStatuses());
  // Non-interactive reconnect of every enabled server from stored auth.
  // Never opens an OAuth window: the Coach view asks the athlete first,
  // then calls mcp:connect for the servers they chose to authorize.
  ipcMain.handle("mcp:ensureConnected", async () => {
    await ensureAllMcpConnected();
    return getMcpStatuses();
  });
  ipcMain.handle("mcp:setBearer", async (_event, id: string, token: string) => {
    setMcpBearer(id, token);
    await disconnectMcpServer(id, { clearAuthorization: false });
  });

  ipcMain.handle("chat:planDraftDocument", (_event, draftId: string) => getPlanDraftDocument(draftId));
  ipcMain.handle(
    "chat:editPlanDraft",
    (_event, draftId: string, plan: import("./types").TrainingPlanDocument, unitSystem?: UnitSystem, replaceNewer?: boolean) =>
      editPlanDraft(draftId, plan, normalizeUnitSystem(unitSystem), replaceNewer === true)
  );
  ipcMain.handle("chat:uploadPlanDraft", (_event, draftId: string, unitSystem?: UnitSystem, destination?: import("./types").TrainingPlanDestination, scheduleDate?: string, keepInLibrary?: boolean, options?: import("./types").PlanDraftSaveOptions) =>
    uploadTrainingPlanDraft(
      draftId,
      normalizeUnitSystem(unitSystem),
      destination,
      scheduleDate,
      keepInLibrary === true,
      options
    )
  );
  ipcMain.handle("chat:planArtifacts", (_event, draftIds: string[]) =>
    listPlanArtifactVersions(draftIds)
  );
  ipcMain.handle("chat:findDraftSession", (_event, draftId: string) => findChatSessionForDraft(draftId));
  ipcMain.handle("chat:planCalendarState", (_event, draftIds: string[]) =>
    listPlanCalendarStates(draftIds)
  );
  ipcMain.handle("chat:syncPlanFromCoros", (_event, draftId: string, unitSystem: UnitSystem, cacheOnly?: boolean) =>
    syncPlanFromCoros(draftId, normalizeUnitSystem(unitSystem), cacheOnly === true)
  );
  ipcMain.handle("chat:restorePlanVersion", (_event, draftId: string, unitSystem: UnitSystem) =>
    restorePlanVersion(draftId, normalizeUnitSystem(unitSystem))
  );
  ipcMain.handle("chat:removePlanDraft", (_event, draftId: string) =>
    removePlanDraft(draftId)
  );
  ipcMain.handle("chat:editWorkoutDraft", (_event, draftId: string, workout: import("./types").PlanWorkoutEntryInput, unitSystem?: UnitSystem, replaceNewer?: boolean) =>
    editWorkoutDraft(draftId, workout, normalizeUnitSystem(unitSystem), replaceNewer === true)
  );

  ipcMain.handle("chat:confirmWorkoutDelete", (_event, requestId: string) =>
    confirmWorkoutDelete(requestId)
  );

  ipcMain.handle(
    "trainingHub:uploadTrainingPlan",
    (_event, draft: CorosTrainingPlanDraftInput, unitSystem?: UnitSystem) =>
      uploadTrainingPlan(draft, normalizeUnitSystem(unitSystem))
  );

  ipcMain.handle("appleMusic:getStatus", () => getAppleMusicStatus());

  ipcMain.handle("appleMusic:saveAuth", (_event, headersRaw: string) =>
    saveAppleMusicAuth(headersRaw)
  );

  ipcMain.handle("appleMusic:logout", () => logoutAppleMusic());

  ipcMain.handle("appleMusic:resetBrowserSession", () =>
    resetAppleMusicBrowserSession()
  );

  ipcMain.handle("appleMusic:listPlaylists", () => listAppleMusicPlaylists());

  ipcMain.handle("appleMusic:fetchPlaylist", (_event, playlist: string) =>
    fetchAppleMusicPlaylist(playlist)
  );

  ipcMain.handle("applePodcasts:search", (_event, query: string) =>
    searchApplePodcasts(query)
  );

  ipcMain.handle("applePodcasts:load", (_event, showIdOrUrl: string, offset?: number) =>
    loadApplePodcast(showIdOrUrl, offset)
  );

  ipcMain.handle("spotify:getConfig", () => getSpotifyConfig());

  ipcMain.handle("spotify:saveConfig", (_event, config: SpotifyConfig) =>
    saveSpotifyConfig(config)
  );

  ipcMain.handle("spotify:getStatus", () => getSpotifyStatus());

  ipcMain.handle("spotify:login", () => loginSpotify(mainWindow));

  ipcMain.handle("spotify:logout", () => logoutSpotify());

  ipcMain.handle("spotify:listPlaylists", () => listSpotifyPlaylists());

  ipcMain.handle("spotify:listPlaylistTracks", (_event, playlistId: string) =>
    listSpotifyPlaylistTracks(playlistId)
  );

  ipcMain.handle("spotify:listSyncState", (_event, playlistId: string) =>
    listSpotifySyncState(playlistId)
  );

  ipcMain.handle(
    "spotify:syncPlaylist",
    (event, playlistId: string, autoTransfer: boolean) =>
      syncSpotifyPlaylist(playlistId, autoTransfer, (update) => {
        event.sender.send("spotify:syncUpdate", update);
      })
  );

  ipcMain.handle("trainingHub:getStatus", () => getTrainingHubStatus());

  ipcMain.handle(
    "trainingHub:login",
    async (_event, email: string, password: string, remember?: boolean) => {
      const result = await loginTrainingHub(email, password, remember);
      // Sync waits for an account. Re-checking here is what starts it the
      // moment there is one, instead of on the next launch. A login awaiting a
      // 2FA code is not signed in yet, so `verify2fa` carries the same call.
      if (result.status.authenticated) await resumeSyncForAccount();
      return result;
    }
  );

  ipcMain.handle("trainingHub:verify2fa", async (_event, code: string) => {
    const status = await verifyTrainingHubTwoFactor(code);
    if (status.authenticated) await resumeSyncForAccount();
    return status;
  });

  ipcMain.handle("trainingHub:resend2fa", () =>
    resendTrainingHubTwoFactorCode()
  );

  ipcMain.handle("trainingHub:cancel2fa", () =>
    cancelTrainingHubTwoFactor()
  );

  ipcMain.handle("trainingHub:logout", async () => {
    const status = logoutTrainingHub();
    // The cached nights belong to the account that just left.
    clearSleepHistoryCache();
    clearSleepSeriesCache();
    // Sync belongs to an account, so signing out has to stop it. Without this
    // the loop keeps publishing into the vault of the account that just left —
    // and anything done on this machine afterwards would land in their data.
    await prepareSync().catch((error) => {
      console.warn("[sync] could not re-check the vault after sign-out", error);
    });
    return status;
  });

  ipcMain.handle("trainingHub:reconnect", () => reconnectTrainingHub());

  ipcMain.handle(
    "trainingHub:getProfileSnapshot",
    (_event, options?: { refresh?: boolean }) =>
      getCorosProfileSnapshot(options)
  );

  ipcMain.handle(
    "trainingHub:updateProfile",
    (_event, patch: CorosProfilePatch) => updateCorosProfile(patch)
  );

  ipcMain.handle(
    "trainingHub:listActivities",
    (_event, page: number, size: number, startDay?: string, endDay?: string) =>
      listTrainingHubActivities(page, size, startDay, endDay)
  );

  ipcMain.handle(
    "trainingHub:listScheduledWorkouts",
    (_event, startDay: string, endDay: string) =>
      listScheduledWorkoutEntries(startDay, endDay)
  );

  ipcMain.handle("trainingHub:listLibraryWorkouts", () =>
    listLibraryWorkouts()
  );
  ipcMain.handle("trainingHub:refreshWorkoutCaches", () =>
    refreshWorkoutCaches()
  );
  ipcMain.handle(
    "trainingHub:duplicateLibraryWorkout",
    (_event, programId: string, name: string, targetSportType?: number) =>
      duplicateLibraryWorkout(programId, name, targetSportType)
  );

  ipcMain.handle("trainingLibrary:snapshot", () =>
    getTrainingLibrarySnapshot()
  );
  ipcMain.handle("trainingLibrary:getNativePlan", (_event, remoteId: string) =>
    getNativeTrainingPlan(remoteId)
  );
  ipcMain.handle("trainingLibrary:updatePlanMetadata", (_event, id: string, patch) =>
    updateTrainingPlanMetadata(id, patch)
  );
  ipcMain.handle("trainingLibrary:savePlan", (_event, request) => savePlanToCoros(request));
  // Streams its progress on the chat:stream* channels; stopped with chat:cancel.
  ipcMain.handle(
    "trainingLibrary:generatePlan",
    (_event, requestId: string, request: TrainingPlanGenerationRequest, unitSystem?: UnitSystem) =>
      generateTrainingPlan(createWindowSink(mainWindow), requestId, request, {
        unitSystem: normalizeUnitSystem(unitSystem)
      })
  );
  // The plan's shape before its sessions; the same streams, the same cancel.
  ipcMain.handle(
    "trainingLibrary:outlinePlan",
    (
      _event,
      requestId: string,
      request: TrainingPlanGenerationRequest,
      unitSystem?: UnitSystem,
      revision?: TrainingPlanOutlineRevision
    ) =>
      outlineTrainingPlan(createWindowSink(mainWindow), requestId, request, {
        unitSystem: normalizeUnitSystem(unitSystem),
        ...(revision ? { revision } : {})
      })
  );
  ipcMain.handle("trainingLibrary:duplicatePlan", (_event, planId: string) =>
    duplicatePlanOnCoros(planId)
  );
  ipcMain.handle(
    "trainingLibrary:deletePlan",
    (_event, planId: string, confirmed: boolean, options?: { takeOffCalendar?: boolean }) =>
      deletePlanFromCoros(planId, confirmed, options)
  );
  ipcMain.handle("trainingLibrary:workouts", () => listTrainingLibraryWorkouts());
  ipcMain.handle("trainingLibrary:previewPlanCalendar", (_event, planId: string, startDay: string) =>
    previewPlanOnCalendar(planId, startDay)
  );
  ipcMain.handle("trainingLibrary:addPlanToCalendar", (_event, planId: string, startDay: string) =>
    putPlanOnCalendar(planId, startDay)
  );
  ipcMain.handle("trainingLibrary:removePlanFromCalendar", (_event, planId: string) =>
    takePlanOffCalendar(planId)
  );
  ipcMain.handle("trainingLibrary:syncPlanToCalendar", (_event, planId: string) =>
    syncPlanToCalendar(planId)
  );
  ipcMain.handle("trainingLibrary:saveDraft", (_event, draft) => savePlanDraft(draft));
  ipcMain.handle("trainingLibrary:deleteDraft", (_event, id: string) => discardPlanDraft(id));
  ipcMain.handle("trainingLibrary:librarySession", (_event, programId: string) =>
    libraryWorkoutAsPlanSession(programId)
  );
  ipcMain.handle(
    "trainingLibrary:updateWorkoutMetadata",
    (_event, programIds, patch) => updateWorkoutMetadata(programIds, patch)
  );
  ipcMain.handle("trainingLibrary:deleteWorkouts", (_event, request) =>
    deleteTrainingLibraryWorkouts(request)
  );
  ipcMain.handle(
    "trainingLibrary:refreshMatches",
    (_event, startDay: string, endDay: string) =>
      refreshTrainingActivityMatches(startDay, endDay)
  );
  ipcMain.handle("trainingLibrary:listMatches", () => listActivityMatches());
  ipcMain.handle("trainingLibrary:saveManualMatch", (_event, match) =>
    saveManualActivityMatch(match)
  );

  ipcMain.handle(
    "trainingHub:listWorkoutExercises",
    (_event, sport: WorkoutSport) => listWorkoutExercises(sport)
  );

  ipcMain.handle("trainingHub:getWorkoutEditorContext", (_event, unitSystem?: UnitSystem) =>
    getWorkoutEditorContext(normalizeUnitSystem(unitSystem))
  );

  ipcMain.handle(
    "trainingHub:getWorkoutForEdit",
    (_event, ref: WorkoutEditRef, unitSystem?: UnitSystem) =>
      getWorkoutForEdit(ref, normalizeUnitSystem(unitSystem))
  );

  ipcMain.handle(
    "trainingHub:previewWorkoutEdit",
    (
      _event,
      ref: WorkoutEditRef,
      revision: string,
      draft: RunWorkoutEditorDraft,
      unitSystem?: UnitSystem
    ) => previewWorkoutEdit(ref, revision, draft, normalizeUnitSystem(unitSystem))
  );

  ipcMain.handle(
    "trainingHub:saveWorkoutEdit",
    (
      _event,
      ref: WorkoutEditRef,
      revision: string,
      draft: RunWorkoutEditorDraft,
      unitSystem?: UnitSystem
    ) => saveWorkoutEdit(ref, revision, draft, normalizeUnitSystem(unitSystem))
  );

  ipcMain.handle(
    "trainingHub:scheduleLibraryWorkout",
    (_event, programId: string, happenDay: string) =>
      scheduleLibraryWorkout(programId, happenDay)
  );

  ipcMain.handle(
    "trainingHub:createAndScheduleWorkout",
    (
      _event,
      entry: PlanWorkoutEntryInput,
      happenDay: string,
      unitSystem?: UnitSystem | boolean,
      saveToLibrary?: boolean
    ) =>
      createAndScheduleWorkout(
        entry,
        happenDay,
        typeof unitSystem === "boolean"
          ? unitSystem
          : normalizeUnitSystem(unitSystem),
        saveToLibrary
      )
  );

  ipcMain.handle(
    "trainingHub:createLibraryWorkout",
    (_event, entry: PlanWorkoutEntryInput, unitSystem?: UnitSystem) =>
      createLibraryWorkout(entry, normalizeUnitSystem(unitSystem))
  );

  ipcMain.handle(
    "trainingHub:rescheduleWorkout",
    (
      _event,
      entry: {
        planId: string;
        idInPlan: string;
        planProgramId?: string;
        happenDay: string;
      },
      newHappenDay: string
    ) => rescheduleScheduledWorkout(entry, newHappenDay)
  );

  ipcMain.handle(
    "trainingHub:removeScheduledWorkout",
    (
      _event,
      entry: {
        planId: string;
        idInPlan: string;
        planProgramId?: string;
        pbVersion?: number;
      }
    ) => removeScheduledWorkout(entry)
  );

  ipcMain.handle(
    "trainingHub:getActivityDetail",
    (
      _event,
      activityId: string,
      sportType: number,
      listActivity?: TrainingHubActivity
    ) => getTrainingHubActivityDetail(activityId, sportType, listActivity)
  );

  // The unparsed payload, on its own channel: it is ~2.2 MB and only the
  // development build's raw-JSON modal asks for it.
  ipcMain.handle(
    "trainingHub:getActivityDetailRaw",
    (_event, activityId: string, sportType: number) =>
      getTrainingHubActivityDetailRaw(activityId, sportType)
  );

  // The list-level figures that only a detail payload knows. Two channels
  // rather than one: a read that answers from SQLite in a millisecond, and a
  // sweep that goes to COROS and is meant to be called again until it reports
  // nothing left.
  // The cached end-of-activity feeling per activity, straight out of SQLite.
  // Only activities COROS has actually been asked about appear; see
  // `readTrainingActivityFeelTypes` for why that matters.
  ipcMain.handle(
    "trainingHub:getActivityFeelTypes",
    (_event, activityIds: string[]) =>
      readTrainingActivityFeelTypes(activityIds)
  );

  ipcMain.handle(
    "trainingHub:getActivityDetailSummaries",
    (_event, activityIds: string[]) => readActivityDetailSummaries(activityIds)
  );

  ipcMain.handle(
    "trainingHub:syncActivityDetailSummaries",
    (_event, activityIds: string[], limit?: number) =>
      syncActivityDetailSummaries(activityIds, limit)
  );

  ipcMain.handle(
    "trainingHub:exportActivityFile",
    async (
      _event,
      activityId: string,
      sportType: number,
      fileType: TrainingHubActivityFileType,
      suggestedName?: string
    ): Promise<TrainingHubExportResult> => {
      return exportTrainingHubActivityFileToDisk(
        { activityId, sportType },
        fileType,
        suggestedName
      );
    }
  );

  ipcMain.handle(
    "trainingHub:exportLatestActivityFile",
    async (
      _event,
      fileType: TrainingHubActivityFileType = 4
    ): Promise<TrainingHubExportResult> => {
      const latest = pickLatestTrainingHubActivity(
        await listTrainingHubActivities(1, 50)
      );
      if (!latest) {
        throw new Error("No COROS activities were found to export.");
      }
      return exportTrainingHubActivityFileToDisk(latest, fileType, latest.name);
    }
  );

  ipcMain.handle("trainingHub:chooseBackupFolder", async () => {
    const options: Electron.OpenDialogOptions = {
      title: "Choose a backup folder",
      properties: ["openDirectory", "createDirectory"]
    };
    const result =
      mainWindow && !mainWindow.isDestroyed()
        ? await dialog.showOpenDialog(mainWindow, options)
        : await dialog.showOpenDialog(options);
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  ipcMain.handle(
    "trainingHub:startActivityBackup",
    (_event, folder: string, fileType: TrainingHubActivityFileType = 4) =>
      startActivityBackup(folder, fileType)
  );

  ipcMain.handle("trainingHub:cancelActivityBackup", () =>
    cancelActivityBackup()
  );

  ipcMain.handle("trainingHub:getActivityBackupProgress", () =>
    getActivityBackupProgress()
  );

  ipcMain.handle("trainingHub:getTrainingAnalytics", () =>
    getTrainingAnalytics()
  );

  ipcMain.handle("trainingHub:getRacePredictor", () => getRacePredictor());

  ipcMain.handle("trainingHub:startRpeBackfill", () => {
    void backfillFeelTypes();
  });
  ipcMain.handle("trainingHub:getRpeBackfillStatus", () =>
    getRpeBackfillStatus()
  );
  ipcMain.handle("trainingHub:getRpeLoadByDay", () => getRpeLoadByDay());

  ipcMain.handle("trainingHub:getDashboard", () => getTrainingDashboard());

  ipcMain.handle("trainingHub:getDailyMetrics", (_event, dateList: string[]) =>
    getDailyMetrics(dateList)
  );

  ipcMain.handle(
    "trainingHub:syncStrengthHistory",
    (_event, request?: StrengthHistoryRequest) => syncStrengthHistory(request)
  );

  ipcMain.handle("hevy:getStatus", () => getHevyStatus());
  ipcMain.handle("hevy:connect", (_event, apiKey: string) => connectHevy(apiKey));
  ipcMain.handle("hevy:updateSettings", (_event, input: HevySettingsInput) =>
    updateHevySettings(input)
  );
  ipcMain.handle("hevy:disconnect", () => disconnectHevy());

  ipcMain.handle("trainingHub:getSportTypeMap", () => getSportTypeMap());

  ipcMain.handle("trainingHub:getUpcomingWorkouts", (_event, days?: number) =>
    getUpcomingWorkouts(days)
  );

  // Through the cache, not straight at COROS: one sleep fetch is ~20 sequential
  // MCP round trips, and the Overview asks on every launch.
  ipcMain.handle("trainingHub:getSleepData", (_event, days?: number) =>
    getCachedSleepSummary(days ?? 7)
  );

  ipcMain.handle(
    "sleep:getHistory",
    (_event, request?: { days?: number; refresh?: boolean }) =>
      getSleepHistory(request ?? {})
  );

  // Both series for one night arrive together: they are drawn on one pair of
  // axes, clipped to one window, and cached as one row.
  ipcMain.handle(
    "sleep:getNightSeries",
    (_event, request: { happenDay: string; refresh?: boolean }) =>
      getSleepNightSeries(request)
  );

  ipcMain.handle("trainingHub:getDailyHealthData", (_event, days?: number) =>
    getTrainingDailyHealthData(days ?? 1)
  );

  ipcMain.handle("intervals:getStatus", () => getIntervalsStatus());

  ipcMain.handle("intervals:connect", (_event, apiKey: string, athleteId: string) =>
    connectIntervals(apiKey, athleteId)
  );

  ipcMain.handle("intervals:disconnect", () => disconnectIntervals());

  ipcMain.handle(
    "intervals:listMissing",
    async (_event, daysBack: number): Promise<IntervalsActivityWithStatus[]> => {
      const intervals = await listIntervalsActivities(daysBack);
      // Pull enough COROS activities to cover the SAME daysBack window used for
      // the intervals.icu query, not just the newest 200 — otherwise older
      // activities fall outside the compare set and are falsely reported as
      // "Missing". listTrainingHubActivities filters on startDay/endDay
      // (YYYYMMDD) and pages at `size` per call with no total count, so we
      // page through the window until a short page signals the end.
      // listIntervalsActivities computes its from/to bound in UTC
      // (toISOString), while formatYyyymmddDay/formatScheduleDay use local
      // calendar days (matching the COROS endpoint's convention). Pad the
      // COROS window by one extra day on each side so local/UTC boundary
      // drift can only widen the compare set (superset), never narrow it —
      // a superset can't cause a false "Missing".
      const toDay = formatYyyymmddDay(new Date(Date.now() + 86_400_000));
      const fromDay = formatYyyymmddDay(
        new Date(Date.now() - (daysBack + 1) * 86_400_000)
      );
      const corosRaw: TrainingHubActivity[] = [];
      const INTERVALS_MATCH_PAGE_SIZE = 100;
      const INTERVALS_MATCH_MAX_PAGES = 50;
      for (let page = 1; page <= INTERVALS_MATCH_MAX_PAGES; page += 1) {
        const pageActivities = await listTrainingHubActivities(
          page,
          INTERVALS_MATCH_PAGE_SIZE,
          fromDay,
          toDay
        );
        corosRaw.push(...pageActivities);
        if (pageActivities.length < INTERVALS_MATCH_PAGE_SIZE) {
          break;
        }
      }
      const coros = corosRaw.map((a) => ({
        startEpochMs: (a.startTime ?? 0) * 1000,
        // Elapsed, to match what parseIntervalsActivities reads on the other side.
        movingSec: a.elapsedDuration ?? a.duration ?? 0,
        distanceM: a.distance ?? 0
      }));
      const recentlyImported = getRecentlyImportedIds(RECENT_IMPORT_WINDOW_MS);
      return intervals.map((a) => ({
        ...a,
        onCoros:
          isAlreadyOnCoros(
            {
              startEpochMs: a.startEpochMs,
              movingSec: a.movingSec,
              distanceM: a.distanceM
            },
            coros
          ) || recentlyImported.has(a.intervalsId)
      }));
    }
  );

  ipcMain.handle(
    "intervals:import",
    async (
      _event,
      intervalsId: string,
      fileExt: "fit" | "tcx" | "unknown"
    ): Promise<{ importId: string }> => {
      const tmpExt = fileExt === "tcx" ? "tcx" : "fit";
      const tmp = path.join(
        os.tmpdir(),
        `coroslink-intervals-${intervalsId}.${tmpExt}`
      );
      try {
        await downloadIntervalsFit(intervalsId, tmp);
        const result = await uploadActivityFitToCoros(tmp);
        recordIntervalsImport(intervalsId);
        return result;
      } finally {
        try {
          fs.rmSync(tmp);
        } catch {
          /* best effort */
        }
      }
    }
  );

  ipcMain.handle(
    "coros:addManualActivity",
    async (_event, input: ManualActivityInput): Promise<{ importId: string }> => {
      if (!Number.isFinite(input.durationSec) || !(input.durationSec > 0)) {
        throw new Error("Duration must be a finite number greater than 0.");
      }
      if (Number.isNaN(Date.parse(input.startTimeIso))) {
        throw new Error("Invalid start time.");
      }
      const toFiniteNonNegative = (value: unknown): number => {
        const n = Number(value);
        return Number.isFinite(n) && n > 0 ? n : 0;
      };
      const sanitized: ManualActivityInput = {
        ...input,
        distanceM: toFiniteNonNegative(input.distanceM),
        calories: toFiniteNonNegative(input.calories),
        avgHr:
          input.avgHr != null && Number.isFinite(Number(input.avgHr)) && Number(input.avgHr) > 0
            ? Number(input.avgHr)
            : undefined
      };
      const tcx = buildManualTcx(sanitized);
      const tmp = path.join(
        os.tmpdir(),
        `coroslink-manual-${Date.now()}.tcx`
      );
      fs.writeFileSync(tmp, tcx, "utf8");
      try {
        return await uploadActivityFitToCoros(tmp);
      } finally {
        try {
          fs.rmSync(tmp);
        } catch {
          /* best effort */
        }
      }
    }
  );

  // "Where you've been" turns a cluster of visit coordinates into a place
  // name. The renderer caches the answers, so this is asked rarely and only
  // about somewhere the athlete has actually trained.
  ipcMain.handle("places:reverseGeocode", (_event, lat: number, lon: number) =>
    reverseGeocodeLocation(lat, lon)
  );

  ipcMain.handle("app:getUpdateStatus", () => getAppUpdateSnapshot());

  ipcMain.handle("app:checkForUpdates", () => checkForAppUpdates());

  ipcMain.handle("app:downloadUpdate", () => downloadAppUpdate());

  ipcMain.handle(
    "app:setUpdatePreferences",
    (_event, prefs: { autoCheck?: boolean; autoDownload?: boolean }) =>
      setUpdaterPreferences(prefs)
  );

  ipcMain.handle("app:quitAndInstallUpdate", () => quitAndInstallUpdate());

  /**
   * The renderer saying it has attached its IPC listeners.
   *
   * Everything main pushes without being asked — merged sync writes, a COROS
   * session that came back on its own — waits for this, because `send` before
   * the listeners exist reaches nobody and there is only one copy of what it
   * carries. `did-finish-load` cannot stand in: the page having loaded says
   * nothing about whether React has subscribed yet.
   *
   * This used to ride along on a call the renderer only made on a development
   * build — so no packaged build ever set the flag, and every one of those
   * pushes was dropped for the life of the process. A start-up re-login would
   * mint a session the renderer never heard about, leaving it on whatever it
   * read at mount: no data, no sign-in form, and nothing to do but restart.
   * Keep this on a channel of its own, and keep it out of any
   * build-conditional code path.
   */
  ipcMain.handle("app:rendererReady", () => {
    markRendererReady();
  });

  ipcMain.handle("app:getInfo", () => getAppInfo());

  ipcMain.handle("app:openStorageLocation", (_event, id: string) =>
    openAppStorageLocation(id)
  );

  // ----- Sync -----
  //
  // localStorage lives in the renderer, so it travels as an argument on the way
  // out and as a return value on the way back: the main process never reaches
  // into the window to read it.

  ipcMain.handle("sync:chooseFolder", async () => {
    const options: OpenDialogOptions = {
      title: "Choose a folder for your sync vault",
      properties: ["openDirectory", "createDirectory"]
    };
    const result =
      mainWindow && !mainWindow.isDestroyed()
        ? await dialog.showOpenDialog(mainWindow, options)
        : await dialog.showOpenDialog(options);
    if (result.canceled) return null;
    const folder = result.filePaths[0] ?? null;
    if (folder) {
      syncService().setFolder(folder);
      // Choosing the folder is the whole setup for a folder vault, so it is
      // ready by the time this returns rather than after a second click.
      await prepareSync();
    }
    return folder;
  });

  // Two halves, joined here: the destination is the service's to answer, the
  // change loop is this file's. Neither knows about the other, which is why
  // `SyncService` can be exercised without one running.
  ipcMain.handle("sync:getStatus", async () => ({
    ...(await syncService().status()),
    loop: syncLoopStatus()
  }));

  ipcMain.handle("sync:prepare", () => prepareSync());

  // --- Backup and restore ----------------------------------------------------
  //
  // A file, not a vault. The dialogs live here rather than in the service so
  // that `electron/backup/` stays testable without an Electron window: the
  // service takes a path and does the work, and choosing the path is the one
  // part that needs a window.

  ipcMain.handle(
    "backup:export",
    async (_event, localStorage: Record<string, string>) => {
      // Asked before the dialog opens. A backup belongs to an account, and
      // bouncing someone out of a save dialog they have already navigated is a
      // worse way to say so than not opening it.
      requireBackupAccount("saving a backup");

      const saveOptions = {
        title: "Save a backup of your data",
        defaultPath: defaultBackupFileName(),
        filters: [
          { name: "Heracles Records backup", extensions: [BACKUP_EXTENSION] }
        ]
      };
      const chosen =
        mainWindow && !mainWindow.isDestroyed()
          ? await dialog.showSaveDialog(mainWindow, saveOptions)
          : await dialog.showSaveDialog(saveOptions);
      if (chosen.canceled || !chosen.filePath) return null;

      return writeBackupFile(chosen.filePath, {
        deviceId: syncDeviceId(),
        localStorage: localStorage ?? {}
      });
    }
  );

  // Choosing a file and restoring it are two calls on purpose. Between them the
  // person is answering a question about what to do with the data already here,
  // and a single call would have to either ask on their behalf or write before
  // they had answered.
  ipcMain.handle("backup:choose", async () => {
    requireBackupAccount("restoring a backup");

    const options: OpenDialogOptions = {
      title: "Choose a backup to restore",
      properties: ["openFile"],
      // `.json` too: backups written before the file was sealed are plain JSON,
      // and they still restore.
      filters: [
        {
          name: "Heracles Records backup",
          extensions: [...BACKUP_OPEN_EXTENSIONS]
        }
      ]
    };
    const chosen =
      mainWindow && !mainWindow.isDestroyed()
        ? await dialog.showOpenDialog(mainWindow, options)
        : await dialog.showOpenDialog(options);
    const filePath = chosen.filePaths[0];
    if (chosen.canceled || !filePath) return null;
    return inspectBackupFile(filePath);
  });

  ipcMain.handle(
    "backup:restore",
    async (
      _event,
      filePath: string,
      mode: RestoreMode,
      allowOtherOwner?: boolean
    ) => {
      // Taken before the write, because it is the only record of what this
      // machine held: a `replace` restore removes rows, so afterwards there is
      // nothing left to say which ones went. `republishAfterRestore` turns the
      // difference into tombstones for the other machines.
      const before = captureSyncableState();
      const result = await restoreBackupFile(filePath, mode, {
        allowOtherOwner
      });

      // A restore rewrites the MCP server list under a running app, and the
      // clients held open are for the rows it just replaced. The panel still
      // says to restart — plenty of state is read once at startup — but a
      // server that the restore removed would otherwise keep a live connection
      // with no row behind it, which reads as a restore that did not work.
      //
      // Nothing is done about the COROS session on purpose: a backup carries no
      // credential, so a restore cannot have changed it.
      void reconnectAllMcpServers().catch((error) => {
        console.warn(
          "[backup] could not reconnect MCP servers after a restore",
          error
        );
      });

      // Tell the other machines, when this one is syncing. Without it the
      // restore is invisible to them, and the log they still hold would be
      // replayed back over it here.
      void republishAfterRestore(before);
      return result;
    }
  );

  ipcMain.handle("sync:setBackend", async (_event, backend: "local" | "google") => {
    // A different backend is a different vault, so the loop must not keep
    // writing into the old one.
    stopSyncLoop();
    syncService().setBackend(backend);
    // Not returned: the renderer reads the new state from `sync:getStatus` like
    // every other row, and this channel stays void on all three sides.
    await prepareSync();
  });

  // The deliberate answer to `wrong-owner`. Claiming clears the seed flag, so
  // the loop that starts afterwards publishes this account's whole state into
  // the vault rather than assuming it is already there.
  ipcMain.handle("sync:claimVault", async () => {
    stopSyncLoop();
    await syncService().claimVault();
    return prepareSync();
  });

  ipcMain.handle("sync:googleAccount", () => googleOAuth().account());

  ipcMain.handle("sync:connectGoogle", async () => {
    await googleOAuth().connect();
    // Signing in is the whole setup, so the Drive folder is there by the time
    // the browser tab closes rather than after another click.
    await prepareSync();
  });

  ipcMain.handle("sync:disconnectGoogle", () => {
    // The loop would otherwise keep writing through a provider whose token has
    // just been thrown away.
    stopSyncLoop();
    googleOAuth().disconnect();
  });

  ipcMain.handle("sync:syncNow", async () => {
    // Through `prepareSync`, not `startSyncLoop` directly: only `prepare()`
    // reads whose vault this is, and starting a loop that skipped that check
    // would merge two accounts' records into one log — which nothing can
    // separate again.
    await prepareSync();
    const loop = syncLoopInstance;
    if (!loop) return { pushed: 0, applied: 0 };

    // A seed that failed at launch gets another go here. "Sync now" is what a
    // person reaches for when something looks wrong, and the panel points them
    // at it — retrying only the incremental half would leave the machine's
    // history behind while reporting success.
    if (syncSeedStatus.state === "failed") {
      await seedVaultIfNeeded(loop, syncService());
    }

    const flushed = await loop.flush();
    const pulled = await loop.pull();
    return { pushed: flushed.pushed, applied: pulled.applied };
  });

  // The renderer's preferences on their way out. It hands over everything
  // policy allows and the main process works out what moved; see
  // `localStorageSync.ts` for why the comparison lives here rather than a hook
  // on each of the dozen places that write one.
  ipcMain.handle(
    "sync:publishLocalStorage",
    (_event, entries: Record<string, string>) =>
      publishRendererLocalStorage(entries ?? {})
  );

  ipcMain.handle("sync:announcePresence", (_event, sessionId: string | null) =>
    // Whatever loop is already running. Presence must not be the thing that
    // starts one, because starting one here would bypass the ownership check.
    syncLoopInstance?.announce(sessionId) ?? Promise.resolve()
  );

  ipcMain.handle("sync:listPresence", () =>
    syncLoopInstance?.otherDevices() ?? Promise.resolve([])
  );

  ipcMain.handle(
    "sync:setGoogleClient",
    (_event, clientId: string | null, clientKey: string | null) =>
      googleOAuth().setOwnClient(
        clientId && clientKey ? { clientId, clientKey } : null
      )
  );
}
