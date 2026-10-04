import {
  Fragment,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  getIntlLocale,
  getLocale,
  plural,
  subscribeLocale,
  t,
  type MessageKey,
  type MessageVars,
  type PluralKey,
} from "./core.ts";
import type { Locale } from "./locales.ts";

export type RichTags = Record<string, (chunk: ReactNode) => ReactNode>;

export interface I18n {
  locale: Locale;
  /** For `Intl` and `toLocale*String`: the language picked, never the system's. */
  intl: string;
  t: typeof t;
  plural: typeof plural;
  /** A message with spans the caller draws: `<b>3 tools</b> ready` → <strong>. */
  rich: (key: MessageKey, tags: RichTags, vars?: MessageVars) => ReactNode;
  /** `rich` for a plural message. */
  richPlural: (key: PluralKey, count: number, tags: RichTags, vars?: MessageVars) => ReactNode;
}

const TAG = /<([a-z]+)>([\s\S]*?)<\/\1>/g;

/** Splits a finished message on its tags; text outside them is left as it is. */
export function renderRich(message: string, tags: RichTags): ReactNode {
  const parts: ReactNode[] = [];
  let last = 0;
  let index = 0;
  for (const match of message.matchAll(TAG)) {
    const [whole, name, chunk] = match;
    const start = match.index ?? 0;
    if (start > last) {
      parts.push(message.slice(last, start));
    }
    const draw = tags[name];
    parts.push(
      <Fragment key={index++}>{draw ? draw(chunk) : chunk}</Fragment>,
    );
    last = start + whole.length;
  }
  if (last < message.length) {
    parts.push(message.slice(last));
  }
  return parts.length === 1 ? parts[0] : <>{parts}</>;
}

/**
 * The language on screen, and the functions that write in it. A component
 * that shows translated words calls this — even when the words come from a
 * helper that uses `t` directly — because subscribing is what redraws it when
 * the athlete switches; a memoised component that only calls the helper would
 * keep the old language until something else redrew it.
 */
export function useI18n(): I18n {
  const locale = useSyncExternalStore(subscribeLocale, getLocale, getLocale);
  return useMemo<I18n>(
    () => ({
      locale,
      intl: getIntlLocale(),
      t,
      plural,
      rich: (key, tags, vars) => renderRich(t(key, vars), tags),
      richPlural: (key, count, tags, vars) =>
        renderRich(plural(key, count, vars), tags),
    }),
    [locale],
  );
}
