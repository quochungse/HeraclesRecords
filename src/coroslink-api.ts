import type {
  GoogleAccountInfo,
  LocalStoragePublishResult,
  SyncBackend,
  SyncChangedEvent,
  SyncPresenceClaim,
  SyncStatus,
  SyncVaultState
} from "../electron/sync/syncTypes";
import type {
  BackupExportResult,
  BackupImportCandidate,
  RestoreMode,
  RestoreResult as BackupRestoreResult
} from "../electron/backup/backupTypes";
import type {
  ActivityBackupProgress,
  BinaryStatus,
  CoachAnalysisSessionAttention,
  CombinedDownloadProgressEvent,
  CombinedDownloadResult,
  CorosProfile,
  CorosProfilePatch,
  CorosProfileSnapshot,
  DownloadAudioResult,
  DownloadJob,
  DownloadQueueItem,
  LocalTrack,
  ReverseGeocodeResult,
  SaveChatSessionOptions,
  SpotifyConfig,
  SpotifyPlaylist,
  SpotifyPlaylistTrack,
  SpotifyStatus,
  SpotifySyncResult,
  SpotifySyncTrack,
  SpotifySyncUpdate,
  HevySettingsInput,
  HevyStatus,
  StrengthHistory,
  StrengthHistoryRequest,
  TrainingHubActivity,
  TrainingHubActivityDetail,
  TrainingHubActivityFileType,
  TrainingHubExportResult,
  TrainingHubAnalytics,
  TrainingHubDailyHealthSummary,
  TrainingHubDailyMetrics,
  TrainingHubDashboard,
  SleepHistorySnapshot,
  SleepNightSeries,
  TrainingHubSleepSummary,
  TrainingHubRacePredictor,
  TrainingHubSportType,
  TrainingHubStatus,
  TrainingHubLoginResult,
  TrainingHubUpcomingWorkout,
  TrainingHubScheduledWorkoutEntry,
  TrainingHubLibraryWorkout,
  TrainingActivityMatch,
  TrainingLibraryDeleteRequest,
  TrainingLibrarySnapshot,
  TrainingLibraryWorkout,
  TrainingPlanDocument,
  TrainingPlanGenerationRequest,
  TrainingPlanOutlineResult,
  TrainingPlanOutlineRevision,
  TrainingPlanGenerationResult,
  PlanDraftPreview,
  TrainingPlanCalendarPreview,
  TrainingPlanDraftRecord,
  TrainingPlanMetadata,
  TrainingPlanSaveRequest,
  TrainingPlanSaveResult,
  LibraryPlanSession,
  TrainingPlanDestination,
  TrainingPlanMetadataPatch,
  WorkoutMetadataPatch,
  UnitSystem,
  PlanWorkoutEntryInput,
  RunWorkoutEditorDraft,
  WorkoutEditPreview,
  WorkoutEditRef,
  WorkoutEditSaveResult,
  WorkoutEditorContext,
  WorkoutEditorDocument,
  WorkoutExerciseOption,
  WorkoutSport,
  TransferResult,
  AppInfo,
  AppUpdateSnapshot,
  WatchConnectionSmokeOptionId,
  WatchStatus,
  WatchTransferProgress,
  YouTubeHistoryEntry,
  YouTubeMusicAuthCapture,
  YouTubeMusicConfig,
  YouTubeMusicLibrary,
  YouTubeMusicStatus,
  YouTubeMusicSyncResult,
  AppleMusicPlaylist,
  AppleMusicStatus,
  ApplePodcastShow,
  ApplePodcastShowDetail,
  ChatAuthStatus,
  ChatContextCompaction,
  ChatContextInspection,
  ChatMessage,
  ChatProvider,
  ChatSessionSummary,
  CoachAnalysis,
  CoachAnalysisCreateResult,
  CoachAnalysisInput,
  CoachAnalysisPatch,
  CoachAnalysisRun,
  CoachAnalysisPause,
  CoachAnalysisSpend,
  CoachAnalysisRunQuery,
  CoachAnalysisSummary,
  CoachAnalysisUpdate,
  ChatSettings,
  ClaudeCodeConnectionTest,
  ClaudeCodeLoginStart,
  ClaudeCodeStatus,
  PersistedChatEntry,
  ChatStreamStart,
  ChatStreamToken,
  ChatStreamDone,
  ChatStreamError,
  ChatStreamInfo,
  AnthropicApiConfig,
  AnthropicApiConnectionTest,
  LocalChatConfig,
  LocalChatConnectionTest,
  LocalChatDiscovery,
  OpenRouterConfig,
  OpenRouterConnectionTest,
  CorosMcpStatus,
  CorosMcpTool,
  McpServerConfig,
  McpServerInput,
  McpServerStatus,
  CorosTrainingPlanDraftInput,
  UploadPlanResult,
  IntervalsStatus,
  IntervalsActivityWithStatus,
  DeleteWorkoutResult,
  ManualActivityInput,
  ActivityDetailSummary,
  ActivityDetailSummarySync
} from "../electron/types";
export interface CorosLinkApi {
  platform: string;
  getWatchStatus: () => Promise<WatchStatus>;
  /** Coordinates → a place name, for "Where you've been". */
  reverseGeocodeLocation: (
    lat: number,
    lon: number
  ) => Promise<ReverseGeocodeResult>;
  /**
   * Tell the main process this window has its IPC listeners attached.
   *
   * Call it once, and from every build — anything main pushes unasked (merged
   * sync writes, a COROS session restored at start-up) is held until it
   * arrives, and dropped forever if it never does.
   */
  notifyRendererReady: () => Promise<void>;
  getWatchConnectionSmokeOption: () => Promise<WatchConnectionSmokeOptionId>;
  setWatchConnectionSmokeOption: (
    optionId: WatchConnectionSmokeOptionId
  ) => Promise<WatchStatus>;
  deleteWatchTrack: (relativePath: string) => Promise<WatchStatus>;
  transferLocalTrack: (id: string) => Promise<TransferResult>;
  onWatchTransferProgress: (
    callback: (progress: WatchTransferProgress) => void
  ) => () => void;
  listDownloads: () => Promise<LocalTrack[]>;
  downloadAudio: (url: string) => Promise<DownloadAudioResult>;
  deleteDownload: (id: string, removeFile: boolean) => Promise<LocalTrack[]>;
  getBinaryStatus: () => Promise<BinaryStatus>;
  listYouTubeHistory: () => Promise<YouTubeHistoryEntry[]>;
  recordYouTubeVisit: (
    url: string,
    title?: string
  ) => Promise<YouTubeHistoryEntry>;
  downloadFromYouTubeBrowser: (
    url: string,
    title?: string
  ) => Promise<DownloadAudioResult>;
  downloadMultipleFromYouTubeBrowser: (
    items: Array<{ url: string; title?: string }>
  ) => Promise<DownloadAudioResult>;
  enqueueYouTubeDownloads: (
    items: DownloadQueueItem[]
  ) => Promise<DownloadJob[]>;
  downloadCombinedPlaylist: (
    id: string,
    name: string,
    items: DownloadQueueItem[]
  ) => Promise<CombinedDownloadResult>;
  onCombinedDownloadProgress: (
    callback: (update: CombinedDownloadProgressEvent) => void
  ) => () => void;
  listYouTubeJobs: () => Promise<DownloadJob[]>;
  clearYouTubeJob: (id: string) => Promise<DownloadJob[]>;
  cancelYouTubeJob: (id: string) => Promise<DownloadJob[]>;
  clearCompletedYouTubeJobs: () => Promise<DownloadJob[]>;
  onYouTubeJobsUpdate: (
    callback: (jobs: DownloadJob[]) => void
  ) => () => void;
  resetYouTubeBrowserSession: () => Promise<void>;
  getYouTubeMusicConfig: () => Promise<YouTubeMusicConfig>;
  saveYouTubeMusicConfig: (
    config: YouTubeMusicConfig
  ) => Promise<YouTubeMusicStatus>;
  getYouTubeMusicStatus: () => Promise<YouTubeMusicStatus>;
  saveYouTubeMusicAuth: (headersRaw: string) => Promise<YouTubeMusicStatus>;
  loginYouTubeMusic: () => Promise<YouTubeMusicStatus>;
  logoutYouTubeMusic: () => Promise<YouTubeMusicStatus>;
  resetYouTubeMusicBrowserSession: () => Promise<void>;
  onYouTubeMusicAuthCaptured: (
    callback: (result: YouTubeMusicAuthCapture) => void
  ) => () => void;
  listYouTubeMusicLibrary: () => Promise<YouTubeMusicLibrary>;
  syncYouTubeMusicLibrary: () => Promise<YouTubeMusicSyncResult>;
  getAppleMusicStatus: () => Promise<AppleMusicStatus>;
  saveAppleMusicAuth: (headersRaw: string) => Promise<AppleMusicStatus>;
  logoutAppleMusic: () => Promise<AppleMusicStatus>;
  resetAppleMusicBrowserSession: () => Promise<void>;
  onAppleMusicAuthCaptured: (
    callback: (status: AppleMusicStatus) => void
  ) => () => void;
  listAppleMusicPlaylists: () => Promise<AppleMusicPlaylist[]>;
  fetchAppleMusicPlaylist: (playlist: string) => Promise<AppleMusicPlaylist>;
  searchApplePodcasts: (query: string) => Promise<ApplePodcastShow[]>;
  loadApplePodcast: (
    showIdOrUrl: string,
    offset?: number
  ) => Promise<ApplePodcastShowDetail>;
  getSpotifyConfig: () => Promise<SpotifyConfig>;
  saveSpotifyConfig: (config: SpotifyConfig) => Promise<SpotifyStatus>;
  getSpotifyStatus: () => Promise<SpotifyStatus>;
  loginSpotify: () => Promise<SpotifyStatus>;
  logoutSpotify: () => Promise<SpotifyStatus>;
  listSpotifyPlaylists: () => Promise<SpotifyPlaylist[]>;
  listSpotifyPlaylistTracks: (
    playlistId: string
  ) => Promise<SpotifyPlaylistTrack[]>;
  listSpotifySyncState: (playlistId: string) => Promise<SpotifySyncTrack[]>;
  syncSpotifyPlaylist: (
    playlistId: string,
    autoTransfer: boolean
  ) => Promise<SpotifySyncResult>;
  onSpotifySyncUpdate: (
    callback: (update: SpotifySyncUpdate) => void
  ) => () => void;
  getTrainingHubStatus: () => Promise<TrainingHubStatus>;
  loginTrainingHub: (
    email: string,
    password: string,
    remember: boolean
  ) => Promise<TrainingHubLoginResult>;
  verifyTrainingHubTwoFactor: (code: string) => Promise<TrainingHubStatus>;
  resendTrainingHubTwoFactorCode: () => Promise<void>;
  cancelTrainingHubTwoFactor: () => Promise<void>;
  logoutTrainingHub: () => Promise<TrainingHubStatus>;
  reconnectTrainingHub: () => Promise<TrainingHubLoginResult>;
  getCorosProfileSnapshot: (options?: {
    refresh?: boolean;
  }) => Promise<CorosProfileSnapshot>;
  updateCorosProfile: (patch: CorosProfilePatch) => Promise<CorosProfile>;
  listTrainingHubActivities: (
    page: number,
    size: number,
    startDay?: string,
    endDay?: string
  ) => Promise<TrainingHubActivity[]>;
  listScheduledWorkouts: (
    startDay: string,
    endDay: string
  ) => Promise<TrainingHubScheduledWorkoutEntry[]>;
  listLibraryWorkouts: () => Promise<TrainingHubLibraryWorkout[]>;
  /**
   * Drop the main process's held workout library and movement catalog, so the
   * next read goes to COROS. Behind the refresh buttons, and nothing else —
   * the caches age out on their own after an hour.
   *
   * A surface calling this must also drop the renderer's own catalog copy
   * (`refreshWorkoutExerciseCatalogs`), which outlives any single panel.
   */
  refreshWorkoutCaches: () => Promise<void>;
  duplicateLibraryWorkout: (
    programId: string,
    name: string,
    targetSportType?: number
  ) => Promise<TrainingHubLibraryWorkout>;
  getTrainingLibrarySnapshot: () => Promise<TrainingLibrarySnapshot>;
  getNativeTrainingPlan: (remoteId: string) => Promise<TrainingPlanDocument>;
  updateTrainingPlanMetadata: (
    id: string,
    patch: TrainingPlanMetadataPatch
  ) => Promise<TrainingPlanMetadata>;
  /** Writes a plan to COROS and reads it back; a plan changed there since the edit began is a conflict. */
  saveTrainingPlanToCoros: (request: TrainingPlanSaveRequest) => Promise<TrainingPlanSaveResult>;
  /**
   * The AI plan generator's turn, read-only: progress arrives on the
   * `onChatStream*` events under `requestId`, and `cancelChat(requestId)`
   * stops it. Resolves with the plan, or with why there is none.
   */
  generateTrainingPlan: (
    requestId: string,
    request: TrainingPlanGenerationRequest,
    unitSystem: UnitSystem
  ) => Promise<TrainingPlanGenerationResult>;
  /**
   * The plan's shape, week by week, before its sessions — or, given a
   * revision, that shape redrawn as the athlete asked. Streams like
   * `generateTrainingPlan` and is stopped the same way.
   */
  outlineTrainingPlan: (
    requestId: string,
    request: TrainingPlanGenerationRequest,
    unitSystem: UnitSystem,
    revision?: TrainingPlanOutlineRevision
  ) => Promise<TrainingPlanOutlineResult>;
  /** A COROS copy of the plan, named "… Copy". */
  duplicateTrainingPlan: (planId: string) => Promise<TrainingPlanDocument>;
  /** `takeOffCalendar`: a plan on the calendar is taken off it first; without it, one is refused. */
  deleteTrainingPlan: (
    planId: string,
    confirmed: boolean,
    options?: { takeOffCalendar?: boolean }
  ) => Promise<void>;
  /** The workout library alone, for a picker that needs nothing else. */
  listTrainingLibraryWorkouts: () => Promise<TrainingLibraryWorkout[]>;
  /** What putting a plan on the calendar from a day (yyyyMMdd) would do. */
  previewTrainingPlanCalendar: (planId: string, startDay: string) => Promise<TrainingPlanCalendarPreview>;
  /** Puts a plan on the COROS calendar; answers its running copy. */
  addTrainingPlanToCalendar: (planId: string, startDay: string) => Promise<TrainingPlanDocument>;
  /** Takes a plan's running copy off the COROS calendar. */
  removeTrainingPlanFromCalendar: (planId: string) => Promise<void>;
  /** Carries a plan's edits onto its running copy; answers the copy. */
  syncTrainingPlanToCalendar: (planId: string) => Promise<TrainingPlanDocument>;
  /** Keeps an edit in progress on this machine (and, through sync, the others). */
  saveTrainingPlanDraft: (
    draft: Omit<TrainingPlanDraftRecord, "savedAt" | "id"> & { id?: string }
  ) => Promise<TrainingPlanDraftRecord>;
  deleteTrainingPlanDraft: (id: string) => Promise<void>;
  /** A library workout read in full, as a session to add to a plan. */
  libraryWorkoutAsPlanSession: (programId: string) => Promise<LibraryPlanSession>;
  updateWorkoutMetadata: (
    programIds: string[],
    patch: WorkoutMetadataPatch
  ) => Promise<void>;
  deleteTrainingLibraryWorkouts: (
    request: TrainingLibraryDeleteRequest
  ) => Promise<string[]>;
  listTrainingActivityMatches: () => Promise<TrainingActivityMatch[]>;
  refreshTrainingActivityMatches: (
    startDay: string,
    endDay: string
  ) => Promise<TrainingActivityMatch[]>;
  saveManualActivityMatch: (
    match: TrainingActivityMatch
  ) => Promise<TrainingActivityMatch>;
  listWorkoutExercises: (sport: WorkoutSport) => Promise<WorkoutExerciseOption[]>;
  getWorkoutEditorContext: (unitSystem: UnitSystem) => Promise<WorkoutEditorContext>;
  getWorkoutForEdit: (
    ref: WorkoutEditRef,
    unitSystem: UnitSystem
  ) => Promise<WorkoutEditorDocument>;
  previewWorkoutEdit: (
    ref: WorkoutEditRef,
    revision: string,
    draft: RunWorkoutEditorDraft,
    unitSystem: UnitSystem
  ) => Promise<WorkoutEditPreview>;
  saveWorkoutEdit: (
    ref: WorkoutEditRef,
    revision: string,
    draft: RunWorkoutEditorDraft,
    unitSystem: UnitSystem
  ) => Promise<WorkoutEditSaveResult>;
  scheduleLibraryWorkout: (
    programId: string,
    happenDay: string
  ) => Promise<void>;
  createAndScheduleWorkout: (
    entry: PlanWorkoutEntryInput,
    happenDay: string,
    unitSystem: UnitSystem,
    saveToLibrary?: boolean
  ) => Promise<{ programId?: string }>;
  createLibraryWorkout: (
    entry: PlanWorkoutEntryInput,
    unitSystem: UnitSystem
  ) => Promise<{ programId?: string }>;
  rescheduleWorkout: (
    entry: {
      planId: string;
      idInPlan: string;
      planProgramId?: string;
      happenDay: string;
    },
    newHappenDay: string
  ) => Promise<void>;
  removeScheduledWorkout: (entry: {
    planId: string;
    idInPlan: string;
    planProgramId?: string;
    pbVersion?: number;
  }) => Promise<void>;
  getTrainingHubActivityDetail: (
    activityId: string,
    sportType: number,
    listActivity?: TrainingHubActivity
  ) => Promise<TrainingHubActivityDetail>;
  /** The unparsed COROS payload — ~2.2 MB, for the development build's raw
   *  JSON modal alone. Deliberately not carried on the detail above. */
  getTrainingHubActivityDetailRaw: (
    activityId: string,
    sportType: number
  ) => Promise<Record<string, unknown>>;
  /**
   * The cached COROS end-of-activity feeling per activity, 1..5, or `0` where
   * COROS was asked and the athlete never rated it. An activity absent from
   * the result has never been fetched — which is not the same as unrated, and
   * a caller that folds the two together reports gaps the backfill has simply
   * not reached yet.
   */
  getActivityFeelTypes: (
    activityIds: string[]
  ) => Promise<Record<string, number>>;
  /** Stored summaries for these activities — only the ones still valid for the
   *  activity as COROS describes it now. Answers from SQLite; asks nothing. */
  getActivityDetailSummaries: (
    activityIds: string[]
  ) => Promise<ActivityDetailSummary[]>;
  /** Compute the missing ones, a few per call. Call again while `remaining`
   *  is above zero. */
  syncActivityDetailSummaries: (
    activityIds: string[],
    limit?: number
  ) => Promise<ActivityDetailSummarySync>;
  exportTrainingHubActivityFile: (
    activityId: string,
    sportType: number,
    fileType: TrainingHubActivityFileType,
    suggestedName?: string
  ) => Promise<TrainingHubExportResult>;
  exportLatestTrainingHubActivityFile: (
    fileType?: TrainingHubActivityFileType
  ) => Promise<TrainingHubExportResult>;
  chooseActivityBackupFolder: () => Promise<string | null>;
  startActivityBackup: (
    folder: string,
    fileType?: TrainingHubActivityFileType
  ) => Promise<ActivityBackupProgress>;
  cancelActivityBackup: () => Promise<ActivityBackupProgress | null>;
  getActivityBackupProgress: () => Promise<ActivityBackupProgress | null>;
  onActivityBackupProgress: (
    callback: (progress: ActivityBackupProgress) => void
  ) => () => void;
  /** The COROS session changed without anyone clicking for it: a start-up
   *  re-login from saved credentials, or a token another of the athlete's
   *  machines invalidated by signing in. Every click-driven change comes back
   *  through its own call instead. */
  onTrainingHubSessionChanged: (
    callback: (status: TrainingHubStatus) => void
  ) => () => void;
  getTrainingAnalytics: () => Promise<TrainingHubAnalytics>;
  getRacePredictor: () => Promise<TrainingHubRacePredictor>;
  getTrainingDashboard: () => Promise<TrainingHubDashboard>;
  getDailyMetrics: (dateList: string[]) => Promise<TrainingHubDailyMetrics>;
  syncStrengthHistory: (request?: StrengthHistoryRequest) => Promise<StrengthHistory>;
  getHevyStatus: () => Promise<HevyStatus>;
  connectHevy: (apiKey: string) => Promise<HevyStatus>;
  updateHevySettings: (input: HevySettingsInput) => Promise<HevyStatus>;
  disconnectHevy: () => Promise<void>;
  startRpeBackfill: () => Promise<void>;
  getRpeBackfillStatus: () => Promise<{ pending: number; running: boolean }>;
  getRpeLoadByDay: () => Promise<Record<string, number>>;
  getSportTypeMap: () => Promise<TrainingHubSportType[]>;
  getUpcomingWorkouts: (days?: number) => Promise<TrainingHubUpcomingWorkout[]>;
  getTrainingSleepData: (days?: number) => Promise<TrainingHubSleepSummary>;
  getSleepHistory: (request?: {
    days?: number;
    refresh?: boolean;
  }) => Promise<SleepHistorySnapshot>;
  getSleepNightSeries: (request: {
    happenDay: string;
    refresh?: boolean;
  }) => Promise<SleepNightSeries>;
  getTrainingDailyHealthData: (
    days?: number
  ) => Promise<TrainingHubDailyHealthSummary>;
  uploadTrainingPlan: (
    draft: CorosTrainingPlanDraftInput,
    unitSystem: UnitSystem
  ) => Promise<UploadPlanResult>;
  getIntervalsStatus: () => Promise<IntervalsStatus>;
  connectIntervals: (apiKey: string, athleteId: string) => Promise<IntervalsStatus>;
  disconnectIntervals: () => Promise<void>;
  listMissingIntervalsActivities: (
    daysBack: number
  ) => Promise<IntervalsActivityWithStatus[]>;
  importIntervalsActivity: (
    intervalsId: string,
    fileExt: "fit" | "tcx" | "unknown"
  ) => Promise<{ importId: string }>;
  addManualActivityToCoros: (
    input: ManualActivityInput
  ) => Promise<{ importId: string }>;
  getAppInfo: () => Promise<AppInfo>;
  openAppStorageLocation: (id: string) => Promise<void>;
  getAppUpdateStatus: () => Promise<AppUpdateSnapshot>;
  checkForAppUpdates: () => Promise<AppUpdateSnapshot>;
  downloadAppUpdate: () => Promise<AppUpdateSnapshot>;
  setUpdatePreferences: (prefs: {
    autoCheck?: boolean;
    autoDownload?: boolean;
  }) => Promise<AppUpdateSnapshot>;
  quitAndInstallUpdate: () => Promise<{ installMethod: "restart" | "manual" }>;
  onAppUpdateStatus: (
    callback: (snapshot: AppUpdateSnapshot) => void
  ) => () => void;
  getChatAuthStatus: () => Promise<ChatAuthStatus>;
  getChatSettings: () => Promise<ChatSettings>;
  getBaseCoachInstructions: () => Promise<string>;
  saveChatSettings: (settings: ChatSettings) => Promise<ChatSettings>;
  testLocalChatConnection: (
    config?: LocalChatConfig
  ) => Promise<LocalChatConnectionTest>;
  testAnthropicConnection: (
    config?: Partial<AnthropicApiConfig>
  ) => Promise<AnthropicApiConnectionTest>;
  openAnthropicKeyGuide: () => Promise<void>;
  detectLocalChatServers: (apiKey?: string) => Promise<LocalChatDiscovery>;
  testOpenRouterConnection: (
    config?: OpenRouterConfig
  ) => Promise<OpenRouterConnectionTest>;
  openOpenRouterKeys: () => Promise<void>;
  openOpenRouterModels: () => Promise<void>;
  getClaudeCodeStatus: () => Promise<ClaudeCodeStatus>;
  startClaudeCodeLogin: () => Promise<ClaudeCodeLoginStart>;
  awaitClaudeCodeLogin: () => Promise<ClaudeCodeStatus>;
  submitClaudeCodeLoginCode: (code: string) => Promise<void>;
  cancelClaudeCodeLogin: () => Promise<void>;
  openClaudeCodeLoginUrl: () => Promise<void>;
  revokeClaudeCodeLogin: () => Promise<ClaudeCodeStatus>;
  testClaudeCodeConnection: () => Promise<ClaudeCodeConnectionTest>;
  openClaudeCodeSetupGuide: () => Promise<void>;
  loginChat: () => Promise<ChatAuthStatus>;
  logoutChat: () => Promise<ChatAuthStatus>;
  sendChat: (
    requestId: string,
    messages: ChatMessage[],
    unitSystem: UnitSystem
  ) => Promise<void>;
  cancelChat: (requestId: string) => Promise<void>;
  /**
   * Resolves what a turn in this conversation should send: the rolling summary
   * and where the verbatim tail starts. `entries` is the window's live
   * transcript; omitting it compacts what is on disk, which is what the
   * conversation menu does for a thread that is not open.
   */
  compactChatContext: (
    sessionId: string,
    entries?: PersistedChatEntry[],
    options?: { force?: boolean }
  ) => Promise<ChatContextCompaction>;
  /**
   * What compaction has done to this conversation, for the dev-build
   * inspector. Plans but never rolls, so opening it costs nothing.
   */
  inspectChatContext: (
    sessionId: string,
    entries?: PersistedChatEntry[]
  ) => Promise<ChatContextInspection>;
  listChatSessions: (provider: ChatProvider) => Promise<ChatSessionSummary[]>;
  getChatSession: (sessionId: string) => Promise<PersistedChatEntry[]>;
  createChatSession: (provider: ChatProvider) => Promise<ChatSessionSummary>;
  saveChatSession: (
    sessionId: string,
    entries: PersistedChatEntry[],
    options?: SaveChatSessionOptions
  ) => Promise<ChatSessionSummary | null>;
  setChatSessionPinned: (
    sessionId: string,
    pinned: boolean
  ) => Promise<ChatSessionSummary | null>;
  deleteChatSession: (sessionId: string) => Promise<void>;
  renameChatSession: (
    sessionId: string,
    title: string
  ) => Promise<ChatSessionSummary | null>;
  listCoachAnalysesForSession: (
    sessionId: string
  ) => Promise<CoachAnalysisSummary[]>;
  getCoachAnalysis: (analysisId: string) => Promise<CoachAnalysis | null>;
  createCoachAnalysis: (
    input: CoachAnalysisInput
  ) => Promise<CoachAnalysisCreateResult>;
  updateCoachAnalysis: (
    analysisId: string,
    patch: CoachAnalysisPatch
  ) => Promise<CoachAnalysis | null>;
  setCoachAnalysisEnabled: (
    analysisId: string,
    enabled: boolean
  ) => Promise<CoachAnalysis | null>;
  deleteCoachAnalysis: (analysisId: string) => Promise<void>;
  reorderCoachAnalyses: (
    sessionId: string,
    analysisIds: string[]
  ) => Promise<CoachAnalysis[]>;
  runCoachAnalysisNow: (analysisId: string) => Promise<CoachAnalysisRun[]>;
  listCoachAnalysisRuns: (
    filter?: CoachAnalysisRunQuery
  ) => Promise<CoachAnalysisRun[]>;
  cancelCoachAnalysisRun: (runId: string) => Promise<void>;
  getCoachAnalysisPause: () => Promise<CoachAnalysisPause | null>;
  resumeCoachAnalyses: () => Promise<CoachAnalysisPause | null>;
  getCoachAnalysisSpend: () => Promise<CoachAnalysisSpend>;
  setCoachAnalysisBudget: (
    budget: number | null
  ) => Promise<CoachAnalysisSpend>;
  markCoachAnalysisRunsSeen: (runIds: string[]) => Promise<number>;
  listCoachAnalysisSessionAttention: () => Promise<
    CoachAnalysisSessionAttention[]
  >;
  markCoachAnalysisSessionSeen: (sessionId: string) => Promise<number>;
  onCoachAnalysisRunUpdate: (
    callback: (run: CoachAnalysisRun) => void
  ) => () => void;
  onCoachAnalysisUpdate: (
    callback: (update: CoachAnalysisUpdate) => void
  ) => () => void;
  onCoachAnalysisPauseUpdate: (
    callback: (pause: CoachAnalysisPause | null) => void
  ) => () => void;
  onChatStreamStart: (callback: (payload: ChatStreamStart) => void) => () => void;
  onChatStreamToken: (callback: (payload: ChatStreamToken) => void) => () => void;
  onChatStreamDone: (callback: (payload: ChatStreamDone) => void) => () => void;
  onChatStreamError: (callback: (payload: ChatStreamError) => void) => () => void;
  onChatStreamInfo: (callback: (payload: ChatStreamInfo) => void) => () => void;
  getCorosMcpStatus: () => Promise<CorosMcpStatus>;
  connectCorosMcp: () => Promise<CorosMcpStatus>;
  disconnectCorosMcp: () => Promise<CorosMcpStatus>;
  listCorosMcpTools: () => Promise<CorosMcpTool[]>;
  listMcpServers: () => Promise<McpServerConfig[]>;
  addMcpServer: (input: McpServerInput) => Promise<McpServerConfig>;
  updateMcpServer: (
    id: string,
    patch: Partial<McpServerInput>
  ) => Promise<McpServerConfig>;
  removeMcpServer: (id: string) => Promise<void>;
  connectMcpServer: (id: string) => Promise<McpServerStatus>;
  disconnectMcpServer: (id: string) => Promise<void>;
  getMcpStatuses: () => Promise<McpServerStatus[]>;
  /** Silent reconnect from stored auth; never opens an OAuth window. */
  ensureMcpConnected: () => Promise<McpServerStatus[]>;
  setMcpBearer: (id: string, token: string) => Promise<void>;
  uploadTrainingPlanDraft: (
    draftId: string,
    unitSystem: UnitSystem,
    destination?: TrainingPlanDestination,
    scheduleDate?: string,
    /** A workout put on the calendar is also kept in the Workout Library. */
    keepInLibrary?: boolean
  ) => Promise<UploadPlanResult>;
  /** Lets go of a creation's draft once it is removed, unsaved, from the conversation. */
  removePlanDraft: (draftId: string) => Promise<void>;
  /** Writes the athlete's edit of a coach's one-off workout back into its draft. */
  editWorkoutDraft: (
    draftId: string,
    workout: PlanWorkoutEntryInput,
    unitSystem?: UnitSystem
  ) => Promise<PlanDraftPreview>;
  /** The plan behind a Coach card, for the editor "Edit plan first" opens. */
  getPlanDraftDocument: (draftId: string) => Promise<TrainingPlanDocument>;
  /** Writes the athlete's edit back into the coach's own draft; answers the card. */
  editPlanDraft: (draftId: string, plan: TrainingPlanDocument, unitSystem?: UnitSystem) => Promise<PlanDraftPreview>;
  confirmWorkoutDelete: (requestId: string) => Promise<DeleteWorkoutResult>;
  // ----- Sync -----
  chooseSyncFolder: () => Promise<string | null>;
  getSyncStatus: () => Promise<SyncStatus>;
  /** Open the vault, creating it in the chosen destination if it is not there.
   *  This is the whole of setting sync up; nothing is asked of the user. */
  prepareSyncVault: () => Promise<SyncVaultState>;
  /** Take a vault belonging to another account. Clears the seed flag, so this
   *  machine republishes its whole state into it. */
  claimSyncVault: () => Promise<SyncVaultState>;
  setSyncBackend: (backend: SyncBackend) => Promise<void>;
  /** Who the connected Google account belongs to, and how much room it has
   *  left. Null when nothing is connected, or when Drive would not say — it is
   *  decoration, so it never fails the panel. */
  googleDriveAccount: () => Promise<GoogleAccountInfo | null>;
  connectGoogleDrive: () => Promise<void>;
  disconnectGoogleDrive: () => Promise<void>;
  setGoogleClient: (
    clientId: string | null,
    clientKey: string | null
  ) => Promise<void>;
  syncNow: () => Promise<{ pushed: number; applied: number }>;
  /** Hand the main process every localStorage entry policy allows, so it can
   *  publish the ones that moved. `syncing: false` means nothing was listening,
   *  which the caller must not mistake for delivery. */
  publishSyncedLocalStorage: (
    entries: Record<string, string>
  ) => Promise<LocalStoragePublishResult>;
  announceSyncPresence: (sessionId: string | null) => Promise<void>;
  listSyncPresence: () => Promise<SyncPresenceClaim[]>;
  onSyncChanged: (callback: (change: SyncChangedEvent) => void) => () => void;

  // ----- Backup & Restore -----
  //
  // A file the person owns, not a copy this app keeps track of. Export opens a
  // save dialog and writes one; restoring is two calls, because between them
  // the person answers what should happen to the data already here.
  /** Null when the save dialog was dismissed. */
  exportBackup: (
    localStorage: Record<string, string>
  ) => Promise<BackupExportResult | null>;
  /** Open a backup and describe what restoring it would do, without writing
   *  anything. Null when the dialog was dismissed. */
  chooseBackupFile: () => Promise<BackupImportCandidate | null>;
  /** `allowOtherOwner` is the deliberate override for a file belonging to a
   *  different COROS account, and must only be set from a second confirmation
   *  the person gave. */
  restoreBackup: (
    filePath: string,
    mode: RestoreMode,
    allowOtherOwner?: boolean
  ) => Promise<BackupRestoreResult>;

  setWindowBackground: (color: string) => Promise<void>;
  isWindowFullscreen: () => Promise<boolean>;
  onWindowFullscreenChange: (callback: (fullscreen: boolean) => void) => () => void;
}

declare global {
  interface Window {
    corosLink?: CorosLinkApi;
  }
}

export {};
