// A Google Drive stand-in, just complete enough to run the storage contract.
//
// It exists because the alternative is a suite that skips whenever credentials
// are absent — which is always, in CI — leaving the provider's own logic
// unexercised: the multipart upload, the query escaping, the duplicate-name
// race that decides a lease, the change feed. Those are where the bugs live,
// and none of them need a real Google account to catch.
//
// It models the parts of the API the provider actually uses, and nothing else.
// Where it guesses, it guesses in Drive's favour: no atomic create, several
// files may share an appProperties path, and `createdTime` is what settles who
// got there first.

import crypto from "node:crypto";

export class FakeDrive {
  constructor({ now } = {}) {
    /** @type {Map<string, {id, name, parents, mimeType, appProperties, content, createdTime, modifiedTime, version, trashed}>} */
    this.files = new Map();
    this.changes = [];
    this.requests = [];
    this.nextId = 1;
    this.clock = 0;
    this.now = now ?? (() => new Date(1_700_000_000_000 + this.clock++).toISOString());
    /** Queue of statuses to return before behaving normally, for retry tests. */
    this.failures = [];
  }

  /** A `fetch` the provider can be constructed with. */
  fetch = async (url, init = {}) => {
    this.requests.push({ url: String(url), method: init.method ?? "GET" });

    const forced = this.failures.shift();
    if (forced) {
      return new Response("rate limited", {
        status: forced.status,
        headers: forced.retryAfter
          ? { "retry-after": String(forced.retryAfter) }
          : {}
      });
    }

    const parsed = new URL(String(url));
    const method = (init.method ?? "GET").toUpperCase();

    if (parsed.pathname === "/drive/v3/changes/startPageToken") {
      return json({ startPageToken: String(this.changes.length) });
    }
    if (parsed.pathname === "/drive/v3/changes") {
      return this.#listChanges(parsed);
    }
    if (parsed.pathname === "/upload/drive/v3/files" && method === "POST") {
      return this.#multipartCreate(init);
    }
    if (parsed.pathname.startsWith("/upload/drive/v3/files/") && method === "PATCH") {
      return this.#mediaUpdate(parsed.pathname.split("/").at(-1), init);
    }
    if (parsed.pathname === "/drive/v3/files" && method === "POST") {
      return this.#metadataCreate(init);
    }
    if (parsed.pathname === "/drive/v3/files" && method === "GET") {
      return this.#listFiles(parsed);
    }
    if (parsed.pathname.startsWith("/drive/v3/files/")) {
      const id = parsed.pathname.split("/").at(-1);
      if (method === "DELETE") {
        return this.#delete(id);
      }
      if (parsed.searchParams.get("alt") === "media") {
        const file = this.files.get(id);
        if (!file || file.trashed) return new Response("not found", { status: 404 });
        return new Response(file.content, { status: 200 });
      }
    }
    return new Response(`unhandled: ${method} ${parsed.pathname}`, { status: 501 });
  };

  #record(file, removed = false) {
    this.changes.push({ removed, fileId: file.id, file: { ...file } });
  }

  #materialise(file) {
    return {
      id: file.id,
      name: file.name,
      size: String(file.content?.length ?? 0),
      md5Checksum: file.mimeType
        ? undefined
        : crypto.createHash("md5").update(file.content ?? Buffer.alloc(0)).digest("hex"),
      version: String(file.version),
      createdTime: file.createdTime,
      modifiedTime: file.modifiedTime,
      appProperties: file.appProperties
    };
  }

  #metadataCreate(init) {
    const metadata = JSON.parse(String(init.body));
    return json(this.#create(metadata, Buffer.alloc(0)));
  }

  #multipartCreate(init) {
    const body = Buffer.isBuffer(init.body) ? init.body : Buffer.from(init.body);
    const text = body.toString("binary");
    const boundary = /boundary=([^\s;]+)/.exec(
      String(init.headers?.["Content-Type"] ?? "")
    )?.[1];
    if (!boundary) return new Response("no boundary", { status: 400 });

    // Two parts: JSON metadata, then the bytes. Split on the boundary and take
    // what follows each part's blank line.
    const parts = text.split(`--${boundary}`).slice(1, -1);
    const metadata = JSON.parse(parts[0].split("\r\n\r\n").slice(1).join("\r\n\r\n"));
    const rawIndex = body.indexOf(
      Buffer.from("application/octet-stream\r\n\r\n", "binary")
    );
    const start = rawIndex + "application/octet-stream\r\n\r\n".length;
    const end = body.lastIndexOf(Buffer.from(`\r\n--${boundary}--`, "binary"));
    const content = body.subarray(start, end < 0 ? undefined : end);

    return json(this.#create(metadata, Buffer.from(content)));
  }

  #create(metadata, content) {
    const id = `file-${this.nextId++}`;
    const stamp = this.now();
    const file = {
      id,
      name: metadata.name,
      parents: metadata.parents ?? [],
      mimeType: metadata.mimeType,
      appProperties: metadata.appProperties,
      content,
      createdTime: stamp,
      modifiedTime: stamp,
      version: 1,
      trashed: false
    };
    this.files.set(id, file);
    this.#record(this.#materialise(file));
    return this.#materialise(file);
  }

  #mediaUpdate(id, init) {
    const file = this.files.get(id);
    if (!file) return new Response("not found", { status: 404 });
    file.content = Buffer.isBuffer(init.body)
      ? init.body
      : Buffer.from(init.body ?? "");
    file.version += 1;
    file.modifiedTime = this.now();
    this.#record(this.#materialise(file));
    return json(this.#materialise(file));
  }

  #delete(id) {
    const file = this.files.get(id);
    if (file) {
      this.files.delete(id);
      this.#record({ ...this.#materialise(file) }, true);
    }
    // 204 must carry a null body; a string here throws in undici.
    return new Response(null, { status: 204 });
  }

  #listFiles(parsed) {
    const query = parsed.searchParams.get("q") ?? "";
    const matches = [...this.files.values()].filter((file) =>
      matchesQuery(file, query)
    );
    return json({ files: matches.map((file) => this.#materialise(file)) });
  }

  #listChanges(parsed) {
    const from = Number(parsed.searchParams.get("pageToken") ?? "0");
    const slice = this.changes.slice(from);
    return json({
      changes: slice,
      newStartPageToken: String(this.changes.length)
    });
  }
}

function json(payload) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

/** Enough of Drive's query language for what the provider sends. */
function matchesQuery(file, query) {
  if (query.includes("trashed=false") && file.trashed) return false;

  const parent = /'([^']+)' in parents/.exec(query);
  if (parent && !(file.parents ?? []).includes(parent[1])) return false;

  const mime = /mimeType='([^']+)'/.exec(query);
  if (mime && file.mimeType !== mime[1]) return false;

  const name = /name='((?:[^'\\]|\\.)*)'/.exec(query);
  if (name && file.name !== unescapeQuery(name[1])) return false;

  const appProperty =
    /appProperties has \{ key='path' and value='((?:[^'\\]|\\.)*)' \}/.exec(query);
  if (appProperty) {
    return file.appProperties?.path === unescapeQuery(appProperty[1]);
  }
  return true;
}

function unescapeQuery(value) {
  return value.replace(/\\'/g, "'").replace(/\\\\/g, "\\");
}
