# UI System refinement — round 3

Status: **specification, not built**. Written 2026-09-17, on branch
`redesign_ui_language`, which starts level with `main`. Revised the same day
after a review, which found two instructions that would have broken the app if
followed to the letter (§2's replace pattern, §3's token scope), four places
where the spec contradicted itself, and a verification step that named a probe
nobody had written. Those are corrected in place below; the four questions the
corrections could not settle alone are in §9, where the decisions taken on them
are recorded.

This is a self-contained brief. It assumes no memory of the conversation it came
out of. Every number in it was measured on the tree at the time of writing and
every measurement carries the command that produced it, so a reader who doubts a
figure can re-take it rather than trust it.

It follows two rounds of work already merged into `main`:

| Commit | What it did |
|---|---|
| `97fb0d1` | Light (`paper`) theme recoloured: grey canvas, white surfaces, accent out of `--bg-base`. |
| `bb53bc8` | Design vocabulary closed (4 weights, 9 sizes, 4 tracking steps, 11 radius tokens) and enforced by `npm run test:design-vocabulary`; decorative hue removed from chrome. |
| `4af6310` | Merged both into `main`. The working tree is clean at the time of writing. |

Both rules are written up in [CLAUDE.md](../CLAUDE.md) under **Renderer** — read
those three paragraphs before touching anything here. This document does not
repeat them; it extends them.

One finding from the review of that work is worth carrying forward, because it
is the kind of mistake this document could repeat: `test:design-vocabulary`
originally anchored its matchers to the start of a line, so 41 declarations
written inside single-line rules were invisible to the test whose whole purpose
was to see all of them. **A new static test must be proven non-vacuous** —
inject deliberate violations, confirm each is reported, and confirm the
near-misses are not. Do that for the test in §4.5 before trusting a green run.

---

## 0. The one thing to understand first

Everything below except §5 is **hygiene**. Hygiene removes ugliness; it does not
create character. Done in full, the app will be tidier, cheaper to change, and
will look very nearly the same as it does today.

Two items are the exception, because they change what the app *feels* like
rather than what it looks like in a screenshot: the motion curve (§2) and the
elevation ladder (§4). Everything that would actually change the app's face is
in §5, and §5 is a decision, not a task list.

Sequence the work so the cheap certainties land first and the aesthetic
judgements are made with eyes on a real screen, not in a spec.

---

## 1. `line-height` — close the half-open type scale

**Why.** `test:design-vocabulary` closed `font-size`, `font-weight`,
`letter-spacing` and `border-radius`. It left leading open, and leading is half
of a type scale. The file now holds 27 values across 365 declarations:

```
1.45(65)  1.5(47)  1(44)  1.4(36)  1.2(28)  1.35(27)  1.55(20)  1.3(16)
1.1(15)  1.25(15)  1.15(9)  1.02(8)  1.05(7)  1.6(6)
tail: 0.95 0.98 1.08 1.12 1.16 1.24 1.28 1.42 1.65 1.7 1.72 2.1
```

1.35 vs 1.4 vs 1.45 is exactly the kind of decision the vocabulary test exists
to stop: nobody chose three of them on purpose.

**Do.** Add a fifth closed set to
[scripts/test-design-vocabulary.mjs](../scripts/test-design-vocabulary.mjs),
beside `WEIGHTS` / `SIZES_PX` / `TRACKING` / `RADIUS_TOKENS`:

```js
/** Leading. Four steps and `1`, which is not leading but the absence of it:
 *  a number, a badge or an icon chip whose box is its own height. */
const LEADING = new Set(["1", "1.2", "1.3", "1.45", "1.6"]);
```

- `1` — marks, figures, single-line chips.
- `1.2` — display type, 22px and up.
- `1.3` — headings and dense UI rows.
- `1.45` — body, the default.
- `1.6` — long prose only (chat Markdown, settings explainers).

Reuse the existing `declarations(line, prop)` helper, which already finds
declarations anywhere on a line, and the existing `isPassthrough` for
`var()`/`inherit`. Then convert the 365 sites.

Five steps do not say where the other 22 values go, and two of them sit exactly
between steps. The rule: **nearest step; a tie rounds up.** Shrinking leading is
what clips a descender, so a coin-flip should land on the side that cannot.

| From | To | Sites |
|---|---|---|
| 0.95, 0.98, 1.02, 1.05, 1.08 | `1` | 24 |
| 1.1, 1.12, 1.15, 1.16, 1.24 | `1.2` | 27 |
| 1.25, 1.28, 1.35 | `1.3` | 43 |
| 1.4, 1.42, 1.5 | `1.45` | 86 |
| 1.55, 1.65, 1.7, 1.72 | `1.6` | 23 |
| 2.1 | read it first — one site, and double spacing is either deliberate or a bug | 1 |

`1.35` → `1.3` is the one move downward with real volume (27 sites); it is where
a clip would come from if one comes.

**Acceptance.** `npm run test:design-vocabulary` passes with the new set listed
in its console summary, and the header comment explains the five steps the same
way the other sets are explained. The new check is proven non-vacuous before a
green run is trusted: an off-scale value inside a single-line rule and one
carrying `!important` are each reported, and a custom property named
`--line-height` is not.

**Risk.** Leading changes box heights. A tight control that fitted at 1.35 can
clip at 1.3, and one that fitted at 1.4 can spill at 1.45. Run
`probe-ui-cdp.mjs capture` afterwards and `compare` it against the baseline
(§7); treat anything it reports as `NEW` or `GREW` as a real regression — the
baseline is what answers "did this element already overflow on `main`".

**Cost.** Small. Mechanical. Lowest risk-to-value ratio of anything in this file
— do it first.

---

## 2. Motion — one curve, three durations

**Why, and this is not what it looks like from a distance.** The app does *not*
have a motion zoo. It has one curve used almost everywhere, and that curve is
the browser default:

```
easing:   721 uses, 12 kinds  —  bare `ease` is 663 of them (92.0%)
duration: 732 uses, 26 steps  —  120–240ms is 92.9% of them
transitions >= 300ms: 32, and each is deliberate (drawer 320ms, recovery ring 800ms)
@media (prefers-reduced-motion): 49 blocks already present
```

`ease` is `cubic-bezier(0.25, 0.1, 0.25, 1)` — near-symmetric, so every state
change accelerates *into* its destination. That is what reads as soft and
slightly late. A decelerating curve arrives crisply and costs one token.

So this is not a consolidation job. It is a single deliberate substitution,
which is why it has the highest felt-change-per-line of anything here.

**Do.** Define in the `:root` token block of
[src/styles.css](../src/styles.css) (near `--radius-*`, around line 57):

```css
--ease: cubic-bezier(0.2, 0.8, 0.2, 1);   /* decelerate; the app's one curve */
--dur-fast: 140ms;   /* state: hover, active, colour, opacity */
--dur-base: 180ms;   /* enter / leave */
--dur-slow: 320ms;   /* drawers and panels that travel a distance */
```

Then replace across all 13 stylesheets — with a script that splits each
`transition` list into its items, not with `sed`:

- **The keyword pattern is `(?<![-\w])ease\b(?!-)`, and the lookbehind is the
  whole point.** An earlier draft of this section said `\bease\b(?!-)`. `-` is
  not a word character, so `\b` also fires inside a custom property name: that
  pattern matches 686 times, and **32 of them are `--map-ease`** — its
  definition and 31 `var(--map-ease)` uses in `activityGlobe.css` — not the one
  the draft said to step around. A replace written with it turns every globe
  transition into `var(--map-var(--ease))`, which is invalid, so the declaration
  is dropped and the transition silently stops. The keyword itself occurs
  **654** times. The `(?!-)` still protects `ease-in`, `ease-out` and
  `ease-in-out`; keep both halves.
- **17 `animation` declarations are timed with bare `ease`** and the replace
  changes their curve too, although animation durations are out of scope. That
  is intended for an entrance (`chat-empty-enter`, `tl-fade-in`) and worth a
  look for the long ones (`chat-jump-highlight` at 1.8s, `training-fill` at
  0.85s), where a decelerating curve front-loads almost all of the movement.
- Durations: everything in 120–240ms goes to `--dur-fast` or `--dur-base`.
  Pick by what moves: colour/opacity/border → fast; transform, height, an
  element appearing → base. Everything at 300–330ms → `--dur-slow`.
- **37 durations fall in neither band**, and the draft said nothing about them:
  100ms(3) 250(6) 260(1) 280(5) 350(2) 360(4) 400(2) 450(2) 500(3) 750(2)
  800(6) 850(1). The 800ms is six declarations, not just the recovery-ring
  stroke; 750–850ms are staggered reveals carrying a 220ms delay, and 350–500ms
  are Strength's spring curves (`cubic-bezier(0.32, 1.28, 0.46, 1)` and kin),
  whose length belongs to the curve. Where each group goes is **decision Q3 in
  §9**. The recommendation: 100 → fast, 250–280 → base, the rest literal with a
  comment, on a written-down exception list.
- **3 reduced-motion overrides** (`0.001ms !important`, `0.01ms !important`)
  are literal on purpose and stay so.
- Delays are a separate question and stay literal: 32 of them, 45–225ms, almost
  all of them a stagger.
- `animation` durations are a separate population (119 uses, 78 of them ≥400ms)
  and are **out of scope**. An animation is a designed length; a transition is
  a reaction time.

`node scripts/measure-ui.mjs` prints every figure in this list under §2.

**Acceptance.** `(?<![-\w])ease\b(?!-)` matches **0** times in `src/**/*.css`
(the `--ease` definition does not match it, and neither does `--map-ease`, which
must be byte-identical afterwards). No `transition` in `src/**/*.css` carries a
literal duration except the reduced-motion overrides and the Q3 exception list.
If Q4 is taken, both of those are asserted by `test:design-vocabulary` rather
than read off a grep — the same reasoning that closed the type scale: a curve
written by hand next month is not caught by intention either.

**Risk.** Low. The failure mode is a transition that stops firing because the
shorthand got malformed — `npm run build` will not catch that, and neither will
a render, because an invalid declaration is dropped silently. Read the computed
`transition` of a sidebar item, a drawer and the theme toggle over CDP after the
change, and diff `activityGlobe.css` to confirm `--map-ease` was not touched.

---

## 3. Focus — one ring

**Why.** 144 `:focus-visible` rules spell 35 different rings. 25 of them use
`2px solid var(--accent)`, which is the de facto standard; the rest diverge. And
8 rules remove the outline without a box-shadow in the same rule. Read one rule
at a time, that looks like eight defects; read beside the rules around them it
is seven collapses and one weak indicator, and **none** leaves focus invisible:

| File | What it does |
|---|---|
| [src/styles.css:1706](../src/styles.css#L1706), [:1801](../src/styles.css#L1801), [:29866](../src/styles.css#L29866), [:30035](../src/styles.css#L30035) | `:hover, :focus-visible` collapsed into one rule with a background swap. Focus is visible but indistinguishable from hover. |
| [src/running/running.css:274](../src/running/running.css#L274), [:710](../src/running/running.css#L710) | Same collapse, on table rows. |
| [src/styles.css:11257](../src/styles.css#L11257) | `.vo2-plateau` drops its outline here, and three other rules give focus exactly what hover gets — the bar grows (`scaleY(1.7)`, [:11270](../src/styles.css#L11270)) and its tooltip opens. The same collapse, split across rules. An earlier draft called this "nothing replaces it"; it was reading the rule alone. |
| [src/watchfaces/watchfaces.css:8995](../src/watchfaces/watchfaces.css#L8995) | Search input swaps its outline for a border tint (`--wf-focus`). Present, but a 1px colour change is the weakest indicator in the app. |

`node scripts/measure-ui.mjs` classifies each one this way under §3. (The line
numbers in the draft were two lines early: the script reported where the text
*before* a selector began, comment included. It now reports the selector.)

Collapsing hover and focus is the real problem: a keyboard user gets the
mouse-over state and no way to tell that the element is *selected* rather than
merely under a cursor.

**Do.** One token, one recipe — declared **on the focused element, not on
`:root`**:

```css
:focus-visible {
  --focus-ring: 0 0 0 2px var(--bg-base), 0 0 0 4px var(--accent);
}
```

Where it is declared is not style. A custom property whose value holds `var()`
is resolved on the element that declares it, and descendants inherit the
*result*. Declared on `:root`, the ring is baked with the root accent, and five
scopes that redefine `--accent` for their own subtree —
[`.chat-view`](../src/styles.css#L17712), [`.chat-sidebar`](../src/styles.css#L18647),
their two paper variants, and [`.chat-coaches-panel`](../src/styles.css#L33505) —
would draw someone else's colour. Declared on `:focus-visible`, it resolves on
the element that is focused, inside whatever scope it is in. (`--focus-ring`,
not `--ring`: the recovery ring already owns `--ring-color` and `--ring-glow`.)

A two-stop ring (a gap, then the accent) separates from a surface in a way a bare
`outline` does not. The gap is `--bg-base`, which on a white paper card reads as
a thin grey halo rather than as nothing — look at it on screen before calling
it right. Apply it as `box-shadow: var(--focus-ring)`, and split every
collapsed `:hover, :focus-visible` rule into two.

Two details the draft missed:

- **Keep `outline: 2px solid transparent` beside the shadow.** Forced-colors
  mode (Windows High Contrast) removes every `box-shadow`, so a ring drawn only
  with one disappears exactly for the people who most need it. A transparent
  outline is invisible normally and is repainted in the system colour there.
- **Two of the collapses are on `<tr>`.** Whether this Chromium paints a
  `box-shadow` on a table row is a thing to check in the app, not assume; if it
  does not, the ring for those rows goes on the first and last cell, or on an
  `outline` with a negative offset.

**Acceptance.** Every `:focus-visible` in `src/**/*.css` either sets
`box-shadow: var(--focus-ring)` (alone, or composed with the element's own
shadow token) or is on a written-down list of exceptions. Tab through Overview,
Sleep, Running and Settings in both themes, and read `getComputedStyle(
document.activeElement).boxShadow` over CDP at each stop: the ring is present,
in that scope's accent, and differs from the hover state.

**As built: an outline, not a box-shadow.** The recipe above was built first and
failed in the app. Tabbing through Overview in paper found a button with no ring
at all: `:root[data-theme="paper"] .training-upcoming-today` sets `box-shadow`
at specificity 0,3,0 and beat `.training-upcoming-today-button:focus-visible` at
0,2,0 — a different class on the same element, which no static scan can pair.
Hundreds of rules set a shadow, so that was a class of bug, not a case. The ring
is therefore `outline: var(--focus-ring)` with `--focus-ring: 2px solid
var(--focus-ring-color, var(--accent))`, at `outline-offset: 2px` — or `-2px` inside a
container that clips: the ten rules that already drew their outline inside, plus
seven the running app showed being cut off (the Sleep night list, both Running
tables, Strength sessions, the Activities mix bar, and a Training Library card's
open button and its reader's favourite button), found by tabbing through nine screens and comparing each ring's
box against every clipping ancestor. Only
49 non-focus rules set `outline` at all, the element keeps its own elevation
while focused, the gap is transparent rather than a grey halo on a white card,
and forced-colors mode needs no transparent-outline trick. 107 rules were
rewritten, 44 of them split off a `:hover` (five of those then merged back into
the focus rule that already followed them); nine features keep their own ring
colour through `--focus-ring-color` (strength ember, chat signal, watch-face
focus, the calendar chip and step colours, the map accent). `<tr>` rows were
checked separately: Chromium paints both. Held by `test:design-vocabulary`.
The review pass added one more: the Activities search pill wraps a borderless
input that drops its outline, so nothing showed keyboard focus there at all; the
pill now wears the ring through `:has(input:focus-visible)`, which is why
`--focus-ring` is declared on `:focus-within` as well as `:focus-visible`.

**Risk.** `box-shadow` on a focus ring conflicts with an element that already
carries an elevation shadow. Those must compose:
`box-shadow: var(--focus-ring), var(--shadow-card)`. Order: after
`test:elevation` exists (§4.5), so the composed values are checked as they are
written, and before the ladder moves any shadow.

---

## 4. The elevation ladder

This is the substantial one. Read the whole section before starting.

### 4.1 What is actually wrong

Measured over CDP on the running app, paper theme, counting **containers** —
a surface with padding ≥ 8px, at least one element child, and at least
80×32px. A legend dot, a swatch or a bar segment paints a surface but groups
nothing; counting those as layers makes every chart look four deep, and an
earlier version of this analysis made exactly that mistake.

Re-taken with `probe-ui-cdp.mjs` on 2026-09-17 (§7), at two window sizes —
and the second column is not a formality. The draft's table was taken at the
window's own size, about 1180px, without saying so; that is under the 1200px
at which Activities splits into list and detail, so the detail pane was not on
screen to be counted.

| Screen | 1180×695: 1 | 2 | 3 | 1600×980: 1 | 2 | 3 |
|---|---|---|---|---|---|---|
| Overview | 14 | 40 | **6** | 14 | 40 | **6** |
| Sleep | 5 | 8 | **29** | 5 | 8 | **29** |
| Settings | 9 | 21 | **4** | 9 | 21 | **4** |
| Activities | 9 | 1 | 0 | 9 | 2 | **27** |
| Running | 47 | 0 | 0 | 47 | 1 | 0 |
| Strength | 18 | 12 | 0 | 18 | 13 | 0 |
| Coach | 28 | 3 | 0 | 28 | 3 | 0 |
| Calendar | 45 | 0 | 0 | 45 | 18 | 0 |

At 1180px every figure matches the draft but two, each off by one at layer 2
(the nights and activities on file had moved on). At 1600px two things appear:

- **Activities has 27 three-layer containers, the second-largest cluster after
  Sleep**, all under `section.panel > div.training-activities-detail`: 17 plain
  `div` tiles (14 of them drawn with an inset and nothing else), 7
  `button.activity-chart-chip`, a metric toggle, a chart segment and a button.
  The last ten are controls, which §4.6 exempts; the 17 tiles are not.
- Calendar's 18 layer-2 boxes are `div.calendar-day > button.calendar-chip` —
  marks inside a day cell rather than containers in any sense that matters here.

Dark reads one more layer-2 box on every screen than paper does: the sidebar's
collapse toggle (`div.app-sidebar-footer > button.app-sidebar-toggle`) paints a
surface in dark and none in paper. It is chrome, identical everywhere.

So depth is **not** the disease. The app is already at two layers nearly
everywhere. The disease is in how the layers are drawn — the same capture at
1180px, all eight screens, grouped by treatment (`rule-b` is a bottom-only
border, `rule-r` a right-only one):

```
layer 1                          layer 2
  48  rule-b (hairline)            46  bg + border + r12   <-- identical to layer 1
  34  rule-r (hairline)            16  bg + border + pill
  23  bg + border + r12             8  bg + border + r8
  16  bg + border + shadow + r12    3  bg + border + inset + r20
  12  bg + border + shadow + r20
   9  bg + border + pill
```

The draft listed those last three layer-2 boxes as `bg + border + shadow`. The
probe now tells an inset from a drop shadow, and all three are insets — a
border and an inset on one box is already in use, which is what Q1 has to rule
on.

`bg + border + 12px radius` is the most common treatment at **both** levels. A
card inside a card is drawn as the same card, so neither reads as a level. That
is the flatness, and no amount of colour work fixes it.

Two supporting counts:

- **185 rules declare a visible `border` *and* a `box-shadow`.** Two devices
  doing one job; the edge comes out smudged rather than sharper. Only 2 are
  `paper`-scoped, so 183 are shared by both themes.
  (`src/styles.css` 110, `watchfaces.css` 34, `trainingLibrary.css` 18,
  `activityGlobe.css` 9, `strength.css` 8.) Counting `border-color` and
  `border-width` touch-ups as well the figure is 331, but those rules only
  re-tint an edge some other rule drew — **185 is the list to work through**.
- **432 `box-shadow` declarations, 289 distinct values; 303 of the uses are
  literals spelling 250 distinct shadows** — while four shadow tokens already
  exist, in both themes.

### 4.2 The mechanism must be tokens, not classes

This is the trap. The obvious move is a pair of utility classes, `.surface` and
`.well`. It does not work here:

```
791 rules define a box (background + border/shadow + radius)
  1 of them mentions .panel  — and that one IS the .panel rule
790 hand-roll their own box
```

`.panel` is the only shared box definition in the app (201 uses in JSX out of
~4509 `className` sites). New utility classes would apply to whatever you
personally converted and to nothing else.

At the token layer the migration is **a rule edit, not a JSX edit**, and the
tokens are already there:

```css
/* src/styles.css:26-29 (dark), 163-166 (paper) */
--shadow-soft  --shadow-card  --shadow-elevated  --shadow-inset
--glass-bg-elevated   /* L1 surface: white on paper */
--glass-bg            /* L2 wash: grey on paper, a white lift in dark */
--glass-border
/* src/styles.css:57-62 */
--radius-xs:3  --radius-sm:8  --radius-md:12  --radius-lg:20  --radius-xl:28  --radius-pill:999
```

So this is not "design a scale". It is "make the 250 literals spend the scale
that exists" — the same shape of job as the radius work in `bb53bc8`.

### 4.3 The ladder

One device per level, and the devices must differ:

| Level | What it is | Surface | Edge | Radius |
|---|---|---|---|---|
| L0 | the page | `--bg-base` | none — whitespace | — |
| L1 | a card on the canvas | `--glass-bg-elevated` | **shadow** (`--shadow-card`) | `--radius-lg` — *pending Q2* |
| L2 | a row or group inside a card | `--glass-bg` | **recess** (`--shadow-inset`) — *pending Q1* | `--radius-md` — *pending Q2* |
| L3 | — | forbidden: eyebrow + hairline + whitespace | | |
| overlay | modal, popover, menu | `--glass-bg-elevated` | `--shadow-elevated` | `--radius-lg` |

**Never both a border and a shadow on the same element.** That is what the 185
sites violate, and it is statically checkable — but as first written, the draft
broke it three times itself, so what it means has to be settled before a test
can hold anyone to it (**Q1**):

- §4.4's own L1 recipe is `border: 1px solid var(--surface-line)` *plus*
  `box-shadow: var(--shadow-card)`. In dark both paint; to a static check it is
  the violation, verbatim.
- §4.4 then keeps the border on an inset-only L2 rule. An inset is a
  `box-shadow`, so that is a border and a shadow too.
- The table's L2 "recess" is not one. `--shadow-inset` is
  `inset 0 1px 0 rgba(19, 26, 40, 0.05)` in paper — a 1px line at 5% — and in
  dark it is `var(--glass-inset)`, `inset 0 1px 0 rgba(255, 255, 255, 0.08)`, a
  top *highlight*, which reads as a raised lip: the opposite of a recess. On
  its own, neither gives an L2 an edge anyone can see.

Two numbers the table leaves out are **Q2**: `.panel`, the one shared box, is
`--radius-md` today ([styles.css:3355](../src/styles.css#L3355)), not
`--radius-lg`, and it is on about two hundred `className`s. Moving L1 to 20px
is a visible change on every screen at once, and the draft does not mention it.

### 4.4 How the two themes stay different without two rule sets

Dark should keep its instrument-panel character — on a near-black ground a drop
shadow is invisible and a lit border is the only edge that reads. Paper should
lose its borders on L1 and float on shadow, which is what a printed card does.

One token carries the whole difference — defined **in paper only**, and read
with a fallback:

```css
.card { border: 1px solid var(--surface-line, var(--glass-border)); box-shadow: var(--shadow-card); }

:root[data-theme="paper"] { --surface-line: transparent; }  /* paper: edge is the shadow */
/* dark defines nothing, so the fallback applies: the edge is the border */
```

The draft defined `:root { --surface-line: var(--glass-border) }` for dark, and
that is not the same thing. A custom property holding `var()` is resolved where
it is declared, so dark would get the *root* `--glass-border` everywhere — and
Training Library redefines `--glass-border` for its own subtree, in dark and in
paper ([trainingLibrary.css:84](../src/training-library/trainingLibrary.css#L84),
[:141](../src/training-library/trainingLibrary.css#L141)), which has 18 of the
rules this section rewrites. The fallback in `var(a, b)` is resolved where it is
*used*, so it follows that override. Same trap as §3's ring.

Do **not** repoint `--glass-border` itself — it is also the hairline on inputs,
separators and L2 wells, which paper still needs. Introduce `--surface-line` as
a new token and migrate only the L1 rules onto it.

**The token does not reach a rule that paper overrides by name.** 107
paper-scoped rules set `border`, `border-color` or `border-width`, and 48 of
them also carry a shadow. Each outranks the shared rule, so its colour wins over
a transparent `--surface-line` — `.panel` is one of them
([styles.css:25073](../src/styles.css#L25073) sets `border-color:
rgba(19, 26, 40, 0.15)` beside `box-shadow: var(--shadow-card)`). Converting an
L1 rule therefore means deleting its paper `border-color` in the same edit, or
paper keeps the border and nothing looks different. `measure-ui.mjs` prints both
counts under §3/§4.4.

Deciding which of the 183 shared rules is L1: a rule carrying a **drop** shadow
(`--shadow-card`, `--shadow-soft`, `--glass-shadow`, or an outer literal) is L1
— point its border at `--surface-line`. A rule carrying only an **inset** is L2
— keep its border, drop nothing. A rule carrying both a border and an outer
literal shadow is the one that needs a judgement; default to L1.

### 4.5 Enforce it statically, not in a renderer

An earlier draft of this plan proposed `test:depth-budget`, mounting each screen
in an Electron window and walking the DOM. Do not build that yet.
[scripts/test-sleep-renderer.mjs](../scripts/test-sleep-renderer.mjs) is the
model for that kind of test and it hand-builds its own night fixtures; mounting
Overview would need most of the app's state. The static half catches most of it
for a twentieth of the work.

Add `scripts/test-elevation.mjs` (+ `test:elevation` in package.json), asserting
over `src/**/*.css`:

1. No rule declares a visible `border` *and* a non-`none` `box-shadow` — in
   the reading Q1 settles. The recommendation: the ban is on a visible border
   with an **outer** shadow; a border spelled `var(--surface-line, …)` is the
   L1 recipe, not a violation; an inset is not an edge device.
   Starting violations: **185 rules**.
2. Every `box-shadow` value is a `--shadow-*` token, `var(--focus-ring)`, a
   comma-list of those, or `none`. Starting violations: **303 declarations**
   spelling 250 distinct shadows. Not all of them are elevation, and a token
   list cannot absorb the rest without inventing tokens named after one site:
   the recovery ring's glow (`0 0 28px 8px var(--ring-glow)`), 1px selection
   rings drawn with a spread (`0 0 0 1px color-mix(…)` on `.vo2-plateau`),
   the watch-face editor's canvas chrome. Rule 2 therefore keeps **its own**
   allowlist, grouped by that reason, separate from rule 1's. No step in §8
   before the last spends it down.
3. A rule that sets `--shadow-inset` does not also set an outer shadow. Under
   the Q1 recommendation L2 carries no shadow at all and this rule is moot;
   `.panel`'s `var(--glass-shadow), var(--glass-inset)` is an outer shadow with
   a top highlight, which is L1.

**Rule 2 was narrowed in phase 7c, and that is a decision** (taken 2026-09-17).
As written it asked every `box-shadow` to be a token, and the survey above
already knew that could not hold: of the 348 left after phase 7b, **157 were
not elevation at all** — 53 rings (`0 0 0 1px`, an edge drawn as a shadow), 30
glows carrying a datum's colour, 74 insets that are a 1px highlight, a gridline
between cells or a 3px marker bar. Forcing those into four elevation tokens
would have invented tokens named after one site, which §4.5 set out to avoid;
listing them forever would have made the allowlist a heap rather than a to-do.
So the rule now reads: **every layer that lifts spends a token**, and a
`box-shadow` drawing one of the other four devices is judged by the rule that
owns it — the hairline, or colour-is-data. `layerKind` in the test draws the
line and its sizes are the decision:

| Kind | What it is | Sizes |
|---|---|---|
| hairline | a line drawn inside the box: a top highlight, a gridline, a marker bar | any inset with no blur, or a blurred pixel at the edge |
| ring | an edge drawn as a shadow | no offset, no blur, spread ≤ 8px |
| glow | colour bleeding out of the box | no offset, some blur |
| tint | a lift painted in a **named signal colour** — accent, sport, sleep stage, tone, success, error | any outer layer whose colour comes from one of those custom properties |
| lift | the crisp edge under a control, below the ladder's smallest step | offset < 3px, blur < 5px, spread ≤ 1px |
| elevation / inner | anything further, in either direction | must spend `--shadow-soft`, `--shadow-card`, `--shadow-elevated` or `--shadow-inset` |

`tint` is the one to revisit first if this reads wrong: it keeps the accent glow
under a primary button, the Coach's send button and the sleep stage chips, which
a neutral token would have flattened (55 sites). Elevation is spelled in ink; a
neutral shadow behind a name (`--panel-floor`, `--bg-base`) is still elevation
and still spends a token.

*As built* (`scripts/test-elevation.mjs`, allowlist in
`scripts/elevation-allowlist.json`): under the Q1 reading rule 1 starts at
**109** rules, not 185 — the other 76 pair a border with an inset highlight, or
name a token that resolves to nothing (`--wf-shadow-soft` was used twice in
`watchfaces.css` and defined nowhere, so both declarations computed to `none` —
taking the watch preview's intended hairline with them; fixed in the review
pass).
Rule 2 starts at **378** declarations: 154 elevation, 73 inset, 60 ring, 33
glow, and 58 that spend a token outside the set — mostly `--glass-shadow` and
`--glass-inset`, which is what `.panel` itself spends. Rule 3 was not built.

**The allowlists are keyed by file and selector, and a stale entry fails the
test.** A selector alone is ambiguous — the same one recurs inside a media
query and under a theme scope. And an allowlist that merely tolerates its
entries only records what was once wrong: nothing stops a converted rule from
staying listed, or a new violation from reusing a listed selector's slot. "The
count can only fall" is true only if an entry that no longer violates is itself
an error.

Follow the conventions of the existing tests: `node:assert/strict`, a header
comment that says what the test is *for* and what it caught, one npm script,
plain `node` (no TypeScript, so no Amaro problem — see §7).

### 4.6 Do Sleep first

Not Overview. Sleep has 29 three-layer containers, all one kind of mistake:
`section.panel > div.sleep-details-list > button.sleep-night-row`, which is 29
boxes stacked inside a list inside a panel. A 29-row list does not need 29
boxes — hairline between rows, surface only on hover and selection. It is the
largest single cluster and the most visible improvement, so it is the honest
test of whether the ladder is right before it spreads.

Then, in order:

- **Overview (6)** — `section.training-intelligence` is a frame wrapping panels
  that are already framed. Strip its surface, keep it as a bare grid container
  (`background: none; border: none; padding: 0`). Its panels become L1 and the
  tiles inside them L2. That alone returns the screen to two layers.
- **Settings (4)** — `sync-backend-switch` and `settings-segment-option` are
  **controls**, not containers. Controls have their own language (segmented,
  switch) and should be exempted from the ladder, not forced into L2.
- **Activities (27, at 1600px only)** — missing from the draft because its table
  was taken below the split breakpoint (§4.1). Ten of the 27 are controls under
  the rule just stated. The 17 tiles inside `training-activities-detail` were
  described here as Overview's shape — a pane that is itself a surface, holding
  tiles that are surfaces — and that is wrong: the pane draws only a
  `border-left`, a divider, and the probe counted it as a layer (§7, `layers`
  and `boxes`). The tiles are L2 on the split panel; what they needed was the
  L2 recipe, not a level removed. Check it at both widths.

**Acceptance.** `npm run test:elevation` passes with an empty allowlist for the
converted files. `probe-ui-cdp.mjs capture` on the change, then `compare`
against the baseline (§7): Sleep reports no container at depth 3 in either
theme, and no `+ deep` chain appears anywhere. The count 29 is data — the nights
in the list on the day it was taken — so check it against the baseline, not
against this document. Look at the screenshots in both themes; dark must not
change on the screens you touched unless you intended it to.

*As built* (phase 5, 2026-09-17 — **approved on review** the same day):

- **The token is inert until a scope sets it.** `.panel` reads
  `border: 1px solid var(--surface-line, var(--glass-border))`, and the paper
  override that outranks it reads `border-color: var(--surface-line, rgba(19,
  26, 40, 0.15))` rather than losing its colour. Only
  `:root[data-theme="paper"] .sleep-details-view` sets `--surface-line:
  transparent` (in `sleep.css`), so no other screen changes: over `compare`'s
  treatments and chains, Sleep differs and the other seven screens are
  identical, in both themes, at 1600 and 1180. Spreading the ladder is moving
  that declaration to paper's `:root` and deleting the fallback colour.
- **L1**, paper: `bg + border + shadow + r12` became `bg + shadow + r12` on both
  Sleep panels, and the HRV panel became `bg + shadow + r20`. Dark L1 is
  unchanged.
- **L2**: `.sleep-detail-metric` spends `--glass-bg`, `--glass-border` and
  `--radius-sm`. **This changes dark too**, on purpose: the wash goes from 3%
  ink to `rgba(255,255,255,0.06)` and the hairline from 9% ink to 0.12 white.
  `.sleep-curve.is-empty` (the no-samples placeholder) moved to `--radius-sm`.
- **The nights**: no surface at rest; a hairline on `li + li` (8% ink, the
  column divider's colour), which carries no padding and so is no container;
  `--glass-bg` under the pointer; selection keeps its sleep-hue tint at 8px.
  The hairlines either side of a drawn row step aside (`:has()`), so none cuts
  across a rounded corner.
- **Depth 3: 29 → 1, not 0** — and 0 in `boxes`, the count added in phase 6
  for exactly this. The one left is the selected row. The list
  column's divider is a `border-right` on a padded box, so the probe counts
  the column as a layer and any surface inside it lands at depth 3. This
  section prescribes a surface for the selection *and* no container at depth
  3; with the divider where it is, both cannot hold. The selection was kept.
  Moving the divider to a pseudo-element would satisfy the count and change
  nothing anyone sees, which is the wrong reason to do it.
- `test:elevation`: `.panel` left rule 1's list (109 → 108). `sleep.css` had
  no entries to begin with. The Tab walk over Sleep in both themes finds a ring
  on 13 of 14 stops; the refresh button draws the browser's own outline, as it
  did before.
- **Left for later**, being shared with Overview: `.sleep-metric-note` (the
  tile's hover note, an overlay still on literals) and `.training-chart-panel`'s
  20px radius, which makes the HRV panel the one card on the screen not at 12px.
  Phase 6 took the radius; the note is an overlay, which phase 6 did not touch.

*As built* (phase 6, 2026-09-17 — **awaiting review**):

- **The scope is one list.** `--surface-line: transparent` moved out of
  `sleep.css` into `styles.css`, beside the paper `.panel` rule, on
  `:is(.sleep-details-view, .training-dashboard, .settings-view:not(.settings-subpage))`.
  `.training-dashboard` is the root of both Overview and Activities and of
  nothing else. Settings' subpages (MCP servers, Coach models, Storage) stay
  out: their rows are still drawn at 12px, and a borderless card round them is
  a half-converted screen.
- **Overview.** `.training-intelligence` is a heading over a grid: no border,
  radius, padding or background, in either theme, and its paper card rule is
  gone. The nested-panel rule it was part of is now `.panel .panel` only, and
  the paper rule that recessed the recovery and weekly-activity panels is
  deleted, so the three panels are L1 cards like the rest of the screen. In
  dark they keep their matte finish. Every L1 card on the screen is at
  `--radius-md` — the recovery, weekly-activity and sleep panels, Upcoming
  Workouts, both zone-distribution panels and both trend charts were at 20px
  (the zone panels have no padding, so the probe never saw them; a scan for
  any painted box over 14px found them). The four weekly tiles are L2
  (`--glass-bg`, `--glass-border`, `--radius-sm`, no shadow), and **no longer
  lift under the pointer**: they are figures, not controls, and a lift with
  the shadow gone was a tile moving for no reason. The heatmap's day cards and
  today's workout card are L2 at 8px, the latter without the accent glow that
  floated it off its panel (its top highlight now spends `--shadow-inset`).
- **Settings.** The appearance panel came to 12px and the rows
  (`.settings-nav-row`, `.settings-startup-row`) to 8px; they already spent the
  L2 tokens. The three boxes left at depth 3 are the controls §4.6 exempts.
- **Activities.** The four totals sit on the page, so they are L1: a
  `var(--surface-line, var(--ax-edge))` border and `--shadow-card`. The detail
  pane's headline tiles and figure grid are L2 on `--glass-bg` at 8px — on
  paper `--ax-raised` is white, which drew them as white cards on the white
  card. `.activity-chart-segment` came to 8px; it is shared with Running,
  where it is not on screen at rest.
- **Measured** at 1600 and 1180, both themes, against a capture taken in the
  same sitting: Overview's depth 3 is 6 → 0 in `layers` and 5 → 0 in `boxes`;
  Sleep, Settings and Activities have no box at depth 3 other than Settings'
  three controls; no clip or spill appeared. On paper every L1 card on the four
  screens is `bg + shadow + r12`. Running, Strength, Coach and Calendar are
  unchanged in every treatment (a Calendar dark box at r18 was a transient
  present only in the *before* capture, whose layer count is one above every
  other capture of that screen). `test:elevation`: 108 → 107 rules with a border
  and an outer shadow, 372 → 368 shadows outside the tokens.
- **Not done here**, and on purpose: overlays (`.sleep-metric-note`, the mix
  bar's tooltip) and rule 2's inset highlights, which §8 leaves to phase 7; the
  strength body figure's panel on Overview, which belongs to the Strength
  screen; and the Personal screen's VO2max card, which shares the matte rule
  and keeps its 20px through its own rule until that screen is taken.

### 4.7 The rest of the app (phase 7)

*As built, 7a and 7b* (2026-09-17 — **awaiting review**). Two batches, because
the first changes how a box is drawn and the second changes what paper looks
like everywhere at once.

**7a — the radius ladder.** Every card that sits on the page came to
`--radius-md` and every box inside one to `--radius-sm`, on the ten screens the
ladder had not reached (Running, Strength, Calendar, Coach, Training Library,
Personal, Coros Overview, Media, Maps, Data). Controls kept their own shapes.
Strength's seven cards are one line, `--sx-radius`. Running's totals and hero
cards stopped being wells and became L1 cards: the screen gained the paper
surface tokens its siblings already had — a raised face is white there — and
the tiles spend `--shadow-card` with a `--surface-line` border. The selected
Strength session row dropped its lift, because an L2 row carries no shadow.

**7b — one edge device, everywhere.** `--surface-line: transparent` moved to
paper's `:root`, so the `:is()` list of converted screens is gone; the paper
`.panel` rule reads the token **without a fallback**, which is what puts it
over the cards that give themselves a border colour of their own (the chart
panels, the sleep summary, Upcoming Workouts). Deleting that line instead was
tried first and put the border back on six cards — the probe caught it.
Then every remaining rule that drew a visible border *and* an outer shadow was
taken by hand, in four groups:

- **Overlays** (43: menus, popovers, modals, dialogs, tooltips, toasts, the
  route drawer, the globe's floating panels) spell their border
  `var(--surface-line, …)`: on paper an overlay floats on its shadow alone,
  in dark it keeps the lit edge that is the only one that reads there.
- **Cards** (39) the same way, the app rail among them.
- **Artwork and marks** (15: album art, playlist thumbs, the podcast cover, the
  VO2max icon, a legend swatch, the calendar's row thumbnail) keep their
  hairline and lose the drop shadow. A picture is not a card: it sits in the
  card that already carries the elevation.
- **Illustrations** (6) are `exempt` in the allowlist, with the reason written
  out: a watch face preview's 9px bezel and its strap ring, the recovery ring's
  halo, the Gear screen's sign-in light. An exempt entry is counted nowhere and
  must still apply — one matching no violating rule fails the test, so a
  converted rule cannot leave a claim behind. The three checks (an invented
  key, an empty reason, an exemption withdrawn) were each injected and each
  failed as it should.

The sidebar's active mark and the Coach's active conversation row share
`--sidebar-indicator-shadow`; it lost its outer glow and keeps its top
highlight, which is the L2 reading of a selected row.

**Rule 1 is now held across the app: 0 rules draw a visible border and an outer
shadow**, from 185 measured in §4.1 and 109 when the test was written.

*As built, 7c* (2026-09-17 — **awaiting review**). Rule 2 was narrowed to what
lifts (the table above), and everything that lifts now spends a token, so
**both lists are empty and only the six `exempt` decisions remain**:

- 89 declarations were rewritten by blur: ≥ 44px → `--shadow-elevated`,
  ≥ 26px → `--shadow-card`, below that → `--shadow-soft`. Several rules had two
  lifting layers (`0 18px 40px …, 0 2px 8px …`) and now spend one token.
- Feature tokens that resolved to a lift were repointed rather than their call
  sites rewritten: `--wf-shadow`, `--map-card-shadow`, `--map-panel-shadow` and
  `--sidebar-glass-shadow` keep their insets and spend a token for the outer
  part. `var(--glass-shadow)` at a call site became `var(--shadow-card)` — the
  same value in dark, and the card token is what a card spends.
- **Training Library's tiles stopped floating.** `.tl-card` and the catalog
  tiles are boxes inside a panel, so they carry no shadow at rest and their
  hover, active and selected states are drawn in colour — the edge ring and
  wash they already had. Five `--tl-shadow-*` tokens went with them, and
  `.plan-week` lost its plate the same way.
- The globe card came to the card radius, which 7a had missed because *Where
  you've been* was not in that batch.

The test's own checks were re-proven: a literal drop shadow, a token outside
the set and a deep inset each fail; a ring, a glow, a 1px highlight, a tinted
lift, a 1–2px edge and the four tokens each pass.

Measured before and after in the same sitting, 1600 and 1180, all fourteen
screens (the eight the probe lists by default plus Training Library, Personal,
Coros Overview, Media, Maps and Data under their own label): no clip or spill
anywhere, no container count changed, and in paper every card on every screen
reads `bg + shadow`. Dark changed in one place, the active conversation row's
glow, and that was the intention.

**Risk, and it is real.** Removing the border from L1 in paper is the first
change on this branch that alters `paper`'s appearance in a way a person will
notice immediately, and §4.4 also touches dark. Neither is a bug, but neither
was true of `97fb0d1` — that commit was provably dark-neutral. Do not claim this
one is.

---

## 5. Composition — the part that is a decision, not a task

Nothing measured so far touches layout, and layout is where "simple, refined,
elegant" mostly lives. The blind spot, measured:

```
grid-template-columns: 543 uses, 216 distinct patterns
max-width:             245 uses, 170 distinct values
reading measure:       19 different `ch` values, from 24ch to 80ch
.content:              padding: 0 28px 28px   — and NO max-width at all
```

216 column patterns means every screen reinvents its own structure. And with no
`max-width` on the content column, a 27" display stretches every line of text
and every table to the full width of the window. For an app whose whole job is
reading numbers and prose, that is a bigger loss of composure than any token in
this document.

Four things would change the app's face. All are aesthetic decisions and none
should be started without agreeing the direction first:

1. **A measure and a page grid.** Cap `.content` and give the app one column
   system instead of 216.
2. **Light as a printed page.** Wide margins, a hairline under a heading instead
   of a frame around a block, accent used as a printer's second ink — sparingly,
   and always for a reason. §4.4 is the first step of this whether or not the
   rest is taken.
3. **One serif level, for screen titles only.** Everything else stays Inter.
   `--font-display` is currently Space Grotesk for both display type and
   figures, which reads as generic geometric sans. One serif at one level gives
   the app a face without adding noise.
4. **Density.** How many panels of equal weight sit side by side on a screen,
   and which of them deserves to be larger than the others.

Two smaller ones, already half-solved and worth folding into whichever of the
above gets done:

- **Eyebrows: the count, not the style.** 148 `text-transform: uppercase`, and
  after `bb53bc8` they are consistent (117 at 10–11px, tracking 0.06em/0.1em).
  But 104 of them are weight **700**, which at 10px is shouting, and 148
  eyebrows is too many eyebrows — capitals stop marking anything once every
  label is capitalised. Proposed rule: 600 not 700, and **one eyebrow per
  panel**; a panel's own title is not an eyebrow.
- **Figures.** The app is called *Records* and `tabular-nums` is already on 172
  sites, so the groundwork exists but there is no single treatment. One
  `.figure`: value at 28px or 36px, weight 500, `-0.02em`, tabular; unit at
  `0.6em` in `--text-muted`; a delta coloured only from `--success-text` /
  `--error-text`.

---

## 6. Explicitly not now

**A 4-point spacing grid.** This was in an earlier draft and it is withdrawn;
the measurement does not support it.

```
4562 uses, 68 values.  top-16 = 91.2%
7px(235) 9px(174) 5px(179) 3px(181) 11px(111) — ~880 uses sit off a 4-grid
tail beyond top-16: 52 values / 400 uses — but the tail is 24, 28, 32, 40, 48,
64, 80, 96 … which are ALREADY on a 4-grid and are legitimate section-level steps
```

There is no cheap safe subset. The tail, which looked like the obvious harmless
first pass, turns out to be mostly correct already; the chaos is concentrated in
the 1–20px range that accounts for 91% of all use. Imposing a grid there moves
~1400 declarations by 1–2px each, which on a 32px control is 6% of its height
and across a 29-row list is the rhythm of the whole column. That is a visible,
eyes-on migration with a modest payoff. Either commit to it as a design pass
with screenshots at every step, or leave it. Do not do it "while you are in
there".

**`test:depth-budget` as a renderer test.** See §4.5.

**`z-index`.** 213 uses, 36 values, up to 1300. This is a correctness hazard —
popovers, modals, tooltips, drawers and map controls stack in an order nobody
declared — but it is a separate concern from the design language and it should
be fixed when it bites, with a named layer scale.

**Breakpoints.** 76 media queries over 29 px values, including the pairs
759/760, 899/900 and 1179/1199/1200. Housekeeping. Fold into §5.1 if a page grid
ever happens.

---

## 7. Environment and verification

**Running the app to look at it.** No screenshot tool works on this machine's
GNOME Wayland session; CDP is the only way.

```sh
npm run build
env -u ELECTRON_RUN_AS_NODE -u VITE_DEV_SERVER_URL \
  ./node_modules/electron/dist/electron --ozone-platform=x11 --remote-debugging-port=9222 .
```

**`--ozone-platform=x11` is what makes this dependable.** Under native Wayland a
window that is not on screen gets no frame callbacks from the compositor, so
every `Page.captureScreenshot` waits for a frame that never comes and times out
— the baseline for this document was taken while the window happened to be
visible, and the first capture after it hung on its first screen. Under
XWayland the same capture returns in ~50ms whatever the window's state. The
two render identically for these purposes: a capture of `main` under each,
compared with `probe-ui-cdp.mjs compare`, differed in nothing.

Launch it as a *background task*, never with a trailing `&` — an orphaned
Electron holds the single-instance lock and the next launch then exits 0
immediately. **Kill the process group, not the PID:** killing only the main
process leaves its zygote, GPU and renderer children running, and their
`--user-data-dir=…/heracles-records` arguments then look exactly like a running
installed app to anything that checks for one. Start it under `setsid` and
`kill -- -<pid>`. An unfocused window
gets no frames, so `requestAnimationFrame` never runs: take three or four
throwaway `Page.captureScreenshot` calls to force frames before the real one,
and read `getComputedStyle` *before* capturing, since the capture itself forces
the frame that finishes the animation you were trying to catch.

**A packaged Heracles Records that is open blocks all of this.** The AppImage
is named `heracles-records` like the tree, so both use
`<appData>/heracles-records` and the same single-instance lock: while the
installed app is running, `npx electron .` exits 0 at once, prints nothing, and
CDP on 9222 never answers. Check with `pgrep -af heracles-records` and close it
from its own window — it is someone's live session, not a stray process.

**Tests.** There is no linter and no test runner; `npm run build` is the only
typecheck, and CI runs no tests at all. `/usr/bin/node` on this machine is
v22.22.1 built without Amaro, so any test launched by plain
`node --experimental-strip-types` fails with `ERR_NO_TYPESCRIPT`; route those
through `cross-env ELECTRON_RUN_AS_NODE=1 electron` instead and say so in the
test header. New tests here are plain `.mjs` over `.css` text, so none of that
applies to them.

Must pass before and after every step:

```sh
npm run build
npm run test:design-vocabulary
npm run test:base-layers
npm run test:activities-renderer
npm run test:sleep-renderer

# test:sport-colors is wired to plain `node --experimental-strip-types`, so on
# this machine `npm run test:sport-colors` dies with ERR_NO_TYPESCRIPT. Electron
# ships a Node that has Amaro, so run it through that — an environment limit,
# not a failing test. KEEP ELECTRON_RUN_AS_NODE=1: dropping it (`env -u ...`,
# which is right for launching the GUI) makes Electron open a window and hang.
ELECTRON_RUN_AS_NODE=1 npx electron --experimental-strip-types \
  scripts/test-sport-colors.mjs
```

Note that `npm run <test> 2>&1 | tail` reports **tail's** exit code, not the
test's. Check the last line of output, or drop the pipe.

**Re-taking the measurements.** What only a rendered screen can say — container
depth, how each layer is drawn, what clips or spills — comes from
[scripts/probe-ui-cdp.mjs](../scripts/probe-ui-cdp.mjs), with the app launched
as above:

```sh
node scripts/probe-ui-cdp.mjs capture --label <name>     # 8 screens × dark, paper
node scripts/probe-ui-cdp.mjs compare .work/ui-probe/baseline-main/probe.json \
                                      .work/ui-probe/<name>/probe.json
```

`capture` writes `probe.json` and a screenshot per screen and theme into
`.work/ui-probe/<name>/`, which is git-ignored because the screenshots are the
athlete's own data. `compare` exits 2 when a box clips or spills that did not
in the baseline. Its header says what it measures; four properties matter here:

- **It never changes a setting.** `coros-theme` is a `preference`-tier key, so
  switching theme the app's way — or with `localStorage.setItem` and a reload,
  as an earlier throwaway probe for this document did — changes the theme on
  every other machine on the vault. The probe flips `data-theme` on `<html>`
  and restores it. The cost is that React-painted colour (maps, globe, chart
  palettes) stays in the stored theme; the JSON records which.
- **It freezes motion while it measures**, so a transition the theme flip
  started cannot leave `getComputedStyle` reporting the previous theme in a
  window that gets no frames.
- **Its container definition is the one the §4.1 table was first taken with**,
  so the numbers are comparable — but pass the window size you mean. The
  default is 1600×980; the draft's table was taken at the window's own
  ~1180px, and Activities is a different screen on either side of 1200px.
- **It reports depth twice: `layers` and `boxes`.** `layers` is the §4.1
  count, and it counts a divider as a layer: a pane with a one-sided rule
  (`border-right` on Sleep's list column, `border-left` on Activities' detail
  pane) is a container, so everything inside it reads one level deeper than
  anything beside it. That is how Sleep's selected night and Activities' 17
  detail tiles came out at depth 3 on a card with nothing between them and it.
  `boxes` (added in phase 6) counts only a container that draws a box — a
  background, a four-sided border or a shadow — and walks past rules. **Read
  `boxes` for the ladder**; `layers` stays so older captures still compare, and
  a capture older than the count prints `n/a`.

The baselines for this branch are `.work/ui-probe/baseline-main/` (1600×980,
with screenshots) and `.work/ui-probe/baseline-main-1180/` (1180×695, JSON
only), both taken on 2026-09-17 on a tree whose `src/` is identical to `main` at
`4af6310`, with the §7 suite passing. Take a capture before and
after each step in the same sitting where you can: the data under the screens
moves day to day (a new night adds a Sleep row), and `compare` reports chain
counts, which move with it.

Static counts — **every other figure quoted in this document** comes from one
script:

```sh
node scripts/measure-ui.mjs
```

It asserts nothing and is wired to no npm script; it just prints the numbers,
grouped by the section of this file that cites them. Run it before starting and
after each step. Do not re-derive these with ad-hoc `grep`: grep counts matching
*lines* where this counts *occurrences*, and a multi-line `transition` or
`box-shadow` value silently breaks a line-oriented pattern. An earlier draft of
this document shipped three such one-liners and all three disagreed with the
figures they were supposed to confirm.

**Two invariants that will bite silently.** `THEME_WINDOW_BACKGROUND` in
[src/theme/theme.ts](../src/theme/theme.ts) must stay equal to `--bg-base`, and
it is a flat string written on a theme change but not on an accent change.
Paper accents are mirrored in
[src/theme/accentPalette.ts](../src/theme/accentPalette.ts) for the globe and
the charts, which cannot read a custom property — change both together.

---

## 8. Order of work

One commit per phase, on `redesign_ui_language`. The suite in §7 runs before and
after each, `test:elevation` joining it from phase 3.

| # | Item | § | Effort | Blocked on | Needs an aesthetic call |
|---|---|---|---|---|---|
| 0 | ~~Corrections to this document, `probe-ui-cdp.mjs`, baseline on `main`~~ — done 2026-09-17 | 7 | S | — | no |
| 1 | ~~`line-height` into the vocabulary test~~ — done 2026-09-17 | 1 | S | — | no |
| 2 | ~~Motion: one curve, three durations~~ — done 2026-09-17 | 2 | S | — | no |
| 3 | ~~`test:elevation` (static, keyed allowlists)~~ — done 2026-09-17 | 4.5 | S | — | no |
| 4 | ~~One focus ring~~ — done 2026-09-17, as an outline (§3) | 3 | S | — | no |
| 5 | ~~Elevation ladder on **Sleep**~~ — done and approved 2026-09-17 (§4.6) | 4 | M | — (Q1, Q2 decided) | yes — **stop for review** before spreading |
| 6 | Ladder on Overview, Settings, then Activities — built 2026-09-17, **awaiting review** (§4.6) | 4.6 | M | 5 approved | yes |
| 7 | Ladder on the rest: `watchfaces.css` (34), `trainingLibrary.css` (18), `activityGlobe.css` (9), `strength.css` (8), the remainder of `styles.css`; then rule 2's allowlisted shadows (372 after phase 4) — **7a and 7b built 2026-09-17** (§4.7); rule 2 is what is left | 4 | L | 6 | yes, per file |
| 8 | Composition | 5 | L | **decide first** | yes |

The focus ring moved behind the elevation test: §3 composes its ring with
elevation shadows, and the draft both told you to do §4 first and listed it
after. Phases 1–4 barely change what a screenshot shows — motion changes how
the app *feels*, not how it looks — so they are a natural point to merge into
`main` before the ladder starts. Phase 7 was missing from the draft: it named
the 185 and the 303 and scheduled three screens. Phase 8 is where the app gets a
face, and nothing in 1–7 substitutes for it.

---

## 9. Decisions this document cannot make

Each blocked the phases listed against it in §8. **All four were taken as
recommended on 2026-09-17**, "for now" — they are the positions the work was
built on, and reopening one means revisiting the phases listed against it.

| | Question | Decision |
|---|---|---|
| **Q1** | What does "one device per level" forbid? (§4.3) | A visible border **with an outer shadow**. A border spelled `var(--surface-line, …)` is the L1 recipe, not a violation. An inset is not an edge device. L2 is a `--glass-bg` wash with a `--glass-border` hairline and no shadow — which makes §4.5's rule 3 moot. |
| **Q2** | What radius is L1? (§4.3) | Keep `--radius-md` (12px), which is what `.panel` is today, and put L2 on `--radius-sm` (8px) so an inner corner sits inside the outer. Moving L1 to 20px changes every screen's silhouette at once; it belongs to §5, where silhouette is the subject. |
| **Q3** | Where do the 37 durations outside both bands go? (§2) | 100ms → `--dur-fast`; 250–280ms → `--dur-base`; 350–500ms (Strength's springs) and 750–850ms (staggered reveals) stay literal, each with a comment, on a written exception list. *As built:* the three 280ms drawers (`.chat-sidebar-shell`, `.chat-sidebar.is-overlay`, `.route-drawer`) took `--dur-slow` instead, which is what that token is defined for; the list is `DESIGNED_LENGTHS` in `test-design-vocabulary.mjs`, 22 entries. |
| **Q4** | Do motion and focus get a test? (§2, §3) | Yes — extend `test:design-vocabulary`: a `transition` spends `var(--dur-*)` and `var(--ease)` or is on the exception list; a `:focus-visible` rule spends `var(--focus-ring)` or is on the exception list. The type scale is enforced because intention did not hold it; nothing about a curve is different. |
