/**
 * Launch a test that needs a real Electron window.
 *
 * The four renderer-harness suites used to be launched by `cross-env
 * ELECTRON_RUN_AS_NODE= electron`, which sets the variable to the empty string
 * rather than removing it — and Electron reads it differently on each side:
 * on POSIX it checks the value is non-empty, on Windows only that the name is
 * present. So on Windows every one of them entered Node mode with no snapshot
 * and died before a line of the test ran, on a native assertion
 * (`isolate_data->snapshot_data()) != nullptr`) that names nothing to do with
 * the suite.
 *
 * `delete process.env.X` removes the name on both, which is the only spelling
 * that means the same thing everywhere. Being a launcher rather than a shell
 * incantation, it also survives the environments that inject
 * ELECTRON_RUN_AS_NODE=1 into every tool call.
 *
 * Usage: node scripts/run-electron-gui.mjs scripts/test-X.mjs [args...]
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const electron = require("electron");

if (typeof electron !== "string") {
  console.error(
    "electron did not resolve to an executable path — run `npm install` first"
  );
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("usage: node scripts/run-electron-gui.mjs <script> [args...]");
  process.exit(1);
}

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, args, { stdio: "inherit", env });
child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
