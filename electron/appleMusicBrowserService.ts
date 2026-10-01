// Embedded Apple Music sign-in. Instead of asking the user to copy request
// headers out of DevTools (see appleMusicService.ts), we host music.apple.com
// in its own Electron session and watch its network traffic. Every request the
// web player makes to the internal "amp-api" carries the three things we need —
// the developer token (`Authorization: Bearer …`), the per-account
// `media-user-token`, and the session `Cookie` — so once the user signs in and
// their library loads we can lift the credentials automatically.

import { app, session, type WebContents } from "electron";

export const APPLE_MUSIC_PARTITION = "persist:heraclesrecords-apple";

// amp-api is served from a few hostnames (amp-api, amp-api-edge, …); a
// subdomain wildcard matches them all. Chromium match patterns only allow `*`
// as a whole host label, so "amp-api*.music.apple.com" is rejected — we match
// every music.apple.com subdomain and rely on the Authorization check below to
// ignore non-API requests.
const AMP_API_URL_FILTER = { urls: ["https://*.music.apple.com/*"] };

/** Header names, lower-cased, that we lift from an amp-api request. */
interface CapturedAppleMusicHeaders {
  authorization?: string;
  "media-user-token"?: string;
  cookie?: string;
}

type AppleMusicHeaderListener = (headers: CapturedAppleMusicHeaders) => void;

function buildChromeUserAgent(): string {
  const chromeVersion = process.versions.chrome;
  const platform =
    process.platform === "darwin"
      ? "Macintosh; Intel Mac OS X 10_15_7"
      : process.platform === "win32"
        ? "Windows NT 10.0; Win64; x64"
        : "X11; Linux x86_64";

  return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
}

function appleMusicSession(): Electron.Session {
  return session.fromPartition(APPLE_MUSIC_PARTITION);
}

function isAppleMusicWebContents(contents: WebContents): boolean {
  return contents.session === appleMusicSession();
}

export function configureAppleMusicBrowserSession(): void {
  const appleSession = appleMusicSession();
  // Apple's web player is picky about the user agent; present a plain Chrome
  // string so it does not fall back to an unsupported-browser page.
  appleSession.setUserAgent(buildChromeUserAgent());

  appleSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(["media", "fullscreen", "pointerLock"].includes(permission));
  });
}

/**
 * Watches the Apple Music session's amp-api traffic and reports the auth headers
 * from any request that carries a developer token. The listener fires often (on
 * essentially every API call); callers are expected to dedupe/merge.
 */
export function registerAppleMusicBrowserHandlers(
  onHeaders: AppleMusicHeaderListener
): void {
  const appleSession = appleMusicSession();

  appleSession.webRequest.onBeforeSendHeaders(
    AMP_API_URL_FILTER,
    (details, callback) => {
      // Only report requests that carry the per-account media-user-token; the
      // developer token alone (catalog browsing before sign-in) is not useful
      // and would fire on nearly every request.
      const captured = extractAuthHeaders(details.requestHeaders);
      if (captured.authorization && captured["media-user-token"]) {
        onHeaders(captured);
      }
      callback({ requestHeaders: details.requestHeaders });
    }
  );

  app.on("web-contents-created", (_event, contents) => {
    if (contents.getType() !== "webview" || !isAppleMusicWebContents(contents)) {
      return;
    }
    contents.setUserAgent(buildChromeUserAgent());
  });
}

/** Clears the signed-in Apple Music session (used by the "reset" action). */
export async function resetAppleMusicBrowserSession(): Promise<void> {
  const appleSession = appleMusicSession();
  await appleSession.clearCache();
  await appleSession.clearStorageData();
}

// Chromium preserves the original header casing, so match case-insensitively and
// only keep the three headers appleMusicService needs.
function extractAuthHeaders(
  requestHeaders: Record<string, string>
): CapturedAppleMusicHeaders {
  const captured: CapturedAppleMusicHeaders = {};

  for (const [name, value] of Object.entries(requestHeaders)) {
    if (!value) {
      continue;
    }
    switch (name.toLowerCase()) {
      case "authorization":
        captured.authorization = value;
        break;
      case "media-user-token":
        captured["media-user-token"] = value;
        break;
      case "cookie":
        captured.cookie = value;
        break;
      default:
        break;
    }
  }

  return captured;
}
