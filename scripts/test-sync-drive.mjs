// GoogleDriveProvider against a stand-in Drive.
//
// The point of this suite is the first block: the *same* contract the local
// folder passes, run unchanged. If an assertion has to be relaxed for Drive,
// the StorageProvider interface has grown a filesystem assumption and the fix
// belongs in storageProvider.ts.
//
// After that come the parts that are Drive's alone — retry on 429, the
// duplicate-name race, query escaping, the OAuth flow's pure pieces.
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { FakeDrive } from "./lib/fake-drive.mjs";
import {
  bytes,
  runStorageProviderContract
} from "./lib/storage-provider-contract.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const bust = `?cacheBust=${Date.now()}`;
const load = (file) =>
  import(
    `${pathToFileURL(path.join(repoRoot, "dist-electron", "sync", file)).href}${bust}`
  );

const { GoogleDriveProvider } = await load("googleDriveProvider.js");
const { StorageConflictError, StoragePathError } = await load(
  "storageProvider.js"
);
const {
  GoogleOAuth,
  GoogleOAuthError,
  buildAuthUrl,
  createPkcePair,
  DRIVE_SCOPE,
  SYNC_USER_AGENT
} = await load("googleOAuth.js");

const newProvider = (drive, overrides = {}) =>
  new GoogleDriveProvider({
    fetch: drive.fetch,
    accessToken: async () => "test-access-token",
    sleep: async () => {},
    ...overrides
  });

// ===========================================================================
// The shared contract, unchanged
// ===========================================================================

const checks = await runStorageProviderContract({
  label: "google drive",
  newStore: async () => {
    const drive = new FakeDrive();
    return { open: () => newProvider(drive) };
  },
  errors: { StorageConflictError, StoragePathError }
});

// ===========================================================================
// Drive-specific behaviour
// ===========================================================================

// Every request is authorised and carries the browser-shaped User-Agent.
{
  const drive = new FakeDrive();
  const captured = [];
  const provider = newProvider(drive, {
    fetch: async (url, init) => {
      captured.push(init?.headers ?? {});
      return drive.fetch(url, init);
    }
  });

  await provider.put("a.txt", bytes("hello"));
  assert.ok(captured.length > 0, "the provider actually made requests");
  for (const headers of captured) {
    assert.equal(
      headers.Authorization,
      "Bearer test-access-token",
      "every request carries the access token"
    );
    assert.equal(
      headers["User-Agent"],
      SYNC_USER_AGENT,
      "and a browser-shaped User-Agent, not a library default"
    );
  }
}

// The app folder is created once and then reused.
{
  const drive = new FakeDrive();
  const provider = newProvider(drive);
  await provider.put("a.txt", bytes("1"));
  await provider.put("b.txt", bytes("2"));

  const folders = [...drive.files.values()].filter(
    (file) => file.mimeType === "application/vnd.google-apps.folder"
  );
  assert.equal(folders.length, 1, "exactly one app folder is created");
  assert.equal(folders[0].name, "Heracles Records");

  for (const file of drive.files.values()) {
    if (file.mimeType) continue;
    assert.deepEqual(
      file.parents,
      [folders[0].id],
      "every object lands inside the app folder"
    );
    assert.equal(
      typeof file.appProperties?.path,
      "string",
      "and carries its storage path in metadata, not in a folder tree"
    );
  }
}

// A second provider finds the folder the first one made rather than making
// another — two devices must not end up with two vaults.
{
  const drive = new FakeDrive();
  await newProvider(drive).put("a.txt", bytes("1"));
  await newProvider(drive).put("b.txt", bytes("2"));

  assert.equal(
    [...drive.files.values()].filter(
      (file) => file.mimeType === "application/vnd.google-apps.folder"
    ).length,
    1,
    "a second device reuses the existing folder"
  );
}

// 429 and 5xx are retried; the response Drive finally gives is the one used.
{
  const drive = new FakeDrive();
  drive.failures = [
    { status: 429, retryAfter: 1 },
    { status: 503 },
    { status: 429 }
  ];
  const waits = [];
  const provider = newProvider(drive, { sleep: async (ms) => waits.push(ms) });

  await provider.put("resilient.txt", bytes("survived"));
  assert.equal(
    (await provider.get("resilient.txt")).content.toString(),
    "survived",
    "a write survives three transient failures"
  );
  assert.equal(waits.length, 3, "each failure was backed off");
  assert.equal(waits[0], 1000, "Retry-After wins when Drive sends one");
  assert.ok(
    waits[1] > 0 && waits[2] > waits[1],
    "and the fallback backoff grows"
  );
}

// Retrying is bounded: a permanently failing Drive surfaces the error.
{
  const drive = new FakeDrive();
  drive.failures = Array.from({ length: 20 }, () => ({ status: 500 }));
  const provider = newProvider(drive, { maxAttempts: 3, sleep: async () => {} });

  await assert.rejects(
    provider.list(),
    /Google Drive request failed \(500\)/,
    "a Drive that never recovers must raise, not loop forever"
  );
}

// The race that decides a lease. Drive cannot create atomically, so the
// provider settles duplicates afterwards — and must leave exactly one file.
{
  const drive = new FakeDrive();
  const devices = Array.from({ length: 6 }, () => newProvider(drive));

  const outcomes = await Promise.all(
    devices.map((provider, i) =>
      provider
        .put("lease/token.json", bytes(`device-${i}`), null)
        .then(() => `device-${i}`)
        .catch((error) => {
          assert.ok(
            error instanceof StorageConflictError,
            `a loser must lose with a conflict, got ${error?.name}: ${error?.message}`
          );
          return null;
        })
    )
  );

  const winners = outcomes.filter(Boolean);
  assert.equal(winners.length, 1, "exactly one device wins the lease on Drive");

  const surviving = [...drive.files.values()].filter(
    (file) => file.appProperties?.path === "lease/token.json"
  );
  assert.equal(
    surviving.length,
    1,
    "and the losers delete their own copies, leaving no duplicates"
  );
  assert.equal(
    surviving[0].content.toString(),
    winners[0],
    "the surviving file is the winner's"
  );
}

// A path with a quote in it must not be able to rewrite the Drive query.
{
  const drive = new FakeDrive();
  const provider = newProvider(drive);
  const tricky = "oplog/d'evice/1.jsonl";

  await provider.put(tricky, bytes("quoted"));
  assert.equal(
    (await provider.get(tricky)).content.toString(),
    "quoted",
    "a quote in a path round trips"
  );
  assert.equal(
    await provider.get("oplog/other/1.jsonl"),
    null,
    "and does not make the query match everything"
  );
  assert.deepEqual(
    (await provider.list()).map((entry) => entry.path),
    [tricky],
    "the listing shows it once"
  );
}

// Deleting removes every copy, so a leftover from a lost race cannot resurface.
{
  const drive = new FakeDrive();
  const provider = newProvider(drive);
  await provider.put("dup.txt", bytes("one"));

  // Two files claiming one path, as a lost race would leave behind.
  const original = [...drive.files.values()].find(
    (file) => file.appProperties?.path === "dup.txt"
  );
  drive.files.set("file-shadow", {
    ...original,
    id: "file-shadow",
    createdTime: "2999-01-01T00:00:00.000Z"
  });

  assert.equal(
    (await provider.list()).filter((entry) => entry.path === "dup.txt").length,
    1,
    "a duplicate is hidden from the listing"
  );

  await provider.delete("dup.txt");
  assert.equal(
    [...drive.files.values()].filter(
      (file) => file.appProperties?.path === "dup.txt"
    ).length,
    0,
    "delete removes every copy"
  );
}

// ===========================================================================
// OAuth: the parts that need no browser
// ===========================================================================

{
  const { verifier, challenge } = createPkcePair();
  assert.notEqual(verifier, challenge, "the challenge is not the verifier");
  assert.match(verifier, /^[A-Za-z0-9_-]+$/, "verifier is base64url");
  assert.match(challenge, /^[A-Za-z0-9_-]+$/, "challenge is base64url");
  assert.notDeepEqual(
    createPkcePair().verifier,
    createPkcePair().verifier,
    "every flow gets a fresh verifier"
  );

  const url = new URL(
    buildAuthUrl({
      clientId: "client-123",
      redirectUri: "http://127.0.0.1:5599/callback",
      challenge,
      state: "state-abc"
    })
  );
  assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(url.searchParams.get("scope"), DRIVE_SCOPE);
  assert.equal(
    DRIVE_SCOPE,
    "https://www.googleapis.com/auth/drive.file",
    "the scope stays drive.file — anything broader needs Google verification"
  );
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("code_challenge"), challenge);
  assert.equal(
    url.searchParams.get("redirect_uri"),
    "http://127.0.0.1:5599/callback",
    "the redirect is plain http loopback, not https like Spotify's"
  );
  assert.equal(
    url.searchParams.get("access_type"),
    "offline",
    "without this Google issues no refresh token"
  );
  assert.equal(url.searchParams.get("prompt"), "consent");
}

// Token storage, refresh, and what happens when a refresh token is revoked.
{
  const settings = new Map();
  const keychain = {
    isAvailable: () => true,
    encrypt: (plaintext) => `k:${Buffer.from(plaintext).toString("hex")}`,
    decrypt: (encoded) => {
      if (!encoded.startsWith("k:")) throw new Error("foreign blob");
      return Buffer.from(encoded.slice(2), "hex").toString();
    }
  };

  let clock = 0;
  const responses = [];
  const oauth = new GoogleOAuth({
    fetch: async () => responses.shift(),
    openExternal: async () => {},
    getSetting: (key) => settings.get(key),
    setSetting: (key, value) => settings.set(key, value),
    deleteSettings: (keys) => keys.forEach((key) => settings.delete(key)),
    secretStorage: keychain,
    now: () => clock,
    env: {}
  });

  // Whether a client is bundled depends on how this build was made, and is
  // covered on its own further down. What matters here is that no *account* is
  // connected yet.
  assert.equal(oauth.isConnected(), false);

  await assert.rejects(
    oauth.accessToken(),
    (error) =>
      error instanceof GoogleOAuthError && error.code === "not-connected",
    "asking for a token before connecting must say so"
  );

  oauth.setOwnClient({ clientId: "id-1", clientKey: "key-1" });
  assert.deepEqual(oauth.client(), { clientId: "id-1", clientKey: "key-1" });
  assert.equal(
    settings.get("sync.google.clientKey").startsWith("k:"),
    true,
    "the client key is sealed by the keychain, never stored in the clear"
  );

  // A refresh token arriving from a completed flow.
  settings.set("sync.google.refreshToken", keychain.encrypt("refresh-1"));
  assert.equal(oauth.isConnected(), true);

  responses.push(
    new Response(JSON.stringify({ access_token: "at-1", expires_in: 3600 }), {
      status: 200
    })
  );
  assert.equal(await oauth.accessToken(), "at-1", "a refresh yields a token");

  // Cached until it nears expiry.
  assert.equal(await oauth.accessToken(), "at-1", "and is reused while valid");

  clock += 3600 * 1000;
  responses.push(
    new Response(JSON.stringify({ access_token: "at-2", expires_in: 3600 }), {
      status: 200
    })
  );
  assert.equal(await oauth.accessToken(), "at-2", "and refreshed once stale");

  // A transient failure must not cost the connection. Google returning a 500,
  // or a captive portal answering for it, says nothing about whether the
  // refresh token is still good — and this used to disconnect on any failed
  // refresh, so a momentary blip sent the person back through consent to
  // recover a credential that was never broken.
  clock += 3600 * 1000;
  responses.push(
    new Response(JSON.stringify({ error: "backendError" }), { status: 500 })
  );
  await assert.rejects(
    oauth.accessToken(),
    (error) => error instanceof GoogleOAuthError && error.code === "refresh-failed",
    "a server-side failure still raises"
  );
  assert.equal(
    oauth.isConnected(),
    true,
    "but the refresh token survives a transient failure"
  );

  // A revoked refresh token is unrecoverable: drop it rather than retry forever.
  responses.push(
    new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 })
  );
  await assert.rejects(
    oauth.accessToken(),
    (error) => error instanceof GoogleOAuthError && error.code === "refresh-failed",
    "a rejected refresh raises"
  );
  assert.equal(
    oauth.isConnected(),
    false,
    "and the dead refresh token is discarded, not retried forever"
  );
}

// The build-from-source default: no client at all.
//
// This is what every build without the two environment variables produces, and
// what someone compiling the repo themselves gets. It has to degrade into "the
// Google option is unavailable", never into a half-connected state.
{
  const { BUNDLED_CLIENT_ID, BUNDLED_CLIENT_KEY } = await load(
    "googleClientCredentials.js"
  );
  const baked = Boolean(BUNDLED_CLIENT_ID && BUNDLED_CLIENT_KEY);

  const settings = new Map();
  const oauth = new GoogleOAuth({
    fetch: async () => new Response("{}", { status: 200 }),
    openExternal: async () => {},
    getSetting: (key) => settings.get(key),
    setSetting: (key, value) => settings.set(key, value),
    deleteSettings: (keys) => keys.forEach((key) => settings.delete(key)),
    secretStorage: {
      isAvailable: () => true,
      encrypt: (plaintext) => `k:${plaintext}`,
      decrypt: (encoded) => encoded.slice(2)
    },
    now: () => 0,
    // No environment override, so this reads whatever was baked in.
    env: {}
  });

  if (baked) {
    assert.ok(
      oauth.client(),
      "this build has credentials baked in, so a client is available"
    );
  } else {
    assert.equal(
      oauth.client(),
      null,
      "a build with no credentials must report no client, so the UI can " +
        "disable the Google option instead of offering a broken flow"
    );
    await assert.rejects(
      oauth.connect(),
      (error) =>
        error instanceof GoogleOAuthError && error.code === "not-connected",
      "and connecting must fail with a message that names the cause"
    );
  }

  // Either way, a user's own client takes over.
  oauth.setOwnClient({ clientId: "mine", clientKey: "also-mine" });
  assert.deepEqual(
    oauth.client(),
    { clientId: "mine", clientKey: "also-mine" },
    "a client supplied by the user overrides whatever the build shipped"
  );
  oauth.setOwnClient(null);
  assert.equal(
    Boolean(oauth.client()),
    baked,
    "and clearing it falls back to the build's own client, if there is one"
  );
}

// Naming the connected account.
//
// Read from Drive's `about`, which `drive.file` already covers — so this must
// not turn into a scope change, and it must never fail the Settings panel.
{
  const settings = new Map();
  const keychain = {
    isAvailable: () => true,
    encrypt: (plaintext) => `k:${plaintext}`,
    decrypt: (encoded) => encoded.slice(2)
  };
  let clock = 0;
  const requests = [];
  const responses = [];
  const oauth = new GoogleOAuth({
    fetch: async (url, init) => {
      requests.push({ url, init });
      return responses.shift();
    },
    openExternal: async () => {},
    getSetting: (key) => settings.get(key),
    setSetting: (key, value) => settings.set(key, value),
    deleteSettings: (keys) => keys.forEach((key) => settings.delete(key)),
    secretStorage: keychain,
    now: () => clock,
    env: {}
  });
  oauth.setOwnClient({ clientId: "id", clientKey: "key" });

  // Nothing connected: no request, no answer.
  assert.equal(await oauth.account(), null, "no account before connecting");
  assert.equal(requests.length, 0, "and nothing is asked of Google");

  settings.set("sync.google.refreshToken", keychain.encrypt("refresh-1"));

  // One token refresh, then the about call.
  responses.push(
    new Response(JSON.stringify({ access_token: "at-1", expires_in: 3600 }), {
      status: 200
    }),
    new Response(
      JSON.stringify({
        user: { emailAddress: "athlete@example.com", displayName: "Athlete" },
        storageQuota: { limit: "16106127360", usage: "1073741824" }
      }),
      { status: 200 }
    )
  );

  assert.deepEqual(await oauth.account(), {
    email: "athlete@example.com",
    name: "Athlete",
    quota: { used: 1073741824, limit: 16106127360 }
  });

  const about = requests.at(-1);
  assert.match(about.url, /drive\/v3\/about/);
  assert.equal(
    about.url.includes("photoLink"),
    false,
    "no avatar is requested, so no third party learns when the panel is open"
  );
  assert.equal(
    about.init.headers.Authorization,
    "Bearer at-1",
    "the existing drive.file token is what reads it — no new scope"
  );

  // Cached: a second look asks Google nothing.
  const asked = requests.length;
  assert.deepEqual((await oauth.account()).email, "athlete@example.com");
  assert.equal(requests.length, asked, "a cached account costs no round trip");

  // Past the window, it is read again — the quota half goes stale.
  clock += 6 * 60_000;
  responses.push(
    new Response(
      JSON.stringify({
        user: { emailAddress: "athlete@example.com" },
        storageQuota: { usage: "2147483648" }
      }),
      { status: 200 }
    )
  );
  assert.deepEqual(await oauth.account(), {
    email: "athlete@example.com",
    name: null,
    quota: { used: 2147483648, limit: null },
  }, "a missing display name and an uncapped quota degrade to nulls");

  // A refusal is not an exception. The panel has to keep rendering.
  clock += 6 * 60_000;
  responses.push(new Response("nope", { status: 403 }));
  assert.deepEqual(
    await oauth.account(),
    { email: null, name: null, quota: null },
    "a rejected about call must not throw"
  );

  // And the failure is cached for the same window rather than retried on every
  // refresh of the panel.
  const afterFailure = requests.length;
  assert.deepEqual((await oauth.account()).email, null);
  assert.equal(requests.length, afterFailure, "a failure is not retried at once");

  // Garbage is survivable too.
  clock += 6 * 60_000;
  responses.push(new Response("<html>", { status: 200 }));
  assert.deepEqual(await oauth.account(), {
    email: null,
    name: null,
    quota: null
  });

  // Disconnecting forgets who it was.
  oauth.disconnect();
  assert.equal(await oauth.account(), null);
}

// Without a keyring there is nowhere safe to put the connection.
{
  const oauth = new GoogleOAuth({
    fetch: async () => new Response("{}", { status: 200 }),
    openExternal: async () => {},
    getSetting: () => undefined,
    setSetting: () => {},
    deleteSettings: () => {},
    secretStorage: {
      isAvailable: () => false,
      encrypt: () => assert.fail("must not encrypt without a keyring"),
      decrypt: () => assert.fail("must not decrypt without a keyring")
    },
    now: () => 0,
    env: {}
  });

  assert.throws(
    () => oauth.setOwnClient({ clientId: "id", clientKey: "key" }),
    /no secure keyring/,
    "storing a Google connection without a keyring must fail loudly"
  );
  assert.equal(oauth.isConnected(), false);
}

console.log(
  `sync drive OK — ${checks} shared contract checks passed unchanged on Drive, ` +
    "single lease winner, 429 backoff, query escaping, token refresh, " +
    "account naming costs no new scope and never throws"
);
