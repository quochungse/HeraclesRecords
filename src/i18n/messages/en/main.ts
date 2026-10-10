import { SCREEN_TEXT_EN } from "../../../../electron/screenText.ts";
import type { Translation } from "../../types.ts";

/**
 * What the main process writes itself, and what the modules both processes
 * share write: errors over IPC, dialog titles, a plan's checks, a version's
 * changes. Written out in `electron/screenText.ts`, because the main process
 * reads it from there; each language's is `electron/i18n/<locale>.ts`.
 */
const main = { ...SCREEN_TEXT_EN };

export default main;
export type MainMessages = Translation<typeof main>;
