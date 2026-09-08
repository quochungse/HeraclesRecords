// How a COROS answer is read, and the one endpoint that needs the account id.
//
// Two things went wrong here, both quietly, and both because the app was
// guessing at COROS's envelope rather than at what it actually sends.
//
//   * `apiCode` is not a status field. On some endpoints it carries one; on
//     `/account/query` it is a request trace id, so a *successful* read comes
//     back `{apiCode: "420BE2BB", data: {…}}` with no `result` at all. Taking
//     that hex for a status turned every success into an unknown failure.
//   * `/account/query` has no "whoever this token belongs to" form. Without
//     `accountid` it answers `1019 "Access token is invalid"` to everyone, a
//     live token included — so the two places that called it bare could only
//     ever read a failure, and did so without anyone noticing.
//
// Both fixes pull the same way: only a *stated* status can fail, and a status
// COROS never stated is answered by whether data arrived.
//
// Usage:
//   npm run test:coros-api-envelope
//
// Runs under Electron for the better-sqlite3 ABI, with `electron` itself faked
// so the login path can reach `safeStorage`.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Module = require("node:module");
const repoRoot = path.resolve(import.meta.dirname, "..");

const fakeElectron = {
  safeStorage: {
    isEncryptionAvailable: () => true,
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
const trainingHub = load("trainingHubService.js");

database.initializeDatabase(
  fs.mkdtempSync(path.join(os.tmpdir(), "heracles-envelope-"))
);

const { parseTrainingHubApiResponse } = trainingHub;
const USER_ID = "478751691911479296";
const HOME = "https://teamapi.coros.com";

const cases = [];
const test = (name, run) => cases.push([name, run]);

/** `assert.throws` reports but does not hand the error over, and these cases
 *  care which error it was. */
function caught(run) {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new assert.AssertionError({ message: "expected this to throw" });
}

// --- the envelope ----------------------------------------------------------

test("a stated success hands back its data", () => {
  assert.deepEqual(
    parseTrainingHubApiResponse({ result: "0000", data: { a: 1 } }),
    { a: 1 }
  );
});

// The regression. `/account/query?accountid=…` answers exactly this shape.
test("a trace id in apiCode is not a failing status", () => {
  assert.deepEqual(
    parseTrainingHubApiResponse({ apiCode: "420BE2BB", data: { a: 1 } }),
    { a: 1 },
    "COROS served the request; only the status field was missing"
  );
});

test("a four-digit apiCode is still read as a status", () => {
  assert.deepEqual(
    parseTrainingHubApiResponse({ apiCode: "0000", data: { a: 1 } }),
    { a: 1 }
  );
  assert.throws(
    () => parseTrainingHubApiResponse({ apiCode: "1005", message: "nope" }),
    /nope/,
    "narrowing apiCode must not stop it reporting the failures it does carry"
  );
});

test("an unstated status with nothing in hand is still a failure", () => {
  assert.throws(
    () => parseTrainingHubApiResponse({}),
    /COROS API request failed/
  );
  assert.throws(
    () => parseTrainingHubApiResponse({ apiCode: "420BE2BB" }, { allowEmptyData: true }),
    /COROS API request failed/,
    "allowEmptyData waves through an empty *success*, not an unanswered request"
  );
});

test("an empty stated success is what allowEmptyData is for", () => {
  assert.equal(
    parseTrainingHubApiResponse({ result: "0000" }, { allowEmptyData: true }),
    undefined
  );
  assert.throws(
    () => parseTrainingHubApiResponse({ result: "0000" }, { contextPath: "/x" }),
    /COROS \/x succeeded but returned no data/
  );
});

// `1019` is what a token killed by a sign-in elsewhere comes back as. It has to
// be recognised by code: the message beside it is English COROS may reword.
test("a dead token is recognised by its code, not its wording", () => {
  for (const result of ["0101", "0102", "1006", "1019"]) {
    const error = caught(() =>
      parseTrainingHubApiResponse({ result, message: "переведено" })
    );
    assert.equal(
      error.name,
      "InvalidTrainingHubTokenError",
      `${result} has to read as a dead token whatever the message says`
    );
  }
});

test("an ordinary failure keeps its message and stays ordinary", () => {
  const error = caught(() =>
    parseTrainingHubApiResponse({
      result: "1005",
      message: "Incorrect account or password"
    })
  );
  assert.equal(error.message, "Incorrect account or password");
  assert.notEqual(error.name, "InvalidTrainingHubTokenError");
});

// --- and the account read, which needs the id it is confirming -------------

/** Records every URL asked for, answering by longest matching substring. */
function stubCoros(routes) {
  const calls = [];
  const patterns = Object.keys(routes).sort((a, b) => b.length - a.length);
  globalThis.fetch = async (url, init) => {
    const target = String(url);
    calls.push(target);
    const pattern = patterns.find((candidate) => target.includes(candidate));
    if (!pattern) {
      throw new Error(`unexpected COROS request: ${target}`);
    }
    const answer = routes[pattern];
    const body = typeof answer === "function" ? answer(target, init) : answer;
    return { ok: true, status: 200, statusText: "OK", json: async () => body };
  };
  return {
    calls,
    countOf: (fragment) => calls.filter((t) => t.includes(fragment)).length
  };
}

const loginOk = {
  result: "0000",
  data: { accessToken: "token-1", userId: USER_ID, regionId: 1 }
};

test("the account read never goes out without an accountid", async () => {
  const coros = stubCoros({
    "/account/login": loginOk,
    "/activity/query": { result: "0000", data: { dataList: [] } },
    // The bare form is what COROS answers to nobody. If the app asks for it,
    // this is the answer it gets, and the login has to survive it.
    "/account/query": (target) =>
      target.includes("accountid=")
        ? { apiCode: "420BE2BB", data: { userId: USER_ID, unit: 0 } }
        : { result: "1019", message: "Access token is invalid" }
  });

  const { status } = await trainingHub.loginTrainingHub(
    "runner@example.com",
    "pw"
  );

  assert.equal(status.authenticated, true);
  assert.equal(status.userId, USER_ID);
  const bare = coros.calls.filter(
    (target) => target.includes("/account/query") && !target.includes("accountid=")
  );
  assert.deepEqual(bare, [], "the bare form cannot answer anyone and must not be sent");
  assert.equal(
    coros.countOf(`accountid=${USER_ID}`) > 0,
    true,
    "the id the login handed over is what the account read asks with"
  );
});

// The second probe candidate earns its place here, and only works now that it
// carries an id: the activity read is unhappy for a reason of its own, and
// without a fallback a perfectly good region would be ruled out.
test("a region is not ruled out on one unhappy endpoint", async () => {
  const coros = stubCoros({
    "/account/login": loginOk,
    "/activity/query": { result: "9999", message: "Service busy" },
    "/account/query": (target) =>
      target.includes("accountid=")
        ? { apiCode: "420BE2BB", data: { userId: USER_ID, unit: 0 } }
        : { result: "1019", message: "Access token is invalid" }
  });

  const { status } = await trainingHub.loginTrainingHub(
    "runner@example.com",
    "pw"
  );

  assert.equal(status.authenticated, true);
  assert.equal(
    status.baseUrl,
    HOME,
    "the account read answered at the home region, so that is the region"
  );
  assert.equal(
    coros.countOf("teameuapi"),
    0,
    "and no other region should have been tried at all"
  );
});

let failed = 0;
for (const [name, run] of cases) {
  try {
    await run();
    console.log("ok ", name);
  } catch (error) {
    failed += 1;
    console.error("not ok ", name);
    console.error(error);
  }
}

if (failed > 0) {
  console.error(`\n${failed} COROS envelope test(s) failed`);
  process.exit(1);
}
console.log("\nCOROS API envelope tests passed");
