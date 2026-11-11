// How an in-app .deb update's install is read off `pkexec apt-get`'s exit
// (electron/debInstallExit.ts): which endings keep Restart on the prompt and
// which send the athlete to the download page.
//
// Run: npm run test:deb-install-exit
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { classifyDebInstallExit } = await import(
  pathToFileURL(path.join(root, "electron", "debInstallExit.ts")).href + "?cacheBust=" + Date.now()
);

assert.equal(classifyDebInstallExit(0, ""), "installed");
assert.equal(classifyDebInstallExit(0, "W: some warning apt printed anyway"), "installed");

// pkexec's own codes come before anything stderr says.
assert.equal(classifyDebInstallExit(126, ""), "cancelled", "the password dialog was dismissed");
assert.equal(
  classifyDebInstallExit(126, "Error executing command as another user: Request dismissed"),
  "cancelled"
);
assert.equal(
  classifyDebInstallExit(127, "Error executing command as another user: Not authorized"),
  "failed",
  "no authorisation to be had is a failure, not a cancel: Restart would only ask again"
);
assert.equal(
  classifyDebInstallExit(127, "E: Could not get lock /var/lib/dpkg/lock-frontend"),
  "failed",
  "and stays one whatever was printed"
);

// apt's words for a lock another program holds, under LC_ALL=C.
for (const stderr of [
  "E: Could not get lock /var/lib/dpkg/lock-frontend. It is held by process 1234 (unattended-upgr)",
  "E: Unable to acquire the dpkg frontend lock (/var/lib/dpkg/lock-frontend), is another process using it?",
  "E: Unable to lock the administration directory (/var/lib/dpkg/), is another process using it?",
  "E: Unable to lock directory /var/lib/apt/lists/"
]) {
  assert.equal(classifyDebInstallExit(100, stderr), "busy", stderr);
}

// Anything else apt could not do is a failed install.
assert.equal(
  classifyDebInstallExit(100, "E: Unable to correct problems, you have held broken packages."),
  "failed"
);
assert.equal(classifyDebInstallExit(1, ""), "failed");
assert.equal(classifyDebInstallExit(null, ""), "failed", "killed by a signal: no code at all");

console.log("deb install exit OK");
