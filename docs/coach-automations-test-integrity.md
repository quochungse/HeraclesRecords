# Test integrity — what the green suites were actually worth

R5 of [coach-automations-review.md](./coach-automations-review.md), both steps.

*"Everything the rest of this review concludes rests on those suites."* The
phase-1 and phase-2 suites had never been systematically mutation-tested — only
the scheduler had, and one of its ten mutations survived. This is the sweep.

---

## 1. The sweep

**48 mutations across ten suites**, every one written to compile.

| Suite | Mutations | Survivors |
|---|---|---|
| `test:coach-automation-store` | 7 | **3** |
| `test:coach-automation-bindings` | 6 | 0 |
| `test:coach-automation-guards` | 5 | 0 |
| `test:coach-automation-runner` (phase-1 half) | 9 | **1** |
| `test:coach-activity-watcher` | 5 | 0 |
| `test:coach-automation-schedule` | 5 | 0 |
| `test:chat-history-store` | 5 | 0 |
| `test:coach-automation-plan-draft` | 4 | **2** |
| `test:chat-stream-sink` | 1 | 0 |
| `test:coach-automation-renderer` | 1 | **1** |
| **total** | **48** | **7** |

Seven survivors. **Five were genuine gaps** and are now covered; one was an
assertion about the wrong axis and was rewritten; one was covered by a different
suite and needed nothing. A further six runs re-verified the fixes, and two
mutations had to be rewritten because `tsc` rejected the first attempt — section
11 is explicit that one of those is not a detection.

## 2. The survivors

### S1 — An unimplemented threshold metric survived normalisation

`normalizeAutomationTrigger` degrades a malformed *schedule* to `manual`, and the
store suite asserts that. It does the same for an unknown threshold metric and
nothing asserted **that**.

The consequence is worse than a rejected trigger: the row stores a threshold
trigger the scheduler evaluates to `false` for ever, so the card shows a rule
that looks configured and can never fire. 9.1 says a preset with a malformed
trigger *"degrades silently to `manual`, which is exactly the typo a gallery of
hand-written definitions invites"* — the claim was made and only half tested.

**Covered**, alongside a loop asserting all four of 3.3's names still pass.

### S2 and S3 — A run row's status and trigger kind fell back untested

`toRun` maps an unknown `status` to `failed` and an unknown `trigger_kind` to
`manual`. Both fallbacks were load-bearing and neither had a test.

Load-bearing because every reader downstream branches on the value: the burst
guard and the daily cap count particular statuses, 9.3's dot counts two of them,
and the card shows Stop for `running`. A value that is none of them would be
compared against all those lists and match nothing — **invisible to every guard
while still sitting in the log**. Reading it as `failed` puts it somewhere real.

R4 §3 listed both as "already safe". They were; nothing said so.

### S4 — Which end of a backlog the cap takes from

`selectActivitiesForBinding` ends `matched.slice(-MULTI_ACTIVITY_MAX_PER_TRIGGER)`.
Swapping it for `slice(0, …)` — the ten **oldest** instead of the ten newest —
left every suite green.

3.2 is explicit: *"a longer backlog analyses only its most recent entries,
because replaying a month in one burst costs real provider spend and buries the
answer the athlete wanted."* Which end is the whole of that sentence.

It survived because **every `multiActivity` fixture in the repo held ten or fewer
activities**, where the two expressions are the same list. That is the third
appearance of one pattern in this review — the trimming suite's 200/180 fixture,
R4's resting-HR fixture at 52, and now this. *A fixture that sits where two
readings agree proves nothing, and looks exactly like one that does.*

**Covered** with twelve, on a `per-run` binding: the burst guard counts per
conversation and would otherwise cut the sequence at five, which is itself a
reminder that the cap and the guards interact. The constant is now exported so
the test cannot drift from it.

### S5 — The draft id between the tool and the wire

`test:coach-automation-plan-draft` ends with a block titled *"the draft id the
card confirms with is the one the tool stored"*, and all three of its assertions
are about **names and shapes**: that `persistPlanDraft` calls `saveChatPlanDraft`,
that `uploadPlanDraftById` still exists, that it is not gated by the tool policy.

None of them can say what the block is named after. Change the id `chatService`
puts on the wire — `draft: { ...preview, draftId: preview.draftId + "-copy" }` —
and all three still pass, while the athlete's confirmation card then looks up a
draft that was never stored and the upload fails. Which is decision 3's whole
mechanism: *"the real write happens from the athlete's confirmation card."*

The leg between the tool and the send is one no suite can execute — it runs
inside `handleChatWorkoutTool`, which needs COROS behind it — so this stays a
source assertion. **But the first version of it was brittle in the way section 11
warns about, and mine was no better for being mine**: it pinned the exact five
lines and went red on a harmless extraction of a local. Restated as a *rule* —
`draftId` must not appear inside the callback at all, because the id is the
tool's and this layer has no business touching it — it now catches the mangled
id and tolerates the refactor.

### S6 — The collector's card dedupe, caught by the suite that owns it

Breaking `upsertEntry`'s draft-id match left the plan-draft suite green. Not a
gap: `test:chat-stream-sink` owns *"a re-emitted card replaces the first rather
than appending"* and goes red on the same mutation. Recorded so the next
reviewer does not chase it — a mutation surviving one suite is only a finding if
it survives all of them.

## 3. Mutations that had to be rewritten

Two did not compile, and section 11 is explicit that one of those is not a
detection. Both were rewritten as variants that compile and are still wrong.

- Removing the watcher's `rows === TIMED_OUT` branch broke the type narrowing
  that follows it. The replacement keeps the branch and **stamps anyway**, which
  is the behaviour 3.3 forbids — *"a failure is not stamped"* — and is red.
- Dropping the collector's plan-draft branch broke the narrowing on `draft`.
  The replacement returns *before* the upsert instead of removing it, which
  compiles and loses the approval card exactly as the first attempt meant to.
- Several mutations were mis-anchored rather than uncompilable — one store, one
  binding, two chat-history — and all were re-run against the right call site.

---

## 4. The source-assertion audit

Every assertion in the repo that reads source, classified. Each now carries a
one-line comment saying which kind it is, so the next reviewer does not have to
re-derive it.

### Genuinely about source — kept

| Assertion | Why a regex earns it |
|---|---|
| the preload/main pair for `markSessionSeen` (×2) | two processes; an argument dropped on either side type-checks and compiles into a call that quietly does the wrong thing |
| `main.ts` routes Stop through `cancelAutomationRun` | the handler's body, which the harness's stub *replaces* — the harness cannot see across the bridge because it **is** the bridge |
| `chat:streamError` carries the turn's usage, and is the only such send | added R2; `streamChat` needs a provider, a database and a network |
| `addUsage` routes through `countableUsage` | added R4; same reason, one level down |
| the three binding-update emitters | added R3; they live in a `createDefaultDeps`, which no suite executes |
| the `chatTypes` converter pair | a claim about shape, not behaviour |

The last five share a diagnosis worth naming: **the default wiring is the code a
test cannot reach.** Every suite here injects fakes on purpose, which is what
makes them fast and hermetic — and it means `createDefaultDeps` and the body of
`streamChat` are permanently outside their reach. This review hit that boundary
three separate times, in three different rounds.

### Ported and deleted

**The card's run flag across its own fan-out.** It was asserted as
`(runPanel.match(/setStartingId\(/g) ?? []).length === 2` — a call-site count,
which section 11 names as the weakest kind and the one worth deleting first. It
cannot say what the flag is for and fails as loudly for a correct third call site
as for a wrong one.

Confirmed worth porting rather than deleting: cutting the wire it protects left
the **whole renderer suite green**. So it was the only cover for a real bug — a
trigger fans out to one run per place and they are serialised (5.4), so between
two of them no run is `running`, and a card reading only the log offers "Run now"
in the middle of its own fan-out.

The port needed a new harness capability: a script value of `"__pending"` returns
a promise the driver resolves by hand. A stub that answers immediately cannot
express *"the fan-out is still going"*, which is the whole of 10's **"Run now
reflects the run, not the promise."**

**The popover's shared mutation wrapper** — switch, reorder, detach — was ported
in R3 step 6 and its regex is now gone.

### Portable and not yet ported

Six, marked in place:

- four on the sidebar marks (`ChatSessionRow`'s chip and dot, `markSessionRead`
  on `loadSession`, the attention prop) — all inside a mountable `ChatView`;
- one on the signed-out banner's derivation — the panel is already mounted;
- three on `AttachAutomationScreen`, which is **not** one of the harness's
  mounts. Adding it is the work.

Left rather than done, and named as left. Each is a claim the harness *could*
execute, so none of them is defensible as a source assertion for ever — but none
of them is currently the only cover for a bug the way the run flag was, which is
the test that decided the one port here. R7 should finish them or say why not.

---

## 5. What the sweep says about the rest of the review

Five genuine gaps in 48 is a better result than the scheduler's earlier
one-in-ten implied, and it matters for what R2–R4 concluded: those rounds
reasoned against these suites, and the suites hold.

The gaps that did exist were not random. Three of the five were **a fallback
nobody exercised** — the corrupt-value path R4 spent a whole step on, found
again from the opposite direction. One was **a fixture sitting where two readings
agree**, now the third instance in this review and the single most reliable way a
test in this repo has been wrong. And one was **a block whose assertions did not
test what the block was named after**, which is the shape section 11 already
called out once and which turns out to survive being called out.
