import { spawn, spawnSync } from "node:child_process";
import { readFileSync, promises as fs } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { app, BrowserWindow, shell } from "electron";
import { autoUpdater } from "electron-updater";
import { getSetting, setSetting } from "./database";
import type { AppUpdateSnapshot } from "./types";
import { ScreenError } from "./screenText";

const AUTO_CHECK_KEY = "updater.autoCheck";
const AUTO_DOWNLOAD_KEY = "updater.autoDownload";

let mainWindow: BrowserWindow | undefined;
let listenersRegistered = false;
let staleUpdateCleanupStarted = false;
/** The installer electron-updater left in its cache, from `update-downloaded`. */
let downloadedFile: string | undefined;
let snapshot: AppUpdateSnapshot = {
  supported: false,
  currentVersion: app.getVersion(),
  status: "idle",
  autoCheck: true,
  autoDownload: true
};

function readBooleanSetting(key: string, fallback: boolean): boolean {
  try {
    const value = getSetting(key);
    return value === undefined ? fallback : value === "true";
  } catch {
    return fallback;
  }
}

function isUpdaterEnabled(): boolean {
  return app.isPackaged && !process.env.VITE_DEV_SERVER_URL;
}

function isMacAdHocSigned(): boolean {
  if (process.platform !== "darwin") {
    return false;
  }

  // `codesign -d` writes what it displays to stderr and exits 0, so stdout is
  // empty: reading only stdout called every ad-hoc build signed, and
  // Squirrel.Mac then refused the update without a word, since an ad-hoc
  // signature cannot satisfy the next build's designated requirement.
  const result = spawnSync("codesign", ["-dv", process.execPath], {
    encoding: "utf8"
  });
  const combined = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;

  return (
    combined.includes("Signature=adhoc") ||
    combined.includes("code object is not signed at all") ||
    combined.includes("code has no resources but signature indicates they must be present")
  );
}

/**
 * The site's download page, which lists the latest release's installers:
 * where every update the app cannot install itself sends the athlete — an
 * ad-hoc signed Mac, a Linux install that failed, a download that 404s.
 */
const DOWNLOAD_PAGE_URL = "https://heraclesrecords.com/download";

/**
 * How a downloaded update reaches the disk on this machine.
 *
 * Linux is the one that matters. electron-updater installs a .deb from inside
 * `quitAndInstall` with `spawnSync` — `pkexec dpkg -i`, then `apt-get -f` when
 * that fails — so the main process sat blocked through the password dialog and
 * the whole of dpkg, with the window still on screen and answering nothing.
 * Linux lets a package or an AppImage be replaced under a running app, so both
 * are put in place here, asynchronously, while the app keeps running, and the
 * restart that follows is an ordinary relaunch. Anything else Linux could be
 * (rpm, pacman) stays on electron-updater's own path.
 */
type LinuxInstallRoute = "appimage" | "deb" | "updater";

function linuxInstallRoute(): LinuxInstallRoute {
  if (process.env.APPIMAGE) {
    return "appimage";
  }

  try {
    // electron-builder writes this next to app-update.yml for deb/rpm/pacman;
    // it is how electron-updater itself picks DebUpdater.
    const type = readFileSync(
      path.join(process.resourcesPath, "package-type"),
      "utf8"
    ).trim();
    return type === "deb" ? "deb" : "updater";
  } catch {
    return "updater";
  }
}

function formatUpdaterError(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Could not check for updates.";

  if (message.includes("404")) {
    const version = snapshot.availableVersion;
    // No version yet means the check itself found nothing: no release has
    // been published for this platform (true of every build before the first
    // one), not a download that failed.
    if (!version) {
      return `No published release was found to check against. Downloads are at ${DOWNLOAD_PAGE_URL}.`;
    }
    return `Update download failed. Download Heracles Records ${version} from ${DOWNLOAD_PAGE_URL}`;
  }

  return message;
}

function resolveInstallDetails(): Pick<
  AppUpdateSnapshot,
  "installMethod" | "manualInstallUrl" | "installNeedsPassword"
> {
  if (process.platform === "darwin" && isMacAdHocSigned()) {
    return {
      installMethod: "manual",
      manualInstallUrl: DOWNLOAD_PAGE_URL
    };
  }

  return {
    installMethod: "restart",
    manualInstallUrl: undefined,
    installNeedsPassword:
      process.platform === "linux" && linuxInstallRoute() === "deb"
  };
}

function getUpdaterBaseCacheDir(): string {
  if (process.platform === "win32") {
    return process.env.LOCALAPPDATA ?? path.join(homedir(), "AppData", "Local");
  }

  if (process.platform === "darwin") {
    return path.join(homedir(), "Library", "Caches");
  }

  return process.env.XDG_CACHE_HOME ?? path.join(homedir(), ".cache");
}

async function getUpdaterCacheDirName(): Promise<string> {
  try {
    const config = await fs.readFile(
      path.join(process.resourcesPath, "app-update.yml"),
      "utf8"
    );
    const match = config.match(/^updaterCacheDirName:\s*(\S+)\s*$/m);
    if (match) {
      return match[1];
    }
  } catch {
    // fall through to electron-updater's default
  }

  return app.getName();
}

function parseVersion(value: string): [number, number, number] | undefined {
  const match = value.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return undefined;
  }

  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function isVersionNewerThanCurrent(version: [number, number, number]): boolean {
  const current = parseVersion(app.getVersion());
  if (!current) {
    return false;
  }

  for (let i = 0; i < 3; i++) {
    if (version[i] !== current[i]) {
      return version[i] > current[i];
    }
  }

  return false;
}

/**
 * electron-updater leaves the downloaded installer in the cache dir's
 * "pending" folder after the update is installed, and only clears it when
 * the next release starts downloading. On Windows that duplicates the
 * ~100MB installer already kept at the cache root as "installer.exe" for
 * differential downloads (which must be preserved). See issue #33.
 */
async function cleanupInstalledUpdateCache(): Promise<void> {
  try {
    const pendingDir = path.join(
      getUpdaterBaseCacheDir(),
      await getUpdaterCacheDirName(),
      "pending"
    );

    try {
      const raw = await fs.readFile(
        path.join(pendingDir, "update-info.json"),
        "utf8"
      );
      const fileName = (JSON.parse(raw) as { fileName?: unknown }).fileName;
      if (typeof fileName === "string") {
        const pendingVersion = parseVersion(fileName);
        if (pendingVersion && isVersionNewerThanCurrent(pendingVersion)) {
          // Downloaded but not installed yet — keep it.
          return;
        }
      }
    } catch {
      // No readable update-info.json: anything left here is an orphaned
      // partial download, safe to remove.
    }

    await fs.rm(pendingDir, { recursive: true, force: true });
  } catch {
    // Cleanup is best-effort; never block updater startup.
  }
}

function publishSnapshot(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("app:updateStatus", snapshot);
  }
}

function setSnapshot(next: Partial<AppUpdateSnapshot>): void {
  snapshot = { ...snapshot, ...next };
  publishSnapshot();
}

export function getAppUpdateSnapshot(): AppUpdateSnapshot {
  return { ...snapshot };
}

function registerAutoUpdaterListeners(): void {
  if (listenersRegistered) {
    return;
  }

  listenersRegistered = true;
  // Applying an update is always an explicit choice from the update prompt or
  // update controls. In particular, choosing "Not now" must not silently
  // install the already-downloaded update when the app later quits.
  autoUpdater.autoInstallOnAppQuit = false;
  // Include notes for every release newer than the installed version so users
  // who skip one or more versions still see the complete changelog.
  autoUpdater.fullChangelog = true;

  autoUpdater.on("checking-for-update", () => {
    setSnapshot({ status: "checking", error: undefined });
  });

  autoUpdater.on("update-available", (info) => {
    setSnapshot({
      status: "available",
      availableVersion: info.version,
      releaseNotes: formatReleaseNotes(info.releaseNotes),
      error: undefined
    });
  });

  autoUpdater.on("update-not-available", (info) => {
    setSnapshot({
      status: "not-available",
      availableVersion: info.version,
      error: undefined
    });
  });

  autoUpdater.on("download-progress", (progress) => {
    setSnapshot({
      status: "downloading",
      downloadPercent: progress.percent
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    downloadedFile = info.downloadedFile;
    setSnapshot({
      installFailure: undefined,
      status: "downloaded",
      availableVersion: info.version,
      downloadPercent: 100,
      error: undefined,
      ...resolveInstallDetails()
    });
  });

  autoUpdater.on("error", (error) => {
    setSnapshot({
      status: "error",
      error: formatUpdaterError(error)
    });
  });
}

export function initializeAppUpdater(window: BrowserWindow): void {
  mainWindow = window;

  const autoCheck = readBooleanSetting(AUTO_CHECK_KEY, true);
  const autoDownload = readBooleanSetting(AUTO_DOWNLOAD_KEY, true);

  if (!isUpdaterEnabled()) {
    snapshot = {
      supported: false,
      currentVersion: app.getVersion(),
      status: "idle",
      autoCheck,
      autoDownload
    };
    return;
  }

  snapshot = {
    supported: true,
    currentVersion: app.getVersion(),
    status: "idle",
    autoCheck,
    autoDownload
  };

  registerAutoUpdaterListeners();
  autoUpdater.autoDownload = autoDownload;
  publishSnapshot();

  if (!staleUpdateCleanupStarted) {
    staleUpdateCleanupStarted = true;
    void cleanupInstalledUpdateCache();
  }

  if (autoCheck) {
    setTimeout(() => {
      void checkForAppUpdates();
    }, 5000);
  }
}

export async function checkForAppUpdates(): Promise<AppUpdateSnapshot> {
  if (!isUpdaterEnabled()) {
    return getAppUpdateSnapshot();
  }

  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    setSnapshot({ status: "error", error: formatUpdaterError(error) });
  }

  return getAppUpdateSnapshot();
}

export async function downloadAppUpdate(): Promise<AppUpdateSnapshot> {
  if (!isUpdaterEnabled()) {
    return getAppUpdateSnapshot();
  }

  if (
    snapshot.status === "downloading" ||
    snapshot.status === "downloaded" ||
    snapshot.status === "installing"
  ) {
    return getAppUpdateSnapshot();
  }

  try {
    setSnapshot({ status: "downloading", downloadPercent: 0, error: undefined });
    await autoUpdater.downloadUpdate();
  } catch (error) {
    setSnapshot({ status: "error", error: formatUpdaterError(error) });
  }

  return getAppUpdateSnapshot();
}

export function setUpdaterPreferences(prefs: {
  autoCheck?: boolean;
  autoDownload?: boolean;
}): AppUpdateSnapshot {
  const next: Partial<AppUpdateSnapshot> = {};

  if (typeof prefs.autoCheck === "boolean") {
    setSetting(AUTO_CHECK_KEY, String(prefs.autoCheck));
    next.autoCheck = prefs.autoCheck;
  }

  if (typeof prefs.autoDownload === "boolean") {
    setSetting(AUTO_DOWNLOAD_KEY, String(prefs.autoDownload));
    next.autoDownload = prefs.autoDownload;
    if (isUpdaterEnabled()) {
      autoUpdater.autoDownload = prefs.autoDownload;
    }
  }

  setSnapshot(next);
  return getAppUpdateSnapshot();
}

export async function quitAndInstallUpdate(): Promise<{
  installMethod: "restart" | "manual";
}> {
  if (!isUpdaterEnabled()) {
    throw new ScreenError("main.update.installedOnly");
  }

  if (snapshot.status !== "downloaded" || !snapshot.availableVersion) {
    throw new Error(
      `Update is not ready to install yet (status: ${snapshot.status}).`
    );
  }

  if (snapshot.installMethod === "manual") {
    await shell.openExternal(snapshot.manualInstallUrl ?? DOWNLOAD_PAGE_URL);
    return { installMethod: "manual" };
  }

  if (process.platform === "linux") {
    const route = linuxInstallRoute();
    if (route !== "updater" && downloadedFile) {
      // Answered at once: the install runs on, reported through the snapshot,
      // and ends in a relaunch — or back at "downloaded" with the reason.
      void installOnLinux(route, downloadedFile);
      return { installMethod: "restart" };
    }
  }

  setImmediate(() => {
    // Silent on Windows: the NSIS wizard used to open over a closed app and
    // ask again everything the first install had settled. `--updated /S`
    // reinstalls into the same directory with no pages, and `--force-run`
    // opens the app again when it is done. macOS ignores both — Squirrel has
    // staged the new bundle already and only swaps it on the way out.
    autoUpdater.quitAndInstall(true, true);
  });

  return { installMethod: "restart" };
}

class LinuxInstallCancelled extends Error {}
/** Another program held dpkg's lock past the wait — the system's own updates, usually. */
class LinuxInstallBusy extends Error {}

async function installOnLinux(
  route: Exclude<LinuxInstallRoute, "updater">,
  file: string
): Promise<void> {
  setSnapshot({ status: "installing", error: undefined, installFailure: undefined });

  try {
    if (route === "deb") {
      await installDebPackage(file);
      // dpkg replaced the files in place, so the same path is the new build.
      app.relaunch({ args: process.argv.slice(1) });
    } else {
      relaunchAppImageAfterExit(await installAppImage(file));
    }
    app.quit();
  } catch (error) {
    console.warn("[updater] could not install the update", error);
    // Back to ready, so Restart can be pressed again: a dismissed password
    // dialog or the system busy with its own updates is the usual way here,
    // and neither is a failed update. The renderer words it, in the language
    // on screen.
    setSnapshot({
      status: "downloaded",
      installFailure:
        error instanceof LinuxInstallCancelled
          ? "cancelled"
          : error instanceof LinuxInstallBusy
            ? "busy"
            : "failed",
      manualInstallUrl: DOWNLOAD_PAGE_URL
    });
  }
}

/** apt's words, under `LC_ALL=C`, for a lock another program still holds. */
const DPKG_LOCK_HELD =
  /Could not get lock|Unable to acquire the dpkg frontend lock|Unable to lock (the administration )?directory/;

/**
 * One `pkexec` authorisation, one apt-get: it installs the package and any
 * dependency it lacks in one step, and waits up to five minutes for dpkg's
 * lock. unattended-upgrades holds that lock for minutes after a boot, and
 * dpkg, which never waits, failed on it outright. The path travels as `$1`,
 * never inside the script, so no quoting can break it; `LC_ALL=C` keeps apt's
 * errors in the English `DPKG_LOCK_HELD` reads.
 */
function installDebPackage(file: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "pkexec",
      [
        "--disable-internal-agent",
        "/bin/sh",
        "-c",
        'LC_ALL=C exec apt-get install -y -o DPkg::Lock::Timeout=300 "$1"',
        "sh",
        file
      ],
      { stdio: ["ignore", "ignore", "pipe"] }
    );
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-2000);
    });
    child.on("error", (error) => {
      reject(
        (error as NodeJS.ErrnoException).code === "ENOENT"
          ? new Error("pkexec is not installed")
          : error
      );
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else if (code === 126 || code === 127) {
        // pkexec: the dialog was dismissed (126) or the password refused (127).
        reject(new LinuxInstallCancelled("pkexec authorisation was not given"));
      } else if (DPKG_LOCK_HELD.test(stderr)) {
        reject(new LinuxInstallBusy(`dpkg is locked by another program: ${stderr.trim()}`));
      } else {
        reject(new Error(`apt-get exited with ${code}: ${stderr.trim()}`));
      }
    });
  });
}

/**
 * Puts the new AppImage where the running one is. The running copy is a FUSE
 * mount of the file's old inode, so replacing the path under it is safe; the
 * copy goes to a sibling first and is renamed into place, so a full disk never
 * leaves a half-written AppImage where the app is launched from.
 *
 * electron-updater's naming rule is kept: a file named with its version is
 * replaced by one named with the new version, and a file the user renamed
 * keeps its name.
 */
async function installAppImage(file: string): Promise<string> {
  const current = process.env.APPIMAGE;
  if (!current || !path.isAbsolute(current)) {
    throw new Error("APPIMAGE is not set");
  }

  const currentName = path.basename(current);
  const destination =
    path.basename(file) === currentName || !/\d+\.\d+\.\d+/.test(currentName)
      ? current
      : path.join(path.dirname(current), path.basename(file));
  const staging = path.join(
    path.dirname(destination),
    `.${path.basename(destination)}.updating`
  );

  try {
    await fs.copyFile(file, staging);
    await fs.chmod(staging, 0o755);
    await fs.rename(staging, destination);
  } catch (error) {
    await fs.rm(staging, { force: true }).catch(() => undefined);
    throw error;
  }

  if (destination !== current) {
    await fs.rm(current, { force: true });
  }

  return destination;
}

/**
 * Starts the new AppImage once this process has gone.
 *
 * Not `app.relaunch()`: Electron's relauncher is this executable, which in an
 * AppImage lives inside the FUSE mount the AppImage runtime takes down as soon
 * as the app exits — the helper that is meant to outlive the app would be
 * running from a filesystem that is no longer there. Nor a spawn of the new
 * AppImage right now, as electron-updater does: it would start while this one
 * still holds the single-instance lock, find it taken and quit. So a shell
 * from outside the mount waits for this pid to end, then runs the new file.
 */
function relaunchAppImageAfterExit(appImage: string): void {
  const child = spawn(
    "/bin/sh",
    [
      "-c",
      'while kill -0 "$1" 2>/dev/null; do sleep 0.2; done; shift; exec "$@"',
      "sh",
      String(process.pid),
      appImage,
      ...process.argv.slice(1)
    ],
    { detached: true, stdio: "ignore" }
  );
  child.unref();
}

function formatReleaseNotes(
  releaseNotes:
    | string
    | Array<{ version?: string; note?: string | null }>
    | null
    | undefined
): string | undefined {
  if (!releaseNotes) {
    return undefined;
  }

  if (typeof releaseNotes === "string") {
    return releaseNotes;
  }

  const sections = releaseNotes.flatMap((entry) => {
    const note = entry.note?.trim();
    if (!note) {
      return [];
    }

    return entry.version
      ? [`## Version ${entry.version}\n\n${note}`]
      : [note];
  });

  return sections.length > 0 ? sections.join("\n\n") : undefined;
}
