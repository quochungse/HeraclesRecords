# Screenshots

Every screenshot in `docs/readme/` comes from here: the README uses `01`–`18`, the website
`01`–`26`. They are taken of the real renderer (`src/main.tsx`) running on demo data, so no
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
  and the rides, hikes and trail runs of `electron/sample*.ts`; sleep (`demoSleep.ts`); a
  12-week marathon plan and a workout library (`demoPlan.ts`, `demoLibrary.ts`); Coach
  conversations in English (`demoCoach.ts`); and the Hall of Records' realistic history.
  Emails are `example.com`.
- **`shots.json`** is the plan: per shot, the screen (`view`), the theme (`dark` or `paper`),
  how long to wait, localStorage to seed (`ls`), and `steps`, JavaScript run in the page in
  order (`demoClick(text, selector)` clicks the shortest element holding that text) with
  pauses in milliseconds between them. Add a shot by adding an entry.
- **`shoot.cjs`** opens each one in an offscreen Electron window and captures it
  (`SHOT_DPR`, `SHOT_DIR`, `SHOT_ROUND`, `SHOT_ONLY`). Launch Electron only through
  `scripts/run-electron-gui.mjs`, which clears `ELECTRON_RUN_AS_NODE`.
- **`record.cjs`** steps the route replay frame by frame into `frames/`, and
  **`encode-anim.py`** (Python with Pillow) encodes them into an animated WebP.
- **`fetch-exercise-media.mjs`** refreshes `exercise-media.json`, the pictures and clips of
  the six movements in the demo's strength workout, from COROS's exercise catalogue. It reads
  the catalogue with the app's stored COROS session, read-only; run it only when that workout
  changes.
- **`build-preview.mjs`** renders `README.md` as GitHub would, into `.work/readme-preview/`,
  for reviewing a README change with its screenshots.

`dist/`, `frames/`, `shots/` and `userdata/` are build output and stay out of git.

## Rules the shots keep

- Dark only, except the appearance pair (`19-appearance-dark`, `20-appearance-light`), which is
  shot together so both show the same day.
- Nothing personal: demo data only, never a copy of a real database.
- WebGL maps render at 2× only in an offscreen window whose `deviceScaleFactor` matches the
  CDP `Emulation.setDeviceMetricsOverride`; `shoot.cjs` sets both.
