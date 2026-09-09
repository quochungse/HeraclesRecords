// Runs under Electron because this repo's Node is built without Amaro and
// cannot strip types. Nothing here touches SQLite.
import assert from "node:assert/strict";

import {
  FIT_MAX_ALTITUDE,
  FIT_MIN_ALTITUDE,
  MAX_FIT_ANGLE_DEGREES,
  SINGLE_PLACE_ALTITUDE,
  altitudeForSpread,
  angularDistanceDegrees,
  clampLatitude,
  computeFitView,
  labelSeparationDegrees,
  landDetailLevels,
  landDetailOpacity,
  surfacePixelsPerDegree,
  pickSpacedPlaces,
  sphericalCenter
} from "../src/overview/globeFraming.ts";

/** The training globe panel is wider than it is tall. */
const WIDE = 1.6;

function place(lat, lon, key = `${lat}:${lon}`) {
  return { key, lat, lon, count: 1 };
}

// --- an empty list keeps the caller's own default view ---
{
  assert.equal(
    computeFitView([], WIDE),
    null,
    "no places means no opinion about where the camera goes"
  );
}

// --- the fit centres the places instead of showing the whole planet ---
{
  // Hanoi, Da Nang, Ho Chi Minh City — one country, ~1200 km apart.
  const vietnam = [
    place(21.03, 105.85, "hanoi"),
    place(16.05, 108.2, "danang"),
    place(10.78, 106.7, "hcmc")
  ];
  const view = computeFitView(vietnam, WIDE);
  assert.ok(view, "three places frame");
  assert.ok(
    view.lat > 10.78 && view.lat < 21.03,
    `centre latitude sits between the places, got ${view.lat}`
  );
  assert.ok(
    view.lng > 105.8 && view.lng < 108.3,
    `centre longitude sits between the places, got ${view.lng}`
  );
  assert.ok(
    view.altitude < FIT_MAX_ALTITUDE,
    `a single country must zoom past the full-globe view, got ${view.altitude}`
  );

  // Every place has to land inside the frustum the altitude was solved for.
  const centre = sphericalCenter(vietnam);
  const spread = Math.max(
    ...vietnam.map((point) => angularDistanceDegrees(centre, point))
  );
  assert.ok(
    view.altitude >= altitudeForSpread(spread, WIDE) - 1e-9 ||
      view.altitude === FIT_MIN_ALTITUDE,
    "altitude either fits the spread or is held at the minimum"
  );
}

// --- a lone place gets a regional view, never a degenerate one ---
{
  const view = computeFitView([place(21.03, 105.85)], WIDE);
  assert.equal(
    view.altitude,
    SINGLE_PLACE_ALTITUDE,
    "one place cannot imply a zoom level, so it takes the regional default"
  );
  assert.equal(view.lat, 21.03, "centred on the place itself");
  assert.equal(view.lng, 105.85, "centred on the place itself");
}

// --- clustered places never zoom past what the dot-cloud globe can show ---
{
  // Four rides around one city: the spread is a fraction of a degree.
  const oneCity = [
    place(21.02, 105.84, "a"),
    place(21.05, 105.81, "b"),
    place(21.0, 105.86, "c"),
    place(21.04, 105.88, "d")
  ];
  const view = computeFitView(oneCity, WIDE);
  assert.equal(
    view.altitude,
    FIT_MIN_ALTITUDE,
    "a tight cluster clamps to the minimum altitude rather than diving in"
  );
}

// --- the antimeridian must not throw the centre halfway round the world ---
{
  const pacific = [place(-17.6, 178.4, "fiji"), place(-13.8, -171.8, "samoa")];
  const view = computeFitView(pacific, WIDE);
  assert.ok(
    view.lng > 170 || view.lng < -170,
    `centre stays in the Pacific, got ${view.lng}`
  );
  assert.ok(
    Math.abs(view.lat + 15.7) < 1.5,
    `centre latitude sits between the two, got ${view.lat}`
  );
}

// --- scattered worldwide: hold the latest place, not an ocean between them ---
{
  // Newest first, the order the card hands them over in.
  const worldwide = [
    place(21.03, 105.85, "hanoi"),
    place(37.77, -122.42, "san-francisco"),
    place(-33.87, 151.21, "sydney"),
    place(51.51, -0.13, "london")
  ];
  const view = computeFitView(worldwide, WIDE);
  assert.equal(view.lat, 21.03, "falls back to the most recent place");
  assert.equal(view.lng, 105.85, "falls back to the most recent place");

  const spread = Math.max(
    ...worldwide.map((point) => angularDistanceDegrees(worldwide[0], point))
  );
  assert.ok(
    spread > MAX_FIT_ANGLE_DEGREES,
    "fixture really is too scattered for one frame"
  );
}

// --- the fallback still fits whatever shares the newest place's hemisphere ---
{
  const mostlyNearby = [
    place(21.03, 105.85, "hanoi"),
    place(35.68, 139.65, "tokyo"),
    place(-33.87, 151.21, "sydney"),
    place(51.51, -0.13, "london")
  ];
  const view = computeFitView(mostlyNearby, WIDE);
  assert.equal(view.lat, 21.03, "anchored on the newest place");
  const tokyo = angularDistanceDegrees(mostlyNearby[0], mostlyNearby[1]);
  assert.ok(
    tokyo <= MAX_FIT_ANGLE_DEGREES,
    "Tokyo is close enough to be framed with Hanoi"
  );
  assert.ok(
    view.altitude >= altitudeForSpread(tokyo, WIDE) - 1e-9,
    "the zoom accounts for the neighbour it can hold"
  );
}

// --- altitude grows with spread, and the fit formula stays inside the frustum ---
{
  const near = altitudeForSpread(5, WIDE);
  const mid = altitudeForSpread(20, WIDE);
  const far = altitudeForSpread(50, WIDE);
  assert.ok(near < mid && mid < far, "farther apart means farther out");
  assert.ok(
    far < FIT_MAX_ALTITUDE,
    `even the widest fit stays under the full-globe view, got ${far}`
  );

  // The camera sits at R(1 + altitude); a point `spread` away must project
  // within the padded half-FOV. Recompute the screen angle and check it.
  const spread = 30;
  const altitude = altitudeForSpread(spread, WIDE);
  const theta = (spread * Math.PI) / 180;
  const distance = 1 + altitude;
  const screenAngle =
    (Math.atan2(Math.sin(theta), distance - Math.cos(theta)) * 180) / Math.PI;
  assert.ok(
    screenAngle < 25,
    `the place must land inside the 50° FOV, got ${screenAngle}°`
  );
  assert.ok(
    screenAngle > 14,
    `...but not so far inside that the globe is left tiny, got ${screenAngle}°`
  );
}

// --- a tall panel is bound by the horizontal FOV, so it pulls back further ---
{
  const tall = altitudeForSpread(20, 0.6);
  const wide = altitudeForSpread(20, WIDE);
  assert.ok(
    tall > wide,
    "a narrow panel needs more distance to hold the same spread"
  );
}

// --- labels thin out instead of stacking on top of each other ---
{
  const crowded = [
    place(21.03, 105.85, "hanoi"),
    place(21.05, 105.83, "hanoi-west"),
    place(16.05, 108.2, "danang"),
    place(10.78, 106.7, "hcmc")
  ];
  const picked = pickSpacedPlaces(crowded, 6, labelSeparationDegrees(1));
  assert.deepEqual(
    picked.map((point) => point.key),
    ["hanoi", "danang", "hcmc"],
    "the neighbouring pin is dropped, the distant ones kept"
  );
  assert.equal(
    pickSpacedPlaces(crowded, 2, 0).length,
    2,
    "the cap is respected even when everything is far enough apart"
  );
  assert.deepEqual(pickSpacedPlaces([], 6, 3), [], "no places, no labels");
}

// --- land detail: the far view keeps the single coarse lattice ---
{
  const PANEL = 440;
  const far = landDetailLevels(PANEL, FIT_MAX_ALTITUDE);
  assert.equal(far.tier1, 0, "the full-globe view must look exactly as it did");
  assert.equal(far.tier2, 0, "...and must not pay for a lattice it cannot show");
  assert.equal(far.density, 1, "density multiplier is 1 when only tier 0 shows");

  // At 2.2 the coarse dots sit ~3.7px apart — already dense enough.
  assert.ok(
    surfacePixelsPerDegree(PANEL, FIT_MAX_ALTITUDE) < 5,
    "a degree is only a few pixels at full-globe zoom"
  );
}

// --- closing in brings the finer lattices in, in order ---
{
  const PANEL = 440;
  const fitted = landDetailLevels(PANEL, FIT_MIN_ALTITUDE);
  assert.equal(fitted.tier1, 1, "the default fitted framing shows the half-spacing tier");
  assert.equal(fitted.tier2, 0, "but not yet the quarter-spacing one");
  assert.equal(fitted.density, 4, "tier 0 + tier 1 is four times the dots");

  const closer = landDetailLevels(PANEL, 0.3);
  assert.equal(closer.tier2, 1, "a hard zoom brings in the finest lattice");
  assert.equal(closer.density, 16, "all three tiers is sixteen times the dots");

  // Tiers must arrive in order: no tier 2 while tier 1 is still fading.
  for (let altitude = 2.5; altitude > 0.2; altitude -= 0.05) {
    const level = landDetailLevels(PANEL, altitude);
    if (level.tier2 > 0) {
      assert.equal(
        level.tier1,
        1,
        `tier 2 appeared at altitude ${altitude.toFixed(2)} while tier 1 was ${level.tier1}`
      );
    }
  }
}

// --- detail follows the panel, not just the altitude ---
{
  const short = landDetailLevels(360, 1.2);
  const tall = landDetailLevels(900, 1.2);
  assert.ok(
    tall.tier1 > short.tier1,
    "the same altitude spreads dots further apart on a taller panel"
  );
}

// --- the fade is a smoothstep between the spacing thresholds ---
{
  assert.equal(landDetailOpacity(6), 0, "dense enough already");
  assert.equal(landDetailOpacity(13), 1, "well past the sparse threshold");
  assert.ok(
    landDetailOpacity(9.5) > 0.4 && landDetailOpacity(9.5) < 0.6,
    "half way across the band is half faded in"
  );
  let previous = -1;
  for (let px = 0; px <= 20; px += 0.5) {
    const value = landDetailOpacity(px);
    assert.ok(value >= previous, `opacity must not dip at ${px}px`);
    previous = value;
  }
}

// --- the poles cannot be centred ---
{
  assert.equal(clampLatitude(89), 78, "north pole clamps");
  assert.equal(clampLatitude(-89), -78, "south pole clamps");
  assert.equal(clampLatitude(12.5), 12.5, "everything else passes through");
}

console.log("globe framing: ok");
