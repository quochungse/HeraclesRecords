// StorageProvider backed by Google Drive.
//
// Three things about Drive shape this file, and each one is a place where the
// obvious implementation is wrong:
//
// **Revisions.** `headRevisionId` looks like the right field and is not: it
// tracks Drive's own version history, which advances on metadata edits and is
// not a compare-and-swap token. `md5Checksum` is a digest of the content, which
// is exactly what LocalFolderProvider uses, so both backends end up with the
// same semantics — including the same benign ABA caveat documented there.
//
// **Conditional writes.** Drive has no working `If-Match` for content updates,
// so a revision precondition is read-then-write with a real gap in between.
// That gap is why `expected: null` is handled separately below rather than
// riding on the same path.
//
// **Claiming a name.** There is no atomic create-if-absent either, which would
// leave the lease in step 8 with no way to pick a single winner. The way out is
// to let every racer create its file and then settle it afterwards: Drive
// happily holds several files with the same `appProperties.path`, so the one
// with the earliest `createdTime` wins and the losers delete their own copy and
// report a conflict. Slower than a filesystem `link()`, but it does produce
// exactly one winner.
//
// Paths live in `appProperties.path` rather than in a folder tree. With the
// `drive.file` scope the app only ever sees what it created, so a flat folder
// of files whose names are readable and whose full paths are in metadata is
// simpler than maintaining nested folders, and makes `list` one query.

import crypto from "node:crypto";

import { SYNC_USER_AGENT } from "./googleOAuth";
import {
  StorageConflictError,
  isUnderPrefix,
  normalizeStoragePath,
  type ExpectedRevision,
  type StorageChange,
  type StorageChanges,
  type StorageContent,
  type StorageEntry,
  type StorageProvider
} from "./storageProvider";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const DEFAULT_FOLDER_NAME = "Heracles Records";

/** Fields worth asking for. Drive returns almost nothing unless told. */
const FILE_FIELDS = "id,name,size,md5Checksum,version,modifiedTime,createdTime,appProperties";

export interface GoogleDriveProviderOptions {
  readonly fetch: typeof globalThis.fetch;
  readonly accessToken: () => Promise<string>;
  readonly folderName?: string;
  readonly now?: () => number;
  /** Injected so the suite can exercise backoff without waiting for it. */
  readonly sleep?: (ms: number) => Promise<void>;
  readonly maxAttempts?: number;
}

interface DriveFile {
  readonly id: string;
  readonly name?: string;
  readonly size?: string;
  readonly md5Checksum?: string;
  readonly version?: string;
  readonly modifiedTime?: string;
  readonly createdTime?: string;
  readonly appProperties?: Record<string, string>;
}

export class GoogleDriveProvider implements StorageProvider {
  readonly name = "google drive";
  readonly #options: GoogleDriveProviderOptions;
  readonly #folderName: string;
  #folderId: string | null = null;
  /** In-flight lookup, shared by concurrent callers so one provider cannot
   *  create its own folder twice while the first create is still in the air. */
  #folderLookup: Promise<string> | null = null;

  constructor(options: GoogleDriveProviderOptions) {
    this.#options = options;
    this.#folderName = options.folderName ?? DEFAULT_FOLDER_NAME;
  }

  // --- HTTP ------------------------------------------------------------------

  /**
   * One Drive request, retrying the failures that are worth retrying.
   *
   * 429 and 5xx are transient; everything else is a real answer and is returned
   * to the caller. `Retry-After` wins when Drive sends one, because guessing
   * shorter than the server asked is how a rate limit becomes a ban.
   */
  async #request(
    url: string,
    init: RequestInit = {},
    attempt = 1
  ): Promise<Response> {
    const token = await this.#options.accessToken();
    const response = await this.#options.fetch(url, {
      ...init,
      headers: {
        ...(init.headers as Record<string, string> | undefined),
        Authorization: `Bearer ${token}`,
        "User-Agent": SYNC_USER_AGENT
      }
    });

    const maxAttempts = this.#options.maxAttempts ?? 5;
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt >= maxAttempts) {
      return response;
    }

    const retryAfter = Number(response.headers.get("retry-after"));
    const backoff = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      // Exponential with jitter: three devices waking together must not retry
      // in lockstep and rebuild the same pile-up they are backing off from.
      : 2 ** attempt * 250 + Math.random() * 250;

    await (this.#options.sleep ?? defaultSleep)(backoff);
    return this.#request(url, init, attempt + 1);
  }

  async #json<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await this.#request(url, init);
    if (!response.ok) {
      throw new Error(
        `Google Drive request failed (${response.status}): ${await response
          .text()
          .catch(() => "")}`
      );
    }
    return (await response.json()) as T;
  }

  // --- Folder ----------------------------------------------------------------

  /** The app's folder, created on first use and then cached: it cannot change
   *  while the app runs, and looking it up per call would double every request. */
  async #folder(): Promise<string> {
    if (this.#folderId) return this.#folderId;
    this.#folderLookup ??= this.#resolveFolder().finally(() => {
      this.#folderLookup = null;
    });
    return this.#folderLookup;
  }

  async #findFolders(): Promise<DriveFile[]> {
    const query = [
      `mimeType='${FOLDER_MIME}'`,
      `name='${escapeQuery(this.#folderName)}'`,
      "trashed=false"
    ].join(" and ");
    const found = await this.#json<{ files?: DriveFile[] }>(
      `${DRIVE_API}/files?q=${encodeURIComponent(query)}&fields=files(id,createdTime)`
    );
    return [...(found.files ?? [])].sort(compareByCreation);
  }

  /**
   * Find the vault folder, creating it only if nobody has.
   *
   * Drive allows two folders with the same name, so two devices connecting at
   * the same moment would each make one and then never see each other's data —
   * one account, two silently divergent vaults. Settling duplicates the same
   * way `#claim` does keeps every device on the oldest folder.
   */
  async #resolveFolder(): Promise<string> {
    const existing = await this.#findFolders();
    if (existing.length > 0) {
      this.#folderId = existing[0].id;
      return this.#folderId;
    }

    const created = await this.#json<DriveFile>(`${DRIVE_API}/files`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: this.#folderName, mimeType: FOLDER_MIME })
    });

    const all = await this.#findFolders();
    const winner = all[0] ?? created;
    if (winner.id !== created.id) {
      // Lost the race. Remove our folder so the account keeps exactly one, and
      // adopt the winner — anything already written into ours is nothing, since
      // it was created moments ago and holds no objects yet.
      await this.#request(`${DRIVE_API}/files/${created.id}`, {
        method: "DELETE"
      });
    }
    this.#folderId = winner.id;
    return winner.id;
  }

  // --- Lookups ---------------------------------------------------------------

  /** Every file the app has put in its folder. Paginated: Drive caps a page at
   *  1000 and silently truncates if the token is ignored. */
  async #allFiles(): Promise<DriveFile[]> {
    const folderId = await this.#folder();
    const query = `'${folderId}' in parents and trashed=false`;
    const files: DriveFile[] = [];
    let pageToken: string | undefined;

    do {
      const url = new URL(`${DRIVE_API}/files`);
      url.searchParams.set("q", query);
      url.searchParams.set("fields", `nextPageToken,files(${FILE_FIELDS})`);
      url.searchParams.set("pageSize", "1000");
      if (pageToken) url.searchParams.set("pageToken", pageToken);

      const page = await this.#json<{
        files?: DriveFile[];
        nextPageToken?: string;
      }>(url.toString());
      files.push(...(page.files ?? []));
      pageToken = page.nextPageToken;
    } while (pageToken);

    return files.filter((file) => typeof file.appProperties?.path === "string");
  }

  /** Every file claiming a given path, oldest first. More than one means two
   *  devices raced; see the class comment. */
  async #filesAt(storagePath: string): Promise<DriveFile[]> {
    const folderId = await this.#folder();
    const query = [
      `'${folderId}' in parents`,
      "trashed=false",
      `appProperties has { key='path' and value='${escapeQuery(storagePath)}' }`
    ].join(" and ");

    const found = await this.#json<{ files?: DriveFile[] }>(
      `${DRIVE_API}/files?q=${encodeURIComponent(query)}&fields=files(${FILE_FIELDS})`
    );
    return [...(found.files ?? [])].sort(compareByCreation);
  }

  async #fileAt(storagePath: string): Promise<DriveFile | null> {
    return (await this.#filesAt(storagePath))[0] ?? null;
  }

  // --- StorageProvider -------------------------------------------------------

  async list(prefix?: string): Promise<StorageEntry[]> {
    const files = await this.#allFiles();
    const entries: StorageEntry[] = [];
    const seen = new Set<string>();

    for (const file of files.sort(compareByCreation)) {
      const storagePath = file.appProperties?.path as string;
      // A raced create leaves duplicates behind; the oldest is the real one.
      if (seen.has(storagePath)) continue;
      seen.add(storagePath);
      if (!isUnderPrefix(storagePath, prefix)) continue;

      entries.push({
        path: storagePath,
        revision: revisionOf(file),
        size: Number(file.size ?? 0),
        modifiedAt: file.modifiedTime ?? new Date(0).toISOString()
      });
    }
    return entries;
  }

  async get(storagePath: string): Promise<StorageContent | null> {
    const normalized = normalizeStoragePath(storagePath);
    const file = await this.#fileAt(normalized);
    if (!file) return null;

    const response = await this.#request(
      `${DRIVE_API}/files/${file.id}?alt=media`
    );
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(
        `Google Drive download failed (${response.status}) for ${normalized}`
      );
    }
    return {
      content: Buffer.from(await response.arrayBuffer()),
      revision: revisionOf(file)
    };
  }

  async put(
    storagePath: string,
    content: Buffer,
    expected?: ExpectedRevision
  ): Promise<string> {
    const normalized = normalizeStoragePath(storagePath);

    if (expected === null) {
      return this.#claim(normalized, content);
    }

    const existing = await this.#fileAt(normalized);
    if (typeof expected === "string") {
      const actual = existing ? revisionOf(existing) : null;
      if (actual !== expected) {
        throw new StorageConflictError(normalized, expected, actual);
      }
    }

    if (existing) {
      await this.#uploadMedia(existing.id, content);
    } else {
      await this.#createFile(normalized, content);
    }
    return contentRevision(content);
  }

  /**
   * Claim a path that must not already exist.
   *
   * Drive cannot do this atomically, so this creates first and resolves the
   * race afterwards. Every racer ends up agreeing on the same winner — the
   * oldest file — because they are all reading the same server-assigned
   * `createdTime`, with the file id breaking ties when two land in the same
   * millisecond.
   */
  async #claim(storagePath: string, content: Buffer): Promise<string> {
    const before = await this.#filesAt(storagePath);
    if (before.length > 0) {
      throw new StorageConflictError(
        storagePath,
        null,
        revisionOf(before[0])
      );
    }

    const created = await this.#createFile(storagePath, content);
    const after = await this.#filesAt(storagePath);
    const winner = after[0];

    if (!winner || winner.id === created.id) {
      return contentRevision(content);
    }

    // Someone else got there first. Take our own file back out so the folder is
    // left exactly as the winner expects it.
    await this.#request(`${DRIVE_API}/files/${created.id}`, {
      method: "DELETE"
    });
    throw new StorageConflictError(storagePath, null, revisionOf(winner));
  }

  async #createFile(storagePath: string, content: Buffer): Promise<DriveFile> {
    const folderId = await this.#folder();
    const metadata = {
      name: storagePath.split("/").at(-1) ?? storagePath,
      parents: [folderId],
      // The real path. `name` is only there so the folder reads sensibly to a
      // person who opens it in Drive.
      appProperties: { path: storagePath }
    };

    const boundary = `heracles-${Math.random().toString(36).slice(2)}`;
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
          `${JSON.stringify(metadata)}\r\n` +
          `--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`,
        "utf8"
      ),
      content,
      Buffer.from(`\r\n--${boundary}--\r\n`, "utf8")
    ]);

    return this.#json<DriveFile>(
      `${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=${FILE_FIELDS}`,
      {
        method: "POST",
        headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
        body: body
      }
    );
  }

  async #uploadMedia(fileId: string, content: Buffer): Promise<DriveFile> {
    return this.#json<DriveFile>(
      `${DRIVE_UPLOAD_API}/files/${fileId}?uploadType=media&fields=${FILE_FIELDS}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/octet-stream" },
        body: content
      }
    );
  }

  async delete(storagePath: string, expected?: ExpectedRevision): Promise<void> {
    const normalized = normalizeStoragePath(storagePath);
    const files = await this.#filesAt(normalized);
    const existing = files[0] ?? null;

    if (expected !== undefined) {
      const actual = existing ? revisionOf(existing) : null;
      if (expected === null) {
        if (actual === null) return;
        throw new StorageConflictError(normalized, expected, actual);
      }
      if (actual !== expected) {
        throw new StorageConflictError(normalized, expected, actual);
      }
    }

    // Remove every copy, so a leftover from a lost race cannot resurface later
    // as if it were the live object.
    for (const file of files) {
      await this.#request(`${DRIVE_API}/files/${file.id}`, { method: "DELETE" });
    }
  }

  /**
   * Drive's own change feed.
   *
   * The cursor is Drive's page token, opaque to callers exactly as the
   * interface promises — LocalFolderProvider puts a listing digest in the same
   * field, and neither the sync engine nor its suites can tell the difference.
   */
  async pollChanges(cursor?: string): Promise<StorageChanges> {
    const token = cursor ?? (await this.#startPageToken());
    const changes: StorageChange[] = [];
    let pageToken: string | undefined = token;
    let newStartPageToken: string | undefined;

    do {
      const url = new URL(`${DRIVE_API}/changes`);
      url.searchParams.set("pageToken", pageToken);
      url.searchParams.set("spaces", "drive");
      url.searchParams.set(
        "fields",
        `nextPageToken,newStartPageToken,changes(removed,fileId,file(${FILE_FIELDS}))`
      );

      const page = await this.#json<{
        changes?: Array<{ removed?: boolean; file?: DriveFile }>;
        nextPageToken?: string;
        newStartPageToken?: string;
      }>(url.toString());

      for (const change of page.changes ?? []) {
        const storagePath = change.file?.appProperties?.path;
        // Changes to files outside this app's folder are none of its business.
        if (typeof storagePath !== "string") continue;
        changes.push({
          path: storagePath,
          revision: change.removed ? null : revisionOf(change.file as DriveFile)
        });
      }

      pageToken = page.nextPageToken;
      newStartPageToken = page.newStartPageToken ?? newStartPageToken;
    } while (pageToken);

    return { changes, nextCursor: newStartPageToken ?? token };
  }

  async #startPageToken(): Promise<string> {
    const response = await this.#json<{ startPageToken: string }>(
      `${DRIVE_API}/changes/startPageToken`
    );
    return response.startPageToken;
  }
}

/** Content digest, matching LocalFolderProvider's meaning of "revision".
 *  `version` is the fallback for the rare file Drive reports no checksum for. */
function revisionOf(file: DriveFile): string {
  return file.md5Checksum ?? `v${file.version ?? "0"}`;
}

/** What `put` returns without a second round trip. Drive computes the same MD5
 *  over the same bytes, so this matches what a later `get` will report. */
function contentRevision(content: Buffer): string {
  return crypto.createHash("md5").update(content).digest("hex");
}

function compareByCreation(a: DriveFile, b: DriveFile): number {
  const left = a.createdTime ?? "";
  const right = b.createdTime ?? "";
  if (left !== right) return left < right ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Drive query strings are single-quoted, so both the quote and the escape
 *  character have to be escaped or a path could rewrite the query. */
function escapeQuery(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
