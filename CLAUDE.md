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

**Three screens upstream has were removed here on 2026-09-18: Maps, Watch Faces and Gear.**
Fork divergence, not a refactor to finish — there is nothing half-done to pick up, and a
cherry-pick that touches any of them has to be judged against that decision rather than
merged. Gone with them: `mapService`, `routeShareServer`, `electron/routing/`,
`corosWatchfaceService`, `communityWatchfaceService`, `legacy614a`, `fontService`, 71 IPC
channels, the `generated_routes` and `cached_coros_maps` tables (dropped on open by
`dropRetiredMapTables`, with `<userData>/map-cache`, `routes`, `watchface-*` and
`community-watchface-imports` swept by `removeRetiredFeatureStorage` in main.ts), the
`coroslink://` deep link and its `open-url`/`second-instance` plumbing, the Web Bluetooth
chooser, and the macOS location entitlement. **The base map code survived the Maps screen
and moved** — see `src/mapBase/` below. So did reverse geocoding, as `places:reverseGeocode`
(`reverseGeocodeService.ts`), because "Where you've been" names its clusters with it.

**The "Website" and "Support the project" links still point upstream on purpose** —
[ResourcesMenu.tsx](src/components/ResourcesMenu.tsx) and
[SettingsView.tsx](src/settings/SettingsView.tsx). Only "Source on GitHub" and "Report an
issue" were repointed at this fork, because issues belong here.

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
npm run fonts:fetch      # re-downloads the three faces into src/assets/fonts + rewrites src/fonts.css. Not part of a build: the files are committed so a build never needs the network.
npm run body-shapes:fetch # regenerates src/calendar/bodyShapes.ts from react-native-body-highlighter (MIT). Same rule as fonts: the output is committed, the package is not a dependency, and a build never runs this.
npm run dev              # Vite on 127.0.0.1:5173 + Electron; runs binaries:prepare and build:electron first
npm run build            # tsc electron (emits dist-electron) + tsc --noEmit renderer + vite build
npm start                # build, then run the packaged-style app
```

There is **no linter and no test runner**. Tests are ~143 standalone `scripts/test-*.mjs`
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

> **A Node built without Amaro cannot run the 14 tests launched by plain `node
> --experimental-strip-types`.** (Recount with `grep -c '"test:[a-z0-9-]*": "node
> --experimental-strip-types' package.json` rather than trusting this number.)
> The Linux box's `/usr/bin/node` v22.22.1 is a distro build compiled without Amaro
> (`node_use_amaro: false`), so every one of them fails there with `ERR_NO_TYPESCRIPT` —
> including `test:sport-colors`, `test:strength-*` and `test:mcp-*`. The `dist-electron` and Electron-runtime modes are unaffected, which is
> why a growing set of strip-types suites are launched through Electron instead —
> list them with `grep -o '"test:[a-z0-9-]*": "cross-env ELECTRON_RUN_AS_NODE=1
> electron --experimental-strip-types' package.json`, and say so in the test's own
> header when that is the reason. Fix by installing an official Node 22+
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
electron/preload.ts     →  contextBridge, ~212 ipcRenderer.invoke wrappers
                        ↓
electron/main.ts        →  ~212 ipcMain.handle registrations + app lifecycle
                        ↓
electron/*Service.ts    →  the actual work; electron/database.ts owns SQLite
```

### `rendererReady` gates everything main pushes unasked

`webContents.send` before React has subscribed reaches nobody, and the two things main pushes
without being asked — sync writes merged from another machine, a COROS session restored at
start-up — each carry the only copy of what they say. So both wait on `rendererReady`, which
the renderer raises itself through **`app:rendererReady`**; `did-finish-load` cannot stand in,
because the page having loaded says nothing about whether listeners exist.

This flag used to ride along on a Watch Faces deep-link channel that App.tsx only called on
a development build — so **no packaged build ever raised it**, and every such push was
dropped for the life of the process. That screen is gone; the trap is not. It typechecks, throws nothing, and never shows up in a dev
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
`npm run test:ipc-surface`.** Channels are namespaced `domain:verb` (`chat:`,
`trainingHub:`, `analysis:`, `trainingLibrary:`, `places:`, …).

### Data

`electron/database.ts` is the single SQLite owner (`better-sqlite3`, in the Electron user
data dir). Schema is a `CREATE TABLE IF NOT EXISTS` block; **later columns are added through
`ensureColumn`, not by editing the block**, so a column can be absent on an old database and
NULL on a freshly migrated one. New tables are additive. Two hand-written migrations exist
for table rewrites (`migrateChatSessionProviderConstraint`, `migrateChatTranscriptsToSessions`).

**An activity detail is a file, not a row, and it is validated by fingerprint.** One COROS
detail is ~2.5 MB of JSON — 98% of it the sample series — so `activityDetailCache.ts` writes
it to `<userData>/activity-details/<owner fingerprint>/<activityId>.json.br` (brotli quality
5: 131 KB in 25 ms against gzip 9's 139 KB in 70 ms, measured on a real run) and only the
~130-byte summary reaches SQLite. Three rules hold it up.
**COROS's activity list carries no version field of any kind** — probed field by field on
the live API; the one upload stamp that exists, `lastUploadTime`, is inside the detail, so
reading it costs the request the cache exists to avoid. What the list does carry is every
summary figure COROS recomputes on an edit, so `activityDetailFingerprint` hashes those —
`name` included, because renaming a run rewrites the payload — and the hash is stored inside
the file. `sportName` is excluded: the app fills that in locally, so including it would
re-fetch every detail on every launch.
**Every detail read goes through `loadActivityDetailRaw`**: the run screen, the calendar, the
globe, the coach's tools and the three backfills. A second call site would be both uncached
and unvalidated, so `test:activity-detail-cache` asserts `/activity/detail/query` appears
exactly once in the service. The backfills pass `persist: false` — they read one field out of
2.5 MB, and opening a run is what earns it a file. The feel backfill also passes `fresh: true`:
a feeling is set in the COROS app days later and moves no list figure, so a cached file would
answer "unrated" forever. **The fingerprint is hashed from the stored mirror row**, falling
back to the caller's list row only when the mirror has none — the summary check and the
sweeps have no list row, and two sources let a stale renderer array write a file that the
next sweep read as stale and deleted. A payload with none of `summary`/`lapList`/
`frequencyList`/`graphList`/`zoneList` is neither cached nor summarised: COROS's `data: {}`
parses as success and would otherwise be permanent.
**Nothing about the file may enter the row.** `training_activity_summaries` is `derived`, and
a column saying "cached, 131 KB" would reach another machine as a promise it cannot keep if
it were ever reclassified — the trap `coach_analysis_local_triggers` exists to avoid. The
directory is its own bookkeeping: size from `stat`, last use from `mtime` (touched on every
hit, because relatime makes `atime` useless), and a 500 MB cap swept oldest-first with
orphans — files whose run is in no list — taken first, once at start-up and after each write.
Unreadable files are deleted on read and abandoned `.tmp` writes after an hour. A run deleted at COROS is therefore
collected rather than detected: `1001 Service exceptions` is what COROS answers both for an
activity that is gone and for one it could not serve this minute.
The maths a summary is built from lives in `electron/activityMetrics.ts`, which the renderer
imports directly (like `unitSystem.ts`), so the drift in a list column and the drift on the
page it opens cannot disagree. **It must stay free of `node:` imports** or the renderer build
breaks; the suite asserts that too.
**The parsed detail does not carry the payload it was parsed from.** `raw` used to ride along
on `TrainingHubActivityDetail`, so ~2.2 MB of JSON — measured, uncompressed — crossed the
context bridge every time a row was selected, for a development-only "Show raw JSON" modal that
was its only reader. That modal has its own channel now,
`trainingHub:getActivityDetailRaw`, which goes through `loadActivityDetailRaw` like every other
read and so adds no COROS request; `test:activity-detail-cache` counts its callers and names
each one. Do not put the payload back on the detail to save a round trip.

### Feature domains

Each is a main-process service plus a renderer view. `src/App.tsx` lazy-loads the heavy
ones (Training Hub, Training Library, Strength, Calendar, Coach, Where you've been);
Overview, Media, Data, and Settings are in the main bundle.

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
- **Training Library** (`trainingLibraryService.ts`, `corosTrainingPlanAdapter.ts`) —
  **two entities, two tabs**, and the workouts tab splits **40 / 60** between the list and
  the reader — the list is a name and two counts, the pane beside it draws a whole step
  structure. A workout is one session with no date; a plan is a multi-week
  schedule of them. They share four attributes (name, tags, favourite, archived) and not one
  figure, so they are two tabs rather than one list with a facet. React never calls COROS
  directly; it requests one `TrainingLibrarySnapshot`.
  **A plan is a COROS plan, and nothing else** (rebuilt 2026-09-24, spec
  [docs/training-plan-coros-first.md](docs/training-plan-coros-first.md)). Every real save goes to
  COROS through `plan/add` / `plan/update`; the app is where the buttons are and the account is
  where the data is. What this machine keeps is a **draft** — an edit in progress,
  `training_plan_drafts`, `personal` tier so it follows the athlete between machines — and the
  app's own metadata (`training_plan_metadata`: tags, favourite, archived, `origin` user/coach).
  `coros_plan_cache` (`device`) paints the list at once and stands in offline; every write reads
  `detail` again first. **There are no local plans**: `dropLocalTrainingPlans` drops
  `training_plans` and `training_plan_workout_links` on open, keeping a COROS plan's tags,
  favourite and archived flag and dropping local and coach rows outright — the sessions they had
  put on the calendar are ordinary COROS workouts and stay; the migration calls nothing on COROS.
  **Things this screen had and no longer has, each removed on purpose:** local plans and the
  "Local Copy" fork, calendar installs (`calendarInstalls`, `writeMayHaveSucceeded`, a partial
  state), rest days, notes, the holding area, free-named phases, a goal and a difficulty —
  **COROS stores none of them** (`eventTags` on a plan are answered `0000` and dropped; a stage is
  one of seven values) — plus collections (no COROS endpoint knows one), and the Templates,
  Adherence and All tabs. `dropRetiredCollectionTable` runs on open too.
  **The model is cut to what COROS stores** (`TrainingPlanDocument`): `id` is `coros:<remoteId>` or
  `draft:<uuid>`; `remoteVersion` is COROS's `version`, compared before a write; a session has a
  week, a day (0 = Monday), an order, a typed `workout` and — read from COROS — its raw
  `corosProgram` (written back byte for byte unless the session is edited) and `idInPlan`;
  `weekStages` are COROS's seven (0 Not Set … 6 Transition). `calendar` is `unscheduled` for a
  plan and `running`/`finished`/`stopped` for COROS's running copy of one. **A plan's length is COROS's**:
  `totalDay` is the last session's day + 1, so trailing empty weeks do not survive a save and
  the editor warns about them. More than ten sessions on a day is an error (COROS's limit).
  **Saving** (`savePlanToCoros`): a changed plan on COROS since the edit began is a conflict the
  athlete answers (Replace with my edit / Save as a new plan / Keep editing); a plan COROS deleted
  meanwhile is saved as a new one; the plan is read back and the draft is let go only if every
  session came back. Only a session written here is priced through `/training/program/calculate`;
  a kept one goes back with its own program. **Duplicate is `plan/copy` then a rename** ("X Copy"
  — COROS's copy keeps the name). **Deleting a plan on the calendar takes it off first**, or one with
  a copy running, so nothing is left scheduled from a plan that is gone: the confirmation says so
  ("Remove from calendar and delete"), the renderer passes `takeOffCalendar`, and the service
  `quitSubPlan`s the running copy, deletes the plan and then the copy — never deleting anything if
  the removal failed, and refusing outright when the flag is absent.
  **Opening a plan reads it; editing is a button on the reader.** `PlanReader` draws from the
  snapshot already in hand and asks COROS for nothing (a COROS plan deepens in the background,
  and that failure is silent because it only refines what is already readable). The editor's
  draft lives in the view rather than in the editor, so leaving the tab no longer throws the
  work away — the tab strip used to be *disabled* while editing, which prevented navigation
  rather than surviving it. **Every open reads `/training/plan/detail` again** — one request;
  `/training/plan/query` is every plan with every program, and it is asked for only when a detail
  arrives without programs — and the answer replaces the copy in the reader *and* the list,
  unless its `version` is older than the one held (COROS raises it by one per update; the cache
  takes the same rule). Edit and Duplicate wait for that read (`loadingFull`) only when the copy
  in hand lacks the programs a save writes back, which the list endpoint leaves out for a plan
  written here. A plan read on its own is joined to its running copy through the cache
  (`findCachedRunningCorosPlan`), as the snapshot joins the list, so the reader keeps its
  calendar mark and does not offer to add it again. The cache holds the document only — every
  write reads the plan from COROS first, so COROS's own payload would be a copy nothing reads.
  Edit waits while a
  duplicate is made (`duplicating`), because the reader moves to the copy when it lands.
  **The editor is the reader with handles on it** (`PlanEditor`): the reader's title (a bordered
  field), description, figures, ridge and week cards, every week drawn, with **COROS's stage
  picked per week** in its header. Save goes to COROS; **Save draft** keeps it here, and a draft
  sits where the plan does rather than in a section of its own (`attachPlanDrafts`): a new
  plan's draft is a tile among the plans, marked **Draft**, that opens straight into the editor
  (whose Discard draft is the way to let it go); edits kept for a plan mark that plan's tile
  **Editing**; its reader shows **Continue editing** outside the ⋯ — one way into the editor,
  drawn filled, and Edit leaves the ⋯ while it is there — and its ⋯ leads with Clear editing.
  Otherwise Edit is the ⋯'s first item. A plan holds one draft, and Save draft replaces it. Editing a running copy changes the
  calendar at once, and the editor says so. **A day's `+` is a menu** — New session (Create
  workout's builder, opened on the plan's own sport with the sport picker in place, headed "New
  session" over the plan and the day, and asking about unsaved edits with the plan's own
  `ConfirmDialog` through `confirmDiscard`) and From workout library (a picker that reads the
  workout's program from COROS through `libraryWorkoutAsPlanSession`, because a COROS plan holds
  its own copy of every program rather than a link to the library).
  **Every workout is written in one builder** (`src/calendar/WorkoutBuilder.tsx`, rows in
  `workoutBuilderRows.ts`): Create workout (Calendar and Library), a plan session new or edited
  (`WorkoutBuilderModal`, applied through `editorDraftToPlanWorkoutInput` as before) and **Edit
  workout** in the Library (read by `getWorkoutForEdit`, saved and verified by `saveWorkoutEdit`, with
  COROS's `previewWorkoutEdit` load beside the totals). A session and a library workout had a second
  editor, `WorkoutEditorModal`, with its own defaults, validator and layout; that modal is now only
  the Calendar's (a scheduled occurrence, and its read-only view of a library workout). An existing
  workout keeps its sport — stated where the picker would be, never a locked dropdown. **A row read
  from a workout remembers its node (`BuilderRow.origin`) and an untouched row writes that node back
  byte for byte**: a row holds display strings (km to three places, pace as `m:ss`), so re-encoding
  would drift it, and it would drop what the builder has no field for — a step's own name, a
  strength step's instructions, a send-off, and the `sourceExerciseId` that makes
  `workoutDraftToCorosProgram` update a COROS exercise in place. A changed step keeps its identity
  and only what still belongs to it (same kind, same exercise); a step the builder cannot represent
  arrives `locked` and passes through; a zone somebody chose keeps its heart-rate family
  (`keepBasis`) until it is changed. `npm run test:workout-builder-rows` holds all of it, and the
  builder's validator skips an untouched row so a strength workout nobody edited is not held to the
  exercise catalog loading. A session carries one
  control, its ⋯ (Edit, Move to…, Duplicate, Copy to next week, Delete), plus Alt + arrows and
  Delete from the keyboard; a copy is a new session to COROS (`copiedEntry` drops its
  `idInPlan`, and the write sends its program without `planId` and `star`, as the web app
  sends a new session).
  Three rules the suites hold: a session's name keeps a readable width inside a day column, and
  the problems that block Save are listed at every width; **a rule that styles a library control
  must name all four scopes** — `.training-library-view`, `.tl-plan-modal-backdrop` (the editor
  is portalled there), `.tl-dialog-backdrop` (the builder portals to `<body>`, and the discard
  question it asks through the plan's `ConfirmDialog` sits outside both) and
  `.coach-sheet` (Coach's per-conversation settings and a plan brief's screen reuse the
  generator's sheets, portalled to `<body>`) — or the control draws as the platform's grey button. Coach's canvas (`CoachCanvas`, `.chat-canvas`) reads plans with the
  reader's week cards and takes the library's **tokens** block as a fourth scope, but no control
  rule, since it edits nothing; without the tokens its day wells drew as the browser's black
  dashed border. And the editor's shortcuts listen on the window, gated on `layer`,
  because an undo remounts the focused session and a handler on the editor's element then hears
  nothing. Calendar actions are not in the editor (they need a saved plan); saving lands on the
  reader. A new plan opens **named** (`defaultPlanName`: "New
  plan", numbered past the library's) with the name selected. A dialog over the portalled editor
  (the save conflict) is portalled to `<body>` as well, or the view's stacking context holds it
  underneath.
  **The week ridge picks what it measures** (`ridgeMeasure`): load where every week holding a
  session has some, else hours where every one is timed, else a count — load whenever *any* week had
  some drew one bar over a plan of unpriced library workouts. The tile's small ridge reads the same
  measure, so it and the ridge it opens onto agree. Each bar of the reader's is **stacked by sport**
  in the hues the sessions wear (`weekRidgeSegments`), with a legend past one sport, and the stages
  run as a band under the bars, coloured by `[data-stage]`.
  The arithmetic is `planEditorModel.ts`; `test:plan-editor-model`, `test:plan-editor-renderer`.
  **A session opens inside the reader, not over it** (`PlanSessionView`): the weeks give way
  to the session, Escape steps back one layer (the session catches it before the sheet does),
  and the scroll and focus return to the row. Its body is `WorkoutReadOnlyBody`, fed
  `planWorkoutInputToEditorDraft(entry.workout)` — the view the Workouts tab and the Calendar
  draw, not a third renderer. That converter defaults a step with no `kind` to `training`
  like every other reader of these steps, because plans written before the field was required
  are still on disk and an `undefined` name unmounts the screen on its first `.trim()`. A
  duration is stated only when every step is timed (`durationComplete`):
  the figure is a sum of `target_duration_seconds`, so a run written in distances summed its
  jogs to nine minutes and a 31 km week to "0.1 hours".
  **A week is seven columns when its card is wide enough** — a container query on
  `.plan-week-card`, not a media query, because the reader is a 980px sheet rather than the
  window — and the list below that; every day is rendered and `is-empty` hides only in the
  list. A running plan folds the weeks before this one to a line (sessions, done, missed),
  opens scrolled to this week and marks today's column. The ridge (`PlanWeekRidge`) is drawn
  past two weeks only; each bar is a button that jumps to its week. The reader is a dialog, so
  its head opens with a close (X), not a back arrow, and its actions sit at the right edge
  reading inward: **Add to calendar** (the one filled button, `.plan-reader-add-calendar`),
  Continue editing when edits are kept, ♥, ⋯. A plan already on the calendar shows **On
  calendar** in that place instead — a success-ink pill (`.plan-reader-scheduled`), a statement
  and not a control. Edit, Remove from calendar, Duplicate, Archive
  and Delete are behind the ⋯. The Workouts reader's Edit is a quiet ghost button.
  Its scroll is a thin thumb at the sheet's edge with the rail's measured edge fade
  (`has-fade-top`/`has-fade-bottom`). A kept session's "Planned and done" opens its activity
  through `onOpenActivity` (App: Running or Strength by sport type, Activities for everything
  else).
  **The calendar is COROS's running copy of a plan** (`executeSubPlan`), which COROS keeps in step
  with the calendar both ways: moving a session on the calendar moves it in the copy, and editing
  the copy moves the calendar. **The app's own move is not COROS's**: `rescheduleScheduledWorkout` adds the
  session to the athlete's own calendar and deletes the original, so a plan session moved that way
  leaves the copy and its compliance with it (measured on the live account, 2026-09-26).
  A plan session moves through `plan/update` on the running copy, which keeps its `idInPlan`;
  removing one with `schedule/update` status 3 takes it out of the copy too, so a delete stays in
  step. One `schedule/update` is all or nothing (`17004` for the whole request). Two things COROS does without a word, which
  `TrainingPlanCalendarDialog` states before anything is written: **it counts the plan from the
  Monday of the week the start day is in, and leaves off every session before the start** (a
  Wednesday start loses week 1's Monday and Tuesday), and **it never checks the calendar** (a day
  that holds a workout gets the plan's too). The month picker opens on the next Monday and
  `previewPlanOnCalendar` is read again on every pick; it refuses a past start, a second run of a
  plan already running, a run of a running copy, a plan with no sessions and a start that keeps
  none. Whether a plan is already running is answered there from the cache (`runningInstanceId`) —
  `/training/plan/query` is the heaviest thing COROS serves — and asked of COROS afresh by
  `executeNativeCorosPlan` just before the write, which refuses a second run itself. "Remove from calendar" is `quitSubPlan` on the running copy, asked of either side — it
  takes the plan's sessions and nothing else. **COROS gives a removed run `executeStatus 2`, the
  status of one that ran out**, and moves no `version`; only `endDay`, set to the day of removal,
  tells them apart. So the copy reads as `stopped`, never `finished`, and **a stopped run is not
  listed** (`listedPlans`): COROS refuses `executeSubPlan` on it (1031), so there is nothing left
  to do with it, and the plan it came from, where there is one, is the row. A running copy is
  listed however its plan fares on COROS, for tracking; when that plan is gone (deleted, or the
  run was applied from COROS's catalogue — `runOutlivesItsPlan`), "Remove from calendar" warns that
  the run leaves the list and offers **Duplicate first**. A cached copy kept at an equal version
  takes its calendar state from the list, or a removal would never reach it. **Saving an edit to a plan with a copy running asks
  whether the calendar follows** — Keep editing / Save plan only / Save & update calendar
  (`requestSave`) — because a save to the plan does not touch the copy. Updating is **not**
  `plan/sync`: measured on 2026-09-25, a session moved in the plan and synced stayed on its old
  day. `syncPlanToCalendar` rewrites the running copy through `plan/update` instead
  (`planOntoRunningCopy`), which moves, adds and removes on the calendar in place — and only from
  today on: a session on a day gone keeps what the copy holds, one before the run's start day is
  left off. A change made on the calendar from today on is lost; the question says so. The question
  is asked at the save because anywhere else it is left to memory. The choice survives a save
  conflict's "Replace with my edit"; "Save as a new plan" has no calendar to update. A running copy whose plan is in the list folds into that plan's row
  (`groupPlans`), or one plan is listed twice; one whose plan is not — applied in the COROS app
  from a catalogue plan — stands on its own. **Whether a plan is on the calendar is
  `PlanCalendarBadge`** — a mark before the name on the tile, the hero and the reader title,
  sized in `em`, read from `calendar === "running"` or `runningInstanceId`, the same test that
  picks Add or Remove in the ⋯. Compliance joins a running copy's `remoteId:idInPlan` to
  `schedulePlanId:scheduleIdInPlan` on a match, which is exactly what a calendar session carries,
  and a plan reads its figures off its running copy.
  **A Coach plan stays in the conversation until it is saved** — a chat plan draft
  (`chat_plan_drafts`), not a library draft, and not listed on the Plans tab. The card's Training
  Plan destination saves it to COROS as one plan (`origin: "coach"`, the coach's `description` as
  the overview, its `week_stages` as COROS's). **Edit plan first opens the plan editor over the
  conversation** (`CoachPlanEditor`, lazy with the library's stylesheet) and a save is the
  creation's **next version**, by the athlete, through `chat:editPlanDraft` (a workout through
  `chat:editWorkoutDraft` from `CoachWorkoutEditor`) — dates kept from the coach's first Monday,
  an undated plan's arrangement kept as `layout`; the version it replaced is left as it was. A
  save begun on a version since replaced answers `conflict` and writes nothing until the athlete
  picks Replace with my edit / Keep the newer version / Keep editing (`NewerVersionDialog`,
  `replaceNewer`). The new card carries `editedAt`, and the edit leaves a **`planEvent`** — with
  an Undo while its version is the newest, which restores the one before — where it happened — an anchor kind, stated to
  the coach once on the athlete's next message by `toWireMessages` — rather than the whole plan
  restated on every turn. **Every turn, chat and analysis, carries `creationIndex`**
  (`chatContextCompaction.ts`): a line per creation still in the conversation, its newest
  version's draft id, who made it and whether it is saved, read from `chat:planArtifacts` because
  every version is a card and a row of its own. The coach reads one back with `get_plan_draft` and
  changes one with `revise_training_plan` — operations, not the plan again — which writes the next
  version and folds the old card to a line; a read-only run may do neither of the writes
  (docs/coach-plan-canvas.md, P1.1–P1.3). **A plan saved to COROS stays the conversation's to
  change** (P1.6): the version keeps the plan as COROS read it back, keyed as the coach keyed it,
  and a later version carries its COROS identity — the plan's id and version, each session's
  `idInPlan`, and the untouched sessions' programs — so its primary button is **Update COROS
  plan** (`plan/update`, checked against the version it was made from, a conflict asked as the
  Library asks it). A saved one-off workout is not changed from the conversation: nothing on
  COROS would be updated. **A change made on COROS comes back** (D12, `syncPlanDraftFromCoros`):
  before an edit or a revision, and from the plan cache when the canvas opens, a creation whose
  newest version is the saved one is read against COROS; a newer COROS copy becomes its newest
  version (`author: coros`, saved, sessions re-keyed to the coach's keys by `idInPlan`) with a
  `planEvent`, and a plan deleted there leaves a version with no COROS identity, saved next as a
  new plan. An unsaved version is never synced over: it is checked when it is sent. **It goes on
  the calendar from the conversation** through the Library's own `TrainingPlanCalendarDialog`
  (`CoachCalendarDialog`): an unsaved version is previewed as `chat:<draftId>`, which
  `previewPlanOnCalendar` reads through a reader the chat registers (`setChatPlanReader` — the
  two modules must not import each other), and is saved first, once. The card says where it
  stands from `chat:planCalendarState` — the running copy in `coros_plan_cache` and the stored
  matches, no request — in the Library's own compliance words (`creationCalendar`).
  **A question can point at what it is about** (P1.7): Ask Coach on the canvas — the plan, a
  week (`WeekCard.onAsk`) or the session open — puts a chip by the composer, and sending it
  writes a **`planRefs`** anchor just before the question, which `toWireMessages` folds into that
  question for the model. The Library reader's ⋯ offers **Ask Coach about this plan** for a plan
  Coach wrote, opening the conversation it came from (`chat:findDraftSession`, by any version's
  draft id) — or, when that conversation is gone, a new one with no chip, since the drafts went
  with it. **Under a creation, follow-ups** (P1.8): the chips Coach offered with that version
  (`suggested_refinements`, kept in the row's `refinements_json`) or a set that fits its kind
  (`refinementChips`); a press sends the chip's words as a question about the creation.
  **Coach may attach up to two workout cards unasked** (P1.9, `chat.coach.inlineSuggestions`:
  Automatic — on for the Claude providers, off for the rest — On, Off), decided for the provider
  a turn actually runs on and said in words only (`INLINE_SUGGESTIONS_GUIDE`); the cost footer is
  where an answer that overdoes it shows.
  **An upload COROS stops part-way through is not retried whole** (`PartialUploadError` from
  `uploadTrainingPlan`, which writes one session per request): the error names the sessions that
  landed, and a second press writes only the rest.
  **A draft is read from its row every time, never from a copy held in memory**
  (`loadStoredPlanDraft`): a row changes behind the process — another machine saves the creation
  and the pull marks it uploaded — and a cached copy let this machine `plan/add` it a second time.
  Saves are serialised per creation (`savingArtifacts`) and reads against COROS shared per
  creation (`corosSyncsInFlight`); a version answered after the athlete moved to another
  conversation is not appended there (`appendVersion` takes the conversation it was asked from).
  **A creation is read in the canvas** (`CoachCanvas`,
  lazy with the library's stylesheet), which replaced the Creations list and its popup: the
  index of creations, or one open beside the conversation — a sheet over it below 1100px — with
  the reader's ridge, week cards and session view, a version picker, a Versions tab whose lines
  come from `electron/planDiff.ts` (node-free, shared with `restorePlanDraftVersion`'s
  `planEvent`), and Restore, which writes the old content as a new version. Its buttons and the
  card's come from one function, `artifactActions`. The composer is a container
  (`chat-composer`), because the canvas narrows the conversation on a wide window too.
  Drafts are deleted with their conversation; the 24-hour prune is gone.
  **AI Plan opens Coach; the plan generator dialog is gone** (P2.5 of
  docs/coach-plan-canvas.md). The Library's AI Plan button calls `onOpenCoach({ newPlan: true })`,
  and Coach starts a conversation named "New plan" on a blank brief (`chat:createPlanBrief`, the
  form's defaults from the next Monday, no model asked), renamed after the goal once the brief has
  one. From there the plan is the conversation's pipeline — brief, outline, sessions, described
  under Coach below — and the plan it writes is a Coach creation, not a library draft.
  `TrainingPlanGenerator`, its outline and run steps, `trainingLibrary:generatePlan`/`outlinePlan`,
  the in-memory `generatedDrafts` and `trainingPlanFromDraftPreview` were removed with it; a library
  draft an older build's generator kept is an ordinary library draft. What survived is what the
  brief and the steps reuse: `GeneratorGoalStep`, `GeneratorWeekStep`, `GeneratorProviderPanel`,
  `planGeneratorModel.ts`, `planGeneratorRuntime.ts` and `runTrail.ts`.
  The rules live in `electron/trainingPlanGeneration.ts` (no `node:` imports; the form reads them
  too): **a generated plan starts on a Monday and counts Monday-to-Sunday weeks**; a usual week is
  a **band** of sessions (flex days may be used or not); race day holds the race whatever the day
  usually is. Both steps' tools check what they are handed *inside* the turn and hand the reasons
  back (`planOutlineProblems`, `generatedPlanProblems`), where the checks used to run after the turn
  and throw away the whole plan over one short week, and a plan written to an outline takes the
  outline's stages. **A run's own tools are `runTools` in `chatService.ts`**: a run adds tools and
  withholds others by request id, consulted where every provider builds its list and again in
  `executeChatTool`, *before* the policy. **What the athlete does not share is withheld twice** —
  from every tool that reads it (local, and COROS MCP's by what its name says,
  `toolReadsWithheldSource`) and from the snapshot the turn starts from (`buildTrainingContext`'s
  scope); a switch that only edited the prompt would be a lie. "From my data" needs the activities.
  **`npm run dev:simulate-plan-ai` runs both steps without a provider** (`HERACLES_SIMULATE_PLAN_AI=1`,
  `trainingPlanSimulation.ts`): a script in the model's place streams thinking and announced reads,
  then hands its outline and plan to the *real* tools, so the checks, the store and COROS all run as
  they do for a real turn. Its first draft is a session short on purpose, to show the check's
  hand-back. It reads nothing and says so, in its thinking and in the plan's name.
  `test:training-plan-simulation` holds that the script passes the checks for every shape of request
  and runs both steps through `streamConversationTurn`; `test:training-plan-generation` and
  `test:plan-generator-model` hold the rules and the form's arithmetic.
  **A plan saved from COROS's official catalogue is written in localization keys** —
  `name: "P10035"`, sessions `P10281`, descriptions `P11058`, steps `T1120` — which the
  Training Hub web app resolves against a string table on its CDN
  (`static.coros.com/locale/coros-traininghub-v2/en-US.prod.js`, keyless, 7,326 keys, vue-i18n
  syntax, so `{'@'}` means `@`). `corosLocale.ts` fetches it into
  `<userData>/coros-locale/`, refreshes weekly, and `corosText` swaps a whole value that is a
  key and nothing else; `nativePlanToDocument` and the library workout names go through it.
  Three more facts that conversion got wrong on the same plan: **every program arrives with
  its `exercises`**, even from the list endpoint, and were being dropped (so no COROS session
  had steps) — they now go program → editor draft → plan input, the editor's own path, and
  `readNativeCorosPlan` no longer re-fetches a program that already has them (87 requests to
  open one plan); **a program's `distance` is centimetres** (a 3.5 km run read as 356 km); and
  **`totalSets` counts steps** on anything but strength. A catalogue plan is not locked
  (`officalConfig.isOffical: 0`), so it saves like any other.
  `npm run test:coros-official-plan` holds all of it; `npm run test:coros-plan-writes` holds the
  write bodies, every endpoint, and the library's saves, calendar and Coach flows against a fake
  COROS that keeps what it is sent; `npm run verify:coros-plan-api -- --live` repeats the round on
  the real account with temporary data.
  The renderer-side arithmetic is in `planFilters.ts`, `planCompliance.ts`, `planReaderModel.ts`,
  `planEditorModel.ts` and `planDraft.ts`, outside the components for the reason
  `activityFilters.ts` sits outside `ActivitiesView`. Two rules they exist to state: compliance is
  `undefined` rather than 0% for a plan not on the calendar, and a session with no match has **no
  status** rather than "upcoming". `planEntryMetrics` is exported from `trainingPlanDomain.ts` so
  the row's total and the reader's per-session figures cannot disagree.
  **The workout list states what the list row carries, and nothing it would have to ask for.**
  Probed field by field against the live API on 2026-09-22: `/training/program/query` answers
  with a trimmed row where `trainingLoad`, `essence`, `estimatedValue`, `duration`, `distance`
  and `estimatedDistance` are **all `0`**, which is why an hour's easy run reads back as a
  volume of `"1 set(s)"` — `formatUpcomingWorkoutVolume` sees no distance and counts sets
  instead. What the row does fill in is `exerciseNum`, `totalSets` and `estimatedTime` — the
  last equals the detail's own `duration` exactly — so `TrainingHubLibraryWorkout` carries
  `exerciseCount`, `setCount` and `durationSeconds`; the list's columns are **Workout /
  Exercises / Sets**, and the plan editor's library picker states the time. All three are there
  in the first paint with no second request. The head that came before, "Workout / Total", stood
  over the COROS volume string and so named a column that was lying.
  **A training load is a different matter: only `/training/program/calculate` reports one, and
  only for a step that carries an intensity target.** Measured: `0` for all six strength
  sessions in this library and for a distance-only 8 km run, `193` for the same run given a
  pace band and `104` given a heart-rate band. `/training/program/detail` stores `0` even where
  `calculate` would answer `193`. So "Load is always 0" is mostly COROS's own answer, and there
  is no way to obtain one without a `calculate` POST per workout — which is why no column is
  labelled `Training load` to draw "—" down the whole library. The detail is fetched per visible
  row anyway, for the row's session shape (`WorkoutDetail` in `WorkoutWorkspace.tsx`); nothing
  else is asked of COROS.
  `toProgramFigure` states the rule the rest of `trainingHubService.ts` already followed by
  hand: **on a COROS program a `0` is a field that was not filled in**, so a `??` chain over
  these must not stop at one — which is what left `resolveUpcomingWorkoutLoad` unable to reach
  either of its fallbacks and `previewFromProgram` unable to reach `estimatedTime`.
  **The list's header is the list's, and the workouts tab has no selection.** The filter chips,
  the search and the sort sat above the split, so controls that narrow a list were laid out over
  the pane the list opens; the chips and the search are the column's header now.
  **The sort went with them, and the list is in name order.** The dropdown offered `Name`,
  `Duration` and `Training load`, and two of those three could not order anything: the figure
  a sort by either reads lives on the detail, which arrives a few rows at a time as tiles
  scroll into view, so the list re-ordered itself under the reader while it was being read —
  and until a row's detail landed the sort fell back to the list row, where COROS answers `0`
  for both. Name is the one key every row carries in its first paint, and a library is a list
  of names. Reintroducing a figure sort means fetching the detail for the whole library first,
  which is one request per workout.
  **A name too long for its column ends in an ellipsis, and that needs its own box.**
  `.tl-row-name` is the flex line — the favourite heart, then the name — and `text-overflow`
  acts on a block's own inline content, while the text of a flex container is an anonymous
  flex item. The rules sat on the flex line, so a long name was cut flat at the column edge
  with nothing to say it had been; they belong on `.tl-row-name-text`.
  The head is a **sibling of the
  scrolling list, not the first thing inside it**: sticky within the scroller it stayed put, but
  the scrollbar is the scroller's own and ran the full height, so a thumb slid past a row that
  does not move. `.tl-catalog > .tl-index-head` reserves the same gutter with `scrollbar-gutter:
  stable` over `overflow: hidden` — measured, that takes the same 15px off its content box as a
  real scrollbar does, which is what keeps each label over its own figures.
  **The reader's dock is one row, and scheduling is a button in it.** Scheduling had a row of
  its own above the four actions — an icon, a heading, a date field and a button, standing open
  across the whole dock for a decision that is made once and then not again. It is a trigger at
  the head of the row now, beside Edit, and Delete still sits apart at the far end on its
  `margin-left: auto`. What opens is a **month grid**, not an `<input type="date">`: the native
  field is drawn by the platform rather than by this app, and it says nothing about the week a
  session would land in, which is the thing being decided. `MonthDayPicker` builds it from
  `monthGridWeeks` (`src/calendar/dateUtils.ts`), so a day here and the same day on the calendar
  screen cannot fall in different weeks. The panel opens **upward** — the dock is the bottom
  edge of the reader — and is dismissed by a press outside it or by Escape **in the capture
  phase**, for the reason `OptionGroup` takes it there. It is exempt in `test:option-groups` as
  a grid whose arrangement is the control.
  `tomorrow()` now reads the local clock through `keyFromDate` rather than
  `toISOString().slice(0, 10)`, which reports the day in UTC — a morning east of Greenwich came
  back as today, so the earliest day the picker offered was one already half spent. The state it
  feeds is a COROS happen-day key (`yyyyMMdd`) end to end, so nothing reshapes it on the way to
  `scheduleLibraryWorkout`.
  The checkbox went from the tiles: the rows in the list layout never had one, so a selection
  could only be made in tiles and every bulk action was reachable from half the screen — which
  took the bulk toolbar and its JSON export too. Tagging and deleting are the reader's, acting
  on the workout on screen.
  **Three dead facts are gone rather than left saying nothing: the reference line, the
  `Most used` sort and `lastUsedAt`.** "Not referenced by a plan or a calendar day" was a
  constant — both counts match the workout's COROS program id against other records and neither
  match can land: nothing in the renderer writes a plan entry's `programId` from a library
  workout (the plan editor builds its sessions inline, and the only non-null ones come from an
  imported COROS plan, whose sessions are plan-internal programs with ids of their own —
  verified, no library id appears in any plan in this store), and COROS stores a scheduled
  workout as its own copy under its own id. So every tile read "Unused" and `Most used` ordered
  by one constant. `usedByPlanIds`, `scheduledCount` and `lastUsedAt` are off
  `TrainingLibraryWorkout`; the `last_used_at` column and `TrainingWorkoutMetadata.lastUsedAt`
  stay, because that table syncs and nulling a column on every save would rewrite the value on
  every machine. Tying a library workout to the plan or the day that used it needs a link
  recorded at the moment of use, which is a change to what is stored rather than to what is
  read — reintroducing any of these starts there.
  See [docs/training-library-architecture.md](docs/training-library-architecture.md).
- **Activities** (`src/training/ActivitiesView.tsx`) — the all-sport log: every session COROS
  has, in one list, with a detail pane beside it. It is the only screen some sports ever
  reach — Running covers sport codes 100–103 and Strength 400/402, so a ride, a hike, a swim
  or a Hybrid Fitness session has no other home — and the only one that can compare sports
  against each other, which is what the summary's mix bar is for. Depth per sport belongs on
  Running and Strength; **a link out carries the session, not just the screen** — Activities
  hands a `SportScreenRequest` to `App.tsx`, which holds it until the lazy screen mounts and
  takes it (Running opens its full-page detail; Strength selects the row, widening its own
  window first if the session predates it).
  The arithmetic is out of the view on purpose, because it is the only part a test can reach:
  `activityFilters.ts` (periods cut at a Monday, sport categories, search, week grouping,
  totals), `activityFacts.ts` (which figures a row shows, per sport) and `activityDetail.ts`
  (whether a loaded detail belongs to the current selection). `npm run test:activity-filters`
  covers all three.
  What is left is geometry, and `npm run test:activities-renderer` mounts the summary strip in
  a real window for it: the mix bar's tooltip must name one sport, must not move what is under
  it, and must stay inside the bar at both ends — the 1% sliver at the far right is the case
  that put it off the screen. Note that `activities.css` is imported by `ActivitiesView`, not
  by the pieces it is built from, so a harness mount of one of those has to pull it in or it
  measures unstyled boxes and passes.
  `ActivitySeriesChart` + `activityChannels.ts` + `useActivityDetailSummaries.ts` are shared
  with Running and were moved out of `src/running/` for that — none of them ever asked what
  sport they were reading. Anything else that both screens need goes the same way rather than
  being copied.
- **Workout defaults** (`electron/workoutDefaults.ts`) — what a step holds before
  anyone types. `workoutCapabilities.ts` says what a step *may* hold; this says where
  it starts, and the two are different questions. `emptyRow` used to answer the second
  with the empty string, so **a step was invalid the moment it was added** — the
  validator wants a target above zero and the field was `""`.
  `resolveStepDefaults` is pure and layered: a `sport × stepKind` table, then "inside a
  repeat" (one rep, not the session), then the movement for Strength and Hybrid Fitness,
  then the athlete's own context. `coerce` has the last word, so only a target and an
  intensity the sport accepts can leave — which is what makes a wrong figure cheap
  rather than broken.
  **Four rules it is built on, each held by `npm run test:workout-defaults`.**
  A default is a valid step, for every combination, with thresholds and without.
  **Intensity is a zone, never a figure** — `encodeCorosIntensity` already derives bpm
  and pace from the athlete's own thresholds, so a preset is right for everyone and a
  number is right for one person. **No default is ever a `load` target**, because COROS
  answers `0` for `trainingLoad` on every list row. **And no default states a weight**:
  a movement that takes equipment starts at `none` and the athlete says what they are
  lifting; only bodyweight movements start at `{weight, bodyweight}`.
  **An absent context means "COROS has not answered yet", not "no FTP".** The builder
  mounts inside that round trip, and a zone lowered there would have nothing to raise
  it again. Only a context that *is* present and lacks a threshold degrades.
  Strength files a movement through `classifyWorkoutExerciseName` — the rules the
  exercise picker and `search_coros_exercises` already use — so a fourth list of
  exercises never has to be kept in step with COROS's. Hybrid Fitness files a station
  **by name, not by `exerciseKind`**: the kinds are numbers whose meaning COROS does not
  publish, and guessing would put a sled's 50 m on a rower.
  The builder and the coach read the same table. `withDefaultTarget`
  (`corosWorkoutBuilder.ts`) lets a coach step leave its target out entirely — every arm
  of `resolveRunTarget` throws on a missing figure, so that is a loosening; a step that
  *names* a `target_type` and omits its figure is still half-written. A step of a repeat
  group takes the in-repeat default (one rep, and the rest between reps), whatever its kind.
  One consequence worth knowing: `BuilderRow` holds **one** `targetValue`, not a
  `distanceKm` and a `timeMin`. It had two fields for eight target types, so reps lived
  in `distanceKm` and a step's repetitions read as kilometres everywhere they were
  written.

- **Training zones** (`workoutCapabilities.ts` tables, `corosWorkoutEditor.ts` parser) —
  what a zone preset in the workout builder means. Three things about COROS's own model,
  all read off its Settings screens on 2026-09-22 and all previously wrong here:
  **a zone entry states the zone's *ceiling*, not its floor.** HR Reserve arrives as
  133 / 154 / 168 / 173 / 183 and COROS draws `<133`, `133-154`, `155-168`, `169-173`,
  `174-183`, `>183` — so zone 1 runs up to the first entry, zone 2 spans the first two,
  and every zone after starts one above the entry below it. Reading `ratio` as a floor
  shifted every band down one. The top entry is a **sentinel** (404 bpm, 900 W, a
  2:44/km pace), so the last zone is open-ended and must never print it; `openEnd` on a
  `WorkoutZone` and `zoneOptionLabel` carry that.
  **COROS names its zones twice.** Max HR is `Recovery / Warm Up / Fat Burn / Aerobic /
  Threshold / Anaerobic`; HR Reserve, LTHR, Pace and Cycling Power are
  `Recovery / Aerobic Endurance / Aerobic Power / Threshold / Anaerobic Endurance /
  Anaerobic Power`, with `Sprint` a seventh on power alone. Using the first set
  everywhere labelled the band COROS calls **Threshold** as "Aerobic Endurance", two
  bands easier — a threshold session prescribed as an easy one.
  **There is no running-power family.** COROS publishes five (`maxHrZone`, `rhrZone`,
  `lthrZone`, `ltspZone`, `cyclePowerZone`) and its Settings offers Heart Rate, Pace and
  Cycling Power. `RUNNING_POWER_PRESETS` named bands that existed nowhere else; running
  power is stated in watts now.
  **And `/account/query` without `accountid` answers *partly*.** Identity and the three
  heart-rate families come back; `ltspZone` and `cyclePowerZone` do not. That is what hid
  Personal's Pace and Power tabs (`ZONE_TABS` filters on a family having entries) and,
  because `loadWorkoutEditorAccount` swallows its own errors, what made the builder read
  every pace target off the fallback table. Every account read goes through
  `readCorosAccount`; `test:coros-api-envelope` now covers the profile and the editor
  context, not just the login path.
  The shipped tables are a fallback for an account that has none of its own — an athlete
  edits these on COROS, so the parsed zones always outrank them. `intensityCustom`, the
  zone id that travels to COROS, is deliberately untouched: nothing here establishes where
  its numbering came from. `npm run test:coros-zone-presets` holds all five families
  against the screens.

- **Coach** (`chatService.ts` + four providers: `claudeCodeProvider`, `anthropicChatProvider`,
  `openRouterProvider`, `localChatProvider`) — streaming chat with COROS-data tools
  (`chatActivityTools`, `chatAnalyticsTools`, `chatSleepTools`, `chatWorkoutTools`,
  `chatInteractionTools`) and MCP servers.
  The read tools are built to fetch only what a question is about: the activity list takes a
  date window and a sport family and returns per-sport totals, `get_activity_detail` takes a
  `sections` list, trends and sleep take `days` and roll up by week past 14, and
  `get_sleep_summary` takes a `night` for one night's HRV course. Each formatter computes its
  own totals and deltas so the model reads them rather than doing the arithmetic.
  **Coach's proposals to the calendar and the library are change sets** (P3.2, `chatScheduleChanges.ts`):
  rows of `chat_schedule_changes` (`personal`), a `scheduleChange` anchor in the transcript, and a
  card (`CoachScheduleChangeCard`) whose lines are applied or dismissed one at a time or all at once
  through `chat:applyScheduleChange` / `chat:dismissScheduleChange`. `delete_workout` stages one.
  **Every line reads COROS again before it writes** — a session gone from its day or renamed goes
  `stale` — **one line is one write, recorded as it lands** (one `schedule/update` is all or nothing),
  and a line already applied is never written again. The delete card it replaced lived in a map in
  memory, so a restart left a button that could only say "expired"; a `workoutDelete` entry from
  then is drawn and can do nothing. `npm run test:schedule-changes`.
  **Coach reads the athlete's own COROS plans** (P3.1, `chatPlanTools.ts`): `list_training_plans`
  from the Library's cache and the stored matches (no request unless the cache is empty), and
  `get_training_plan` from `detail`. A plan on the calendar is read as its **running copy** — its
  id is `calendar_plan_id`, the `planId` every calendar session of it carries. Progress comes
  from activities, so a conversation withholding them gets the plan without it (the tools are not
  in `toolReadsWithheldSource`; `executeChatTool` passes `progress`). The count is
  `electron/planCompliance.ts`, which the Library's row reads too.
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

  **A conversation carries its own sources and AI** (`chat_conversation_settings`, `personal`;
  P2.0 of docs/coach-plan-canvas.md). No row means everything shared and Coach's settings, and
  `setConversationSettings` deletes the row when that is what is chosen, so only a difference is
  stored. `chat:send` carries the `sessionId` for this: `streamConversationTurn` reads the row
  and hands `streamChat` its `sources` and `runtime`, and `streamChat` turns withheld sources into
  a `runTools` reach (`conversationReach`) — withheld from every tool that reads them *and* from
  the snapshot, as the generator does — unless the run already brought a reach of its own. An
  analysis in the conversation takes its sources, and its runtime through `analysisRuntimeOver`:
  a provider and a model are **one** choice, so the pair comes whole from whichever side made
  it, the analysis first, and effort is taken the same way on its own — merged field by field,
  a model picked for Claude went out to the conversation's OpenRouter. The row goes with the
  conversation. The renderer's key check before a send asks about the **conversation's**
  provider, and a pull touching `chat_conversation_settings` or `chat_plan_artifacts` makes
  `ChatView` read the settings and the briefs again.

  **A plan longer than two weeks starts as a brief** (P2.1): `request_plan_brief` writes the
  generator's request — less the conversation's sources and AI — to a `chat_plan_artifacts` row,
  marking each field Coach filled `chat` or `data`, and the transcript gets only an anchor,
  `{ kind: "planBrief", artifactId }`. The athlete edits it on `CoachBriefEditor`, which is the
  generator's own Goal and Your week steps; a field they change loses its mark. The brief is the
  artifact's first state: its versions, when the sessions are written, carry the same
  `artifactId`, and a brief with a version is changed through the plan from then on. The tool is
  interactive only (`test:coach-analysis-guards`), and it needs the turn's conversation, which is
  why `StreamChatOptions` carries a `sessionId`.

  **The outline is a turn of the conversation, not a dialog** (P2.2). "Draw the outline" on the
  brief's card — and "Redraw with a note" on the outline's — sends `chat:send` a fifth argument,
  `ChatPipelineStep`; the athlete sees their words, and `streamOutlineStep` replaces them on the
  wire with the generator's outline prompt built from the brief. The turn is read-only, offered
  `propose_plan_outline`, and withheld every writing tool; a brief that is gone, has become a
  plan or is still missing a field rejects the send before anything streams, and the renderer
  then takes the step's words back out of the conversation (`remoteErrorMessage` strips Electron's
  "Error invoking remote method" off the reason). The artifact keeps
  **one** outline (`outline_json`), with `outline_version` counting every draw, redraw and hand
  adjustment; the transcript holds `planOutline { artifactId, outlineVersion }` anchors and the
  card is drawn at the **latest** one, earlier ones folding to a line. Adjust outline
  (`CoachOutlineEditor`) asks no model and writes no anchor: `chat:updatePlanOutline` refuses
  exactly what `planOutlineProblems` hands Coach. `test:plan-outline` runs the real turn under
  `HERACLES_SIMULATE_PLAN_AI`.
  **"Write the sessions" is the generator's sessions turn bound to that outline** (P2.3,
  `step: "sessions"`): read-only, `draft_training_plan` its only writing tool, checked in the turn
  by `generatedPlanProblems`. Unlike the generator's, the accepted draft is **not** held in memory:
  `planGenerations` carries the brief's `artifactId`, and `handleDraftTrainingPlan` writes it to
  `chat_plan_drafts` as that artifact's version 1, so brief, outline and plan are one creation.
  From then on the brief and outline refuse changes and their cards say so. While a step runs,
  its bubble draws `CoachStepTrail`, folded from the stream by `stepRunEvent` over `runTrail.ts`.
  **A step does not carry the conversation** (P2.4): `pipelineWire` sends the step's prompt —
  which holds the brief and the outline — after the six messages before it, never the whole
  transcript or its compaction summary, and the renderer skips `compactBeforeSend` for a step.

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

  **What this build does not know, it carries; what an older build does not know, it can
  lose.** Since P0.1 of [docs/coach-plan-canvas.md](docs/coach-plan-canvas.md), every parser
  passes the keys it does not handle through (`keepUnknownKeys`), a kind it does not know
  travels as `{ kind: "opaque", raw }` and is unwrapped back to `raw` on its way to SQLite,
  and the renderer carries both (`ChatOpaqueEntry`, `extra`). So does a kind this build *knows*
  in a shape it cannot read — a required field missing, say: dropping it would take it out of
  the row on the next save, and it may be a newer build's shape; only an entry with no `kind`
  at all is dropped. So a field still has to be
  listed to be *read* — the paragraph above stands for a field this build uses — but no
  longer to *survive*. That protects nothing written against a build from before it: an
  older build drops an unknown field and can win the merge with its copy
  (`test:chat-transcript-compat`, H3/H4), so **a new field must never go onto an existing
  entry kind**; new data goes in a table, and a new kind is only an anchor (§4, Q1–Q3).
  `test:chat-entry-passthrough` drives the whole trip through the renderer's converters.

  The same paragraph has a second edge: a field an entry *may* carry has to be
  **optional in the parser too**. `parseAnalysisMarker` demanded all five marker fields
  including `bindingId`, which named an attachment and which `runAnalysis` deliberately stopped
  writing — so every analysis answer lost its marker in the same statement that stored it
  (`normalizeEntries` runs on every save, not only on reload). The chip never appeared, and
  the synthetic playbook turn that opens a run rendered as the athlete's own bubble. Every
  fixture in the suites carried a `bindingId`, which is exactly why nothing caught it: none
  of them was the shape the runner actually writes. `test:chat-history-store` now drives the
  four-field marker, and `bindingId` keeps its old key position so a transcript holding one
  does not look rewritten on its next save.

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

- **Sleep** (`sleepDataService`, `sleepHistoryService`, `sleepSeriesService`, `src/sleep/`) —
  nights from the COROS MCP server, cached in `sleep_nights` because COROS keeps only ~9
  weeks. **`totalMinutes` is the main sleep and nothing else** — the stage percentages, the
  efficiency and the time in bed are all a share of it, so adding naps onto it drifts every
  one of them. The day's whole sleep is `totalSleepMinutes` in `electron/sleepMetrics.ts`,
  which the renderer imports directly (like `activityMetrics.ts`, and it must stay free of
  `node:` imports for the same reason). Every list, trend, average and greeting reads that,
  never `totalMinutes`.
  **A day COROS reported naps for and no main sleep is a day.** Its prose block carries
  `Naps Total` and a `Nap Window` line **per nap** and nothing else — no score, no `Main
  Sleep`, no stages — so the parser's demand for one of those two lines dropped the whole
  block and the day went missing from the screen, the trend and the coach's table with
  nothing anywhere saying a day had gone. Four days were missing from this account's cache
  when it was found. Such a day is `kind: "nap-only"`, is `complete` rather than `partial`
  (COROS has said all it will), and is unsettled for one day past its own so a late watch
  sync can still turn it into a night. `Naps Total: 0 min` with no main sleep is **not** a
  record: nothing was slept.
  `kind` therefore has three values, and the filter that means "a day" is
  `isSleepDayRecord` (`kind !== "nap"`), not a bare comparison — a single `nap` is a
  component folded into its day, never listed beside it. `selectWindow` does that folding
  and is what keeps one date to one record: `sleep_nights` is keyed `<day>:<kind>`, so a day
  first seen while only its naps had synced keeps that row for good once the main sleep
  lands under another. `npm run test:sleep-metrics`, `test:sleep-data-parser` (verbatim live
  payloads) and `test:sleep-history-cache` hold this down.
  **Picking a night must cost neither a round trip nor a layout jump.**
  `useSleepNightSeries` keeps every night it has been handed: a night that has
  been slept never changes and the main process answers a settled one out of
  SQLite in milliseconds, so the trip bought nothing and cost a frame of
  "Loading the night…" — including on a click straight back onto the night that
  was just on screen. And `SleepNightCurve` holds the height its box last
  settled at while it waits, because the three states are three sizes and
  passing through the short one between two charts dropped the detail pane 156px
  and sprang it back, 7–12 ms at a time, on every selection. The held height
  cannot be a constant: which size to hold depends on what was on screen, and a
  fixed one invents the same bounce between two nights that both have no
  samples. `npm run test:sleep-renderer` mounts the screen in a real window and
  fails on either shortcut.
  **COROS sends a window per nap but nothing at all about an individual
  wake-up** (probed 2026-09-16: `querySleepData` has only `Awake Time` and
  `Awake Count (>5 min)`, `querySleepHrv`'s `status` is 4 all night, and the
  stress series' `score` is a stress band). The nap windows sum to the day's
  reported `Naps Total` exactly; `napSummary.ts` builds the Naps tile and its
  hover note from them.
  **An MCP failure is one of two things and never one boolean.** Every payload MCP
  serves carries `mcpState: McpAvailability` — `"ready"`, `"disconnected"` (no COROS MCP
  server set up here, so connect it) or `"unreachable"` (one that *is* set up and did not
  answer, so there is nothing to do in Settings). It was `mcpConnected: boolean`, and a
  failed connection, a server with no sleep tool and a round of calls that all threw were
  all reported as `false` — which every surface read out as "the COROS MCP server is not
  connected. Please connect it in Settings → Connections → MCP Servers", sending the athlete
  to a panel where the server was already there and already authorized.
  `corosMcpFailureState()` is the only place that tells the two apart, and it asks after an
  attempt, not instead of one; the copy is
  built by `mcpNotice`/`mcpShortTextOr`/`mcpTitleOr` (`src/mcp/mcpNotice.ts`) so a surface
  names its subject and nothing else. `undefined` — nothing has answered yet — must blame
  nobody. `npm run test:mcp-notice` asserts both sentences for all three subjects and fails
  wherever the unreachable one starts telling people to connect something.
- **Media** (`youtubeService`, `spotify*`, `appleMusic*`, `applePodcastsService`,
  `downloadQueue`) — everything funnels through bundled `yt-dlp` + `ffmpeg` to MP3, then to
  the watch's `Music` folder over USB.
- **Base maps** (`src/mapBase/`) — not a screen. The Maps screen that owned this code was
  removed, but two surfaces still draw a Leaflet map: the activity detail replay
  (`ActivityRouteMap`) and the globe's street view (`ActivityGlobeStreetMap`). What they need
  is `constants.ts` (the styles), `baseLayers.ts` (`createBaseLayer`), `onewayArrows.ts` and
  `MapLayerControl.tsx`, and that is the whole of the directory. The route-flavoured names
  went with the screen: `BASE_LAYERS`, `BASE_LAYER_ORDER`, `BaseLayerId`,
  `TRAIL_OVERLAY_LAYERS`, `TrailOverlayId`, and `.basemap-*` in the CSS.
  **Base map styles all live in `BASE_LAYERS` (`src/mapBase/constants.ts`) and must
  stay keyless** — the app holds no map provider key, offers no field to enter one, and bakes
  none into the build, so a style that needs one is not a degraded map, it is no map.
  `light` and `dark` are **OpenFreeMap vector styles rendered by MapLibre**, not raster tiles.
  They were CARTO's `light_all`/`dark_all` until August 2026, when CARTO began answering
  keyless requests with a perfectly valid 200 PNG that has "API KEY REQUIRED" printed across
  it — a watermark, not an error, which is why nothing in the app noticed and why checking a
  provider by status code proves nothing. Both theme-driven screens resolve to those two ids
  through `themeBaseLayer(theme)`, so both wore it.
  `npm run test:base-layers` fails on a key-shaped endpoint, on anything pointing back at
  CARTO, and on `light`/`dark` ceasing to be vector.

  Three things hold the vector path up, and all are load-bearing:
  **`createBaseLayer` (`baseLayers.ts`) is the only way to build a base layer** — raster or
  vector — so no screen has to know which kind it asked for, and every base map lands in the
  `heraclesBasemap` pane (z-index 190, below Leaflet's `tilePane`) where trail overlays and
  track lines always draw on top. That pane replaced the `bringToBack()` calls the raster-only
  code needed on every swap; a vector layer has no `bringToBack()` to call.
  **It also binds the map's max zoom, and that is not decoration.** Leaflet reads a zoom limit
  off a layer in exactly one place — `GridLayer.beforeAdd` — so a raster base map bounded the
  map for free, while `L.maplibreGL`, a plain `L.Layer`, bounds nothing and `getMaxZoom()`
  falls back to `Infinity`. That is not merely "zooms too far": `fitBounds` clamps to
  `getMaxZoom()`, so a track whose points share one spot resolves to zoom `Infinity`, the
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
- **Where you've been** (`reverseGeocodeService.ts`, `src/trainingMap/`) — the globe clusters
  visit coordinates and names each cluster through `places:reverseGeocode`.
  **It asks more than one geocoder, because one host is a single point of failure the app
  cannot route around.** A resolver that answers `*.openstreetmap.org` with loopback — which
  a number of ISPs do, and which `nslookup` against `8.8.8.8` is what proves — took Nominatim
  off that machine entirely: every lookup threw, every place on the screen fell back to a pair
  of coordinates, and nothing anywhere said why. Photon (`photon.komoot.io`) serves the same
  OSM data from a different domain, so the two are blocked independently. Nominatim stays
  first for its `display_name`; a provider that could not be reached is **stood down for five
  minutes** rather than retried per cluster, or one blocked domain costs the screenful the
  globe asks about all at once one timeout each. Both providers are keyless, like the base
  map styles, and for the same reason.
  **A lookup that failed is not an answer, and must not be cached as one.** The two cases are
  deliberately different return values: a provider that answered about nowhere (open water)
  returns a coordinate label, which the renderer remembers; nobody answering *throws*, and the
  renderer shows coordinates without remembering them, retrying after a minute
  (`PLACE_LABEL_FAILURES`). Caching the fallback is what made a single blocked request
  permanent for the life of the window.
  **Names are fetched for what is on the screen, which is not the same as the first few.**
  Recent places is paged five at a time, so a fixed head of eight left every page but the
  first reading coordinates for good, and Most visited can sit anywhere in the list.
  `npm run test:reverse-geocode` drives the chain, both parsers against verbatim live
  payloads, and the throw-vs-return split.
  **A name is kept across launches, and only a name.** `src/trainingMap/placeLabels.ts`
  holds the caches out of the view for the reason `activityFilters.ts` sits outside
  `ActivitiesView` — it is the only part of naming a place a test can reach. A cluster key is
  a ~55 km grid cell (`GEO_HEAT_STEP`) and the name of the city in it does not change, so a
  resolved name is written to localStorage (`coroslink.activity-globe.place-labels.v1`,
  `derived`) and is on the screen in the first paint of the next launch. Held only in memory,
  every launch re-asked about every place on the screen, serialised behind the provider
  throttle, and the screen read coordinates for the ten-odd seconds that took.
  **A coordinate fallback is never written there**, and neither is a cluster in open water —
  read back, the two are indistinguishable from a failure, and storing either would turn one
  blocked launch into a permanent one. That is why `toPlaceLabel` returns `undefined` for
  "named nowhere" rather than a label, and why the bare-coordinates test compares against
  `coordinateLabel` instead of looking for letters: `21.0° N` has letters in it.
  `npm run test:place-labels` drives all of this against a fake `window`, and fails on either
  shortcut.
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
  - **An entry is applied only when it is newer than the row it would overwrite, and
    `sync_record_versions` is how that question can be asked at all.** The merge compares
    entries against each other and never against the database — `resolve()` picks a winner
    per `entryIdentity` and `SqliteSyncTarget.upsertRow` is an unconditional `INSERT OR
    REPLACE` — so "this entry won the log" and "this entry is newer than what is here" are
    different questions and only the second is safe to act on. The log a pull acts on is the
    log as it was when `readAllEntries` *began*, and that is a full fetch over the network,
    so any local write made during it is invisible to that snapshot.
    `SyncLoop.enqueue` therefore stamps `entryIdentity -> hlc` at the moment of the local
    write and `pull` stamps what it merges, both through `recordVersions.ts`; a winner that
    does not beat the stamp is skipped. Own entries still take part in last-writer-wins —
    drop them from `resolve()` and a foreign entry this device already superseded would win —
    so the guard belongs in `isApplied`, never in what is handed to `applyEntries`.
    Two weaker guards stood here and **neither may come back**. Skipping anything
    `authoredHere` did nothing about a *foreign* entry older than the local row, and it is
    what made the loss permanent: once a row had been rewound the winning entry for it was
    this device's own, so the skip fired forever and the good copy in the vault could never
    return. An in-memory `#merged` map was empty after every launch, so the whole log was
    re-merged on each first pull — exactly when the race is live.
    This cost an athlete a coach's answer twice over, and the second time was measured on the
    live vault: a headless run finished inside a pull, wrote 96 transcript entries and queued
    them; the pull applied the 93-entry copy another machine had published two days earlier,
    byte for byte; the queued entry went out moments later, so the vault held the answer and
    this machine did not, while the run log said `success`. Because the stamp starts empty, a
    machine upgrading into it re-merges the log once and **repairs** whatever the old guards
    rewound. `npm run test:sync-twoway` drives the whole incident behind a gated provider and
    fails against the old shape.
  - **A record that accumulates is unioned, not replaced.** Last-writer-wins is right
    for a row that describes one thing and wrong for one that grows, and the coach
    transcript is the only one of those: `chat_sessions.messages_json` is an append-only
    list carried as a single opaque column, so two machines adding to the same
    conversation resolved to whichever wrote last and the other's turn was gone — no
    error, nothing in a log. That is the ordinary case rather than a corner, because an
    analysis runs headless on whichever machine holds the lease while the athlete may be
    at the other. `rowMergers.ts` holds the one merger; `SqliteSyncTarget.upsertRow`
    consults it. Every entry carries a `mid` minted once and a `mrev` bumped when its
    content changes (`chatHistoryStore.stampEntries`), and the merge is union by `mid`,
    last-writer-wins *per entry* by `mrev`, ordered by `mid` — all three commutative and
    idempotent, which is what makes it safe on both machines in either order. **A merge
    that produced something neither side had must be republished** (`takeRepublish`), or
    the vault's newest entry for that row is the incoming one, which does not hold this
    machine's half, and compaction folds the entry that did away. It terminates: the
    other machine unions that against a copy it already equals and publishes nothing.
    Identities are recovered on every save, never trusted — the renderer rebuilds entries
    field by field and drops both fields — **by content first, then by the card's own
    id**, never by position: a save whose array is shorter than the row would read an
    unrelated entry at the same index as an edit of it and take over its identity.
    `foreignTail` compares content with both fields stripped for the same reason.
    `test:sync-engine` asserts the three properties directly, `test:chat-history-store`
    the identity rules, `test:sync-twoway` the whole round.
    **An entry that arrives without an identity has one lent to it, by content, from
    either side.** A build older than this rebuilds entries field by field, so it drops
    both fields, and then saves and publishes the conversation with every identity
    stripped — which the union would read as entries it has never met and add beside the
    ones they already are. The transcript doubles, which is worse than the loss it
    replaced. `lendableIds` is built from both sides together for the same reason it
    cannot be one-sided: an upgraded machine that has not yet saved a conversation holds
    an unidentified copy too. What is left over — an old build appending a turn — is
    anchored just after the entry it followed (`<id>~0000`, and `~` sorts above every hex
    digit), so it lands where it was written rather than at the top. A transcript with
    nothing identified anywhere falls back to `0-<index>-<content hash>`: **position and
    content, and both halves are load-bearing.** Position lines the shared history up;
    content stops two machines that each appended a turn on the old build from claiming
    `0-000042` and one athlete's turn being dropped to resolve it. Ties on equal `mrev`
    break by content, never by which side was passed second — that reads as a reasonable
    default and is a livelock, each machine taking the other's copy and republishing it
    forever. **An id worked out during a merge is written onto the entry**, because
    recomputing it later gives the same answer only while whatever it was anchored to is
    still there. And a `messages_json` this build cannot parse is **left out of the row**
    rather than written over one it can — which is only safe because `upsertRow` names
    its columns, so an omitted one means *unchanged*. **A fallback id depends on the entry and its
    position and nothing else.** It carries a content digest, because two machines that each
    appended an unidentified turn would otherwise claim one slot with a turn dropped to
    settle it — and it must *not* depend on what the rest of the array held. An earlier
    version anchored such a turn just after the entry before it, which reads better and gave
    the same turn one identity in the entry that first carried it and another in the union
    republished afterwards; both sit in the log, and a machine folding the two added the turn
    twice. The cost is ordering — a `0-` id sorts before every minted `1-` one, so a turn
    appended on an old build lands at the top of the conversation rather than the end, until
    every machine is upgraded.
    **`applyEntries` folds every entry for such a record, not only the winner**, and that is
    the half that makes the rest worth anything. `resolve` asks which single entry describes
    the record now, which for a transcript picks one machine's turn and discards the other's:
    a third machine pulling both at once received only the later one, and compaction then
    dropped the entry that carried the earlier. So `compactEntries` folds them too — the
    surviving entry is the union every reader would have computed, and it is still one entry.
    Only the **winner's other columns** are authoritative (`RowMergeContext.winner`): a loser
    writes its primary key and the merged column and nothing else, or an older append would
    undo a rename made on the winning machine.
    That partial write is why `upsertRow` has two paths. An upsert cannot express it —
    `INSERT … ON CONFLICT DO UPDATE` builds the candidate row first, so a `NOT NULL` column
    the payload omits fails the statement before the conflict clause is reached, and
    `chat_sessions` has four. A payload short of the full column set goes out as an `UPDATE`,
    falling through to the insert only when the row is not there yet.
  - **`sync_record_versions` keys a merged record per device, and every other record by
    the record.** A high-water mark per record answers "is there anything here I do not
    have" only when a newer entry *replaces* an older one. For a record that accumulates it
    is the wrong question and it silently drops turns: a turn written on a plane at 10:00
    reaches the vault after another machine's 11:00 entry has been merged, and 10:00 is not
    newer than 11:00, so every machine skips it for good. Measured. `versionKey` splits the
    mark by device for those records — and *only* the fold, because the record's own mark is
    still stamped and still decides `isAuthoritative`, so an entry older than the row cannot
    put its title back even while its turn is folded in.
  - **`upsertRow` names its columns; it is not `INSERT OR REPLACE`.** The two differ only
    when a payload is short of a column, and there `REPLACE` rewrites the row so the
    missing column comes back as its default — which is to say NULL, meaning *deleted*
    rather than *unchanged*. That is the trap `coach_analysis_local_triggers` exists to
    avoid, and naming the columns removes it at the source. A row this build could take
    only part of is reported through `takeIncomplete` and **not** stamped durably, so a
    later build that learns the columns can apply the entry again.
  - **A merge is one transaction.** `applyEntries` and the `recordVersions` stamps commit
    together, so a crash partway cannot leave a state no device was ever in — an analysis
    row arriving ahead of the conversation it names — nor stamps claiming rows that never
    landed. The per-entry `try` inside `applyEntries` still stands: a failed statement
    does not abort a SQLite transaction, so one unusable entry costs one entry.
  - **`pull` and `flush` are serialised against each other**, not only inside `tick`.
    "Sync now" calls both directly. `flushBeforeQuit` deliberately goes *past* that
    turnstile: quit is bounded by a timeout and its one job is to get the queue out, not
    to wait on a pull nobody needs finished.
  - **A change made before the vault opens is held, not dropped.** `prepareSync()` waits on
    the COROS re-login at start-up — the vault's owner is the account, so it must — and until
    it returns `syncBridge` has no sink. It used to discard what the hooks handed it: the
    write reached SQLite and never reached the vault, with nothing recording that it had not,
    and it left no `recordVersions` stamp either, so the first pull merged the vault's older
    copy straight over it. The bridge now holds those changes, one per destination, and
    replays them when `attachSyncSink` speaks — or drops them when what it says is that there
    is no vault, which is what keeps the buffer to the boot window rather than the life of
    the process. Policy is asked *before* a change is held, so a credential never sits in the
    buffer at all. `npm run test:sync-bridge` covers all three.
  - **A compaction snapshot summarises the log; it does not shadow it.** `readLog` skips
    only entries the snapshot holds *by timestamp identity*, never everything at or below
    its `upTo` — that is a claim that nothing below the line can still arrive, and nothing
    enforces it. A device holding a queued change goes offline, another compacts, the
    first comes back and appends a batch stamped before the snapshot: the upload succeeds,
    `flush` reports it pushed, the file is in the vault, and no reader ever looks at it
    again. Measured. `COMPACT_HORIZON_MS` was the guard and it only ever covered clock
    skew; an hour offline is not skew. Duplicates cost nothing — `resolve` is
    last-writer-wins over whatever it is given — and being invisible costs the write.
    `npm run test:sync-engine` fails against the old shape.
  - **The outbound queue is a table, not an array.** `sync_outbox` (`device` tier) takes
    an entry the moment it is queued and releases it only when the upload returns. What
    was lost before was never the write — that is in SQLite before an entry is built — but
    the vault's only notice of it, and nothing could discover the gap: `seedVaultIfNeeded`
    runs once per vault id and nothing else ever compares this machine against the log. So
    the two diverged in silence and the other machine settled it the wrong way, its entry
    built from the stale copy and carrying a newer HLC. `before-quit` narrowed that window
    and could not close it — `flushBeforeQuit` makes one attempt and returns instantly
    when offline, which is exactly when the queue is full. `start()` adopts whatever the
    last launch left. The queue keeps one entry per destination: an older entry for the
    same record is already dead to every reader.
  - **Quit waits for the queue, and only when there is one.** A change sits out
    `FLUSH_DEBOUNCE_MS` before it is even attempted, so a turn written and an app closed in
    the same breath never reached the vault — and by the rule above, the next launch then
    pulls a *foreign* copy of that record over the newer local one. `before-quit` therefore
    cancels the quit, flushes and quits again. `SyncLoop.hasUnpushedChanges` is what keeps
    that off the ordinary quit: with nothing queued the handler returns immediately and the
    app closes as fast as it ever did. It counts the upload in the air as well as the
    queue — `flush` takes `#pending` before it awaits, so in between those two moments the
    batch exists nowhere else. `flushBeforeQuit` makes exactly **one** attempt: offline it
    returns instantly with the queue intact, and `QUIT_FLUSH_TIMEOUT_MS` bounds a link that
    neither answers nor fails. What does not get out is lost with the process, which is the
    right trade against a window that will not close.
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

`src/App.tsx` is a ~8.5k-line monolith holding view routing and most cross-cutting state.
`src/navigation/primaryNav.ts` defines `PrimaryView`. Its `developmentOnly` and `beta` flags
are still honoured by the rail, the tab bar and the start-up picker, but no destination sets
either since Watch Faces and Gear were removed — the first one to need them again just sets
the flag.

Styling is plain CSS with custom properties — no Tailwind, no CSS modules.
`src/styles.css` (~31k lines) holds the design tokens and most rules; ten feature
stylesheets sit beside their components (strength ×3, training ×2, profile, running, sleep,
training-library, activity globe). Twelve in all, counting `fonts.css` — which is the number
the four CSS suites report. Themes are `dark` | `paper` via `src/theme/`, persisted to localStorage,
and `THEME_WINDOW_BACKGROUND` must stay in sync with `--bg-base`. Sport colors live in both
`src/styles.css` and `src/training/sportColors.ts` (the source of truth) —
`npm run test:sport-colors` asserts they match.

**An empty result and an unfinished load are different screens.** An array that has not
arrived reads exactly like one that came back empty, so a view that branches on `length`
alone tells the athlete they have no strength sessions, no HRV readings and no training in
the last 365 days — every launch, for as long as COROS takes to answer. `busy` cannot stand
in: it is one string for the whole app. Each load says where it stands instead
(`TrainingHubLoadStatus` for the activity list and the snapshot, `initializing` from
`useStrengthData`, `loading` on the panels that own a fetch), and the loading copy outranks
both the empty copy and the MCP copy above it. `initializing` is not `loading`: a flag
raised when a request starts is `false` for the renders before the effect that starts it,
which is one of the three ways the Strength screen used to flash "No strength sessions in
the last 3 months" at an athlete with hundreds.

**There is one way to offer a choice between options, and `npm run test:option-groups`
closes it.** `OptionGroup` (`src/components/OptionGroup.tsx`) has three modes that share a
chip and differ only in which chips are on screen: `expanded` (all of them — the default),
`collapsible` (the selected one, opening in place and pushing what sits beside it) and
`dropdown` (a floating menu, through `SelectDropdown`). Multi-select is `OptionChips`, a
separate export rather than a flag, because several pressed chips inside one track read as a
segmented control gone wrong. It replaced ~30 hand-written versions whose chips disagreed
about height, weight, radius, how the chosen one is marked (`.is-active`, `.is-selected`,
`.active`, `[data-active]`) and which ARIA role a row of exclusive buttons takes.
**A collapsible group is one row holding every option once, clipped by the group's own
measured width.** The row is the caller's order; the
fold is the group being as wide as the chosen chip, with the row slid so that chip sits at the
left edge; opening widens the group to the row's width and takes the slide off. So the only
thing that animates is a width, and for the first option — the chosen one whenever nothing has
been narrowed — `--og-shift` is `0px`, the row never moves at all, and the label is at the same
pixel from start to finish rather than only at its two ends. `OptionGroup` measures
`--og-folded`, `--og-open` and `--og-shift` in a `useLayoutEffect` with no dependency list and
writes them through the ref: most callers rebuild `options` every render, and a measurement
held in state would render, measure and set state again.
What it replaced, in order. A `max-width`, which needed a number picked in advance and silently
clipped any label longer than it. Then two grid columns — a lead chip beside a row holding a
**second copy** of the chosen option, one collapsing from `1fr` to `0fr` while the other grew;
that is the instructive one, because its endpoints could be lined up (taking the labels'
`translateX(-5px)` out, then the group's own 2px `gap`) and the path between them still could
not: the row begins where the lead ends, so the row's copy slid the lead's whole width to the
left underneath a copy of itself being clipped away. **Two boxes cannot be cross-faded into
each other's place while both are in flow.** Dropping the chosen option out of the row would
stop anything moving, at the cost of an open row that no longer reads in the order it was
given — the order is the invariant, so the movement is what gets fixed around it.
One consequence to keep in mind: the chosen chip is inside the row now, so a rule over "every
label in the row" catches it. The reveal fade is scoped `button:not([aria-checked="true"])` for
exactly that reason — without it a folded group is a blank pill, because the one chip it shows
is the one the fade had hidden. `npm run test:option-groups` holds the measured width, the
single copy and the fade; `test:library-renderer` reads `--og-shift` and both positions, from a
mount with **every** `coroslink.selection.v1` key cleared (the bare preference name is not the
storage key, so removing that alone leaves the last choice standing).
**There is deliberately no automatic fallback** from `expanded` to `collapsible` when a row
does not fit: it was written that way first and it oscillates, because the measurement that
says "this does not fit" can only be taken while the row is laid out in full, and folding it
makes the same measurement say it fits. A screen that cannot spare the width says
`mode="collapsible"`. **Escape is caught in the capture phase** — a collapsible group can sit
in a dialog that closes on Escape from its own `document` listener, and two listeners on one
node are not separated by `stopPropagation()`.
**The chosen chip is a wash of the accent with the accent's own ink** — the Calendar's
Month/Week switch, which had the mark right before the component existed and is now where it
comes from. A solid accent fill was the first answer and it shouts: a period picker is chrome,
and a filled pill pulled the eye off the chart it describes. The rule that marks the
**collapsed** group's lead chip has to be `.option-group .option-group-trigger`, two classes,
because a flat `.option-group-trigger` loses to `.option-group button` — a class and an
element — and a folded group then drew its one visible chip as though nothing were chosen,
which is the whole of what the folded state has to say. `--accent-ink` is gone with the fill
it was mixed for.
**`fill` splits a form row equally between the options.** A `.field` hands its control the
whole width, every input in one is `width: 100%`, and a chip row that keeps its text width
ends in dead space with the options at two sizes nobody picked. Stated by the caller for the
reason `mode` is, and nothing in `dropdown` mode, which already fills what holds it.
**The words are `src/preferences/periodScale.ts`, not the screen's.** Six screens used to
answer "how far back" in their own vocabulary — ninety days was "3 months", "90 days" and
"Last 90 days" depending on where you looked. A screen declares the windows it offers and
takes the labels from the scale; the test fails on a period label written anywhere else.
Two windows moved to fit it: the trend charts and the load heatmap run 28 days rather than 30,
which is the four whole weeks this app already cuts its periods by.
**A dropdown opens at the size of what it holds**, between a floor (the trigger, so the list
is never narrower than the control it came from) and a cap (the window). It was handed one
width, `max(trigger, 220px)`, which was wrong in both directions at once — a 90px pill opened a
220px menu half of it empty, and a list of model names was ellipsised inside the same 220px.
The one exception is a menu whose options carry a `detail`: that is a sentence, and a sentence
has no natural width, so those cap at the floor and wrap, with the caller raising the floor to
suit. Its ground is `--menu-surface`, **not** `--surface`, which carries a green cast that
reads as chrome under a panel and as a tint under a sheet hanging over the page. And
`.app-select-trigger` states `font-size` **after** `font: inherit`, never before — the
shorthand resets it, so the declared size sat there doing nothing and every trigger in the app
drew at the page's 16px, a size that is not on the scale and two steps above the chips a pill
trigger stands in a row with.
**Twelve controls are exempt**, each named in the test by file *and* by a string from the
element, so an exemption covers one control rather than a whole file. They are four kinds and
none is a row of options: a grid whose arrangement carries meaning (sports, a month of days),
cards that need a sentence (export formats, plan difficulty, analysis starters), a list of
records (places, search results, exercise facets, muscle layers) and a menu (the base-map
popup, the start-up view).

**A feature stylesheet must not restate type for whole element types.** The Training Library
had `.training-library-view :is(button, input, select, textarea) { font: inherit }` — one class
and one element, exactly the specificity of `.option-group button`, and feature stylesheets load
after `styles.css`, so it won on source order and the `font` shorthand reset the size every
component had set. **Every shared control on that screen drew at the page's 16px**: measured, the
collapsed filter chip came out 16px there against 12px for the same chip elsewhere in the app,
and so did the select triggers and the buttons. It is `:where(.training-library-view)` now, which
contributes nothing to specificity — above the UA's own 13.33px Arial on a bare control, below
anything a component says. This is the trap the note below describes, with a blanket selector
instead of one rule, so it is worth checking a screen's controls against the same control
elsewhere rather than against how they look.

**The design vocabulary is a closed set, and `npm run test:design-vocabulary` closes it.**
Four weights (400/500/600/700), ten font sizes (10/11/12/13/14/18/22/28/32/36px) plus two
`em` steps for text that must follow its parent, four tracking steps
(`-0.02em` / `0` / `0.06em` / `0.1em`), five unitless leading steps (`1` for figures and
chips, `1.2` display, `1.3` headings and dense rows, `1.45` body, `1.6` long prose) and six
radius tokens — every literal in those five properties must come from that set. A box that
has to match a neighbour's height says so with a height, not with a leading inflated to fit.
It is enforced because it cannot be maintained by intention: nobody writes `font-weight: 650` on purpose, they write it once because 600 read
a shade light beside a heading, and the file had grown to **20 weights, 18 sizes (thirteen
of them between 9px and 15px, half-pixels included), 45 spellings of letter-spacing down to
`-0.004em`, and ~150 hand-written radii** alongside the five tokens. The test's header
lists the exceptions and why each one is real. Adding a value means editing that file,
which is the point.

**The app carries its own typography, and one serif level.** `index.html` used to `<link>`
Inter and Space Grotesk from `fonts.googleapis.com`, so a fresh install with no network drew
the interface in a system fallback. The three families now ship as variable `.woff2` files in
`src/assets/fonts` (latin, latin-ext and **vietnamese** — an athlete's activity names and the
coach's answers are written in it), declared in `src/fonts.css`; `npm run fonts:fetch`
(`scripts/fetch-fonts.mjs`) re-fetches them, and `test:design-vocabulary` skips `@font-face`, where `font-weight: 300 700`
is a file's range rather than a choice off the scale. `--font-title` (Source Serif 4) is spent
on a screen's own title and nothing else, at weight 600 and leading 1.3 — a serif's descender
does not fit inside `line-height: 1`. Figures spend one treatment (the display face, weight
500, `-0.02em`, tabular) and keep their own size and leading. A title or figure rule that
restates `font-family` or `font-weight` locally wins over the shared rule, because the feature
stylesheets load after `styles.css` — that is how five screens silently kept the sans. Code,
ids and hashes spend `--font-mono`, the one monospace stack: it replaced four spellings written
out by hand and two phantom tokens (`--mono`, `--font-mono`) that fell back to them.

**A `var()` naming a token nothing declares deletes the whole declaration, and
`npm run test:css-tokens` is what stops that shipping.** Not the one layer — the declaration:
an undeclared custom property resolves to the guaranteed-invalid value, so
`background: radial-gradient(…, var(--missing), …), var(--real)` computes to *transparent*,
`border: 1px solid var(--missing)` to *no border*, and `color: var(--missing)` to the inherited
ink (all three measured in Chromium). Nothing reports it: the stylesheet parses, the build
passes, the screen just loses its ground. Twelve dead token names across twenty-four uses were
found on 2026-09-18, each alive for months — the Training Library's entire background stack
(`--bg-ambient-green`, a name from a palette that predates the accent tokens), the Hevy
dialog's fill, the backup-restore cards, and a `--danger` nothing has ever declared (five
more lived on the Watch Faces and Gear screens, which have since been removed); one found by
hand a phase earlier was the same bug. The test holds two things at zero and has no allowlist:
every `var(--x)` names a token some stylesheet declares or the renderer writes (**a fallback
does not excuse it** — `var(--phantom, 12px)` renders correctly and still claims a token that
is not there, which is how four of them survived a reader's eye), and every declared token is
read by someone. A name the renderer builds (`--m3d-heat-${level}`) counts through its prefix.

**`.content` caps the measure at 1440px**, through its own padding
(`max(28px, (100% - 1440px) / 2)`) so the scrollbar stays at the window edge and no screen
needs a wrapper. Below about 1750px nothing changes; past it the margins grow rather than the
tables.

**Motion is part of that vocabulary, and the same test holds it.** A `transition` spends
`var(--ease)` — one decelerating curve; bare `ease` was 92% of every curve and is the browser
default nobody chose — and a `--dur-fast` (a state: colour, opacity, border, shadow) /
`--dur-base` (something that moves or resizes) / `--dur-slow` (a drawer that travels) token.
A length that is designed rather than reactive — a fill growing to its value, a staged
reveal, a spring — stays literal only as an entry in `DESIGNED_LENGTHS`, which fails once the
transition it names is gone. Check a rewritten shorthand in a renderer, not by eye: a
`transition` holding `var()` always parses, and an invalid one is dropped at computed-value
time, so neither the build nor a render says anything. (`\bease\b` also matches inside
`var(--map-ease)`; the keyword pattern is `(?<![-\w])ease\b(?!-)`.)

**Elevation is one device per level, held by `npm run test:elevation`.** A card floats on an
outer shadow; a well sits in a hairline; no rule draws a visible border *and* an outer shadow
(an inset is a highlight, and a border spelled `var(--surface-line, …)` is the card recipe),
and every layer that **lifts** spends `--shadow-soft|card|elevated|inset`. Both rules hold
across the app as of 2026-09-17, so `scripts/elevation-allowlist.json` is empty but for one
`exempt` decision and a new violation fails outright. A `box-shadow` draws four other things
and those are not elevation: a hairline (an inset with no blur — a highlight, a gridline, a
marker bar), a ring (`0 0 0 Npx`, up to 8px), a glow (no offset), a tint (a lift painted in a
named signal colour — accent, sport, sleep stage, tone) and the 1–2px edge under a control.
`layerKind` in the test draws that line; the sizes are written up in §4.5 of the doc. Tokens
are judged by what they resolve to across every definition, which is how it found a feature
shadow token defined nowhere — an invalid token silently voids the whole `box-shadow`,
hairline and all — and it is why a feature token that lifts spends one of the four rather
than restating a shadow. The ladder itself is in [docs/ui-system-refinement.md](docs/ui-system-refinement.md) §4.
Paper defines `--surface-line: transparent` on its `:root`, so a card that spells its border
`var(--surface-line, …)` floats on its shadow there and keeps a lit hairline in dark; the
paper `.panel` rule reads the token **without a fallback**, which is what puts it over the
cards that set a border colour of their own. A hairline that divides rather than encloses —
a column rule, a row separator — does not read the token. Rule 1 is held everywhere now, so
a new rule drawing a border *and* an outer shadow fails `test:elevation`; if it is genuinely
right (a watch bezel, a ring that is the datum), it goes in the allowlist's `exempt` with the
reason written out, and it has to still apply or the test fails on the stale claim. The
probe's `boxes` count, not `layers`, is the one to hold a screen's depth against — `layers`
counts a one-sided divider as a level.

**Focus is one ring, drawn with `outline`, and the same vocabulary test holds it.** A rule
whose subject is the focused element stands alone — never beside `:hover`, `.is-active` or
`:focus`, never grouped in `:is()` — and draws `outline: var(--focus-ring)` at
`outline-offset: 2px` (`-2px` where the container clips). `--focus-ring` is declared on
`:focus-visible` itself, not `:root`, because a custom property holding `var()` resolves where
it is declared and the chat scopes redefine `--accent`; a feature with its own signal colour
sets `--focus-ring-color`. **It is an outline because a box-shadow ring did not survive the
app:** built that way first, a paper override setting `box-shadow` on the same element with
more specificity erased the ring, found only by tabbing through the running app — no static
scan can pair two class names on one element, and hundreds of rules set a shadow. Outlines
are set almost nowhere else, leave the element's elevation alone, and forced-colors mode
keeps them.

**Colour is data; chrome is the neutral surface plus one accent.** Hue belongs to sport,
sleep stage, heart-rate zone, load band, the strength heatmap, a provider's own brand — and
to `--success-*` / `--warning-*` / `--error-*`, which are the only way a semantic colour
gets to follow the theme. It does not belong to chrome: the four weekly tiles under the
recovery ring carried one Tailwind pastel each (peach for load, sky for steps, pink for
distance, lavender for duration) plus a dead set for recovery states nothing rendered, and
none of it said anything — they are four totals of one kind for one week. Those
`--stat-*` properties and the `tone` prop on `TrainingSummaryTiles` are gone rather than
neutralised, so the concept has to be reintroduced deliberately. A hardcoded `#86efac` for
"update ready" is the same mistake in miniature: it means success, so it reads
`var(--success-text)` and follows the theme.

**The primary rail is an index, not a control panel.** `PRIMARY_NAV_SECTIONS`
(`primaryNav.ts`) is four standing headings — Today, Plan, History, Device — over twelve
destinations, and a heading is a label: it does not open, close or remember anything. The
disclosure groups this replaced existed only because eighteen equal rows did not fit, and
they cost two rows, a chevron, a stored open/closed state, a rule that reopened a group
whenever the app navigated into it, and a second indicator key for a collapsed group's
header. The sections answer *when* a screen is reached for rather than where its data comes
from, which is the grouping the athlete already has. `coroslink.sidebarCollapsedGroups` is
gone from `syncPolicy.ts` with the state it classified — `test:sync-policy` fails on a
localStorage key that `src/` no longer writes, in both directions.
**Personal and Settings are not in the index.** They are about the person rather than the
training, so they sit in the identity row at the rail's foot (`PRIMARY_NAV_ACCOUNT_ITEMS`),
which is also what brings the index down to a length that stands open. That row wears the
COROS nickname and avatar from `getCorosProfileSnapshot`, which is served from the main
process's hour-long cache and so costs no request; it falls back to the account email's
local part, then to "Personal". Because one row shows a name and the other is icon-only,
neither is findable by its text — both carry **`data-nav-label`**, and
`probe-ui-cdp.mjs` navigates by it.

**Chrome is quiet, and three devices carry the whole rail.** `.app-sidebar` draws one
hairline down its right edge and nothing else — no fill, no shell blur, no highlight
gradient, no inset ring, no shadow, no corner. It spent all six on being seen, beside the
screen it exists to get out of the way of. That hairline reads `--sidebar-divider` and
**not** `--surface-line`: this line divides rather than encloses, and `--surface-line` is
transparent on paper, so the rail would lose its only edge there. The `--sidebar-glass-*`
set still dresses the **Coach conversation rail**, which is a panel inside a screen rather
than the window's own edge; the two are not the same thing.
The active row is marked by a 2×14px bar at the column's edge plus weight 600 and
`--accent-strong` on the icon. **The indicator element still spans the row** — its measured
`top`/`height` are what let the mark slide — and only the bar inside it is drawn; the
identity row draws its own, at the same size and offset, because the nav's mark is measured
inside the index and cannot reach down there. Hover is a single `--glass-bg` wash: it used
to draw a whole card (fill, border, inset highlight, shadow and a 2px shove) under every row
the pointer crossed. Collapsing, done once and then forgotten, no longer holds a row —
`.app-sidebar-brand-toggle` waits in the brand line and comes out on hover *or* focus, in
two separate rules, because a control that exists only under the pointer cannot be tabbed to
and this one is the only way back from the icon rail.
**The rows are not `--text-secondary`, and the index carries no scrollbar.** That token is
the right weight for prose beside a heading; a rail is not prose, it *is* the navigation, and
at 13px with no fill behind it every row read as grey — so `--sidebar-row-text` steps up
close to the ink (14.4:1 on dark, 11.7:1 on paper, measured in the running app) while
`--sidebar-row-icon` stays a shade back, which puts the reading order inside the row instead
of flattening it. Active still separates at 18.4:1 with weight 600, the accent icon and the
bar. The heading sits between the two, one step quieter than a row rather than two.
The scrollbar is gone because a 6px thumb sat a few pixels inside the rail's own hairline, so
a short window drew **two vertical lines down the same edge** — for a list of twelve rows
that fits whenever the window is not cramped. What a reader needs there is not a handle to
drag but a sign that the list continues, so the cut edge fades: `--fade-top` / `--fade-bottom`
are opened by `has-fade-top` / `has-fade-bottom`, which the rail sets from a **measured**
`scrollTop`/`scrollHeight` on scroll and on every resize (the rows are observed as well as the
nav — a development build adds two destinations without the nav's own box changing size, and
that is exactly when it starts to scroll). At rest both are `0px`, the mask's stops collapse
onto each other and it is a solid pass, so the first and last row are never fogged when
nothing is hidden. The gutter stays 0 either way, so nothing reflows when the fade appears.

There is exactly **one horizontal rule**, above the identity row, and it earns its place:
below it the subject stops being training, and the index scrolls on a short window or a
development build, where the last destination would otherwise run into the account. On the
64px rail a heading has nowhere to go, so it becomes a 16px rule between sections and is
*hidden rather than removed* — the section's accessible name is read from it. The
narrow-window drawer is the one deliberate exception to all of this: it floats over the
content, so it takes a fill and `--shadow-elevated` and drops the hairline, rather than
drawing two devices for one edge.

**`paper` is a grey canvas with white surfaces, and it is not free to be otherwise.** It was
a warm cream page (`#f6f3ec`) carrying 72%-white glass, which put a card within three levels
of the page under it: the shell, the sidebar and every panel read as one flat sheet, and the
sidebar's own gradient ended *in the page colour*, so the rail was not there at all. So the
page is grey and every surface white, and `--glass-bg` — a white *lift* in dark — is a grey
wash here, because it is spent on controls and rows that sit on cards which are already
white. A surface that must be white asks for `--glass-bg-elevated`; `.panel` inside a
`.panel` deliberately recesses instead, restated at the generic rule's own specificity to
outrank it. **And `--bg-base` carries no accent hue**: the cream one left Sky and Indigo
sitting on a yellow page, while the window chrome is painted from
`THEME_WINDOW_BACKGROUND`, a flat string written on a theme change but *not* on an accent
change — so an accent-derived base would drift out of step with the frame around it. The
accent reaches the page through `--bg-ambient-*` and the Coach rail's top gradient, which
read `var(--accent)` at use time. Paper accents are measured against `--bg-base` for WCAG AA and
mirrored in `src/theme/accentPalette.ts` for the globe and the charts, which cannot read a
custom property — change both. Every paper rule is scoped `:root[data-theme="paper"]`, which
is what keeps dark out of reach of a light-theme edit; nothing in the file relies on a bare
selector meaning "light".

## Releases

`npm run release:prepare -- v0.1.31` syncs the version into `package.json` and the lockfile,
then prints the commit/tag/push commands. Tag pushes trigger `release.yml`, which re-checks
that the tag and `package.json` agree before building. `verify-release-artifacts.mjs` gates
the updater metadata per platform.
