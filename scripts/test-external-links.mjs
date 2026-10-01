// Which links may reach the operating system, and what a Coach answer says a
// link points at. `electron/externalLinks.ts` is the only check between a URL
// in the page and `shell.openExternal`: a relative link in an answer resolves
// to `file://` in a packaged build, so a link reading "Open plan" could launch
// a program. Each refusal below is a way that used to get through.
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const { openableExternalUrl, isWebUrl, linkDestination } = await import(
  `${pathToFileURL(path.join(repoRoot, "dist-electron", "externalLinks.js")).href}?cacheBust=${Date.now()}`
);

for (const url of [
  "https://www.strava.com/activities/1",
  "http://localhost:11434/v1",
  "mailto:coach@example.com"
]) {
  assert.ok(openableExternalUrl(url), `${url} opens`);
}

for (const url of [
  "/C:/Windows/System32/calc.exe", // relative: file:// in a packaged build
  "//attacker/share", // protocol-relative: an SMB request on Windows
  "file:///etc/passwd",
  "javascript:alert(1)",
  "data:text/html,<script>alert(1)</script>",
  "vscode://file/etc/hosts",
  "smb://attacker/share",
  "",
  undefined,
  null
]) {
  assert.equal(openableExternalUrl(url), null, `${String(url)} is refused`);
}

assert.equal(isWebUrl("https://music.apple.com"), true);
assert.equal(isWebUrl("mailto:coach@example.com"), false, "a mail link is not a page a webview may load");
assert.equal(isWebUrl("about:blank"), false);

assert.equal(linkDestination("https://www.strava.com/activities/1"), "strava.com", "named without www.");
assert.equal(linkDestination("https://support.coros.com/hc"), "support.coros.com");
assert.equal(linkDestination("mailto:coach@example.com"), "coach@example.com");
assert.equal(linkDestination("/C:/Windows/System32/calc.exe"), null, "a link that cannot open names nowhere");

console.log("external link tests passed");
