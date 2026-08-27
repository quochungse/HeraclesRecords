# Coach Automations — review plan

Status: **proposed**, written 2026-08-26 against the code at the end of phase 3.

Companion to [coach-automations.md](./coach-automations.md), which is the feature's spec *and* its record. This file is neither: it is the plan for going back over 21 build sessions and finding what they left.

---

## The strategy

**Review along axes the build did not run along.** The feature was built bottom-up — schema, store, runner, watcher, IPC, screens — one module per session, 21 of them. A review that walks the same path re-reads the same code in the same order and finds the same nothing.

Every bug this feature has actually produced was found by crossing that grain:

| Where they came from | What they had in common |
|---|---|
| Phase-2 UAT — 6 bugs | Every one was *something true in the main process that no window was told about* |
| Phase-3 review — 2 bugs | Both at the **seam between two features**, each of which was correct alone |
| The mutation passes | Tests that passed against genuinely broken code |

So the phases below are **failure modes, not modules**. R2 (seams) and R3 (the renderer contract) are where the evidence says the bugs are.

**Every finding lands as a test that goes red without the fix.** No "looks fine" reviews, no findings that live only in a summary. This is the discipline section 11 already earned; a review that relaxes it produces a list nobody can check a year from now.

**Every phase names what it does *not* read.** The feature is ~1800 lines of `electron/`, ~1500 of renderer and 11 suites. A review that re-reads all of it costs more than the build did and finds less.

---

## Two findings this plan already has

Both surfaced while writing it, and both are the shape R2 is built to hunt. They are seeds, not the point — if R2 finds nothing else, R2 was wrong.

1. **The rolling summariser's tokens are invisible to the budget.** `rollSummary` (5.7) runs a full provider turn and reads `collector.text()`; it never reads `collector.usage()`. So a long conversation's roll — one extra turn per ~20 runs — is spent, and section 13's month-to-date total cannot see it. The budget under-reports by exactly the feature that exists to make long conversations affordable.

2. **A threshold transition is consumed by any refusal.** `evaluateThresholdBinding` writes `threshold_firing` *before* calling the runner (deliberately — 3.3, so a crash cannot re-announce), and no guard-rail refusal writes it back. So a crossing that lands during quiet hours, inside a cooldown, past the daily cap, on a backed-off binding or under either pause is recorded as announced and **never fires**. The doc justifies write-before-run against *crashes*; it does not address routine refusals, and quiet hours make this reachable every night.

---

## The phases

Seven phases, fourteen steps, one session each. Run **R1 → R2 → R3** first whatever else you cut: R1 makes the rest checkable, and R2/R3 are the two axes with a track record.

| Phase | Goal | Steps |
|---|---|---|
| R1 | Ground truth: what exists, and where the doc no longer describes it | 1 |
| R2 | The seams between features | 3 |
| R3 | The main↔renderer contract | 2 |
| R4 | Persistence and lifecycle | 2 |
| R5 | Test integrity | 2 |
| R6 | Cost, safety and hostile input | 2 |
| R7 | The athlete's journey, and closing | 2 |

---

### R1 — Ground truth

**Goal.** One checkable map of what the feature actually is, and a list of every place `coach-automations.md` no longer describes it. Reviewing against a spec that has drifted produces false findings and hides real ones — and the doc has been rewritten in place across three phases.

**1. Inventory and drift**

> "Read docs/coach-automations.md end to end. Produce docs/coach-automations-map.md: every table and column the feature owns and which section describes it; every IPC channel with its main handler, preload method and renderer caller; every injectable dep seam and which suite drives it; every `app_settings` key; every test suite and, in one line each, what it would fail to catch. Then list every place the doc and the code disagree — a stale cross-reference, a described behaviour that is not the built one, a built behaviour with no section. Do not fix anything: the output is the map and the drift list."

**Do not read** the renderer components in this step. The map is about main-process surface and contracts.

---

### R2 — The seams between features

**Goal.** Every pair of features that touches shared state behaves when both are active. This is where both phase-3 review bugs were, and neither suite noticed because **each half was correct alone**.

The shared state, for reference: the six per-binding clocks (`last_run_at`, `next_run_at`, `last_activity_at`, `backoff_until`, `backoff_level`, `threshold_firing`), the per-conversation summary pair, and the two process-wide flags (pause, budget).

**2. The refusal cluster**

> "Read docs/coach-automations.md sections 4, 10 and 13. Every guard rail, both pause reasons, the failure backoff and the monthly budget can refuse the same run, and several of them write state as a side effect. Enumerate every ordered pair — what happens when A is already active and B fires — and for each say whether the result is what the athlete would expect. Start from the two known findings in the review plan. Every real one gets a fix and a test in test-coach-automation-runner.mjs that goes red without it; every pair that turns out fine gets one line saying why, so the next reviewer does not redo it."

**3. The trigger-lifecycle cluster**

> "Read docs/coach-automations.md sections 2.3, 2.4, 3.1, 3.2 and 3.3. Follow the state a trigger writes — the schedule slot, the activity watermark, the threshold firing flag — through every way a run can end: success, silent, skipped for each reason, failed, cancelled, dropped by a cancelled fan-out, and the app quitting mid-run. For each, say which of those three is advanced, which is left, and whether that is right. Pay particular attention to a `multiActivity` catch-up sequence interrupted part-way, and to a binding detached and re-attached. Fixes land in the runner and scheduler suites."

**4. The conversation cluster**

> "Read docs/coach-automations.md sections 5.6b and 5.7. The transcript is written by the window, by the runner, and by the rolling summariser, and read by all three. Work out every interleaving that can lose or duplicate an entry, or leave `coach_summary_through` describing a transcript that has moved: a roll racing the athlete's turn, a run finishing while the window saves, a `dedicated` binding rebuilding a deleted conversation, a per-run binding, and the summary surviving a provider switch. Fixes land in test-chat-history-store.mjs and test-coach-automation-runner.mjs."

---

### R3 — The main↔renderer contract

**Goal.** Every piece of state that changes in the main process reaches every surface that shows it. Phase 2's UAT produced six bugs and *five were this exact shape*; the lesson recorded then was that **every push the main process sends is part of the feature's contract, not an optimisation**. Until step 17 there was no way to test it. Now there is.

**5. Find the state nobody is told about**

> "Read docs/coach-automations.md sections 9.1, 9.3 and 10. List every piece of state the main process can change while a window is open — run rows, bindings, the pause, the budget, the conversation list, the attention marks, the threshold slots, chat settings an automation overrode. For each, name the push that announces it and every surface that renders it. Report the ones with no push, the ones with a push nobody listens for, and the ones a surface reads only on mount. Do not fix yet — the output is the gap list, ranked by what an athlete would actually notice."

**6. Execute the wires**

> "Take R3's gap list. For each gap, fix it and add a test to scripts/test-coach-automation-renderer.mjs that mounts the real surface and drives the push. Then mutation-test the whole renderer suite: cut each wire it claims to cover and confirm the suite goes red. Any assertion that survives its own mutation is either wrong or about the wrong axis — rewrite it or delete it."

---

### R4 — Persistence and lifecycle

**Goal.** What is on disk survives an upgrade, survives a crash, and cannot reach a combination that means nothing.

**7. Every column, from every prior version**

> "Read section 1. Six columns were added to `coach_automation_bindings` across three phases, two to `coach_automation_runs`, two to `chat_sessions`, plus a new table and two `app_settings` keys — all through `ensureColumn`, so a database from any earlier version has to still work. For each: what does NULL mean, what does a pre-migration row read as, what does a hand-edited or half-written value do, and is there a combination of columns that is contradictory? Extend test-coach-automation-sql.mjs, which is the only suite that touches the real schema."

**8. Crash, quit and restart**

> "Read section 10's 'app quits mid-run' row and section 3.1's catch-up. Work out what is left dangling when the process dies at each point: mid-stream, mid-roll, mid-fan-out with a cancellation token live, mid-snapshot, between a threshold state write and its run, between a slot booking and its run. For each, say what the next launch does and whether anything is lost, duplicated or announced twice. The stale-`running` cleanup covers one of these; find the ones it does not."

---

### R5 — Test integrity

**Goal.** The phase-1 and phase-2 suites have never been systematically mutation-tested — only the scheduler was, and one of its ten mutations survived. Everything the rest of this review concludes rests on those suites.

**9. Mutation-sweep the phase-1 suites**

> "Mutation-test test-coach-automation-store.mjs, test-coach-automation-bindings.mjs, test-coach-automation-guards.mjs and the phase-1 half of test-coach-automation-runner.mjs. Write mutations that compile and are still wrong — a mutation `tsc` rejects is not a detection. Report every survivor and classify it: a genuine gap (write the test), an equivalent mutation (say why and move on), or an assertion about the wrong axis (rewrite it)."

**10. Mutation-sweep the phase-2 suites and the remaining source assertions**

> "Same treatment for test-coach-activity-watcher.mjs, test-coach-automation-schedule.mjs, test-chat-history-store.mjs and test-coach-automation-plan-draft.mjs. Then take every source-level assertion still in the repo and ask whether it is genuinely about source — a contract between two processes, a shape TypeScript cannot see — or a behavioural claim that the renderer harness could now execute. Port the second kind; keep the first with one line saying which it is."

---

### R6 — Cost, safety and hostile input

**Goal.** Know what this feature costs and what it exposes, both of which grew every phase and neither of which was ever measured whole.

**11. What it costs**

> "Count, precisely: SQL queries per scheduler tick and per watcher tick; queries and provider turns per run, including the rolling summariser and every tool round; rows added to each table per day for a plausible athlete. Then say what a year looks like, and whether anything prunes the run log. Fix what is wasteful — start from the summariser's uncounted tokens in the review plan — and where a cost is inherent, write it down in section 13 so nobody has to count it again."

**12. What it exposes**

> "Read section 6 and decision 3. Check the read-only allowlist the way an attacker would: does a tool added tomorrow default to allowed or blocked, and is `none` genuinely nothing. Then follow untrusted text into every prompt — activity names, COROS payloads, conversation titles, the athlete's own playbook — and say what a hostile or merely odd value can make a run do, given the run is unattended and its output is written into a conversation. Finally: the rolling summariser ships transcript to a provider, and the COROS 2FA path runs with no window; check both are what the athlete would expect."

---

### R7 — The athlete's journey, and closing

**Goal.** Use the thing. Then leave the record true.

**13. UAT on the real app**

> "Run the app with a stub provider and walk the whole feature as an athlete: create each of the four trigger kinds from the preset gallery and from scratch, attach in all three modes, watch a run land in an open conversation and in a closed one, press Stop mid fan-out, let a run fail and watch the backoff, trip the budget and resume, and leave a conversation long enough to roll. Read the console, not just the DOM. Every bug gets a fix and a test that dies when the fix is reverted."

**14. Reconcile and close**

> "Bring docs/coach-automations.md back in line with what R1-R13 found and changed: the drift list from R1, the seam rules from R2, the contract from R3, the costs from R6. Then triage section 12's 'smaller things, carried rather than forgotten' — each one either gets fixed, gets a phase-4 line, or gets deleted with a reason. Restate what is deliberately out of scope so the next person does not rediscover it."

---

## What this plan is not

- **Not a rewrite.** Nothing here proposes changing the architecture. Every locked decision stays locked.
- **Not phase 4.** Auto-launch, tray, native notifications stay out (section 12).
- **Not a re-read.** If a step finds itself reading a file the build already reviewed twice, it is running along the wrong axis — stop and go back to the failure mode it was supposed to be chasing.

## If you have to cut

Run **R1, R2, R3** and nothing else. That is four sessions and covers both axes with a proven yield. R5 is the next one I would keep, because it decides how much the other phases' green suites are worth.
