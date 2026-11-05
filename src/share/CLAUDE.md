# Share image

Create image sits beside Ask Coach on every session page (Run, Ride, Hike, Swim, Strength)
and opens `ShareDialog`: a scaled preview of `ShareCard` and its choices. Copy puts the image on
the clipboard, Save writes a JPG (`share:copyImage`, `share:saveImage`).

- **The file is drawn by the same card, in a window of its own.** `electron/shareImage.ts`
  opens an offscreen window on the app's page with `#share-render` (`shareRender.tsx`), which
  asks for its payload (`share:renderPayload`), draws the card, waits for fonts, pictures and
  tiles (a raster layer's `load`, MapLibre's `idle`) and says so (`share:renderReady`); the
  window is captured and destroyed at once. The render page never mounts `App` (its ready
  signal and storage publisher belong to the main window). While it lives it is the newest
  window, which `BrowserWindow.getAllWindows()` lists first, so code sending to "any window"
  skips offscreen ones. The page reports a failure at once (`notifyShareRendered(false)`)
  rather than leaving main to its 30 s timeout.
- **A window is never taller than the screen**, offscreen or not (a 1080 × 1920 window came
  back 1080 × 1080 on Linux, the story cut and stretched). The window is the file's size
  divided by the least whole device scale that fits (1, 2, 3, 6), and the page scales the card
  down by the same, so the capture is in the file's own pixels.
- **The payload is words already.** The page builds the session from what it holds
  (`buildShareSession.ts`, `strengthShareSession`), so the render window needs nothing but the
  language it loads itself. A figure's id is its label's message key (`activity.m.time`):
  stable across languages, and what `share.options` remembers.
- **What is remembered**: the choices, per sport, in the selection preference `share.options`
  (syncs as a preference). The photo, the title as typed and where the route or muscle map
  was moved belong to one image (`ShareEdits`) and are never stored; the photo travels as a
  JPEG data URL no longer than 2400 px.
- **Maps** are Dark and Light (OpenFreeMap) and Topo (OpenTopoMap), each with its credit drawn
  on the image (`SHARE_MAP_CREDITS`), cut to what the terms require — OSM's guidelines want
  `openstreetmap.org/copyright` printed wherever there is no link, so it stays. Satellite is
  not offered: Esri licenses its imagery to its own account holders only.
- **A story keeps its words below the platform's header**: a deeper top margin (`padTop`) that
  the logo may sit in. Every format's foot (`padBottom`) is deeper than its sides: a logo at the
  foot sits there, under the words rather than lifting them, unless the map's credit has it or
  a poster's frame leaves too little of it.
- **Copy reads the clipboard back on Linux.** Wayland takes a clipboard write only from the
  window with the keyboard focus and drops any other without a word, so an athlete who leaves
  while the image is drawn is told it was not copied rather than shown Copied. The read-back is
  compared pixel for pixel (`sameImage`): an image already on the clipboard is not this one.
- **The route is the session page's**: the same Performance colouring (`routePerformance.ts`,
  shared with `ActivityRouteMap`) and the same neon proportions, 2.6 times wider
  (`shareRoute.ts`). On a map it stays where the map puts it; on a plain or photo ground it,
  and Strength's muscle map, is placed by `placeBox`, sized and dragged. The preview takes a
  press near the route or on the muscle map before the photo under it.
- **The card is laid out at 1080 px**, so its type sizes are `--share-*` tokens over
  `--share-k` (the card's scale against the 9:16 story), not the screen's scale.
- Closing asks first only when something changed since the dialog opened or the image was
  last copied or saved.
- `npm run test:share-model`. The export itself is only checked in a real window.
