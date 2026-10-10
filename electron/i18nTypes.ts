/**
 * The shape a language's namespace must have: every key English has, as a
 * string — and, for a key with plural forms (`x_one`, `x_other`), room for the
 * forms English never needs. Russian counts 1, 2–4 and 5+ differently
 * (`_one`, `_few`, `_many`); English has only `_one` and `_other`, so those
 * extra keys are optional to the type and required by test:i18n, which asks
 * each language's own plural rules which forms it uses.
 *
 * Here rather than in `src/i18n` because the main process's own text
 * (`screenText.ts`, `i18n/<locale>.ts`) is typed by it too, and the main
 * process cannot import from `src`. `src/i18n/types.ts` re-exports it.
 */
type PluralBase<T> = {
  [K in keyof T]: K extends `${infer Base}_other` ? Base : never;
}[keyof T];

type ExtraPluralForms<T> = `${PluralBase<T> & string}_${"zero" | "two" | "few" | "many"}`;

export type Translation<T> = { [K in keyof T]: string } & {
  [K in ExtraPluralForms<T>]?: string;
};
