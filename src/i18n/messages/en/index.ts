import common from "./common.ts";
import nav from "./nav.ts";
import settings from "./settings.ts";
import sync from "./sync.ts";

/**
 * English, the source every other language is translated from. A key added
 * here is a type error in every other language until it is translated there,
 * so `npm run build` is what catches a missing one; `npm run test:i18n` checks
 * that what each translation says keeps the same placeholders and tags.
 */
const en = {
  ...common,
  ...nav,
  ...settings,
  ...sync,
};

export default en;
