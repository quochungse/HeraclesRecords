// Which sport screens the rail shows: a screen appears with the account's
// first session of its sport, and the athlete's own choice in Settings outranks
// that either way (src/navigation/sportScreens.ts).
//
// Run with: npm run test:sport-screens
// sportScreens.ts has extensionless imports, so the resolver hook comes along.
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");

const store = new Map();
globalThis.window = {
  localStorage: {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  },
};

const {
  SPORT_SCREENS,
  addSportScreensWithSessions,
  forgetSportScreensWithSessions,
  hiddenSportScreensFrom,
  newSportScreensIn,
  readHiddenSportScreens,
  readSportScreenChoices,
  recordSportScreensIn,
  saveSportScreenChoice,
  sportScreenFor,
} = await import(
  `${pathToFileURL(path.join(repoRoot, "src", "navigation", "sportScreens.ts")).href}?cacheBust=${Date.now()}`
);

const HIDDEN = "heraclesrecords.hiddenSportScreens";
const SHOWN = "heraclesrecords.shownSportScreens";
const WITH_SESSIONS = "heraclesrecords.sportScreensWithSessions";

// One COROS sport code per screen, found through the module's own answer so
// the suite cannot drift from it.
const codeFor = {};
for (let code = 0; code < 20000 && Object.keys(codeFor).length < SPORT_SCREENS.length; code += 1) {
  const screen = sportScreenFor(code);
  if (screen && !(screen in codeFor)) codeFor[screen] = code;
}
assert.deepEqual(Object.keys(codeFor).sort(), [...SPORT_SCREENS].sort());
const session = (screen) => ({ sportType: codeFor[screen] });
const visible = () => SPORT_SCREENS.filter((screen) => !readHiddenSportScreens().includes(screen));

// A fresh install shows no sport screen.
store.clear();
assert.deepEqual(visible(), []);

// What App calls with each load: an empty list writes nothing; a list records
// its sports once, and the same list again is not news.
assert.equal(recordSportScreensIn([]), false);
assert.equal(store.has(WITH_SESSIONS), false);
assert.equal(recordSportScreensIn([session("swimming")]), true);
assert.equal(recordSportScreensIn([session("swimming")]), false);
assert.deepEqual(visible(), ["swimming"]);
store.clear();

// A load adds the sports it holds, once each; a sport with no screen adds nothing.
{
  const activities = [session("running"), { sportType: undefined }, session("cycling"), session("running")];
  const added = newSportScreensIn(activities, readSportScreenChoices().withSessions);
  assert.deepEqual(added, ["running", "cycling"]);
  assert.equal(addSportScreensWithSessions(added), true);
  assert.deepEqual(visible(), ["running", "cycling"]);
}

// The next load looks only for sports not yet seen, and records nothing new.
{
  const known = readSportScreenChoices().withSessions;
  assert.deepEqual(newSportScreensIn([session("running"), session("cycling")], known), []);
  assert.equal(addSportScreensWithSessions([]), false);
  assert.equal(addSportScreensWithSessions(["running"]), false);
}

// An empty list (loading, failed, signed out) takes nothing off the rail.
assert.deepEqual(newSportScreensIn([], readSportScreenChoices().withSessions), []);
assert.deepEqual(visible(), ["running", "cycling"]);

// Every screen known: the walk reads no session at all.
{
  const untouchable = new Proxy([], {
    get(target, key) {
      if (key === Symbol.iterator) {
        return function* () {
          throw new Error("read a session with every screen known");
        };
      }
      return Reflect.get(target, key);
    },
  });
  assert.deepEqual(newSportScreensIn(untouchable, SPORT_SCREENS), []);
}

// The athlete's choice outranks the sessions, both ways.
saveSportScreenChoice("running", false);
saveSportScreenChoice("climbing", true);
assert.deepEqual(visible(), ["cycling", "climbing"]);
assert.deepEqual(JSON.parse(store.get(HIDDEN)), ["running"]);
assert.deepEqual(JSON.parse(store.get(SHOWN)), ["climbing"]);

// A later session of a sport the athlete turned off leaves it off.
addSportScreensWithSessions(newSportScreensIn([session("running")], readSportScreenChoices().withSessions));
assert.equal(visible().includes("running"), false);

// Turning a screen back on moves it from one list to the other.
saveSportScreenChoice("running", true);
saveSportScreenChoice("climbing", false);
assert.deepEqual(JSON.parse(store.get(HIDDEN)), ["climbing"]);
assert.deepEqual(JSON.parse(store.get(SHOWN)), ["running"]);
assert.deepEqual(visible(), ["running", "cycling"]);

// Two machines' choices can leave a screen in both lists: hidden wins, as a
// build that reads only the hidden key would show it.
assert.deepEqual(
  hiddenSportScreensFrom({ hidden: ["hiking"], shown: ["hiking"], withSessions: ["hiking"] }),
  SPORT_SCREENS,
);

// A screen a newer build wrote survives this build's writes.
store.set(HIDDEN, JSON.stringify(["climbing", "rowing"]));
saveSportScreenChoice("swimming", false);
assert.deepEqual(JSON.parse(store.get(HIDDEN)), ["swimming", "climbing", "rowing"]);
store.set(WITH_SESSIONS, JSON.stringify(["cycling", "rowing"]));
addSportScreensWithSessions(["hiking"]);
assert.deepEqual(JSON.parse(store.get(WITH_SESSIONS)), ["cycling", "hiking", "rowing"]);

// Signing out forgets the sessions' screens and keeps the athlete's choices.
forgetSportScreensWithSessions();
assert.equal(store.has(WITH_SESSIONS), false);
assert.deepEqual(readSportScreenChoices(), {
  hidden: ["swimming", "climbing"],
  shown: ["running"],
  withSessions: [],
});
assert.deepEqual(visible(), ["running"]);

// Unreadable storage reads as nothing stored.
store.set(SHOWN, "{not json");
assert.deepEqual(readSportScreenChoices().shown, []);

console.log("sport screens: ok");
