# Website (`heraclesrecords.com`)

An Astro project with **its own `package.json` and lockfile on purpose**: `collect-licenses`
ships the license of every package in the root lockfile with the app, and the installer jobs'
`npm ci` should not fetch Astro. Plan: [docs/website-plan.md](../docs/website-plan.md).
`npm --prefix site install`, `npm run site:dev`, `npm run test:site`.

- **It reads the app's own files**, not copies: `src/fonts.css`, `build/icon*.png`,
  `docs/readme/*.webp` (`site/src/assets.ts`), `src/records/labours.ts` and its artwork, and
  `CHANGELOG.md` (a content loader, one entry per released section up to the latest published
  release). Guides (`site/src/content/guide/`) name the app's buttons and screens by their
  labels — a renamed button or Settings section means a guide to fix.
- **Activities and Plan & Library are directories** (`/activities/`, `/plan/`) with a page per
  sport or screen; `site/src/sections.ts` lists them for the header, `SubNav` and the sitemap.
  A directory page is linked with its trailing slash (`/activities/strength/`).
- **The Heracles Training Load page computes its numbers**: `site/src/trainingLoad.ts` runs
  `electron/heraclesLoad.ts` at build time for every table and the worked example. Its words
  follow `docs/heracles-training-load.md` and change with the formula.
- **GitHub is linked for talking, not for reading**: the footer and About link the
  repository, Issues and Discussions, and a page that asks for a report or an opinion links
  those two (`site/src/github.ts`). What a visitor comes to read (releases, notes, docs) is a
  page of the site, never a GitHub page; the installers are the exception.
- **Screenshots** `01-`–`18-` and `27-`–`30-` are the README's, `19-`–`26-` the site's; every
  one is taken by `scripts/screenshots/` (`npm run screenshots`, demo data only — one invented
  athlete, never a real database). A screen that changes is reshot there, not by hand.
- **Screenshots go through `Shot`/`ShotSlider`, never a bare `<img>`** (they are 3024px;
  Astro's image service writes a `srcset`); pass `sizes` when a shot is not full width.
  `16-route` is animated and served untouched (`isAnimated`).
- **Link-preview cards are committed images**: `npm run site:og` renders
  `scripts/site-og/og.html` with Electron into `site/public/og/*.jpg`; the build never runs
  Electron.
- **No em dash** in the site's copy (or the README's); text taken from the app or changelog is
  restyled at render time (`plain()`). No analytics, no cookies.
- **The domain is written in four places that must agree**: `site/public/CNAME`, `site` in
  `astro.config.mjs`, `robots.txt`, and the footer of `scripts/site-og/og.html`. DNS at
  Cloudflare is **DNS only** (grey cloud) — GitHub issues the certificate.
- **`/privacy.html` is the URL Google's OAuth consent screen links to**
  (`build.format: "preserve"`); `test:site` fails if it moves.
- `.github/workflows/site.yml` builds, runs `scripts/test-site.mjs` and pushes `site/dist` to
  `heraclesrecords/heraclesrecords.github.io` (needs `SITE_DEPLOY_KEY`), a deploy target edited
  by nothing else. A local build falls back to `site/.astro/release-cache.json` when GitHub's
  unauthenticated limit refuses; CI never does.
- Upstream's `website/` is unrelated and deleted.
