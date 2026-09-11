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
| `cross-env ELECTRON_RUN_AS_NODE=1 electron scripts/test-X.mjs` | Test touches SQLite. `better-sqlite3` is rebuilt for Electron's ABI, so plain `node` cannot load it. **Also the fallback for a strip-types test on a Node without Amaro** — Electron ships one that has it, so `--experimental-strip-types` (and the resolver hook, where the graph needs it) can ride along. A test taking this route for that second reason says so in its header, or it reads as a SQLite test. |
| `electron scripts/test-X.cjs` / `ELECTRON_RUN_AS_NODE=` (empty) | Test needs a real Electron window — canvas rendering, or the React renderer harness. |

Tests import compiled modules through `pathToFileURL(...) + "?cacheBust=" + Date.now()` to
defeat the ESM module cache between fixtures. Keep that when adding tests.

> **Bash-tool gotcha:** this environment injects `ELECTRON_RUN_AS_NODE=1`, so Electron never
> opens a window from a tool call. Prefix GUI launches with `env -u ELECTRON_RUN_AS_NODE`.
> Leave scripts that set or clear the variable themselves alone.

> **This machine's Node cannot run the 28 tests launched by plain `node
> --experimental-strip-types`.** (Recount with `grep -c '"test:[a-z0-9-]*": "node
> --experimental-strip-types' package.json` rather than trusting this number.)
> `/usr/bin/node` v22.22.1 is a distro build compiled without Amaro
> (`node_use_amaro: false`), so every one of them fails with `ERR_NO_TYPESCRIPT` —
> including `test:sport-colors`, `test:strength-*`, `test:watchface-studio`, and
> `test:mcp-*`. The `dist-electron` and Electron-runtime modes are unaffected, which is
> why a handful of strip-types suites are launched through Electron instead
> (`test:sync-preferences`, `test:training-load-bars`, `test:distance-zones`,
> `test:globe-framing`, `test:hr-zone-model`). Fix by installing an official Node 22+
> build (nodejs.org tarball or nvm), which ships Amaro; the distro package does not.

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

### `rendererReady` gates everything main pushes unasked

`webContents.send` before React has subscribed reaches nobody, and the two things main pushes
without being asked — sync writes merged from another machine, a COROS session restored at
start-up — each carry the only copy of what they say. So both wait on `rendererReady`, which
the renderer raises itself through **`app:rendererReady`**; `did-finish-load` cannot stand in,
because the page having loaded says nothing about whether listeners exist.

This flag was raised from inside `watchfaces:consumeCommunityOpenRequest`, which App.tsx only
calls on a development build — so **no packaged build ever raised it**, and every such push was
dropped for the life of the process. It typechecks, throws nothing, and never shows up in a dev
run. What it did show up as: a start-up re-login minting a session the window never heard about,
leaving it with no data, no sign-in form, and nothing to do but restart. Keep the flag on its
own channel, keep the renderer's call out of any build-conditional path, and keep it deferred a
tick past mount so subscriptions declared below it are attached first.
`npm run test:renderer-ready` asserts all four and fails in four places against the old shape.

### The IPC contract is a three-file invariant

A channel name is a bare string in `electron/main.ts`, `electron/preload.ts`, and
`src/coroslink-api.ts`. A typo in any one typechecks cleanly and fails only at runtime.
`scripts/test-ipc-surface.mjs` scrapes all three and asserts the sets match exactly in both
directions — a handler nothing invokes fails just as loudly as an invoke with no handler.

**Adding or renaming an IPC channel means editing all three files, then running
`npm run test:ipc-surface`.** Channels are namespaced `domain:verb` (`chat:`, `maps:`,
`trainingHub:`, `watchfaces:`, `analysis:`, `trainingLibrary:`, …).

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
  `two-factor-required` and waits for the Reconnect button).
  **"Gone" is asked of COROS, not of the settings table.** A force-logout happens on
  their side and never touches this machine, so the four `trainingHub.*` keys survive it
  intact — a start-up that only read them answered `already-signed-in`, skipped the one
  login it exists for, and left the athlete on a signed-in screen until some request
  failed and dropped the session with no way back until the *next* launch. So start-up
  probes the stored token first (`checkStoredTrainingHubToken`, a read against
  `/activity/query` — it mints nothing, which is what makes it safe here where a login
  is not). Only `dead` clears and re-mints; `live` and `unknown` are left alone, and
  an unreachable COROS must stay `unknown` or every offline launch throws away a working
  session. `1019` is the code a token killed elsewhere comes back as — it is in
  `AUTH_ERROR_CODES` so detection does not rest on COROS's English message.
  Two things about COROS's own envelope, both verified against the live API and both
  previously wrong: **`apiCode` is not always a status field** (on `/account/query` it is a
  request trace id, so a successful read arrives as `{apiCode: "420BE2BB", data: {…}}` with
  no `result` at all), and **`/account/query` has no "current account" form** — without
  `accountid` it answers `1019` to everyone, a live token included, which left a region
  probe candidate and a `userId` fallback silently dead. So `getTrainingHubResultCode` takes
  only a four-digit `apiCode` for a status; `parseTrainingHubApiResponse` and
  `isTrainingHubSuccess` read an *unstated* status as success when data arrived and failure
  when nothing did (that is what stops `allowEmptyData` waving through a `{}`); and every
  account read goes through `corosAccountQueryUrl`. `npm run test:coros-api-envelope` holds
  this down — it fails in four places against the pre-fix code.
  Mid-session, a dead token
  calls `endExpiredTrainingHubSession(deadToken)` — clear the session, keep the credentials,
  throw. Do not put a re-login back on the request path.
  **It takes the token that failed, and only a session still holding it may be dropped.**
  Requests are in flight across a whole launch and the token under them gets replaced while
  they fly: the renderer starts loading the instant it mounts, with whatever is on disk,
  while start-up is finding that same token dead and minting a replacement. Those loads
  then fail — they were always going to — and clearing unconditionally wiped the *new*
  session on the way past, so a launch that had just signed itself back in landed on the
  sign-in screen anyway. Measured on a real kicked session: login completed at 1983ms, the
  stale reply landed at 5564ms and took the fresh token with it. That is what made closing
  and reopening two or three times look like a fix — sometimes the stale replies got home
  first, when the session was already cleared and nothing was left to clobber.
  **`TrainingHubStatus.restoring` is how the renderer tells the two signed-out states
  apart**, and the pair of fields is what decides, never `restoring` alone. The flag goes up
  before the token is probed — the probe is a round trip and the renderer mounts inside it —
  so `restoring` is also true on every ordinary launch's check. `authenticated && restoring`
  means "only double-checking, load normally", so a good token costs the launch nothing;
  `!authenticated && restoring` means "signing back in, sit tight" and is the only state
  that shows the restore panel and holds back the load. `finishStartupRestore` lowers the
  flag *before* announcing, a `finally` lowers it on any escape (a flag left standing leaves
  the surface waiting forever), and the `already-signed-in` exit deliberately announces
  nothing — the flag coming down changes no screen, and an announcement there would cost
  every launch a second full reload. In the renderer, `reportTrainingHubError` re-reads the
  status before surfacing a COROS failure: the optimistic first load can still go out on a
  doomed token, and "COROS session expired. Log in again." is worse than noise while the app
  is logging itself back in. Both paths announce the new status
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
  (`chatActivityTools`, `chatAnalyticsTools`, `chatSleepTools`, `chatWorkoutTools`,
  `chatInteractionTools`) and MCP servers.
  The read tools are built to fetch only what a question is about: the activity list takes a
  date window and a sport family and returns per-sport totals, `get_activity_detail` takes a
  `sections` list, trends and sleep take `days` and roll up by week past 14, and
  `get_sleep_summary` takes a `night` for one night's HRV course. Each formatter computes its
  own totals and deltas so the model reads them rather than doing the arithmetic.
  `get_training_zones` answers with the account's own HR, pace and power tables, so a
  prescribed target is read off the athlete's thresholds rather than inferred from recent
  activities; the snapshot carries the thresholds themselves, the body metrics and the
  all-time personal records, all of which were already being fetched every turn and dropped.
  `narrowCorosMcpTools` hides two kinds of COROS MCP tool: one a local tool supersedes (only
  while that local tool is on offer) and one no chat turn can act on at all (FIT downloads,
  devices, COROS's own activity write-up). A new local tool must be placed on one side of
  `READ_ONLY_ALLOWED_TOOLS` or `test:coach-analysis-guards` fails, and must be given a
  source in `LOCAL_CHAT_TOOL_SOURCES` (`chatToolSources.ts`) or `test:chat-tool-sources`
  fails. The badge under an answer groups the tools a turn called by that source — **DB**
  (this machine's store), **Coros** (the Training Hub API) or **MCP** (a connected server,
  recognised by its `server__` prefix). Every call travels as `kind: "mcp"` on the stream,
  which is why the badge once said "MCP" for a turn that only read the Training Hub API; an
  unlisted local tool would fall back to that label.

  **A transcript entry is rebuilt field by field in four places, and an unlisted field is
  dropped in silence.** `PersistedChatMessageEntry` declares it, `parseMessageEntry`
  (`chatHistoryStore`) restores it off disk, and `toPersistedEntries` / `fromPersistedEntries`
  (`src/chat/chatTypes.ts`) convert it in each direction. Miss one and the field works
  perfectly until the conversation is reopened — the same shape of trap as the IPC
  three-file invariant, minus the test that catches it at build time. This has now caught
  attribution (5.6) and the per-answer cost footer, whose `usage` and `model` come from
  `chat:streamDone`; that payload was already sending `usage` before `ChatStreamDone` declared
  the field, so the renderer could not read what it was being handed. Both leave the turn
  unpriced rather than reading zero when a provider reports nothing — see `ChatTokenUsage`.
  `test:chat-turn-cost` drives the round trip and the formatting.

  **Anything that re-reads the transcript flushes this window's pending save
  first — it must never cancel it.** Nothing is written during a turn: the
  autosave is held down while `streaming`, the question is saved at send time
  and everything else only when the turn ends. So between those two moments the
  row is the transcript as it was *before* the turn, and a read taken there
  comes back without it. `reloadTranscript` used to cancel the pending save and
  then show what it read, which cost an athlete a whole turn in a packaged
  build: a sync pull defers its re-read to the end of the turn
  (`syncReloadPendingRef`), landing it in exactly that window, and the turn had
  ended without final text — so the pending save was the only copy of the
  charts on screen. They vanished a moment after arriving and reopening the app
  did not bring them back. Flushing protects both sides, because the save
  carries the base it was built with and 5.6b's merge still holds back a tail
  an analysis run appended — which is all the cancel was ever protecting.
  `test:chat-transcript-race` drives it in a real window and fails on the
  cancel; `test:coach-analysis-runner` keeps both rules of 5.6b stated together.

  **`foreignTail` decides by content as well as position.** It appends the part of
  the row past `knownEntryCount`, on the theory that anything there was written
  behind the window's back. A stale count breaks the theory: the window is then
  *sending* those entries, and appending them wrote them twice — one conversation
  replays eight entries of its own history, two chart cards sharing a `previewId`
  among them, which surfaced as React's "two children with the same key" on
  opening it. So the longest head of the tail that the caller's (normalized) array
  holds anywhere past the count is dropped — *anywhere past*, not only at its end,
  because a stale count is usually followed by newer turns, and an ends-with test
  finds no overlap there and duplicates the tail one turn later. A run's genuine
  append matches nothing the window holds and is still kept. Rows written before
  this are not rewritten, which is why the preview rows key on `previewId` *and*
  position. `test:chat-history-store` (3b, 3b', 3c) fails on the position-only and
  the ends-with guard; `test:chat-transcript-race` renders a duplicated row.

  **A turn that errors after producing output keeps it.** `chat:streamError` used to
  undo the whole turn: the streamed text, any question card it had just asked, and —
  through `restoreResumedCoachPrompt` — the athlete's choice on the previous card,
  which went back to unanswered and was persisted that way. Claude Code's
  `maxTurns: 10` lands on exactly the round after a question, so the loss looked
  like this: pick a choice, watch the full answer arrive, then see it vanish while
  the old card reappeared (answered cards are not drawn, so a reset one reads as the
  coach's next question). Now the partial answer, the new card and a "Coach stopped
  before finishing" notice are kept and saved, and the answered card stays answered;
  only a turn that produced nothing is undone. `streamedTextRef` exists for this —
  `streamingText` is state, stale inside the subscription.

  **Rows a turn's settle mounts do not animate in (`ChatRow`, `.is-settled`).**
  `chat-row-enter` and `chat-avatar-pop` start from `opacity: 0` with `fill-mode:
  both`, so a row is invisible until its animation runs, and it only runs while the
  window gets frames. A settle swaps the streaming bubble for freshly mounted rows,
  so the answer the athlete had just watched arrive was faded in again from
  nothing — measured over CDP at `opacity: 0` 100 ms after every turn — and on a
  GNOME Wayland window that had stopped getting frames the whole new turn stayed
  invisible until a scroll or click produced one. Two details are load-bearing:
  the marker is **identity** (`settledEntriesRef`, filled by `markSettled` inside
  the settle's updater), not a flag lowered by an effect, because React flushes
  the last token render's pending effects before rendering the settle; and the
  row **holds** it in state from mount, because a class recomputed per render
  disappears on the next reload and changing `animation` restarts it.
  `test:chat-transcript-race` fails on either shortcut. When checking a paint bug
  over CDP, trust `getComputedStyle` read *before* `Page.captureScreenshot` — the
  capture forces a frame and finishes the animation it was meant to catch.

  **A tool schema is sent on every request round, so the draft schemas do not branch per
  sport.** `buildDraftTrainingPlanInputSchema` used to `oneOf` over all nine sports, and since
  a repeat group carries steps of its own, the step schema appeared twice per branch: 67 kB
  across the two draft tools, ~33.7k tokens re-sent every round of every conversation,
  including ones that never mention a workout — 80% of the whole fixed per-turn context.
  It is now one workout shape with one step definition, and the per-sport rules live where
  they already were: `validateWorkoutDraftShared` refuses a wrong kind, target, intensity or
  sport option per step and the draft tools hand those errors back to the model, while
  `buildCoachSportCapabilityGuide` states the same table as prose in the system prompt.
  `test:chat-workout-tools` guards the size (< 20 kB per schema) and `test:workout-intensity-codec`
  asserts the refusals come from the validator. Collapsing the step's last copy needs
  `$defs`/`$ref`, deliberately not used on the main write path: not every provider resolves a
  `$ref` well when *writing* arguments.
- **Coach Analysis** (`coachAnalysisService/Scheduler/Store.ts`, `coachActivityWatcher.ts`) —
  headless coach runs. Tied to the `app` lifecycle, not `BrowserWindow`. Auto runs are
  **read-only**: the tool allowlist excludes every write tool, and drafts land as approval
  cards. [docs/coach-analysis.md](docs/coach-analysis.md) is the entry point;
  [docs/coach-automations.md](docs/coach-automations.md) and its eight companions are the
  **pre-refactor** record — accurate about the run pipeline, the guard rails and the cost
  model, wrong about the data model, and each says so in a banner.

  **One analysis lives in exactly one conversation, and that is the whole model.** A
  `CoachAnalysis` is a role, a playbook, a runtime, a `sessionId` it cannot change, and —
  optionally — the trigger that makes it fire on its own. It is created *from* a
  conversation ("Create Auto Analysis"), opened from a **⋯** on its row, and deleted with
  the conversation. There is no definition/attachment split, no attach step and no screen
  listing every analysis — a list spanning conversations would be a list of unrelated
  things. Two earlier shapes existed; both are gone, and reintroducing either has to be a
  decision rather than a merge (`test:ipc-surface` fails on a channel or bridge method
  spelling `Attach`).

  Four things to know before touching this:

  **Nothing in the feature creates a chat session.** The runner's `createTargetSession`
  and `setBindingSession` were deleted, not disabled. An analysis names a conversation the
  athlete opened; deleting it removes the analyses inside it
  (`applyAnalysisSessionDeleted`). Reaching the runner with the conversation gone means
  the two got out of step, and the analysis is switched off rather than removed — a delete
  on what may be a race has no way back.

  **"This device only" is a separate table, and it had to be.** `syncPolicy` classifies
  whole tables, the oplog carries whole rows (`SELECT *`) and a merge is `INSERT OR
  REPLACE` — so a column withheld from a payload arrives on the other machine as NULL,
  meaning *deleted*, not *unchanged*. A private trigger therefore lives in
  `coach_analysis_local_triggers` (`device` tier); the analysis still travels and reads as
  manual over there. Turning the flag on must clear the row's `trigger_json` and turning
  it off must delete the local row, or one copy silently shadows or outlives the other.
  `readTrigger`/`writeAnalysis` in the store are the only places that know which side a
  trigger is on.

  **The old tables are dropped, not migrated.** `dropLegacyAutomationTables` removes
  `coach_automations`, `coach_automation_bindings`, `coach_automation_local_triggers` and
  `coach_automation_runs` with their rows. There is no honest mapping: an automation
  attached nowhere has no conversation to become an analysis in, and one attached three
  times would become three the athlete never wrote. **Conversations are untouched** —
  including every answer an automation wrote into one, which is a `chat_sessions`
  transcript entry and keeps its chip. `npm run test:analysis-legacy-drop` drives that
  against a hand-written old-shape database, and is **its own file** because
  `initializeDatabase` returns the process's existing database: a drop test sharing a
  process with another database test silently tests nothing.

  **Two stored spellings are pre-rename on purpose.** The `app_settings` keys
  `coachAutomation.pause` / `coachAutomation.monthlyTokenBudget` (already in other
  machines' vaults under those names), and the `automation` / `automationId` keys inside a
  stored chat entry — every transcript an athlete has spells them that way, and renaming
  either costs historical runs their attribution.

  The pause and the monthly budget live in **Settings → Analyses**
  (`ChatSettingsPanel`): they are feature-wide and the screen that used to host them is
  gone, so without a home a paused world would have no Resume button.

- **Media** (`youtubeService`, `spotify*`, `appleMusic*`, `applePodcastsService`,
  `downloadQueue`) — everything funnels through bundled `yt-dlp` + `ffmpeg` to MP3, then to
  the watch's `Music` folder over USB.
- **Maps / Routes** (`mapService.ts`, `routeShareServer.ts`) — COROS map packages over USB;
  route generation exported as GPX. Routing is **keyless by default** (BRouter + Nominatim);
  OpenRouteService is an opt-in backend a power user enables by saving their own key, and
  `resolveRouteBackend()` falls back to keyless unless both the opt-in and a key are present.
  **Base map styles all live in `ROUTE_BASE_LAYERS` (`src/maps/routes/constants.ts`) and must
  stay keyless** — the app holds no map provider key, offers no field to enter one, and bakes
  none into the build, so a style that needs one is not a degraded map, it is no map.
  `light` and `dark` are **OpenFreeMap vector styles rendered by MapLibre**, not raster tiles.
  They were CARTO's `light_all`/`dark_all` until August 2026, when CARTO began answering
  keyless requests with a perfectly valid 200 PNG that has "API KEY REQUIRED" printed across
  it — a watermark, not an error, which is why nothing in the app noticed and why checking a
  provider by status code proves nothing. Both theme-driven screens (Overview map, activity
  detail map) resolve to those two ids through `themeBaseLayer(theme)`, so both wore it.
  `npm run test:base-layers` fails on a key-shaped endpoint, on anything pointing back at
  CARTO, and on `light`/`dark` ceasing to be vector.

  Three things hold the vector path up, and all are load-bearing:
  **`createBaseLayer` (`baseLayers.ts`) is the only way to build a base layer** — raster or
  vector — so no screen has to know which kind it asked for, and every base map lands in the
  `heraclesBasemap` pane (z-index 190, below Leaflet's `tilePane`) where trail overlays and
  route lines always draw on top. That pane replaced the `bringToBack()` calls the raster-only
  code needed on every swap; a vector layer has no `bringToBack()` to call.
  **It also binds the map's max zoom, and that is not decoration.** Leaflet reads a zoom limit
  off a layer in exactly one place — `GridLayer.beforeAdd` — so a raster base map bounded the
  map for free, while `L.maplibreGL`, a plain `L.Layer`, bounds nothing and `getMaxZoom()`
  falls back to `Infinity`. That is not merely "zooms too far": `fitBounds` clamps to
  `getMaxZoom()`, so a route whose points share one spot resolves to zoom `Infinity`, the
  pixel origin goes infinite with it, and every polyline collapses to `M0 0` — a blank map on
  the two screens whose *default* style is vector. `createBaseLayer` calls `setMaxZoom` for
  both kinds, which is also why the trail overlays carry `maxNativeZoom` rather than
  `maxZoom`: an overlay must stretch its last tile, not drag the base map's zoom limit down.
  **One-way arrows are corrected here, not taken as given** (`onewayArrows.ts`). OpenFreeMap's
  `oneway` sprite icon is drawn pointing up, while MapLibre rotates a line-placed icon so the
  icon's *horizontal* axis follows the line — so an unrotated icon lands across the road
  instead of along it. Their own `bright` style compensates with `icon-rotate` 90/-90;
  `dark` ships 0/180, so every arrow sat perpendicular to the street, and `positron` omits the
  layers entirely, so the two themes disagreed about whether one-way streets are shown at all.
  `applyOnewayArrows` replaces whatever arrow layers a style ships — removing and re-adding at
  the same position — rather than patching `icon-rotate` on them, because rotation is not the
  only thing the styles disagree on: `dark` ships no road-class filter, so a rotation-only fix
  left it drawing arrows on paths and ferries that `positron`, built from the one description,
  never shows. It runs on `style.load`
  and **must not be gated on `isStyleLoaded()`** — that reads false while the style is still
  settling, and gating on it drops the fix with no second chance (it was written that way once;
  the arrows stayed wrong and nothing failed). `npm run test:oneway-arrows` fails on the 0/180
  the upstream style ships, and in three more places against a rotation-only fix.

  And **MapLibre v6 needs `setWorkerUrl()` with Vite**: it spawns its worker from a URL the
  bundler cannot statically see, so no worker chunk is emitted and the URL arrives empty,
  resolving back to the page itself. The failure is silent and misleading — the map builds,
  `styledata` fires, tiles arrive 200, `areTilesLoaded()` says true, and the canvas paints
  the style's background colour and nothing else, while the console blames a
  "non-JavaScript MIME type text/html". `import workerUrl from
  "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url"` is what makes it emit; do not remove
  that import because it looks unused.
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
    takes a `Lease`: running a scheduled analysis (`electron/sync/automationLease.ts`,
    named before the rename) and compacting the
    log (`syncLoop.compactIfDue`).
  - **A pull tells the renderer which tables it wrote, and a view re-reads its own.**
    `sync:changed` used to carry two counts, which say something arrived but not what — so a
    screen had two moves, reload everything or reload nothing, and nothing is what shipped:
    a Coach conversation written on the other machine sat in SQLite while the sidebar kept
    the list it read on mount, and the Sync panel told the athlete to restart.
    `SyncChangedEvent.tables` (from `tablesTouched`, which names `table` entries and skips
    `setting`/`localStorage` keys) is what makes a listener selective. Everything a pull
    produces is **queued** in `pendingSyncChange` rather than passed to `sendSyncChanged` as
    arguments: the loop follows the app, not the window, so a pull can land before the
    renderer is listening, and an argument has nowhere to wait — which is how the counts used
    to be lost outright. `markRendererReady` delivers the queue. `ChatView` is the first
    subscriber; it holds a re-read back while the athlete's own turn is streaming, because
    the timeline on screen is the newer copy then. `npm run test:sync-changed-fanout`.

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
`createDefaultDeps()` fallback (`coachAnalysisService`, `coachAnalysisScheduler`,
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
