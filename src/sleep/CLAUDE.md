# Sleep

Nights from the COROS MCP server (`electron/sleepDataService.ts`, `sleepHistoryService.ts`,
`sleepSeriesService.ts`), cached in `sleep_nights` because COROS keeps only ~9 weeks.

- **`totalMinutes` is the main sleep only** — stage percentages, efficiency and time in bed are
  shares of it. The day's whole sleep is `totalSleepMinutes` (`electron/sleepMetrics.ts`,
  node-free, imported by the renderer); every list, trend, average and greeting reads that.
- **A day with naps and no main sleep is a day** (`kind: "nap-only"`, `complete`, unsettled for
  one extra day so a late sync can make it a night). `Naps Total: 0 min` with no main sleep is
  not a record. `kind` has three values; "a day" is `isSleepDayRecord` (`kind !== "nap"`), and
  `selectWindow` folds a day's components so one date is one record (`sleep_nights` is keyed
  `<day>:<kind>`).
- **Stage minutes are COROS's own where the daily-health line is this night's**
  (`exactStages`: a `main` night whose `windowMinutes` equals that line's `Total`); the
  daily-health "Sleep Summary" is one episode's (`dailyHealthEpisode`), so on a nap day it is
  one nap of several. Older nights keep minutes worked from percentages.
- COROS sends a window per nap and nothing about individual wake-ups; a nap window is a
  *period* and the total is time asleep (`napSummary.ts`). A day with no sleep window asks for
  no HRV or stress series. `querySleepOverview` dates are `yyyyMMdd` by the day of waking.
- **Picking a night costs no round trip and no layout jump**: `useSleepNightSeries` keeps
  every night it was handed, and `SleepNightCurve` holds its last settled height while
  waiting. `npm run test:sleep-renderer`.
- `test:sleep-metrics`, `test:sleep-data-parser` (verbatim live payloads),
  `test:sleep-history-cache`.

## COROS MCP

- Connecting uses the Training Hub account (`connectMcpServerWithCorosAccount`,
  `corosMcpRegions.ts`): the remembered email is filled in on COROS's page and the built-in
  server moves to the account's regional endpoint while it holds no tokens; once authorised it
  stays put. `test:coros-mcp-account`, `test:coros-mcp-regions`.
- The tool list is read on connect and again only when a caller's tool is missing
  (`corosMcpToolsHaving`) — a `tools/list` is ~185 KB.
- `connected` means the client is open, not that the server answered; a payload served from
  cache states its own `mcpState`, and the UI reads it from the payload.
- A probe outside the app reports Unauthorized unless it runs with the app's name (userData).
