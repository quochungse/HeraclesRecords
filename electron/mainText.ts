/**
 * The main process's own text in the language on screen. The renderer says
 * what that is through `app:setLanguage` — on start-up and on every switch —
 * and until it has, everything here is English.
 *
 * Main process only: it holds every language's catalog, which the renderer
 * loads one at a time as its `main` namespace instead. See `screenText.ts`
 * for which text comes through here and which does not.
 */
import {
  SCREEN_TEXT_EN,
  interpolateScreen,
  screenKeyOf,
  type ScreenKey,
  type ScreenPluralKey,
  type ScreenVars
} from "./screenText";
import de from "./i18n/de";
import es from "./i18n/es";
import fr from "./i18n/fr";
import id from "./i18n/id";
import it from "./i18n/it";
import ja from "./i18n/ja";
import ko from "./i18n/ko";
import pt from "./i18n/pt";
import ru from "./i18n/ru";
import th from "./i18n/th";
import vi from "./i18n/vi";
import zh from "./i18n/zh";

const CATALOGS: Record<string, Record<string, string | undefined>> = {
  en: SCREEN_TEXT_EN,
  vi,
  ja,
  ko,
  zh,
  es,
  pt,
  fr,
  de,
  it,
  ru,
  id,
  th
};

/** The `Intl` locale a language's plurals and digits follow, as the renderer's `locales.ts` has it. */
const INTL: Record<string, string> = { zh: "zh-CN", pt: "pt-BR" };

let locale = "en";
let plurals = new Intl.PluralRules("en");
let numbers = new Intl.NumberFormat("en");

export function setMainLocale(next: unknown): void {
  locale = typeof next === "string" && next in CATALOGS ? next : "en";
  const intl = INTL[locale] ?? locale;
  plurals = new Intl.PluralRules(intl);
  numbers = new Intl.NumberFormat(intl);
}

export function getMainLocale(): string {
  return locale;
}

function lookup(key: string): string | undefined {
  return CATALOGS[locale]?.[key] ?? (SCREEN_TEXT_EN as Record<string, string>)[key];
}

/** Like the renderer's `plural`: the form this language uses, `{count}` in its digits. */
function translate(key: string, vars?: ScreenVars, count?: number): string {
  if (count === undefined) return interpolateScreen(lookup(key) ?? key, vars);
  const message =
    lookup(`${key}_${plurals.select(count)}`) ?? lookup(`${key}_other`) ?? key;
  return interpolateScreen(message, { count: numbers.format(count), ...vars });
}

export function mainText(key: ScreenKey, vars?: ScreenVars): string {
  return translate(key, vars);
}

export function mainPlural(key: ScreenPluralKey, count: number, vars?: ScreenVars): string {
  return translate(key, vars, count);
}

/**
 * What crosses IPC in place of an error the athlete reads: the same failure,
 * in their language. Anything else goes through as it was thrown.
 */
export function localizeScreenError(error: unknown): unknown {
  const screen = screenKeyOf(error);
  if (!screen) return error;
  return new Error(translate(screen.key, screen.vars, screen.count));
}

/**
 * An error's message for a status the renderer draws — a connection test, a
 * server's last failure — rather than throws: a `ScreenError` in the athlete's
 * language, anything else as it was thrown. Never for text that is stored or
 * handed to a model, which stays English.
 */
export function screenMessage(error: unknown, fallback: string): string {
  const screen = screenKeyOf(error);
  if (screen) return translate(screen.key, screen.vars, screen.count);
  return error instanceof Error ? error.message : fallback;
}
