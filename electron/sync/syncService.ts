// The service the renderer talks to: point at a vault, and keep it reachable.
//
// Only the destination. The changes themselves are `syncLoop`'s, which writes
// oplog entries through the provider this hands it and never comes through
// here.
//
// **Backups are not here and no longer live in the vault.** They are a file the
// person saves wherever they like — `electron/backup/` — and the two features
// shared this class only for as long as backup was modelled as "sync, but
// manual". The vault kept a `snapshot/` folder, ranked the copies in it, and
// tracked which one this machine descended from; all of that existed to answer
// "which copy is current?", a question about a shared destination that means
// nothing for a file someone owns.
//
// **What travels is user data. No credential leaves this machine** — not in a
// snapshot, not in the oplog, with no setting that changes it. `syncPolicy.ts`
// is where that is decided and enforced; a sign-in that follows the person
// between computers is a separate problem, to be designed on its own.
//
// **There is no key file and no unlock step, and there never will be one.** An
// earlier design kept a random master key in `vault/keyring.json` beside the
// data it locked — a file the user could delete and lose the vault with, in
// exchange for protection it could not actually give, since the key travelled
// with the payloads. It is gone.
//
// Everything the engine writes still goes through `ObfuscatedProvider`, whose
// key ships in the build. That keeps a training diary out of Drive's content
// indexing and out of folder previews, and stops nothing else;
// `syncObfuscation.ts` is blunt about the difference and the Settings copy
// repeats it.
//
// **The vault is Google Drive, and only Google Drive.** A local folder was
// offered beside it until 2026-10-01 — pointed at a Dropbox or Drive Desktop
// folder, it let two machines meet through a file-sync client that rewrites
// files behind the app's back, and with two machines writing at once that was
// where things went wrong. `sync.folder` and `sync.backend` are no longer read;
// a machine that had chosen a folder reads as not configured until it connects
// Drive, and its data, which never left SQLite, is published then.
//
// Everything with a side effect arrives through `SyncDeps`, so the suite can
// run the whole flow against a temp folder (`LocalFolderProvider`) instead of
// a real Drive account.

import crypto from "node:crypto";

import { currentOwner, isOwnerFingerprint } from "../dataOwner";
import { deviceId } from "./deviceIdentity";
import {
  BUILD_DATA_FORMAT,
  dataFormatVerdict,
  vaultDataFormat
} from "./dataFormat";
import { ObfuscatedProvider } from "./obfuscatedProvider";
import type { StorageProvider } from "./storageProvider";
import type {
  DataFormatVerdict,
  SyncVaultOwnership,
  SyncVaultStatus,
  SyncVaultState
} from "./syncTypes";
import { withScreenKey } from "../screenText";

export const SYNC_SETTINGS = {
  /** The vault this machine has already published its existing data into.
   *  Compared against `vaultId()` rather than against the Drive account, so
   *  reconnecting to the same vault does not look like a new one and a
   *  genuinely different vault does. */
  seededVaultId: "sync.seededVaultId"
} as const;

/**
 * Names the vault, and says whose it is.
 *
 * Also the reachability probe. Reading one small object answers three questions
 * at once — can the destination be reached, which vault is this, whose account
 * does it belong to — and every one of them is asked on the same screen. It
 * replaced a probe of a path nothing ever wrote: that proved reachability and
 * nothing else, so ownership would have cost a second round trip on every
 * status read, which on Drive is a request per refresh.
 *
 * `id` is written once and never rewritten. `owner` is written when the first
 * signed-in machine syncs, and rewritten only when someone deliberately claims
 * the vault for a different account.
 */
export const VAULT_ID_PATH = "vault/id.json";

interface VaultIdentity {
  /**
   * The identity file's own shape. Any version from 1 is read: what this build
   * can do with the vault is decided by `dataVersion` / `dataVersionCompat`
   * (see `dataFormat.ts`), not by this. Builds from before those numbers accept
   * exactly 1 and refuse anything else without writing — which is how a later
   * format stops them, by raising this to 2 (docs/sync-v2.md §3).
   */
  readonly version: number;
  readonly id: string;
  readonly createdAt: string;
  /**
   * Fingerprint of the COROS account this vault holds the data of, or null on
   * a vault written before ownership existed — which reads as unclaimed, and
   * the next machine to sync claims it.
   */
  readonly owner: string | null;
  /** See `dataFormat.ts`. Absent on a vault from before the numbers, which is
   *  format 1. Kept on every rewrite: an identity is spread, never rebuilt. */
  readonly dataVersion?: number;
  readonly dataVersionCompat?: number;
}

function isVaultIdentity(value: unknown): value is VaultIdentity {
  if (!value || typeof value !== "object") return false;
  const identity = value as Partial<VaultIdentity>;
  return (
    typeof identity.version === "number" &&
    Number.isInteger(identity.version) &&
    identity.version >= 1 &&
    typeof identity.id === "string" &&
    /^[0-9a-f]{16}$/.test(identity.id)
  );
}

/** The owner recorded in an identity, ignoring anything that is not a
 *  fingerprint this build could have written. */
function ownerOf(identity: VaultIdentity): string | null {
  return isOwnerFingerprint(identity.owner) ? identity.owner : null;
}

export interface SyncDeps {
  readonly getSetting: (key: string) => string | undefined;
  readonly setSetting: (key: string, value: string) => void;
  /** The vault's storage: Google Drive in the app. Injected so the suite can
   *  hand over a temp directory. */
  readonly makeProvider: () => StorageProvider;
  /** Whether a Google account is connected, and whether this build has OAuth
   *  credentials at all. Kept in deps so the service never imports the OAuth
   *  module, which would drag `node:http` into every suite that touches it. */
  readonly google: {
    readonly isConnected: () => boolean;
    readonly isClientConfigured: () => boolean;
  };
  readonly deviceId: () => string;
  /** Fingerprint of the signed-in COROS account, or null when nobody is.
   *  Injected rather than imported so the suite can switch accounts without a
   *  database, and so this class never reaches into the COROS service. */
  readonly owner: () => string | null;
  readonly now: () => Date;
}

export class SyncNotReadyError extends Error {
  readonly code: "not-configured" | "outdated";

  constructor(code: "not-configured" | "outdated", message: string) {
    super(message);
    this.name = "SyncNotReadyError";
    this.code = code;
  }
}

export class SyncService {
  readonly #deps: SyncDeps;

  constructor(deps: SyncDeps) {
    this.#deps = deps;
  }

  // --- Configuration ---------------------------------------------------------

  #isConfigured(): boolean {
    return this.#deps.google.isConnected();
  }

  /** The storage, unwrapped. Nothing outside `#provider()` should use this: a
   *  caller that reached past the wrapper would write payloads the rest of the
   *  engine cannot read back. */
  #rawProvider(): StorageProvider {
    if (!this.#isConfigured()) {
      throw withScreenKey(
        new SyncNotReadyError("not-configured", "Connect a Google account before syncing."),
        "main.sync.connectGoogle"
      );
    }
    return this.#deps.makeProvider();
  }

  /**
   * Everything reads and writes through here.
   *
   * The wrapper seals every write and opens anything that arrives sealed, so a
   * vault that still holds plain payloads from an earlier build reads
   * correctly rather than failing.
   *
   * Built per call rather than cached: the account can be disconnected at any
   * moment, and providers are cheap.
   */
  #provider(): StorageProvider {
    return new ObfuscatedProvider(this.#rawProvider());
  }

  /**
   * Whether a loop could have somewhere to write.
   *
   * Signed in *and* configured. It deliberately does not answer whose vault it
   * is: that needs a read, and this is synchronous. Ownership is settled by
   * `prepare()`, and `main.ts` starts the loop only on its "ready" — so this is
   * a precondition, never the whole permission.
   */
  get isReady(): boolean {
    return this.#deps.owner() !== null && this.#isConfigured();
  }

  /** The provider, for the sync loop. Exposed rather than making the loop
   *  rebuild the seal wiring itself. */
  dataProvider(): StorageProvider {
    return this.#provider();
  }

  // --- Vault lifecycle -------------------------------------------------------

  /**
   * Check the destination, and settle who the vault belongs to.
   *
   * This is the whole of setting sync up: connecting a Drive account points the
   * service somewhere, and there is nothing to mint or unlock afterwards. What
   * is left worth doing at launch is finding out early whether Drive answers
   * and whose data is in it, so the panel can say "Drive did not answer" or
   * "that vault is another account's" instead of looking fine until the first
   * change fails to arrive.
   *
   * Unlike `status()` this may **write**: a vault nobody has claimed gets
   * claimed here, which is how the first signed-in machine takes ownership. It
   * runs on every launch and after Drive is connected, so it has to be safe to
   * repeat — claiming an already-claimed vault does nothing.
   */
  async prepare(): Promise<SyncVaultState> {
    const owner = this.#deps.owner();
    if (!owner) return "signed-out";
    if (!this.#isConfigured()) return "not-configured";

    const identity = await this.#readIdentity();
    if (!identity) {
      // An empty destination. Minting the identity is also the claim.
      await this.#mintIdentity(owner);
      return "ready";
    }
    // Before the claim below, which writes: a build that may not work with
    // this vault's format must leave it exactly as it found it.
    if (dataFormatVerdict(vaultDataFormat(identity)) === "outdated") {
      return "outdated";
    }
    const current = ownerOf(identity);
    if (!current) {
      // A vault from before ownership existed, or one whose first machine was
      // never signed in. Whoever gets here first and is signed in owns it.
      await this.#writeIdentity({ ...identity, owner });
      return "ready";
    }
    return current === owner ? "ready" : "wrong-owner";
  }

  /**
   * Read the vault's identity, or null when there is not one there yet.
   *
   * Throws when the destination cannot be reached at all, which is the signal
   * `prepare()` passes to the UI verbatim — Drive's own reason says far more
   * than "setup failed".
   */
  async #readIdentity(): Promise<VaultIdentity | null> {
    const stored = await this.#provider().get(VAULT_ID_PATH);
    if (!stored) return null;
    try {
      const parsed: unknown = JSON.parse(stored.content.toString("utf8"));
      return isVaultIdentity(parsed) ? parsed : null;
    } catch {
      // Unreadable, but the destination answered. Treated as absent: a vault
      // whose identity cannot be parsed is one nobody has claimed, and the
      // alternative is a folder that can never be used again.
      return null;
    }
  }

  async #writeIdentity(identity: VaultIdentity): Promise<void> {
    await this.#provider().put(
      VAULT_ID_PATH,
      Buffer.from(JSON.stringify(identity), "utf8")
    );
  }

  /**
   * Create the identity, if nobody beats us to it.
   *
   * Two devices can reach an empty vault at the same moment, so the create is
   * conditional — `expected: null` means "only if nobody has" — and a loser
   * simply reads the winner's. Both then agree, which is the whole requirement.
   */
  async #mintIdentity(owner: string): Promise<VaultIdentity> {
    const identity: VaultIdentity = {
      // A vault born in format 2 is one no build from before the numbers may
      // touch; they accept only identity version 1 (docs/sync-v2.md §3).
      version: BUILD_DATA_FORMAT.dataVersion >= 2 ? 2 : 1,
      id: crypto.randomBytes(8).toString("hex"),
      createdAt: this.#deps.now().toISOString(),
      owner,
      dataVersion: BUILD_DATA_FORMAT.dataVersion,
      dataVersionCompat: BUILD_DATA_FORMAT.dataVersionCompat
    };
    try {
      await this.#provider().put(
        VAULT_ID_PATH,
        Buffer.from(JSON.stringify(identity), "utf8"),
        null
      );
      return identity;
    } catch {
      const winner = await this.#readIdentity();
      if (winner) return winner;
      throw new Error("The vault could not be identified.");
    }
  }

  /** This vault's id, minting one on first contact. The seed flag is keyed on
   *  it, so it has to be answerable before anything is published. */
  async vaultId(): Promise<string> {
    const existing = await this.#readIdentity();
    if (existing) return existing.id;
    const owner = this.#deps.owner();
    if (!owner) {
      throw withScreenKey(
        new SyncNotReadyError("not-configured", "Sign in to COROS before syncing."),
        "main.sync.signInCoros"
      );
    }
    return (await this.#mintIdentity(owner)).id;
  }

  /**
   * Take a vault that belongs to another account.
   *
   * The deliberate answer to `wrong-owner`, for the case the guard cannot tell
   * apart from a real mix-up: this person's own second COROS account, or a
   * vault they made before switching accounts. Nothing merges by accident —
   * they have to ask for it.
   *
   * The seed flag is cleared, so the next loop publishes this machine's whole
   * state into the vault. Without that the machine would consider itself
   * already seeded — it is the same vault id — and the account now claiming the
   * vault would have none of its data in it.
   */
  async claimVault(): Promise<void> {
    const owner = this.#deps.owner();
    if (!owner) {
      throw withScreenKey(
        new SyncNotReadyError("not-configured", "Sign in to COROS before claiming a vault."),
        "main.sync.signInClaim"
      );
    }
    const identity =
      (await this.#readIdentity()) ?? (await this.#mintIdentity(owner));
    if (dataFormatVerdict(vaultDataFormat(identity)) === "outdated") {
      throw new SyncNotReadyError(
        "outdated",
        "This vault is in a newer data format. Update the app first."
      );
    }
    await this.#writeIdentity({ ...identity, owner });
    this.#deps.setSetting(SYNC_SETTINGS.seededVaultId, "");
  }

  /** Whether this machine has already published its pre-existing data into the
   *  vault it is now pointed at. False on a first join, and false again after
   *  being pointed at a different vault. */
  hasSeeded(vaultId: string): boolean {
    return this.#deps.getSetting(SYNC_SETTINGS.seededVaultId) === vaultId;
  }

  markSeeded(vaultId: string): void {
    this.#deps.setSetting(SYNC_SETTINGS.seededVaultId, vaultId);
  }

  /**
   * Where this build stands against the vault's data format, read fresh.
   * Null when the vault has no identity yet. Throws when it cannot be reached,
   * like `prepare()`.
   */
  async checkDataFormat(): Promise<DataFormatVerdict | null> {
    const identity = await this.#readIdentity();
    return identity ? dataFormatVerdict(vaultDataFormat(identity)) : null;
  }

  /**
   * Raise the vault's format to this build's, once a migration has written
   * what the new format needs. Conditional on the revision just read, so two
   * machines migrating together cannot both write it; never lowers either
   * number; and raises the identity's own version to 2, which is what stops a
   * build from before the numbers.
   */
  async raiseDataFormat(): Promise<void> {
    const stored = await this.#provider().get(VAULT_ID_PATH);
    if (!stored) throw new Error("The vault has no identity to raise.");
    const parsed: unknown = JSON.parse(stored.content.toString("utf8"));
    if (!isVaultIdentity(parsed)) throw new Error("The vault's identity cannot be read.");
    const current = vaultDataFormat(parsed);
    if (dataFormatVerdict(current) !== "ahead") return;
    const raised: VaultIdentity = {
      ...parsed,
      version: Math.max(parsed.version, BUILD_DATA_FORMAT.dataVersion >= 2 ? 2 : 1),
      dataVersion: BUILD_DATA_FORMAT.dataVersion,
      dataVersionCompat: Math.max(
        current.dataVersionCompat,
        BUILD_DATA_FORMAT.dataVersionCompat
      )
    };
    await this.#provider().put(
      VAULT_ID_PATH,
      Buffer.from(JSON.stringify(raised), "utf8"),
      stored.revision
    );
  }

  // --- Status ----------------------------------------------------------------

  /** The destination's own state. The change loop is not this class's to know
   *  about — `main.ts` owns it, and joins the two for the renderer. */
  async status(): Promise<SyncVaultStatus> {
    const owner = this.#deps.owner();
    const base = {
      googleConnected: this.#deps.google.isConnected(),
      googleClientConfigured: this.#deps.google.isClientConfigured(),
      deviceId: this.#deps.deviceId(),
      signedIn: owner !== null
    };

    // Before the destination, and before it has even been chosen. Sync mixes
    // two machines' records together, so whose they are is the first question,
    // not a later one.
    if (!owner) {
      return { ...base, state: "signed-out", ownership: null, dataFormat: null };
    }
    if (!this.#isConfigured()) {
      return { ...base, state: "not-configured", ownership: null, dataFormat: null };
    }

    // One small object answers reachability, identity and ownership together.
    // This used to list the whole vault so it could report a snapshot count —
    // every status read digested every file in the vault, and the panel then
    // asked for the same listing again — two full walks per refresh.
    //
    // Unlike `prepare()` this only reads, and it swallows the failure: a panel
    // that cannot say "offline" because asking threw is worse than a panel with
    // one row less.
    try {
      const identity = await this.#readIdentity();
      const dataFormat = identity
        ? dataFormatVerdict(vaultDataFormat(identity))
        : "current";
      const recorded = identity ? ownerOf(identity) : null;
      const ownership: SyncVaultOwnership = !recorded
        ? "unclaimed"
        : recorded === owner
          ? "mine"
          : "other";
      return {
        ...base,
        // `unclaimed` is reported ready: `prepare()` claims it on the next run,
        // and nothing about the destination is wrong. Another account's vault
        // is reported as that even when its format is newer: the account is
        // the first thing wrong with it.
        state:
          ownership === "other"
            ? "wrong-owner"
            : dataFormat === "outdated"
              ? "outdated"
              : "ready",
        ownership,
        dataFormat
      };
    } catch {
      return { ...base, state: "unreachable", ownership: null, dataFormat: null };
    }
  }
}

/** Wiring for the real app. Deliberately thin — everything it assembles is
 *  covered by the suite through injected fakes. */
export function createDefaultSyncDeps(
  database: {
    getSetting: (key: string) => string | undefined;
    setSetting: (key: string, value: string) => void;
  },
  google: {
    readonly isConnected: () => boolean;
    readonly isClientConfigured: () => boolean;
    readonly makeProvider: () => StorageProvider;
  }
): SyncDeps {
  return {
    getSetting: database.getSetting,
    setSetting: database.setSetting,
    makeProvider: google.makeProvider,
    google: {
      isConnected: google.isConnected,
      isClientConfigured: google.isClientConfigured
    },
    deviceId,
    owner: currentOwner,
    now: () => new Date()
  };
}
