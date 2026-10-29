# Renderer: conventions and the design system

## Structure

- `src/App.tsx` holds view routing and most cross-cutting state; `src/navigation/primaryNav.ts`
  defines `PrimaryView` (its `developmentOnly` and `beta` flags still work; nothing sets them).
- Heavy screens are lazy (Training Hub, Library, Running, Cycling, Hiking, Strength,
  Calendar, Coach, Where you've been, Hall of Records); Overview and Settings are in the main
  bundle. **Calendar and Training Library are `preloadableLazy`** — fetched once the first
  paint is idle, and before that their Suspense fallback is the screen's own skeleton
  (`CalendarSkeleton`, `TrainingLibrarySkeleton`), never the generic spinner. That is why
  `trainingLibrary.css` is imported by `main.tsx`.
- A link to a session carries the session, not just the screen: `openActivityFrom` /
  `SportScreenRequest` in `App.tsx`, held until the lazy screen mounts. Every door to a
  sport screen goes through `openSportScreen`, which refuses a screen hidden in Settings →
  Navigation (`sportScreens.ts`, the *hidden* list is what is stored); `sportScreenFor` is
  the one sport-code → screen answer.
- Settings → About: Website, Report an issue (`ReportIssueDialog`), Buy me a coffee; no
  platform versions, no Licenses button (its IPC is gone).

## Feedback

**Toasts** (`src/toast.ts`, drawn by `Toaster`): the bottom stack answers what the athlete
just did, the top stack is the app speaking unasked. Kinds are `info`, `warning`, `error`
(no `success`). A screen with an input at its foot marks it `data-toast-floor`. The same
sentence again restarts its toast instead of stacking a copy.

**Escape closes a dialog or popup; the mouse's back button goes back a screen.** A
full-page view is not left with Escape.

## Choosing between options: `OptionGroup`

`src/components/OptionGroup.tsx` is the one way to offer a choice, and
`npm run test:option-groups` closes it (named exemptions only, each a grid, a card set,
a list of records or a menu). Modes: `expanded` (default), `collapsible` (shows the chosen
chip, opens in place) and `dropdown` (through `SelectDropdown`). Multi-select is
`OptionChips` (`appearance="tiles"` for a short set switched once). `fill` splits a form
row equally. Rules that are easy to break:
- A collapsible group is **one row holding every option once**, clipped by the group's
  measured width (`--og-folded`, `--og-open`, `--og-shift`, measured in a layout effect with
  no dependency list because callers rebuild `options` every render). Never render a second
  copy of the chosen chip. The reveal fade is scoped `button:not([aria-checked="true"])`.
- There is **no automatic fallback** from `expanded` to `collapsible` — it oscillates. A
  screen that cannot spare the width says `mode="collapsible"`.
- Escape is caught in the **capture phase** (a group can sit in a dialog closing on
  Escape from its own listener).
- The chosen chip is an accent **wash** with the accent's ink; the collapsed lead chip's
  rule needs `.option-group .option-group-trigger` to outrank `.option-group button`.
- Period labels come from `src/preferences/periodScale.ts`, never the screen.
- A dropdown opens at the size of its content between the trigger's width and the window;
  options with a `detail` cap at the floor and wrap. Its height is capped by the window only,
  never a measured `scrollHeight` (that flickered at fractional zoom). Its ground is
  `--menu-surface`.
  `.app-select-trigger` states `font-size` *after* `font: inherit`.
- Selection preferences persist under `heraclesrecords.selection.v1`; a test that needs a
  clean state clears every key there, not the bare preference name.

## CSS

Plain CSS with custom properties — no Tailwind, no CSS modules. `src/styles.css` holds the
tokens and most rules; feature stylesheets sit beside their components and **load after it**.
Themes are `dark` | `paper` (`src/theme/`); `THEME_WINDOW_BACKGROUND` must stay in sync with
`--bg-base`. Sport colours live in `styles.css` and `src/training/sportColors.ts` (the source
of truth; `test:sport-colors`). Every paper rule is scoped `:root[data-theme="paper"]`.

**CSS is global.** A class can collide with another screen's; a feature stylesheet must not
restate type for whole element types — `.view :is(button, input) { font: inherit }` has the
specificity of `.option-group button`, loads later and resets every component's size. Use
`:where(.view)` for such a reset.

**The design vocabulary is a closed set**, held by `npm run test:design-vocabulary`
(exceptions listed in its header — adding a value means editing that file):
- weights 400/500/600/700; sizes 10/11/12/13/14/18/22/28/32/36px plus two `em` steps;
  tracking `-0.02em`/`0`/`0.06em`/`0.1em`; leading `1`/`1.2`/`1.3`/`1.45`/`1.6`; six radius
  tokens. A box matching a neighbour's height says so with a height, not an inflated leading.
- Fonts ship in `src/assets/fonts` (latin, latin-ext, cyrillic, vietnamese) via
  `src/fonts.css`. `--font-title` (Source Serif 4) is a screen's own title only, weight 600,
  leading 1.3. Figures: display face, 500, `-0.02em`, tabular. Code and ids: `--font-mono`.
  A title or figure rule restating `font-family`/`font-weight` locally overrides the shared
  rule.
- **Motion:** a `transition` spends `var(--ease)` and `--dur-fast` (state) / `--dur-base`
  (moves or resizes) / `--dur-slow` (drawers). A designed length stays literal only as an
  entry in `DESIGNED_LENGTHS`. An invalid `transition` with `var()` is dropped silently at
  computed-value time — check in a renderer.
- **One scrollbar**: the bare `::-webkit-scrollbar` block near the top of `styles.css`.
  Any `scrollbar-color` or `scrollbar-width` other than `none` hands the element back the
  platform bar. The screenshot harness hides all bars, so check scrollbars in a real window.
- **Focus** is one ring: `outline: var(--focus-ring)` at `outline-offset: 2px` (`-2px` when
  clipped), in a rule whose subject is the focused element alone. `--focus-ring` is declared
  on `:focus-visible` (it holds `var()`); a feature with its own signal sets
  `--focus-ring-color`. Never a box-shadow ring — a more specific shadow erases it.

**`var(--x)` must name a declared token** (`npm run test:css-tokens`, no allowlist): an
undeclared one voids the whole declaration (a background stack goes transparent, a border
disappears), and a fallback does not excuse it. Every declared token must be read.

**Elevation is one device per level** (`npm run test:elevation`, allowlist
`scripts/elevation-allowlist.json` empty): a card floats on an outer shadow, a well sits in a
hairline, nothing draws a visible border *and* an outer shadow, and every lifting layer
spends `--shadow-soft|card|elevated|inset`. A border spelled `var(--surface-line, …)` is the
card recipe (transparent on paper). Ladder in [docs/ui-system-refinement.md](../docs/ui-system-refinement.md) §4.

**Colour is data; chrome is the neutral surface plus one accent.** Hue belongs to sport,
sleep stage, zone, load band, the strength heatmap, a provider's brand and
`--success-*`/`--warning-*`/`--error-*` (the only way a semantic colour follows the theme).
Intensity is the effort ramp `--intensity-easy|moderate|hard` on `:root`.

**Paper is a grey canvas with white surfaces.** `--glass-bg` is a grey wash there (spent on
controls on white cards); a surface that must be white asks for `--glass-bg-elevated`;
`.panel` inside `.panel` recesses. `--bg-base` carries no accent hue (window chrome is painted
from a flat `THEME_WINDOW_BACKGROUND`). Paper accents are measured for WCAG AA against
`--bg-base` and mirrored in `src/theme/accentPalette.ts` for WebGL and charts — change both.
**On paper the accent is a colour for words**: a chosen thing is lifted or edged, never
washed (a wash reads as a beige stain); what is filled takes `--hall-gold*`; gold artwork
drawn for black stands on a black plaque. Paper's rail is a white sheet whose title bar
follows through `--app-rail-width` (written by `AppSidebar`); Coach on paper is a white
frame with white cards on the canvas.

`.content` caps the measure at 1440px through its own padding, so the scrollbar stays at the
window edge.

## The primary rail

`PRIMARY_NAV_SECTIONS` is four standing headings (Today, Plan, History, Your journey) — labels,
not disclosures. Personal and Settings sit in the identity row at the rail's foot
(`PRIMARY_NAV_ACCOUNT_ITEMS`, COROS nickname and avatar from the cached profile); both carry
`data-nav-label`, which `probe-ui-cdp.mjs` navigates by. The rail draws one hairline
(`--sidebar-divider`, not `--surface-line`, which is transparent on paper), marks the active
row with a 2×14px bar (the indicator spans the row so it can slide), and fades its cut edges
from a measured scroll (`has-fade-top`/`has-fade-bottom`) instead of a scrollbar. The
collapse toggle shows on hover **or** focus. The narrow-window drawer is the one place the
rail takes a fill and `--shadow-elevated`.
