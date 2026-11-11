// How an in-app .deb install ended, read off what `pkexec apt-get` left:
// its exit code and the last of its stderr. Free of imports, so a suite can
// reach it without Electron (`npm run test:deb-install-exit`).

/** `installFailure` on the update's snapshot, or done. */
export type DebInstallOutcome = "installed" | "cancelled" | "busy" | "failed";

/** apt's words, under `LC_ALL=C`, for a lock another program still holds. */
const DPKG_LOCK_HELD =
  /Could not get lock|Unable to acquire the dpkg frontend lock|Unable to lock (the administration )?directory/;

/**
 * - 0: installed.
 * - 126: pkexec's dialog was dismissed — Restart can be pressed again.
 * - 127: pkexec could not get authorisation at all. That is also a desktop with
 *   no agent to ask for the password, where asking again never helps, so it is
 *   a failure and the athlete is sent to the download page — never "cancelled",
 *   which told them to restart for ever.
 * - anything else with apt's lock message: the system is installing its own
 *   updates ("busy"), and the lock outlasted the five minutes apt waited.
 */
export function classifyDebInstallExit(code: number | null, stderr: string): DebInstallOutcome {
  if (code === 0) return "installed";
  if (code === 126) return "cancelled";
  if (code === 127) return "failed";
  return DPKG_LOCK_HELD.test(stderr) ? "busy" : "failed";
}
