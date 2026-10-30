// Reads COROS's strength exercise catalogue with the app's stored COROS
// session and writes exercise-catalog.json: every movement's row, cut to the
// fields the app reads from it (its identity, kind, muscle and equipment codes,
// target, one cover image and one demonstration clip). The demo answers the
// exercise catalogue from it (demoExercises.ts) through the app's own readers,
// so the Exercises Library and the strength workouts show COROS's movements as
// they are. Run it when COROS changes its catalogue or moves its media.
//
// One read-only GET; no login, nothing written to COROS, the token is never
// printed. It reads the app's database, so sign in through the app first.
//
//   node scripts/screenshots/fetch-exercise-catalog.mjs

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openSecretSetting } from "../lib/open-secret-setting.mjs";
import { appDatabasePath } from "../lib/app-user-data.mjs";

const here = import.meta.dirname;

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

// Only COROS's own media host, as the app accepts it (workoutCapabilities.ts).
const official = (value, folder) =>
  String(value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.startsWith(`https://s3.coros.com/source/${folder}/`));

const KEPT = ["originId", "exerciseId", "id", "name", "exerciseKind", "muscle", "muscleRelevance", "equipment", "targetType", "intensityValue"];
const catalog = rows
  .filter((row) => typeof row.name === "string" && /^[TS]\d+$/i.test(row.name.trim()))
  .map((row) => {
    const kept = Object.fromEntries(KEPT.filter((key) => row[key] !== undefined && row[key] !== null).map((key) => [key, row[key]]));
    const cover = [...official(row.coverUrl, "exercise_img"), ...official(row.coverUrlArrStr, "exercise_img")][0];
    const video = [...official(row.videoUrl, "exercise_gif"), ...official(row.videoUrlArrStr, "exercise_gif")][0];
    return { ...kept, ...(cover ? { coverUrlArrStr: cover } : {}), ...(video ? { videoUrl: video } : {}) };
  })
  .sort((left, right) => String(left.name).localeCompare(String(right.name)));

// One movement a line: a catalogue change reads as a change to its rows.
fs.writeFileSync(path.join(here, "exercise-catalog.json"), `[\n${catalog.map((row) => JSON.stringify(row)).join(",\n")}\n]\n`);
console.log(`COROS answered ${payload?.result ?? payload?.apiCode ?? "?"}; ${catalog.length} movements written.`);
