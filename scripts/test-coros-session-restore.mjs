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
  // One announcement, not two: with no token on disk there was never a
  // connection on screen to correct. The flag went up before the window even
  // loaded, so the renderer reads "restoring" for itself and only needs telling
  // when the wait is over.
  assert.deepEqual(
    announced.map((status) => [status.authenticated, status.restoring]),
    [[true, false]],
    "the renderer asked for none of this and has to be told the wait is over"
  );
});

test("a session already in hand is not re-minted", async () => {
  reset();
  credentialStore.storeCorosCredentials(ACCOUNT, PASSWORD_HASH);
  signIn("live-token");
  const coros = stubCoros({
    "/activity/query": { result: "0000", data: { dataList: [] } }
  });

  const result = await trainingHub.restoreTrainingHubSessionAtStartup();

  assert.deepEqual(result, { restored: false, reason: "already-signed-in" });
  assert.equal(
    coros.countOf("/account/login"),
    0,
    "logging in over a live session is exactly the kick this feature avoids"
  );
  assert.equal(
    coros.countOf("/activity/query"),
    1,
    "asking whether the token is still live is a read, and the only way to know"
  );
  assert.deepEqual(announced, [], "nothing changed, so there is nothing to say");
  assert.equal(database.getSetting(SETTINGS.accessToken), "live-token");
});

// The launch right after another machine took the session. Nothing local says
// so — the token is still in `app_settings` — so a start-up that trusted the
// settings table skipped its one login and left the athlete signed out for the
// rest of the run, since the request that discovers it must not log back in.
test("a token killed elsewhere is re-minted at the next launch", async () => {
  reset();
  credentialStore.storeCorosCredentials(ACCOUNT, PASSWORD_HASH);
  signIn("kicked-token");
  const coros = stubCoros({
    "/account/login": {
      result: "0000",
      data: {
        accessToken: "fresh-token",
        userId: "478751691911479296",
        regionId: 1
      }
    },
    "/activity/query": (target, init) =>
      jsonResponse(
        init?.headers?.accesstoken === "kicked-token"
          ? { result: "1019", message: "Access token is invalid" }
          : { result: "0000", data: { dataList: [] } }
      ),
    "/account/query": {
      result: "0000",
      data: { userId: "478751691911479296", unit: 0 }
    }
  });

  const result = await trainingHub.restoreTrainingHubSessionAtStartup();

  assert.equal(result.restored, true);
  assert.equal(result.status.authenticated, true);
  assert.equal(
    database.getSetting(SETTINGS.accessToken),
    "fresh-token",
    "the dead token has to be replaced, not kept alongside the new one"
  );
  assert.equal(coros.countOf("/account/login"), 1, "still one login per launch");
  assert.equal(announced.at(-1)?.authenticated, true);
});

// The same shape as above, except COROS cannot be reached at all. Reading that
// as a dead token would sign the athlete out of a working session every time
// they opened the app on a plane — and spend the launch's one login doing it.
test("an unreachable COROS leaves the session alone", async () => {
  reset();
  credentialStore.storeCorosCredentials(ACCOUNT, PASSWORD_HASH);
  signIn("offline-token");
  const coros = stubCoros({
    "/activity/query": () => {
      throw new Error("getaddrinfo ENOTFOUND teamapi.coros.com");
    }
  });

  const result = await trainingHub.restoreTrainingHubSessionAtStartup();

  assert.deepEqual(result, { restored: false, reason: "already-signed-in" });
  assert.equal(coros.countOf("/account/login"), 0);
  assert.equal(
    database.getSetting(SETTINGS.accessToken),
    "offline-token",
    "an offline launch is not a reason to throw the session away"
  );
  assert.deepEqual(announced, []);
});

// A stale token dropped and nothing to put in its place: the renderer is about
// to read, or has already read, a status saying signed in. It has to be told.
test("a dropped stale session is reported even when the re-login fails", async () => {
  reset();
  credentialStore.storeCorosCredentials(ACCOUNT, PASSWORD_HASH);
  signIn("kicked-token");
  stubCoros({
    "/activity/query": { result: "1019", message: "Access token is invalid" },
    "/account/login": { result: "1005", message: "Incorrect account or password" }
  });

  const result = await trainingHub.restoreTrainingHubSessionAtStartup();

  assert.deepEqual(result, { restored: false, reason: "failed" });
  assert.equal(
    database.getSetting(SETTINGS.accessToken),
    undefined,
    "a token COROS has disowned is not worth keeping"
  );
  assert.equal(
    announced.at(-1)?.authenticated,
    false,
    "the renderer would otherwise go on showing a session that is gone"
  );
});

// The cold start with saved credentials: nothing on disk to check, so the flag
// is already up by the time a window exists and the renderer reads it directly.
// Without it, three seconds of every such launch offered a sign-in form for an
// account that was in the middle of signing itself in.
test("a launch with no session shows the restore, not a sign-in form", async () => {
  reset();
  credentialStore.storeCorosCredentials(ACCOUNT, PASSWORD_HASH);

  let releaseLogin;
  const loginHeld = new Promise((resolve) => {
    releaseLogin = resolve;
  });
  stubCoros({
    "/account/login": async () => {
      await loginHeld;
      return jsonResponse({
        result: "0000",
        data: {
          accessToken: "fresh-token",
          userId: "478751691911479296",
          regionId: 1
        }
      });
    },
    "/activity/query": { result: "0000", data: { dataList: [] } },
    "/account/query": {
      result: "0000",
      data: { userId: "478751691911479296", unit: 0 }
    }
  });

  const restore = trainingHub.restoreTrainingHubSessionAtStartup();
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(
    {
      authenticated: trainingHub.getTrainingHubStatus().authenticated,
      restoring: trainingHub.getTrainingHubStatus().restoring
    },
    { authenticated: false, restoring: true },
    "signed out and busy about it — the two together are what the panel reads"
  );

  releaseLogin();
  await restore;
  assert.equal(trainingHub.getTrainingHubStatus().restoring, false);
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

// --- and what the sign-in surface is told while it happens -----------------
//
// "Signed out" and "signing back in" are the same `authenticated: false` to a
// screen that only reads that field, and they call for opposite behaviour: one
// waits for the athlete, the other waits for nobody. So the restore says which
// it is, and says it *before* the login goes out — the renderer mounts in
// parallel and reads whatever is true at that moment.

test("the restore is announced before it goes out, not only after", async () => {
  reset();
  credentialStore.storeCorosCredentials(ACCOUNT, PASSWORD_HASH);
  signIn("kicked-token");

  let releaseLogin;
  const loginHeld = new Promise((resolve) => {
    releaseLogin = resolve;
  });

  stubCoros({
    "/activity/query": (target, init) =>
      jsonResponse(
        init?.headers?.accesstoken === "kicked-token"
          ? { result: "1019", message: "Access token is invalid" }
          : { result: "0000", data: { dataList: [] } }
      ),
    "/account/login": async () => {
      await loginHeld;
      return jsonResponse({
        result: "0000",
        data: {
          accessToken: "fresh-token",
          userId: "478751691911479296",
          regionId: 1
        }
      });
    },
    "/account/query": {
      result: "0000",
      data: { userId: "478751691911479296", unit: 0 }
    }
  });

  const restore = trainingHub.restoreTrainingHubSessionAtStartup();

  // Wait for the announcement that the login is under way, the way the
  // renderer does — it has no other way to know one is. Bounded, because the
  // failure this case guards against is the announcement never arriving, and a
  // test that waits forever for it reports nothing at all.
  for (let turn = 0; announced.length === 0 && turn < 200; turn += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(
    announced.length > 0,
    true,
    "the login is in flight and the renderer has not been told a thing"
  );

  assert.deepEqual(
    { authenticated: announced[0].authenticated, restoring: announced[0].restoring },
    { authenticated: false, restoring: true },
    "the surface has to hear this while the login is still in flight"
  );
  assert.equal(
    trainingHub.getTrainingHubStatus().restoring,
    true,
    "and a renderer that reads the status itself has to see the same thing"
  );
  assert.equal(
    announced[0].email,
    ACCOUNT,
    "the panel names the account being signed back in"
  );

  releaseLogin();
  await restore;

  assert.deepEqual(
    {
      authenticated: announced.at(-1).authenticated,
      restoring: announced.at(-1).restoring
    },
    { authenticated: true, restoring: false },
    "and has to hear the end of it, or it waits on a login already home"
  );
});

test("a restore that fails clears the flag it raised", async () => {
  reset();
  credentialStore.storeCorosCredentials(ACCOUNT, PASSWORD_HASH);
  signIn("kicked-token");
  stubCoros({
    "/activity/query": { result: "1019", message: "Access token is invalid" },
    "/account/login": { result: "1005", message: "Incorrect account or password" }
  });

  const result = await trainingHub.restoreTrainingHubSessionAtStartup();

  assert.deepEqual(result, { restored: false, reason: "failed" });
  assert.equal(
    trainingHub.getTrainingHubStatus().restoring,
    false,
    "a flag left standing waits forever on a login that is not coming"
  );
  assert.deepEqual(
    {
      authenticated: announced.at(-1).authenticated,
      restoring: announced.at(-1).restoring
    },
    { authenticated: false, restoring: false },
    "now it really is the sign-in surface's turn"
  );
});

test("a two-factor account is handed back to the athlete, not left spinning", async () => {
  reset();
  credentialStore.storeCorosCredentials(ACCOUNT, PASSWORD_HASH);
  signIn("kicked-token");
  stubCoros({
    "/activity/query": { result: "1019", message: "Access token is invalid" },
    "/account/login": {
      result: "0000",
      data: { loginTicket: "ticket-1", appKey: "key-1", accountType2fa: 2 }
    }
  });

  const result = await trainingHub.restoreTrainingHubSessionAtStartup();

  assert.deepEqual(result, { restored: false, reason: "two-factor-required" });
  assert.equal(trainingHub.getTrainingHubStatus().restoring, false);
  assert.equal(announced.at(-1).restoring, false);
});

// The flag goes up before the token is checked, which means it is also up
// during every ordinary launch's check. It must not read as "wait" there: the
// renderer would hold its first load for a network round trip on every single
// launch, to guard against a case that is not happening.
test("checking a good token does not hold the launch back", async () => {
  reset();
  credentialStore.storeCorosCredentials(ACCOUNT, PASSWORD_HASH);
  signIn("live-token");

  let releaseProbe;
  const probeHeld = new Promise((resolve) => {
    releaseProbe = resolve;
  });
  const coros = stubCoros({
    "/activity/query": async () => {
      await probeHeld;
      return jsonResponse({ result: "0000", data: { dataList: [] } });
    }
  });

  const restore = trainingHub.restoreTrainingHubSessionAtStartup();
  await new Promise((resolve) => setImmediate(resolve));

  // What the renderer reads while the check is in the air. `restoring` is true,
  // but so is `authenticated` — and it is the pair that decides, so this reads
  // as "load, we are only double-checking", not as "wait".
  const midCheck = trainingHub.getTrainingHubStatus();
  assert.deepEqual(
    { authenticated: midCheck.authenticated, restoring: midCheck.restoring },
    { authenticated: true, restoring: true },
    "holding the load on `restoring` alone would tax every launch"
  );

  releaseProbe();
  assert.deepEqual(await restore, {
    restored: false,
    reason: "already-signed-in"
  });
  assert.equal(trainingHub.getTrainingHubStatus().restoring, false);
  assert.equal(coros.countOf("/account/login"), 0);
  assert.deepEqual(
    announced,
    [],
    "and no announcement either, or every launch pays for a second full reload"
  );
});

test("nothing to restore raises no flag at all", async () => {
  reset();
  signIn("live-token");
  stubCoros({ "/activity/query": { result: "0000", data: { dataList: [] } } });

  await trainingHub.restoreTrainingHubSessionAtStartup();

  assert.equal(
    trainingHub.getTrainingHubStatus().restoring,
    false,
    "an ordinary launch must not show a restore panel"
  );
  assert.deepEqual(announced, []);
});

// --- the renderer's stale replies must not land on the new session ---------
//
// Both halves run at once on a launch that was kicked. React mounts and starts
// loading with whatever token is on disk; start-up is meanwhile finding that
// same token dead and minting a replacement. The loads fail — they were always
// going to — and their replies can arrive after the new token is stored. This
// is the case that made closing and reopening two or three times look like a
// fix: it came down to whether the stale replies beat the login home.

test("a stale reply does not wipe the session that replaced it", async () => {
  reset();
  credentialStore.storeCorosCredentials(ACCOUNT, PASSWORD_HASH);
  signIn("kicked-token");

  // The renderer's load has to *begin* before the session is dropped — that is
  // what captures the kicked token — and answer after the replacement is on
  // disk. So the first activity read is held open, and the start-up probe that
  // follows it is answered straight away.
  let releaseRendererLoad;
  const rendererLoadHeld = new Promise((resolve) => {
    releaseRendererLoad = resolve;
  });
  let activityReads = 0;

  stubCoros({
    "/activity/query": async (target, init) => {
      const kicked = init?.headers?.accesstoken === "kicked-token";
      if (!kicked) {
        return jsonResponse({ result: "0000", data: { dataList: [] } });
      }
      const expired = { result: "1019", message: "Access token is invalid" };
      if (++activityReads === 1) {
        await rendererLoadHeld;
        return jsonResponse(expired);
      }
      return jsonResponse(expired);
    },
    "/account/login": {
      result: "0000",
      data: {
        accessToken: "fresh-token",
        userId: "478751691911479296",
        regionId: 1
      }
    },
    "/account/query": {
      result: "0000",
      data: { userId: "478751691911479296", unit: 0 }
    }
  });

  // Begins now, with the kicked token in hand, and does not answer yet.
  const rendererLoad = trainingHub.listTrainingHubActivities(1, 1).then(
    () => "resolved",
    (error) => error
  );

  const result = await trainingHub.restoreTrainingHubSessionAtStartup();
  assert.equal(result.restored, true, "start-up should have signed back in");
  assert.equal(database.getSetting(SETTINGS.accessToken), "fresh-token");

  releaseRendererLoad();
  await rendererLoad;

  assert.equal(
    database.getSetting(SETTINGS.accessToken),
    "fresh-token",
    "the stale failure belongs to a session that is already gone; clearing " +
      "here signs the athlete out of the one that just replaced it"
  );
  assert.equal(
    trainingHub.getTrainingHubStatus().authenticated,
    true,
    "and the renderer must not be told the new session is dead"
  );
  assert.equal(
    announced.at(-1)?.authenticated,
    true,
    "the last thing the renderer hears has to be the session it actually has"
  );
});

test("a dead token still ends the session it actually belongs to", async () => {
  reset();
  credentialStore.storeCorosCredentials(ACCOUNT, PASSWORD_HASH);
  signIn("live-then-kicked");
  stubCoros({
    "/activity/query": { result: "1019", message: "Access token is invalid" }
  });

  await assert.rejects(trainingHub.listTrainingHubActivities(1, 1));

  assert.equal(
    database.getSetting(SETTINGS.accessToken),
    undefined,
    "the guard is about *which* session, not about keeping dead ones"
  );
  assert.equal(announced.at(-1)?.authenticated, false);
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
