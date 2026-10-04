// Builds the demo app and shoots the README's and website's screenshots into
// docs/readme, from the plan in shots.json.
//
//   npm run screenshots                       every shot
//   npm run screenshots -- 05-ride 15-places  just these
//   npm run screenshots -- --nobuild 05-ride  reuse the last build
//   npm run screenshots -- --route            the animated route, 16-route.webp
//
// The route needs Python with Pillow (encode-anim.py). See README.md here.

import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";

const here = import.meta.dirname;
const root = path.resolve(here, "..", "..");
const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => arg.startsWith("--")));
const names = args.filter((arg) => !arg.startsWith("--"));

const run = (command, commandArgs, env = {}) => {
  const result = spawnSync(command, commandArgs, { cwd: root, stdio: "inherit", env: { ...process.env, ...env } });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

if (!flags.has("--nobuild")) {
  console.log("Building the demo app…");
  run(process.execPath, [path.join(here, "build.mjs")]);
}

if (flags.has("--route")) {
  run(process.execPath, [path.join(root, "scripts/run-electron-gui.mjs"), path.join(here, "record.cjs")]);
  const python = process.platform === "win32" ? "python" : "python3";
  execFileSync(python, [path.join(here, "encode-anim.py"), path.join(root, "docs/readme/16-route.webp"), "3024", "82"], {
    cwd: root,
    stdio: "inherit",
  });
} else {
  run(process.execPath, [path.join(root, "scripts/run-electron-gui.mjs"), path.join(here, "shoot.cjs"), path.join(here, "shots.json")], {
    SHOT_ROUND: "1",
    SHOT_DIR: path.join(root, "docs/readme"),
    SHOT_ONLY: names.join(","),
  });
}
