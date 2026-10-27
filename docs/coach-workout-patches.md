# Partial workout edits

Coach sends only changed fields. The app reads and retains the complete source,
validates the result, and constructs COROS's full write request after the athlete
chooses Save or Apply. No new tool or system-prompt section is needed.

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
than revising its saved draft into a second workout.

Step edits of saved workouts require the `revision` returned by
`list_scheduled_workouts` with `sessions: [id_in_plan]`, or
`get_workout_library` with `workout_ids`. Metadata-only changes can be proposed
without a preliminary full read; the backend captures the current revision.
Every proposal checks that revision again at Apply and in the existing editor's
save path. Revision hashes include content, so a changed workout is detected
even when COROS omits its version counter.
These are read-before-write checks, not a server-side compare-and-swap: the
existing COROS write path still has a small interval between the final check
and the write. A targeted calendar read returns only the requested sessions,
without duplicating their full steps as an exercise summary.

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
The complete set remains 12 tools: its serialized definitions grew from 47,394
to 48,628 characters (+1,234, about 2.6%). These are character measurements,
not tokenizer-specific token estimates.

Validation: `test:workout-patch`, `test:chat-workout-tools`,
`test:chat-plan-artifacts`, `test:schedule-changes`, `test:coros-plan-writes`,
`test:coros-workout-editor`, and `test:schedule-change-renderer`.
