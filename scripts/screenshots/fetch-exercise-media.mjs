// Reads COROS's strength exercise catalogue with the app's stored COROS
// session and writes exercise-media.json: the cover image and demonstration
// clip of each movement the demo's strength workout uses (demoLibrary.ts,
// `exercise_id`), so the Training Library shot shows them. Run it only when
// that workout changes or COROS moves its media.
//
// One read-only GET; no login, nothing written to COROS, the token is never
// printed. It reads the app's database, so sign in through the app first.
//
//   node scripts/screenshots/fetch-exercise-media.mjs

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openSecretSetting } from "../lib/open-secret-setting.mjs";
import { appDatabasePath } from "../lib/app-user-data.mjs";

const here = import.meta.dirname;
const repoRoot = path.resolve(here, "..", "..");

const used = new Set(
  [...fs.readFileSync(path.join(here, "demoLibrary.ts"), "utf8").matchAll(/"exercise_id":"(\d+)"/g)].map((match) => match[1]),
);

const db = new DatabaseSync(appDatabasePath(), { readOnly: true });
const setting = (key) => db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key)?.value ?? undefined;
const auth = {
  accessToken: openSecretSetting(setting("trainingHub.accessToken"))?.trim(),
  userId: setting("trainingHub.userId"),
  baseUrl: setting("trainingHub.baseUrl"),
};
db.close();
if (!auth.accessToken || !auth.baseUrl) {
  console.error("No stored COROS session found. Sign in through the app first.");
  process.exit(1);
}

const url = new URL(`${auth.baseUrl}/training/exercise/query`);
url.searchParams.set("sportType", "4");
if (auth.userId) url.searchParams.set("userId", auth.userId);
url.searchParams.set("keyword", "");
const response = await fetch(url, {
  headers: {
    accesstoken: auth.accessToken,
    Accept: "application/json, text/plain, */*",
    yfheader: JSON.stringify({ userId: auth.userId }),
  },
});
const payload = await response.json();
const data = payload?.data;
const rows = Array.isArray(data) ? data : Object.values(data ?? {}).find((value) => Array.isArray(value)) ?? [];

const names = JSON.parse(fs.readFileSync(path.join(repoRoot, "src/training/exerciseNames.json"), "utf8"));
const official = (value, folder) =>
  String(value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.startsWith(`https://s3.coros.com/source/${folder}/`));

const exercises = rows
  .filter((row) => used.has(String(row.id ?? row.exerciseId ?? "")))
  .map((row) => {
    const code = String(row.name ?? row.exerciseName ?? "");
    return {
      id: String(row.id ?? row.exerciseId),
      name: names[code] ?? code,
      code,
      coverUrls: [...official(row.coverUrl, "exercise_img"), ...official(row.coverUrlArrStr, "exercise_img")].slice(0, 1),
      videoUrls: [...official(row.videoUrl, "exercise_gif"), ...official(row.videoUrlArrStr, "exercise_gif")].slice(0, 1),
    };
  });

fs.writeFileSync(path.join(here, "exercise-media.json"), `${JSON.stringify(exercises, null, 1)}\n`);
console.log(`COROS answered ${payload?.result ?? payload?.apiCode ?? "?"}; ${exercises.length} of ${used.size} demo exercises written.`);
