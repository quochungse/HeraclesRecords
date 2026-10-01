// Gates what one platform's build left in release/ before CI uploads it.
//
// Two readers depend on these files, and neither recovers from a mismatch.
// electron-updater downloads what latest*.yml names and refuses the download
// unless its size and sha512 agree with the metadata, so anything that touches
// an installer after electron-builder wrote the metadata — a signing step added
// later, say — breaks every update while the release itself looks fine. And
// updaterService.ts builds its download links by hand, so the installers must
// carry exactly the names package.json's artifactName patterns give them;
// `test:release-artifacts` holds those links to the same names.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultReleaseDir = path.join(repoRoot, "release");
const packageJson = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")
);
const defaultExpectedVersion = packageJson.version;

// What the dist:* scripts build: the targets and architectures they pass to
// electron-builder, and which target the updater downloads.
const PLATFORM_CHECKS = {
  macos: {
    label: "macOS",
    builderKey: "mac",
    metadataFile: "latest-mac.yml",
    arches: ["arm64", "x64"],
    exts: ["dmg", "zip"],
    updateExt: "zip",
    blockmaps: true
  },
  windows: {
    label: "Windows",
    builderKey: "win",
    metadataFile: "latest.yml",
    arches: ["x64"],
    exts: ["exe"],
    updateExt: "exe",
    blockmaps: true
  },
  linux: {
    label: "Linux",
    builderKey: "linux",
    metadataFile: "latest-linux.yml",
    arches: ["x64"],
    exts: ["AppImage"],
    updateExt: "AppImage",
    // AppImage blockmaps are embedded in the file, not written as *.AppImage.blockmap.
    blockmaps: false
  }
};

function parseArgs(argv) {
  const platform = argv[0]?.trim().toLowerCase();
  if (!platform || !PLATFORM_CHECKS[platform]) {
    throw new Error(
      `Usage: node scripts/verify-release-artifacts.mjs <macos|windows|linux>`
    );
  }
  return platform;
}

function checkFor(platform) {
  const check = PLATFORM_CHECKS[platform];
  if (!check) {
    throw new Error(
      `Unknown platform ${platform}. Expected one of: ${Object.keys(PLATFORM_CHECKS).join(", ")}`
    );
  }
  return check;
}

function fillArtifactName(pattern, values) {
  return pattern.replace(/\$\{(\w+)\}/g, (_, key) => {
    if (!(key in values)) {
      throw new Error(
        `artifactName ${pattern} uses \${${key}}, which this check does not fill in`
      );
    }
    return values[key];
  });
}

/**
 * The installers a platform's build must produce, named as package.json's
 * artifactName pattern names them, with the extension and architecture each
 * one is built for.
 */
export function expectedInstallers(platform, version, build = packageJson.build) {
  const check = checkFor(platform);
  const pattern = build?.[check.builderKey]?.artifactName;
  if (!pattern) {
    throw new Error(`package.json build.${check.builderKey}.artifactName is not set`);
  }
  const installers = new Map();
  for (const ext of check.exts) {
    for (const arch of check.arches) {
      const name = fillArtifactName(pattern, { version, arch, ext });
      installers.set(name, { name, ext, arch });
    }
  }
  return [...installers.values()];
}

function listReleaseFiles(releaseDir) {
  if (!fs.existsSync(releaseDir)) {
    throw new Error(`Release directory not found: ${releaseDir}`);
  }

  return fs.readdirSync(releaseDir).filter((entry) => {
    const fullPath = path.join(releaseDir, entry);
    return fs.statSync(fullPath).isFile();
  });
}

function cleanYamlScalar(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * Reads the shape electron-builder writes: top-level scalars, and a `files:`
 * list of `url` / `sha512` / `size` entries.
 */
function parseMetadata(contents) {
  const top = {};
  const files = [];
  let inFiles = false;
  for (const line of contents.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const topField = line.match(/^(\w+):\s*(.*)$/);
    if (topField) {
      inFiles = topField[1] === "files" && topField[2].trim() === "";
      if (!inFiles) top[topField[1]] = cleanYamlScalar(topField[2]);
      continue;
    }
    if (!inFiles) continue;
    const item = line.match(/^\s*-\s+(\w+):\s*(.*)$/);
    if (item) {
      files.push({ [item[1]]: cleanYamlScalar(item[2]) });
      continue;
    }
    const field = line.match(/^\s+(\w+):\s*(.*)$/);
    if (field && files.length > 0) {
      files[files.length - 1][field[1]] = cleanYamlScalar(field[2]);
    }
  }
  return { top, files };
}

// Read in chunks: an AppImage is several hundred megabytes.
function sha512Base64(filePath) {
  const hash = crypto.createHash("sha512");
  const buffer = Buffer.alloc(1024 * 1024);
  const fd = fs.openSync(filePath, "r");
  try {
    let read;
    while ((read = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, read));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("base64");
}

function verifyMetadata(check, metadata, installers, releaseDir, files, errors) {
  const { metadataFile } = check;
  const expectedNames = new Set(installers.map((installer) => installer.name));

  if (metadata.files.length === 0) {
    errors.push(`${metadataFile} lists no files`);
    return;
  }

  for (const entry of metadata.files) {
    const name = entry.url;
    if (!name) {
      errors.push(`${metadataFile} has a file entry with no url`);
      continue;
    }
    if (!expectedNames.has(name)) {
      errors.push(
        `${metadataFile} references ${name}, which is not a name the artifactName pattern gives`
      );
    }
    if (!files.includes(name)) {
      errors.push(`${metadataFile} references missing file ${name}`);
      continue;
    }
    const filePath = path.join(releaseDir, name);
    const size = fs.statSync(filePath).size;
    if (entry.size === undefined) {
      errors.push(`${metadataFile} states no size for ${name}`);
    } else if (Number(entry.size) !== size) {
      errors.push(
        `${metadataFile} states size ${entry.size} for ${name}, but the file is ${size} bytes`
      );
    }
    if (!entry.sha512) {
      errors.push(`${metadataFile} states no sha512 for ${name}`);
    } else if (entry.sha512 !== sha512Base64(filePath)) {
      errors.push(
        `${metadataFile} sha512 for ${name} does not match the file (was it changed after the build wrote the metadata?)`
      );
    }
  }

  // The top-level path and sha512 are what older electron-updater releases
  // read, and electron-builder writes them as a copy of the first entry.
  const first = metadata.files[0];
  if (!metadata.top.path) {
    errors.push(`${metadataFile} missing path`);
  } else if (metadata.top.path !== first.url) {
    errors.push(
      `${metadataFile} path ${metadata.top.path} does not match files[0].url ${first.url}`
    );
  }
  if (metadata.top.sha512 && metadata.top.sha512 !== first.sha512) {
    errors.push(`${metadataFile} sha512 does not match files[0].sha512`);
  }

  const listed = new Set(metadata.files.map((entry) => entry.url));
  for (const installer of installers) {
    if (installer.ext === check.updateExt && !listed.has(installer.name)) {
      errors.push(
        `${metadataFile} does not list ${installer.name}, the file the updater downloads`
      );
    }
  }
}

export function verifyPlatform(platform, options = {}) {
  const check = checkFor(platform);
  const releaseDir = options.releaseDir ?? defaultReleaseDir;
  const expectedVersion = options.expectedVersion ?? defaultExpectedVersion;
  const logger = options.logger ?? console.log;
  const installers = expectedInstallers(platform, expectedVersion, options.build);
  const files = listReleaseFiles(releaseDir);
  const errors = [];

  for (const installer of installers) {
    if (!files.includes(installer.name)) {
      errors.push(`missing installer ${installer.name}`);
    }
    if (check.blockmaps && !files.includes(`${installer.name}.blockmap`)) {
      errors.push(`missing blockmap ${installer.name}.blockmap`);
    }
  }

  const metadataPath = path.join(releaseDir, check.metadataFile);
  if (!fs.existsSync(metadataPath)) {
    errors.push(`missing ${check.metadataFile}`);
  } else {
    const metadata = parseMetadata(fs.readFileSync(metadataPath, "utf8"));
    if (!metadata.top.version) {
      errors.push(`${check.metadataFile} states no version`);
    } else if (metadata.top.version !== expectedVersion) {
      errors.push(
        `${check.metadataFile} version ${metadata.top.version} does not match package.json ${expectedVersion}`
      );
    }
    verifyMetadata(check, metadata, installers, releaseDir, files, errors);
  }

  if (errors.length > 0) {
    throw new Error(
      `${check.label} release artifacts failed verification:\n- ${errors.join("\n- ")}`
    );
  }

  logger(
    `${check.label} release artifacts verified for v${expectedVersion}.`
  );
  logger(`Found: ${files.join(", ")}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    verifyPlatform(parseArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
