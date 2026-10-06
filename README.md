<p align="center">
  <img src="build/icon.png" alt="Heracles Records" width="112" />
</p>

<h1 align="center">Heracles Records</h1>

<p align="center">
  <strong>Training records, analytics &amp; AI - alongside your COROS data.</strong><br />
  <em>Every session a record. Every record a labour.</em>
</p>

<p align="center">
  An unofficial desktop app for COROS athletes: every session read in depth,<br />
  an AI coach that has read all of it, and a hall for every record you set along the way.
</p>

<p align="center">
  <a href="https://heraclesrecords.com"><strong>heraclesrecords.com</strong></a>
  &nbsp;·&nbsp; <a href="https://heraclesrecords.com/guide/">Guide</a>
  &nbsp;·&nbsp; <a href="https://heraclesrecords.com/changelog/">Changelog</a>
  &nbsp;·&nbsp; <a href="https://heraclesrecords.com/privacy.html">Privacy</a>
</p>

<p align="center">
  <a href="https://github.com/quochungse/HeraclesRecords/releases/latest"><img src="https://img.shields.io/github/v/release/quochungse/HeraclesRecords?style=flat-square&label=release&color=c8952f" alt="Latest release" /></a>
  <a href="https://github.com/quochungse/HeraclesRecords/releases"><img src="https://img.shields.io/github/downloads/quochungse/HeraclesRecords/total?style=flat-square&color=c8952f" alt="Downloads" /></a>
  <img src="https://img.shields.io/badge/macOS%20%7C%20Windows%20%7C%20Linux-desktop-555?style=flat-square" alt="macOS, Windows and Linux" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-555?style=flat-square" alt="MIT license" /></a>
</p>

<!-- release:badges:start -->
<p align="center">
  <a href="https://github.com/quochungse/HeraclesRecords/releases/download/v1.0.0/HeraclesRecords-1.0.0-arm64.dmg"><img src="https://img.shields.io/badge/macOS-Apple%20Silicon-1f2328?style=for-the-badge&logo=apple&logoColor=white" alt="Download for macOS, Apple Silicon" /></a>
  <a href="https://github.com/quochungse/HeraclesRecords/releases/download/v1.0.0/HeraclesRecords-1.0.0-x64.dmg"><img src="https://img.shields.io/badge/macOS-Intel-1f2328?style=for-the-badge&logo=apple&logoColor=white" alt="Download for macOS, Intel" /></a>
  <a href="https://github.com/quochungse/HeraclesRecords/releases/download/v1.0.0/HeraclesRecords-Setup-1.0.0.exe"><img src="https://img.shields.io/badge/Windows-10%20%2F%2011-1f2328?style=for-the-badge&logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI%2BPHBhdGggZmlsbD0iI2ZmZiIgZD0iTTMgNS42bDcuNi0xLjF2N0gzek0xMS42IDQuNEwyMSAzdjguNWgtOS40ek0zIDEyLjVoNy42djdMMyAxOC40ek0xMS42IDEyLjVIMjFWMjFsLTkuNC0xLjN6Ii8%2BPC9zdmc%2B" alt="Download for Windows" /></a>
  <a href="https://github.com/quochungse/HeraclesRecords/releases/download/v1.0.0/HeraclesRecords-1.0.0.AppImage"><img src="https://img.shields.io/badge/Linux-AppImage-1f2328?style=for-the-badge&logo=linux&logoColor=white" alt="Download for Linux" /></a>
</p>
<!-- release:badges:end -->

> [!NOTE]
> Heracles Records is an independent project. It is **not made, endorsed or supported by COROS**. It reads your training through your own COROS account, so it works with any COROS watch that syncs there: PACE, APEX, VERTIX, NOMAD and the rest.

## Download

<!-- release:downloads:start -->
| Platform | Installer | Size |
| --- | --- | --- |
| **macOS** · Apple Silicon (M1 and later) | [HeraclesRecords-1.0.0-arm64.dmg](https://github.com/quochungse/HeraclesRecords/releases/download/v1.0.0/HeraclesRecords-1.0.0-arm64.dmg) | 176 MB |
| **macOS** · Intel | [HeraclesRecords-1.0.0-x64.dmg](https://github.com/quochungse/HeraclesRecords/releases/download/v1.0.0/HeraclesRecords-1.0.0-x64.dmg) | 181 MB |
| **Windows** 10 / 11 · 64-bit | [HeraclesRecords-Setup-1.0.0.exe](https://github.com/quochungse/HeraclesRecords/releases/download/v1.0.0/HeraclesRecords-Setup-1.0.0.exe) | 162 MB |
| **Linux** · AppImage, any distribution | [HeraclesRecords-1.0.0.AppImage](https://github.com/quochungse/HeraclesRecords/releases/download/v1.0.0/HeraclesRecords-1.0.0.AppImage) | 184 MB |

Version 1.0.0 · [What's new](https://github.com/quochungse/HeraclesRecords/releases/tag/v1.0.0) · [All releases](https://github.com/quochungse/HeraclesRecords/releases). The app tells you when a new version is out.
<!-- release:downloads:end -->

<details>
<summary><strong>First launch</strong></summary>

- **macOS**: this build is not notarized yet. If macOS says it cannot check the app, open **System Settings → Privacy &amp; Security** and click **Open Anyway**. If it says the app is damaged, run `xattr -dr com.apple.quarantine "/Applications/Heracles Records.app"` in Terminal, then open it again.
- **Windows**: SmartScreen may warn about an unrecognised app. Click **More info → Run anyway**.
- **Linux**: make the AppImage executable (`chmod +x HeraclesRecords-*.AppImage`) and run it, or install the deb on Debian / Ubuntu (`sudo apt install ./HeraclesRecords-*.deb`).

You sign in with your COROS account. Coach also needs an AI: your ChatGPT account, a Claude subscription, a Claude or OpenRouter API key, or a model running on your own computer.

</details>

## What's inside

A tour of the main screens. [heraclesrecords.com](https://heraclesrecords.com) goes further into activities, plans, Coach and the Twelve Labours, and the [guide](https://heraclesrecords.com/guide/) walks through setting up COROS, Coach, sync and backups.

### Today at a glance

Recovery, the week's load, last night's sleep and the next session on your plan. The screen to open in the morning.

<img src="docs/readme/01-overview.webp" alt="Overview: recovery, the week's training, last night's sleep and what is planned next" />

### Sleep

Nights and naps, stages, HRV and stress across the night, kept long after the nine weeks COROS holds.

<img src="docs/readme/08-sleep.webp" alt="Sleep: stages, HRV and stress across the night" />

### Every session, read in depth

**Activities.** Every session COROS holds, across every sport, in one list. Pick one to see its heart-rate zones, running dynamics, power and every channel the watch recorded.

<img src="docs/readme/02-activities.webp" alt="Activities: every session in one list with a detail pane" />

**A page for every run, ride and hike.** A run shows pace, grade-adjusted pace, form and decoupling on a map of the route.

<img src="docs/readme/04-run.webp" alt="A run: map, pace, heart rate, running form and every channel" />

<table>
  <tr>
    <td width="50%" valign="top">
      <img src="docs/readme/03-running.webp" alt="Running: weekly volume, load ratio, VO2max and threshold" />
      <p><strong>Running</strong>: weekly volume, load ratio, VO₂max and threshold pace. Switch to Trail and the screen reads climb instead of pace.</p>
    </td>
    <td width="50%" valign="top">
      <img src="docs/readme/05-ride.webp" alt="A ride: normalised power, intensity, TSS and peak power" />
      <p><strong>Rides</strong>: normalised power, IF and TSS against your FTP, peak power from 5 seconds to an hour, power zones and the climbs.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <img src="docs/readme/06-hike.webp" alt="A hike: moving time, ascent, terrain and climbing rate" />
      <p><strong>Hikes</strong>: the moving time inside a long day, your rests, the terrain you covered and your climbing rate.</p>
    </td>
    <td width="50%" valign="top">
      <img src="docs/readme/07-strength.webp" alt="Strength: sessions and a 3D muscle map" />
      <p><strong>Strength</strong>: COROS strength sessions and Hevy workouts in one place, on a 3D map of the muscles you trained.</p>
    </td>
  </tr>
</table>

**Every route, replayed.** Open the map full size and colour the line by pace, heart rate or elevation, then watch the route draw itself the way you covered it.

<img src="docs/readme/16-route.webp" alt="A hike around Hàm Lợn replayed on a satellite map, coloured by elevation" />

### Plan your training

**Calendar**: planned and done side by side, by week or month, with a plan's compliance on every session. Drag a session to another day and it moves on your COROS calendar too.

<img src="docs/readme/09-calendar.webp" alt="Calendar: planned and completed sessions by month" />

**Training Library**: your COROS workouts and plans. Read them, build new ones, edit, duplicate and put a plan on the calendar. Everything saves straight to your COROS account, so your watch has it.

<img src="docs/readme/10-library.webp" alt="Training Library: a 12-week marathon plan, week by week" />

### A coach that has read your training

Ask about a session, a week or how well you are recovering. Coach reads your COROS data and answers with the numbers and the charts behind them.

<img src="docs/readme/11-coach.webp" alt="Coach: an interval session analysed, with heart-rate and pace charts" />

Ask for a plan and Coach drafts it with you: the brief, the outline, then every session. Read it in the Workbench beside the conversation, change what you like, and save it to COROS and your calendar. Changes Coach suggests to your week arrive as a list you apply one line at a time.

<img src="docs/readme/12-coach-plan.webp" alt="Coach: a marathon plan in the Workbench beside the conversation" />

Coach runs on your ChatGPT account, your Claude subscription, a Claude or OpenRouter API key, or a local model. Each conversation reads only the data you allow. Scheduled analyses can debrief every new activity on their own, and never change anything without you.

### Hall of Records

Every milestone you reach is kept: firsts, records, streaks, totals and new places, month by month.

<table>
  <tr>
    <td width="50%" valign="top">
      <img src="docs/readme/14-timeline.webp" alt="Hall of Records: the timeline of milestones" />
      <p><strong>Timeline</strong>: every first, record and streak, and the labour stage it reached.</p>
    </td>
    <td width="50%" valign="top">
      <img src="docs/readme/13-labours.webp" alt="Hall of Records: the Twelve Labours" />
      <p><strong>The Twelve Labours</strong>: twelve kinds of achievement in three stages each, from your first weeks to your first year. Speed and VO₂max are graded for your age and sex, so a stage means the same for everyone.</p>
    </td>
  </tr>
</table>

### Where you've been

Every place your training has taken you, on a globe.

<img src="docs/readme/15-places.webp" alt="Where you've been: every place you trained, on a globe" />

### Settings

- **Appearance.** Light or dark, your own accent and sport colours, metric or imperial.
- **Your sports.** Running, Cycling, Hiking and Strength each have a screen; keep the ones you train.
- **Cloud sync.** Use two computers? Sync them through your own Google Drive. Passwords and sign-ins never leave the machine they were made on.

<table>
  <tr>
    <td width="50%" valign="top">
      <img src="docs/readme/17-settings.webp" alt="Settings: sport screens and appearance" />
      <p><strong>Sport screens and appearance</strong></p>
    </td>
    <td width="50%" valign="top">
      <img src="docs/readme/18-sync.webp" alt="Settings: sync through Google Drive" />
      <p><strong>Google Drive sync</strong></p>
    </td>
  </tr>
</table>

### Your data stays yours

- Your training comes from your COROS account and stays on your computer.
- Back up everything to one file you keep, and restore it whenever you like.

## From CorosLink to Heracles Records

Heracles Records began as a fork of CorosLink, a desktop companion for COROS watches. As my own training grew, what I wanted from it changed: a full record of everything I had done, analytics deeper than a summary screen, and an AI coach that reads all of it. A complete training system rather than a set of tools. So I rebuilt the app around that: training records, deep analytics and AI.

If you are looking for music and media on your watch, offline maps and routes, watch faces or gear tracking, **CorosLink** does those well and is the app to use. They are not part of Heracles Records.

## Support

- Found a bug or have an idea? [Open an issue](https://github.com/quochungse/HeraclesRecords/issues/new), or use **Settings → About → Report an issue** in the app.
- Questions about setup? The [guide](https://heraclesrecords.com/guide/) and its [FAQ](https://heraclesrecords.com/guide/faq) may already answer them.
- Website: [heraclesrecords.com](https://heraclesrecords.com)
- If the app helps your training, you can [buy me a coffee](https://buymeacoffee.com/quochungse).

<details>
<summary><strong>Build from source</strong></summary>

```sh
npm install
npm run rebuild   # rebuilds the SQLite module for Electron
npm run dev
```

</details>

## License

[MIT](LICENSE). Heracles Records is based on CorosLink by AtoZ, also MIT. Third-party software and fonts are credited in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

COROS is a trademark of COROS Wearables, Inc. It appears here only to say which watches and accounts the app works with.
