# The conversation cluster — three writers, one transcript

R2 step 4 of [coach-automations-review.md](./coach-automations-review.md).
Sections 5.6b and 5.7 of [coach-automations.md](./coach-automations.md) put three
writers on one `chat_sessions` row: the window, the runner, and the rolling
summariser. This file works out every interleaving that can lose or duplicate an
entry, or leave `coach_summary_through` describing a transcript that has moved.

Third of the R2 seam files, after
[refusals](./coach-automations-refusals.md) and
[lifecycle](./coach-automations-lifecycle.md).

---

## 1. Who writes what

| Writer | Touches | How |
|---|---|---|
| the window | `messages_json` | `chat:saveSession` with `knownEntryCount` — merges a foreign tail |
| the runner | `messages_json` | `saveChatSession` with **no** options — replaces the row outright |
| the summariser | `coach_summary`, `coach_summary_through` | its own `UPDATE`, never touching the transcript |

**The two transcript writers never race, and the reason is stronger than it
looks.** The runner re-reads with `readBack()` and writes with nothing awaited in
between — both are synchronous SQLite calls in the same single-threaded main
process, so no IPC handler can interleave. That is what makes "replace the row
outright" safe for the runner and only for the runner.

The window is the one that can be stale, because its copy lives across a process
boundary and an IPC round trip. `knownEntryCount` is what makes its save
non-destructive, and everything in §3 below turns on that number being honest.

**Every writer only ever appends or rewrites in place.** Nothing deletes an
entry — not the window (`[...timeline, next]` at both of its full replacements),
not the runner, not the summariser. That single property is what makes the
foreign-tail merge sound: a write nobody accounted for is always a tail.

---

## 2. The five named interleavings

### A roll racing the athlete's turn — safe, and worth stating why

The roll is a full provider turn, so the athlete can type through it. Its count
is computed against the snapshot the run read and committed minutes later,
against a transcript that has grown.

That is safe **only because every other writer appends**: the entries
`[0, through)` that the summary covers are the same entries they were, whatever
landed after them. The next run then reads `live = entries.length - through`,
which correctly counts the athlete's new turns as uncovered.

Committing a count taken *after* the race would be the bug — the summary would
claim entries it never saw. Asserted, and the mutation that recomputes the count
from the post-race transcript goes red.

### A run finishing while the window saves — 5.6b's merge, with one correction

Window base 10, run appends 2, window saves 11 entries claiming 10 → the store
keeps the row's entries 10 and 11 as a foreign tail and re-appends them. Nothing
is lost; the coach's answer ends up *after* the athlete's newer turn, which 5.6b
states and accepts ("position is the whole test").

The correction is [C3](#c3): a base *larger* than the array the caller sent used
to delete the difference.

### A `dedicated` binding rebuilding a deleted conversation — safe by construction

The summary is a column on `chat_sessions`, so a deleted conversation takes it
with it. The rebuilt one is a fresh UUID with an empty transcript and no summary,
and `planTranscriptContext` says there is nothing to trim. Defended twice over,
in fact: even a summary read against the stale id would be dropped by the
`through <= entries.length` guard, and now by [C2](#c2)'s guard as well.

Asserted so the reading is pinned, but honestly: this is a documentation-grade
assertion, not a detection. Every mutation that reads the summary from the wrong
session id is caught by a guard that already existed.

### A `per-run` binding — the same count says so

A conversation created for one run has nothing to trim, and `through: 0` against
an empty transcript says exactly that. 5.7 needs no special case and does not
have one. Asserted across two consecutive runs; also documentation-grade.

### The summary surviving a provider switch — the summary does, the *roll* did not

The summary rides its session row, and `chat_sessions.provider` does not change
under it. Nothing to fix there.

What was wrong is the roll itself: it went out with no runtime at all. See
[C1](#c1).

---

## 3. Findings

<a id="c1"></a>
### C1 — The rolling summariser ran on the wrong provider

`rollSummary` called `streamChat` with `runtime: { effort: AUTOMATION_DEFAULT_EFFORT }`
and nothing else, so `provider` and `model` fell through to `getChatSettings()` —
the *interactive chat's*. Decision 2 exists precisely so an automation can
override both. Three things followed:

- **Guard rail 3 pre-flighted the wrong provider.** It checks the automation's
  provider ([:1445](../electron/coachAutomationService.ts#L1445)); the roll then
  called a different one, which nothing had checked was signed in, had a key, or
  had a model configured. Section 10's whole point is that an automation should
  not learn that from the stream, one wasted run at a time.
- **The cost landed on the wrong bill.** Since
  [F1](./coach-automations-refusals.md#f1) the roll's tokens are attributed to
  the run that asked for it — so an automation on `claude-api` was having its
  budget charged for tokens spent on `chatgpt`.
- **It was silently not the coach the athlete chose.** A definition pointed at a
  second provider had half its work done by the first.

**Fixed.** The runner hands `resolveAutomationRuntime(automation)` to the dep, and
the roll goes out on the run's own provider and model. **Effort is the one thing
that does not inherit**: it is cost rather than capability (7), and a summariser
compressing text it was handed has nothing to think harder about — so a coach set
to `high` gets a `high` answer and a `low` summary.

**Test** — `test-coach-automation-runner.mjs`: the roll receives the run's
resolved runtime, and the run itself goes out on the same provider.
**Mutation:** dropping the runtime again → red.

<a id="c2"></a>
### C2 — A summary with no count was trusted as a summary covering nothing

5.7: *"Those two are one fact and are always written together: a row carrying a
summary without its count would describe turns the model is also about to read
in full."* The read did not enforce it. `getSessionSummary` coerces a missing
`coach_summary_through` to `0`, and `planTranscriptContext` accepted
`through >= 0` — so a half-written or hand-edited row produced exactly the
failure the doc names: the summary sent *and* every turn it covers sent again.

Nothing downstream can notice. The model gets a coherent prompt and writes a
coherent answer; it just costs double and says the same things twice.

A real roll can never write `through <= 0` — it only fires once the uncovered
stretch passes `LIMIT`, so the count it writes is at least `LIMIT - KEEP`. A
stored zero beside a summary is therefore definitionally corrupt.

**Fixed** in `planTranscriptContext`, the pure function that owns the rule: a
summary needs a count strictly greater than zero and within the transcript, or
it is not a summary. The same reading section 10 gives a half-written pause —
*not paused* — for the same reason.

**Test** — `test-coach-automation-runner.mjs`: a summary with `through: 0` is
dropped and the whole transcript goes once; the honest pair is untouched.
**Mutation:** back to `through >= 0` → red.

<a id="c3"></a>
### C3 — An over-claiming save deleted the entries it did not send

`foreignTail` sliced the stored row at `knownEntryCount` without comparing it to
the array the caller actually sent. A window claiming a base of 99 while sending
one entry got `slice(99)` → no tail → **the row was replaced by that one entry**,
and the coach's answer was gone.

That is the exact loss 5.6b exists to prevent, arrived at from the other
direction. The doc's stated principle is that the accident *"fails in the
harmless direction"*, and it did for a base that is too small (0 keeps
everything) but not for one that is too large.

The suite asserted the broken behaviour and passed — `"a count past the end
leaves no tail to keep"` describes the arithmetic correctly and the consequence
not at all.

**Fixed.** The base is clamped to the incoming array's length. A caller claiming
more than it sent is asserting a deletion, and nothing deletes entries — both of
the window's full timeline replacements are `[...timeline, next]`, so an honest
base is never larger than the array. The clamp is a no-op for every real call and
a floor under the accident.

**Test** — `test-chat-history-store.mjs`, block 6, rewritten to assert the run's
tail survives, with the reversal explained in place.
**Mutation:** removing the clamp → red.

---

## 4. Interleavings checked and found sound

One line each, so the next reviewer does not redo them.

| Interleaving | Why it holds |
|---|---|
| runner's `readBack()` → `saveSession` | no `await` between them, single-threaded main process — no IPC handler can interleave |
| two runs into one conversation | `enqueue` serialises every run process-wide, so the second reads what the first wrote |
| five automations sharing a conversation | the summary is on the conversation (5.7), so whichever run rolls, the rest benefit |
| a run whose binding is detached mid-run | clock writes find no row and return quietly; the answer still lands |
| the athlete rewriting entries the summary covers | the summary is a paraphrase; a rewritten prefix makes it stale, never wrong about position |
| `knownEntryCount: 0` with an empty array | keeps the whole row — 5.6b's stated safe direction, and the window's array *is* empty when its read failed |
| a negative `knownEntryCount` | clamped to 0, so it claims nothing and the whole row survives |
| the silent trace and the merge | it is a tail like any other, and `parseEntry` round-trips it |
| plan-draft sources restored on read and written back | idempotent: the second read finds every source present and returns the entry unchanged, so the row grows once and then stays put |
| the athlete deleting the conversation mid-run | `saveChatSession` finds no row and writes nothing; the run records `success` against a session id that is gone |

That last one is the only cell that is *odd* rather than wrong: the athlete
caused it, nothing is lost, and 9.3 already has the run log reporting a
conversation as gone. Left alone deliberately.

---

## 5. Not covered here

- **Whether the window's `knownEntryCount` is honest** is the renderer's half of
  5.6b — the base advancing at send time, and the reload cancelling a pending
  debounced save. R3 step 5/6 owns it; this file assumes the number arrives and
  hardens the store against it being wrong.
- **A half-written summary pair reaching the store from a migration or a hand
  edit** is R4 step 7's question. C2 fixes how it is *read*; what a
  pre-migration row looks like is that step's.
- **What a year of runs costs a conversation** — the roll cadence, the row
  growth — is R6 step 11.
