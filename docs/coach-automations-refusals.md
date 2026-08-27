# The refusal cluster — every ordered pair

R2 step 2 of [coach-automations-review.md](./coach-automations-review.md). Sections
4, 10 and 13 of [coach-automations.md](./coach-automations.md) describe twenty
ways a run can be declined; several of them **write state as a side effect**,
and that state is what the next refusal reads. This file is the enumeration, so
the next reviewer does not redo it.

Read against `feature/auto_coach` at the end of phase 3, after the five fixes in
§5 below.

---

## 1. The actors

| # | Refusal | Where | Writes |
|---|---|---|---|
| P1 | Pause, `two-factor-required` | gate, [coachAutomationService.ts:1823](../electron/coachAutomationService.ts#L1823) | clears itself when COROS is signed in |
| P2 | Pause, `budget` | gate, same | clears itself when no longer over |
| G1 | `disabled` | runner | — |
| G2 | `missing-session` | runner | `enabled = 0` for an `existing` binding |
| G2b | `no-activity` | runner | — |
| G3 | `no-auth` (pre-flight) | runner | — |
| G4a | `offline` | runner | — |
| G4b | `two-factor-required` | runner | **sets P1** |
| G4c | *(COROS answered)* | runner | **clears P1** |
| B1 | `budget` — the month's ceiling | runner, guard 4b | **sets P2** |
| G5 | `backoff` | runner | — |
| G5b | `quiet-hours` | runner | — |
| G6 | `cooldown` | runner | — |
| G7 | `budget` — the binding's day | runner, rate guards | — |
| G8 | `burst` | runner | — |
| S1 | `stale-slot` | scheduler | re-books `next_run_at` |
| S2 | quiet-hours slot deferral | scheduler | moves `next_run_at` |
| S3 | quiet-hours threshold deferral | scheduler | **nothing, deliberately** |
| S4 | threshold retry hold | scheduler | in-memory, per binding |
| C1 | Stop, before the run row | runner | — (run dropped, no row) |
| C2 | Stop, mid-preparation | runner | `cancelled` row, **no backoff write** |
| C3 | Stop, mid-stream | runner | `cancelled` row, **clears the backoff streak** |
| F1 | Provider threw | runner | **backoff up**, `last_run_at` |
| F2 | Idle watchdog, 3 min | runner | **backoff up**, no `last_run_at` |
| F3 | `no-auth` after the provider answered | runner | `last_run_at`, no backoff write |

Every run also writes a row, and G6/G7/G8/B1 all read rows back.

## 2. The shared state, and who touches it

| State | Written by | Read by |
|---|---|---|
| pause | G4b, B1, G4c, P1, P2 | the gate only |
| `backoff_until` / `backoff_level` | F1, F2, C3, success, silent | G5 |
| `last_run_at` | any run that reached the provider (F3 included) | G6 |
| `last_activity_at` | success, silent | G2b, activity selection |
| `next_run_at` | S1, S2, slot booking, trigger edit | the scheduler |
| `threshold_firing` | S3's *absence*, the tick, the rollback, trigger edit | the tick |
| `coach_summary` / `_through` | the roll | `planTranscriptContext` |
| run rows + token columns | everything | G6, G7, G8, B1, the banner |
| binding `enabled` | G2 | G1, `listActiveBindings` |

**Blanket rule for everything not listed below.** Two refusals that write nothing
the other reads cannot interact: the runner re-reads the binding at the top of
every step ([:1388](../electron/coachAutomationService.ts#L1388)), guards run in
one fixed order, and runs are serialised process-wide. That covers the large
majority of the 26×26 grid, and it is why only the pairs below are enumerated
one by one.

---

## 3. Ordered pairs, by the state they contend for

**A is already active; B fires.** ✅ = what the athlete would expect.

### The pause

| A | B | Result | |
|---|---|---|---|
| P1 up | any scheduled/activity trigger | held at the gate, no rows | ✅ one login code fixes it; N identical rows would not help |
| P1 up | manual run | goes through; COROS answers → G4c clears it | ✅ 3.4's bypass is how the athlete checks the fix took |
| P1 up | manual run, still locked | one `two-factor-required` row, fan-out stops | ✅ a button that silently does nothing is worse |
| P1 up | athlete signs in elsewhere | next trigger's gate clears it on a local read | ✅ 10's self-heal; the gate is what stopped anything asking |
| P1 up | B1 also true | gate clears P1, fan-out runs, first binding trips P2 | ✅ two separate facts, two banners, one extra row |
| P2 up | any trigger | held at the gate | ✅ same reason as P1 |
| P2 up | manual run | goes through and **spends** | ✅ 13: a ceiling on the athlete's own decisions is not a ceiling on unattended spend |
| P2 up | manual run reaches G4c | P1 clear is narrowed to its own reason | ✅ already covered by a test; a COROS session says nothing about money |
| P2 up | month rolls over | gate clears on the next trigger | ✅ all three lifts are the same check |
| P2 up | athlete raises the ceiling | same | ✅ |
| G4b fires | remaining bindings of the fan-out | stopped at the run that tripped it | ✅ they would each write the same row |
| **G7 fires** | **remaining bindings** | **used to stop them and pause everything** | ❌ **[F3](#f3)** |
| B1 fires | remaining bindings | stopped | ✅ the month is one fact about all of them |

### The backoff

| A | B | Result | |
|---|---|---|---|
| F1 (streak 1) | next trigger | G5 declines; streak untouched | ✅ a skip says nothing about the provider |
| G5 declines | the same trigger's next catch-up step | sequence ends | ✅ 4: the storm is exactly what this prevents |
| F2 (timeout) | next trigger | identical to F1 — same `finish`, same clocks | ✅ asserted by the runner suite's paired trace test |
| F1 | manual run | bypassed; a success clears the streak | ✅ 4: the athlete has usually just fixed it |
| F1 | C2 (Stop mid-preparation) | streak survives — `reachedProvider = false` | ✅ Stop is not a provider reporting itself healthy |
| F1 | C3 (Stop mid-stream) | streak clears | ✅ 10's rule is "reached the provider and did not fail" |
| F1 | F3 (`no-auth` post-answer) | streak untouched | ✅ a skip, decided after the answer, still says nothing |
| F1 | G7/G8/G5b/G6 | none of them touch the streak | ✅ |
| F1 | threshold crossing | crossing is **consumed**, backoff owns the retry | ✅ re-offering would loop against a dead provider |

### The cooldown clock (`last_run_at`)

| A | B | Result | |
|---|---|---|---|
| F1 | G6 | clock advanced before the failure branch, so a failing coach still respects its cooldown | ✅ stated in the code, and deliberate |
| F2 (timeout) | G6 | clock **not** advanced — the run returns before the write | ✅ 10: a timed-out run leaves both clocks where they were |
| F3 | G6 | clock advanced | ✅ it reached the provider |
| a catch-up sequence | G6 on step 2 | checked only at `sequenceIndex === 0` | ✅ 4: the cooldown gates the reaction, not the backlog |
| C2 | G6 | not advanced | ✅ nothing was asked |

### The activity watermark

| A | B | Result | |
|---|---|---|---|
| any skip | `last_activity_at` | untouched | ✅ — but nothing *asked* again until [L3](./coach-automations-lifecycle.md#l3); this row read section 4's promise and checked only the half it could see |
| F1 / F2 / C3 | watermark | untouched — both return before `advanceWatermark` | ✅ the work is not lost |
| silent | watermark | advanced | ✅ the model looked |
| two triggers off one watermark | G2b | second run re-checks against the freshly-read row | ✅ 4's idempotence guard |
| G7 ends a sequence | leftovers | watermark stays, they ride the next trigger | ✅ |

### The threshold firing state

| A | B | Result | |
|---|---|---|---|
| crossing written | **any guard-rail skip** | **was consumed and never re-offered** | ❌ **[F2](#f2)** |
| crossing written | **the pause holding it at the gate** | **same** | ❌ **[F2](#f2)** |
| crossing written | **quiet hours** | **same, reachable every night** | ❌ **[F2](#f2)** |
| crossing written | F1 (provider failed) | consumed; backoff owns the retry | ✅ |
| crossing written | C3 (athlete pressed Stop) | consumed | ✅ they decided not to hear it |
| crossing written | app quits mid-run | consumed — the crash case 3.3 designed for | ✅ one missed announcement beats one an hour |
| metric recovers | quiet hours | still recorded, announces nothing | ✅ it is what re-arms the rule |
| trigger edited | any held retry | state and hold both reset | ✅ it answers a question nobody is asking |

### The rolling summary

| A | B | Result | |
|---|---|---|---|
| roll succeeded | C2 | summary committed, run cancelled | ✅ the summary is a fact about the conversation, and true |
| roll failed | the run | full tail sent instead; run unaffected | ✅ 5.7's best-effort |
| **roll spent tokens** | **B1's month-to-date** | **invisible** | ❌ **[F1](#f1)** |
| roll | G5/G6/G7/G8 | unreachable — the roll is after every guard | ✅ |

### The run log, read back

| A | B | Result | |
|---|---|---|---|
| skip rows | G7 (daily cap) | not counted — only `success`/`silent`/`failed` | ✅ a skip is not a run |
| `cancelled` | G7 | not counted | ✅ the athlete stopped it; it did not speak |
| `cancelled` | B1 | **is** counted — the tokens were spent | ✅ 13 |
| F1 `failed` | B1 | counted, but **the cost was never recorded** | ❌ **[F5](#f5)** |
| **`silent`** | **G8 (burst)** | **not counted, though it writes to the transcript** | ❌ **[F4](#f4)** |
| `silent` | G7 | counted | ✅ it took a full provider turn |
| G3 `no-auth` rows | the signed-out banner | derived from each automation's *last* run | ✅ clears itself when one runs again |

### The scheduler's slot

| A | B | Result | |
|---|---|---|---|
| P1/P2 up | slot due | booked, `runTrigger` held at the gate, no row | ✅ 10: briefings inside the paused window are simply missed |
| P1 up | S1 (stale slot) | row written by the scheduler, before the gate | ✅ only reachable on the launch after a >24h gap — once per binding, not a flood |
| S2 (quiet deferral) | the same tick | window's end is outside the window, so it happens once | ✅ |
| trigger edited | a booked slot | nulled, re-seeded next tick | ✅ 3.1 |
| G2 disabled a binding | the scheduler | `listActiveBindings` drops it | ✅ no repeat rows |

---

## 4. What each `budget` means now

Guard 4b and guard 7 share the `budget` code, which section 4 chose deliberately.
They are no longer the same event:

| | 4b — the month's ceiling | 7 — the binding's day |
|---|---|---|
| About | every automation the athlete has | this one binding |
| Raises the pause | yes | **no** |
| Stops the fan-out | yes | **no** |
| Clears itself | month rolls over, or the ceiling moves | midnight |
| Row's `error` | *"This month's token budget is spent."* | *"This coach has already run N times here today."* |

The recorded `skip_reason` stays `budget` for both, so section 4's table is
unchanged; the words on the row are what the run log reads back, following the
precedent section 10 set for `no-auth`.

---

## 5. The five findings

<a id="f1"></a>
### F1 — The rolling summariser's tokens were invisible to the budget

`rollSummary` ran a full provider turn and read only `collector.text()`. Section
13 counts every turn a run takes; this one was outside the total, so the budget
under-reported by exactly the feature built to make long conversations
affordable. Worse on the exits that record no cost at all — a Stop landing
mid-preparation spent the roll and recorded nothing.

**Fixed.** The dep returns `{ summary, usage }` on every exit, including the ones
that produce nothing, and `runOneBinding` folds it into whatever the run records
— success, silent, failed, cancelled, and the mid-preparation cancel.
`addTokenUsage` keeps *unreported* distinct from *free*: one unknown plus one
known is the known part, never a silent zero.

**Tests** — `test-coach-automation-runner.mjs`: the roll is summed in; a roll that
spent and then declined is still on the bill; a run stopped before the model
still carries what its roll cost; unreported plus unreported stays unreported.
**Mutations:** dropping the roll from the sum → red.

<a id="f2"></a>
### F2 — A threshold transition was consumed by any refusal

`evaluateThresholdBinding` writes `threshold_firing` before calling the runner —
correctly, so a crash cannot re-announce — and nothing wrote it back when the run
never happened. Guard rails belong to the runner, so a crossing handed over comes
back refused on quiet hours, a cooldown, the daily cap, a backoff or either
pause, and the rule then recorded an announcement it never made. A metric that
stays true — the only kind a threshold rule watches — never fires again.

**Fixed**, in three parts:

- **Quiet hours defer**, in the scheduler, exactly as 3.1 defers a slot. The state
  is left unwritten and the night writes no rows at all; the first tick after the
  window closes sees the identical transition.
- **A refused crossing is put back.** An all-skipped answer, or the empty one a
  held gate returns, restores the previous state. A run that reached the provider
  is not a refusal, whatever it concluded — `failed` already has the backoff
  holding its binding off, and `cancelled` is the athlete's own decision.
- **A retry hold**, `THRESHOLD_RETRY_INTERVAL_MS` = 15 minutes, matching the
  activity watcher's poll — the rhythm section 4 already describes for a refused
  trigger coming round again. Without it the tick would re-offer every sixty
  seconds and the log would fill with one identical skip a minute. In memory, not
  a seventh binding column: it is a rate limit on retries, and `next_run_at` is
  not free to borrow — the automation card reads it as "next fires at", which a
  threshold rule cannot promise.

**Tests** — `test-coach-automation-threshold.mjs`: a refusal does not spend the
crossing; it is not re-offered every tick; it *is* re-offered on the retry
rhythm; once it lands it is spent and an hour of ticks says nothing more; a
failed run is not a refusal; the gate's empty answer is; quiet hours defer
without writing; recovering is recorded regardless.
**Mutations:** consume-always, no quiet-hours deferral, no retry hold, treating
`failed` as a refusal, deferring the recovery write → all five red.

The suite's own fake had to be fixed first: its `runTrigger` returned `[]` for
every call, collapsing "the trigger ran" and "the runner refused it" into one
value. That is the review plan's *"a fake that collapses two facts hides the wire
between them"*, and no assertion about this could have been written against it.

<a id="f3"></a>
### F3 — The daily cap raised the app-wide budget pause

`checkRateGuards` returned `"budget"` for both the month's ceiling and the
binding's `maxRunsPerDay`, and `runOneBinding` raised the pause on either. So one
coach exhausting its three runs for the day held **every** automation the athlete
has, put a "your token budget ran out" banner on screen, and stopped the rest of
its own fan-out. It self-healed on the next trigger only because `overBudget()`
reads false when no ceiling is set — so the visible damage was a false banner and
a fan-out silently cut short, once per cap hit.

**Fixed.** Guard 4b is its own branch in `runOneBinding`, where section 4 numbers
it; `checkRateGuards` now really is guards 5–8, as its own comment always said.
The fan-out asks the **pause** whether to stop rather than the skip code:
`resolved.getPause()?.runId === run.id` is the only thing that means "and
everything after this would say the same".

**Tests** — `test-coach-automation-runner.mjs`: a capped binding records `budget`,
raises no pause, says which `budget` it is, and the other two places still run;
the month's ceiling still pauses and still stops the fan-out, with the banner
pointing at the row.
**Mutations:** restoring the pause-on-any-`budget`, and reverting the fan-out to
the skip-code check → both red.

<a id="f4"></a>
### F4 — The burst guard did not count silent runs

Section 2.3 bounds "automation messages per conversation per hour", and 9.3 is
explicit that `success` and `silent` are *"the two that write to the transcript"*.
The guard counted only `success`. A silent run persists 5.5's trace exactly the
way an answer is persisted, and took a full provider turn to decide on — so five
coaches attached to one conversation could conclude "nothing new" into it every
hour, for ever, at full price, which is the burst the guard exists to stop minus
the words.

**Fixed.** `statuses: ["success", "silent"]`, the same pair 9.3 counts.

**Test** — `test-coach-automation-runner.mjs`: five traces in an hour exhaust the
guard, and nothing is spent finding that out.
**Mutation:** back to `["success"]` → red.

<a id="f5"></a>
### F5 — A failed run never recorded what it spent

Section 13: *"It is recorded on **every** exit that reached the model — success,
silent, failed and cancelled … a budget that forgave failures is a budget a
broken provider can run through for nothing."* Usage reached the collector only
on `chat:streamDone`, which a stream that errors never sends. So no failed
automation run has ever recorded a cost, and the hole 13 describes was open the
whole time.

The runner suite asserted the opposite and passed, because its fake collector
reports usage on every path — including the one the real collector had nothing to
report on. A false green of exactly the kind section 11 warns about.

**Fixed.** `chat:streamError` carries the turn's accumulated usage and the
collector ingests it, through one `recordUsage` shared with `handleDone`. Every
error send now goes through a single `sendStreamError` helper, so "a failure is
not a refund" is one line rather than a rule to remember at each throw site.

**Tests** — `test-chat-stream-sink.mjs`: the collector reports usage carried on an
error, and still reports *unknown* when the error carries none. Plus one source
assertion — genuinely about source, because driving `streamChat` to a real
provider failure needs a provider, a database and a network, and the collector
under test *is* the stub that would stand in for them — that the one error send
still attaches usage and is still the only one.
**Mutations:** collector ignores the error's usage; the send drops it; a second
forgetful send is added → all three red.

A timed-out run still records nothing, and that is correct: usage arrives at the
end of a turn and a stalled provider never got there. Section 13's *unreported ≠
free* is what carries it.

---

## 6. Deliberately left to a later step

- **The row a refused threshold retry writes** is one skip per binding per 15
  minutes while the refusal lasts. Bounded, and visible in the run log, which is
  where the athlete reads why a coach is quiet. Whether the log wants pruning at
  all is R6 step 11's question, not this one.
- **`AutomationSkipReason` carries `"batch-window"`**, which nothing ever
  records; only the renderer's label map mentions it. Dead, not wrong — R1's
  drift list territory.
- **F3's `error` text** is new copy on a run-log row. R3 step 5 owns whether every
  surface that renders a skip shows it.
- **Whether guard 7 deserves its own `skip_reason`** rather than sharing
  `budget`. Section 4 chose the sharing deliberately; changing it is a doc change
  and belongs with R7 step 14's reconciliation.
