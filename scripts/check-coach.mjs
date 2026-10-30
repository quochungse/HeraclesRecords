// One command for local reviews and PR checks. Build each target once, then
// invoke the test files directly: their individual npm commands rebuild it.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const root = path.resolve(import.meta.dirname, "..");
const logs = path.join(root, ".work", "check-coach");
const require = createRequire(import.meta.url);
const electron = require("electron");
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Run this check with npm run check:coach.");

const npmStep = (name, script) => ({ name, command: process.execPath, args: [npmCli, "run", script] });
const nodeTest = (name) => ({ name, command: process.execPath, args: [`scripts/test-${name}.mjs`] });
const electronTest = (name, stripTypes = false) => ({
  name,
  command: electron,
  args: [
    ...(stripTypes ? ["--experimental-strip-types", "--import", "./scripts/register-ts-ext.mjs"] : []),
    `scripts/test-${name}.mjs`
  ],
  env: { ELECTRON_RUN_AS_NODE: "1" }
});
const rendererTest = (name) => ({
  name, command: process.execPath, args: ["scripts/run-electron-gui.mjs", `scripts/test-${name}.mjs`]
});

const steps = [
  npmStep("build-electron", "build:electron"),
  npmStep("build-renderer", "build:renderer"),
  npmStep("build-renderer-harness", "build:renderer-harness"),
  ...["css-tokens", "design-vocabulary", "sync-policy", "ipc-surface"].map(nodeTest),
  electronTest("i18n", true),
  ...["chat-service", "model-catalog", "chat-context-compaction", "coach-analysis-store",
    "coach-analysis-runner", "training-plan-generation", "claude-code-provider", "anthropic-provider"].map(nodeTest),
  electronTest("chatgpt-effort"),
  electronTest("conversation-settings"),
  electronTest("plan-generator-model", true),
  nodeTest("coach-provider-bundle"),
  rendererTest("coach-providers-renderer"),
  rendererTest("coach-analysis-renderer")
];

// Remove only this command's old logs, so a failed early build cannot leave a
// previous successful test's output in the CI artifact.
fs.rmSync(logs, { recursive: true, force: true });
fs.mkdirSync(logs, { recursive: true });
const started = Date.now();

async function run(step) {
  console.log(`\n[check:coach] ${step.name}`);
  const log = fs.createWriteStream(path.join(logs, `${step.name}.log`));
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(step.command, step.args, {
        cwd: root, env: { ...process.env, HERACLES_CHECK_COACH: "1", ...step.env },
        stdio: ["ignore", "pipe", "pipe"]
      });
      child.stdout.on("data", (chunk) => { process.stdout.write(chunk); log.write(chunk); });
      child.stderr.on("data", (chunk) => { process.stderr.write(chunk); log.write(chunk); });
      child.on("error", reject);
      child.on("close", (code, signal) => {
        if (code === 0) resolve();
        else reject(new Error(`${step.name} failed (${signal ?? `exit ${code}`}). Log: ${path.relative(root, log.path)}`));
      });
    });
  } finally {
    await new Promise((resolve) => log.end(resolve));
  }
}

// GitHub shows a job's log and artifacts only to a signed-in viewer, its
// annotations to anyone: the failed step's last lines go there, so a red run
// says why on its summary page.
function annotateFailure(step) {
  if (process.env.GITHUB_ACTIONS !== "true") return;
  let text = "";
  try { text = fs.readFileSync(path.join(logs, `${step.name}.log`), "utf8"); } catch { /* no log yet */ }
  const tail = text.replace(/\x1b\[[0-9;]*m/g, "").trimEnd().split(/\r?\n/).slice(-60).join("\n");
  const escape = (value) => value.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  console.log(`::error title=${step.name} failed::${escape(tail || "(the step wrote nothing)")}`);
}

let current;
try {
  for (const step of steps) {
    current = step;
    await run(step);
  }
  console.log(`\n[check:coach] Passed ${steps.length - 3} checks after 3 builds in ${((Date.now() - started) / 1000).toFixed(1)}s.`);
} catch (error) {
  console.error(`\n[check:coach] ${error.message}`);
  annotateFailure(current);
  process.exitCode = 1;
}
