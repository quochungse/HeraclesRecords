---
title: Troubleshooting
description: What to do when the app will not open, COROS signs you out, or a screen stays empty.
order: 9
---

## macOS says it cannot check the app

Open **System Settings → Privacy & Security** and click **Open Anyway** beside Heracles Records. You are asked once.

## macOS says the app is damaged

The app is not damaged; macOS has quarantined a download from an unidentified developer. Run this in Terminal, then open the app again:

```sh
xattr -dr com.apple.quarantine "/Applications/Heracles Records.app"
```

## Windows SmartScreen warns about the installer

Click **More info → Run anyway**. The warning is for apps without a paid code-signing certificate.

## The Linux AppImage does nothing

Make it executable first:

```sh
chmod +x HeraclesRecords-*.AppImage
```

## COROS signed me out

COROS keeps one Training Hub session per account, so signing in elsewhere (the Training Hub website, or the app on another computer) ends this one. Sign in again from the banner or **Settings → Connections → COROS account**. More in [Connect your COROS account](/guide/connect-coros).

## Sleep says "Sleep needs MCP"

Sleep comes through COROS MCP, a separate connection. See [Sleep and health data](/guide/sleep-and-health).

## Coach says it is not set up

Coach needs an AI to run on: [Set up Coach](/guide/set-up-coach). If one was working and stopped, open **Settings → Connections → Coach Models**; a sign-in that expired or a usage limit shows there.

## A screen shows an older session or nothing new

Use the refresh button on the screen. If COROS itself is slow to answer, the app shows what it already has and fills in the rest when COROS replies.

## Something else

Open **Settings → About → Report an issue**. It offers the app's recent error log to copy, with emails, paths and keys taken out, and a button that opens a new issue on GitHub. Paste the log in and say what you were doing.
