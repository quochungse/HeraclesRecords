# Text submitted to COROS

Reviewed on 2026-10-26 against the public Training Hub JavaScript and the user's
COROS iOS counter test. No live account writes were made by this audit. The web
and iOS clients count some fields differently; a web input limit alone does not
establish the server's maximum or compatibility with iOS.

## Limits and evidence

| Submitted field | Limit in this app | Evidence / review result |
|---|---|---|
| Plan `name` | 90 UTF-8 bytes | Plan add/edit inputs use 90 with `getStringByte`. Previously the app had no length guard. |
| Plan `overview` (`description`) | 800 UTF-8 bytes | Plan add/edit inputs use 800 with `getStringByte`. Previously unbounded in forms, Coach schemas and native write builders. |
| Workout `name` | 90 UTF-8 bytes | The full workout inputs use 90 with `getStringByte`. Previously the edit validator counted 90 JavaScript characters; create, quick and duplicate flows lacked equivalent guards. |
| Workout `overview` (`description`) | 200 UTF-8 bytes | User-specified maximum of 200, with the user's iOS counter test matching UTF-8 byte lengths: `A` = 1, `Â` = 2, `Ấ` = 3. Previously the app counted UTF-16 units instead. |
| Custom step / repeat group `name` | 90 UTF-8 bytes | App guard matching workout names; a separate server maximum for custom step names was not established by this audit. |
| Custom step `overview` | 200 UTF-8 bytes | Same byte budget as session notes for compatibility with iOS. A separate server maximum for arbitrary steps was not independently established. |
| Profile `nickname` | Existing 1–64 characters | Form and backend agree, but no matching editable nickname control or server maximum was established from the public Training Hub client. This remains an app guard, not a verified COROS API maximum. |

The 300 value was already present in this app. It is also present in COROS's
**full** workout editor, which imports a 300-character constant and clamps the
overview with it. The 200-character control belongs to the **custom strength
catalog exercise** editor: its submit handler calls `api4addStrengthExercise` /
`api4updateStrengthExercise`. The initial audit incorrectly identified this as
a quick workout form. This app now uses **200 UTF-8 bytes** consistently for
notes entered through its own forms and Coach actions, including nested steps.
Existing native programs carried through unchanged keep their original text.

The web custom exercise's 200 limit uses `String.length` (UTF-16 code units): the
textarea has no `word-length` or `word-slice` override. In the shared textarea,
the default counter returns the string's `.length`; byte counting only happens
when a caller explicitly passes `getStringByte`. Those web counter semantics
were incorrectly generalized to iOS in the initial conclusion. The user's iOS
test instead reports `A` = 1, `Â` = 2, `Ấ` = 3, which matches UTF-8 byte lengths.
The app follows that byte budget for mobile compatibility. For example, 100
precomposed `Â` characters occupy 200 bytes, 66 `Ấ` plus one `Â` occupy 200 bytes,
and 67 `Ấ` occupy 201 bytes and are rejected. One `😀` occupies 4 bytes. Input is
not Unicode-normalized: combining sequences retain their actual encoded bytes.
The iOS observation and web limits are recorded separately; a server boundary
test has not been performed.

### Public source references

- [Plan creation](https://static.coros.com/coros-traininghub-v2/assets/index-0jqz0Ki_.js)
  and [plan editing](https://static.coros.com/coros-traininghub-v2/assets/index-PSh6bodx.js):
  name 90, overview 800, both with the custom byte counter and byte slicer.
- [Workout forms](https://static.coros.com/coros-traininghub-v2/assets/index-REmK04-E.js):
  custom strength catalog exercise name 90 with byte counting, its overview 200
  with the default character counter; full workout overview imports the shared
  300-character constant.
- [Full workout editor](https://static.coros.com/coros-traininghub-v2/assets/index-YuGY0S5z.js):
  name 90 with byte counting; overview uses the imported constant.
- [String helpers](https://static.coros.com/coros-traininghub-v2/assets/string-XjAIydcf.js):
  `TextEncoder` provides the byte count; the full editor's overview constant is
  300. The string clamp iterates Unicode characters.
- [Shared textarea](https://static.coros.com/coros-traininghub-v2/assets/main-6qOb_dhK.js):
  the `Textarea` component counts `.length` unless `wordLength` is supplied.

## Enforcement

`electron/corosTextLimits.ts` owns the shared constants, UTF-8 counter, safe
input clamp and validation helpers. The byte clamp iterates grapheme clusters
(`Intl.Segmenter`), so it cannot split an emoji, a multibyte character or a
decomposed Vietnamese letter from its combining marks. Session note counters show
bytes (`B`); validation helpers require callers to state the unit explicitly.

- Plan, quick workout and shared workout editor inputs use these limits.
- Coach schemas expose the limits; runtime checks enforce byte limits that
  JSON Schema's `maxLength` cannot express.
- New workout payloads, workout edits and native plan create/update builders
  reject overlong text. They do not silently discard the end of a note.
- Both automatic plan copies and workout copy names reserve space for ` Copy`
  inside the 90-byte limit. An explicitly supplied duplicate name is validated.
- Native programs reused without editing are preserved. Identity fields,
  catalog IDs/names, URLs and localisation keys are not treated as new free-text
  inputs or clipped to an invented limit.

Other text surfaces were checked for scope: library tags/searches and Coach
brief constraints stay local; manual activities upload a generated TCX file
rather than a plan/workout text field. Login credentials and verification codes
are authentication inputs, not training content. This review does not establish
new API length claims for those fields or for import filenames.

Boundary tests cover 200/201-byte notes, nested step notes, 90/91-byte
names, the iOS `A`/`Â`/`Ấ` examples, emoji-safe clamps, 800/801-byte plan descriptions,
create/edit parity and duplicate suffixes. They use local payloads and a fake
COROS service, not live writes.
