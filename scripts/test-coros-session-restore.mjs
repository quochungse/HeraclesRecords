// Getting the COROS session back after another machine took it.
//
// COROS keeps one live access token per account, so signing in on a second
// computer kills the first one's token. The app answers that in exactly one
// place — `restoreTrainingHubSessionAtStartup`, once per launch — and
// deliberately nowhere else: a re-login on every expired request had two
// machines taking the session off each other for as long as both stayed open.
//
// So there are two halves to hold down here, and they pull in opposite
// directions:
//
//   * start-up restores, but only from a session that is *gone* and only with
//     credentials the athlete chose to save.
//   * mid-session does not restore at all. A dead token ends the session and
//     leaves the credentials alone, which is what puts the next launch into the
//     state the restore is looking for.
//
// Both are invisible to the renderer, which asked for neither — so both have to
// announce themselves through `setTrainingHubSessionListener`, or the sign-in
// surface goes on showing whatever it last read.
//
// Usage:
//   npm run test:coros-session-restore
//
// Runs under Electron for the better-sqlite3 ABI, with `electron` itself faked:
// `ELECTRON_RUN_AS_NODE` hands `require("electron")` the npm shim, which has no
// `safeStorage` at all, and saved credentials are the whole subject.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Module = require("node:module");
const repoRoot = path.resolve(import.meta.dirname, "..");

// A stand-in keychain. Reversible on purpose: the point of the real one is that
// only this OS user can open the blob, and nothing under test depends on that —
// only on the round trip, and on `isEncryptionAvailable` being able to say no.
let encryptionAvailable = true;
const fakeElectron = {
  safeStorage: {
    isEncryptionAvailable: () => encryptionAvailable,
    encryptString: (value) => Buffer.from(value, "utf8"),
    decryptString: (buffer) => Buffer.from(buffer).toString("utf8")
  }
};

const originalLoad = Module._load;
Module._load = function patchedLoad(request, ...rest) {
  if (request === "electron") return fakeElectron;
  return originalLoad.call(this, request, ...rest);
};

const load = (file) => require(path.join(repoRoot, "dist-electron", file));

const database = load("database.js");
const credentialStore = load("corosCredentialStore.js");
const trainingHub = load("trainingHubService.js");

const userData = fs.mkdtempSync(path.join(os.tmpdir(), "heracles-session-"));
database.initializeDatabase(userData);

const SETTINGS = {
  accessToken: "trainingHub.accessToken",
  userId: "trainingHub.userId",
  regionId: "trainingHub.regionId",
  baseUrl: "trainingHub.baseUrl"
};

const HOME = "https://teamapi.coros.com";
const ACCOUNT = "runner@example.com";
const PASSWORD_HASH = credentialStore.hashCorosPassword("correct horse");

/** Every status pushed at the renderer since the last `reset()`. */
let announced = [];
trainingHub.setTrainingHubSessionListener((status) => {
  announced.push(status);
});

/** Wipe everything the two functions under test read, between cases. */
function reset() {
  database.deleteSettings(Object.values(SETTINGS));
  credentialStore.clearStoredCorosCredentials();
  encryptionAvailable = true;
  announced = [];
}

function signIn(token) {
  database.setSetting(SETTINGS.accessToken, token);
  database.setSetting(SETTINGS.userId, "478751691911479296");
  database.setSetting(SETTINGS.regionId, "1");
  database.setSetting(SETTINGS.baseUrl, HOME);
}

const jsonResponse = (body) => ({
  ok: true,
  status: 200,
  statusText: "OK",
  json: async () => body
});

/**
 * A COROS that answers whatever the case needs, and counts what it was asked.
 *
 * `routes` is matched by substring against the URL, longest pattern first, so a
 * case can override `/account/query` without restating the login.
 */
function stubCoros(routes) {
  const calls = [];
  const patterns = Object.keys(routes).sort((a, b) => b.length - a.length);
  globalThis.fetch = async (url, init) => {
    const target = String(url);
    calls.push(target);
    const pattern = patterns.find((candidate) => target.includes(candidate));
    if (!pattern) {
      throw new Error(`the test made an unexpected COROS request: ${target}`);
    }
    const answer = routes[pattern];
    return typeof answer === "function"
      ? answer(target, init)
      : jsonResponse(answer);
  };
  return {
    calls,
    countOf: (fragment) =>
      calls.filter((target) => target.includes(fragment)).length
  };
}

/** A COROS that grants a session: password step, region probe, account read. */
function stubSuccessfulLogin(token = "fresh-token") {
  return stubCoros({
    "/account/login": {
      result: "0000",
      data: { accessToken: token, userId: "478751691911479296", regionId: 1 }
    },
    "/activity/query": { result: "0000", data: { dataList: [] } },
    "/account/query": {
      result: "0000",
      data: { userId: "478751691911479296", unit: 0 }
    }
  });
}

const cases = [];
const test = (name, run) => cases.push([name, run]);

// --- what start-up restores, and what it leaves alone ----------------------

test("saved credentials bring a lost session back", async () => {
  reset();
  credentialStore.storeCorosCredentials(ACCOUNT, PASSWORD_HASH);
  const coros = stubSuccessfulLogin("fresh-token");

  const result = await trainingHub.restoreTrainingHubSessionAtStartup();

  assert.equal(result.restored, true);
  assert.equal(result.status.authenticated, true);
  assert.equal(result.status.email, ACCOUNT);
  assert.equal(
    database.getSetting(SETTINGS.accessToken),
    "fresh-token",
    "the new token has to be persisted, or the next launch restores again"
  );
  assert.equal(coros.countOf("/account/login"), 1);
  assert.equal(
    announced.length,
    1,
    "the renderer asked for none of this and has to be told"
  );
  assert.equal(announced[0].authenticated, true);
});

test("a session already in hand is not re-minted", async () => {
  reset();
  credentialStore.storeCorosCredentials(ACCOUNT, PASSWORD_HASH);
  signIn("live-token");
  const coros = stubCoros({});

  const result = await trainingHub.restoreTrainingHubSessionAtStartup();

  assert.deepEqual(result, { restored: false, reason: "already-signed-in" });
  assert.equal(
    coros.calls.length,
    0,
    "logging in over a live session is exactly the kick this feature avoids"
  );
  assert.deepEqual(announced, [], "nothing changed, so there is nothing to say");
  assert.equal(database.getSetting(SETTINGS.accessToken), "live-token");
});

test("without saved credentials nothing is attempted", async () => {
  reset();
  const coros = stubCoros({});

  const result = await trainingHub.restoreTrainingHubSessionAtStartup();

  assert.deepEqual(result, { restored: false, reason: "no-credentials" });
  assert.equal(coros.calls.length, 0);
});

test("an unavailable keychain reads as no credentials", async () => {
  reset();
  credentialStore.storeCorosCredentials(ACCOUNT, PASSWORD_HASH);
  encryptionAvailable = false;
  const coros = stubCoros({});

  const result = await trainingHub.restoreTrainingHubSessionAtStartup();

  assert.deepEqual(result, { restored: false, reason: "no-credentials" });
  assert.equal(coros.calls.length, 0);
});

test("a two-factor account is reported, not half signed in", async () => {
  reset();
  credentialStore.storeCorosCredentials(ACCOUNT, PASSWORD_HASH);
  const coros = stubCoros({
    "/account/login": {
      result: "0000",
      data: { loginTicket: "ticket-1", appKey: "key-1", accountType2fa: 2 }
    }
  });

  const result = await trainingHub.restoreTrainingHubSessionAtStartup();

  assert.deepEqual(result, { restored: false, reason: "two-factor-required" });
  assert.equal(
    database.getSetting(SETTINGS.accessToken),
    undefined,
    "a challenge is not a session"
  );
  assert.equal(
    coros.countOf("/account/captcha"),
    0,
    "an automatic login must not email a code nobody asked for"
  );
});

test("a rejected password leaves the credentials for the athlete to fix", async () => {
  reset();
  credentialStore.storeCorosCredentials(ACCOUNT, PASSWORD_HASH);
  stubCoros({
    "/account/login": {
      result: "1005",
      message: "Incorrect account or password"
    }
  });

  const result = await trainingHub.restoreTrainingHubSessionAtStartup();

  assert.deepEqual(result, { restored: false, reason: "failed" });
  assert.equal(database.getSetting(SETTINGS.accessToken), undefined);
  assert.deepEqual(
    credentialStore.getStoredCorosCredentials(),
    { account: ACCOUNT, pwdHash: PASSWORD_HASH },
    "clearing them would take away the Reconnect button too"
  );
});

// --- and what mid-session deliberately does not do -------------------------

test("a dead token ends the session without logging back in", async () => {
  reset();
  credentialStore.storeCorosCredentials(ACCOUNT, PASSWORD_HASH);
  signIn("kicked-token");
  const expired = { result: "0101", message: "Access token is invalid" };
  const coros = stubCoros({
    "/dashboard/query": expired,
    "/activity/query": expired,
    "/account/query": expired,
    "/account/login": () => {
      throw new Error("mid-session re-login is the ping-pong this test forbids");
    }
  });

  await assert.rejects(
    trainingHub.getTrainingDashboard(),
    /COROS session expired/,
    "the caller has to hear about it; silently retrying is what was removed"
  );

  assert.equal(coros.countOf("/account/login"), 0);
  for (const key of Object.values(SETTINGS)) {
    assert.equal(
      database.getSetting(key),
      undefined,
      `${key} must be gone, or the next launch sees a session and skips the restore`
    );
  }
  assert.deepEqual(
    credentialStore.getStoredCorosCredentials(),
    { account: ACCOUNT, pwdHash: PASSWORD_HASH },
    "the credentials are what the next launch restores from"
  );
  assert.equal(announced.length, 1);
  assert.equal(
    announced[0].authenticated,
    false,
    "an Overview still claiming a connection is the whole cost of not saying so"
  );
  assert.equal(
    announced[0].rememberCredentials,
    true,
    "which is what puts the Reconnect button on screen"
  );
});

test("the state a kick leaves behind is the one start-up restores from", async () => {
  reset();
  credentialStore.storeCorosCredentials(ACCOUNT, PASSWORD_HASH);
  signIn("kicked-token");
  const expired = { result: "0101", message: "Access token is invalid" };
  stubCoros({
    "/dashboard/query": expired,
    "/activity/query": expired,
    "/account/query": expired
  });
  await assert.rejects(trainingHub.getTrainingDashboard());

  // Quit, reopen: same database, nothing else changed.
  stubSuccessfulLogin("token-after-restart");
  const result = await trainingHub.restoreTrainingHubSessionAtStartup();

  assert.equal(result.restored, true);
  assert.equal(
    database.getSetting(SETTINGS.accessToken),
    "token-after-restart"
  );
});

// --- signing out is still a decision, not a hiccup -------------------------

test("signing out is not something the next launch undoes", async () => {
  reset();
  credentialStore.storeCorosCredentials(ACCOUNT, PASSWORD_HASH);
  signIn("live-token");
  stubCoros({});

  trainingHub.logoutTrainingHub();
  const coros = stubCoros({});
  const result = await trainingHub.restoreTrainingHubSessionAtStartup();

  assert.deepEqual(
    result,
    { restored: false, reason: "no-credentials" },
    "logout clears the credentials too, which is what makes it stick"
  );
  assert.equal(coros.calls.length, 0);
});

let failed = 0;
for (const [name, run] of cases) {
  try {
    await run();
    console.log(`ok  ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(error);
  }
}

fs.rmSync(userData, { recursive: true, force: true });
Module._load = originalLoad;

if (failed > 0) {
  console.error(`\n${failed} COROS session restore test(s) failed`);
  process.exit(1);
}
console.log("\nCOROS session restore tests passed");
