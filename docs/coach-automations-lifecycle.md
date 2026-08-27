# The trigger-lifecycle cluster — three states, every ending

R2 step 3 of [coach-automations-review.md](./coach-automations-review.md).
Sections 2.3, 2.4, 3.1, 3.2 and 3.3 of
[coach-automations.md](./coach-automations.md) describe three pieces of state a
trigger writes on its own behalf. This file follows each of them through every
way a run can end, says which advances and which is left, and whether that is
right.

Companion to [coach-automations-refusals.md](./coach-automations-refusals.md),
which covers the same code from the refusal side. Where the two overlap, this
one is about *what the trigger recorded*, not *why the run was declined*.

---

## 1. The three states, and who owns each

| State | Column | Written by | When |
|---|---|---|---|
| The schedule slot | `next_run_at` | the **scheduler** only | before the run, always |
| The activity watermark | `last_activity_at` | the **runner** only | after the answer is on disk |
| The threshold firing flag | `threshold_firing` | the **scheduler** only | before the run, rolled back on a refusal |

No path writes two of them: a trigger has one kind, and each kind owns one
state. The manual trigger owns none — which is why "Run now" can never lose or
consume anything, and why it is the safe way to test a rule.

The other three per-binding clocks — `last_run_at`, `backoff_until`,
`backoff_level` — are refusal state, not trigger state, and belong to the
[refusal matrix](./coach-automations-refusals.md).

---

## 2. Every ending

**S** = schedule slot · **W** = activity watermark · **T** = threshold firing.
`—` means the trigger kind does not own that state.

| Ending | S | W | T | |
|---|---|---|---|---|
| `success` | advanced (before) | **advanced** | consumed | ✅ the model looked and the answer is on disk |
| `silent` | advanced (before) | **advanced** | consumed | ✅ 3.2: the model looked, whatever it concluded |
| skip `disabled` | advanced (before) | left | rolled back | ✅ only reachable as a race — both schedulers filter first |
| skip `missing-session` | advanced (before) | left | rolled back | ✅ and the binding is disabled, so the slot goes stale rather than repeating |
| skip `no-activity` | — | left | — | ✅ guard 2b's idempotence; there was nothing to advance to |
| skip `no-auth` (pre-flight) | advanced (before) | left | rolled back | ✅ nothing was asked |
| skip `no-auth` (post-answer) | advanced (before) | left | consumed | ✅ it reached the provider; the answer was a refusal, not silence |
| skip `offline` | advanced (before) | left | rolled back | ✅ |
| skip `two-factor-required` | advanced (before) | left | rolled back | ✅ and the pause stops the next fifteen asking |
| skip `budget` (4b, the month) | advanced (before) | left | rolled back | ✅ |
| skip `budget` (7, the day) | advanced (before) | left | rolled back | ✅ clears at midnight |
| skip `backoff` | advanced (before) | left | rolled back | ✅ |
| skip `quiet-hours` | **deferred**, not lost | left | **deferred** — never written | ✅ 3.1's rule, now applied to both |
| skip `cooldown` | advanced (before) | left | rolled back | ✅ |
| skip `burst` | advanced (before) | left | rolled back | ✅ |
| `stale-slot` | re-booked from **now** | — | — | ✅ 3.1: the backlog goes with it |
| `failed` — provider errored | advanced (before) | left | consumed | ✅ the backoff owns the retry |
| `failed` — thrown | advanced (before) | left | consumed | ✅ |
| `failed` — idle watchdog | advanced (before) | left | consumed | ✅ |
| **`failed` — could not land the answer** | advanced (before) | **left** | consumed | ✅ **after [L1](#l1)**; it used to advance W |
| `cancelled` — mid-preparation | advanced (before) | left | consumed | ✅ the athlete decided |
| `cancelled` — mid-stream | advanced (before) | left | consumed | ✅ |
| dropped by a cancelled fan-out | advanced (before) | left | rolled back | ✅ no row, nothing announced — and unreachable for a threshold, whose fan-out is one binding |
| app quits mid-run | advanced (before) | left | **consumed** | ✅ 3.3's own reason for writing first: one missed announcement beats one an hour |

**The slot is always already advanced**, whatever happens next. That is 3.1's
book-before-run, and it is the reason no ending in this table can strand a
schedule binding: the worst case is one missed briefing.

**The watermark advances on exactly two endings**, and after the save rather
than before it — see [L1](#l1).

**The firing flag is consumed by anything that reached the provider** and rolled
back by anything that did not, which is the fix from
[step 2's F2](./coach-automations-refusals.md#f2).

---

## 3. A `multiActivity` catch-up interrupted part-way

The plan is built once per binding, oldest first, capped at 10
(`MULTI_ACTIVITY_MAX_PER_TRIGGER`). Each step advances the watermark to its own
activity, so an interruption leaves the watermark at the **last activity that
actually landed** and the remainder rides the next trigger.

| Interrupted by | What ends | Watermark | |
|---|---|---|---|
| a `skipped` step | this binding's sequence; the fan-out carries on | at step N−1 | ✅ 4: the log records it once, not once per pending activity |
| a `failed` step | step N+1 hits the fresh `backoff` and skips, which ends it | at step N−1 | ✅ 10's stated chain — one extra step, and it costs no provider call |
| a thrown step | this binding's sequence, via the fan-out's own handler | at step N−1 | ✅ 10: the rest of the fan-out still runs |
| Stop (token) | the whole fan-out | at step N−1 | ✅ a dropped step logs nothing |
| the pause tripping | the whole fan-out | at step N−1 | ✅ |
| the app quitting | everything | at the last landed step | ✅ |

**Two consequences worth writing down, both correct and both surprising:**

- **A backlog longer than 10 loses its oldest entries permanently.** 25 pending
  activities → `slice(-10)` selects 16–25, step 1 analyses #16, and the
  watermark jumps past 1–15 for good. This is 3.2 as written — *"a longer
  backlog analyses only its most recent entries, because replaying a month in
  one burst costs real provider spend and buries the answer the athlete
  wanted"* — not a defect.
- **A sequence interrupted by `burst` then waits out the `cooldown`, not the
  burst window.** The remainder starts a *new* sequence, whose step 0 has
  `sequenceIndex === 0` and is therefore cooldown-checked against the
  `last_run_at` the interrupted sequence just set. With the defaults that is two
  hours, not one. This follows 4 exactly — *"checked once, on the first run of a
  sequence"* — and 4's *"not a reason to strand three activities"* is about
  steps 2..N of one sequence, which is what is built. Stated here so the next
  reviewer does not read the two sentences as contradicting each other.

Guard 2b is what makes all of this safe against two triggers planning off the
same watermark: every step re-checks its own activity against the freshly-read
row, so the same activity is never analysed twice into the same conversation,
and the second sequence ends on the first `no-activity`.

---

## 4. A binding detached and re-attached

Detach deletes the row; re-attach inserts a new one with a new id. So **every
per-binding clock resets**, and that is the whole difference between removing a
place and pausing it:

| | Pause the place (`enabled = 0`) | Detach and re-attach |
|---|---|---|
| `last_run_at`, `next_run_at` | kept | reset |
| `last_activity_at` | kept | reset — the attach time is the new floor |
| `backoff_until` / `backoff_level` | kept | reset |
| `threshold_firing` | kept | **NULL — seed and stay silent** |
| run history | kept, and still readable | kept, but keyed to the old binding id |
| the ⚡ mark and the burst guard | unchanged | unchanged (both are session-keyed) |

**Each of those is right, and for the same reason:** a re-attached binding is a
new place. 3.2 says attaching a coach today must not replay history, and
re-attaching is attaching. 3.3's `NULL` = *never evaluated* does the same job
for a threshold rule with no extra code — asserted now, so the reading is
pinned rather than inferred.

Three consequences, all fine:

- **Detach/re-attach clears a backoff, a cooldown and the day's cap**, because
  guards 5, 6 and 7 key on the binding id. It grants nothing new: 3.4's manual
  bypass already lets the athlete run past all three, deliberately.
- **The burst guard survives**, because it keys on the conversation. That is the
  one guard protecting the conversation rather than the binding, so it is the
  right one to be un-resettable.
- **A run in flight when its binding is detached still lands its answer.** Every
  clock write afterwards finds no row and returns quietly; nothing throws. One
  message into a conversation the athlete just detached the coach from is
  surprising but harmless, and self-limiting. Asserted, so a future change that
  makes those writes throw is caught.

A `dedicated` binding whose conversation is deleted keeps its stale
`session_id` on purpose — clearing it would make the row look like a `per-run`
binding to `idx_binding_unique_per_run` — and rebuilds on the next run. The
deleted conversation takes `coach_summary` / `coach_summary_through` with it, so
the rebuilt one starts clean; 5.7 needs no special case for it.

---

## 5. Findings

<a id="l1"></a>
### L1 — Landing the answer was the one step outside the run's own error handling

`advanceWatermark()` ran **before** `saveSession`, and the save was not inside
any try. A throw there escaped `runOneBinding` entirely, and produced three
wrong facts from one failure:

- the **watermark said analysed** for an answer that was never written, so the
  activity was gone for good — the exact loss 3.2's *"a failed or cancelled run
  leaves it"* exists to prevent;
- the run's own row stayed **`running`** until the next launch reconciled it
  (section 10's stale-`running` cleanup), so the athlete saw a coach spinning
  for as long as the app stayed open;
- the fan-out's handler recorded a **second row** as `failed`, so one run
  produced two rows that disagreed.

Reachable from anything the store or the collector can throw, and the ordering
was wrong regardless: a crash between the two writes had the same effect with a
narrower window.

**Fixed.** The persistence and the watermark move are inside the run's own
`try`, and a throw goes through `finish` like every other ending — one row,
`failed`, the reason on it, and the backoff applied, because this run *did*
reach the model and the streak is a claim it is entitled to make. The watermark
now advances after the save in both branches, so "the model looked" and "what it
said is on disk" are one fact.

**Tests** — `test-coach-automation-runner.mjs`: a throw in the store produces one
`failed` row and no orphan `running` one, leaves the activity owed, and the next
trigger picks it up and succeeds; the same throw still backs the binding off; a
silent run whose trace cannot land is `failed`, not `silent`.
**Mutations:** letting the throw escape again; moving the watermark back before
the save; treating the failure as not having reached the provider → all three
red.

<a id="l2"></a>
### L2 — The threshold retry hold outlived the binding it was for

Step 2 added an in-memory `retryAfter` map keyed by binding id. Nothing removed
an entry when the binding went away, and a re-attached binding is a *new* row
with a new id — so a detached binding's hold could never be claimed again and
sat in the map for the life of a process meant to run for weeks.

Found by this step's lens rather than by anything the athlete would see: it is a
leak introduced by the previous fix, and the detach/re-attach question is what
surfaced it.

**Fixed.** The tick collects the bindings it considered and prunes every hold
that is not among them.

**Test** — `test-coach-automation-threshold.mjs`, and deliberately white-box: a
hold nobody can claim has no behavioural shadow, so there is nothing to drive
and nothing to watch except the map. Everything else in that block is driven
through the tick.
**Mutations:** removing the prune; making it prune live holds too → both red.

---

## 6. Found on the closing review of R2

<a id="l3"></a>
### L3 — A refused activity was never offered again

Section 4 says, justifying why quiet hours *skip* for an activity rather than
deferring: *"the activity is not going anywhere, and the next poll will find it
still unanalysed because the watermark did not move."*

The watermark did not move. Nothing looked.

`coach_seen_at` is stamped at flush — before the runner has answered, and
whatever it answers — which is right: the flag means *"the watcher has looked at
this"*, and it had. But the watcher's **firing** condition was "are there any
unseen rows", so once a batch was stamped the trigger never came round again. A
run refused for any reason at all — quiet hours, a cooldown, a backoff, either
pause, a signed-out provider, an offline COROS — left the activity owed by the
binding's watermark and asked for by nobody.

What the athlete saw depends on `multiActivity`:

- **off, the default** — the next activity to arrive selects only itself
  (3.2), so the refused one is dropped and never analysed. An evening run
  refused by quiet hours at 22:45 is simply gone by morning.
- **on** — the leftovers ride the next *activity*, so they arrive late.
- **either, with no further activity** — nothing, indefinitely.

This is the seam R2 exists for, and both earlier steps walked past it: step 2
read section 10's *"nothing is lost while paused"* and checked only that the
watermark holds, which it does; step 3 traced the watermark through every
ending and never asked who would come back for it.

**Fixed.** The tick asks again: after the batches flush, every enabled activity
automation that was not just fired and has no batch still collecting gets a
payload-free trigger. 3.2's split is untouched — this says *look again*, and the
runner still decides what is owed. A binding with nothing pending produces an
empty plan, and a non-manual trigger with an empty plan logs nothing, so the only
automations this costs anything are the ones genuinely waiting.

Three things it must not do, each of which is a test:

- **not jump a batch still inside its window**, which is the one thing batching
  is for;
- **not fire twice on the tick a batch flushed**;
- **not run on the cold start**, where stamping the back catalogue and then
  immediately asking about it would replay the athlete's history — the one thing
  that stamp exists to stop.

It sits behind the same COROS gate `poll` uses, so the watcher keeps its rule
that it does no work while COROS is disconnected. The narrow case that costs:
credentials absent from disk but a reconnect that would have worked, with an
owed activity and no new one. The tick that finds the connection back re-offers
everything anyway.

The consequence to accept: a persistently refused binding now writes one skip
row per 15-minute poll for as long as the refusal lasts, where before it wrote
one and went quiet. That is section 4's stated rhythm — *"the trigger that would
have produced it comes round again on the next poll"* — and it stops the moment
the refusal clears or the watermark moves. Silence was cheaper and wrong.

**Tests** — `scripts/test-coach-activity-watcher.mjs`: a refused activity is
re-offered on the next poll and the one after; a binding with nothing owed still
gets asked and costs one index refresh; a collecting batch is not jumped; the
cold start says nothing. Plus the pre-existing *"the same activity is never fired
twice"* assertion, rewritten — it was a claim the watcher is in no position to
make.
**Mutations:** removing the re-offer; jumping a collecting batch; running it on
the cold start; firing twice on a flush tick; dropping the COROS gate → all five
red.

---

## 7. One divergence recorded, not fixed

**Section 2.3's `sort_order` promise is half built.** It says runs targeting the
same conversation *"execute sequentially in `sort_order`"*. Sequentially is
built and correct — `enqueue` serialises every run process-wide, which is the
half that stops two runs clobbering each other through `saveChatSession`. **In
`sort_order` is not built at all.**

`expandTriggerToQueue` sorts by `(sessionId, sortOrder)`, but a fan-out is one
automation, and `idx_binding_unique_session` means one automation has at most one
binding per conversation — so the tiebreaker never breaks a tie. Two automations
writing into the same conversation are two separate triggers, ordered by
whichever fired first: creation order in the scheduler's tick, batch-map order in
the activity watcher, and no shared order at all between the two components.

So an athlete who reorders coaches in "Where it runs" changes nothing about the
order their answers arrive in.

**Not fixed here**, and the reason is the review plan's own boundary — *"Not a
rewrite. Nothing here proposes changing the architecture."* Honouring
`sort_order` across triggers needs a cross-component run queue that both the
scheduler and the watcher feed, which is architecture, not a seam fix. Section
5.4 already frames `sort_order` as future-proofing for *"when concurrency is
raised later"*, so the shape of the answer is already written down.

R7 step 14 should either build it or say plainly in 2.3 that the ordering is
aspirational and only the serialisation is guaranteed. Until then the
consequence is bounded: the answers all land, none is lost, and the only thing
that varies is which of two coaches speaks first on the rare tick where both are
due.
