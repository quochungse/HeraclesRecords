// What a link may hand to the operating system, and how to name where it goes.
//
// Shared by the main process, which is the one place a URL reaches
// `shell.openExternal`, and the renderer, which draws a Coach answer's links
// with their destination beside them. It must stay free of `node:` imports for
// that reason, like `activityMetrics.ts`.
//
// The renderer is loaded from `file://` in a packaged build, so a relative link
// in an answer — `[Open plan](/C:/Windows/System32/calc.exe)` — resolves to a
// `file://` URL, and the OS opens whatever that names. An answer can carry text
// a third-party tool result put there, so the scheme is checked here rather
// than trusted to whoever wrote the link.

/** Schemes the OS may be asked to open. Everything else is refused. */
const OPENABLE_SCHEMES = new Set(["https:", "http:", "mailto:"]);

/** The URL, parsed, when it is one the OS may open; null otherwise. */
export function openableExternalUrl(value: string | undefined | null): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return OPENABLE_SCHEMES.has(url.protocol) ? url : null;
  } catch {
    // Relative, or not a URL at all: nothing the OS should be handed.
    return null;
  }
}

/**
 * Where a link goes, as a reader would name it: the host without `www.`, or
 * the address of a `mailto:`. Null for anything that cannot be opened.
 */
export function linkDestination(value: string | undefined | null): string | null {
  const url = openableExternalUrl(value);
  if (!url) return null;
  if (url.protocol === "mailto:") return url.pathname || null;
  return url.hostname.replace(/^www\./i, "") || null;
}
