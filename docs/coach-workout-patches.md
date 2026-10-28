# Partial workout edits

Coach sends only changed fields. The app reads and retains the complete source,
validates the result, and constructs COROS's full write request after the athlete
chooses Save or Apply. No new tool is needed; one line of the workout guide in
the system prompt (`workoutToolGuide`) sends small edits of a saved workout here
rather than to a replacement.

For a draft workout or a session of a Coach plan, use the existing
`revise_training_plan` with `patch_session`:

```json
{
  "draft_id": "the-newest-draft-id",
  "summary": "Shorter intervals and a reminder",
  "ops": [{
    "op": "patch_session",
    "key": "intervals",
    "set": {
      "/description": "Relax shoulders.",
      "/steps/1/steps/0/target_duration_seconds": 240,
      "/steps/1/repeat": 3
    },
    "unset": ["/steps/0/overview"]
  }]
}
```

For an existing calendar session or library workout, use
`propose_schedule_changes` with `op: "patch"`, the same `set` and `unset`, and
either `session: {plan_id, id_in_plan, date}` or `workout_id`.
An existing one-off workout saved from a Coach card is edited this way rather
than revising its saved draft into a second workout: `revise_training_plan`
refuses it with `draft_saved` and names where it went (`workout_id`,
`schedule_date`), recorded on the card's `uploadResult` when it was saved.

Step edits of saved workouts require the `revision` of the copy Coach read.
`list_scheduled_workouts` gives every session its revision and its steps
numbered as patch paths (`[1.0]` is `/steps/1/steps/0`) from the one range read
it already makes (`listScheduledWorkoutEntriesForEdit`), so a step edit costs
no second read; `sessions: [id_in_plan]` adds every field of the workout.
`get_workout_library` with `workout_ids` gives a library workout's.
Metadata-only changes can be proposed without a revision; the backend captures
the current one. Every proposal checks that revision again at Apply and in the
existing editor's save path.

A revision is the first 16 hex characters of a SHA-256 over the editor's ref,
the program and (for a session) the calendar entity, keys sorted. It hashes
content, so a changed workout is detected even when COROS omits its version
counter. It is shared with the Library and Calendar editors, which is why it was
probed on a real account (2026-10-28, reads only): two reads five seconds apart
gave the same revision for 11 of 11 calendar sessions and 4 of 4 library
workouts, and a 14-day and a 42-day range read gave the same revision as the
single-day read the editor makes for all 11.
These are read-before-write checks, not a server-side compare-and-swap: the
existing COROS write path still has a small interval between the final check
and the write.

## Deliberate limits

- Paths are absolute and step indices start at zero. A repeat's child uses
  `/steps/1/steps/0/...`. Arrays cannot be inserted, deleted, reordered or replaced
  through a patch. Use the existing replacement flow for structural rewrites.
- Editable fields are name, description, sport options, shorthand distance of
  a draft without steps, and existing steps' name, instructions, target,
  intensity, sets, recovery, send-off and repeat count. Sport, exercise identity,
  schedule placement and COROS IDs cannot be patched.
- Intensity and sport options are replaced as complete small objects. Editing
  inside an intensity variant is refused; switching variants cannot retain the
  old variant's fields. Changing target type clears incompatible target fields
  and requires the new type's value in the same operation.
- `unset` removes an optional field (editor defaults apply where relevant).
  `null`, unknown fields, duplicate paths, invalid types and edits of read-only
  COROS nodes are refused. A patch contains at most 50 field edits.
- Draft revisions are atomic. Patch operations do not silently rebase onto a
  newer draft or a newly imported COROS version. A stale proposal requires a
  new review; it is never merged over an unrelated edit.
- A saved plan retains its raw programs and exercise IDs when patched. Structural
  edits and patches of the same session must be separate revisions.
- Calendar edits affect that occurrence; a library edit affects that library
  workout. Neither implicitly propagates into other copies.

This restricted field patch keeps the schema smaller than exposing a second
workout schema or a general document-editing language. The revision schema
grew from 1,591 to 2,022 serialized characters (+431), below the existing
2,500-character regression budget. It saves model
input/output tokens; it does not assume COROS supports partial HTTP payloads.
The complete set of workout and plan tools grew from 47,365 to 48,751
serialized characters (+1,386, about 2.9%). On the account above, the numbered
steps and revisions made a 14-day list 38% longer than the exercise summary
they replace (2,607 to 3,609 characters for 11 sessions), and they carry each
step's intensity and rest, which the summary did not. These are character
measurements, not tokenizer-specific token estimates.

Validation: `test:workout-patch`, `test:chat-workout-tools`,
`test:chat-plan-artifacts`, `test:schedule-changes`, `test:coros-plan-writes`,
`test:coros-workout-editor`, and `test:schedule-change-renderer`.
