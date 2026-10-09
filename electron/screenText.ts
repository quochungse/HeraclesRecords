/**
 * Text the main process, and the node-free modules both processes share, put
 * in front of the athlete — in English here, and in the language on screen
 * wherever someone has said what that is.
 *
 * Two routes, because the two processes know different things:
 *
 * - **A shared module** (`trainingPlanGeneration.ts`, `trainingPlanDomain.ts`,
 *   `planDiff.ts`, …) runs in the renderer, where it is on screen, and in the
 *   main process, where its sentences go to the model. It calls `screenText`,
 *   which answers in English until a translator is installed — and only the
 *   renderer installs one (`src/i18n/screenTextHooks.ts`). So the model keeps
 *   reading English, as it reads Coach's prompt, and the screen does not.
 * - **The main process's own errors** are thrown as a `ScreenError`: its
 *   `message` is English, so the diagnostics log, an issue report, a tool's
 *   answer and every `/sign in/i` test keep working, and it carries the key
 *   it was written from. The IPC adapter (`diagnosticIpcMain`) logs it as it
 *   is and re-throws it in the athlete's language (`mainText.ts`), which the
 *   renderer tells the main process through `app:setLanguage`.
 *
 * English is written out in this file, and it has no value imports, because
 * suites that run without the `.ts` resolver hook load it through
 * `src/i18n/core.ts`. Every other language is `electron/i18n/<locale>.ts`,
 * re-exported to the renderer as its `main` namespace.
 *
 * Not everything thrown here is screen text. An error that only a bug can
 * reach — a malformed id, a day not in `YYYYMMDD`, a database that was never
 * opened — stays a plain English `Error`: translating it would tell nobody
 * anything they could act on.
 */
import type { Translation } from "./i18nTypes";

export const SCREEN_TEXT_EN = {
  // The COROS account
  "main.coros.enterCredentials": "Enter your COROS email and password.",
  "main.coros.noVerification": "No COROS verification is in progress. Start again.",
  "main.coros.enterCode": "Enter the 6-digit verification code sent to your email.",
  "main.coros.incompleteChallenge": "COROS returned an incomplete two-factor login challenge.",
  "main.coros.noToken": "COROS answered the sign-in without a usable session. Try again.",
  "main.coros.noUserId": "COROS answered the sign-in without an account id. Try again.",
  "main.coros.noAccessToken": "COROS verification did not return an access token.",
  "main.coros.passwordFailed": "COROS password login failed ({result}): {message}",
  "main.coros.signInFirst": "Log in to COROS Training Hub first.",
  "main.coros.sessionExpired": "COROS session expired. Log in again.",
  "main.coros.zoneNeedsMaxHr": "COROS needs a max heart rate before it can use this zone model.",
  "main.coros.zoneNeedsRestingHr": "COROS needs a resting heart rate before it can use this zone model.",
  "main.coros.zoneNeedsLthr": "COROS needs a lactate threshold heart rate before it can use this zone model.",
  "main.coros.zonesMissingMaxHr": "COROS has no max heart rate zones to carry into this model.",
  "main.coros.zonesMissingReserve": "COROS has no heart-rate reserve zones to carry into this model.",
  "main.coros.zonesMissingLthr": "COROS has no lactate threshold zones to carry into this model.",
  "main.coros.nickname": "A nickname is 1 to 64 characters.",
  "main.coros.birthday": "Enter the birthday as a real date.",
  "main.coros.noFileUrl": "COROS did not return a file for this activity.",
  "main.coros.fileType": "COROS takes a .fit or .tcx file, not .{ext}.",
  "main.coros.uploadFailed": "Uploading the file to COROS failed ({detail}).",
  "main.coros.importRejected": "COROS did not import the file: {detail}",
  "main.coros.noMetrics": "COROS did not return the workout's figures.",
  "main.coros.workoutNotLoaded": "The workout could not be loaded from COROS.",
  "main.coros.scheduledNotFound": "The scheduled workout is no longer on its original day.",
  "main.coros.scheduledNotOnCalendar": "The scheduled workout is no longer on your COROS calendar.",
  "main.coros.noProgram": "COROS did not return the scheduled workout.",
  "main.coros.noEstimate": "COROS did not return an estimate for the scheduled workout.",
  "main.coros.pastReadOnly": "A workout on a day that has passed can't be changed.",
  "main.coros.changedReload": "This workout changed on COROS. Open it again before continuing.",
  "main.coros.changedReloadSave": "This workout changed on COROS. Open it again before saving.",
  "main.coros.sportUnsupported": "This editor can't change a workout of this sport (COROS sport {type}).",
  "main.coros.libraryNotFound": "That workout is no longer in your library.",
  "main.coros.beforeToday": "COROS does not allow scheduling workouts before today.",
  "main.coros.noProgramData": "The scheduled workout has nothing COROS can move.",
  "main.coros.nothingDeleted": "Nothing was deleted.",
  "main.coros.noActivities": "No COROS activities were found to export.",
  "main.coros.mcpNotConnected": "COROS MCP is not connected.",
  // Plans on COROS
  "main.plan.needsName": "A COROS plan needs a name.",
  "main.plan.needsSession": "A COROS plan needs at least one session.",
  "main.plan.needsDay": "Every session needs a day in the plan.",
  "main.plan.sessionGone": "A session is no longer in this plan. Open it again before saving.",
  "main.plan.notReturned": "COROS did not return that plan.",
  "main.plan.noId": "COROS accepted the plan but returned no id for it.",
  "main.plan.deleted": "This plan was deleted on COROS.",
  "main.plan.copyMissing": "COROS made the copy but did not return it.",
  "main.plan.alreadyOnCalendar": "This plan is already on the calendar. Take it off before adding it again.",
  "main.plan.workoutNotReturned": "COROS did not return that workout.",
  "main.plan.notOnCoros": "That plan is not on COROS.",
  "main.plan.deleteOnCalendar": "This plan is on the calendar. Take it off the calendar to delete it.",
  "main.plan.chooseStart": "Choose a start day.",
  "main.plan.draftGone": "That draft is no longer in your library.",
  "main.plan.coachPlanGone": "That Coach plan is not available here.",
  "main.plan.notOnCalendar": "This plan is not on the calendar.",
  "main.plan.noStartDay": "The calendar copy of this plan has no start day.",
  "main.plan.noRunningCopy": "This plan has no copy on the calendar to update.",
  "main.plan.selectWorkout": "Select at least one workout to delete.",
  "main.plan.sessionNotOnCalendar": "That session is no longer in the plan on the calendar.",
  "main.plan.beforePlanStart": "A plan's session can't move to before the week the plan starts in.",
  // Coach
  "main.coach.briefUnreadable": "That brief could not be read.",
  "main.coach.briefGone": "That brief is no longer in this conversation.",
  "main.coach.briefIsPlan": "This brief has become a plan; change the plan instead.",
  "main.coach.noOutline": "This brief has no outline yet.",
  "main.coach.outlineUnreadable": "That outline could not be read.",
  "main.coach.outlineFirst": "Draw the outline first: the sessions are written to it.",
  "main.coach.outlineMisfit": "The outline no longer fits the brief: {problem} Adjust or redraw it first.",
  "main.coach.changeNewer": "This proposal was written by a newer version of the app; update to change it here.",
  "main.coach.changeGone": "This proposal is gone — its conversation may have been deleted on another device.",
  "main.coach.changeApplying": "These changes are already being applied.",
  "main.coach.changeLineGone": "That change is not in this proposal any more.",
  "main.coach.changeWait": "These changes are being applied; wait for them to finish.",
  "main.coach.openRouterKey": "Add an OpenRouter API key in Coach settings first.",
  "main.coach.secureStorage": "This system has no secure storage for keys, so the key could not be saved.",
  "main.coach.chatgptExpired": "ChatGPT session expired. Sign in again.",
  "main.coach.chatgptSignIn": "Sign in with ChatGPT first.",
  "main.coach.chatgptWindowClosed": "The ChatGPT sign-in window was closed.",
  "main.coach.chatgptTitle": "Sign in with ChatGPT",
  "main.coach.analysisName": "An analysis needs a name.",
  "main.coach.analysisPlaybook": "An analysis needs a playbook.",
  "main.coach.analysisSession": "An analysis belongs to a conversation.",
  "main.coach.analysisLimit": "A conversation can run at most {n} analyses.",
  // Coach's AI providers
  "main.ai.anthropicKey": "Add your Anthropic API key first.",
  "main.ai.connectedTo": "Connected to {name}.",
  "main.ai.claudeReady": "Claude Code is connected and ready for Coach conversations.",
  "main.ai.claudeNoLaunch": "Claude Code was found but could not start: {detail}",
  "main.ai.claudeSignIn": "Claude Code is installed, but sign-in is required.",
  "main.ai.localModelName": "Choose a local model name first.",
  "main.ai.localNotFound": "The model \"{model}\" is not on the local server.",
  "main.ai.localNoModels": "The local server answered, but listed no models.",
  "main.ai.localConnected": "Connected to the local model \"{model}\".",
  "main.ai.localModelFirst": "Choose a {kind} model first.",
  "main.ai.localUrlInvalid": "The local model's address is not valid.",
  "main.ai.localUrlScheme": "The local model's address must start with http or https.",
  "main.ai.localUrlHost": "The local model's address must point to localhost or 127.0.0.1.",
  "main.ai.localUrlPath": "The local model's address must end at the server root or /v1.",
  "main.ai.openRouterKey": "Add an OpenRouter API key first.",
  "main.ai.openRouterModel": "Choose an OpenRouter model first.",
  "main.ai.openRouterNoTools": "OpenRouter connected, but \"{model}\" can't call tools on this account.",
  "main.ai.openRouterConnected_one": "Connected to OpenRouter with \"{model}\". {count} model that can call tools is available.",
  "main.ai.openRouterConnected_other": "Connected to OpenRouter with \"{model}\". {count} models that can call tools are available.",
  "main.ai.openRouterList": "OpenRouter returned a model list this app can't read.",
  "main.ai.noModels": "The provider listed no models.",
  "main.ai.chatgptListFailed": "ChatGPT's model list could not be read ({status}).",
  "main.ai.chatgptNoModels": "ChatGPT returned no models.",
  // MCP servers
  "main.mcp.nameRequired": "Give the server a name.",
  "main.mcp.urlRequired": "Enter the server's address.",
  "main.mcp.urlInvalid": "The server's address must be a valid HTTP or HTTPS address.",
  "main.mcp.urlScheme": "The server's address must use HTTP or HTTPS.",
  "main.mcp.urlCredentials": "The server's address must not include a user name or password.",
  "main.mcp.exists": "A server with this id is already added.",
  "main.mcp.builtInUrl": "The address of a built-in server can't be changed.",
  "main.mcp.builtInRemove": "A built-in server can't be removed.",
  "main.mcp.notApiKey": "{name} does not sign in with an API key.",
  "main.mcp.keyEmpty": "Enter the API key.",
  "main.mcp.secureStorage": "This system has no secure storage for keys, so the key could not be saved.",
  "main.mcp.unknown": "That MCP server is no longer here.",
  "main.mcp.disabled": "{name} is switched off.",
  "main.mcp.authExpired": "{name}'s authorization expired. Connect {name} again.",
  "main.mcp.authNotStarted": "{name} authorization did not start.",
  "main.mcp.cancelled": "Connecting {name} was cancelled.",
  "main.mcp.windowClosed": "The {name} sign-in window was closed.",
  // Hevy
  "main.hevy.keyRejected": "Hevy rejected the API key. Reconnect Hevy with a current Pro API key.",
  "main.hevy.invalidResponse": "Hevy sent an answer this app can't read.",
  "main.hevy.noIdentity": "Hevy did not say which account the key belongs to.",
  "main.hevy.enterKey": "Enter a Hevy API key.",
  "main.hevy.secureStorage": "This system has no secure storage for keys, so the key could not be saved.",
  "main.hevy.connectFirst": "Connect Hevy before syncing strength workouts.",
  // The calendar's manual activity
  "main.activity.duration": "Enter a duration longer than zero.",
  "main.activity.startTime": "Enter a start time.",
  // Files, backups and sync
  "main.file.activityFilter": "{format} file",
  "main.backup.saveTitle": "Save a backup of your data",
  "main.backup.openTitle": "Choose a backup to restore",
  "main.backup.filter": "Heracles Records backup",
  "main.backup.signedOutSave": "Sign in to COROS before saving a backup. A backup belongs to an account, so there is nothing to attribute this one to.",
  "main.backup.signedOutRestore": "Sign in to COROS before restoring a backup. A backup belongs to an account, so there is nothing to attribute this one to.",
  "main.backup.damaged": "{file} is damaged and can't be opened.",
  "main.backup.notBackup": "{file} is not a backup file.",
  "main.backup.tooNew": "{file} is not a backup this version can read.",
  "main.backup.otherOwner": "This backup belongs to a different COROS account. Restoring it would mix two people's data together, which can't be undone.",
  "main.sync.connectGoogle": "Connect a Google account before syncing.",
  "main.sync.signInCoros": "Sign in to COROS before syncing.",
  "main.sync.signInClaim": "Sign in to COROS before taking over this vault.",
  "main.update.installedOnly": "Updates are only available in the installed app.",

  // The plan brief's checks (shared: the brief's screen and Coach's tools)
  "screen.gen.goalKind": "Pick what kind of goal this is.",
  "screen.gen.goalDescribe": "Describe what you are training for.",
  "screen.gen.goalLength": "Keep the goal under {max} characters.",
  "screen.gen.raceDay": "Pick race day.",
  "screen.gen.raceName": "Name the race or pick its distance.",
  "screen.gen.raceTooSoon": "Race day has to fall after the plan's first week — start earlier.",
  "screen.gen.raceTooFar": "Race day is more than {max} weeks after the first week — start later.",
  "screen.gen.sports": "Pick at least one sport.",
  "screen.gen.sportUnknown": "\"{sport}\" is not a sport a plan can hold.",
  "screen.gen.level": "Pick a level.",
  "screen.gen.levelNeedsData": "Coach can't judge your level without your recent activities — share them, or pick a level.",
  "screen.gen.weeks": "A generated plan runs 1 to {max} weeks.",
  "screen.gen.start": "Pick the week the plan starts.",
  "screen.gen.startMonday": "A plan starts on a Monday — COROS counts a plan's weeks from one.",
  "screen.gen.startBegun": "The first week can't be one that has already begun.",
  "screen.gen.startYear": "Start the plan within a year.",
  "screen.gen.daysSeven": "A usual week is seven days, Monday to Sunday.",
  "screen.gen.dayToTrain": "Mark at least one day you can train.",
  "screen.gen.dayMinutes": "A day's time is a whole number of minutes, {min} to {max}.",
  "screen.gen.blockedDays": "Days you can't train are Monday to Sunday, each once.",
  "screen.gen.leaveDay": "Leave at least one day you can train.",
  "screen.gen.sessionsBand": "Sessions a week run 1 to {max}.",
  "screen.gen.sessionsDays_one": "{count} session a week needs at least {count} day you can train.",
  "screen.gen.sessionsDays_other": "{count} sessions a week need at least {count} days you can train.",
  "screen.gen.hoursBand": "Hours a week are a band from 0 to {max}.",
  "screen.gen.week": "Say how your week looks, or leave it to Coach.",
  "screen.gen.constraints": "Keep the constraints under {max} characters.",
  "screen.gen.provider": "Pick a provider Coach knows.",
  "screen.gen.effort": "Pick a reasoning effort.",
  "screen.gen.model": "Pick a model.",
  // The outline's checks (shared: the outline card and Coach's tools)
  "screen.outline.weeksFixed": "The outline has {count} weeks; the plan runs {fixed} weeks.",
  "screen.outline.weeksFixedRace": "The outline has {count} weeks; the plan runs {fixed} weeks, to race day.",
  "screen.outline.weeksChosen": "The outline has {count} weeks; when you choose the length, make it {min} to {max} weeks.",
  "screen.outline.raceStage": "Week {n} is the race week; give it the race stage.",
  "screen.outline.sessionsExact": "Week {n} has {sessions} sessions; the athlete's week holds exactly {min}.",
  "screen.outline.sessionsBand": "Week {n} has {sessions} sessions; the athlete's week holds {min} to {max}.",
  "screen.outline.keySessions": "Week {n} lists more sessions than it counts.",
  "screen.outline.hours": "Week {n} plans {hours} h; the athlete has at most {max} h a week.",
  "screen.outline.sport": "Week {n}'s \"{name}\" is {sport}, which was not asked for.",
  "screen.outline.restDay": "Week {n}'s \"{name}\" is on {day}, a rest day.",
  "screen.outline.tooLong": "Week {n}'s \"{name}\" runs {minutes} minutes; {day} has {available}.",
  "screen.outline.blockedDay": "Week {n}'s \"{name}\" is on {day}, a day the athlete can't train.",
  // What stops a plan being saved to COROS (shared: the plan editor)
  "screen.planIssue.name": "Add a plan name.",
  "screen.planIssue.weeks": "Plans must contain 1 to {max} weeks.",
  "screen.planIssue.empty": "Add a session — COROS does not keep an empty plan.",
  "screen.planIssue.outsideWeeks": "A session is outside the plan's weeks.",
  "screen.planIssue.outsideDays": "A session is on a day outside the week.",
  "screen.planIssue.perDay": "COROS takes at most {max} sessions on one day.",
  "screen.planIssue.emptyEnd_one": "COROS ends a plan at its last session, so the empty last week is not kept.",
  "screen.planIssue.emptyEnd_other": "COROS ends a plan at its last session, so the {count} empty weeks at the end are not kept.",
  // What changed between two versions of a plan (shared: the Workbench, a planEvent)
  "screen.diff.renamed": "Renamed to \"{name}\"",
  "screen.diff.description": "Overview rewritten",
  "screen.diff.added": "Added {name} ({where})",
  "screen.diff.moved": "Moved {name}: {from} → {to}",
  "screen.diff.renamedSession": "{from} is now {to}",
  "screen.diff.changed": "Changed {name}",
  "screen.diff.removed": "Removed {name} ({where})",
  "screen.diff.stage": "Week {n}: {from} → {to}",
  "screen.diff.where": "week {n} {day}",
  "screen.diff.aSession": "a session",
  "screen.diff.count_one": "{count} change",
  "screen.diff.count_other": "{count} changes",
  // Coach's reasoning effort (shared: every effort picker)
  "screen.effort.low": "Low",
  "screen.effort.lowDetail": "fastest and cheapest",
  "screen.effort.medium": "Medium",
  "screen.effort.high": "High",
  "screen.effort.highDetail": "default",
  "screen.effort.xhigh": "Extra high",
  "screen.effort.max": "Max",
  "screen.effort.maxDetail": "most thorough",
  "screen.model.auto": "Auto"
};

export type ScreenMessages = Translation<typeof SCREEN_TEXT_EN>;
export type ScreenKey = keyof typeof SCREEN_TEXT_EN;
export type ScreenPluralKey = {
  [K in ScreenKey]: K extends `${infer Base}_other` ? Base : never;
}[ScreenKey];
export type ScreenVars = Record<string, string | number>;

const ENGLISH_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const ENGLISH_SHORT_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const englishPlurals = new Intl.PluralRules("en");

export function interpolateScreen(message: string, vars?: ScreenVars): string {
  if (!vars) return message;
  return message.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match
  );
}

/** `key` in English, `count` choosing the form for a plural key. */
export function englishScreenText(key: string, vars?: ScreenVars, count?: number): string {
  const table = SCREEN_TEXT_EN as Record<string, string>;
  const message =
    count === undefined
      ? table[key]
      : table[`${key}_${englishPlurals.select(count)}`] ?? table[`${key}_other`];
  return interpolateScreen(message ?? key, count === undefined ? vars : { count, ...vars });
}

/** What the renderer installs: its own `t`, and the names it already writes. */
export interface ScreenTranslator {
  text(key: string, vars?: ScreenVars, count?: number): string;
  /** A day of the week, Monday 0, written out. */
  weekday(index: number, style: "long" | "short"): string;
  /** A workout sport's name (`run`, `bike`, …). */
  sport(sport: string): string;
  /** A COROS week stage (0 Not Set … 6 Transition). */
  stage(value: number): string;
}

let translator: ScreenTranslator | null = null;

/** The renderer's, once at start-up. The main process never installs one. */
export function setScreenTranslator(next: ScreenTranslator | null): void {
  translator = next;
}

export function screenText(key: ScreenKey, vars?: ScreenVars): string {
  return translator ? translator.text(key, vars) : englishScreenText(key, vars);
}

export function screenPlural(key: ScreenPluralKey, count: number, vars?: ScreenVars): string {
  return translator ? translator.text(key, vars, count) : englishScreenText(key, vars, count);
}

export function screenWeekday(index: number, style: "long" | "short" = "long"): string {
  if (translator) return translator.weekday(index, style);
  return (style === "long" ? ENGLISH_DAYS : ENGLISH_SHORT_DAYS)[index] ?? "";
}

/** `english` is what the main process writes: the module's own English name. */
export function screenSport(sport: string, english: string): string {
  return translator ? translator.sport(sport) : english;
}

export function screenStage(value: number, english: string): string {
  return translator ? translator.stage(value) : english;
}

/**
 * An error the athlete reads. `message` is English, for the log, the model and
 * any code that tests it; the IPC adapter re-throws it in the language on
 * screen (`localizeScreenError` in `mainText.ts`).
 */
export class ScreenError extends Error {
  readonly screenKey: string;
  readonly screenVars?: ScreenVars;
  readonly screenCount?: number;

  constructor(key: ScreenKey | ScreenPluralKey, vars?: ScreenVars, options?: { count?: number; cause?: unknown }) {
    super(englishScreenText(key, vars, options?.count), options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ScreenError";
    this.screenKey = key;
    this.screenVars = vars;
    this.screenCount = options?.count;
  }
}

/** By shape, not `instanceof`: an error class of its own may carry a key too. */
export function screenKeyOf(
  error: unknown
): { key: string; vars?: ScreenVars; count?: number } | undefined {
  if (!error || typeof error !== "object") return undefined;
  const candidate = error as { screenKey?: unknown; screenVars?: ScreenVars; screenCount?: number };
  return typeof candidate.screenKey === "string"
    ? { key: candidate.screenKey, vars: candidate.screenVars, count: candidate.screenCount }
    : undefined;
}

/** Gives an error of another class the key it was written from. */
export function withScreenKey<E extends Error>(error: E, key: ScreenKey, vars?: ScreenVars): E {
  Object.assign(error, { screenKey: key, screenVars: vars });
  return error;
}

let byEnglish: Map<string, ScreenKey> | undefined;

/**
 * The key a stored English sentence was written from, if it is one of these
 * and takes no values. Text the app stored — a change line's reason, written
 * from a `ScreenError` — stays English where it is kept; the screen finds its
 * key again here and says it in the language on screen.
 */
export function screenKeyForEnglish(text: string): ScreenKey | undefined {
  if (!byEnglish) {
    byEnglish = new Map();
    for (const [key, message] of Object.entries(SCREEN_TEXT_EN)) {
      if (!message.includes("{")) byEnglish.set(message, key as ScreenKey);
    }
  }
  return byEnglish.get(text);
}
