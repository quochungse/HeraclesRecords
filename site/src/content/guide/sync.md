---
title: Sync two computers
description: Keep conversations, plans and settings the same on every computer, through your own Google Drive.
order: 6
---

If you use Heracles Records on more than one computer, Sync keeps them the same through a folder in your own Google Drive.

## Turn it on

1. Sign in to COROS first. Sync keeps one record per COROS account, so it needs to know whose it is.
2. Open **Settings**, find **Sync** and connect Google Drive. Your browser opens Google's sign-in page.
3. Do the same on your other computer, signed in to the same COROS account.

The first computer publishes everything it already has; the next one merges it with its own. From then on, changes go out as you make them.

## What syncs

- **Yes**: Coach conversations, plan drafts, your app preferences and the rest of what you made in the app.
- **No**: passwords, API keys and every sign-in, COROS and Google included. Each computer signs in for itself.
- **Not needed**: your activities. They come from COROS on every computer.

## What Google can see

The app asks only for the `drive.file` permission: it can read and change the files it created in one folder named **Heracles Records**, and nothing else in your Drive. Those files are scrambled with a key built into the app, which keeps them out of Drive's previews and search. It is not encryption against someone who has your Drive.

## One account per folder

The folder belongs to the COROS account that first used it. Another COROS account is refused rather than mixed in, because two people's records cannot be pulled apart afterwards.

## Turning it off

Disconnect under **Settings → Sync**, or remove the app's access at [myaccount.google.com/permissions](https://myaccount.google.com/permissions). To delete what Sync stored, delete the **Heracles Records** folder from your Drive.
