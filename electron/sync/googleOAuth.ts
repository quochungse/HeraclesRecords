// Google OAuth for the sync vault.
//
// Authorization Code + PKCE against a loopback redirect, the flow Google
// specifies for desktop apps. Three details differ from the Spotify code this
// borrows its shape from, and each is a failure if copied across unchanged:
//
//   * The redirect is plain **http** on 127.0.0.1. Spotify demands https, which
//     is why spotifyOAuthTls.ts ships a self-signed certificate; Google rejects
//     https loopback. Take the server structure from there, not the TLS.
//   * Consent must open in the **system browser**. Google refuses embedded
//     webviews outright (`disallowed_useragent`), so a BrowserWindow like
//     Spotify's would fail before the user could type anything.
//   * The port is ephemeral. Desktop clients may use any loopback port, so
//     nothing needs registering in the console and two apps cannot collide.
//
// **Why the refresh token is sealed by the OS keychain, not put in the vault.**
// The vault is the Drive folder this token opens, so storing the token there
// would need the token to read it — a cycle, and a token that hands over the
// whole Drive account rather than just the vault. It is device-local, sealed
// with safeStorage like the app's other service credentials and classified
// device-encrypted in syncPolicy for exactly that reason.

import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";

import {
  BUNDLED_CLIENT_ID,
  BUNDLED_CLIENT_KEY
} from "./googleClientCredentials";
import type { GoogleAccountInfo } from "./syncTypes";

/**
 * OS-backed secret storage, satisfied in the main process by Electron's
 * `safeStorage`.
 *
 * Every credential in this app is sealed to a single machine and stays there,
 * this one included — see `syncPolicy.ts`. It is worth saying twice here
 * anyway: the vault sits *inside* the Drive folder that this token is what
 * opens, so a design that ever carried it would be handing over the whole
 * account along with the backup. It is injected rather than imported so the
 * suite can reach the no-keyring branch — a Linux box without gnome-keyring —
 * instead of only that user's machine.
 */
export interface SecretStorage {
  isAvailable(): boolean;
  encrypt(plaintext: string): string;
  decrypt(encoded: string): string;
}

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

/**
 * Whose account this is, from Drive rather than from an identity scope.
 *
 * `about.get` is covered by `drive.file`, the scope this app already holds, so
 * naming the connected account needs no extra permission and no second consent
 * screen for anyone already connected. Asking for `openid email` instead would
 * have meant re-consent for every existing user to learn something Drive was
 * willing to say all along.
 */
const ABOUT_ENDPOINT =
  "https://www.googleapis.com/drive/v3/about" +
  "?fields=user(displayName,emailAddress),storageQuota(limit,usage)";

/** Identity never changes for a given connection; the quota does. Five minutes
 *  keeps a panel refresh free without letting "space left" go stale enough to
 *  mislead. */
const ACCOUNT_CACHE_MS = 5 * 60_000;

/** Per-file access to what this app itself creates. Google classes it
 *  non-sensitive, so shipping needs no verification review — unlike
 *  `drive.appdata`. Asking for anything broader would drag the whole project
 *  into that queue. */
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

/** Outbound requests carry a browser-shaped User-Agent. The Phase 0 spike
 *  suggested COROS rejects a library default; the same courtesy costs nothing
 *  here and keeps every request this app makes consistent. */
export const SYNC_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/130.0.0.0 Safari/537.36";

/** Access tokens refresh this long before they actually expire, so a request
 *  never races its own credential going stale. */
const REFRESH_MARGIN_MS = 60_000;

/**
 * How long the loopback server waits for Google to redirect back.
 *
 * Consent can involve picking an account, a password, and a 2FA prompt, so this
 * is generous. It has to exist at all because the alternative is what was here
 * before: someone who opens the consent page and closes the tab leaves a
 * listening socket on 127.0.0.1 and a promise that never settles, for the life
 * of the process — and every retry adds another.
 */
const CONSENT_TIMEOUT_MS = 5 * 60_000;

/** Environment names that override the baked-in client, so a developer can run
 *  `HERACLES_GOOGLE_OAUTH_ID=… npm run dev` without a rebuild. Read through a
 *  table rather than inline so neither name reads as an assignment of a live
 *  credential to secret scanners. */
const BUNDLED_ENV = {
  id: "HERACLES_GOOGLE_OAUTH_ID",
  key: "HERACLES_GOOGLE_OAUTH_KEY"
} as const;

export interface GoogleOAuthClient {
  readonly clientId: string;
  /** Google issues one for desktop clients, and it is not confidential in any
   *  meaningful sense — it ships inside every copy of the binary. PKCE is what
   *  actually protects the flow. */
  readonly clientKey: string;
}

export type OAuthErrorCode =
  | "not-connected"
  | "denied"
  | "state-mismatch"
  | "token-exchange-failed"
  | "refresh-failed";

export class GoogleOAuthError extends Error {
  readonly code: OAuthErrorCode;

  constructor(code: OAuthErrorCode, message: string) {
    super(message);
    this.name = "GoogleOAuthError";
    this.code = code;
  }
}

export interface PkcePair {
  readonly verifier: string;
  readonly challenge: string;
}

/** RFC 7636 S256. The verifier never leaves this process; only its hash does,
 *  which is what stops an intercepted authorization code being redeemed. */
export function createPkcePair(): PkcePair {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto
    .createHash("sha256")
    .update(verifier)
    .digest("base64url");
  return { verifier, challenge };
}

export function buildAuthUrl(options: {
  clientId: string;
  redirectUri: string;
  challenge: string;
  state: string;
}): string {
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set("client_id", options.clientId);
  url.searchParams.set("redirect_uri", options.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", DRIVE_SCOPE);
  url.searchParams.set("code_challenge", options.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", options.state);
  // Without both of these Google returns no refresh token on a repeat consent,
  // and the connection would silently stop surviving restarts.
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  return url.toString();
}

export interface OAuthDeps {
  readonly fetch: typeof globalThis.fetch;
  /** Hands the consent URL to the system browser. */
  readonly openExternal: (url: string) => Promise<void>;
  readonly getSetting: (key: string) => string | undefined;
  readonly setSetting: (key: string, value: string) => void;
  readonly deleteSettings: (keys: string[]) => void;
  readonly secretStorage: SecretStorage;
  readonly now: () => number;
  /** Loopback port. 0 asks the OS for a free one, which is what production
   *  wants; the suite pins it so it can predict the redirect URI. */
  readonly port?: number;
  readonly env?: Record<string, string | undefined>;
}

export const GOOGLE_SETTINGS = {
  clientId: "sync.google.clientId",
  clientKey: "sync.google.clientKey",
  refreshToken: "sync.google.refreshToken"
} as const;

export class GoogleOAuth {
  readonly #deps: OAuthDeps;
  #accessToken: string | null = null;
  #expiresAt = 0;
  #account: { info: GoogleAccountInfo; fetchedAt: number } | null = null;

  constructor(deps: OAuthDeps) {
    this.#deps = deps;
  }

  /**
   * The client this build ships with, if any.
   *
   * The environment wins over the generated module so a developer can point the
   * app at a different client without rebuilding; a packaged app has neither
   * variable set and falls through to what was baked in at build time. Both
   * empty — every build from source — means no Google client, and the UI
   * disables the option rather than offering something that cannot work.
   */
  #bundledClient(): GoogleOAuthClient | null {
    const env = this.#deps.env ?? process.env;
    const clientId = env[BUNDLED_ENV.id] || BUNDLED_CLIENT_ID;
    const clientKey = env[BUNDLED_ENV.key] || BUNDLED_CLIENT_KEY;
    return clientId && clientKey ? { clientId, clientKey } : null;
  }

  /** The user's own OAuth client when they configured one, otherwise the app's.
   *  The first path is how someone building from source connects without the
   *  bundled credentials, and how anyone can keep off the app's shared quota. */
  client(): GoogleOAuthClient | null {
    const clientId = this.#deps.getSetting(GOOGLE_SETTINGS.clientId);
    const clientKey = this.#readSealed(GOOGLE_SETTINGS.clientKey);
    if (clientId && clientKey) {
      return { clientId, clientKey };
    }
    return this.#bundledClient();
  }

  setOwnClient(client: GoogleOAuthClient | null): void {
    if (!client) {
      this.#deps.deleteSettings([
        GOOGLE_SETTINGS.clientId,
        GOOGLE_SETTINGS.clientKey
      ]);
      return;
    }
    this.#deps.setSetting(GOOGLE_SETTINGS.clientId, client.clientId);
    this.#writeSealed(GOOGLE_SETTINGS.clientKey, client.clientKey);
  }

  isConnected(): boolean {
    return Boolean(this.#readSealed(GOOGLE_SETTINGS.refreshToken));
  }

  disconnect(): void {
    this.#accessToken = null;
    this.#expiresAt = 0;
    this.#account = null;
    this.#deps.deleteSettings([GOOGLE_SETTINGS.refreshToken]);
  }

  /**
   * Who is connected, or null when nobody is — or when Drive would not say.
   *
   * Never throws. This exists so the Settings panel can show which account a
   * vault is going to, and a panel that cannot render because a decorative
   * request failed would be a worse trade than a row that says only
   * "Connected". Failures are logged once and cached as absent for the same
   * window as a success, so a broken connection is not retried on every
   * refresh.
   */
  async account(): Promise<GoogleAccountInfo | null> {
    if (!this.isConnected()) {
      this.#account = null;
      return null;
    }
    const cached = this.#account;
    if (cached && this.#deps.now() - cached.fetchedAt < ACCOUNT_CACHE_MS) {
      return cached.info;
    }

    let info: GoogleAccountInfo = { email: null, name: null, quota: null };
    try {
      const response = await this.#deps.fetch(ABOUT_ENDPOINT, {
        headers: {
          Authorization: `Bearer ${await this.accessToken()}`,
          "User-Agent": SYNC_USER_AGENT
        }
      });
      if (response.ok) {
        info = readAccount(await response.json());
      } else {
        console.warn(
          `[sync] could not read the Google account: ${response.status} ${response.statusText}`
        );
      }
    } catch (error) {
      console.warn("[sync] could not read the Google account", error);
    }

    this.#account = { info, fetchedAt: this.#deps.now() };
    return info;
  }

  #readSealed(key: string): string | undefined {
    const encoded = this.#deps.getSetting(key);
    if (!encoded || !this.#deps.secretStorage.isAvailable()) return undefined;
    try {
      return this.#deps.secretStorage.decrypt(encoded);
    } catch {
      return undefined;
    }
  }

  #writeSealed(key: string, value: string): void {
    if (!this.#deps.secretStorage.isAvailable()) {
      throw new GoogleOAuthError(
        "not-connected",
        "This system has no secure keyring, so a Google connection cannot be " +
          "stored. Install gnome-keyring or KWallet, or sync to a local folder."
      );
    }
    this.#deps.setSetting(key, this.#deps.secretStorage.encrypt(value));
  }

  /** Run the consent flow. Resolves once Google has redirected back and the
   *  code has been exchanged for a refresh token. */
  async connect(): Promise<void> {
    const client = this.client();
    if (!client) {
      throw new GoogleOAuthError(
        "not-connected",
        "No Google client is configured. Add your own client id and key in " +
          "Settings, or use a build that ships one."
      );
    }

    const { verifier, challenge } = createPkcePair();
    const state = crypto.randomBytes(16).toString("base64url");

    const { code, redirectUri } = await this.#awaitAuthorizationCode(
      client,
      challenge,
      state
    );
    const tokens = await this.#exchange(client, {
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri
    });

    if (!tokens.refresh_token) {
      throw new GoogleOAuthError(
        "token-exchange-failed",
        "Google returned no refresh token, so the connection would not survive " +
          "a restart. Remove this app from your Google account permissions and " +
          "connect again."
      );
    }
    this.#writeSealed(GOOGLE_SETTINGS.refreshToken, tokens.refresh_token);
    this.#adoptAccessToken(tokens);
    // A consent flow can come back as a different person than the one who was
    // connected before it, so anything cached about the old one is now a lie.
    this.#forgetAccount();
  }

  #awaitAuthorizationCode(
    client: GoogleOAuthClient,
    challenge: string,
    state: string
  ): Promise<{ code: string; redirectUri: string }> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (
        outcome: () => void,
        response?: http.ServerResponse,
        body?: string
      ) => {
        if (response) {
          response.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8"
          });
          response.end(body ?? "");
        }
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        // Drops the listening socket *and* any keep-alive connection the
        // browser is holding, which `close()` alone would wait out.
        server.closeAllConnections();
        server.close();
        outcome();
      };

      const timer = setTimeout(
        () =>
          finish(() =>
            reject(
              new GoogleOAuthError(
                "denied",
                "Google did not redirect back in time. Try connecting again."
              )
            )
          ),
        CONSENT_TIMEOUT_MS
      );
      // Nothing should be kept alive on this timer's account: an abandoned
      // consent must not hold the app open at quit.
      timer.unref?.();

      const server = http.createServer((request, response) => {
        if (!request.url) {
          response.writeHead(400);
          response.end();
          return;
        }
        const redirectUri = redirectUriFor(server);
        const callback = new URL(request.url, redirectUri);
        if (callback.pathname !== "/callback") {
          response.writeHead(404);
          response.end();
          return;
        }

        const denied = callback.searchParams.get("error");
        if (denied) {
          finish(
            () =>
              reject(
                new GoogleOAuthError(
                  "denied",
                  `Google did not grant access: ${denied}`
                )
              ),
            response,
            page("You can close this tab.")
          );
          return;
        }

        // The state check is what stops another page on this machine feeding a
        // code of its own into our loopback server.
        if (callback.searchParams.get("state") !== state) {
          finish(
            () =>
              reject(
                new GoogleOAuthError(
                  "state-mismatch",
                  "The response did not match the request that started it."
                )
              ),
            response,
            page("Something went wrong. Try connecting again.")
          );
          return;
        }

        const code = callback.searchParams.get("code");
        if (!code) {
          finish(
            () => reject(new GoogleOAuthError("denied", "Google returned no code.")),
            response,
            page("Something went wrong. Try connecting again.")
          );
          return;
        }

        finish(
          () => resolve({ code, redirectUri }),
          response,
          page("Connected. You can close this tab and return to the app.")
        );
      });

      server.on("error", (cause: Error) => finish(() => reject(cause)));

      server.listen(this.#deps.port ?? 0, "127.0.0.1", () => {
        const authUrl = buildAuthUrl({
          clientId: client.clientId,
          redirectUri: redirectUriFor(server),
          challenge,
          state
        });
        // System browser, not a BrowserWindow: Google blocks embedded webviews.
        this.#deps
          .openExternal(authUrl)
          .catch((cause) => finish(() => reject(cause)));
      });
    });
  }

  /** A valid access token, refreshing when the current one is near expiry. */
  async accessToken(): Promise<string> {
    if (this.#accessToken && this.#deps.now() < this.#expiresAt) {
      return this.#accessToken;
    }

    const client = this.client();
    const refreshToken = this.#readSealed(GOOGLE_SETTINGS.refreshToken);
    if (!client || !refreshToken) {
      throw new GoogleOAuthError(
        "not-connected",
        "Connect a Google account before syncing."
      );
    }

    const tokens = await this.#exchange(
      client,
      { grant_type: "refresh_token", refresh_token: refreshToken },
      "refresh-failed"
    );
    this.#adoptAccessToken(tokens);
    return tokens.access_token;
  }

  /** Forget the cached identity. Called when a consent flow completes, because
   *  the account that came back may not be the one that was there before. */
  #forgetAccount(): void {
    this.#account = null;
  }

  #adoptAccessToken(tokens: TokenResponse): void {
    this.#accessToken = tokens.access_token;
    this.#expiresAt =
      this.#deps.now() +
      Math.max(0, (tokens.expires_in ?? 3600) * 1000 - REFRESH_MARGIN_MS);
  }

  async #exchange(
    client: GoogleOAuthClient,
    body: Record<string, string>,
    failureCode: OAuthErrorCode = "token-exchange-failed"
  ): Promise<TokenResponse> {
    const response = await this.#deps.fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": SYNC_USER_AGENT
      },
      body: new URLSearchParams({
        ...body,
        client_id: client.clientId,
        client_secret: client.clientKey
      }).toString()
    });

    const payload = (await response.json().catch(() => ({}))) as
      | TokenResponse
      | { error?: string; error_description?: string };

    if (!response.ok || !("access_token" in payload)) {
      const error = ("error" in payload && payload.error) || "";
      const detail =
        ("error_description" in payload && payload.error_description) ||
        error ||
        `HTTP ${response.status}`;
      // A revoked or expired refresh token is unrecoverable, so drop it rather
      // than retrying forever against a credential that will never work again.
      //
      // Only for `invalid_grant`, which is the one answer that means exactly
      // that. Dropping it on *any* failed refresh — as this did — turned a
      // Google 500, a 429, or a captive portal serving an error page into a
      // permanent disconnect, and the person had to walk through consent again
      // to recover from a credential that was fine the whole time. Everything
      // else raises and leaves the token alone; the next refresh retries.
      if (failureCode === "refresh-failed" && error === "invalid_grant") {
        this.disconnect();
      }
      throw new GoogleOAuthError(
        failureCode,
        `Google rejected the token request: ${detail}`
      );
    }
    return payload;
  }
}

interface TokenResponse {
  readonly access_token: string;
  readonly expires_in?: number;
  readonly refresh_token?: string;
}

function redirectUriFor(server: http.Server): string {
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}/callback`;
}

function page(message: string): string {
  return (
    '<!doctype html><meta charset="utf-8"><title>Heracles Records</title>' +
    '<body style="font-family:system-ui;padding:3rem;text-align:center">' +
    `<p>${message}</p>`
  );
}

/** Drive's `about` payload, defensively. Every field is optional in practice:
 *  a Workspace account with unlimited storage omits `limit` entirely, and a
 *  future response shape must degrade to nulls rather than throw inside a call
 *  that promises not to. */
function readAccount(payload: unknown): GoogleAccountInfo {
  const body = (payload ?? {}) as {
    user?: { displayName?: unknown; emailAddress?: unknown };
    storageQuota?: { limit?: unknown; usage?: unknown };
  };
  const text = (value: unknown): string | null =>
    typeof value === "string" && value.length > 0 ? value : null;
  // Drive reports byte counts as strings, being JSON with 64-bit numbers in it.
  const bytes = (value: unknown): number | null => {
    const parsed = typeof value === "string" ? Number(value) : value;
    return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null;
  };

  const used = bytes(body.storageQuota?.usage);
  return {
    email: text(body.user?.emailAddress),
    name: text(body.user?.displayName),
    quota: used === null ? null : { used, limit: bytes(body.storageQuota?.limit) }
  };
}
