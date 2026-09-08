// Which data may leave this machine, and which must never.
//
// Every SQLite table and every `app_settings` key is declared here. The
// companion suite (`scripts/test-sync-policy.mjs`) scrapes the schema and the
// key declarations out of the source and fails when anything is missing from
// this file, so a new table or setting cannot reach the cloud unclassified.
//
// The classification is deliberately conservative. Sync is opt-in for the whole
// app, but a misfiled key ships another person's credentials to their Drive, so
// anything ambiguous is filed as `device` (never leaves) rather than guessed
// into `personal`.
//
// **Sync carries user data and nothing else.** No credential, token or sign-in
// leaves this machine down any path — not in a snapshot, not in the oplog.
// Every one of them is filed `device`, which is the tier that never travels.
// There is no opt-in that changes this and no code that unwraps a credential
// for transport; carrying a session between machines is a separate problem, to
// be designed on its own rather than smuggled in behind a checkbox.

/** Parts of a composite primary key are joined with the ASCII unit separator,
 *  which cannot appear in any identifier this schema uses, so a record id
 *  round-trips unambiguously. Declared here because this module imports
 *  nothing: database.ts needs it too, and importing sqliteSyncTarget from
 *  there would close a cycle. */
export const RECORD_ID_SEPARATOR = "\u001f";

/** How a piece of data is treated by the sync engine. */
export type SyncTier =
  /** User-authored, not reproducible from any other source. Synced. */
  | "personal"
  /** Small user choices that should follow the person between machines. */
  | "preference"
  /** Cache that can be rebuilt from COROS, Hevy, Spotify or the filesystem.
   *  Never synced — it would cost bandwidth and go stale. */
  | "derived"
  /**
   * Never synced. Two kinds of thing land here, and both stay put:
   *
   *   * **Credentials** — tokens, API keys, account sign-ins. See the file
   *     header: sync carries user data only.
   *   * **Machine-bound state** — absolute paths, UI chrome, per-install
   *     identifiers, this device's own sync bookkeeping.
   */
  | "device";

/** `app_settings` is a key/value store; its rows are governed one at a time by
 *  `SETTING_POLICY`, never copied wholesale. Kept distinct from the tiers so
 *  nobody can bulk-sync the table and take every credential with it. */
export type TablePolicy = SyncTier | "perKey";

export const TABLE_POLICY: Readonly<Record<string, TablePolicy>> = {
  // The key/value store itself — see TablePolicy above.
  app_settings: "perKey",

  // --- Coach: the reason this feature exists -------------------------------
  chat_sessions: "personal",
  chat_plan_drafts: "personal",
  coach_automations: "personal",
  coach_automation_bindings: "personal",

  // Execution records of automation runs. Not synced: a run belongs to whichever
  // machine held the automation lease, and syncing them would fight that lease.
  // What a run *produces* lands in chat_sessions, which is synced.
  coach_automation_runs: "derived",
  // Metric snapshots sampled from COROS on a schedule.
  coach_daily_samples: "derived",

  // --- Training library: user intent, worth carrying between machines ------
  training_plans: "personal",
  training_plan_workout_links: "personal",
  training_collections: "personal",
  // `favorite`, `tags_json` and `collection_id` are pure user intent and cannot
  // be rebuilt; the `cached_*` columns ride along as dead weight.
  training_workout_metadata: "personal",
  generated_routes: "personal",
  // Server config only. The bearer tokens and OAuth client info live in
  // app_settings under `mcp.<id>.*`, and stay on the machine that authorised
  // them — so a restored machine lists its servers and signs in to them again.
  mcp_servers: "personal",

  // --- Reproducible from an upstream API -----------------------------------
  training_activities: "derived",
  strength_sessions: "derived",
  hevy_workouts: "derived",
  hevy_exercise_templates: "derived",
  cached_coros_maps: "derived",
  // Mostly computed plan/activity matching. The `manual` column marks rows a
  // person confirmed by hand, which *is* user intent and is lost on a new
  // machine — a row-level rule for those belongs in the sync engine, not in a
  // table-level registry. Filed conservatively until then.
  training_activity_matches: "derived",

  // --- Bound to this machine's filesystem ----------------------------------
  // Both carry absolute paths to downloaded audio that exists nowhere else.
  downloads: "device",
  spotify_sync_tracks: "device",
  // A local "recently visited" convenience list, not a record worth carrying.
  youtube_history: "device"
};

export const SETTING_POLICY: Readonly<Record<string, SyncTier>> = {
  // --- Credentials: every one of these stays on this machine ---------------
  //
  // `device`, not a tier of its own with an opt-in. Signing in again on the
  // second machine is a minute's work; a sign-in that travels is a design
  // problem of its own — see the file header.

  // The COROS session. All four travel together or not at all:
  // getTrainingHubAuth() reads a session as absent unless every one is present,
  // so they share a tier even though userId/regionId/baseUrl are not
  // themselves confidential.
  "trainingHub.accessToken": "device",
  "trainingHub.userId": "device",
  "trainingHub.regionId": "device",
  "trainingHub.baseUrl": "device",
  "coros.credentials": "device",
  "trainingHub.credentials": "device", // legacy key, still migrated from

  // Chat / Coach providers.
  "chat.oauthToken": "device",
  "chat.anthropic.apiKey": "device",
  "chat.openRouter.apiKey": "device",
  "chat.local.apiKey": "device",

  // Third-party accounts. clientId is not confidential on its own, but it is
  // half of a credential pair the user created; the pair stays together.
  "spotify.clientId": "device",
  "spotify.clientSecret": "device",
  "spotify.accessToken": "device",
  "spotify.refreshToken": "device",
  "spotify.expiresAt": "device",
  "spotify.userId": "device",
  "spotify.displayName": "device",
  "youtubeMusic.clientId": "device",
  "youtubeMusic.clientSecret": "device",
  "appleMusic.credentialsJson": "device",
  "hevy.apiKey": "device",
  "hevy.identity": "device",
  "intervals.apiKey": "device",
  "intervals.athleteId": "device",
  "maps.openRouteServiceApiKey": "device",
  "watchfaces.mobileSession": "device",
  "corosMcp.tokens": "device",
  "corosMcp.clientInfo": "device",
  // Just the server address, and it mirrors mcp_servers.url.
  "corosMcp.resourceUrl": "personal",

  // --- The one piece of writing the user does in Settings ------------------
  "chat.customInstructions": "personal",

  // --- Preferences ---------------------------------------------------------
  "chat.provider": "preference",
  "chat.model": "preference",
  "chat.chatgpt.model": "preference",
  "chat.openRouter.model": "preference",
  "chat.anthropic.model": "preference",
  "chat.anthropic.effort": "preference",
  "chat.claudeCode.model": "preference",
  "chat.claudeCode.effort": "preference",
  "chat.claudeCode.useAppScopedAuth": "preference",
  "chat.claudeCode.permissions.recentActivities": "preference",
  "chat.claudeCode.permissions.trainingMetrics": "preference",
  "chat.claudeCode.permissions.upcomingWorkouts": "preference",
  "chat.claudeCode.permissions.sleepData": "preference",
  "chat.claudeCode.permissions.fullActivityFiles": "preference",
  "chat.local.model": "preference",
  "chat.local.toolsEnabled": "preference",
  "chat.visualizations.enabled": "preference",
  "chat.compactContext.enabled": "preference",
  "chat.compactContext.limit": "preference",
  "chat.compactContext.keep": "preference",
  "updater.autoCheck": "preference",
  "updater.autoDownload": "preference",
  "maps.routeBackend": "preference",
  "hevy.includeWarmups": "preference",
  // Pausing automations is a decision about the account, not about one laptop.
  "coachAutomation.pause": "preference",
  "coachAutomation.monthlyTokenBudget": "preference",

  // --- Rebuildable cache ---------------------------------------------------
  "youtubeMusic.libraryJson": "derived",

  // --- Machine-specific ----------------------------------------------------
  // An absolute path to a binary that lives at a different place on each OS.
  "chat.claudeCode.executablePath": "device",
  // Probed from the local Claude Code install; means nothing on another machine.
  "chat.claudeCode.availableModels": "device",
  "chat.claudeCode.defaultModel": "device",
  "chat.claudeCode.lastConnectionStatus": "device",
  "chat.claudeCode.lastCheckedAt": "device",
  // Usually a localhost URL pointing at a server running on this machine.
  "chat.local.baseUrl": "device",
  // Pure UI state.
  "chat.sidebar.open": "device",
  // Per-install identity for the COROS mobile session.
  "watchfaces.mobileInstallId": "device",
  // Timestamps recording when *this* machine last authenticated or synced.
  "chat.authUpdatedAt": "device",
  "appleMusic.authUpdatedAt": "device",
  "youtubeMusic.authUpdatedAt": "device",
  "hevy.eventCursor": "device",
  "hevy.coverageSince": "device",
  "hevy.lastSyncedAt": "device",
  "intervals.importedAt": "device",
  "coachAutomation.activityWatcherInitializedAt": "device",
  "coachAutomation.dailySamplesCapturedAt": "device",
  // Names this machine's own oplog directory. Two installs sharing one id would
  // put two writers in the same directory — the one thing the log's
  // conflict-free design depends on never happening.
  "sync.deviceId": "device",
  // Where this machine's vault folder sits. A path, so it means nothing
  // elsewhere; and syncing it would let one computer redirect another's backups.
  "sync.folder": "device",
  // Which vault this machine has already published its pre-existing data into.
  // Per-machine by definition: it records what *this* computer has done, and a
  // second machine that adopted the flag would skip the one publish that puts
  // its own history in front of the first.
  "sync.seededVaultId": "device",
  // A copy of the renderer preferences this machine last sent, kept so an
  // unchanged one produces no entry. Per-machine bookkeeping about what *this*
  // computer has published, and syncing it would make another device believe
  // it had already sent values it never had.
  "sync.publishedLocalStorage": "device",
  // Which backend this machine uses. A laptop may back up to Drive while a
  // desktop uses a NAS folder; syncing the choice would drag one onto the
  // other's vault and overwrite it with a stranger's history.
  "sync.backend": "device",
  // The last logical timestamp this device issued. Two machines sharing one
  // would issue colliding timestamps and break the merge order outright.
  "sync.clock": "device",
  // When this machine last caught up, and when it last folded the log down.
  // Both describe one device's own progress, not the account's state — and
  // syncing the compaction stamp in particular would have every device decide
  // it had just compacted because one of them had.
  "sync.lastPulledAt": "device",
  "sync.lastCompactedAt": "device",
  // The Google connection. Sealed by this machine's keychain and never synced:
  // the destination it unlocks is the destination it would be synced to, and a
  // refresh token that reached another machine would hand over the whole Drive
  // account, not just the vault. Of every credential here this is the one whose
  // front door is also its own destination.
  "sync.google.clientId": "device",
  "sync.google.clientKey": "device",
  "sync.google.refreshToken": "device"
};

// ---------------------------------------------------------------------------
// Credentials sealed to this machine's keychain
//
// Several services do not store their credential in the clear: they wrap it
// with Electron's `safeStorage`, whose key lives in the OS keychain. Copying
// that ciphertext to another computer produces bytes nothing can open.
//
// Every key here is already `device`, so nothing about sync reaches it. This
// list is the belt to that braces, and it earns its place twice over:
//
//   * `isDeviceEncrypted` is a second gate on both the snapshot path and the
//     oplog path, so a key misfiled as `personal` one day still cannot travel
//     as unusable bytes. A credential that fails to arrive is a prompt to sign
//     in; one that arrives broken is a bug report — every
//     `Boolean(getSetting(...))` in the app then reports a connected account
//     that cannot make a request.
//   * `scripts/test-sync-policy.mjs` asserts every key listed here sits in the
//     `device` tier, which is what turns "we meant to" into a failing test.
// ---------------------------------------------------------------------------

export const DEVICE_ENCRYPTED_SETTINGS: ReadonlySet<string> = new Set([
  "coros.credentials", // corosCredentialStore
  "trainingHub.credentials", // corosCredentialStore, pre-rename key
  "chat.oauthToken", // chatService
  "chat.anthropic.apiKey", // chatService
  "chat.openRouter.apiKey", // chatService
  "chat.local.apiKey", // chatService
  "hevy.apiKey", // hevyService
  "intervals.apiKey", // intervalsService
  "watchfaces.mobileSession", // corosWatchfaceService
  "corosMcp.tokens", // mcpClientManager
  "corosMcp.clientInfo", // mcpClientManager
  "sync.google.clientKey", // googleOAuth
  "sync.google.refreshToken" // googleOAuth
]);

/** The same, for keys whose middle segment is a server id. */
const DEVICE_ENCRYPTED_PATTERNS: readonly RegExp[] = [
  /^mcp\.[^.]+\.(?:tokens|clientInfo|bearer)$/
];

/** True when the stored value is `safeStorage` ciphertext, and therefore
 *  meaningless on any other machine. */
export function isDeviceEncrypted(key: string): boolean {
  return (
    DEVICE_ENCRYPTED_SETTINGS.has(key) ||
    DEVICE_ENCRYPTED_PATTERNS.some((pattern) => pattern.test(key))
  );
}

/** Keys whose middle segment is a server id, so they cannot be listed literally.
 *  Built by `mcpSecretKey()` and `keysFor()` in the MCP modules. */
export const DYNAMIC_SETTING_RULES: ReadonlyArray<{
  readonly pattern: RegExp;
  readonly tier: SyncTier;
  readonly description: string;
}> = [
  {
    pattern: /^mcp\.[^.]+\.(?:tokens|clientInfo|bearer)$/,
    tier: "device",
    description: "Per-MCP-server OAuth tokens, client registration and bearer."
  },
  {
    pattern: /^mcp\.[^.]+\.resourceUrl$/,
    tier: "personal",
    description: "Per-MCP-server address; mirrors mcp_servers.url."
  }
];

/** The tier for a settings key, or undefined when it has never been classified.
 *  Callers must treat undefined as "do not sync" and fix the registry. */
export function policyForSetting(key: string): SyncTier | undefined {
  const literal = SETTING_POLICY[key];
  if (literal) {
    return literal;
  }
  for (const rule of DYNAMIC_SETTING_RULES) {
    if (rule.pattern.test(key)) {
      return rule.tier;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Renderer localStorage
//
// The third place this app keeps state, after the SQLite tables and
// app_settings. It lives in the renderer, so the sync engine reaches it over
// IPC rather than by reading it directly — but what may leave the machine is
// still decided here, in one registry.
// ---------------------------------------------------------------------------

export const LOCAL_STORAGE_POLICY: Readonly<Record<string, SyncTier>> = {
  // Appearance and units — the settings people expect to follow them.
  "coros-theme": "preference",
  "coroslink.accentPalette": "preference",
  "coroslink.unitSystem": "preference",
  "coroslink.sportColors": "preference",
  "coroslink.startupView": "preference",
  // Which muscle layers the strength body map draws.
  "coroslink-strength-muscle-layers-v2": "preference",

  // Window chrome, sized to whatever display this machine has.
  "coroslink.sidebarCollapsed": "device",
  "coroslink.sidebarCollapsedGroups": "device",
  // A transient pick in the Apple Music browser.
  "coroslink.appleMusic.selectedPlaylistId": "device",
  // "I dismissed the prompt for version X" — about this install, not the person.
  "coroslink.updatePrompt.dismissedVersion": "device",

  // Reverse-geocoding results for the activity globe; refetched on demand.
  "coroslink.activity-globe.geo-cache.v1": "derived"
};

export const DYNAMIC_LOCAL_STORAGE_RULES: ReadonlyArray<{
  readonly pattern: RegExp;
  readonly tier: SyncTier;
  readonly description: string;
}> = [
  {
    // Every defineSelectionPreference() entry lands under this prefix: the
    // active tab, sort order, filter and layout choices across the app. No
    // credentials, and carrying them to a new machine is the friendlier
    // default.
    pattern: /^coroslink\.selection\.v1\..+$/,
    tier: "preference",
    description: "Per-view tab, sort, filter and layout selections."
  }
];

/** The tier for a localStorage key, or undefined when never classified. */
export function policyForLocalStorage(key: string): SyncTier | undefined {
  const literal = LOCAL_STORAGE_POLICY[key];
  if (literal) {
    return literal;
  }
  for (const rule of DYNAMIC_LOCAL_STORAGE_RULES) {
    if (rule.pattern.test(key)) {
      return rule.tier;
    }
  }
  return undefined;
}

/** Whether one localStorage entry leaves the machine. */
export function shouldSyncLocalStorage(key: string): boolean {
  return shouldSyncTier(policyForLocalStorage(key));
}

/** The policy for a table, or undefined when it has never been classified. */
export function policyForTable(table: string): TablePolicy | undefined {
  return TABLE_POLICY[table];
}

/** Whether a tier leaves the machine. Two do, and there is no setting, opt-in
 *  or flag that can add a third: `device` covers every credential, and it is
 *  the answer for anything nobody has classified yet. */
export function shouldSyncTier(tier: SyncTier | undefined): boolean {
  switch (tier) {
    case "personal":
    case "preference":
      return true;
    case "derived":
    case "device":
    case undefined:
      return false;
  }
}
