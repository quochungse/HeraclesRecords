/**
 * The plan editor's undo stack, now that it lives outside the editor.
 *
 * It moved because the draft used to die with the component, which is why the
 * tab strip was disabled while editing: the screen prevented navigation
 * rather than surviving it. Four rules hold the move up, and each is a way to
 * lose an athlete's work quietly:
 *
 * 1. Committing after an undo drops the redo tail. Keeping it would let a
 *    redo jump to a state the current one was never derived from.
 * 2. The baseline survives trimming. It is what "unsaved changes" compares
 *    against, so dropping it with the oldest states makes an edited plan
 *    compare equal to whatever fell off the end.
 * 3. `updatedAt` is not a change. Every commit stamps it, so comparing whole
 *    documents warns about losing nothing after an edit is undone.
 * 4. A draft is resumed only for the same plan at the same stored version. A
 *    pull from another machine can rewrite a plan mid-edit, and carrying on
 *    over the top of it publishes this copy as though it had seen that one.
 * 6. Keystrokes into one field are one state. Each used to be its own, so a
 *    typed name took half the stack and came back a letter per Undo. They
 *    fold until the field is left, and never into the baseline.
 *
 * Runs through Electron only so `--experimental-strip-types` is available on
 * a Node built without Amaro; it touches no SQLite and no window.
 */
import assert from "node:assert/strict";
import {
  DRAFT_HISTORY_LIMIT,
  canRedo,
  canUndo,
  commitDraft,
  draftIsDirty,
  draftPlan,
  redoDraft,
  resumeDraft,
  sealDraft,
  startDraft,
  undoDraft
} from "../src/training-library/planDraft.ts";

function plan(overrides = {}) {
  return {
    id: "plan-1",
    name: "Base",
    description: "",
    goal: "",
    source: "local",
    sportMix: [],
    weekCount: 4,
    phases: [],
    entries: [],
    tags: [],
    favorite: false,
    archived: false,
    syncState: "synced",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

/** A commit as the editor makes one: a change, and a fresh stamp. */
const edit = (draft, overrides) =>
  commitDraft(draft, {
    ...draftPlan(draft),
    ...overrides,
    updatedAt: new Date(Date.now() + draft.index + 1).toISOString()
  });

// ---------------------------------------------------------------------------
// 1. Undo, redo, and the tail a new commit drops
// ---------------------------------------------------------------------------
{
  let draft = startDraft(plan());
  assert.equal(canUndo(draft), false, "nothing has happened yet");
  assert.equal(canRedo(draft), false);
  assert.equal(draftIsDirty(draft), false);

  draft = edit(draft, { name: "Marathon" });
  draft = edit(draft, { name: "Marathon block" });
  assert.equal(draftPlan(draft).name, "Marathon block");
  assert.equal(canUndo(draft), true);
  assert.equal(canRedo(draft), false);

  draft = undoDraft(draft);
  assert.equal(draftPlan(draft).name, "Marathon");
  assert.equal(canRedo(draft), true, "an undone state is still there to redo");

  draft = redoDraft(draft);
  assert.equal(draftPlan(draft).name, "Marathon block");

  // Committing after an undo replaces the tail rather than branching.
  draft = undoDraft(draft);
  draft = edit(draft, { name: "Half marathon" });
  assert.equal(draftPlan(draft).name, "Half marathon");
  assert.equal(
    canRedo(draft),
    false,
    "the redo tail is gone — kept, a redo would jump to a state the current " +
      "one was never derived from"
  );
  assert.equal(
    draft.history.filter((state) => state.name === "Marathon block").length,
    0,
    "and the abandoned state is not left in the stack"
  );

  // Undo and redo past the ends are no-ops rather than throws.
  let floor = startDraft(plan());
  for (let pass = 0; pass < 3; pass += 1) floor = undoDraft(floor);
  assert.equal(draftPlan(floor).name, "Base");
  assert.equal(floor.index, 0);
  let ceiling = edit(startDraft(plan()), { name: "One" });
  for (let pass = 0; pass < 3; pass += 1) ceiling = redoDraft(ceiling);
  assert.equal(draftPlan(ceiling).name, "One");
}

// ---------------------------------------------------------------------------
// 2. The baseline survives trimming
// ---------------------------------------------------------------------------
{
  let draft = startDraft(plan({ name: "Opened" }));
  for (let pass = 0; pass < DRAFT_HISTORY_LIMIT + 15; pass += 1) {
    draft = edit(draft, { name: `Edit ${pass}` });
  }

  assert.ok(
    draft.history.length <= DRAFT_HISTORY_LIMIT,
    `the stack is capped, got ${draft.history.length}`
  );
  assert.equal(
    draft.history[0].name,
    "Opened",
    "position 0 is the baseline and is never trimmed away"
  );
  assert.equal(draft.base.name, "Opened");
  assert.equal(
    draftIsDirty(draft),
    true,
    "a plan edited 55 times has unsaved changes however much of the stack was " +
      "dropped — trim the baseline and it compares equal to whatever fell off"
  );
  assert.equal(draftPlan(draft).name, `Edit ${DRAFT_HISTORY_LIMIT + 14}`);

  // Undoing all the way back reaches the baseline, and nothing before it.
  let rewound = draft;
  while (canUndo(rewound)) rewound = undoDraft(rewound);
  assert.equal(rewound.index, 0);
  assert.equal(draftPlan(rewound).name, "Opened");
  assert.equal(draftIsDirty(rewound), false, "back where it started is not dirty");
}

// ---------------------------------------------------------------------------
// 3. A fresh timestamp is not a change
// ---------------------------------------------------------------------------
{
  const opened = plan({ name: "Steady" });
  let draft = startDraft(opened);

  draft = commitDraft(draft, { ...opened, updatedAt: "2026-06-01T00:00:00.000Z" });
  assert.equal(
    draftIsDirty(draft),
    false,
    "every commit stamps updatedAt, so a document differing only by its stamp " +
      "is the same plan — otherwise an edit typed and undone warns about " +
      "losing nothing"
  );

  draft = edit(draft, { weekCount: 6 });
  assert.equal(draftIsDirty(draft), true, "a real change is still a change");

  // Deep changes count, not just top-level fields.
  const withEntry = startDraft(plan());
  assert.equal(
    draftIsDirty(
      commitDraft(withEntry, {
        ...plan(),
        entries: [{ id: "e1", kind: "rest", weekIndex: 0, dayIndex: 1, sortOrder: 0 }]
      })
    ),
    true,
    "an added session is a change"
  );
}

// ---------------------------------------------------------------------------
// 4. A held draft is resumed only for the same plan at the same version
// ---------------------------------------------------------------------------
{
  const stored = plan({ name: "Held" });
  const held = edit(startDraft(stored), { name: "Half typed" });

  assert.equal(
    draftPlan(resumeDraft(held, stored)).name,
    "Half typed",
    "coming back to the same plan resumes the work in progress"
  );
  assert.equal(
    resumeDraft(held, stored),
    held,
    "and resumes the whole draft, undo stack included, not a copy of its tip"
  );

  assert.equal(
    draftPlan(resumeDraft(held, plan({ id: "plan-2", name: "Another" }))).name,
    "Another",
    "a different plan starts fresh"
  );

  const movedUnderneath = plan({ name: "Held", updatedAt: "2026-07-01T00:00:00.000Z" });
  assert.equal(
    draftPlan(resumeDraft(held, movedUnderneath)).name,
    "Held",
    "a plan rewritten by a sync pull mid-edit starts fresh: carrying on over " +
      "the top of it would publish this copy as though it had seen that one"
  );
  assert.equal(draftIsDirty(resumeDraft(held, movedUnderneath)), false);

  assert.equal(
    draftPlan(resumeDraft(null, stored)).name,
    "Held",
    "nothing held, so the stored plan is the draft"
  );
}

// ---------------------------------------------------------------------------
// 5. The draft does not alias the plan it was opened from
// ---------------------------------------------------------------------------
{
  const opened = plan({ entries: [{ id: "e1", kind: "rest", weekIndex: 0, sortOrder: 0 }] });
  const draft = startDraft(opened);

  opened.name = "Renamed outside";
  opened.entries[0].weekIndex = 3;

  assert.equal(
    draftPlan(draft).name,
    "Base",
    "the snapshot is the editor's own; the caller still holds the object it " +
      "passed and the library reloads that object on every sync pull"
  );
  assert.equal(draftPlan(draft).entries[0].weekIndex, 0, "deeply, not just at the top");
}

// ---------------------------------------------------------------------------
// 6. Keystrokes into one field fold into one state
// ---------------------------------------------------------------------------
{
  const type = (draft, field, value) =>
    commitDraft(draft, { ...draftPlan(draft), [field]: value }, field);

  let draft = startDraft(plan({ name: "" }));
  for (const value of ["M", "Ma", "Mar", "Mara", "Marathon"]) draft = type(draft, "name", value);
  assert.equal(draft.history.length, 2, "the baseline, and one state holding the whole name");
  assert.equal(draft.history[0].name, "", "the first keystroke never folds into the baseline");
  assert.equal(draftPlan(undoDraft(draft)).name, "", "so one Undo takes the whole name back");

  // A second field is a second state; returning to the first after it is a third.
  draft = type(draft, "goal", "Sub 3");
  draft = type(draft, "name", "Marathon block");
  assert.equal(draft.history.length, 4, "name, goal, name again: three states past the baseline");

  // Leaving the field seals it, even when the next keystroke is into the same one.
  draft = sealDraft(draft);
  draft = type(draft, "name", "Marathon block 2");
  assert.equal(draft.history.length, 5, "a field left and returned to starts a new state");

  // Any other commit ends the fold too.
  draft = edit(draft, { weekCount: 6 });
  draft = type(draft, "name", "Marathon block 3");
  assert.equal(draft.history.length, 7);

  // After an undo the next keystroke starts fresh rather than rewriting a state the redo tail hangs from.
  draft = undoDraft(draft);
  draft = type(draft, "name", "Different");
  assert.equal(canRedo(draft), false);
  assert.equal(draftPlan(undoDraft(draft)).name, "Marathon block 2");
}

console.log(
  "plan draft OK — redo tail dropped on commit, baseline survives trimming, " +
    "a fresh stamp is not a change, a moved plan starts fresh, keystrokes fold"
);
