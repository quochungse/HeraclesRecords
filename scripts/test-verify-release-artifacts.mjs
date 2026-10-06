// The release gate (`verify-release-artifacts.mjs`) and the names it holds the
// installers to. Two things break a release without failing its build: an
// installer changed after electron-builder hashed it into latest*.yml (every
// update is then refused for a checksum mismatch), and an installer named other
// than updaterService.ts spells it (every "download manually" link 404s).
//
// Mode: plain node, no build step.
//   node scripts/test-verify-release-artifacts.mjs

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expectedInstallers, verifyPlatform } from "./verify-release-artifacts.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const version = "1.2.3";
const logger = () => {};

function writeReleaseFile(releaseDir, name, contents = `contents of ${name}`) {
  fs.writeFileSync(path.join(releaseDir, name), contents);
}

function describe(releaseDir, name) {
  const contents = fs.readFileSync(path.join(releaseDir, name));
  return {
    url: name,
    sha512: crypto.createHash("sha512").update(contents).digest("base64"),
    size: contents.length
  };
}

function writeMetadata(releaseDir, metadataFile, entries, { pathName } = {}) {
  const lines = [`version: ${version}`, "files:"];
  for (const entry of entries) {
    lines.push(`  - url: ${entry.url}`, `    sha512: ${entry.sha512}`, `    size: ${entry.size}`);
  }
  lines.push(
    `path: ${pathName ?? entries[0].url}`,
    `sha512: ${entries[0].sha512}`,
    "releaseDate: '2026-06-30T00:00:00.000Z'",
    ""
  );
  writeReleaseFile(releaseDir, metadataFile, lines.join("\n"));
}

function withReleaseDir(callback) {
  const releaseDir = fs.mkdtempSync(path.join(os.tmpdir(), "heracles-release-test-"));
  try {
    callback(releaseDir);
  } finally {
    fs.rmSync(releaseDir, { recursive: true, force: true });
  }
}

const verify = (platform, releaseDir) =>
  verifyPlatform(platform, { releaseDir, expectedVersion: version, logger });

// ---------------------------------------------------------------------------
// 1. The names come from package.json's artifactName patterns.

assert.deepEqual(
  expectedInstallers("macos", version).map((installer) => installer.name),
  [
    "HeraclesRecords-1.2.3-arm64.dmg",
    "HeraclesRecords-1.2.3-x64.dmg",
    "HeraclesRecords-1.2.3-arm64.zip",
    "HeraclesRecords-1.2.3-x64.zip"
  ]
);
assert.deepEqual(
  expectedInstallers("windows", version).map((installer) => installer.name),
  ["HeraclesRecords-Setup-1.2.3.exe"]
);
assert.deepEqual(
  expectedInstallers("linux", version).map((installer) => installer.name),
  ["HeraclesRecords-1.2.3.AppImage", "HeraclesRecords-1.2.3.deb"]
);

// ---------------------------------------------------------------------------
// 2. Every link updaterService.ts builds by hand names a file the build makes.

{
  const source = fs.readFileSync(path.join(repoRoot, "electron", "updaterService.ts"), "utf8");
  const templates = [...source.matchAll(/\/download\/v\$\{version\}\/([^`]+)`/g)].map(
    (match) => match[1]
  );
  const platformFor = { dmg: "macos", exe: "windows", AppImage: "linux" };
  assert.deepEqual(
    templates.map((template) => platformFor[template.split(".").pop()]).sort(),
    ["linux", "macos", "windows"],
    "updaterService.ts builds one manual download link per platform"
  );
  for (const template of templates) {
    const platform = platformFor[template.split(".").pop()];
    const built = expectedInstallers(platform, version).map((installer) => installer.name);
    const arches = template.includes("${arch}") ? ["arm64", "x64"] : ["x64"];
    for (const arch of arches) {
      const link = template.replaceAll("${version}", version).replaceAll("${arch}", arch);
      assert.ok(
        built.includes(link),
        `updaterService.ts links to ${link}, which the ${platform} build does not produce (it makes ${built.join(", ")})`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// 3. A complete Windows build passes.

const WINDOWS_INSTALLER = `HeraclesRecords-Setup-${version}.exe`;

withReleaseDir((releaseDir) => {
  writeReleaseFile(releaseDir, WINDOWS_INSTALLER);
  writeReleaseFile(releaseDir, `${WINDOWS_INSTALLER}.blockmap`);
  writeMetadata(releaseDir, "latest.yml", [describe(releaseDir, WINDOWS_INSTALLER)]);
  verify("windows", releaseDir);
});

// 3b. An installer changed after the metadata was written — a later signing
//     step, say — is refused, and so is a size that disagrees.
withReleaseDir((releaseDir) => {
  writeReleaseFile(releaseDir, WINDOWS_INSTALLER);
  writeReleaseFile(releaseDir, `${WINDOWS_INSTALLER}.blockmap`);
  writeMetadata(releaseDir, "latest.yml", [describe(releaseDir, WINDOWS_INSTALLER)]);
  const built = fs.readFileSync(path.join(releaseDir, WINDOWS_INSTALLER));
  writeReleaseFile(releaseDir, WINDOWS_INSTALLER, Buffer.alloc(built.length, 0x2a));
  assert.throws(() => verify("windows", releaseDir), /sha512 for HeraclesRecords-Setup-1\.2\.3\.exe does not match/);
});

withReleaseDir((releaseDir) => {
  writeReleaseFile(releaseDir, WINDOWS_INSTALLER);
  writeReleaseFile(releaseDir, `${WINDOWS_INSTALLER}.blockmap`);
  writeMetadata(releaseDir, "latest.yml", [
    { ...describe(releaseDir, WINDOWS_INSTALLER), size: 1 }
  ]);
  assert.throws(() => verify("windows", releaseDir), /states size 1 .* but the file is \d+ bytes/);
});

// 3c. An installer published under another name (electron-builder's dotted
//     default) is missing for the metadata and for the updater's link.
withReleaseDir((releaseDir) => {
  const dotted = `HeraclesRecords.Setup.${version}.exe`;
  writeReleaseFile(releaseDir, dotted);
  writeReleaseFile(releaseDir, `${dotted}.blockmap`);
  writeMetadata(releaseDir, "latest.yml", [describe(releaseDir, dotted)]);
  assert.throws(
    () => verify("windows", releaseDir),
    (error) =>
      /missing installer HeraclesRecords-Setup-1\.2\.3\.exe/.test(error.message) &&
      /references HeraclesRecords\.Setup\.1\.2\.3\.exe, which is not a name/.test(error.message)
  );
});

// 3d. The top-level path must be the first entry.
withReleaseDir((releaseDir) => {
  writeReleaseFile(releaseDir, WINDOWS_INSTALLER);
  writeReleaseFile(releaseDir, `${WINDOWS_INSTALLER}.blockmap`);
  writeMetadata(releaseDir, "latest.yml", [describe(releaseDir, WINDOWS_INSTALLER)], {
    pathName: `HeraclesRecords.Setup.${version}.exe`
  });
  assert.throws(
    () => verify("windows", releaseDir),
    /path HeraclesRecords\.Setup\.1\.2\.3\.exe does not match files\[0\]\.url HeraclesRecords-Setup-1\.2\.3\.exe/
  );
});

// ---------------------------------------------------------------------------
// 4. macOS: both architectures, dmg and zip, every one hashed. Only the zips
//    carry a blockmap: the dmg's is read by nothing and is not published.

const MAC_INSTALLERS = expectedInstallers("macos", version).map((installer) => installer.name);

withReleaseDir((releaseDir) => {
  for (const file of MAC_INSTALLERS) {
    writeReleaseFile(releaseDir, file);
    if (file.endsWith(".zip")) writeReleaseFile(releaseDir, `${file}.blockmap`);
  }
  writeMetadata(
    releaseDir,
    "latest-mac.yml",
    MAC_INSTALLERS.map((file) => describe(releaseDir, file))
  );
  verify("macos", releaseDir);
});

// 4a. A zip without its blockmap is refused: the updater's differential
//     download reads it.
withReleaseDir((releaseDir) => {
  for (const file of MAC_INSTALLERS) {
    writeReleaseFile(releaseDir, file);
  }
  writeMetadata(
    releaseDir,
    "latest-mac.yml",
    MAC_INSTALLERS.map((file) => describe(releaseDir, file))
  );
  assert.throws(
    () => verify("macos", releaseDir),
    (error) =>
      /missing blockmap HeraclesRecords-1\.2\.3-arm64\.zip\.blockmap/.test(error.message) &&
      !/dmg\.blockmap/.test(error.message)
  );
});

// 4b. A dmg named other than the updater's link spells it fails, though a dmg
//     is still there.
withReleaseDir((releaseDir) => {
  const renamed = MAC_INSTALLERS.map((file) => file.replace("-arm64.dmg", "-arm64-mac.dmg"));
  for (const file of renamed) {
    writeReleaseFile(releaseDir, file);
    writeReleaseFile(releaseDir, `${file}.blockmap`);
  }
  writeMetadata(
    releaseDir,
    "latest-mac.yml",
    renamed.filter((file) => file.endsWith(".zip")).map((file) => describe(releaseDir, file))
  );
  assert.throws(() => verify("macos", releaseDir), /missing installer HeraclesRecords-1\.2\.3-arm64\.dmg/);
});

// 4c. The metadata must list the zip the updater downloads, for each arch.
withReleaseDir((releaseDir) => {
  for (const file of MAC_INSTALLERS) {
    writeReleaseFile(releaseDir, file);
    writeReleaseFile(releaseDir, `${file}.blockmap`);
  }
  writeMetadata(
    releaseDir,
    "latest-mac.yml",
    MAC_INSTALLERS.filter((file) => !file.endsWith("-x64.zip")).map((file) =>
      describe(releaseDir, file)
    )
  );
  assert.throws(
    () => verify("macos", releaseDir),
    /does not list HeraclesRecords-1\.2\.3-x64\.zip, the file the updater downloads/
  );
});

// ---------------------------------------------------------------------------
// 5. Linux: an AppImage and a deb, both in latest-linux.yml, no blockmap file.

const APP_IMAGE = `HeraclesRecords-${version}.AppImage`;
const DEB = `HeraclesRecords-${version}.deb`;

withReleaseDir((releaseDir) => {
  writeReleaseFile(releaseDir, APP_IMAGE);
  writeReleaseFile(releaseDir, DEB);
  writeMetadata(releaseDir, "latest-linux.yml", [
    describe(releaseDir, APP_IMAGE),
    describe(releaseDir, DEB)
  ]);
  verify("linux", releaseDir);
});

// 5b. A deb the metadata leaves out cannot update a deb install.
withReleaseDir((releaseDir) => {
  writeReleaseFile(releaseDir, APP_IMAGE);
  writeReleaseFile(releaseDir, DEB);
  writeMetadata(releaseDir, "latest-linux.yml", [describe(releaseDir, APP_IMAGE)]);
  assert.throws(
    () => verify("linux", releaseDir),
    /does not list HeraclesRecords-1\.2\.3\.deb, the file the updater downloads/
  );
});

console.log("release artifact verifier tests passed");
