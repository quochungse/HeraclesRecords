// Bake the app's Google OAuth client into the build.
//
// googleOAuth.ts cannot read `process.env` at runtime in a packaged app: the
// build is a plain `tsc` with no substitution step, and an installed app has
// none of the build machine's environment. So the values are written into a
// generated module instead, before the compiler runs.
//
// The generated file is **git-ignored on purpose**. A tracked file holding real
// credentials in a public repository is one `git commit -a` away from being
// published, so it is regenerated on every build rather than kept. When the
// environment carries nothing — which is every build from source — the file is
// still written, with empty values, so the compiler always has something to
// read and the app cleanly reports that no Google client is configured.
//
// None of this is protecting the credential from a determined reader. A desktop
// client secret ships inside every binary and can be extracted in a minute;
// Google's desktop client type assumes exactly that, which is why PKCE is what
// actually secures the flow. The point here is only to keep it out of a public
// repository and away from the bots that scrape them.

import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const target = path.join(
  repoRoot,
  "electron",
  "sync",
  "googleClientCredentials.ts"
);

/**
 * Read a git-ignored `.env` at the repo root, so a developer sets the client
 * once instead of prefixing every command.
 *
 * Hand-parsed rather than pulling in a dependency: two `KEY=value` lines do not
 * justify one, and the parsing that matters here is only "ignore comments,
 * strip optional quotes". A real environment variable always wins, which is how
 * CI — where there is no file — keeps working unchanged.
 */
function readDotEnv() {
  const file = path.join(repoRoot, ".env");
  if (!fs.existsSync(file)) return {};

  const values = {};
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    const raw = trimmed.slice(separator + 1).trim();
    values[key] = raw.replace(/^(['"])(.*)\1$/, "$2");
  }
  return values;
}

const dotEnv = readDotEnv();
const fromEnv = (name) => process.env[name] || dotEnv[name] || "";

const clientId = fromEnv("HERACLES_GOOGLE_OAUTH_ID");
const clientKey = fromEnv("HERACLES_GOOGLE_OAUTH_KEY");

/** Refuse anything that would not survive being written into a TS string. */
function sanitise(value, label) {
  if (/["'`\\\r\n]/.test(value)) {
    throw new Error(
      `${label} contains a character that cannot be embedded (quote, backslash or newline).`
    );
  }
  return value;
}

const contents = `// GENERATED FILE — do not edit, do not commit.
//
// Written by scripts/prepare-google-client.mjs before every compile. Empty in a
// build from source, which is why the app disables the Google Drive option
// rather than offering something that cannot work.

export const BUNDLED_CLIENT_ID = "${sanitise(clientId, "Google client id")}";
export const BUNDLED_CLIENT_KEY = "${sanitise(clientKey, "Google client key")}";
`;

// Only rewrite when it would change: an untouched mtime keeps tsc from
// recompiling the world on every test run.
const existing = fs.existsSync(target)
  ? fs.readFileSync(target, "utf8")
  : null;

if (existing !== contents) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents, "utf8");
}

const configured = Boolean(clientId && clientKey);
console.log(
  configured
    ? `google client: bundled from ${
        process.env.HERACLES_GOOGLE_OAUTH_ID ? "the environment" : ".env"
      }`
    : "google client: none set — add a .env at the repo root or export the " +
        "variables; Drive sync will otherwise be offered only to users who " +
        "supply their own client"
);
