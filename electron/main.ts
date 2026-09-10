import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
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
import { listLocalFontFamilies } from "./fontService";
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
  clearDownloadTransferredByFileName,
  deleteDownload,
  getDownloadById,
  hasAvailableDownloadForUrl,
  deleteSettings,
  getSetting,
  initializeDatabase,
  listDownloads,
  markDownloadTransferred,
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
  getActivityPaceBaselines,
  getDailyMetrics,
  getRacePredictor,
  getRpeBackfillStatus,
  getRpeLoadByDay,
  getSportTypeMap,
  getTrainingAnalytics,
  getTrainingDashboard,
  fetchTrainingHubActivityFile,
  getTrainingHubActivityDetail,
  getCorosProfileSnapshot,
  getTrainingHubStatus,
  getUpcomingWorkouts,
  listTrainingHubActivities,
  listScheduledWorkoutEntries,
  listLibraryWorkouts,
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
  UnitSystem,
  WorkoutSport
} from "./types";
import {
  addTrainingPlanToCalendar,
  deleteLocalTrainingPlan,
  deleteTrainingLibraryWorkouts,
  getNativeTrainingPlan,
  getTrainingLibrarySnapshot,
  refreshTrainingActivityMatches,
  previewTrainingPlanCalendar,
  previewTrainingPlanCalendarRemoval,
  removeTrainingPlanFromCalendar,
  removeTrainingCollection,
  saveLocalTrainingPlan,
  saveManualActivityMatch,
  updateWorkoutMetadata,
  updateTrainingPlanMetadata,
  upsertTrainingCollection
} from "./trainingLibraryService";
import { normalizeUnitSystem } from "./unitSystem.js";
import {
  cacheCorosWatchfaceProjectPreview,
  createCorosWatchfaceArchive,
  createCorosWatchfaceShareLink,
  duplicateCorosWatchfaceProject,
  describeCorosWatchfaceTemplate,
  downloadCorosWatchfaceTheme,
  exportCorosWatchfaceProject,
  exportCorosWatchfaceArchive,
  getCorosBatteryReport,
  getCorosWatchfaceStatus,
  importCorosWatchfaceShareLink,
  listCorosPairedDevices,
  listCorosWatchfaceThemes,
  loadCorosWatchfaceArtwork,
  loadCorosWatchfaceTemplateAssets,
  loadCorosWatchfaceTemplateConfigTexts,
  loadCorosWatchfaceProject,
  loginCorosWatchfaces,
  loginCorosWatchfacesWithSavedCredentials,
  logoutCorosWatchfaces,
  listCorosWatchfaceProjects,
  publishCorosWatchface,
  queryCorosGear,
  saveCorosGear,
  saveCorosWatchfaceProject,
  deleteCorosWatchfaceProject,
  selectCorosWatchfaceArchive
} from "./corosWatchfaceService";
import {
  cleanupCommunityWatchfaceImports,
  getCommunityWatchface,
  importCommunityWatchface,
  listCommunityWatchfaces,
  parseCommunityWatchfaceDeepLink,
  setCommunityWatchfaceProgressListener
} from "./communityWatchfaceService";
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
import { buildManualTcx } from "./tcxBuilder";
import {
  cancelCorosMapDownload,
  cancelCorosMapInstall,
  chooseCorosMapFolder,
  clearCorosMapDownloadJob,
  deleteCachedCorosMap,
  deleteGeneratedRoute,
  downloadCorosMapPackage,
  exportGeneratedRoute,
  generateRoute,
  geocodeRouteLocation,
  reverseGeocodeRouteLocation,
  getCorosMapInstallProgress,
  getCorosMapManifest,
  getRouteBuilderConfig,
  importRouteFromGpx,
  installCachedCorosMap,
  installCachedCorosMaps,
  installCorosMapFolder,
  listCachedCorosMaps,
  listCorosMapDownloadJobs,
  listGeneratedRoutes,
  openCorosMapDownload,
  routeWaypoints,
  saveDrawnRoute,
  saveRouteBuilderConfig,
  searchRouteLocations,
  setCorosMapDownloadListener,
  setCorosMapInstallProgressListener,
  toCorosMapInstallIpcError,
  validateRouteApiKey
} from "./mapService";
import { startRouteShare, stopRouteShare } from "./routeShareServer";
import type {
  CombinedDownloadResult,
  CorosMapPackage,
  DownloadJob,
  DownloadQueueItem,
  DrawnRoutePayload,
  GenerateRouteRequest,
  RouteActivityType,
  RouteBuilderConfig,
  RouteWaypointRequest,
  SpotifyConfig,
  TrainingHubActivity,
  TrainingHubActivityFileType,
  TrainingHubExportResult,
  WatchConnectionSmokeOptionId,
  YouTubeMusicConfig,
  IntervalsActivityWithStatus,
  ManualActivityInput
} from "./types";
import type {
  CorosLegacy614aCarrierPatchInput,
  CorosWatchfaceCreatorInput,
  CorosWatchfaceExistingShareInput,
  CorosWatchfaceProjectExportInput,
  CorosWatchfaceArchiveExportInput,
  CorosWatchfacePublishInput,
  CorosWatchfaceRasterFontFolder,
  CorosWatchfaceRegion,
  CorosWatchfaceThemeDownloadInput,
  CorosWatchfaceThemeListInput,
  CorosBatteryQueryInput,
  CorosGearSaveInput,
  CorosBluetoothDeviceChoice,
  WatchTransferProgress
} from "./types";
import type { CommunityWatchfaceOpenRequest } from "./types";
import {
  MULTIDATA_ELEV_416_PROFILE,
  inspectLegacy614aCarrier,
  patchLegacy614aFeatures
} from "./legacy614a";
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
import { getChatSessionTitle, setChatSessionTitle } from "./chatHistoryStore";
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
  streamChat,
  testClaudeCodeConnection,
  testAnthropicApiConnection,
  testLocalChatConnection,
  testOpenRouterConnection,
  uploadTrainingPlanDraft,
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
  hydratePlanDraftStoreFromDatabase,
  pruneDeleteRequestStore,
  prunePlanDraftStore
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
import { getTrainingSleepData } from "./sleepDataService";
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
let pendingCommunityWatchfaceOpen: CommunityWatchfaceOpenRequest | undefined;
let pendingCorosBluetoothSelection:
  | {
      callback: (deviceId: string) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  | undefined;

const legacy614aCarrierSelections = new Map<string, { sourcePath: string }>();
const MAX_RASTER_FONT_SPRITE_FOLDER_BYTES = 12 * 1024 * 1024;

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

async function loadRasterFontSpriteFolder(
  folderPath: string
): Promise<CorosWatchfaceRasterFontFolder> {
  const sprites: CorosWatchfaceRasterFontFolder["sprites"] = [];
  let totalBytes = 0;

  async function walk(directoryPath: string, relativeDirectory = ""): Promise<void> {
    const entries = (await fs.promises.readdir(directoryPath, {
      withFileTypes: true
    })).sort((left, right) =>
      left.name.localeCompare(right.name, "en", {
        sensitivity: "base",
        numeric: true
      })
    );
    for (const entry of entries) {
      const absolutePath = path.join(directoryPath, entry.name);
      const relativePath = path.join(relativeDirectory, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath, relativePath);
        continue;
      }
      if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".png") {
        continue;
      }

      const image = await fs.promises.readFile(absolutePath);
      totalBytes += image.byteLength;
      if (totalBytes > MAX_RASTER_FONT_SPRITE_FOLDER_BYTES) {
        throw new Error("PNG sprite folders must be 12 MB or smaller.");
      }
      sprites.push({
        name: entry.name,
        relativePath,
        dataUrl: `data:image/png;base64,${image.toString("base64")}`,
        sizeBytes: image.byteLength
      });
    }
  }

  await walk(folderPath);
  if (sprites.length === 0) {
    throw new Error("The selected folder does not contain any PNG files.");
  }
  return { label: path.basename(folderPath), sprites };
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
  "geolocation",
  // Lets the renderer copy text (e.g. the Spotify Redirect URI) via
  // navigator.clipboard.writeText.
  "clipboard-sanitized-write"
]);

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

function configureCorosBluetoothSelection(window: BrowserWindow): void {
  // Electron does not provide a built-in Web Bluetooth chooser. A PACE Pro
  // does not reliably advertise its full name, so the renderer receives the
  // nearby-device list and lets the user explicitly choose the watch.
  window.webContents.on("select-bluetooth-device", (event, devices, callback) => {
    event.preventDefault();
    if (pendingCorosBluetoothSelection) {
      clearTimeout(pendingCorosBluetoothSelection.timeout);
    }
    const timeout = setTimeout(() => {
      const pending = pendingCorosBluetoothSelection;
      pendingCorosBluetoothSelection = undefined;
      pending?.callback("");
      if (!window.isDestroyed()) {
        window.webContents.send("watchfaces:bluetoothDevices", []);
      }
    }, 45_000);
    pendingCorosBluetoothSelection = { callback, timeout };
    const choices: CorosBluetoothDeviceChoice[] = devices.map((device) => ({
      deviceId: device.deviceId,
      deviceName: device.deviceName
    }));
    window.webContents.send("watchfaces:bluetoothDevices", choices);
  });
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
  configureCorosBluetoothSelection(mainWindow);

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

function deepLinkFromArguments(argumentsList: string[]): CommunityWatchfaceOpenRequest | null {
  for (const argument of argumentsList) {
    const request = parseCommunityWatchfaceDeepLink(argument);
    if (request) return request;
  }
  return null;
}

function handleCommunityWatchfaceOpen(request: CommunityWatchfaceOpenRequest): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    if (rendererReady) {
      mainWindow.webContents.send("watchfaces:communityOpenRequested", request);
      return;
    }
  }
  pendingCommunityWatchfaceOpen = request;
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  const initialDeepLink = deepLinkFromArguments(process.argv);
  if (initialDeepLink) pendingCommunityWatchfaceOpen = initialDeepLink;
  app.on("second-instance", (_event, commandLine) => {
    const request = deepLinkFromArguments(commandLine);
    if (request) handleCommunityWatchfaceOpen(request);
    else if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
  app.on("open-url", (event, url) => {
    event.preventDefault();
    const request = parseCommunityWatchfaceDeepLink(url);
    if (request) handleCommunityWatchfaceOpen(request);
  });
}

app.whenReady().then(() => {
  if (!hasSingleInstanceLock) return;
  if (process.defaultApp && process.argv[1]) {
    app.setAsDefaultProtocolClient("coroslink", process.execPath, [
      path.resolve(process.argv[1])
    ]);
  } else {
    app.setAsDefaultProtocolClient("coroslink");
  }
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
  hydratePlanDraftStoreFromDatabase();
  prunePlanDraftStore();
  pruneDeleteRequestStore();
  registerIpcHandlers();
  setJobListener((jobs) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("youtube:jobsUpdate", jobs);
    }
  });
  setCorosMapDownloadListener((jobs) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("maps:downloadJobsUpdate", jobs);
    }
  });
  setCorosMapInstallProgressListener((progress) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("maps:installProgressUpdate", progress);
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
  setCommunityWatchfaceProgressListener((progress) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("watchfaces:communityDownloadProgress", progress);
    }
  });
  void cleanupCommunityWatchfaceImports();
  createWindow();
  applyAppIcon();

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

app.on("before-quit", () => {
  stopRouteShare();
  stopCoachActivityWatcher();
  stopCoachAnalysisScheduler();
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

  ipcMain.handle("watchfaces:getStatus", () => getCorosWatchfaceStatus());

  // Font names are host-local metadata only. Glyph rendering remains in the
  // renderer, where they are baked into the watchface's PNG sprites.
  ipcMain.handle("watchfaces:listLocalFontFamilies", () => listLocalFontFamilies());

  ipcMain.handle(
    "watchfaces:login",
    (
      _event,
      email: string,
      password: string,
      region?: CorosWatchfaceRegion,
      remember?: boolean
    ) => loginCorosWatchfaces(email, password, region, remember)
  );

  ipcMain.handle(
    "watchfaces:loginSaved",
    (_event, region?: CorosWatchfaceRegion) =>
      loginCorosWatchfacesWithSavedCredentials(region)
  );

  ipcMain.handle("watchfaces:logout", () => logoutCorosWatchfaces());

  ipcMain.handle("watchfaces:listPairedDevices", () => listCorosPairedDevices());
  ipcMain.handle(
    "watchfaces:selectBluetoothDevice",
    (_event, deviceId: string) => {
      const pending = pendingCorosBluetoothSelection;
      pendingCorosBluetoothSelection = undefined;
      if (!pending) {
        throw new Error("There is no active Bluetooth device scan.");
      }
      clearTimeout(pending.timeout);
      pending.callback(deviceId);
    }
  );
  ipcMain.handle("watchfaces:cancelBluetoothDevice", () => {
    const pending = pendingCorosBluetoothSelection;
    pendingCorosBluetoothSelection = undefined;
    if (pending) {
      clearTimeout(pending.timeout);
      pending.callback("");
    }
  });

  ipcMain.handle(
    "watchfaces:getBatteryReport",
    (_event, input: CorosBatteryQueryInput) => getCorosBatteryReport(input)
  );

  if (!app.isPackaged) {
    ipcMain.handle("gear:query", () => queryCorosGear());
    ipcMain.handle(
      "gear:save",
      (_event, input: CorosGearSaveInput) => saveCorosGear(input)
    );
  }

  ipcMain.handle(
    "watchfaces:listThemes",
    (_event, input: CorosWatchfaceThemeListInput) => listCorosWatchfaceThemes(input)
  );

  ipcMain.handle(
    "watchfaces:downloadTheme",
    (_event, input: CorosWatchfaceThemeDownloadInput) =>
      downloadCorosWatchfaceTheme(input)
  );

  ipcMain.handle("watchfaces:importShareLink", (_event, shareUrl: string) =>
    importCorosWatchfaceShareLink(shareUrl)
  );

  ipcMain.handle("watchfaces:listCommunity", (_event, input) =>
    listCommunityWatchfaces(input)
  );
  ipcMain.handle("watchfaces:getCommunity", (_event, slug: string) =>
    getCommunityWatchface(slug)
  );
  ipcMain.handle("watchfaces:importCommunity", (_event, slug: string) =>
    importCommunityWatchface(slug)
  );
  ipcMain.handle("watchfaces:consumeCommunityOpenRequest", () => {
    const request = pendingCommunityWatchfaceOpen ?? null;
    pendingCommunityWatchfaceOpen = undefined;
    return request;
  });

  ipcMain.handle("watchfaces:chooseArchive", async () => {
    const options: OpenDialogOptions = {
      title: "Choose a COROS custom watchface archive",
      properties: ["openFile"],
      filters: [
        {
          name: "Watchface archive",
          extensions: ["zip", "dat"]
        }
      ]
    };
    const result =
      mainWindow && !mainWindow.isDestroyed()
        ? await dialog.showOpenDialog(mainWindow, options)
        : await dialog.showOpenDialog(options);
    const archivePath = result.filePaths[0];
    return result.canceled || !archivePath
      ? null
      : selectCorosWatchfaceArchive(archivePath);
  });

  ipcMain.handle("watchfaces:chooseLegacy614aCarrier", async () => {
    const options: OpenDialogOptions = {
      title: "Choose the original MULTIDATA ELEV legacy carrier",
      properties: ["openFile"],
      filters: [{ name: "COROS legacy watchface BIN", extensions: ["bin"] }]
    };
    const result =
      mainWindow && !mainWindow.isDestroyed()
        ? await dialog.showOpenDialog(mainWindow, options)
        : await dialog.showOpenDialog(options);
    const sourcePath = result.filePaths[0];
    if (result.canceled || !sourcePath) return null;

    const reference = await fs.promises.readFile(sourcePath);
    // This validates the exact file hash in addition to its 614A shape. A
    // previously patched carrier, another model, or a similar lookalike BIN
    // cannot become the base for another edit.
    const carrier = inspectLegacy614aCarrier(reference, MULTIDATA_ELEV_416_PROFILE);
    const selectionId = `legacy614a-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    legacy614aCarrierSelections.set(selectionId, { sourcePath });
    return {
      selectionId,
      inspection: {
        profile: "multidata-elev-416" as const,
        profileName: carrier.profileName,
        fileName: path.basename(sourcePath),
        watchFaceId: carrier.watchFaceId,
        sizeBytes: carrier.sizeBytes,
        payloadCrc16: carrier.payloadCrc16,
        fullFileCrc16: carrier.fullFileCrc16,
        weatherSpriteSize: carrier.weatherSpriteSize,
        weatherPosition: carrier.weatherPosition,
        temperatureRect: carrier.temperatureRect
      }
    };
  });

  ipcMain.handle(
    "watchfaces:exportLegacy614aCarrier",
    async (_event, selectionId: string, patch: CorosLegacy614aCarrierPatchInput) => {
      const selection = legacy614aCarrierSelections.get(selectionId);
      if (!selection) {
        throw new Error("Choose and validate the original MULTIDATA ELEV carrier again before exporting.");
      }
      const reference = await fs.promises.readFile(selection.sourcePath);
      const output = patchLegacy614aFeatures(reference, patch, MULTIDATA_ELEV_416_PROFILE);
      const saveOptions = {
        title: "Export guarded MULTIDATA carrier",
        defaultPath: "MULTIDATA-ELEV-SLENDER-614A.bin",
        filters: [{ name: "COROS legacy watchface BIN", extensions: ["bin"] }]
      };
      const result =
        mainWindow && !mainWindow.isDestroyed()
          ? await dialog.showSaveDialog(mainWindow, saveOptions)
          : await dialog.showSaveDialog(saveOptions);
      if (result.canceled || !result.filePath) {
        return { saved: false, watchFaceId: MULTIDATA_ELEV_416_PROFILE.watchFaceId };
      }
      // Never overwrite the downloaded public reference or another export by
      // mistake. The user can choose a fresh filename in the save dialog.
      await fs.promises.writeFile(result.filePath, output, { flag: "wx" });
      return {
        saved: true,
        filePath: result.filePath,
        watchFaceId: MULTIDATA_ELEV_416_PROFILE.watchFaceId
      };
    }
  );

  ipcMain.handle("watchfaces:chooseArtwork", async () => {
    const options: OpenDialogOptions = {
      title: "Choose watchface artwork",
      properties: ["openFile"],
      filters: [
        {
          name: "Images",
          extensions: ["png", "jpg", "jpeg", "webp"]
        }
      ]
    };
    const result =
      mainWindow && !mainWindow.isDestroyed()
        ? await dialog.showOpenDialog(mainWindow, options)
        : await dialog.showOpenDialog(options);
    const artworkPath = result.filePaths[0];
    return result.canceled || !artworkPath
      ? null
      : loadCorosWatchfaceArtwork(artworkPath);
  });

  ipcMain.handle("watchfaces:chooseRasterFontFolder", async () => {
    const options: OpenDialogOptions = {
      title: "Choose a PNG watchface sprite folder",
      properties: ["openDirectory"]
    };
    const result =
      mainWindow && !mainWindow.isDestroyed()
        ? await dialog.showOpenDialog(mainWindow, options)
        : await dialog.showOpenDialog(options);
    const folderPath = result.filePaths[0];
    return result.canceled || !folderPath
      ? null
      : loadRasterFontSpriteFolder(folderPath);
  });

  ipcMain.handle(
    "watchfaces:createArchive",
    (_event, input: CorosWatchfaceCreatorInput) =>
      createCorosWatchfaceArchive(input)
  );
  ipcMain.handle(
    "watchfaces:exportProject",
    async (_event, input: CorosWatchfaceProjectExportInput) => {
      const baseName =
        sanitizeExportFileName(input?.name) || "Heracles-Records-watch-face";
      const saveOptions = {
        title: "Export editable watch face for website",
        defaultPath: `${baseName}.zip`,
        filters: [{ name: "Watch-face ZIP archive", extensions: ["zip"] }]
      };
      const result =
        mainWindow && !mainWindow.isDestroyed()
          ? await dialog.showSaveDialog(mainWindow, saveOptions)
          : await dialog.showSaveDialog(saveOptions);
      if (result.canceled || !result.filePath) {
        return { saved: false };
      }
      const destinationPath = result.filePath.toLowerCase().endsWith(".zip")
        ? result.filePath
        : `${result.filePath}.zip`;
      await exportCorosWatchfaceProject(input, destinationPath);
      return { saved: true, filePath: destinationPath };
    }
  );
  ipcMain.handle(
    "watchfaces:exportArchive",
    async (_event, input: CorosWatchfaceArchiveExportInput) => {
      if (!input || typeof input.archiveId !== "string") {
        throw new Error("Build a final watch-face archive before exporting it.");
      }
      const baseName =
        sanitizeExportFileName(input.name) || "Heracles-Records-watch-face";
      const saveOptions = {
        title: "Export final watch-face ZIP",
        defaultPath: `${baseName}.zip`,
        filters: [{ name: "Final watch-face ZIP", extensions: ["zip"] }]
      };
      const result =
        mainWindow && !mainWindow.isDestroyed()
          ? await dialog.showSaveDialog(mainWindow, saveOptions)
          : await dialog.showSaveDialog(saveOptions);
      if (result.canceled || !result.filePath) return { saved: false };
      const destinationPath = result.filePath.toLowerCase().endsWith(".zip")
        ? result.filePath
        : `${result.filePath}.zip`;
      await exportCorosWatchfaceArchive(input.archiveId, destinationPath);
      return { saved: true, filePath: destinationPath };
    }
  );
  ipcMain.handle("watchfaces:listProjects", () => listCorosWatchfaceProjects());
  ipcMain.handle("watchfaces:saveProject", (_event, input) =>
    saveCorosWatchfaceProject(input)
  );
  ipcMain.handle("watchfaces:loadProject", (_event, projectId: string) =>
    loadCorosWatchfaceProject(projectId)
  );
  ipcMain.handle(
    "watchfaces:cacheProjectPreview",
    (_event, projectId: string, previewDataUrl: string) =>
      cacheCorosWatchfaceProjectPreview(projectId, previewDataUrl)
  );
  ipcMain.handle("watchfaces:duplicateProject", (_event, projectId: string) =>
    duplicateCorosWatchfaceProject(projectId)
  );
  ipcMain.handle("watchfaces:deleteProject", (_event, projectId: string) =>
    deleteCorosWatchfaceProject(projectId)
  );

  ipcMain.handle(
    "watchfaces:describeTemplate",
    (_event, archiveId: string) => describeCorosWatchfaceTemplate(archiveId)
  );

  ipcMain.handle(
    "watchfaces:loadTemplateAssets",
    (_event, archiveId: string, paths: string[]) =>
      loadCorosWatchfaceTemplateAssets(archiveId, paths)
  );

  ipcMain.handle(
    "watchfaces:loadTemplateConfigTexts",
    (_event, archiveId: string) =>
      loadCorosWatchfaceTemplateConfigTexts(archiveId)
  );

  ipcMain.handle(
    "watchfaces:publish",
    (_event, input: CorosWatchfacePublishInput) => publishCorosWatchface(input)
  );

  ipcMain.handle(
    "watchfaces:createShareLink",
    (_event, input: CorosWatchfaceExistingShareInput) =>
      createCorosWatchfaceShareLink(input)
  );

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
    (_event, requestId: string, messages: ChatMessage[], unitSystem?: UnitSystem) =>
      streamChat(createWindowSink(mainWindow), requestId, messages, {
        unitSystem: normalizeUnitSystem(unitSystem)
      })
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

  ipcMain.handle("chat:uploadPlanDraft", (_event, draftId: string, unitSystem?: UnitSystem, destination?: import("./types").TrainingPlanDestination, scheduleDate?: string) =>
    uploadTrainingPlanDraft(
      draftId,
      normalizeUnitSystem(unitSystem),
      destination,
      scheduleDate
    )
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
  ipcMain.handle("trainingLibrary:savePlan", (_event, plan) =>
    saveLocalTrainingPlan(plan)
  );
  ipcMain.handle("trainingLibrary:updatePlanMetadata", (_event, id, patch) =>
    updateTrainingPlanMetadata(id, patch)
  );
  ipcMain.handle(
    "trainingLibrary:deletePlan",
    (_event, id: string, confirmed: boolean) => deleteLocalTrainingPlan(id, confirmed)
  );
  ipcMain.handle(
    "trainingLibrary:previewPlanCalendar",
    (_event, planId: string, startDate: string) => previewTrainingPlanCalendar(planId, startDate)
  );
  ipcMain.handle(
    "trainingLibrary:addPlanToCalendar",
    (_event, previewId: string, confirmed: boolean, unitSystem?: UnitSystem) =>
      addTrainingPlanToCalendar(previewId, confirmed, normalizeUnitSystem(unitSystem))
  );
  ipcMain.handle(
    "trainingLibrary:previewPlanCalendarRemoval",
    (_event, planId: string) => previewTrainingPlanCalendarRemoval(planId)
  );
  ipcMain.handle(
    "trainingLibrary:removePlanFromCalendar",
    (_event, previewId: string, confirmed: boolean) => removeTrainingPlanFromCalendar(previewId, confirmed)
  );
  ipcMain.handle(
    "trainingLibrary:updateWorkoutMetadata",
    (_event, programIds, patch) => updateWorkoutMetadata(programIds, patch)
  );
  ipcMain.handle("trainingLibrary:saveCollection", (_event, collection) =>
    upsertTrainingCollection(collection)
  );
  ipcMain.handle(
    "trainingLibrary:deleteCollection",
    (_event, id: string, confirmed: boolean) => removeTrainingCollection(id, confirmed)
  );
  ipcMain.handle("trainingLibrary:deleteWorkouts", (_event, request) =>
    deleteTrainingLibraryWorkouts(request)
  );
  ipcMain.handle(
    "trainingLibrary:refreshMatches",
    (_event, startDay: string, endDay: string) =>
      refreshTrainingActivityMatches(startDay, endDay)
  );
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

  ipcMain.handle("trainingHub:getActivityPaceBaselines", () =>
    getActivityPaceBaselines()
  );

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
        movingSec: a.duration ?? 0,
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

  ipcMain.handle("maps:getCorosManifest", () => getCorosMapManifest());

  ipcMain.handle("maps:openCorosDownload", (_event, downloadUrl: string) =>
    openCorosMapDownload(downloadUrl)
  );

  ipcMain.handle("maps:downloadCorosPackage", (_event, pkg: CorosMapPackage) =>
    downloadCorosMapPackage(pkg)
  );

  ipcMain.handle("maps:listCorosMapDownloadJobs", () =>
    listCorosMapDownloadJobs()
  );

  ipcMain.handle("maps:cancelCorosMapDownload", (_event, id: string) =>
    cancelCorosMapDownload(id)
  );

  ipcMain.handle("maps:clearCorosMapDownloadJob", (_event, id: string) =>
    clearCorosMapDownloadJob(id)
  );

  ipcMain.handle("maps:listCachedCorosMaps", () => listCachedCorosMaps());

  ipcMain.handle("maps:getCorosMapInstallProgress", () =>
    getCorosMapInstallProgress()
  );

  ipcMain.handle("maps:cancelCorosMapInstall", () => cancelCorosMapInstall());

  ipcMain.handle("maps:installCachedCorosMap", async (_event, packageId: string) => {
    try {
      return await installCachedCorosMap(packageId);
    } catch (error) {
      throw toCorosMapInstallIpcError(error);
    }
  });

  ipcMain.handle(
    "maps:installCachedCorosMaps",
    async (_event, packageIds: string[]) => {
      try {
        return await installCachedCorosMaps(packageIds);
      } catch (error) {
        throw toCorosMapInstallIpcError(error);
      }
    }
  );

  ipcMain.handle("maps:deleteCachedCorosMap", (_event, packageId: string) =>
    deleteCachedCorosMap(packageId)
  );

  ipcMain.handle("maps:chooseCorosMapFolder", () => chooseCorosMapFolder());

  ipcMain.handle("maps:installCorosMapFolder", async (_event, sourcePath: string) => {
    try {
      return await installCorosMapFolder(sourcePath);
    } catch (error) {
      throw toCorosMapInstallIpcError(error);
    }
  });

  ipcMain.handle("maps:getRouteBuilderConfig", () => getRouteBuilderConfig());

  ipcMain.handle(
    "maps:saveRouteBuilderConfig",
    (_event, config: RouteBuilderConfig) => saveRouteBuilderConfig(config)
  );

  ipcMain.handle("maps:listGeneratedRoutes", () => listGeneratedRoutes());

  ipcMain.handle("maps:geocodeRouteLocation", (_event, query: string) =>
    geocodeRouteLocation(query)
  );

  ipcMain.handle("maps:searchRouteLocations", (_event, query: string) =>
    searchRouteLocations(query)
  );

  ipcMain.handle(
    "maps:reverseGeocodeRouteLocation",
    (_event, lat: number, lon: number) => reverseGeocodeRouteLocation(lat, lon)
  );

  ipcMain.handle("maps:generateRoute", (_event, request: GenerateRouteRequest) =>
    generateRoute(request)
  );

  ipcMain.handle(
    "maps:routeWaypoints",
    (_event, request: RouteWaypointRequest) => routeWaypoints(request)
  );

  ipcMain.handle(
    "maps:importRouteGpx",
    (_event, activityType?: RouteActivityType) =>
      importRouteFromGpx(activityType)
  );

  ipcMain.handle("maps:saveDrawnRoute", (_event, payload: DrawnRoutePayload) =>
    saveDrawnRoute(payload)
  );

  ipcMain.handle("maps:exportGeneratedRoute", (_event, id: string) =>
    exportGeneratedRoute(id)
  );

  ipcMain.handle("maps:deleteGeneratedRoute", (_event, id: string) =>
    deleteGeneratedRoute(id)
  );

  ipcMain.handle("maps:validateRouteApiKey", (_event, apiKey: string) =>
    validateRouteApiKey(apiKey)
  );

  ipcMain.handle("maps:startRouteShare", (_event, id: string) =>
    startRouteShare(id)
  );

  ipcMain.handle("maps:stopRouteShare", () => stopRouteShare());

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
   * This used to be announced from `watchfaces:consumeCommunityOpenRequest`,
   * which the renderer only calls on a development build — so no packaged build
   * ever set the flag, and every one of those pushes was dropped for the life of
   * the process. A start-up re-login would mint a session the renderer never
   * heard about, leaving it on whatever it read at mount: no data, no sign-in
   * form, and nothing to do but restart. Keep this on a channel of its own, and
   * keep it out of any build-conditional code path.
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
