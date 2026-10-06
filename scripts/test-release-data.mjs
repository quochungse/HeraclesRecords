// scripts/lib/release-data.mjs: reading a GitHub release and writing the
// README's download blocks from it. No network: the releases are fixtures in
// the shape `GET /repos/{repo}/releases/latest` answers with (v1.0.0's real
// names, sizes and digests).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PLATFORMS, fetchLatestRelease, releaseFromApi, updateReadme } from "./lib/release-data.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const readme = readFileSync(join(root, "README.md"), "utf8");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

function apiRelease(version, { drop = [], extra = [], ...rest } = {}) {
  const assets = [
    [`HeraclesRecords-${version}-arm64.dmg`, 176127250, "5c0829f6"],
    [`HeraclesRecords-${version}-arm64.dmg.blockmap`, 182968],
    [`HeraclesRecords-${version}-arm64.zip`, 168449805],
    [`HeraclesRecords-${version}-x64.dmg`, 180708114, "7d904d5c"],
    [`HeraclesRecords-${version}-x64.zip`, 173081640],
    [`HeraclesRecords-${version}.AppImage`, 183695234, "9d53e372"],
    [`HeraclesRecords-Setup-${version}.exe`, 162268486, "c0440306"],
    [`HeraclesRecords-Setup-${version}.exe.blockmap`, 169081],
    ["latest-linux.yml", 382],
    ["latest-mac.yml", 839],
    ["latest.yml", 359],
    ...extra,
  ]
    .filter(([name]) => !drop.some((pattern) => pattern.test(name)))
    .map(([name, size, digest]) => ({ name, size, ...(digest ? { digest: `sha256:${digest}` } : {}) }));
  return {
    tag_name: `v${version}`,
    draft: false,
    prerelease: false,
    published_at: "2026-10-03T13:38:16Z",
    assets,
    ...rest,
  };
}

// 1. The release's four installers, in order, with the README's size labels.
//    v1.0.0 shipped no deb, and an optional installer that is absent is left
//    out rather than refused.
const v100 = releaseFromApi(apiRelease("1.0.0"));
assert.equal(v100.version, "1.0.0");
assert.deepEqual(
  v100.installers.map((entry) => [entry.id, entry.name, entry.sizeLabel]),
  [
    ["mac-arm64", "HeraclesRecords-1.0.0-arm64.dmg", "176 MB"],
    ["mac-x64", "HeraclesRecords-1.0.0-x64.dmg", "181 MB"],
    ["windows", "HeraclesRecords-Setup-1.0.0.exe", "162 MB"],
    ["linux", "HeraclesRecords-1.0.0.AppImage", "184 MB"],
  ],
);
assert.equal(
  v100.installers[2].url,
  "https://github.com/quochungse/HeraclesRecords/releases/download/v1.0.0/HeraclesRecords-Setup-1.0.0.exe",
);
assert.equal(v100.installers[0].sha256, "5c0829f6");

// 1b. A release with a deb lists it after the AppImage, in both README blocks.
const withDeb = releaseFromApi(apiRelease("1.1.0", { extra: [["HeraclesRecords-1.1.0.deb", 121000000]] }));
assert.deepEqual(
  withDeb.installers.map((entry) => entry.id),
  ["mac-arm64", "mac-x64", "windows", "linux", "linux-deb"],
);
{
  const text = updateReadme(readme, withDeb);
  assert.ok(text.includes("| **Linux** · Debian / Ubuntu (.deb) | [HeraclesRecords-1.1.0.deb]("));
  assert.ok(text.includes('<a href="https://github.com/quochungse/HeraclesRecords/releases/download/v1.1.0/HeraclesRecords-1.1.0.deb">'));
  const blocksOf = (text) => text.match(/<!-- release:(\w+):start -->[\s\S]*?<!-- release:\1:end -->/g).join("\n");
  assert.ok(!blocksOf(updateReadme(readme, v100)).includes(".deb"), "a release without a deb still names one");
}

// 2. A release missing an installer, holding two, or not yet public is refused.
assert.throws(() => releaseFromApi(apiRelease("1.0.0", { drop: [/\.AppImage$/] })), /linux installer, found 0/);
assert.throws(
  () => releaseFromApi(apiRelease("1.0.0", { extra: [["HeraclesRecords-1.0.0-copy.AppImage", 1]] })),
  /linux installer, found 2/,
);
assert.throws(
  () => releaseFromApi(apiRelease("1.0.0", { extra: [["HeraclesRecords-1.0.0.deb", 1], ["HeraclesRecords-1.0.0-copy.deb", 1]] })),
  /linux-deb installer, found 2/,
);
assert.throws(() => releaseFromApi(apiRelease("1.0.0", { prerelease: true })), /pre-release/);
assert.throws(() => releaseFromApi({ message: "Not Found" }), /Not a GitHub release/);

// 3. Each platform's pattern catches exactly the name its artifactName gives.
const named = (pattern, arch, ext) =>
  pattern.replace("${version}", "9.8.7").replace("${arch}", arch).replace("${ext}", ext);
const expected = {
  "mac-arm64": named(pkg.build.mac.artifactName, "arm64", "dmg"),
  "mac-x64": named(pkg.build.mac.artifactName, "x64", "dmg"),
  windows: named(pkg.build.nsis?.artifactName ?? pkg.build.win.artifactName, "x64", "exe"),
  linux: named(pkg.build.linux.artifactName, "x64", "AppImage"),
  "linux-deb": named(pkg.build.deb?.artifactName ?? pkg.build.linux.artifactName, "x64", "deb"),
};
for (const platform of PLATFORMS) {
  assert.ok(platform.match.test(expected[platform.id]), `${platform.id} does not match ${expected[platform.id]}`);
  for (const [other, name] of Object.entries(expected)) {
    if (other !== platform.id) assert.ok(!platform.match.test(name), `${platform.id} also matches ${name}`);
  }
}

// 4. The README carries both blocks, and writing the release it already states
//    changes nothing (run twice, the second pass is a no-op).
const once = updateReadme(readme, v100);
assert.equal(updateReadme(once, v100), once);

// 5. A new release rewrites what is between the markers and nothing else.
const v110 = releaseFromApi(apiRelease("1.1.0"));
const next = updateReadme(readme, v110);
const outside = (text) =>
  text.replace(/<!-- release:(\w+):start -->[\s\S]*?<!-- release:\1:end -->/g, "<!-- $1 -->");
assert.equal(outside(next), outside(readme));
const blocks = next.match(/<!-- release:(\w+):start -->[\s\S]*?<!-- release:\1:end -->/g).join("\n");
assert.ok(!blocks.includes("1.0.0"), "a 1.0.0 link survived the update");
assert.ok(blocks.includes("releases/download/v1.1.0/HeraclesRecords-Setup-1.1.0.exe"));
assert.ok(blocks.includes("Version 1.1.0 · [What's new](https://github.com/quochungse/HeraclesRecords/releases/tag/v1.1.0)"));
assert.ok(!outside(readme).match(/HeraclesRecords-(Setup-)?\d+\.\d+\.\d+/), "a versioned installer name sits outside the markers");

// 6. Line endings are kept, and a missing or doubled marker is refused.
const crlf = readme.replace(/\r?\n/g, "\r\n");
assert.ok(!updateReadme(crlf, v110).replace(/\r\n/g, "").includes("\n"));
assert.throws(() => updateReadme(readme.replace("<!-- release:badges:start -->", ""), v110), /release:badges/);
assert.throws(
  () => updateReadme(`${readme}\n<!-- release:downloads:start -->\n<!-- release:downloads:end -->\n`, v110),
  /release:downloads/,
);

// 7. The fetch asks for the latest release, sends a token when given one, and
//    refuses an error answer.
let asked;
await fetchLatestRelease({
  token: "t0ken",
  fetchImpl: async (url, init) => {
    asked = { url, init };
    return { ok: true, json: async () => apiRelease("1.0.0") };
  },
});
assert.equal(asked.url, "https://api.github.com/repos/quochungse/HeraclesRecords/releases/latest");
assert.equal(asked.init.headers.Authorization, "Bearer t0ken");
await assert.rejects(
  fetchLatestRelease({ token: "", fetchImpl: async () => ({ ok: false, status: 404 }) }),
  /404/,
);

console.log("release data tests passed");
