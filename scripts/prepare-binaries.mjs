// Fetches the binaries the app ships with: yt-dlp, ffmpeg, a self-contained
// CPython, and the ytmusicapi package.
//
// **This runs on every `npm run dev`**, through `dev:electron`, which is why it
// has to be cheap and has to be robust. It used to be neither: every start
// re-downloaded ~120 MB from GitHub, and because `concurrently -k` kills the
// whole dev command when one half exits non-zero, a single flaky connection
// took the Vite server down with it. One transient
// `ConnectTimeoutError: github.com:443` was enough to make the app
// unstartable.
//
// So each step now records what it produced in `.prepared.json` beside the
// binaries and skips itself when disk and manifest already agree — a warm run
// touches the network not at all. What still has to download retries a few
// times before giving up, and honours a proxy if one is configured, because
// Node's fetch does not do that on its own.

import fs from "node:fs";
import path from "node:path";
import { execFile, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { gunzip } from "node:zlib";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";

const require = createRequire(import.meta.url);
const execFileAsync = promisify(execFile);
const gunzipAsync = promisify(gunzip);
const repoRoot = path.resolve(import.meta.dirname, "..");
const userAgent = "coroslink";
const PINNED_YT_DLP_VERSION = "2026.08.19";
const PINNED_YTMUSICAPI_VERSION = "1.12.1";
const BUNDLED_PYTHON_VERSION = "310";
// Self-contained CPython shipped with the app so users don't need Python
// installed. Sourced from astral-sh/python-build-standalone (relocatable,
// "install_only" flavor). Override the release tag with PYTHON_STANDALONE_TAG.
const BUNDLED_PYTHON_RUNTIME_VERSION = "3.11.13";
const PINNED_PYTHON_STANDALONE_TAG = "20250612";

/** How many times a download is attempted before the step fails. The failure
 *  that prompted all this was a 10-second connect timeout that worked on the
 *  next try. */
const DOWNLOAD_ATTEMPTS = 3;
const RETRY_BASE_MS = 1_000;

/** Records what is already on disk, so a warm run can skip every step. Written
 *  per step rather than once at the end: a run that fails halfway keeps credit
 *  for what it did finish, which matters precisely because the thing that fails
 *  here is the network. */
const MANIFEST_NAME = ".prepared.json";

ensureProxyAwareRuntime();

const options = parseArgs(process.argv.slice(2));
const targetPlatform = options.platform ?? process.platform;
const targetArch = options.arch ?? process.arch;
const targetKey = `${targetPlatform}-${targetArch}`;
const outputDir = path.join(repoRoot, "bin", targetKey);

const ytDlpAsset = resolveYtDlpAsset(targetPlatform, targetArch);
const ytDlpOutput = targetPlatform === "win32" ? "yt-dlp.exe" : "yt-dlp";
const ffmpegOutput = targetPlatform === "win32" ? "ffmpeg.exe" : "ffmpeg";

await fs.promises.mkdir(outputDir, { recursive: true });

const manifestPath = path.join(outputDir, MANIFEST_NAME);
const manifest = await readManifest(manifestPath);
let skipped = 0;

await downloadYtDlp(path.join(outputDir, ytDlpOutput), ytDlpAsset);
await copyFfmpeg(path.join(outputDir, ffmpegOutput), targetPlatform, targetArch);
await installPythonRuntime(
  path.join(outputDir, "python-runtime"),
  targetPlatform,
  targetArch
);
await installPythonPackages(path.join(outputDir, "python"));

console.log(
  `Prepared bundled binaries in ${path.relative(repoRoot, outputDir)}` +
    (skipped > 0 ? ` (${skipped} already up to date)` : "")
);

// --- Caching -----------------------------------------------------------------

/**
 * Whether a step can be skipped.
 *
 * Both halves are needed. The manifest says what was produced; `artifacts` are
 * checked because a manifest can outlive the files it describes — someone
 * deletes `python-runtime/`, or a half-extracted archive leaves the directory
 * empty — and a stale claim of readiness is worse than re-downloading.
 */
async function isCurrent(step, want, artifacts) {
  if (options.force) return false;
  if (JSON.stringify(manifest[step]) !== JSON.stringify(want)) return false;

  for (const artifact of artifacts) {
    if (!(await exists(artifact))) return false;
  }
  return true;
}

/** Record a finished step. Read back from disk first so two runs for different
 *  platforms cannot clobber each other's entries. */
async function recordStep(step, want) {
  manifest[step] = want;
  const onDisk = await readManifest(manifestPath);
  await fs.promises.writeFile(
    manifestPath,
    `${JSON.stringify({ ...onDisk, [step]: want }, null, 2)}\n`,
    "utf8"
  );
}

async function readManifest(file) {
  try {
    const parsed = JSON.parse(await fs.promises.readFile(file, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    // Absent, or written by something else. Either way: prepare everything.
    return {};
  }
}

async function exists(target) {
  try {
    const stat = await fs.promises.stat(target);
    // An empty directory is not a prepared one — pip and tar both leave one
    // behind when they fail partway.
    if (stat.isDirectory()) {
      return (await fs.promises.readdir(target)).length > 0;
    }
    return stat.size > 0;
  } catch {
    return false;
  }
}

function skip(step, detail) {
  skipped += 1;
  if (options.verbose) console.log(`Up to date: ${step} (${detail})`);
}

/**
 * Re-exec with `--use-env-proxy` when a proxy is configured and Node is not
 * using it.
 *
 * Node's `fetch` ignores `HTTPS_PROXY`/`HTTP_PROXY` unless told otherwise, and
 * the flag is read at bootstrap, so setting the variable from inside the
 * process is too late — the only way from here is to start again. Behind a
 * corporate proxy the alternative is a connect timeout to github.com that looks
 * exactly like the network being down.
 *
 * Guarded on `allowedNodeEnvironmentFlags` so an older Node that has never
 * heard of the flag is left alone rather than failing to start, and on an own
 * marker variable so a re-exec cannot re-exec.
 */
function ensureProxyAwareRuntime() {
  const proxy =
    process.env.HTTPS_PROXY ??
    process.env.https_proxy ??
    process.env.HTTP_PROXY ??
    process.env.http_proxy;
  if (!proxy) return;
  if (process.env.NODE_USE_ENV_PROXY || process.env.HERACLES_PROXY_REEXEC) {
    return;
  }
  if (process.execArgv.includes("--use-env-proxy")) return;
  if (!process.allowedNodeEnvironmentFlags.has("--use-env-proxy")) return;

  const result = spawnSync(
    process.execPath,
    ["--use-env-proxy", process.argv[1], ...process.argv.slice(2)],
    {
      stdio: "inherit",
      env: { ...process.env, HERACLES_PROXY_REEXEC: "1" }
    }
  );
  process.exit(result.status ?? 1);
}

function parseArgs(args) {
  return args.reduce((parsed, arg) => {
    if (arg.startsWith("--platform=")) {
      parsed.platform = arg.slice("--platform=".length);
    } else if (arg.startsWith("--arch=")) {
      parsed.arch = arg.slice("--arch=".length);
    } else if (arg === "--force") {
      // Re-fetch everything, manifest or not. For pulling a moved release tag,
      // or repairing a directory that looks intact but is not.
      parsed.force = true;
    } else if (arg === "--verbose") {
      parsed.verbose = true;
    }

    return parsed;
  }, {});
}

function resolveYtDlpAsset(platform, arch) {
  if (platform === "darwin") {
    return "yt-dlp_macos";
  }

  if (platform === "win32") {
    if (arch === "arm64") {
      return "yt-dlp_arm64.exe";
    }

    if (arch === "ia32" || arch === "x32") {
      return "yt-dlp_x86.exe";
    }

    return "yt-dlp.exe";
  }

  if (platform === "linux") {
    if (arch === "arm64") {
      return "yt-dlp_linux_aarch64";
    }

    return "yt-dlp_linux";
  }

  throw new Error(`Unsupported yt-dlp platform: ${platform}-${arch}`);
}

async function downloadYtDlp(destination, assetName) {
  // `latest` resolves through the GitHub API, so it must not be cached — asking
  // for the newest release and being handed last week's would be a lie.
  const pinned = (process.env.YT_DLP_VERSION?.trim() || PINNED_YT_DLP_VERSION) !== "latest";
  // Resolved before the cache is consulted, so the manifest is compared against
  // the version actually wanted. Comparing against the constant instead made
  // `YT_DLP_VERSION=<other>` a no-op once the manifest held the default, and
  // made every run re-download ~30 MB once it held anything else. For a pinned
  // version this touches no network.
  const version = await resolveYtDlpVersion();
  if (pinned) {
    const want = { version, asset: assetName };
    if (await isCurrent("ytDlp", want, [destination])) {
      skip("yt-dlp", `${want.version} (${assetName})`);
      return;
    }
  }

  const url = `https://github.com/yt-dlp/yt-dlp/releases/download/${version}/${assetName}`;

  await downloadFile(url, destination);
  await fs.promises.chmod(destination, 0o755);
  if (pinned) await recordStep("ytDlp", { version, asset: assetName });
  console.log(`Downloaded yt-dlp ${version} (${assetName})`);
}

async function resolveYtDlpVersion() {
  const requested = process.env.YT_DLP_VERSION?.trim();

  if (!requested || requested === PINNED_YT_DLP_VERSION) {
    return PINNED_YT_DLP_VERSION;
  }

  if (requested !== "latest") {
    return requested;
  }

  const releaseResponse = await fetch(
    "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest",
    { headers: githubApiHeaders() }
  );

  if (!releaseResponse.ok) {
    throw new Error(
      `Could not read yt-dlp release metadata: ${releaseResponse.status} ${releaseResponse.statusText}`
    );
  }

  const release = await releaseResponse.json();
  return release.tag_name;
}

function githubApiHeaders() {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": userAgent,
    "X-GitHub-Api-Version": "2022-11-28"
  };

  const token = process.env.GITHUB_TOKEN?.trim();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

async function copyFfmpeg(destination, platform, arch) {
  const { version } = require("ffmpeg-static/package.json");
  const cross = platform !== process.platform || arch !== process.arch;
  const want = { package: version, platform, arch, source: cross ? "release" : "node_modules" };

  // Even the local copy is worth skipping: it is an 80 MB file copy, and it ran
  // on every single dev start.
  if (await isCurrent("ffmpeg", want, [destination])) {
    skip("ffmpeg", `ffmpeg-static ${version}`);
    return;
  }

  if (cross) {
    await downloadFfmpegStatic(destination, platform, arch);
    await recordStep("ffmpeg", want);
    return;
  }

  const ffmpegPath = require("ffmpeg-static");
  if (!ffmpegPath || !fs.existsSync(ffmpegPath)) {
    throw new Error("ffmpeg-static did not provide an executable path.");
  }

  await fs.promises.copyFile(ffmpegPath, destination);
  await fs.promises.chmod(destination, 0o755);
  await recordStep("ffmpeg", want);
  console.log(`Copied ffmpeg-static binary from ${path.relative(repoRoot, ffmpegPath)}`);
}

async function installPythonPackages(destination) {
  const want = {
    ytmusicapi: PINNED_YTMUSICAPI_VERSION,
    pythonVersion: BUNDLED_PYTHON_VERSION
  };
  if (
    await isCurrent("pythonPackages", want, [
      destination,
      path.join(destination, "ytmusicapi")
    ])
  ) {
    skip("python packages", `ytmusicapi ${want.ytmusicapi}`);
    return;
  }

  const python = await findPythonCommand();
  if (!python) {
    throw new Error(
      "Python 3.10+ is required to vendor ytmusicapi. Install Python and rerun npm run binaries:prepare."
    );
  }

  await fs.promises.rm(destination, { recursive: true, force: true });
  await fs.promises.mkdir(destination, { recursive: true });

  const args = [
    "-m",
    "pip",
    "install",
    "--disable-pip-version-check",
    "--upgrade",
    "--ignore-installed",
    "--no-compile",
    "--target",
    destination,
    "--only-binary=:all:",
    "--implementation",
    "py",
    "--abi",
    "none",
    "--platform",
    "any",
    "--python-version",
    BUNDLED_PYTHON_VERSION,
    `ytmusicapi==${PINNED_YTMUSICAPI_VERSION}`
  ];

  try {
    const { stdout } = await execFileAsync(python, args, {
      cwd: repoRoot,
      env: {
        ...process.env,
        PIP_ROOT_USER_ACTION: "ignore"
      },
      maxBuffer: 10 * 1024 * 1024
    });
    const summary = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(-3)
      .join(" ");
    await recordStep("pythonPackages", want);
    console.log(
      `Vendored ytmusicapi ${PINNED_YTMUSICAPI_VERSION} in ${path.relative(repoRoot, destination)}${summary ? ` (${summary})` : ""}`
    );
  } catch (error) {
    const stderr =
      typeof error === "object" &&
      error !== null &&
      "stderr" in error &&
      typeof error.stderr === "string"
        ? error.stderr.trim()
        : "";
    const detail = stderr ? `\n${stderr}` : "";
    throw new Error(`Could not vendor ytmusicapi with pip.${detail}`);
  }
}

async function installPythonRuntime(destination, platform, arch) {
  const triple = resolvePythonStandaloneTriple(platform, arch);
  const tag = process.env.PYTHON_STANDALONE_TAG?.trim() || PINNED_PYTHON_STANDALONE_TAG;
  const assetName = `cpython-${BUNDLED_PYTHON_RUNTIME_VERSION}+${tag}-${triple}-install_only.tar.gz`;
  const url = `https://github.com/astral-sh/python-build-standalone/releases/download/${tag}/${assetName}`;

  const want = { version: BUNDLED_PYTHON_RUNTIME_VERSION, tag, triple };
  // The interpreter itself, not just the directory: a torn extraction leaves a
  // tree that exists and does not run.
  const interpreter = path.join(
    destination,
    platform === "win32" ? "python.exe" : "bin/python3"
  );
  if (await isCurrent("pythonRuntime", want, [destination, interpreter])) {
    skip("python-runtime", `CPython ${want.version} (${triple})`);
    return;
  }

  // Downloaded before anything is removed, so a failure here leaves the working
  // runtime from last time in place. This is what saved the vault the day the
  // connect timeout struck.
  const archive = await downloadBuffer(url);
  const parentDir = path.dirname(destination);
  const extractRoot = path.join(parentDir, ".python-runtime-tmp");

  await fs.promises.rm(destination, { recursive: true, force: true });
  await fs.promises.rm(extractRoot, { recursive: true, force: true });
  await fs.promises.mkdir(extractRoot, { recursive: true });

  const archivePath = path.join(parentDir, ".python-runtime.tar.gz");
  await fs.promises.writeFile(archivePath, archive);

  try {
    // The archive extracts to a top-level "python/" directory. Use the system
    // tar (macOS/Linux, and bsdtar on Windows 10+) to preserve executable bits.
    await execFileAsync("tar", ["-xzf", archivePath, "-C", extractRoot]);
    await fs.promises.rename(path.join(extractRoot, "python"), destination);
  } finally {
    await fs.promises.rm(archivePath, { force: true });
    await fs.promises.rm(extractRoot, { recursive: true, force: true });
  }

  await recordStep("pythonRuntime", want);
  console.log(
    `Vendored CPython ${BUNDLED_PYTHON_RUNTIME_VERSION} (${triple}) in ${path.relative(
      repoRoot,
      destination
    )}`
  );
}

function resolvePythonStandaloneTriple(platform, arch) {
  if (platform === "darwin") {
    return arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin";
  }

  if (platform === "win32") {
    return "x86_64-pc-windows-msvc";
  }

  if (platform === "linux") {
    return arch === "arm64"
      ? "aarch64-unknown-linux-gnu"
      : "x86_64-unknown-linux-gnu";
  }

  throw new Error(`Unsupported Python runtime platform: ${platform}-${arch}`);
}

async function findPythonCommand() {
  for (const command of ["python3", "python"]) {
    try {
      const { stdout } = await execFileAsync(
        command,
        [
          "-c",
          "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"
        ],
        { timeout: 5000 }
      );
      const [major, minor] = stdout.trim().split(".").map(Number);
      if (major > 3 || (major === 3 && minor >= 10)) {
        return command;
      }
    } catch {
      // Try the next candidate.
    }
  }

  return undefined;
}

async function downloadFfmpegStatic(destination, platform, arch) {
  const packageMetadata = require("ffmpeg-static/package.json");
  const ffmpegMetadata = packageMetadata["ffmpeg-static"];
  const release =
    process.env[ffmpegMetadata["binary-release-tag-env-var"]] ??
    ffmpegMetadata["binary-release-tag"];
  const baseUrl =
    process.env[ffmpegMetadata["binaries-url-env-var"]] ??
    "https://github.com/eugeneware/ffmpeg-static/releases/download";
  const url = `${baseUrl}/${release}/${ffmpegMetadata["executable-base-name"]}-${platform}-${arch}.gz`;

  const compressed = await downloadBuffer(url);
  await fs.promises.writeFile(destination, await gunzipAsync(compressed));
  await fs.promises.chmod(destination, 0o755);
  console.log(`Downloaded ffmpeg-static ${release} (${platform}-${arch})`);
}

async function downloadFile(url, destination) {
  const buffer = await downloadBuffer(url);
  const tempFile = `${destination}.tmp`;
  await fs.promises.writeFile(tempFile, buffer);
  await fs.promises.rename(tempFile, destination);
}

/**
 * Fetch with retries.
 *
 * A connect timeout to github.com is usually gone a second later, and treating
 * the first one as fatal is what let a blip stop the whole dev command. A 4xx
 * is not retried: a missing release asset will still be missing.
 */
class HttpStatusError extends Error {
  constructor(url, response) {
    super(`Could not download ${url}: ${response.status} ${response.statusText}`);
    this.name = "HttpStatusError";
    this.status = response.status;
  }
}

async function downloadBuffer(url) {
  let lastError;

  for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        redirect: "follow",
        headers: { "User-Agent": userAgent }
      });

      if (!response.ok || !response.body) {
        const failure = new HttpStatusError(url, response);
        // A missing asset will still be missing in a second. Only a server-side
        // or transport failure is worth another attempt.
        if (failure.status < 500) throw failure;
        lastError = failure;
      } else {
        return Buffer.from(await response.arrayBuffer());
      }
    } catch (error) {
      // Carried by type rather than sniffed out of the message: a 4xx that
      // slipped through would cost three ten-second timeouts on every run, and
      // nothing would say why.
      if (error instanceof HttpStatusError && error.status < 500) throw error;
      lastError = error;
    }

    if (attempt < DOWNLOAD_ATTEMPTS) {
      const wait = RETRY_BASE_MS * 2 ** (attempt - 1);
      const reason =
        lastError instanceof Error
          ? (lastError.cause?.code ?? lastError.message)
          : String(lastError);
      console.warn(
        `Download attempt ${attempt}/${DOWNLOAD_ATTEMPTS} failed (${reason}); retrying in ${wait}ms`
      );
      await delay(wait);
    }
  }

  throw lastError;
}
