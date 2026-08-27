# The main↔renderer contract — what the window is told, and what it is not

R3 step 5 of [coach-automations-review.md](./coach-automations-review.md).
Sections 9.1, 9.3 and 10 of [coach-automations.md](./coach-automations.md).

Phase 2's UAT produced six bugs and five were one shape: *something true in the
main process that no window was ever told about*. The lesson recorded then —
**every push the main process sends is part of the feature's contract, not an
optimisation** — has never been checked as a whole. This file is that check.

**Step 5 fixed nothing** — the output was the gap list, ranked by what an
athlete would actually notice. **Step 6 is done**, and §7 below records what it
built, what it deliberately left, and what mutating the whole renderer suite
turned up.

---

## 1. The whole push surface

Two channels. That is all of it.

| Channel | Emitted by | Payload |
|---|---|---|
| `coachAutomation:runUpdate` | `emitAutomationRunUpdate` — the runner on every row it writes, the scheduler on a `stale-slot` skip | one `CoachAutomationRun` |
| `coachAutomation:pauseUpdate` | `emitAutomationPauseUpdate` — the runner's `setPause` dep | the pause, or null |

Plus the tee sink ([coachAutomationService.ts:1819](../electron/coachAutomationService.ts#L1819)),
which forwards a run's `chat:stream*` events to whatever window exists. Every
window handler filters those on `activeRequestIdRef` or `liveAutomationRef`, so
a run's stream cannot corrupt the athlete's own turn — 5.6b's rule, and it
holds.

Both automation pushes go through `emitToAnyWindow`, which resolves the window
lazily on each emit. Correct per 5.6b, and it means a run with no window open
simply drops its pushes — which is what the mount reads are for.

## 2. Every surface, and what it follows

| Surface | Reads on mount | Follows `runUpdate` | Follows `pauseUpdate` |
|---|---|---|---|
| `CoachAutomationsPanel` | summaries, pause, spend | full `refresh()` + spend | ✅ |
| `CoachAutomationDetail` | automation, **bindings**, runs | **runs only** | ✗ |
| `ConversationCoaches` | bindings, automations, running runs | full `refresh()`, unfiltered | ✗ |
| `ChatView` — conversation list | on mount and provider change | `refreshSessions` when the run has a session | ✗ |
| `ChatView` — attention marks | on mount and `automationsVersion` | `refreshSessionAttention`, or marks read if open | ✗ |
| `ChatView` — live bubble | — | filtered on the active session | ✗ |
| `AttachAutomationScreen` | sessions, automations, bindings | ✗ | ✗ |
| `AttachCoachToConversationDialog` | automations | ✗ | ✗ |
| `RunNowDialog` | bindings | ✗ | ✗ |
| `DeleteAutomationDialog` | nothing — `bindings` arrives as a prop from the detail screen | inherits G2 | ✗ |
| `AutomationDefinitionForm`, `CoachAutomationCreate` | nothing live | n/a | n/a |

`automationsVersion` is ChatView's second channel: the modal reports on
`onChanged` and again on close, the popover on every mutation it makes, and the
run-log row bumps it on the way into a conversation. Every panel mutation goes
through `withBusy`, which calls it — including the master toggle, which is what
moves the ⚡ mark.

---

## 3. The gap list

Ranked by what an athlete would notice, not by how wrong it is.

### G1 — A booked slot is never announced *(the athlete will see this)*

**State:** `next_run_at`, written by the scheduler's `bookNextSlot`.
**Push:** none. `setBindingNextRun` writes the row and returns
([coachAutomationScheduler.ts:92](../electron/coachAutomationScheduler.ts#L92)).
**Rendered by:** the automation card's trigger line, as `nextRunAt` on
`CoachAutomationSummary`.

9.1 is explicit about why the line matters: *"A schedule automation carries when
it next fires on the trigger line — the earliest slot across its bindings. It
fires with nobody watching, so the card is the only place the athlete can check
it without opening anything."* And: *"The line is absent until the scheduler has
booked a slot, which is its next tick."*

The next tick books it. Nothing tells the panel. So the athlete creates *Morning
briefing, daily at 07:00*, attaches it, and the card says **when it fires
nowhere** — until some unrelated run update refreshes the summaries, or they
close and reopen the modal.

This is the first thing an athlete does with a schedule automation, and the one
question the card exists to answer. It is also the purest instance of the phase-2
shape: the slot is booked in the main process, on a timer, with the screen that
renders it open and listening to the wrong thing.

Same push, same gap, for the deferral: quiet hours move the slot to the end of
the window (3.1) and the card goes on showing the old time.

### G2 — The detail screen's "Where it runs" tab never re-reads its bindings

**State:** `binding.enabled` (guard 2 sets it to 0 on `missing-session`),
`binding.session_id` (a `dedicated` rebuild adopts a new conversation),
`sessionTitle`, `sessionMissing`.
**Push:** `runUpdate` fires for the skip and for the rebuilding run.
**Listened for:** yes — but the handler updates `runs` only
([CoachAutomationDetail.tsx:164](../src/chat/automations/CoachAutomationDetail.tsx#L164)),
and every one of the fields above comes from `bindings`, read on mount.

Two athlete-visible consequences:

- The athlete deletes a conversation an `existing` binding writes into. The next
  run disables that binding and records `missing-session`. The run log tab
  updates and says so. **The row one tab away still shows the toggle on and no
  broken marker** — 9.2's *"a row whose binding is off is greyed"* and the
  re-point prompt both stay hidden.
- A `dedicated` binding rebuilds its deleted conversation. The row keeps naming
  the conversation that is gone.

The near-miss is instructive: the row's *"last run · outcome"* line is derived
from `runs`, so it updates correctly. Half the row is live and half is from
mount, which is exactly the kind of thing a screenshot review passes.

**It reaches one screen further.** `DeleteAutomationDialog` takes `bindings` as a
prop from this same array and renders the conversation list 9.2 calls *"the
point — it is the only place the athlete can see what a delete actually
affects."* So the delete confirmation inherits whatever staleness the tab has:
it can name a conversation that no longer exists, or omit the one a `dedicated`
binding rebuilt. Same fix, one more surface to check afterwards.

### G3 — Nothing outside the Automations panel knows the world is paused

**State:** the pause flag.
**Push:** `pauseUpdate` exists and works.
**Listened for:** by `CoachAutomationsPanel` and nothing else.

10 half-acknowledges this: *"It is the single control the prompt asked for, on
the Automations panel beside the sign-in banner, which has the same reach and
the same limitation: an athlete who never opens that screen never sees either."*

So the banner being panel-only is a stated decision, not a bug. What is *not*
stated is the consequence on the conversation side: the header chip goes on
showing its live count and the popover goes on offering **Run here now** with
nothing saying every unattended run is being held. The button still works — 3.4's
bypass means a manual run goes through — so this is not a broken control. It is
an athlete whose coaches have been silent for two days and no surface they use
daily says why.

Ranked third because it is a *stated* limitation, and step 6 should decide
whether to keep it or widen the reach rather than treat it as a defect.

### G4 — A run's discovery about the provider never reaches the Coach view

**State:** `settings.claudeCode.lastConnectionStatus`, written by
`recordClaudeCodeStatus` inside `streamChat` — an automation run's own stream
writes it.
**Push:** none for chat settings at all; there is no `chat:settings` or
`claudeCode:status` channel in preload.
**Rendered by:** ChatView's connection indicator, read on mount and re-read on
the athlete's *own* `chat:streamError`.

Every window stream handler filters on `activeRequestIdRef`, correctly — so an
automation's `chat:streamError` does **not** trigger the re-read. The status the
automation just recorded sits in the settings row, guard rail 3 reads it on the
next run and declines, and the Coach view goes on showing whatever it saw at
mount.

Partly covered: the Automations panel's signed-out banner is derived from the
summaries and does appear (10). So the athlete is told, on one screen, in one
form. The stale indicator is the interactive chat's, and it self-corrects the
moment they use the chat.

### G5 — The short-lived dialogs are mount-only

`AttachAutomationScreen`, `AttachCoachToConversationDialog` and `RunNowDialog`
each read once and never follow anything. Defensible: they are screens the
athlete opens, acts in, and closes.

`AutomationDefinitionForm` and `CoachAutomationCreate` read nothing live at all —
they edit a draft and write it — so there is nothing for them to be told.

The one reachable staleness: a `per-run` binding creates a conversation while the
attach screen is open, so its list is missing a row. The athlete cannot attach to
a conversation they have not seen, and the 5-per-conversation cap cannot change
underneath them. Listed for completeness, not as work.

### G6 — The startup reconciliation announces nothing

`cancelStaleCoachAutomationRuns()` turns every stale `running` row into
`cancelled` at `app.whenReady()` ([main.ts:862](../electron/main.ts#L862)), and
emits nothing. `createWindow()` is called first (line 850), but the renderer has
not mounted or subscribed by then, so a push would be missed anyway and the
panel's mount read sees the reconciled rows.

No work. Recorded so the next reviewer does not re-derive the ordering.

---

## 4. State with no surface at all

Not gaps — there is nothing to tell, because nothing renders them. Listed so the
distinction is on the record.

| State | Why it has no surface |
|---|---|
| `threshold_firing` | 3.3's transition state. An athlete cannot tell whether a threshold rule has seeded or is armed; 9.2 only renders the trigger's *fields* |
| `last_activity_at` | the activity watermark; 3.2 never proposes showing it |
| `backoff_until` / `backoff_level` | the run log's `failed` rows are the visible half; 10 does not promise a countdown |
| `coach_summary` / `coach_summary_through` | 5.7 is explicitly invisible — *"this trims the context window, never the record"* |
| the threshold retry hold | in memory, per binding, added in R2 |

`backoff` is the interesting one: an athlete whose coach is held off for an hour
sees a `failed` row and then silence, with nothing saying a retry is scheduled.
Whether that deserves a surface is a design question for R7, not a contract gap.

---

## 5. What is already right

Worth stating, because step 6 should not disturb any of it.

- **The conversation list re-reads on a run with a session, and not on one
  without.** Both halves are asserted in the renderer suite; the negative half
  needed new machinery to express.
- **The attention marks split correctly**: a run into the open conversation is
  marked read on arrival, a run elsewhere re-reads the projection.
- **The popover's in-flight map is derived, never accumulated**, and its
  subscription is deliberately unfiltered — both were phase-2 regressions and
  both now carry tests.
- **The panel's spend follows the summaries**, so every run that lands moves the
  number without a second channel.
- **`automationsVersion` is reported from every panel mutation**, including the
  master toggle, which is what moves the ⚡ mark.
- **The tee sink's stream events cannot touch the athlete's own turn**, because
  every handler filters on the request id first.

---

## 6. Ranked summary for step 6

| # | Gap | Athlete notices | Fix shape |
|---|---|---|---|
| G1 | a booked slot is never announced | **immediately, on the first schedule automation they make** | a push when the scheduler books, or the panel re-reads on a timer |
| G2 | the detail's binding rows are mount-only | when they delete a conversation a coach was attached to | refresh `bindings` on the run updates that can change them |
| G3 | the pause reaches only the panel | after days of silence | decide: widen the reach, or write the limitation down properly |
| G4 | a run's provider discovery does not reach the Coach view | rarely, and the panel banner covers it | a chat-settings push, or accept |
| G5 | attach/run-now dialogs are mount-only | almost never | no work |
| G6 | startup reconciliation is silent | never | no work |

G1 and G2 are the two that are the phase-2 shape exactly: state changed in the
main process, a surface open and rendering it, and no wire between them.


---

## 7. Step 6 — what was built

### A third push: `coachAutomation:bindingUpdate`

The whole gap list came down to one missing channel. Three writers change a
binding's *rendered* state with no run to carry the news, and now each emits:

| Emitter | Why |
|---|---|
| the scheduler's `setBindingNextRun` | 9.1's next-run line, booked on a timer |
| the runner's `setBindingEnabled` | guard rail 2 breaking a binding whose conversation is gone |
| the runner's `setBindingSession` | a `dedicated` binding adopting the conversation it rebuilt |

Deliberately **not** emitted for the clocks nothing renders — `last_run_at`, the
activity watermark, the backoff pair, `threshold_firing`. A push per binding per
run for state no surface shows is the chatter that makes the next reviewer
distrust the pushes that matter.

Three surfaces listen. The panel and the popover re-read in full, as they
already do for runs. The detail screen re-reads **only its bindings**, not
`refresh()`: that would also re-read the definition, and a background run
landing while the athlete is part-way through editing a playbook must not touch
what they have typed. It filters on `automationId` for the same reason the run
subscription does.

**G1 fixed** — the card says when it next fires, within the tick that books it.
**G2 fixed** — the row goes broken and greyed without a reload, and
`DeleteAutomationDialog` inherits the corrected array.

### Not built, and why

**G3 (the pause reaches only the panel)** — left as it is. Section 10 chose the
panel-only reach explicitly, and nothing on the conversation side is *broken*:
3.4's bypass means the popover's "Run here now" still runs while paused. Widening
it means new UI the doc does not specify, which is a product decision rather than
a contract repair, and the review plan's own boundary is *"not a rewrite"*. R7
step 14 should either build it or write the limitation down as a limitation.

**G4 (a run's provider discovery does not reach the Coach view)** — left. The fix
is a chat-settings push, a new channel on the interactive chat, for a stale
indicator that self-corrects the moment the athlete uses the chat and whose
automation-side consequence the panel's signed-out banner already shows.

**G5, G6** — no work, as §3 said.

### Mutating the whole renderer suite

Every wire the suite claims, cut one at a time. **Nineteen mutations, one
survivor**, and the survivor is the interesting part.

Cutting the report out of the popover's shared mutation wrapper — the switch,
the reorder, the detach — left the entire suite green. The *attach* path had a
test; these three had only a regex in `test-coach-automation-bindings.mjs`,
which is exactly the kind of claim section 11 says belongs in the harness now
that there is one. A place paused from the popover and not reported leaves the ⚡
mark where it was until the app restarts — the same phase-2 bug, one entry point
over.

Ported: the popover is mounted, a row's switch is clicked, and the parent has to
hear about it. Cutting the wire now goes red.

Two mutations had to be rewritten before they counted. One aimed at the wrong
wire — it cut the mutation wrapper while the assertion it was testing was about
the attach path, which is how the survivor above was found at all. The other did
not compile, and section 11 is explicit that a mutation `tsc` rejects is not a
detection; its replacement passes the athlete's typed ceiling through as a string
instead of a number, which compiles and is still wrong.

### One harness capability added

`setScript` — the driver can change what main would answer *without remounting*.
Every push test needs it: the point is that the main process changed and the
surface has to notice, so the world has to move between the mount read and the
push. `CoachAutomationDetail` also joins the harness's mounts; it was the one
automation surface with no way to be executed.


---

## 8. Found on the closing review of R3

Two holes, both on the axis step 5 did not use. Step 5 swept from the
**surface** side — for each screen, what does it follow. Sweeping from the
**emitter** side instead asks a different question: for each push, is anything
guaranteed to send it and anything guaranteed to hear it.

### The channel strings were paired by nothing

`test-ipc-surface.mjs` asserted the preload/main pairing for
`coachAutomation:runUpdate` and no other push. `pauseUpdate` never had it, and
`bindingUpdate` arrived without it.

The renderer harness cannot close that hole, and it is worth being precise about
why: it keys its fake listeners on the **preload method name**
(`onCoachAutomationBindingUpdate`), never on the channel string. So a typo in
either half — `"coachAutomation:bindingUpdated"` in the emit, or
`"coachAutomation:pauseUpdates"` in the listen — compiles, type-checks, passes
every renderer test, and the push is silently dead. That is exactly the
"contract between two files that never run in the same process" section 11
reserves a source assertion for.

**Fixed.** The suite now scrapes every channel `emitToAnyWindow` sends, requires
preload to subscribe to each, requires none of them to also be an invoke
handler, and checks the reverse — a `coachAutomation:` listener whose emitter was
renamed away is a subscription that can never fire.
**Mutations:** a typo on the emit side; a typo on the listen side; a push channel
also registered as a handler → all three red.

### Nothing asserted the emitters exist at all

The three writers that reach for `emitAutomationBindingUpdate` all live in a
`createDefaultDeps`, and **no suite executes those**. The runner and the
scheduler are both driven through injected fakes, by design — which makes the
default wiring the one piece of code a test can never reach. R1's map already
named this as the runner suite's blind spot; it applies to every new default dep
as well.

Dropping any one of the three wrappers compiles, type-checks and leaves every
suite green, and the athlete's card quietly stops saying when it next fires.

**Fixed** with a targeted source assertion per writer, in the suite that already
owns source-about-source. A regex, and labelled as one, because the alternative
is a claim nothing can make.
**Mutations:** unwrapping each of the three → all three red.

### One thing checked and found sound

The new push can arrive in bursts — one tick can seed every binding of an
automation the athlete just attached in five places — and the panel's refresh
sets state that a second effect watches. That is the shape of the infinite
render loop phase 1's second review found, which announced itself only in the
console.

It does not loop: both callbacks are stable, and `setSpend` does not feed back
into `summaries`. Asserted anyway — five pushes, then a settle, then the read
count must not have climbed. Mutating a feedback edge into the spend effect goes
red, though an earlier budget test fails first, so the burst block is insurance
rather than the detector of record.
