import type en from "../en/index.ts";
import common from "./common.ts";
import nav from "./nav.ts";
import settings from "./settings.ts";
import sync from "./sync.ts";
import app from "./app.ts";
import overview from "./overview.ts";
import units from "./units.ts";
import sports from "./sports.ts";
import activity from "./activity.ts";
import run from "./run.ts";
import zones from "./zones.ts";
import ride from "./ride.ts";
import hike from "./hike.ts";
import strength from "./strength.ts";
import calendar from "./calendar.ts";
import workout from "./workout.ts";
import library from "./library.ts";
import sleep from "./sleep.ts";
import map from "./map.ts";
import profile from "./profile.ts";
import records from "./records.ts";

/** Deutsch. Written by scripts/i18n-index.mjs. */
export default {
  ...common,
  ...nav,
  ...settings,
  ...sync,
  ...app,
  ...overview,
  ...units,
  ...sports,
  ...activity,
  ...run,
  ...zones,
  ...ride,
  ...hike,
  ...strength,
  ...calendar,
  ...workout,
  ...library,
  ...sleep,
  ...map,
  ...profile,
  ...records,
} satisfies Record<keyof typeof en, string>;
