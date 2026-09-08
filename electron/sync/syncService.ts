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
// Everything with a side effect arrives through `SyncDeps`, so the suite can
// run the whole flow against a temp folder instead of a real Drive account.

import crypto from "node:crypto";

import { currentOwner, isOwnerFingerprint } from "../dataOwner";
import { deviceId } from "./deviceIdentity";
import { LocalFolderProvider } from "./localFolderProvider";
import { ObfuscatedProvider } from "./obfuscatedProvider";
import type { StorageProvider } from "./storageProvider";
import type {
  SyncBackend,
  SyncVaultOwnership,
  SyncVaultStatus,
  SyncVaultState
} from "./syncTypes";

export const SYNC_SETTINGS = {
  folder: "sync.folder",
  backend: "sync.backend",
  /** The vault this machine has already published its existing data into.
   *  Compared against `vaultId()` rather than against the folder or the
   *  backend, so moving a vault does not look like a new one and pointing at a
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
const VAULT_ID_PATH = "vault/id.json";

interface VaultIdentity {
  readonly version: 1;
  readonly id: string;
  readonly createdAt: string;
  /**
   * Fingerprint of the COROS account this vault holds the data of, or null on
   * a vault written before ownership existed — which reads as unclaimed, and
   * the next machine to sync claims it.
   */
  readonly owner: string | null;
}

function isVaultIdentity(value: unknown): value is VaultIdentity {
  if (!value || typeof value !== "object") return false;
  const identity = value as Partial<VaultIdentity>;
  return (
    identity.version === 1 &&
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
  /** Built from whichever backend is selected. Injected so the suite can hand
   *  over a temp directory, and so a new backend is one function away. */
  readonly makeProvider: (target: SyncTarget) => StorageProvider;
  /** Whether a Google account is connected, and whether this build has OAuth
   *  credentials at all. Kept in deps so the service never imports the OAuth
   *  module, which would drag `node:http` into every suite that touches it. */
  readonly google?: {
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

/** What `makeProvider` is asked to build. */
export interface SyncTarget {
  readonly backend: SyncBackend;
  /** Set for the local backend, null for Google. */
  readonly folder: string | null;
}

export class SyncNotReadyError extends Error {
  readonly code: "not-configured";

  constructor(code: "not-configured", message: string) {
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

  get folder(): string | null {
    return this.#deps.getSetting(SYNC_SETTINGS.folder) ?? null;
  }

  /**
   * Point the vault at a folder.
   *
   * The seed flag is deliberately left alone. It names a vault by id, so moving
   * one — a renamed folder, a copy onto another disk, the same files reached
   * through Drive instead — is still the same vault and needs no second
   * publish. Pointing at a genuinely different vault fails the id comparison on
   * its own, so there is nothing to clear in advance.
   */
  setFolder(folder: string): void {
    this.#deps.setSetting(SYNC_SETTINGS.folder, folder);
  }

  get backend(): SyncBackend {
    return this.#deps.getSetting(SYNC_SETTINGS.backend) === "google"
      ? "google"
      : "local";
  }

  /** Same reasoning as `setFolder`: the vault's id outlives the route taken to
   *  reach it, so switching backends does not by itself mean a new vault. */
  setBackend(backend: SyncBackend): void {
    this.#deps.setSetting(SYNC_SETTINGS.backend, backend);
  }

  #isConfigured(): boolean {
    return this.backend === "google"
      ? Boolean(this.#deps.google?.isConnected())
      : Boolean(this.folder);
  }

  /** The configured backend, unwrapped. Nothing outside `#provider()` should
   *  use this: a caller that reached past the wrapper would write payloads the
   *  rest of the engine cannot read back. */
  #rawProvider(): StorageProvider {
    if (!this.#isConfigured()) {
      throw new SyncNotReadyError(
        "not-configured",
        this.backend === "google"
          ? "Connect a Google account before syncing."
          : "Choose a folder for the sync vault first."
      );
    }
    return this.#deps.makeProvider({
      backend: this.backend,
      folder: this.folder
    });
  }

  /**
   * Everything reads and writes through here.
   *
   * The wrapper seals every write and opens anything that arrives sealed, so a
   * folder that still holds plain payloads from an earlier build reads
   * correctly rather than failing.
   *
   * Built per call rather than cached: the backend and folder are settings the
   * user can change at any moment, and providers are cheap.
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
   *  rebuild the backend selection and the seal wiring itself. */
  dataProvider(): StorageProvider {
    return this.#provider();
  }

  // --- Vault lifecycle -------------------------------------------------------

  /**
   * Check the destination, and settle who the vault belongs to.
   *
   * This is the whole of setting sync up: choosing a folder or connecting a
   * Drive account points the service somewhere, and there is nothing to mint or
   * unlock afterwards. What is left worth doing at launch is finding out early
   * whether the destination answers and whose data is in it, so the panel can
   * say "that share is offline" or "that vault is another account's" instead of
   * looking fine until the first change fails to arrive.
   *
   * Unlike `status()` this may **write**: a vault nobody has claimed gets
   * claimed here, which is how the first signed-in machine takes ownership. It
   * runs on every launch and after the folder or backend changes, so it has to
   * be safe to repeat — claiming an already-claimed vault does nothing.
   *
   * Two cases reachability cannot catch, both surfacing at write time instead: a
   * folder that is readable but not writable, and a mount point whose drive is
   * gone, which looks exactly like an empty folder.
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
   * `prepare()` passes to the UI verbatim — "EACCES" says far more than "setup
   * failed".
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
      version: 1,
      id: crypto.randomBytes(8).toString("hex"),
      createdAt: this.#deps.now().toISOString(),
      owner
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
      throw new SyncNotReadyError(
        "not-configured",
        "Sign in to COROS before syncing."
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
      throw new SyncNotReadyError(
        "not-configured",
        "Sign in to COROS before claiming a vault."
      );
    }
    const identity =
      (await this.#readIdentity()) ?? (await this.#mintIdentity(owner));
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

  // --- Status ----------------------------------------------------------------

  /** The destination's own state. The change loop is not this class's to know
   *  about — `main.ts` owns it, and joins the two for the renderer. */
  async status(): Promise<SyncVaultStatus> {
    const owner = this.#deps.owner();
    const base = {
      backend: this.backend,
      folder: this.folder,
      googleConnected: Boolean(this.#deps.google?.isConnected()),
      googleClientConfigured: Boolean(this.#deps.google?.isClientConfigured()),
      deviceId: this.#deps.deviceId(),
      signedIn: owner !== null
    };

    // Before the destination, and before it has even been chosen. Sync mixes
    // two machines' records together, so whose they are is the first question,
    // not a later one.
    if (!owner) {
      return { ...base, state: "signed-out", ownership: null };
    }
    if (!this.#isConfigured()) {
      return { ...base, state: "not-configured", ownership: null };
    }

    // One small object answers reachability, identity and ownership together.
    // This used to list the whole vault so it could report a snapshot count —
    // every status read digested every file in the folder, and the panel then
    // asked for the same listing again. Two full walks per refresh was most of
    // what made switching backends feel like a freeze.
    //
    // Unlike `prepare()` this only reads, and it swallows the failure: a panel
    // that cannot say "offline" because asking threw is worse than a panel with
    // one row less.
    try {
      const identity = await this.#readIdentity();
      const recorded = identity ? ownerOf(identity) : null;
      const ownership: SyncVaultOwnership = !recorded
        ? "unclaimed"
        : recorded === owner
          ? "mine"
          : "other";
      return {
        ...base,
        // `unclaimed` is reported ready: `prepare()` claims it on the next run,
        // and nothing about the destination is wrong.
        state: ownership === "other" ? "wrong-owner" : "ready",
        ownership
      };
    } catch {
      return { ...base, state: "unreachable", ownership: null };
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
  google?: {
    readonly isConnected: () => boolean;
    readonly isClientConfigured: () => boolean;
    readonly makeProvider: () => StorageProvider;
  }
): SyncDeps {
  return {
    getSetting: database.getSetting,
    setSetting: database.setSetting,
    makeProvider: (target) => {
      if (target.backend === "google") {
        if (!google) {
          throw new Error("This build has no Google Drive support compiled in.");
        }
        return google.makeProvider();
      }
      if (!target.folder) {
        throw new Error("The local backend needs a folder.");
      }
      return new LocalFolderProvider({ root: target.folder });
    },
    google,
    deviceId,
    owner: currentOwner,
    now: () => new Date()
  };
}
