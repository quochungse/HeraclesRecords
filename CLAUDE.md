# CLAUDE.md

Guidance for Claude Code in this repository. This file is the core; each feature area has
its own `CLAUDE.md` beside its code (loaded when you work there — see **Where the details
live**). Keep them that way: a rule goes in the file of the code it governs, stated once,
with the reason only when the reason is what stops a regression. No dated history, no
"used to" stories, no feature tours.

## Project: a divergent fork

Heracles Records forked the CorosLink vendor project at `713084b` (v0.1.30) and is
intentionally diverging. Upstream conventions are not targets to preserve.

| Remote | Purpose |
|---|---|
| `origin` | `quochungse/HeraclesRecords` — this project. |
| `vendor` | `JunAkerBuilds/CorosLink` — upstream, push disabled. `vendor-main` tracks it pristine. |

Review upstream with `git fetch vendor && git log --oneline main..vendor/main` and bring
changes over by **selective cherry-pick after review** — never merge `vendor/main`.
`remote.vendor.tagOpt` is `--no-tags`: an upstream `v0.1.*` tag pushed here would run
`release.yml` and publish upstream's code.

**Removed on purpose — judge any cherry-pick against the decision, there is nothing
half-done to finish:** the Maps, Watch Faces, Gear, Data (bulk backup, intervals.icu),
Coros Overview and Media screens, and **every connection to a watch over USB** — the app
reads the watch only through COROS's API, which knows little about devices (name,
Bluetooth id, model, serial, warranty; no firmware, battery, storage or last sync on any
endpoint). Their tables, settings and folders are dropped on open (`dropRetired*` in
`electron/database.ts`, `removeRetiredFeatureStorage` in `main.ts`). What survived: the
base map code (`src/mapBase/`), reverse geocoding (`places:reverseGeocode`),
`uploadActivityFitToCoros`, single-activity export and `.data-connect-panel`.

**Every name is the fork's** (since 1.0): database `heraclesrecords.sqlite`, localStorage
`heraclesrecords.*`, bridge `window.heraclesRecords` typed by `HeraclesRecordsApi` in
`src/heraclesrecords-api.ts`, `build.appId` `app.heraclesrecords`. The app opens these
names only; `npm run migrate:legacy-names` was the one-off move of an old profile.

**Where userData lives — verify, never assume.** Electron's `app.getName()` reads the
top-level `name` of package.json (`productName` sits under `build`, which Electron never
reads), so userData is `<appData>/heracles-records`. `appId` has no say in it. Check the
running app: `pgrep -af heracles-records | grep -o '\-\-user-data-dir=[^ ]*'`. The old
`<appData>/coroslink` folder is no longer read.

**Licensing.** `LICENSE` keeps upstream's `Copyright (c) 2026 AtoZ` line beside the fork's
— MIT requires it. `scripts/collect-licenses.mjs` (last step of `build:renderer`) writes
`dist/licenses/` from `package-lock.json` and the fonts, shipped as `resources/licenses`. A
new package is covered by the next build; a new bundled program or asset needs its own entry
in `THIRD_PARTY_NOTICES.md`.

**The website (`site/`) reads the app's own files** — fonts, icons, screenshots,
`src/records/labours.ts`, `CHANGELOG.md` — and its guides name the app's buttons and
screens. A renamed labour, button or Settings section means a site change too
(`site/CLAUDE.md`).

## Commands

```sh
npm install && npm run rebuild   # rebuild rebuilds better-sqlite3 for Electron's ABI; required after install
npm run dev                      # Vite on 127.0.0.1:5173 + Electron (builds electron first)
npm run build                    # tsc electron → dist-electron, tsc --noEmit renderer, vite build
npm start                        # build, then run the packaged-style app
npm run check:coach              # the Coach checks CI runs (docs/coach-checks.md)
npm run screenshots              # reshoot docs/readme from demo data (-- 05-ride for one)
npm run release:prepare -- vX.Y.Z
```

Development variants: `dev:simulate-plan-ai` (plan steps without a provider),
`dev:sample-rides|hikes|trail-runs|swims` (simulated sessions added at the window's door only),
`sample:coach` (sample Coach conversations; app closed). Generators whose output is
committed and never run by a build: `fonts:fetch`, `admin-regions:fetch`,
`body-shapes:fetch`, `body-figures:bake`, `sample-rides:fetch`, `sample-hikes:fetch`,
`icons:generate`, `site:og`, `signin-art:generate`.

## Tests

There is **no linter and no test runner**: ~180 standalone `scripts/test-*.mjs` files on
`node:assert/strict`, each its own npm script (`npm run test:chat-service`; find one with
`npm run | grep -A1 test: | grep <subject>`). `npm run build` is the only typecheck. CI
builds installers (`build.yml`, `release.yml`) and runs `npm run check:coach`
(`check-coach.yml`, on PRs and pushes to `main`); **no other suite runs unless you run it.**

The execution mode matters — the wrong one fails confusingly:

| Mode | Used when |
|---|---|
| `npm run build:electron && node scripts/test-X.mjs` | Imports compiled main-process code from `dist-electron/*.js`. |
| `node --experimental-strip-types scripts/test-X.mjs` | Imports `.ts` with explicit extensions. |
| `… --experimental-strip-types --import ./scripts/register-ts-ext.mjs …` | Same, with extensionless `.ts` imports. |
| `cross-env ELECTRON_RUN_AS_NODE=1 electron scripts/test-X.mjs` | Touches SQLite (`better-sqlite3` is built for Electron's ABI). Also the route for a strip-types suite that must run on a Node without Amaro — such a test says so in its header. |
| `electron scripts/test-X.cjs` / `ELECTRON_RUN_AS_NODE=` (empty) | Needs a real window: canvas, or the React renderer harness. |

- Tests import compiled modules with `pathToFileURL(...) + "?cacheBust=" + Date.now()` to
  defeat the ESM cache between fixtures. Keep that.
- **This tool environment injects `ELECTRON_RUN_AS_NODE=1`**, so Electron never opens a
  window from a tool call: prefix GUI launches with `env -u ELECTRON_RUN_AS_NODE`. Scripts
  that set or clear it themselves are fine as they are.
- **A Node built without Amaro** (distro packages) fails every plain strip-types suite with
  `ERR_NO_TYPESCRIPT`. Use an official Node 22+ build (this machine uses nvm).
- A renderer suite mounts in a hidden window; animations and observers need frames there
  (`offscreen: true`), and a display scaled above 100% is why several suites pin
  `force-device-scale-factor` to 1.

## Architecture

Electron app in three layers. `electron/` compiles to **CommonJS** (`tsconfig.electron.json`,
`module: Node16`); `src/` is an ESM React 19 + Vite renderer (bundler resolution). Both
`strict`.

```
src/ (renderer, React)  →  src/heraclesrecords-api.ts (types only, window.heraclesRecords)
                        ↓
electron/preload.ts     →  contextBridge, ipcRenderer.invoke wrappers (~190)
                        ↓
electron/main.ts        →  ipcMain.handle registrations + app lifecycle
                        ↓
electron/*Service.ts    →  the work; electron/database.ts owns SQLite
```

**The IPC contract is a three-file invariant.** A channel name is a bare string in
`electron/main.ts`, `electron/preload.ts` and `src/heraclesrecords-api.ts`; a typo in one
typechecks and fails only at runtime. Adding or renaming a channel means editing all three,
then `npm run test:ipc-surface` (asserts the sets match in both directions). Channels are
`domain:verb` (`chat:`, `trainingHub:`, `trainingLibrary:`, `places:`, …). In development a
new channel needs `npm run dev` restarted: a window reload re-reads the preload, not main.

**`ipcMain` in `main.ts` is `diagnosticIpcMain`** (`diagnosticsService.ts`): `handle` logs a
failure with its `cause` chain to `<userData>/diagnostics/errors.json` (redacted by
`diagnosticsLog.ts`, capped, never synced) and re-throws a `ScreenError` in the renderer's
language. It has `handle` only. `npm run test:diagnostics`.

**`rendererReady` gates every push main sends unasked** (sync merges, a restored COROS
session): `webContents.send` before React subscribes reaches nobody, and those pushes carry
the only copy of what they say. The renderer raises it itself through `app:rendererReady`,
on its own channel, never in a build-conditional path, deferred a tick past mount so the
subscriptions below it are attached. `did-finish-load` cannot stand in. A packaged build
once never raised it and silently dropped every push. `npm run test:renderer-ready`.

**What the window may reach:**
- No URL reaches `shell.openExternal` unchecked: `electron/externalLinks.ts` (node-free,
  shared) allows `https:`, `http:`, `mailto:` only — a relative link in a Coach answer
  resolves to a local program on `file://`. `test:external-links`.
- The main window navigates nowhere (`will-navigate`), runs `sandbox: true` (the preload
  imports nothing but `electron`), and has no `<webview>`.
- The built page carries a CSP (meta tag written by `vite.config.ts` at build time only):
  `script-src 'self' 'wasm-unsafe-eval'`; images and connections take any https.
- A packaged build deletes `VITE_DEV_SERVER_URL`, `HERACLES_SAMPLE_*` and
  `HERACLES_SIMULATE_PLAN_AI` from the environment before anything reads them, and refuses
  the sample-data IPC.
- The COROS session token is encrypted at rest (`secretSettings.ts`, `enc:v1:` +
  `safeStorage`) and falls back to plain text without a keyring — refusing it would mean a
  login every launch, and each login signs the athlete out elsewhere.

**Data.** `electron/database.ts` is the single SQLite owner (`better-sqlite3`, in userData).
The schema is a `CREATE TABLE IF NOT EXISTS` block; **later columns go through
`ensureColumn`, never by editing the block**, so a column can be absent on an old database.
New tables are additive. Retired tables are dropped on open with no tombstones.

**Main-process components take injected `Deps`** with a `createDefaultDeps()` fallback
(`coachAnalysisService`, `coachAnalysisScheduler`, `coachActivityWatcher`). Suites inject
fakes, so `createDefaultDeps` is code no suite reaches — wire a new dependency where a test
can see it.

## Rules that cross every feature

**What may leave the machine is decided in one place: `electron/sync/syncPolicy.ts`.** Every
setting, table and localStorage key is classified `preference` | `personal` | `derived` |
`device`; an unclassified key syncs nowhere, and `test:sync-policy` fails on a key `src/` no
longer writes. **No credential (token, API key, sign-in) ever leaves the machine** — all
are `device`, with no opt-in. Never store a translated string, and never put a new field on
an existing stored chat entry kind (older builds drop it and win the merge — use a table or
a new anchor kind). Sync itself: `electron/sync/CLAUDE.md`.

**Translations** (`src/i18n/`, plan in [docs/i18n-plan.md](docs/i18n-plan.md)). English is
the default and fallback; twelve more languages are lazy chunks. Messages are flat keys in
`src/i18n/messages/<locale>/<namespace>.ts`, typed against English, so `npm run build`
fails on a missing key; `npm run test:i18n` holds placeholders, plural forms and a ratchet
(`scripts/lib/i18n-pending.json`) against English written into source. A release ships
every language finished (`check:i18n-release`). Rules: a component showing translated words
calls `useI18n()`; a module-level label is a getter over its message, never a copy; dates
and numbers take `getIntlLocale()`, never `undefined`; Coach's prompt is not translated.
**The main process's words** go through `electron/screenText.ts` (English, no value
imports) and `electron/i18n/<locale>.ts`; main throws `ScreenError` (English message for
logs and tools) and `diagnosticIpcMain` re-throws it in the renderer's language. Text main
*stores* stays English and is rendered again from its fields.

**Two loads, never mixed.** A strength session has COROS's Training Load and Heracles Training
Load (`src/strength/CLAUDE.md`); the Strength screen chooses which one every screen counts
strength in, and other sports are COROS's either way. A figure set against another is in the
same load on both sides (`comparableLoads`, `loadsToCompare`). What COROS derives from its daily
load by known formulas — Load Impact, Base Fitness, the load ratio, the recommended weekly range —
follows the choice: COROS's own figure plus the same arithmetic on what Heracles adds
(`electron/heraclesFitness.ts`); recovery and training effect are COROS's alone. A load is one
figure, the chosen one; both appear (`loadPairTitle`, `figurePairTitle`) only where the figure
differs from what the COROS app shows — the week's load and range, and those fitness figures.

**Loading is not empty.** An array that has not arrived reads like one that came back
empty; each load states where it stands (`TrainingHubLoadStatus`, `initializing`,
`loading`), and loading copy outranks both the empty copy and the MCP copy.

**An MCP failure is one of two things** (`McpAvailability`): `"disconnected"` (no COROS MCP
server set up — connect it) or `"unreachable"` (set up, did not answer — nothing to do in
Settings). `corosMcpFailureState()` tells them apart; copy goes through `src/mcp/mcpNotice.ts`;
`undefined` (nothing answered yet) blames nobody. `npm run test:mcp-notice`.

**COROS facts are probed, not assumed.** A `200` can carry a watermark, `{}` parses as
success, `apiCode` is sometimes a trace id, and a `0` on a COROS program means "not filled
in". The COROS API notes are in `electron/CLAUDE.md`.

## Where the details live

| Area | Code | Notes |
|---|---|---|
| Renderer conventions, design system, CSS rules, navigation | `src/` | `src/CLAUDE.md` |
| COROS Training Hub (auth, session, envelope), activity detail cache, writes to COROS, zones, workout defaults | `electron/` | `electron/CLAUDE.md` |
| Sync, backup/restore | `electron/sync/`, `electron/backup/` | `electron/sync/CLAUDE.md` |
| Coach (chat, providers, plans in conversation, change sets, analyses) | `electron/chat*.ts`, `electron/coach*.ts`, `src/chat/` | `src/chat/CLAUDE.md` |
| Training Library (plans, workouts, Exercises Library, AI Plan) | `electron/trainingLibraryService.ts`, `src/training-library/` | `src/training-library/CLAUDE.md` |
| Calendar, workout builder | `src/calendar/` | `src/calendar/CLAUDE.md` |
| Activities, Overview, channel chart, training label, zones, body figure | `src/training/` | `src/training/CLAUDE.md` |
| Running, Cycling, Hiking, Swimming, trail view, running efficiency | `src/running/`, `src/cycling/`, `src/hiking/`, `src/swimming/`, `electron/swimDetail.ts` | `src/running/CLAUDE.md` |
| Strength, Hevy | `src/strength/`, `electron/strength*`, `hevyService.ts` | `src/strength/CLAUDE.md` |
| Sleep | `src/sleep/`, `electron/sleep*` | `src/sleep/CLAUDE.md` |
| Where you've been, places, geocoding | `src/trainingMap/`, `reverseGeocodeService.ts` | `src/trainingMap/CLAUDE.md` |
| Base maps | `src/mapBase/` | `src/mapBase/CLAUDE.md` |
| Hall of Records | `src/records/` | `src/records/CLAUDE.md` |
| Website | `site/` | `site/CLAUDE.md` |

A nested `CLAUDE.md` loads only when you read files under its directory. **Before changing
main-process code of an area whose notes live under `src/` (Coach, plans, Strength, Sleep,
places), read that file first.**

## Releases

1. `npm run release:prepare -- vX.Y.Z` syncs the version into `package.json` and the lockfile
   and prints the commit/tag/push commands. The `## [X.Y.Z] - date` section of
   `CHANGELOG.md` is the release text (`scripts/release-notes.mjs` fails the job without it).
   `check:i18n-release` must pass (no pending file, no missing message).
2. **Push only the release tag** (`git push origin vX.Y.Z`), never all tags.
3. `release.yml`: `preflight` checks the tag against `package.json` and fails on empty
   Google OAuth secrets (Drive is the only sync destination). macOS signs and notarizes with
   the Apple secrets, else signs with the project's own self-signed certificate
   (`MAC_SELF_SIGN_P12_*`, `scripts/mac-sign.cjs` — never make a second certificate, it *is*
   the app's identity), else ad-hoc. `verify-release-artifacts.mjs` checks every file
   `latest*.yml` names (size, sha512) and the installer names.
4. After publishing, the `readme` job rewrites the README's download blocks from the release
   (`scripts/update-readme-release.mjs`, between `<!-- release:… -->` markers — never edit
   them by hand) and commits to `main`; the `site` job rebuilds the site from `main`.

What a release publishes is what something reads: per Mac arch a dmg and a zip + blockmap
(the updater), the Windows exe + blockmap, `latest*.yml`, a Linux AppImage **and** a deb.
**The AppImage must stay the first Linux target**, or it is packed with the deb's
`resources/package-type` and updates itself as a deb. `artifactName` patterns spell
`HeraclesRecords` with no space (GitHub rewrites spaces) and must change together with the
hand-built download URLs in `electron/updaterService.ts` (`test:release-artifacts`,
`test:release-data`). Linux icons are the `build/icons/<n>x<n>.png` set (`icons:generate`).

**Updates download in the background and never restart unasked**; `UpdateRestartPrompt`
asks once the file is on disk. Per platform (`quitAndInstallUpdate`): Windows runs NSIS
silently; Linux installs inside the running app, asynchronously (a deb through one
`pkexec`, an AppImage by rename) — electron-updater's own `spawnSync` froze the window; on
macOS an ad-hoc build cannot update in place (Squirrel needs a stable designated
requirement), so `isMacAdHocSigned` sends the athlete to the DMG.

A packaged build needs `HERACLES_GOOGLE_OAUTH_ID`/`_KEY` (baked by
`scripts/prepare-google-client.mjs` from the environment or a root `.env`) for Drive sync to
be offered; both CI workflows pass them to every platform job.
