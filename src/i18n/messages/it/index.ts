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

/** Italiano. Written by scripts/i18n-index.mjs. */
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
} satisfies Record<keyof typeof en, string>;
