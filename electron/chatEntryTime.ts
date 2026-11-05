/**
 * When the store first saw an entry, read off its `mid`: a minted id is
 * `1-<12 hex digits of epoch ms>-<counter>-<device>` (`nextMergeStamp` in
 * `chatHistoryStore.ts`). A backfilled `0-` id and one anchored after another
 * (`~`) say nothing about when, so they give no time rather than a wrong one.
 *
 * No `node:` imports: the renderer reads this too.
 */
export function entryTimeFromMid(mid: string | undefined): number | undefined {
  if (!mid || mid.includes("~")) return undefined;
  const match = /^1-([0-9a-f]{12})-/.exec(mid);
  return match ? parseInt(match[1]!, 16) : undefined;
}

/**
 * The machine whose store minted an entry's `mid` (`sync/deviceIdentity.ts`):
 * for a question, the machine it was asked on, which is the only one that can
 * be answering it. The ids that give no time give no machine either.
 */
export function entryDeviceFromMid(mid: string | undefined): string | undefined {
  if (!mid || mid.includes("~")) return undefined;
  return /^1-[0-9a-f]{12}-[0-9a-f]{4}-([0-9a-f]{16})$/.exec(mid)?.[1];
}
