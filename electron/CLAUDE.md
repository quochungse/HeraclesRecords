# Main process: COROS

Coach, plans, Strength, Sleep and places have main-process code here but their notes live
under `src/` (see the root table) — read those before changing that code.

## Training Hub session (`trainingHubService.ts`)

COROS `teamapi.coros.com` auth: password + 2FA ticket, multi-region. The only component that
sends credentials off-machine. **Use only the web host**: a login on COROS's mobile API
signs the athlete's phone out.

- **After the password step everything follows the account's `regionId`**
  (`REGION_BASE_URLS`: 1 US, 2 CN, 3 EU, 4 SG): the 2FA code, its check and the session. What
  is remembered is the email typed, never the challenge's opaque `account`.
  `npm run test:coros-login` drives the flow against a fake COROS.
- **COROS keeps one live token per account; minting one kills every other machine's.** So
  there is exactly one silent login, `restoreTrainingHubSessionAtStartup()`, once per launch,
  only when the session is *gone* and credentials remain, and never with a prompt (a 2FA
  account reports `two-factor-required` and waits for Reconnect). Do not put a re-login back
  on the request path.
- **"Gone" is asked of COROS, not the settings table** (a force-logout never touches this
  machine): `checkStoredTrainingHubToken` reads `/activity/query` (mints nothing). Only
  `dead` clears and re-mints; `live` and `unknown` are left alone — an offline launch must
  stay `unknown`. `1019` is a token killed elsewhere (in `AUTH_ERROR_CODES`).
- **Mid-session, a dead token calls `endExpiredTrainingHubSession(deadToken)`**, which clears
  the session only if it still holds *that* token: requests started on the old token land
  after start-up minted a new one and must not wipe it.
- **`TrainingHubStatus.restoring` is read with `authenticated`**: `authenticated && restoring`
  = double-checking, load normally; `!authenticated && restoring` = signing back in, show the
  restore panel and hold the load. `finishStartupRestore` lowers the flag before announcing; a
  `finally` lowers it on any escape; `already-signed-in` announces nothing. Changes reach the
  renderer through `trainingHub:sessionChanged`. The renderer's `reportTrainingHubError`
  re-reads the status before showing a COROS failure. `npm run test:coros-session-restore`.
- Start-up re-logs in *before* `prepareSync()` (the vault's owner is the COROS account).
- **COROS's envelope:** `apiCode` is a status only when it is four digits (on
  `/account/query` it is a trace id); an unstated status is success when data arrived and
  failure when nothing did (so `allowEmptyData` cannot wave through `{}`). `/account/query`
  needs `accountid` — without it, it answers `1019` or answers *partly* (no `ltspZone`, no
  `cyclePowerZone`). Every account read goes through `readCorosAccount` /
  `corosAccountQueryUrl`. `npm run test:coros-api-envelope`.

## Activity details (`activityDetailCache.ts`)

One COROS detail is ~2.5 MB of JSON, so it is a file, `<userData>/activity-details/<owner
fingerprint>/<activityId>.json.br` (brotli 5), and only a summary reaches SQLite.
- **COROS's list has no version field**, so `activityDetailFingerprint` hashes the summary
  figures COROS recomputes on an edit (`name` included, `sportName` excluded — filled
  locally). It is hashed from the **stored mirror row**, the caller's list row only when
  there is none.
- **Every detail read goes through `loadActivityDetailRaw`** (`/activity/detail/query`
  appears exactly once). Backfills pass `persist: false`; the feel backfill also
  `fresh: true` (a feeling is set later and moves no list figure). A payload with none of
  `summary`/`lapList`/`frequencyList`/`graphList`/`zoneList` is neither cached nor summarised.
- **A detail with no GPS asks for the GPX export** — never for an indoor sport
  (`isIndoorSportType`), never past `GPX_FALLBACK_TIMEOUT_MS`, and a timeout is not
  remembered as "no track" (`GPX_TIMED_OUT`); only an answer lands in `tracklessActivities`.
- **Nothing about the file enters the row** (`training_activity_summaries` is `derived`).
  The directory is its own bookkeeping: `stat` size, `mtime` touched on hit, a 500 MB cap
  swept oldest-first with orphans first, unreadable files deleted on read.
- **The parsed detail does not carry its payload**; the development "raw JSON" view has its
  own channel, `trainingHub:getActivityDetailRaw`.
- `activityMetrics.ts`, `unitSystem.ts`, `sleepMetrics.ts`, `chartPlacement.ts` and other
  modules the renderer imports must stay free of `node:` imports.
- `npm run test:activity-detail-cache`.

## COROS facts for reading

- An activity's time is `workoutTime` (pauses out); `totalTime` includes them, and the
  sample series runs on the wall clock, so charts subtract `pauseList`.
- A **zone entry is the zone's ceiling**, not its floor, and the top entry is a sentinel
  (404 bpm, 900 W, a 2:44/km pace) — the last zone is open-ended and never prints it.
- **COROS names zones twice**: Max HR is Recovery / Warm Up / Fat Burn / Aerobic / Threshold
  / Anaerobic; HR Reserve, LTHR, Pace and Cycling Power are Recovery / Aerobic Endurance /
  Aerobic Power / Threshold / Anaerobic Endurance / Anaerobic Power (+ Sprint on power).
  There is no running-power family. A zone bucket n is Z(n+1). Pace has seven buckets for
  six zones (Threshold is split at 100%). `zoneType` on an activity is unreliable; 0 falls
  back to the account's model. `npm run test:coros-zone-presets`.
- **On a COROS program a `0` is a field not filled in** (`toProgramFigure`); a `??` chain
  over these must not stop at one. The workout list row fills only `exerciseNum`,
  `totalSets`, `estimatedTime`; a training load comes only from
  `/training/program/calculate`, and only for steps with an intensity target. A program's
  `distance` is centimetres; `totalSets` counts steps except on strength.
- **Catalogue plans are written in localization keys** (`P10035`, `T1120`), resolved by
  `corosLocale.ts` against COROS's CDN string table (cached in `<userData>/coros-locale/`);
  `corosText` swaps a value that is a key and nothing else. `test:coros-official-plan`.
- `1001 Service exceptions` answers both "gone" and "could not serve now".

## Writing to COROS

**What is written is what COROS's own web app writes** (`corosExerciseCatalog.ts`,
[docs/coros-write-parity.md](../docs/coros-write-parity.md)). Every step starts from a clone
of a `/training/exercise/query` row (`stepBaseRow`) — the movement for strength, the sport's
warm-up/training/cool-down/rest row otherwise — and only id, group, sets, target, intensity
and rest are written over it. COROS draws a session's muscle map from the program's
`muscle`/`muscleRelevance`/`part`, not `originId`. A step's name is COROS's key unless someone
gave it a name of their own. Plan writes blank a copied session's `id`/`planId`, never
renumber a session nobody moved, keep catalogue `P…` keys, and write a rebuilt session as the
row it replaces (`withProgramIdentity`). `npm run test:coros-write-parity`.

**Text COROS stores has limits in UTF-8 bytes** (`corosTextLimits.ts`,
[docs/coros-text-limits.md](../docs/coros-text-limits.md)): 90 for names, 800 for a plan's
description, 200 for a workout's description and a step's note. Inputs clamp by grapheme
(`clampCorosUtf8`); write paths refuse rather than truncate; a schema's `maxLength` counts
characters, so the byte check is the one that holds. **A limit applies to text written here,
never to text carried through unchanged** (`carriedWorkoutText`): COROS's own editors allow
more, and the builder has no field to shorten a step's note.

**Workout defaults** (`workoutDefaults.ts`, `resolveStepDefaults`): a default is always a
valid step; intensity is a zone, never a figure; never a `load` target; never a weight (only
bodyweight movements start at `{weight, bodyweight}`). An absent context means "COROS has not
answered yet", not "no FTP" — only a present context lacking a threshold degrades. Strength
files a movement through `classifyWorkoutExerciseName`; Hybrid Fitness by name, never by
`exerciseKind`. A step of a repeat group takes the in-repeat default. `BuilderRow` holds one
`targetValue`. `npm run test:workout-defaults`.

**Training zones** (`workoutCapabilities.ts` tables, `corosWorkoutEditor.ts` parser): the
shipped tables are a fallback for an account with none; parsed zones always outrank them.
`intensityCustom` is untouched on purpose.

## Other services

- **Hevy** (`hevyService.ts`) is its REST API, checked against Hevy's OpenAPI, never a real
  account: see `src/strength/CLAUDE.md`.
- **Reverse geocoding** (`reverseGeocodeService.ts`): see `src/trainingMap/CLAUDE.md`.
- **Sleep and COROS MCP** (`sleep*Service.ts`, `corosMcp*`): see `src/sleep/CLAUDE.md`.
