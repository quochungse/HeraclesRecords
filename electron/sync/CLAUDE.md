# Sync and backup

Continuous two-way sync through **Google Drive only** (a local-folder destination was
removed: a folder kept by Dropbox/Syncthing rewrites files under two writers;
`LocalFolderProvider` stays only as the suites' backend). `syncService` owns the
destination; `syncLoop` owns the log; `fullState.ts` republishes everything at once (first
join, restore); `syncableStore.ts` is the row reader shared with backup. A build with no
OAuth client offers no sync.

## What travels

- **User data only. No credential leaves the machine, down any path** — every token, key and
  sign-in is `device` tier; nothing unwraps a credential for transport. `test:sync-policy`
  fails if a `secret` tier or `includeSecrets` flag reappears; `test:backup-restore` asserts
  the payload has no field one could travel in.
- **`syncPolicy.ts` is the only gate**, for both the log and backup, and the renderer imports
  the same registry. Unclassified = local only.
- **The vault is obfuscated, not encrypted**: `ObfuscatedProvider` seals with an AES-GCM key
  derived from a constant that ships in every build. It keeps a diary out of Drive's indexing
  and nothing more — read `syncObfuscation.ts`'s header before describing it in UI copy.
- **A vault belongs to one COROS account** (`dataOwner.ts`: an HMAC fingerprint of
  `trainingHub.userId`, which never travels). `vault/id.json` answers reachability, identity
  and ownership in one read. States (`SyncVaultState`): `signed-out` (reported ahead of the
  destination), `wrong-owner` (left alone), an unclaimed vault taken by the first signed-in
  `prepare()`. `claimVault()` overrides and clears `sync.seededVaultId`. `prepare()` is the
  only path that starts a loop. Rows have no owner column, so switching accounts on one
  machine leaves the previous account's rows.
- **The vault declares its data format** (`dataFormat.ts`, [docs/sync-v2.md](../../docs/sync-v2.md)):
  `dataVersion`/`dataVersionCompat` in `vault/id.json` against this build's `DATA_VERSION`. Below
  the compat is `outdated`: the loop is **held** (still queues to the outbox; no flush, pull or
  compaction), never stopped. An additive change raises `DATA_VERSION` only; anything else
  raises both.

## Format 2 (`DATA_VERSION = 2`)

- The log is numbered per device (`vaultLog.ts`: `log/<device>/<seq>.jsonl`, `heads/<device>.json`
  written only by that device). A pull lists the vault, reads a head only when its revision
  moved, and fetches batches by name against a version vector (`sync_vector`); a missing batch
  was compacted, so the snapshot (`snap/<hlc>.json`) is read. A full read happens only when this
  machine never read a snapshot or the app version changed.
- **A coach message is a record of its own**: a `chat_sessions` row travels without
  `messages_json`, each changed message as an `item` entry (`sync_published_items`).
  `SqliteSyncTarget.upsertItem` places one by `mid`. **Rows apply before items**, then in causal
  order. A message keeps the copy edited last by its own `mrev` (`outranks`); a losing local copy
  is republished alone through `takeRepublish`. An item for a row not here is refused, not
  dropped. A deleted conversation sends one tombstone.
- Every bookkeeping table and `sync.v2.*` belongs to one vault (`sync.v2.vaultId`) and is
  forgotten when pointed at another (`forgetAnotherVaultsLog`).
- A format-1 vault is migrated once (`SyncLoop.migrateToV2`, lease `format-migration`); after
  that nothing reads `oplog/`, and every machine **seeds once per format** (`<vaultId>:v2`)
  under the stamps it holds (`collectStampedEntries`). The format-1 code paths remain only for
  the suites written before it. `npm run test:sync-v2`.

## Merge rules (each one cost real data before it existed)

- **An entry is applied only when newer than the row it would overwrite.** `resolve()` picks a
  winner among entries and never looks at the database, so `SyncLoop.enqueue` stamps
  `entryIdentity → hlc` at the local write and `pull` stamps what it merges
  (`recordVersions.ts`, `sync_record_versions`); a winner that does not beat the stamp is
  skipped. The guard belongs in `isApplied`, never in what is handed to `applyEntries` — own
  entries still take part in last-writer-wins. Never reintroduce "skip what I authored" or an
  in-memory merged map. `npm run test:sync-twoway`.
- **Inbound writes must not echo back out**: `SqliteSyncTarget` and `applyBackup` write
  through `requireDatabase().prepare(...)`, never `setSetting`. localStorage folds inbound
  values into the published snapshot (`localStorageSync.ts`); an inbound localStorage entry
  waits in `sync_local_storage_inbox` until the renderer acknowledges it (`sync:ackLocalStorage`).
- **A setting written back unchanged is not a change** (`setSetting` notifies only when the
  row moved). The bridge decides policy *before* minting an HLC (a recursion trap otherwise).
- **`upsertRow` names its columns** — `INSERT OR REPLACE` turns a missing column into NULL,
  i.e. *deleted*. A row payload is the full row (`SELECT *`); a row taken only in part is
  reported through `takeIncomplete` and not stamped durably. A payload short of a `NOT NULL`
  column goes out as an `UPDATE` (an upsert builds the candidate row first and fails).
- **A record that accumulates is unioned** (format-1 transcripts, `rowMergers.ts`): union by
  `mid`, last-writer-wins per entry by `mrev`, ordered by `mid`, ties broken by content (never
  by argument order — that livelocks). `applyEntries` folds every entry for such a record, not
  only the winner, but only the winner's other columns are authoritative. Identities are
  recovered by content first, then the card's own id, never by position; an unidentified
  entry is lent an id by content from either side; a fallback id depends on the entry and its
  position only. `sync_record_versions` keys such a record per device. `test:sync-engine`,
  `test:chat-history-store`.
- **A merge is one transaction** (entries + stamps); one failing statement costs one entry.
- **`pull` and `flush` are serialised**; `flushBeforeQuit` bypasses the turnstile on purpose.
- **A compaction snapshot summarises the log; it never shadows it**: `readLog` skips only
  entries the snapshot holds by timestamp identity, never everything below its `upTo`.

## Queues and timing

- **The outbound queue is a table** (`sync_outbox`, `device`), released only when the upload
  returns; `start()` adopts what the last launch left. One entry per destination.
- **A change made before the vault opens is held** by `syncBridge` and replayed when
  `attachSyncSink` speaks (or dropped when it says there is no vault). Past the boot window a
  detached bridge drops, so swapping loops is stop/start with nothing awaited between.
  `npm run test:sync-bridge`.
- **Quit waits for the queue only when there is one** (`hasUnpushedChanges` counts the upload
  in the air too): `before-quit` cancels, flushes once (`QUIT_FLUSH_TIMEOUT_MS`), quits.
- **A device writes only inside its own directory**, so storage needs no locking. A `Lease`
  guards the two exclusive jobs: running a scheduled analysis (`automationLease.ts`) and
  compaction.
- **A pull tells the renderer which tables it wrote** (`SyncChangedEvent.tables`), queued in
  `pendingSyncChange` until `markRendererReady`; views re-read their own tables (ChatView holds
  its re-read while its own turn streams). `npm run test:sync-changed-fanout`.
- Coach analyses start only after start-up re-login, vault open and one pull
  (`startCoachAnalysesAfterSync`); a pull that changes a running analysis's conversation
  stops it (`noteConversationsChangedBySync`).
- `npm run dev` (`http://127.0.0.1:5173`) and a packaged build (`file://`) have separate
  localStorage over one userData, so switching between them republishes view preferences.

## Backup / restore (`electron/backup/`)

A separate feature: one file the person saves and reads back (`backup:export`,
`backup:choose`, `backup:restore`), no list or lineage. Sealed in the vault's envelope
(`.hrbackup`) with a **constant** AAD, so a renamed file still opens; plain JSON from older
builds still restores. Restore is `replace` or `merge` (`INSERT OR IGNORE`), asked only when
`hasSyncableData()` says there is something to lose, and republished through
`republishAfterRestore`. Ownership is enforced in the service: signed out refuses both ways
(`BackupSignedOutError`, before the file dialog), another account's file needs
`allowOtherOwner` (`BackupOwnerMismatchError`), an ownerless file restores.
