/**
 * The languages the app is written in, and what each one needs from the
 * platform. Node-free and asset-free so a suite can import it; the flags are
 * `flags.ts`, which a bundler has to resolve.
 *
 * English is the source every other language is translated from and the one
 * the app opens in until the athlete picks another — whatever the operating
 * system is set to. A missing translation falls back to it, string by string.
 */
export const LOCALES = [
  "en",
  "vi",
  "ja",
  "ko",
  "zh",
  "es",
  "pt",
  "fr",
  "de",
  "it",
  "ru",
  "id",
  "th",
] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

export interface LocaleDetail {
  /** The language's name in itself: what the athlete looks for in the list. */
  nativeName: string;
  /** Its name in English, for a tooltip and for anyone who cannot read the first. */
  englishName: string;
  /**
   * `<html lang>`. Chromium picks its fallback font per script from this, so
   * Chinese is `zh-CN`: Han characters set under a Japanese `lang` are drawn
   * with Japanese glyph shapes, and the UI is Simplified Chinese.
   */
  htmlLang: string;
  /**
   * The region `Intl` falls back to when the system names none for this
   * language — dates, numbers and weekday names follow the language picked,
   * not the operating system's.
   */
  defaultIntl: string;
}

export const LOCALE_DETAILS: Record<Locale, LocaleDetail> = {
  en: { nativeName: "English", englishName: "English", htmlLang: "en", defaultIntl: "en-US" },
  vi: { nativeName: "Tiếng Việt", englishName: "Vietnamese", htmlLang: "vi", defaultIntl: "vi-VN" },
  ja: { nativeName: "日本語", englishName: "Japanese", htmlLang: "ja", defaultIntl: "ja-JP" },
  ko: { nativeName: "한국어", englishName: "Korean", htmlLang: "ko", defaultIntl: "ko-KR" },
  zh: { nativeName: "简体中文", englishName: "Chinese (Simplified)", htmlLang: "zh-CN", defaultIntl: "zh-CN" },
  es: { nativeName: "Español", englishName: "Spanish", htmlLang: "es", defaultIntl: "es-ES" },
  pt: { nativeName: "Português (Brasil)", englishName: "Portuguese (Brazil)", htmlLang: "pt-BR", defaultIntl: "pt-BR" },
  fr: { nativeName: "Français", englishName: "French", htmlLang: "fr", defaultIntl: "fr-FR" },
  de: { nativeName: "Deutsch", englishName: "German", htmlLang: "de", defaultIntl: "de-DE" },
  it: { nativeName: "Italiano", englishName: "Italian", htmlLang: "it", defaultIntl: "it-IT" },
  ru: { nativeName: "Русский", englishName: "Russian", htmlLang: "ru", defaultIntl: "ru-RU" },
  id: { nativeName: "Bahasa Indonesia", englishName: "Indonesian", htmlLang: "id", defaultIntl: "id-ID" },
  th: { nativeName: "ไทย", englishName: "Thai", htmlLang: "th", defaultIntl: "th-TH" },
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/**
 * The `Intl` locale for a language: the system's own regional variant of it
 * when it has one — an Australian in English keeps day-month order, a Swiss
 * reader in German keeps their separators — and the language's usual region
 * otherwise. Chinese takes only a Simplified variant, since that is what the
 * words around the date are written in.
 */
export function resolveIntlLocale(
  locale: Locale,
  preferred: readonly string[] = [],
): string {
  for (const tag of preferred) {
    const [language, ...rest] = tag.split("-");
    if (language?.toLowerCase() !== locale || rest.length === 0) {
      continue;
    }
    if (locale === "zh" && !/^(CN|SG|Hans)/i.test(rest.join("-"))) {
      continue;
    }
    if (locale === "pt" && !/^BR/i.test(rest.join("-"))) {
      continue;
    }
    try {
      return Intl.getCanonicalLocales(tag)[0] ?? LOCALE_DETAILS[locale].defaultIntl;
    } catch {
      // A malformed tag from the platform; keep looking.
    }
  }
  return LOCALE_DETAILS[locale].defaultIntl;
}
