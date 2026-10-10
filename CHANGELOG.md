# Changelog

All notable changes to Heracles Records are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.0] - 2026-10-10

### What's new

- **Multi languages supported**  In your language, on every screen. Heracles Records now speaks 13 languages, pick one under Settings: English, Vietnamese, Japanese, Korean, Simplified Chinese, Spanish, Brazilian Portuguese, French, German, Italian, Russian, Indonesian and Thai.
- **Coach** - can search the web for things your data does not hold, such as a race's course and cut-offs, and names the pages it used. It is off until you switch on Web for a conversation. What a conversation may read now sits under Permissions in its AI sheet.
- **Overview** - the Sleep card shows the past seven days, and upcoming workouts list today and tomorrow in full.

### Fixed

- Coach's plan outline lists every session of a week, and a library workout goes into a plan or the calendar correctly.
- Improve app performance and stability.

## [1.0.3] - 2026-10-09

### What's new

- **Cycling** — your cycling VO₂max from COROS, on the Cycling screen and for Coach.
- **Sync** — faster and lighter: only what changed is sent and fetched. Update every computer you sync: older versions stop syncing once one machine runs 1.0.3.

### Fixed

- Improve app performance and stability.

## [1.0.2] - 2026-10-08

### What's new

- **Overview** — "Your physique" replaces the recovery ring: a wireframe of your body, shaped by your personal data and lit up to today's recovery in a colour that runs from red to green with it. Weekly Activity shows the week's totals beside its chart.

### Fixed

- Improve app performance and stability.

## [1.0.1] - 2026-10-06

### What's new

- **Where you've been, redesigned** — the globe sits beside a list of places. Point at one in the list or on the globe and both follow; open it to see its figures, the sports trained there, visits by month and its activities. A place is now one province or state, no more than 25 km across, named by its region until the town is found. Country borders and coasts are drawn on the globe, and zooming in opens a street map of your routes.
- **Hall of Records** — each month has a clear heading and a long month folds behind "N more". The Cattle of Geryon counts the same places Where you've been draws.
- **Linux** — a `.deb` for Debian and Ubuntu beside the AppImage. The AppImage still updates itself.
- **Coach** — tokens read from the prompt cache count as a tenth, so a turn's total and the monthly budget match what was spent. Settings tell you when a newer Claude Code is available.

### Fixed

- Sleep shows up as soon as COROS MCP is connected, without pressing Refresh.
- Improve app performance and stability.

## [1.0.0] - 2026-10-03

The first release of Heracles Records: a desktop companion for COROS athletes,
for reading your training in depth, planning it with an AI coach, and keeping a
record of everything you have achieved. It reads your watch through your COROS
account; it is not made or endorsed by COROS.

### Training

- **Overview** — today's readiness, the week's load and what is planned next, in one screen.
- **Activities** — every session COROS has, in one list with a detail pane, across all sports.
- **Running, Cycling and Hiking** — a screen per sport, each reading what that sport is about: pace, efficiency and drift for runs (and climb for trail runs), power, IF, TSS and climbs for rides, ascent, moving time, rests and terrain for hikes.
- **Strength** — COROS strength sessions merged with Hevy workouts, with a muscle heat map.
- **Sleep** — nights, naps, stages, heart rate and HRV, kept beyond the nine weeks COROS holds.

### Planning

- **Calendar** — scheduled workouts and completed activities by week or month; drag a session to move it.
- **Training Library** — your COROS workouts and plans: read, build, edit, duplicate and put plans on the calendar, saved straight to your COROS account.
- **Coach** — an AI coach that reads your COROS data and answers in charts, drafts workouts and multi-week plans, and proposes calendar changes you apply one line at a time. Runs on your ChatGPT account, your Claude subscription, a Claude or OpenRouter API key, or a local model. Scheduled analyses can debrief new activities on their own, read-only.

### Your journey

- **Hall of Records** — every milestone you have reached, month by month, and the Twelve Labours: twelve kinds of achievement in three stages each, with speed and VO₂max graded for your age and sex.
- **Where you've been** — every place you trained, on a globe.

### Your data

- **Sync through Google Drive** — conversations, plans and preferences stay the same on every computer signed in to the same COROS account. Sign-ins never leave the machine they were made on.
- **Backup and restore** — one file you keep, restorable into the COROS account that made it.
- Light and dark themes, a choice of accent colours, per-sport colours, metric and imperial units.
- **Report an issue** from Settings → About, with a redacted log of recent errors to copy.
