# Base maps

Not a screen: what the activity route map (`ActivityRouteMap`) and the globe's street view
(`ActivityGlobeStreetMap`) need — `constants.ts` (styles), `baseLayers.ts`, `onewayArrows.ts`,
`MapLayerControl.tsx`. No trail overlays.

- **Every style in `BASE_LAYERS` must stay keyless**: the app has no map key and no field for
  one. `light`/`dark` are OpenFreeMap vector styles rendered by MapLibre. A keyless provider can
  answer 200 with a watermarked tile, so a status code proves nothing. `test:base-layers`.
- **`createBaseLayer` is the only way to build a base layer**: it puts every base map in the
  `heraclesBasemap` pane (below `tilePane`) and **calls `setMaxZoom`** — a vector layer bounds
  nothing, and with `Infinity` a single-point track's `fitBounds` blanks every polyline. An
  overlay tile layer carries `maxNativeZoom`, not `maxZoom`.
- **One-way arrows are replaced, not patched** (`applyOnewayArrows`, on `style.load`, never
  gated on `isStyleLoaded()`): the styles disagree on rotation and on which roads get arrows.
  `test:oneway-arrows`.
- **MapLibre v6 needs `setWorkerUrl()` under Vite**: keep the
  `maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url` import, or the canvas paints only the
  background colour.

## The route map

It draws `track.route` (`electron/routeSimplification.ts`: Douglas–Peucker at 3 m within a
2 000-point budget, on the series' own clock), smoothed by a B-spline bounded to 2 m of the
recorded line (`routeSmoothing.ts`). `track.points` stays the 400-point copy every other
reader (Coach, elevation, globe) uses — changing it changes what Coach is told. Zones are
coloured and named bucket for bucket as the zone bar is (bucket n = Z(n+1)); a ride's or hike's
speed uses the ramp, never COROS's running pace zones. `test:route-coloring`,
`test:activity-detail`.
