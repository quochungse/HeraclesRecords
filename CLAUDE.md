# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project context: this is a divergent fork

Heracles Records is a fork of the CorosLink vendor project, taken at `713084b` (v0.1.30).
It is intentionally diverging — screens and features are being redesigned toward goals that
differ from upstream CorosLink. Do not assume upstream conventions are targets to preserve.

Remotes:

| Remote | Purpose |
|---|---|
| `origin` | `quochungse/HeraclesRecords` — this project. Pushable. |
| `vendor` | `JunAkerBuilds/CorosLink` — upstream. `no_push`. Branch `vendor-main` tracks it. |

A third remote, `local-old`, pointed at the older local clone `~/Workspace/CorosLink`. It was
removed on 2026-08-28 once every one of its commits was confirmed present in `main` — the
`backup/*` branches were pre-rebase snapshots whose work landed under rewritten messages. That
directory still exists on disk, so the remote can be restored with
`git remote add local-old ~/Workspace/CorosLink`.

To review upstream changes: `git fetch vendor && git log --oneline main..vendor/main`.
Bring changes over by **selective cherry-pick after review** — never merge `vendor/main`
into `main` wholesale. Keep `vendor-main` pointing at pristine upstream so diffs stay honest.

The rename from CorosLink is complete, app identity included: `build.appId` is
`app.heraclesrecords`, no longer colliding with upstream's `app.coroslink`.

**Where userData lives — verify, never assume.** Electron's `app.getName()` reads the
**top-level `name`** field of package.json. This repo has no top-level `productName`;
`productName` sits under `build`, which is electron-builder config that Electron never reads
at runtime. So userData is `<appData>/heracles-records`, from `name` — not
`<appData>/Heracles Records`, and not anything derived from `appId`. `appId` only sets the
macOS bundle id and Windows AppUserModelID and has no say in where data lives.

This bit us once: a probe written with `productName` at the top level reported
`Heracles Records`, and a data migration was run into that folder — which the packaged app
never opens. The reliable check is the running app itself:
`pgrep -af heracles-records | grep -o '\-\-user-data-dir=[^ ]*'`.

The pre-rename `<appData>/coroslink` folder was copied into `<appData>/heracles-records` by
hand in August 2026 (SQLite via `VACUUM INTO` for a consistent snapshot; Chromium caches
skipped, so 1 GB became 88 MB). It is still on disk, untouched, and is no longer read. An
earlier `keepLegacyUserDataDirectory()` that pinned the app to it has been removed, so a
fresh install elsewhere starts empty by design — re-enabling that is not enough, the
migration would have to be rewritten.

**Watch Faces keeps CorosLink branding on purpose — do not "fix" it.** The community catalog
is vendor-run infrastructure at `watchfaces.coroslink.com`, so the `"CorosLink Faces"` kicker
in [WatchfacesView.tsx](src/watchfaces/WatchfacesView.tsx) and the
`user-agent: CorosLink/<version>` sent from
[communityWatchfaceService.ts](electron/communityWatchfaceService.ts) are credit to that
service, not leftovers. The same goes for the "Website" and "Support the project" links in
[ResourcesMenu.tsx](src/components/ResourcesMenu.tsx) and
[SettingsView.tsx](src/settings/SettingsView.tsx), which still point upstream. Only "Source on
GitHub" and "Report an issue" were repointed at this fork, because issues belong here.

**`website/` is left untouched, branding included.** `website/public/icon.png` and
`og-image.png` are still byte-identical to upstream's, and the site is not deployed from this
fork. Do not sync them to `build/icon.png` — the fork's icon changes stop at the desktop app.

Release identity **is** renamed: `build.publish` targets `quochungse/HeraclesRecords`, and
the `artifactName` patterns spell `HeraclesRecords` without a space on purpose — GitHub
accepts only `[0-9A-Za-z._-]` in release asset names, so a space would be rewritten on upload
and break the hand-built download URLs in [updaterService.ts](electron/updaterService.ts).
Those URLs and these patterns must change together.

## Commands

```sh
npm install
npm run rebuild          # electron-builder install-app-deps — rebuilds better-sqlite3 against Electron's ABI. Required after install.
npm run binaries:prepare # downloads pinned yt-dlp + copies ffmpeg-static into bin/<platform>-<arch>/
npm run dev              # Vite on 127.0.0.1:5173 + Electron; runs binaries:prepare and build:electron first
npm run build            # tsc electron (emits dist-electron) + tsc --noEmit renderer + vite build
npm start                # build, then run the packaged-style app
```

There is **no linter and no test runner**. Tests are ~91 standalone `scripts/test-*.mjs`
files using `node:assert/strict`, each wired to its own npm script. `npm run build` is the
only typecheck. CI (`.github/workflows/build.yml`, `release.yml`) **builds installers but
runs no tests** — nothing catches a broken test except running it.

Run a single test by its script name, e.g. `npm run test:chat-service`. To find the script
for a subject: `npm run | grep -A1 test: | grep <subject>`, or read the `scripts` block.

### The five test execution modes (and why each exists)

The mode is not cosmetic — picking the wrong one fails confusingly.

| Mode | Used when |
|---|---|
| `npm run build:electron && node scripts/test-X.mjs` | Test imports compiled main-process code from `dist-electron/*.js`. Most main-process tests. |
| `node --experimental-strip-types scripts/test-X.mjs` | Test imports renderer/shared `.ts` **with explicit extensions**. No build step needed. |
| `node --experimental-strip-types --import ./scripts/register-ts-ext.mjs ...` | Same, but the module graph has **extensionless** `.ts` imports; the hook resolves them. |
| `cross-env ELECTRON_RUN_AS_NODE=1 electron scripts/test-X.mjs` | Test touches SQLite. `better-sqlite3` is rebuilt for Electron's ABI, so plain `node` cannot load it. |
| `electron scripts/test-X.cjs` / `ELECTRON_RUN_AS_NODE=` (empty) | Test needs a real Electron window — canvas rendering, or the React renderer harness. |

Tests import compiled modules through `pathToFileURL(...) + "?cacheBust=" + Date.now()` to
defeat the ESM module cache between fixtures. Keep that when adding tests.

> **Bash-tool gotcha:** this environment injects `ELECTRON_RUN_AS_NODE=1`, so Electron never
> opens a window from a tool call. Prefix GUI launches with `env -u ELECTRON_RUN_AS_NODE`.
> Leave scripts that set or clear the variable themselves alone.

> **This machine's Node cannot run 26 of the tests.** `/usr/bin/node` v22.22.1 is a distro
> build compiled without Amaro (`node_use_amaro: false`), so every
> `--experimental-strip-types` script fails with `ERR_NO_TYPESCRIPT` — including
> `test:sport-colors`, `test:strength-*`, `test:watchface-studio`, and `test:mcp-*`. The
> `dist-electron` and Electron-runtime modes are unaffected. Fix by installing an official
> Node 22+ build (nodejs.org tarball or nvm), which ships Amaro; the distro package does not.

Hardware-free watch detection: set `COROS_WATCH_PATH=/path/to/mock-watch` (containing a
`Music` folder), or run `npm run smoke:watch`.

## Architecture

Electron app in three layers. `electron/` compiles to **CommonJS** (`tsconfig.electron.json`,
`module: Node16`); `src/` is an ESM React 19 + Vite renderer (`tsconfig.json`, bundler
resolution). Both are `strict`.

```
src/ (renderer, React)  →  src/coroslink-api.ts (types only, window.coroslink)
                        ↓
electron/preload.ts     →  contextBridge, ~254 ipcRenderer.invoke wrappers
                        ↓
electron/main.ts        →  ~254 ipcMain.handle registrations + app lifecycle
                        ↓
electron/*Service.ts    →  the actual work; electron/database.ts owns SQLite
```

### The IPC contract is a three-file invariant

A channel name is a bare string in `electron/main.ts`, `electron/preload.ts`, and
`src/coroslink-api.ts`. A typo in any one typechecks cleanly and fails only at runtime.
`scripts/test-ipc-surface.mjs` scrapes all three and asserts the sets match exactly in both
directions — a handler nothing invokes fails just as loudly as an invoke with no handler.

**Adding or renaming an IPC channel means editing all three files, then running
`npm run test:ipc-surface`.** Channels are namespaced `domain:verb` (`chat:`, `maps:`,
`trainingHub:`, `watchfaces:`, `coachAutomation:`, `trainingLibrary:`, …).

### Data

`electron/database.ts` is the single SQLite owner (`better-sqlite3`, in the Electron user
data dir). Schema is a `CREATE TABLE IF NOT EXISTS` block; **later columns are added through
`ensureColumn`, not by editing the block**, so a column can be absent on an old database and
NULL on a freshly migrated one. New tables are additive. Two hand-written migrations exist
for table rewrites (`migrateChatSessionProviderConstraint`, `migrateChatTranscriptsToSessions`).

### Feature domains

Each is a main-process service plus a renderer view. `src/App.tsx` lazy-loads the heavy
ones (Maps, Watch Faces, Training Hub, Training Library, Strength, Calendar, Coach, and the
dev-only Gear view); Overview, Media, Data, and Settings are in the main bundle.

- **Training Hub** (`trainingHubService.ts`, ~6.5k lines) — COROS `teamapi.coros.com` auth
  (password + 2FA ticket flow, multi-region base URL resolution), activities, analytics.
  The only component that sends credentials off-machine.
  **There is exactly one automatic login, and it runs once per launch.** COROS keeps a
  single live access token per account, so minting one kills the token every other machine
  holds — two computers that each re-logged in on an expired request took the session off
  each other for as long as both stayed open. So `restoreTrainingHubSessionAtStartup()`
  is the only silent login: it fires from `app.whenReady`, only when the session is *gone*
  and saved credentials remain, and cannot prompt (a 2FA account reports
  `two-factor-required` and waits for the Reconnect button). Mid-session, a dead token
  calls `endExpiredTrainingHubSession()` — clear the session, keep the credentials, throw.
  Do not put a re-login back on the request path. Both paths announce the new status
  through `setTrainingHubSessionListener` → `trainingHub:sessionChanged`, because the
  renderer asked for neither and would otherwise keep showing the status it last read.
  `npm run test:coros-session-restore` holds all of this down. The vault's owner is the
  COROS account, so startup sequences the re-login *before* `prepareSync()` and resumes
  the loop after one — see the block in `main.ts`.
- **Training Library** (`trainingLibraryService.ts`, `corosTrainingPlanAdapter.ts`) — workouts,
  plans, templates, plan↔activity adherence matching. React never calls COROS directly;
  it requests one `TrainingLibrarySnapshot`. See [docs/training-library-architecture.md](docs/training-library-architecture.md).
- **Coach** (`chatService.ts` + four providers: `claudeCodeProvider`, `anthropicChatProvider`,
  `openRouterProvider`, `localChatProvider`) — streaming chat with COROS-data tools
  (`chatActivityTools`, `chatAnalyticsTools`, `chatWorkoutTools`, `chatInteractionTools`)
  and MCP servers.
- **Coach Automations** (`coachAutomationService/Scheduler/Store.ts`, `coachActivityWatcher.ts`) —
  headless scheduled coach runs. Tied to the `app` lifecycle, not `BrowserWindow`. Auto runs
  are **read-only**: the tool allowlist excludes every write tool, and drafts land as approval
  cards. Heavily documented — [docs/coach-automations.md](docs/coach-automations.md) is the
  entry point, with eight companion files covering refusals, lifecycle, persistence, and
  test integrity.
- **Media** (`youtubeService`, `spotify*`, `appleMusic*`, `applePodcastsService`,
  `downloadQueue`) — everything funnels through bundled `yt-dlp` + `ffmpeg` to MP3, then to
  the watch's `Music` folder over USB.
- **Maps / Routes** (`mapService.ts`, `routeShareServer.ts`) — COROS map packages over USB;
  OpenRouteService for route generation, exported as GPX.
- **Watch Faces** (`corosWatchfaceService.ts`, ~4.1k lines, 41 renderer files) — the most
  intricate binary-format area; several tests need a real Electron window for canvas.
- **Strength** (`strengthHistoryService`, `hevyService`, `strengthSessionMerge`) — COROS
  strength sessions merged with Hevy imports.
- **Watch USB** (`watchService.ts`) — model fixture table drives detection; renderer polls
  status, so results are cached (`invalidateWatchStatusCache`).
- **Sync** (`electron/sync/`) — continuous two-way sync to a local folder or Google Drive,
  so two machines hold the same user data. `syncService` owns the destination and nothing
  else; `syncLoop` owns the oplog (append-only per-device change log, merged by HLC
  last-writer-wins); `fullState.ts` republishes everything at once, which is what seeds a
  vault on first join and what makes a restore visible to the other machines.
  `syncableStore.ts` is the shared floor both this and backup read rows through, so a record
  is identified the same way on every path. Six rules the rest of the app depends on:
  - **Sync carries user data. No credential leaves the machine, down any path.** Every
    token, API key and account sign-in is `device` tier, there is no opt-in that changes it,
    and nothing unwraps a credential for transport. An earlier design did carry a few
    (`portableSecrets.ts`, and `corosSessionShare.ts` shared one COROS session between
    machines behind a lease); both were removed in September 2026 because the session story
    needs designing on its own rather than riding on a backup checkbox. Do not reintroduce
    either without that design — `test-sync-policy.mjs` fails if a `secret` tier or an
    `includeSecrets` flag reappears, and `test-backup-restore.mjs` asserts the payload has no
    field one could travel in.
  - **`syncPolicy.ts` is the only place that decides what may leave the machine.** Every
    setting, table and localStorage key is classified `preference` | `personal` | `derived` |
    `device`. An unclassified key syncs nowhere. Both the backup path and the oplog path
    gate on it, and the renderer imports the same registry rather than copying it.
  - **Inbound changes must not echo back out.** `SqliteSyncTarget` and `applyBackup` write
    through `requireDatabase().prepare(...)`, never through `setSetting`, so merged entries
    skip the `syncBridge` hooks and cannot bounce between two devices forever. localStorage
    cannot use that trick — the write happens in the renderer — so `localStorageSync.ts`
    folds inbound values into the published snapshot instead.
  - **The vault is obfuscated, not encrypted.** Every write goes through
    `ObfuscatedProvider`; reads open what arrives sealed and pass anything else through, so
    a folder written before sealing became unconditional still reads. The AES-256-GCM key is
    derived from a constant in `syncObfuscation.ts` and ships in every build. It keeps a
    training diary out of Drive's content indexing and folder previews and does nothing
    else — read that file's header before describing it in any UI copy, and never treat it
    as a reason to store something you would otherwise refuse to.
  - **A vault belongs to one COROS account, and that is checked before anything else.**
    `dataOwner.ts` fingerprints `trainingHub.userId` with an HMAC — the id itself is `device`
    tier and never travels; only the fingerprint does. `vault/id.json` carries it, and doubles
    as the reachability probe so one read answers reachability, identity and ownership
    together. The states are in `SyncVaultState`: `signed-out` (no account, reported ahead of
    the destination — sync needs to know whose records it is merging before it needs to know
    where they go), `wrong-owner` (left completely alone; two accounts merged into one log
    cannot be separated, there being no owner on each record), plus an unclaimed vault that
    the first signed-in machine to `prepare()` takes. `claimVault()` is the deliberate
    override, and it clears `sync.seededVaultId` — same vault id, so without that the machine
    would think it had already published and the account taking the vault would have none of
    its data in it. `prepare()` is the only path that starts a loop, and signing out of COROS
    calls it so the loop stops. **This is a guard between machines and files, not a data
    partition**: the tables have no owner column, so switching accounts on one machine leaves
    the previous account's records in place. Closing that means giving every row an owner.
  - **A device only ever writes inside its own `oplog/<deviceId>/` directory**, which is why
    the storage layer needs no locking. Exclusivity is needed for two things only, and each
    takes a `Lease`: running a scheduled automation (`automationLease`) and compacting the
    log (`syncLoop.compactIfDue`).

- **Backup / Restore** (`electron/backup/`) — a separate feature from sync, deliberately.
  One file the person saves where they like (`backup:export` opens a save dialog) and reads
  back when they want it (`backup:choose` then `backup:restore`). No list of backups, no
  "latest", no lineage: that bookkeeping belonged to the vault model, where backups lived
  inside the sync folder, and it answered a question a file does not raise. Plain JSON, not
  obfuscated — the vault seals what it writes; a file the person chose the home of should
  open in any editor. A restore is `replace` (the file decides in full) or `merge`
  (additive, `INSERT OR IGNORE`, nothing removed), and the choice is only put to the person
  when `hasSyncableData()` says there is something to lose — the built-in MCP server row
  every fresh install writes does not count. Restoring publishes the result to the oplog
  through `republishAfterRestore`, or the other machines would never learn of it.
  The file is sealed with the same envelope as the vault (`.hrbackup`), for the same single
  reason and with the same caveat — read `syncObfuscation.ts` before calling it encrypted
  anywhere. Its AAD is a constant, **not** the path: a backup is meant to be renamed and
  moved, and binding it to where it was written would make renaming it lose the data.
  `readBackupFile` opens what arrives sealed and passes anything else through, so the plain
  JSON that earlier builds wrote still restores.
  Ownership works the same way as the vault's and is enforced in the service, not the dialog:
  no account signed in refuses both directions (`BackupSignedOutError`, asked *before* the
  file dialog opens rather than after), a file from another account refuses with
  `BackupOwnerMismatchError` unless `allowOtherOwner` is passed from a second confirmation,
  and a file with no owner at all reads as `unknown` and restores — refusing every older
  backup would be a data-loss decision taken on the user's behalf.

  A packaged build needs `HERACLES_GOOGLE_OAUTH_ID` / `_KEY` for Drive to be offered at all.
  `scripts/prepare-google-client.mjs` bakes them into a git-ignored generated module before
  every `tsc` run, reading a repo-root `.env` when the environment is empty; a build from
  source gets empty values and the UI disables the Drive option. Both CI workflows pass them
  to every platform job — keep it that way, or one platform ships without Drive.

### Testability convention in the main process

Long-running main-process components take an injected `Deps` interface with a
`createDefaultDeps()` fallback (`coachAutomationService`, `coachAutomationScheduler`,
`coachActivityWatcher`). Suites inject fakes. The consequence, stated explicitly in the coach
docs: **`createDefaultDeps` is code no suite can reach** — wiring a new dep there is untested
by construction. Wire it where a test can see it.

### Renderer

`src/App.tsx` is a ~7.9k-line monolith holding view routing and most cross-cutting state.
`src/navigation/primaryNav.ts` defines `PrimaryView`; the Gear view is dev-build-only
(`import.meta.env.DEV`).

Styling is plain CSS with custom properties — no Tailwind, no CSS modules.
`src/styles.css` (~33k lines) holds the design tokens and most rules; six feature
stylesheets sit beside their components (strength ×2, gear, watchfaces, training-library,
overview). Themes are `dark` | `paper` via `src/theme/`, persisted to localStorage,
and `THEME_WINDOW_BACKGROUND` must stay in sync with `--bg-base`. Sport colors live in both
`src/styles.css` and `src/training/sportColors.ts` (the source of truth) —
`npm run test:sport-colors` asserts they match.

## Releases

`npm run release:prepare -- v0.1.31` syncs the version into `package.json` and the lockfile,
then prints the commit/tag/push commands. Tag pushes trigger `release.yml`, which re-checks
that the tag and `package.json` agree before building. `verify-release-artifacts.mjs` gates
the updater metadata per platform.
