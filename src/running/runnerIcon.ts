import { createLucideIcon } from "lucide-react";

/**
 * The Running destination's icon.
 *
 * Lucide has no running figure: of its 5948 icons only `PersonStanding` and
 * `Accessibility` draw a person and both are standing, so this is artwork of
 * our own refitted to lucide's 24x24 grid. It is built through lucide's own
 * `createLucideIcon`, which makes it a real `LucideIcon` — the nav tree types
 * its icons as one, and this slots in beside `Activity` and `Dumbbell` with no
 * cast and no extra dependency.
 *
 * Two things about it differ from every other icon in the sidebar, and both are
 * deliberate:
 *
 * The figure is **filled, not stroked**. Its outline is one even-odd path whose
 * holes are the hollows inside the limbs, so `strokeWidth` means nothing here —
 * that is why the path states its own `fill` and `stroke` instead of inheriting
 * the root's `fill="none" stroke="currentColor"`. Colour still follows
 * `currentColor`, so the active and inactive nav states work unchanged.
 *
 * It is scaled to the **22x22 optical box** lucide's own icons sit in rather
 * than the full 24, so it reads at the same weight as its neighbours; fitted to
 * the full grid it looked a size larger than everything around it.
 *
 * The `key` in the attributes is not decoration. Lucide's `Icon` renders the
 * node list as `iconNode.map(([tag, attrs]) => createElement(tag, attrs))`, an
 * array it gives no key of its own, so every icon it ships carries one inside
 * its attributes. Leaving it out made React warn "Each child in a list should
 * have a unique key" on every screen of the app, blaming a `ForwardRef` it
 * could not name — the sidebar holds this icon mounted the whole time.
 */
export const RunnerIcon = createLucideIcon("runner", [
  [
    "path",
    {
      d: "M7.69 14.25L7.43 14.52L6.37 16.77L2.66 20.08L2.13 20.75L1.99 21.81L2.39 22.6L3.05 23L4.51 22.87L8.22 19.82L9.42 18.63L10.61 16.9L9.68 16.51L7.83 18.76L4.11 21.81L3.58 22.07L3.05 21.67L3.05 21.28L7.03 17.7L8.22 15.31ZM9.15 4.71L8.62 4.98L5.44 7.89L5.17 8.42L5.17 9.35L5.31 9.75L5.7 10.14L6.23 10.41L7.16 10.41L7.83 10.01L9.81 8.16L10.74 8.29L10.87 8.55L8.62 12L8.49 13.86L9.02 14.92L9.68 15.45L13.13 16.9L12.99 17.57L12.6 17.96L11.4 19.95L11.4 20.61L11.93 21.54L12.33 21.81L13.26 21.94L13.92 21.67L14.58 21.01L14.72 20.61L17.23 17.3L17.5 16.51L17.23 15.18L16.44 14.39L14.05 13.06L13.79 12.8L13.79 12.53L14.72 11.2L15.25 10.81L16.84 12.13L17.23 12.27L18.56 12.13L21.74 9.22L22.01 8.55L22.01 8.02L21.48 7.1L20.95 6.83L20.02 6.83L19.49 7.1L17.77 8.55L15.51 6.57L15.25 6.17L14.05 5.51L13.52 5.51L12.99 5.24L10.61 4.71ZM20.95 8.16L20.95 8.55L18.03 11.2L17.1 11.07L15.78 9.88L16.17 8.82L16.44 8.82L17.37 9.75L17.9 9.88L20.15 7.89L20.68 7.89ZM9.68 5.64L10.21 5.64L13.92 6.57L14.98 7.49L15.11 7.89L15.11 8.69L12.46 12.66L12.46 13.19L13.26 13.86L13.52 13.86L15.91 15.31L16.44 15.84L16.44 16.51L13.52 20.61L13.13 20.88L12.86 20.88L12.46 20.48L12.46 20.08L14.45 17.17L14.58 16.51L14.05 16.11L10.34 14.65L9.68 13.99L9.42 13.46L9.42 12.8L9.81 12L12.2 8.42L12.07 7.63L10.08 6.96L9.68 6.96L6.9 9.35L6.5 9.35L6.23 9.08L6.23 8.69L9.15 5.9ZM15.38 1.27L14.58 2.06L14.32 2.59L14.32 3.92L14.58 4.58L15.25 5.24L15.78 5.51L17.5 5.37L18.43 4.58L18.69 3.92L18.69 2.59L18.56 2.33L17.5 1.27L16.57 1Z",
      fill: "currentColor",
      fillRule: "evenodd",
      stroke: "none",
      key: "runner-figure"
    }
  ]
]);
