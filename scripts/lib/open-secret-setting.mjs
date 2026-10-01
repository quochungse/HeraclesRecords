// Reads a credential setting the way the app stores it (`electron/secretSettings.ts`):
// `enc:v1:` + a `safeStorage` ciphertext, or a plain value written before 1.0.
//
// The live-API probes (`verify-*.mjs`) read the COROS session from the app's
// database. Since the token is encrypted at rest only Electron can open it —
// `safeStorage` needs the full runtime, not `ELECTRON_RUN_AS_NODE` — so an
// encrypted value is handed to a short Electron process that prints it.

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const ENCRYPTED_PREFIX = "enc:v1:";
const require = createRequire(import.meta.url);

export function openSecretSetting(value) {
  if (!value || !value.startsWith(ENCRYPTED_PREFIX)) return value;
  const electron = require("electron");
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  return execFileSync(
    electron,
    [path.join(import.meta.dirname, "open-secret-setting.cjs"), value.slice(ENCRYPTED_PREFIX.length)],
    { env, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }
  );
}
