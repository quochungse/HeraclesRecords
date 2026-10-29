# Coach

Streaming chat with COROS-data tools, in both processes: `electron/chatService.ts` with four
providers (`claudeCodeProvider`, `anthropicChatProvider`, `openRouterProvider`,
`localChatProvider`; ChatGPT through `chatResponsesProtocol.ts`), tool modules
(`chatActivityTools`, `chatAnalyticsTools`, `chatSleepTools`, `chatWorkoutTools`,
`chatPlanTools`, `chatInteractionTools`, `chatConversationTools`), MCP servers, and the screen
in `src/chat/`. Plans in the conversation: [docs/coach-plan-canvas.md](../../docs/coach-plan-canvas.md).
Analyses: [docs/coach-analysis.md](../../docs/coach-analysis.md). `npm run check:coach` is the
suite CI runs ([docs/coach-checks.md](../../docs/coach-checks.md)).

Names that leave the machine: the Agent SDK client app is `heracles-records-coach`, its MCP
server `heracles` (tools `mcp__heracles__*`).

## Tools

- Read tools fetch only what a question is about (date windows, sport family, `sections`,
  `window`, `days`, `night`), and each formatter computes its own totals and deltas so the
  model reads rather than does arithmetic.
- **Recovery heart rate is the one slept at** (`electron/sleepHeartRate.ts`: the main sleep's
  average and lowest against a 28-night median), never COROS's whole-day resting HR.
- **COROS MCP keeps only what it alone has**: a remote read with a local answer is in
  `SUPERSEDED_COROS_MCP_TOOLS`; `queryMenstruationCycles` is offered only when the COROS
  profile's sex is known female; `CLAUDE_REMOTE_READ_TOOLS` names the server's real reads
  Claude Code is offered. `narrowCorosMcpTools` hides superseded tools (while the local one is
  offered), tools no turn can act on, and **every COROS MCP write** (`COROS_MCP_WRITE_TOOLS`),
  which `executeChatTool` also refuses by name. A read-only run takes a `coros__` tool only
  when its verb is `query`/`get` (`isCorosMcpRead`).
- **A new local tool must be placed** on one side of `READ_ONLY_ALLOWED_TOOLS`
  (`test:coach-analysis-guards`) and given a source in `LOCAL_CHAT_TOOL_SOURCES`
  (`chatToolSources.ts`, `test:chat-tool-sources`). The badge under an answer groups calls by
  source: DB, Coros, MCP (`server__` prefix), Web.
- **Tool schemas are re-sent every round**, so the draft schemas have one workout shape and one
  step definition (no per-sport `oneOf`, no `$ref` on the write path); per-sport rules live in
  `validateWorkoutDraftShared` (errors handed back to the model) and
  `buildCoachSportCapabilityGuide` (prose). `revise_training_plan`'s `ops[].workout` is an open
  object. `test:chat-workout-tools` holds each schema under 20 kB.
- `get_training_zones` answers with the account's own tables; the snapshot carries
  thresholds, body metrics and all-time records. An activity analysis is handed the 72 hours
  before its activity (`formatPrecedingTraining`), strength sessions with their muscles.
- Coach reads the athlete's COROS plans (`list_training_plans` from the Library's cache,
  `get_training_plan` from `detail`); a plan on the calendar is read as its running copy
  (`calendar_plan_id`). Progress comes from activities, so a conversation withholding them
  gets the plan without it. The count is `electron/planCompliance.ts`, shared with the Library.

## Writes: drafts, change sets and patches

Coach never writes to COROS directly; it writes drafts and change sets the athlete applies.
- **A change set** (`chatScheduleChanges.ts`, `chat_schedule_changes`, `personal`) is a
  `scheduleChange` anchor plus a card whose lines are applied or dismissed one at a time or
  all at once (`chat:applyScheduleChange` / `chat:dismissScheduleChange`).
  `propose_schedule_changes` (move, replace, remove, add, patch; ≤ 20 lines) is checked in the
  turn and refused whole; it writes nothing, so it is read-only-allowed. `delete_workout`
  stages one. **Every line reads COROS again before it writes** (a session gone or renamed goes
  `stale`), **one line is one write**, recorded as it lands, never written twice. Moves and
  replacements go through `electron/scheduleMoves.ts`, as the Calendar's do.
- **Partial edits** ([docs/coach-workout-patches.md](../../docs/coach-workout-patches.md),
  `electron/workoutPatch.ts`): Coach sends only changed fields — `patch_session` in
  `revise_training_plan` for a draft or a Coach plan session, `op: "patch"` in
  `propose_schedule_changes` for a calendar session or library workout. The app keeps the full
  source and builds COROS's full write on Apply. Paths are absolute, zero-based; arrays cannot
  be inserted, removed or reordered by a patch; sport, exercise identity, placement and COROS
  ids are not patchable; ≤ 50 field edits; `null`, unknown fields and duplicates are refused.
  **A step edit of a saved workout needs the `revision` Coach read** — a 16-hex SHA-256 over
  the editor's ref, the program and the calendar entity, keys sorted, shared with the Library
  and Calendar editors and checked again at Apply. `list_scheduled_workouts` gives each session
  its revision and steps numbered as patch paths (`[1.0]` = `/steps/1/steps/0`) from the one
  range read it already makes. A one-off workout saved from a Coach card is edited this way
  (`revise_training_plan` refuses it with `draft_saved`).
  **A patch path indexes `editorDraftToPlanWorkoutInput`'s steps**, which map one to one onto
  the editor's nodes and `planWorkoutInputToEditorDraft`'s — a converter that drops or merges
  a node makes patches hit the wrong step. A change to what the revision hashes (or to the
  calendar list's read against `getWorkoutForEdit`'s) turns every pending patch stale.
  `patch_session` refuses a draft synced from COROS or changed meanwhile, and a structural op
  on the same key; on a saved plan the patch is applied to the stored COROS program too
  (`patchedPlanPrograms`).
- **An analysis run leaves at most two cards** (`runCards`), held in code.
- **Text COROS stores is bounded in UTF-8 bytes** on every write path (see
  `electron/CLAUDE.md`). Session notes (`overview`) are exposed to Coach and go out as the
  workout's overview.

## Models and providers

- **Every picker reads the provider's own list** (`modelCatalog.ts`, `providerModelOptions`):
  Anthropic `/v1/models` (beta `server-side-fallback-2026-06-01`), OpenRouter `/models/user`,
  the Codex backend's `/codex/models` (asked with the latest Codex release version, or the
  server hides newer models), Claude Code's `supportedModels()`. Held in `chat.modelCatalog.*`
  (`device`), refreshed once a day or by a provider card's Refresh or a key's Save/Test
  (`force`). **A failed or empty read never replaces a held list.** These fields and Claude
  Code's `availableModelsAt`/`availableModelsFrom` are written by main only —
  `saveChatSettingsToStore` never writes them back. A model a provider stops listing stays
  chosen, marked (`withCurrentModel`).
- **A request follows the listed row**: thinking, effort levels, output ceiling and fallback
  come from the API row, `MODEL_CAPABILITIES` only for a missing field. An effort a model does
  not take is clamped (`effortForModel`, which reads any non-Claude value as High), never sent
  (that is a 400). **ChatGPT's reasoning efforts are the model's own**
  (`ModelCatalogEntry.reasoning`), checked again for each model Auto tries.
- **`""` is an explicit choice** — Auto or Default model, ChatGPT's Auto effort — so code
  reading a model or effort tests `!== undefined`, never truthiness.
- **AI Model Providers manages connections only** (sign-in, keys, one Refresh per card); a
  model and effort are chosen per conversation. The panel loads on demand behind an error
  boundary (`CoachModelsModal`) and must stay out of the initial, Coach and AI-sheet chunks
  (`test-coach-provider-bundle.mjs`, run by `check:coach` with `HERACLES_CHECK_COACH=1`, which
  makes Vite write a manifest). Pickers deep in a modal read lists through
  `ModelOptionsContext`.
- **Claude Code CLI**: with several installs the newest `--version` wins, cached per path and
  mtime (`detectClaudeCodeExecutable`); nothing detected is stored, and a stored path at a
  standard location is ignored (`isStandardClaudeLocation`). It always runs against the app's
  own login (`<userData>/claude-code` as `CLAUDE_CONFIG_DIR`).
- **Plan usage** (`chat:readProviderUsage`, `electron/providerUsage.ts`, node-free) is read on
  request only, for Claude Code (the SDK's experimental usage call) and ChatGPT
  (`backend-api/wham/usage`); both unpublished, so read by name and defensively.
  `test:provider-usage`.
- `npm run test:model-catalog`, `test:chatgpt-effort`, `test:coach-providers-renderer`.

## A conversation's own settings

- **A conversation keeps the provider it was started with** (`chat_sessions.provider`) and
  stores its whole AI (provider, model, effort) in `chat_conversation_settings` (`personal`)
  when created, seeded from `chat.conversation.lastUsed.<provider>` (`preference`, updated by
  each turn and change). The list is not split by provider.
- **The conversation's Permissions tiles are the only control of what Coach reads**, for every
  provider alike — there are no provider-level data permissions.
- An analysis takes the conversation's sources and runtime through `analysisRuntimeOver`: a
  provider and a model are one choice, taken whole from one side, the analysis first; effort is
  taken on its own, so an analysis runs at the conversation's effort unless it sets one. An
  effort the analysis's provider does not take falls back to that provider's default.
- **Withheld sources are withheld twice**: from every tool that reads them
  (`toolReadsWithheldSource`) and from the snapshot (`buildTrainingContext`'s scope), through
  a `runTools` reach (`conversationReach`). Every non-COROS MCP server is withheld whenever any
  source is (only COROS's tools can be sorted by what they read).
- **Web search is the provider's own** (`ConversationSettings.web`, off by default): CLI
  `WebSearch`/`WebFetch`, Messages API server tools, ChatGPT `web_search`, OpenRouter's;
  honoured only under the interactive policy and outside text jobs. A request refused for
  naming the web tool is retried without it.
- **What waits on the athlete** (`ChatSessionSummary.waiting`, derived) counts unanswered
  questions, open change-set lines and briefs not yet a plan through the counter `chatService`
  registers (`setWaitingCounter`), so every summary path counts the same.
- `npm run test:conversation-settings`.

## Plans in the conversation

- **A plan longer than two weeks starts as a brief** (`request_plan_brief` →
  `chat_plan_artifacts`, a `planBrief` anchor), edited on `CoachBriefEditor`. AI Plan in the
  Library opens that editor and creates nothing until Start plan. **The outline and sessions
  are pipeline steps** (`ChatPipelineStep` as `chat:send`'s fifth argument): read-only turns
  offered one writing tool (`propose_plan_outline`, `draft_training_plan`), checked in the turn
  (`planOutlineProblems`, `generatedPlanProblems`) with reasons handed back; a step sends its
  prompt after six messages, never the whole transcript or summary (`pipelineWire`). The rules
  are `electron/trainingPlanGeneration.ts` (node-free; Monday starts, a week is a band of
  sessions). `npm run dev:simulate-plan-ai` runs both steps against the real tools.
- **A Coach plan stays in the conversation until saved** (`chat_plan_drafts`, not the
  Library). Every edit — the athlete's (`chat:editPlanDraft`, `chat:editWorkoutDraft`) or
  Coach's (`revise_training_plan`, operations not a restated plan) — writes the creation's
  **next version**; a save begun on a replaced version answers `conflict`. An edit leaves a
  `planEvent` (with Undo while newest). **Every turn carries `creationIndex`**
  (`chatContextCompaction.ts`): a line per creation, its newest draft id, author, saved state,
  and the outcome of every proposal.
- **A saved plan stays the conversation's to change**: later versions carry its COROS identity
  and save through `plan/update` (**Update COROS plan**). A change made on COROS comes back as
  a version authored `coros` (`syncPlanDraftFromCoros`); an unsaved version is never synced
  over. **A draft is read from its row every time** (`loadStoredPlanDraft`) — a cached copy
  once `plan/add`ed a plan twice; saves are serialised per creation (`savingArtifacts`).
  `PartialUploadError` names the sessions that landed so a retry writes only the rest.
- It goes on the calendar through the Library's `TrainingPlanCalendarDialog`; an unsaved
  version previews as `chat:<draftId>` through `setChatPlanReader` (the two modules must not
  import each other).
- **The Workbench** (`CoachCanvas`, `.chat-workbench`) is a non-modal panel beside the
  conversation: the index, or one creation's details with versions (`electron/planDiff.ts`)
  and Restore. Under `WORKBENCH_FOLD_WIDTH` the conversation list folds (the athlete's own
  collapse setting is untouched); under `WORKBENCH_SHEET_WIDTH` it becomes a sheet over the
  whole conversation. Its buttons and the card's come from `artifactActions`.
- **A question can point at what it is about**: Ask Coach puts a chip by the composer and
  sending writes a `planRefs` (a Coach creation) or `scheduleRefs` (calendar, activity) anchor
  folded into the question by `toWireMessages`. A `PlanRef` chip only goes to its own
  conversation. From the Calendar and Library, `CoachAskPicker` asks which conversation.
- Coach may attach up to two workout cards unasked (`chat.coach.inlineSuggestions`). An
  answer may end with up to three `[[next:…]]` lines, drawn as chips under the last answer
  only (`splitNextSteps`). Creations have no follow-up chips.

## The transcript

- **A field on a transcript entry is rebuilt in four places**: `PersistedChatMessageEntry`,
  `parseMessageEntry` (`chatHistoryStore`), `toPersistedEntries` / `fromPersistedEntries`
  (`chatTypes.ts`). Miss one and it is lost on reopen. Parsers pass unknown keys through
  (`keepUnknownKeys`) and unknown kinds as `{ kind: "opaque", raw }`, so a field must be listed
  only to be *read* — but **a new field must never go onto an existing entry kind** (an older
  build drops it and wins the merge): new data goes in a table, a new kind is only an anchor.
  A field an entry *may* carry must be optional in the parser. `test:chat-entry-passthrough`,
  `test:chat-transcript-compat`, `test:chat-history-store`.
- **Nothing is written during a turn** (the question is saved at send, the rest at the end).
  Anything that re-reads the transcript **flushes this window's pending save first, never
  cancels it** (`reloadTranscript`). `test:chat-transcript-race`.
- **`foreignTail` decides by content as well as position**: it drops the longest head of the
  tail the caller's array already holds anywhere past `knownEntryCount`.
- **A turn that errors after producing output keeps it** (with a "stopped before finishing"
  notice); only a turn that produced nothing is undone. `streamedTextRef` exists because state
  is stale inside the subscription.
- **A turn is the unit deleted, edited, hidden and branched** (`electron/chatTurns.ts`,
  node-free; `chatTurnService.ts`): changed in main, read-cut-written with nothing awaited
  between, after the window flushes; named by its question's `mid` (`TurnRef`); refused while
  anything writes into the conversation (`turnsBusyIn`). Boundaries move with the entries
  (`shiftBoundary`). Only what can go goes: nothing saved to COROS, no proposal with an
  applied line. Edit and retry are `editTurn`, last turn only. A hidden turn is a row of
  `chat_hidden_turns`, masked by `maskHiddenTurns` everywhere Coach reads (an analysis that
  cannot mask fails). A branch is a new conversation that leaves behind every anchor naming a
  row. `npm run test:chat-turn-actions`.
- **A turn reads chart, answer, then creations** (`orderTurn`, `isChartKind` in node-free
  `electron/chartPlacement.ts`, used by the settle, the streaming bubble and the headless
  sink). An answer may place a chart with `[[chart:c2]]` on a line of its own; nothing is
  stored beside the entry, and every reader of the words as text strips placeholders
  (`stripChartPlaceholders`).
- **Rows a settle or reload mounts do not animate in** (`ChatRow`, `.is-settled`, marked by
  identity in `settledEntriesRef`): the enter animation starts at opacity 0 and a window
  without frames left new turns invisible. When probing a paint bug over CDP, read computed
  style before capturing — the capture forces a frame.
- **Cost**: `chat:streamDone` carries `usage` and `model`; a token read from the prompt cache
  counts as a tenth (`electron/tokenUsage.ts`, `CACHE_READ_WEIGHT`) in the footer, run logs,
  the month's spend and the budget. A provider reporting nothing leaves a turn unpriced, not 0.

## Context sent to the model

- **The system prompt is three parts, ordered for the prompt cache**:
  `buildBaseCoachInstructions` (who the coach is; **names no tool** — `test:chat-service`
  fails on one), then tool rules written once in `withLiveToolInstructions` (each only when
  its tool is offered), then `buildTrainingContext`'s live part last (today's date, no time,
  and the snapshot). The Messages API sends two blocks with a cache marker on the first.
- **A long conversation is three layers held to tokens** (`planTranscriptContext`): recent
  turns verbatim, older ones condensed (the athlete's words plus a digest of each answer), the
  rest as the running summary (`chat_sessions.coach_summary_through`,
  `coach_condensed_through`). Turns move between layers in batches so the cached prefix
  changes rarely. Budgets: `chat.compactContext.detail`.
- **Digests and the summary are text jobs** (`runTextJob`: own prompt, no snapshot, tools or
  MCP) on `chat.compactContext.model` (`auto` = smallest family the conversation's provider
  lists). A digest is made in the background and checked (`digestProblems` refuses dates or
  figures its answer lacks); a Haiku-class model runs with a 1,500-token thinking budget.
  Digests are keyed by a hash of the answer (`chat_answer_digests`, `derived`). Everything here
  is best-effort.
- What is not sent verbatim stays readable through `recall_conversation` (search in node-free
  `chatRecall.ts`), offered only while there is something to recall.
- Claude Code's prompt is every message it is handed (`formatClaudePrompt`).

## The screen

- The head is the open conversation's (`ChatConversationHeader`). The composer
  (`ChatComposer.tsx`) heads its box with what the question points at (`ComposerRefs`,
  previews from `refPreview.ts`, no request); **the question being written is a draft per
  conversation** (`composerDrafts.ts`, localStorage, `device`). The AI chip under the words is
  the conversation's AI and opens `ConversationAiSheet`, which also holds the Permissions
  (what Coach may read).
- **The transcript is held at its end while it grows** (`stickToEndRef`, a ResizeObserver);
  only a move up lets go.
- **Only the tail is drawn** (`TRANSCRIPT_TAIL`, more as the athlete scrolls up), so anything
  that scrolls to an entry goes through `withEntryRow`; charts mount near the viewport only
  (`ChartWhenNear`) and chart cards are memoised on `preview`.
- **Stop reaches a turn that has not reached a provider yet**: preparation steps are awaited
  through `untilAborted`, and providers check `signal.aborted` on entry.
- **A turn belongs to its conversation** (`turnSessionId`): leaving mid-turn parks it
  (`parkedTurnRef`) and its stream writes into the parked copy, saved to its own row. **Two
  turns at once are refused**, not queued.
- A blank conversation is reused or deleted when left, unless an analysis is attached.
- **Coach settings** (`ChatSettingsModal` over `ChatSettingsPanel`) edit a draft written on
  Save; Discard drops it. The dialog repoints `--accent`/`--surface` to the app's palette
  (`.chat-settings-backdrop`) because `.chat-view` redefines them. **Coach style**
  (`electron/coachStyles.ts`) is the one place a tone is chosen; it changes tone only, never
  what goes onto a card.
- Rules for library controls reused here: see `src/training-library/CLAUDE.md` (four scopes).

## Coach Analysis

Headless runs (`coachAnalysisService/Scheduler/Store.ts`, `coachActivityWatcher.ts`), tied to
the app lifecycle, read-only (drafts land as cards). [docs/coach-analysis.md](../../docs/coach-analysis.md)
is current; `docs/coach-automations*.md` are the pre-refactor record (accurate on the pipeline,
guard rails and cost; wrong on the data model).
- **One analysis lives in exactly one conversation**: a role, a playbook, a runtime, a fixed
  `sessionId`, optionally a trigger. Created from a conversation, deleted with it
  (`applyAnalysisSessionDeleted`). No definition/attachment split and no cross-conversation
  list (`test:ipc-surface` fails on a channel spelling `Attach`).
- **Nothing in the feature creates a chat session.** Reaching the runner with the conversation
  gone switches the analysis off rather than deleting it.
- **"This device only" is its own table** (`coach_analysis_local_triggers`, `device`): a
  column withheld from a synced row would arrive as NULL. Turning the flag on clears the row's
  `trigger_json`; off deletes the local row. `readTrigger`/`writeAnalysis` alone know which side
  a trigger is on.
- Pre-refactor tables are dropped, not migrated (`dropLegacyAutomationTables`;
  `test:analysis-legacy-drop` is its own file because `initializeDatabase` reuses the
  process's database). Two stored spellings stay pre-rename on purpose: the
  `coachAutomation.pause` / `coachAutomation.monthlyTokenBudget` settings and the
  `automation`/`automationId` keys in transcript entries.
- The pause and the monthly budget live in Coach's settings dialog.
