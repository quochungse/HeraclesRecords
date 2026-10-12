import { useCallback, useEffect, useRef, useState } from "react";
import type { AppUpdateSnapshot } from "../../electron/types";

/**
 * The developer toolbar's "Test update": a fake update that walks the same
 * screens a real one does — the available prompt, a download whose progress
 * moves (so the Settings button's glyph climbs), the restart prompt, and on
 * Linux the install that runs inside the app — for each way an update ends on
 * each platform. Nothing is downloaded and nothing quits; where the real app
 * would leave, the simulation says so and ends as though it had come back on
 * the new version.
 *
 * Development builds only, so its words stay English (skipped by
 * scripts/lib/i18n-coverage.mjs).
 */
export type UpdateScenario =
  | "mac"
  | "mac-manual"
  | "windows"
  | "linux-deb"
  | "linux-deb-cancel"
  | "linux-deb-fail"
  | "linux-appimage"
  | "download-fail";

interface ScenarioSpec {
  label: string;
  detail: string;
  platform: "darwin" | "win32" | "linux";
  installMethod: "restart" | "manual";
  installNeedsPassword?: boolean;
  /** What Restart does: leave (macOS, Windows) or install in the app (Linux). */
  install: "quit" | "linux" | "linux-cancel-once" | "linux-fail";
  downloadFails?: boolean;
}

export const UPDATE_SCENARIOS: Record<UpdateScenario, ScenarioSpec> = {
  mac: {
    label: "macOS",
    detail: "Signed build: Squirrel swaps the app on restart.",
    platform: "darwin",
    installMethod: "restart",
    install: "quit",
  },
  "mac-manual": {
    label: "macOS ad-hoc",
    detail: "Unsigned build: the DMG opens in the browser.",
    platform: "darwin",
    installMethod: "manual",
    install: "quit",
  },
  windows: {
    label: "Windows",
    detail: "Silent NSIS install, then the app reopens.",
    platform: "win32",
    installMethod: "restart",
    install: "quit",
  },
  "linux-deb": {
    label: "Linux deb",
    detail: "Password, install inside the app, relaunch.",
    platform: "linux",
    installMethod: "restart",
    installNeedsPassword: true,
    install: "linux",
  },
  "linux-deb-cancel": {
    label: "Linux deb · cancelled",
    detail: "The password dialog is dismissed once; Restart again succeeds.",
    platform: "linux",
    installMethod: "restart",
    installNeedsPassword: true,
    install: "linux-cancel-once",
  },
  "linux-deb-fail": {
    label: "Linux deb · fails",
    detail: "dpkg fails; the prompt offers the download instead.",
    platform: "linux",
    installMethod: "restart",
    installNeedsPassword: true,
    install: "linux-fail",
  },
  "linux-appimage": {
    label: "Linux AppImage",
    detail: "The file is swapped in place, then the app relaunches.",
    platform: "linux",
    installMethod: "restart",
    install: "linux",
  },
  "download-fail": {
    label: "Download fails",
    detail: "The download stops part-way with an error.",
    platform: "darwin",
    installMethod: "restart",
    install: "quit",
    downloadFails: true,
  },
};

export const UPDATE_SCENARIO_ORDER = Object.keys(UPDATE_SCENARIOS) as UpdateScenario[];

const DOWNLOAD_TICK_MS = 180;
const INSTALL_MS = 3000;

interface SimulationState {
  scenario: UpdateScenario;
  snapshot: AppUpdateSnapshot;
  /** Restart presses so far, for the scenario that fails only the first. */
  installAttempts: number;
}

interface StartOptions {
  base: AppUpdateSnapshot;
  version: string;
  previousVersion: string;
  releaseNotes?: string;
}

interface UpdateSimulationCallbacks {
  onMessage: (message: string) => void;
  /** Where the real app would have quit or relaunched; the caller tidies up. */
  onFinished: () => void;
}

export function useUpdateSimulation({ onMessage, onFinished }: UpdateSimulationCallbacks) {
  const [state, setState] = useState<SimulationState | null>(null);
  const timers = useRef<number[]>([]);
  const stateRef = useRef(state);
  stateRef.current = state;
  const callbacks = useRef({ onMessage, onFinished });
  callbacks.current = { onMessage, onFinished };

  const stopTimers = useCallback(() => {
    for (const id of timers.current) {
      window.clearTimeout(id);
      window.clearInterval(id);
    }
    timers.current = [];
  }, []);

  useEffect(() => stopTimers, [stopTimers]);

  const patch = useCallback((next: Partial<AppUpdateSnapshot>) => {
    setState((current) =>
      current ? { ...current, snapshot: { ...current.snapshot, ...next } } : current,
    );
  }, []);

  const download = useCallback(() => {
    const current = stateRef.current;
    if (!current || current.snapshot.status !== "available") {
      return;
    }

    const spec = UPDATE_SCENARIOS[current.scenario];
    let percent = 0;
    patch({ status: "downloading", downloadPercent: 0, error: undefined });
    const id = window.setInterval(() => {
      percent = Math.min(100, percent + 3 + Math.random() * 6);
      if (spec.downloadFails && percent >= 55) {
        stopTimers();
        patch({ status: "error", error: "Simulated: the download stopped at 55%." });
        return;
      }
      if (percent >= 100) {
        stopTimers();
        patch({
          status: "downloaded",
          downloadPercent: 100,
          installMethod: spec.installMethod,
          installNeedsPassword: spec.installNeedsPassword,
          manualInstallUrl:
            spec.installMethod === "manual"
              ? "https://github.com/quochungse/HeraclesRecords/releases"
              : undefined,
          installFailure: undefined,
        });
        return;
      }
      patch({ downloadPercent: percent });
    }, DOWNLOAD_TICK_MS);
    timers.current.push(id);
  }, [patch, stopTimers]);

  const start = useCallback(
    (scenario: UpdateScenario, options: StartOptions) => {
      stopTimers();
      const next: SimulationState = {
        scenario,
        installAttempts: 0,
        snapshot: {
          supported: true,
          currentVersion: options.previousVersion,
          status: "available",
          availableVersion: options.version,
          releaseNotes: options.releaseNotes,
          autoCheck: options.base.autoCheck,
          autoDownload: options.base.autoDownload,
        },
      };
      stateRef.current = next;
      setState(next);
      // As electron-updater does: with auto-download on, the download starts
      // on its own, before the prompt is answered.
      if (options.base.autoDownload) {
        download();
      }
    },
    [download, stopTimers],
  );

  const clear = useCallback(() => {
    stopTimers();
    stateRef.current = null;
    setState(null);
  }, [stopTimers]);

  const finish = useCallback(
    (message: string) => {
      clear();
      callbacks.current.onMessage(message);
      callbacks.current.onFinished();
    },
    [clear],
  );

  /** Restart pressed. Returns false when nothing was waiting to install. */
  const install = useCallback(() => {
    const current = stateRef.current;
    if (!current || current.snapshot.status !== "downloaded") {
      return false;
    }

    const spec = UPDATE_SCENARIOS[current.scenario];
    const version = current.snapshot.availableVersion ?? "";

    if (spec.installMethod === "manual") {
      callbacks.current.onMessage(
        "Simulated: the DMG download page would open in the browser. The update stays ready.",
      );
      return true;
    }

    if (spec.install === "quit") {
      finish(
        spec.platform === "win32"
          ? `Simulated: the app would close, NSIS would install ${version} silently and reopen it.`
          : `Simulated: the app would quit, Squirrel would swap in ${version} and reopen it.`,
      );
      return true;
    }

    const attempt = current.installAttempts + 1;
    setState((s) => (s ? { ...s, installAttempts: attempt } : s));
    patch({ status: "installing", installFailure: undefined });
    const id = window.setTimeout(() => {
      if (spec.install === "linux-fail") {
        patch({
          status: "downloaded",
          installFailure: "failed",
          manualInstallUrl: "https://github.com/quochungse/HeraclesRecords/releases",
        });
        return;
      }
      if (spec.install === "linux-cancel-once" && attempt === 1) {
        patch({ status: "downloaded", installFailure: "cancelled" });
        return;
      }
      finish(`Simulated: ${version} is installed and the app would relaunch now.`);
    }, INSTALL_MS);
    timers.current.push(id);
    return true;
  }, [finish, patch]);

  const setPreferences = useCallback(
    (prefs: Pick<AppUpdateSnapshot, "autoCheck" | "autoDownload">) => patch(prefs),
    [patch],
  );

  return {
    scenario: state?.scenario ?? null,
    snapshot: state?.snapshot ?? null,
    platform: state ? UPDATE_SCENARIOS[state.scenario].platform : undefined,
    start,
    clear,
    download,
    install,
    setPreferences,
  };
}
