# Screenshots

Every screenshot in `docs/readme/` comes from here: the README uses `01`–`18` and
`27`–`30`, the website `01`–`33`. They are taken of the real renderer (`src/main.tsx`) running on demo data, so no
athlete's own training ever appears in them.

```sh
npm run screenshots                        # every shot in shots.json
npm run screenshots -- 05-ride 15-places   # just these
npm run screenshots -- --nobuild 05-ride   # reuse the last build
npm run screenshots -- --route             # the animated route, 16-route.webp
```

Shots are 1512 × 982 at 2×, with the macOS window corners, written as WebP into
`docs/readme/`. Once they change, the website picks them up on its next build; run
`npm run site:og` too if a link-preview card uses one (`scripts/site-og/og.html`).

## How it works

- **`build.mjs`** builds `main.tsx` with Vite into `dist/`. `main.tsx` installs a stand-in for
  the preload bridge (`demoApi.ts`, answering from `demoHandlers.ts`) and then mounts the
  app's own `src/main.tsx`.
- **The demo data** is one believable athlete, Alex Pham in Hà Nội: runs (`sampleRoadRuns.ts`),
  and the rides, hikes, trail runs and swims of `electron/sample*.ts`; sleep (`demoSleep.ts`); a
  12-week marathon plan and a workout library (`demoPlan.ts`, `demoLibrary.ts`); Coach
  conversations in English (`demoCoach.ts`); and the Hall of Records' realistic history.
  Emails are `example.com`. Its today is always the last Saturday (`clock.ts`, imported first):
  the sample sets are each dated back from today and the demo keeps one outdoor session a day, so
  on other weekdays they land on each other's days and a shot's hike or ride is dropped.
- **`shots.json`** is the plan: per shot, the screen (`view`), the theme (`dark` or `paper`),
  how long to wait, localStorage to seed (`ls`), and `steps`, JavaScript run in the page in
  order (`demoClick(text, selector)` clicks the shortest element holding that text) with
  pauses in milliseconds between them. Add a shot by adding an entry.
- **The sign-in screen** is shot by seeding `"demo.signin"` through `ls`: `fresh` (never
  signed in here), `saved` (a remembered account), `restoring` (the start-up re-login) or
  `code` (signing in asks for the emailed code; fill the form and press Sign in in `steps`).
- **`shoot.cjs`** opens each one in an offscreen Electron window and captures it
  (`SHOT_DPR`, `SHOT_DIR`, `SHOT_ROUND`, `SHOT_ONLY`). Launch Electron only through
  `scripts/run-electron-gui.mjs`, which clears `ELECTRON_RUN_AS_NODE`.
- **`record.cjs`** steps the route replay frame by frame into `frames/`, and
  **`encode-anim.py`** (Python with Pillow) encodes them into an animated WebP.
- **`fetch-exercise-catalog.mjs`** refreshes `exercise-catalog.json`, COROS's whole movement
  catalogue cut to the fields the app reads (muscles, equipment, target, one picture and one
  clip). The demo answers the catalogue from it through the app's own `workoutExerciseOption`
  (`demoExercises.ts`), so the Exercises Library and the workouts' clips are COROS's. It reads
  with the app's stored COROS session, one GET, read-only; run it when COROS changes its
  catalogue.
- **`build-preview.mjs`** renders `README.md` as GitHub would, into `.work/readme-preview/`,
  for reviewing a README change with its screenshots.

`dist/`, `frames/`, `shots/` and `userdata/` are build output and stay out of git.

## Rules the shots keep

- Dark only, except the appearance pair (`19-appearance-dark`, `20-appearance-light`), which is
  shot together so both show the same day.
- Nothing personal: demo data only, never a copy of a real database.
- WebGL maps render at 2× only in an offscreen window whose `deviceScaleFactor` matches the
  CDP `Emulation.setDeviceMetricsOverride`; `shoot.cjs` sets both.
- **Every canvas is flattened into an image before the capture**, for every shot: at 2× the
  capture leaves composited canvases out, and a map came out as a grey band with only the
  route on it. `shoot.cjs` waits until no canvas changes, then flattens; a step never does it
  by hand. A `WARNING … a map is blank` line in the log means a shot not to use.
- **Chromium's sandbox stays on** in `shoot.cjs` and `record.cjs`: with `no-sandbox` an
  offscreen renderer dies on Linux and the run hangs with no output.
