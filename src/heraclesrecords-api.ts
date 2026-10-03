import type {
  GoogleAccountInfo,
  LocalStoragePublishResult,
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
  DiagnosticsSnapshot,
  RendererDiagnosticError
} from "../electron/diagnosticsTypes";
import type {
  CoachAnalysisSessionAttention,
  CorosProfile,
  CorosProfilePatch,
  CorosProfileSnapshot,
  RememberedMilestone,
  ReverseGeocodeResult,
  SaveChatSessionOptions,
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
  PlanArtifactVersion,
  ConversationSettings,
  PlanBrief,
  PlanBriefRequest,
  ChatPipelineStep,
  TrainingPlanOutline,
  PlanCalendarState,
  PlanCorosSync,
  PlanDraftSaveOptions,
  PlanVersionSave,
  PlanVersionWritten,
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
  AppInfo,
  AppUpdateSnapshot,
  SampleDataState,
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
  ModelCatalogRefresh,
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
  CorosMcpAccount,
  CorosMcpStatus,
  CorosMcpTool,
  McpServerConfig,
  McpServerInput,
  McpServerStatus,
  CorosTrainingPlanDraftInput,
  UploadPlanResult,
  ScheduleChangeSet,
  ManualActivityInput,
  ActivityDetailSummary,
  ActivityDetailSummarySync
} from "../electron/types";
export interface HeraclesRecordsApi {
  platform: string;
  /** Coordinates → a place name, for "Where you've been". */
  reverseGeocodeLocation: (
    lat: number,
    lon: number
  ) => Promise<ReverseGeocodeResult>;
  /**
   * The Hall of Records' memory: milestones whose source forgets them, with
   * the finished plan runs the plan cache can vouch for added first.
   */
  listRememberedMilestones: () => Promise<RememberedMilestone[]>;
  /** Keep VO2max and sleep milestones; answers how many rows moved. */
  rememberMilestones: (entries: RememberedMilestone[]) => Promise<number>;
  /**
   * Tell the main process this window has its IPC listeners attached.
   *
   * Call it once, and from every build — anything main pushes unasked (merged
   * sync writes, a COROS session restored at start-up) is held until it
   * arrives, and dropped forever if it never does.
   */
  notifyRendererReady: () => Promise<void>;
  /** Development builds only: the simulated rides, hikes and trail runs. */
  getSampleData: () => Promise<SampleDataState>;
  setSampleData: (
    kind: keyof SampleDataState,
    enabled: boolean
  ) => Promise<SampleDataState>;
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
   *  is above zero. `requireRecords` also counts a summary as missing until it
   *  carries the Hall of Records' best efforts and start point. */
  syncActivityDetailSummaries: (
    activityIds: string[],
    limit?: number,
    options?: { requireRecords?: boolean }
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
    cacheOnly?: boolean;
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
  /**
   * Reads each provider's model list again where it is a day old (or, with
   * `force`, the one named) and returns the settings holding them.
   */
  refreshChatModels: (options?: {
    provider?: ChatProvider;
    force?: boolean;
  }) => Promise<ModelCatalogRefresh>;
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
    unitSystem: UnitSystem,
    /** The conversation the turn is in, whose sources and AI it takes (P2.0). */
    sessionId?: string,
    /** A step of the plan pipeline rather than a question (P2.2). */
    pipeline?: ChatPipelineStep
  ) => Promise<void>;
  /** The briefs behind a conversation's brief cards (P2.1). */
  getPlanBriefs: (artifactIds: string[]) => Promise<PlanBrief[]>;
  /** The athlete's edit of a brief; a field changed loses its "from chat" or "from data". */
  updatePlanBrief: (artifactId: string, request: PlanBriefRequest) => Promise<PlanBrief>;
  /** A new conversation's brief (P2.5): the athlete's, or the defaults when absent. */
  createPlanBrief: (sessionId: string, request?: PlanBriefRequest) => Promise<PlanBrief>;
  /** The athlete's adjustment of a brief's outline; refused when it breaks the brief (P2.2). */
  updatePlanOutline: (artifactId: string, outline: TrainingPlanOutline) => Promise<PlanBrief>;
  /** What one conversation reads and which AI answers it (P2.0). */
  getConversationSettings: (sessionId: string) => Promise<ConversationSettings>;
  setConversationSettings: (settings: ConversationSettings) => Promise<ConversationSettings>;
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
  /** Every conversation, whichever AI answers it (Q1 of the Coach Workbench review). */
  listChatSessions: () => Promise<ChatSessionSummary[]>;
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
  getCorosMcpAccount: () => Promise<CorosMcpAccount>;
  getDiagnostics: () => Promise<DiagnosticsSnapshot>;
  copyDiagnostics: () => Promise<DiagnosticsSnapshot>;
  clearDiagnostics: () => Promise<DiagnosticsSnapshot>;
  reportRendererError: (error: RendererDiagnosticError) => void;
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
    keepInLibrary?: boolean,
    /** For a plan already on COROS: save a new one, or write over a change made there (P1.6). */
    options?: PlanDraftSaveOptions
  ) => Promise<UploadPlanResult>;
  /** Every version of the creations these drafts belong to (P1.1). */
  getPlanArtifacts: (draftIds: string[]) => Promise<PlanArtifactVersion[]>;
  /** Makes an older version of a creation the newest again (P1.4). */
  restorePlanVersion: (draftId: string, unitSystem: UnitSystem) => Promise<PlanVersionWritten>;
  /**
   * A creation on COROS read against COROS (P1.6): a change made there comes
   * back as its newest version. `cacheOnly` asks the plan cache and costs no
   * request.
   */
  syncPlanFromCoros: (draftId: string, unitSystem: UnitSystem, cacheOnly?: boolean) => Promise<PlanCorosSync>;
  /** The conversation a Coach plan came from, by any of its versions' draft ids (P1.7). */
  findChatSessionForDraft: (draftId: string) => Promise<string | null>;
  /** Where each Coach plan on COROS stands on the calendar, from this machine's cache (P1.6). */
  getPlanCalendarState: (draftIds: string[]) => Promise<PlanCalendarState[]>;
  /** Lets go of a creation's draft once it is removed, unsaved, from the conversation. */
  removePlanDraft: (draftId: string) => Promise<void>;
  /**
   * The athlete's edit of a coach's one-off workout, as the workout's next
   * version (P1.5) — or, begun on a version since replaced, the newest one,
   * unless `replaceNewer` says to write over it.
   */
  editWorkoutDraft: (
    draftId: string,
    workout: PlanWorkoutEntryInput,
    unitSystem?: UnitSystem,
    replaceNewer?: boolean
  ) => Promise<PlanVersionSave>;
  /** The plan behind a Coach card, for the editor "Edit plan first" opens. */
  getPlanDraftDocument: (draftId: string) => Promise<TrainingPlanDocument>;
  /** The athlete's edit of a coach's plan as its next version; see `editWorkoutDraft`. */
  editPlanDraft: (
    draftId: string,
    plan: TrainingPlanDocument,
    unitSystem?: UnitSystem,
    replaceNewer?: boolean
  ) => Promise<PlanVersionSave>;
  /** Coach's proposals to the calendar and the library, by the anchors' ids (P3.2). */
  getScheduleChanges: (changeSetIds: string[]) => Promise<ScheduleChangeSet[]>;
  /** Applies one line, or every proposed line; each is checked against COROS first. */
  applyScheduleChange: (changeSetId: string, lineId?: string) => Promise<ScheduleChangeSet>;
  dismissScheduleChange: (changeSetId: string, lineId?: string) => Promise<ScheduleChangeSet>;
  // ----- Sync -----
  getSyncStatus: () => Promise<SyncStatus>;
  /** Open the vault, creating it in the connected Drive if it is not there.
   *  This is the whole of setting sync up; nothing is asked of the user. */
  prepareSyncVault: () => Promise<SyncVaultState>;
  /** Take a vault belonging to another account. Clears the seed flag, so this
   *  machine republishes its whole state into it. */
  claimSyncVault: () => Promise<SyncVaultState>;
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
    heraclesRecords?: HeraclesRecordsApi;
  }
}

export {};
