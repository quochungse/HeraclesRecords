import {
  DEFAULT_LOCALE,
  LOCALE_DETAILS,
  isLocale,
  resolveIntlLocale,
  type Locale,
} from "./locales.ts";
import en from "./messages/en/index.ts";

/**
 * The runtime behind every translated word. React-free, so a pure module (a
 * greeting, a formatter) can translate with `t` and a suite can drive it; the
 * hook in `useI18n.tsx` is how a component subscribes to a change.
 *
 * Messages are flat: one key, one string, the key naming the screen first
 * (`settings.language.title`). English is bundled with the app and every other
 * language is a chunk of its own, loaded before the first paint
 * (`initLocale`) or when the athlete switches (`setLocale`).
 *
 * A message may hold:
 *   {name}          a value handed in `vars`
 *   key_one/_other  plural forms, picked by `plural()` through Intl.PluralRules
 *   <b>…</b>        a span the caller draws (`rich()` in useI18n.tsx); any
 *                   lower-case tag name, never nested
 */

export type Messages = typeof en;
export type MessageKey = keyof Messages;
/** A key whose forms are `<key>_one`, `<key>_other`, … — what `plural` takes. */
export type PluralKey = {
  [K in MessageKey]: K extends `${infer Base}_other` ? Base : never;
}[MessageKey];
export type MessageVars = Record<string, string | number>;

type Dictionary = Record<string, string>;

/** A preference: it follows the athlete to their other computer through sync. */
export const LOCALE_STORAGE_KEY = "heraclesrecords.language";

const LOADERS: Record<Exclude<Locale, "en">, () => Promise<{ default: Dictionary }>> = {
  vi: () => import("./messages/vi/index.ts"),
  ja: () => import("./messages/ja/index.ts"),
  ko: () => import("./messages/ko/index.ts"),
  zh: () => import("./messages/zh/index.ts"),
  es: () => import("./messages/es/index.ts"),
  fr: () => import("./messages/fr/index.ts"),
  de: () => import("./messages/de/index.ts"),
};

const loaded = new Map<Locale, Dictionary>([["en", en]]);
const listeners = new Set<() => void>();

let current: Locale = DEFAULT_LOCALE;
let dictionary: Dictionary = en;
let intl = resolveIntlLocale(DEFAULT_LOCALE, systemLanguages());
let pluralRules = new Intl.PluralRules(intl);
let numberFormat = new Intl.NumberFormat(intl);

function systemLanguages(): readonly string[] {
  return typeof navigator === "undefined" ? [] : (navigator.languages ?? []);
}

export function getLocale(): Locale {
  return current;
}

/** The `Intl` locale every date, number and weekday on screen is written in. */
export function getIntlLocale(): string {
  return intl;
}

export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function loadDictionary(locale: Locale): Promise<Dictionary> {
  const cached = loaded.get(locale);
  if (cached) {
    return cached;
  }
  const module = await LOADERS[locale as Exclude<Locale, "en">]();
  loaded.set(locale, module.default);
  return module.default;
}

function apply(locale: Locale, messages: Dictionary): void {
  current = locale;
  dictionary = messages;
  intl = resolveIntlLocale(locale, systemLanguages());
  pluralRules = new Intl.PluralRules(intl);
  numberFormat = new Intl.NumberFormat(intl);
  if (typeof document !== "undefined") {
    document.documentElement.lang = LOCALE_DETAILS[locale].htmlLang;
  }
  for (const listener of listeners) {
    listener();
  }
}

export function readStoredLocale(): Locale {
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (isLocale(stored)) {
      return stored;
    }
  } catch {
    // Storage unavailable: the default stands.
  }
  return DEFAULT_LOCALE;
}

function storeLocale(locale: Locale): void {
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // The choice holds for this session even when it cannot be kept.
  }
}

/**
 * Before the first paint: the stored language, loaded. A chunk that will not
 * load leaves the app in English rather than not starting.
 */
export async function initLocale(): Promise<void> {
  const locale = readStoredLocale();
  try {
    apply(locale, await loadDictionary(locale));
  } catch {
    apply(DEFAULT_LOCALE, en);
  }
}

/** The athlete's pick in Settings. Resolves once the screen can redraw in it. */
export async function setLocale(locale: Locale): Promise<void> {
  const messages = await loadDictionary(locale);
  storeLocale(locale);
  apply(locale, messages);
}

/** For a suite: switch without storage, with the dictionary handed in or loaded. */
export async function switchLocaleForTest(locale: Locale): Promise<void> {
  apply(locale, await loadDictionary(locale));
}

function lookup(key: string): string {
  return dictionary[key] ?? (en as Dictionary)[key] ?? key;
}

export function interpolate(message: string, vars?: MessageVars): string {
  if (!vars) {
    return message;
  }
  return message.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}

/** A message, with `{name}` filled from `vars`. */
export function t(key: MessageKey, vars?: MessageVars): string {
  return interpolate(lookup(key), vars);
}

/**
 * The form of `key` this language uses for `count`, with `{count}` written in
 * the language's own digits and separators. A language without a form for that
 * category (Vietnamese, Japanese, Korean and Chinese have only `other`) takes
 * `_other`.
 */
export function plural(key: PluralKey, count: number, vars?: MessageVars): string {
  const category = pluralRules.select(count);
  const message =
    dictionary[`${key}_${category}`] ??
    dictionary[`${key}_other`] ??
    (en as Dictionary)[`${key}_${new Intl.PluralRules("en").select(count)}`] ??
    (en as Dictionary)[`${key}_other`] ??
    key;
  return interpolate(message, { count: numberFormat.format(count), ...vars });
}

/** The English text of a key, for what must not change with the language. */
export function english(key: MessageKey): string {
  return (en as Dictionary)[key] ?? key;
}
