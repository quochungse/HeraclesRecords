---
title: Set up Coach
description: Connect the AI Coach runs on, choose what each conversation may read, and set its tone.
order: 3
---

Coach needs an AI to run on. Open **Settings → Connections → Coach Models → Manage** and connect one or more of these.

| Provider | What you need |
| --- | --- |
| **ChatGPT** | Your ChatGPT account. |
| **Claude subscription** | A paid Claude plan, and Claude Code installed on the computer. |
| **Claude API key** | An Anthropic API key. Pay as you go. |
| **OpenRouter** | An OpenRouter API key. |
| **Local model** | Ollama or LM Studio running on the computer. |

## ChatGPT

Press **Sign in**. Your browser opens ChatGPT's sign-in page; once you are signed in, come back to the app. The models your account offers appear in the list.

## Claude subscription

1. Install Claude Code on the computer (see [claude.com/claude-code](https://claude.com/claude-code)).
2. In Coach Models, press **Check**. The app finds the installed Claude Code.
3. Press **Sign in** and finish in your browser.

The app signs in with a Claude login of its own, so a Claude account you use elsewhere on the computer, in a terminal for instance, is left alone. Heracles Records never sees your Claude password.

## Claude API key or OpenRouter

Create a key in your [Anthropic console](https://console.anthropic.com) or at [openrouter.ai](https://openrouter.ai/keys), paste it in, and press **Save** or **Test**. Keys are stored encrypted on this computer and never synced.

## Local model

Start [Ollama](https://ollama.com) or [LM Studio](https://lmstudio.ai) and load a model, then press **Detect** in the Local model section. The app looks for a server on this computer and lists its models. Nothing you ask leaves the computer. How well a local model coaches depends on the model; a small one may struggle with the longer questions.

## Choosing per conversation

Coach's default AI is the one you pick in Coach Models. Each conversation can use a different one: the AI chip under the message box says which, and opens the choice for that conversation.

The same conversation settings choose what Coach may read: switch off activities, sleep or anything else a conversation has no business seeing. What is switched off is withheld from Coach's tools and from what it is told, not only from the prompt.

**Web** is there too. With it on, Coach can search the internet when a question needs something your data does not hold, such as a race's date, course or cut-offs, and it links the pages it used. The search runs through the AI you chose: on a Claude or ChatGPT subscription it is part of the plan, with an Anthropic or OpenRouter key each search is billed to that account, and a local model cannot search at all. Automatic analyses never search.

## Tone and instructions

The gear in Coach opens its settings:

- **Coach style**: Friendly, Motivating, Neutral, Straight talk or No filter. It changes the tone only, never what goes on a workout or a plan.
- **Instructions**: anything Coach should always know or do, in your own words.
- **Automatic analyses**: pause them all, and set a monthly budget for what they may spend.

## What it costs

The app is free; the AI is billed by its provider. With ChatGPT or a Claude subscription it comes out of your plan's usage. With an API key, every answer shows the model and the tokens it used, so you can see what a question cost.
