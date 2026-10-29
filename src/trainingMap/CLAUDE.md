# Where you've been

The globe clusters activity starts into places and names each through `places:reverseGeocode`
(`electron/reverseGeocodeService.ts`). Laid out like Running and the Hall: the globe fills the
height the header leaves, a column of places beside it. The open place is module state
(`rememberedPlaceKey`) so Back from an activity lands on it. Picking a place never opens the
street map; Street view or zooming past `STREET_VIEW_ALTITUDE` does. The Cattle of Geryon card
is the Hall's own `LabourState`, handed down once the Hall has `settled`.

## Places (`placeClusters.ts`, shared with the Hall)

**A place is one first-level administrative region and at most 25 km across**
(`PLACE_DIAMETER_KM`, complete-linkage inside a region — a diameter, never a radius around a
moving centre). Each activity counts where it **started** (`activityStartPoint`). A place's key
is its oldest activity (`place:<id>`). Regions are on the machine (`adminRegions.json`, Natural
Earth + Việt Nam's 34 post-2025 provinces from OSM, `npm run admin-regions:fetch`, read through
`?raw`); a start outside every outline joins the nearest region within 25 km. Nothing is drawn
until the index is read; an unreadable file gives an index of no regions.
Node-free arithmetic in `placeSummaries.ts`. `test:place-clusters`, `test:place-summaries`.

## Naming

- **More than one keyless geocoder** (Nominatim, then Photon on another domain): some ISPs
  resolve `*.openstreetmap.org` to loopback. A provider that cannot be reached stands down
  five minutes. They are asked about the point **rounded to two decimals** (the privacy policy
  promises an approximate location).
- **A failed lookup is not an answer**: open water returns a coordinate label (remembered);
  nobody answering *throws* (not remembered, retried after a minute, `PLACE_LABEL_FAILURES`).
- **A name is kept across launches, and only a name** (`placeLabels.ts`, localStorage
  `heraclesrecords.activity-globe.place-labels.v1`, `derived`, payload version 2): never a
  coordinate fallback or an open-water cluster, which read back like a failure. Until the town
  is known, a place is named by its region (`placeLabelFor`).
- Names are fetched for what is on screen (`labelReach`: as far as the list is scrolled, plus
  home, farthest and the open place).
- `test:reverse-geocode`, `test:place-labels`.

## Paper

WebGL reads no custom property, so the globe's paper colours are `paperTheme ?` literals in
`ActivityGlobeRenderer.tsx` (a pale sphere under ink land); pins take the dark accent.
