import assert from "node:assert/strict";
import {
  corosSportName,
  enrichActivitiesWithSportNames,
  mergeSportTypeEntries
} from "../dist-electron/corosSportTypes.js";

assert.equal(corosSportName(100), "Run");
assert.equal(corosSportName(900), "Walk");
assert.equal(corosSportName(102), "Trail Run");
assert.equal(corosSportName(100, "Morning Run"), "Morning Run");

// Filled in on 2026-09-11 from the table inside COROS's own MCP
// `querySportRecords` description. Without them these activities rendered as
// "Sport type 904" and fell outside every sport filter.
assert.equal(corosSportName(904), "Yoga");
assert.equal(corosSportName(906), "Boxing");
assert.equal(corosSportName(1005), "Tennis");
assert.equal(corosSportName(1200), "Hybrid Fitness");
assert.equal(corosSportName(802), "Outdoor Climb");
assert.equal(corosSportName(712), "Offshore Fishing");

const merged = mergeSportTypeEntries([
  { sportType: 100, sportName: "Outdoor Run" },
  { sportType: 999, sportName: "Custom Sport" }
]);

assert.equal(
  merged.find((item) => item.sportType === 100)?.sportName,
  "Outdoor Run"
);
assert.equal(
  merged.find((item) => item.sportType === 900)?.sportName,
  "Walk"
);
assert.equal(
  merged.find((item) => item.sportType === 999)?.sportName,
  "Custom Sport"
);

const enriched = enrichActivitiesWithSportNames([
  { activityId: "1", sportType: 100 },
  { activityId: "2", sportType: 900, sportName: "Dog Walk" }
]);

assert.equal(enriched[0]?.sportName, "Run");
assert.equal(enriched[1]?.sportName, "Dog Walk");

console.log("COROS sport type resolver tests passed.");
