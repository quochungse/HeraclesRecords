# Bundled binaries

Run the binary preparation script before running `npm run dist`:

```sh
npm run binaries:prepare
```

It downloads the pinned yt-dlp release asset, copies the `ffmpeg-static` binary,
vendors a self-contained CPython runtime (from `astral-sh/python-build-standalone`)
so users don't need Python installed, and vendors the pinned `ytmusicapi` Python
package plus dependencies into this folder.

Override the Python runtime release with `PYTHON_STANDALONE_TAG=<tag>`.

## It is cached, because `npm run dev` runs it

`dev:electron` calls this script on every start. Each step records what it
produced in `.prepared.json` here and skips itself when the manifest and the
files on disk already agree, so a warm run costs well under a second and touches
the network not at all. A cold run is ~120 MB.

That matters for more than speed: `concurrently -k` kills the whole dev command
when one half exits non-zero, so before the cache a single flaky connection to
GitHub took the Vite server down with it and left the app unstartable.

| Flag | Effect |
|---|---|
| `--force` | Re-fetch everything, manifest or not. For a moved release tag, or a directory that looks intact but is not. |
| `--verbose` | Say which steps were skipped and why. |

The manifest is not the only check — the artifacts themselves are verified to
exist and be non-empty, and the Python runtime's interpreter is checked
specifically, because a torn extraction leaves a tree that exists and does not
run. Deleting anything under `bin/<platform>-<arch>/` is enough to make the next
run rebuild it.

`YT_DLP_VERSION=latest` is deliberately never cached: it resolves through the
GitHub API, and answering "the newest release" from a stale manifest would be a
lie.

## Downloads retry, and follow a proxy

A connect timeout to github.com is usually gone a second later, so each download
gets three attempts with backoff. A 4xx is not retried — a missing release asset
will still be missing.

Node's `fetch` ignores `HTTPS_PROXY`/`HTTP_PROXY` unless started with
`--use-env-proxy`, and that flag is read at bootstrap. So when a proxy is
configured and Node is not using it, the script re-execs itself with the flag.
Behind a corporate proxy the alternative is a connect timeout that looks exactly
like the network being down.

To use a different yt-dlp version:

```sh
YT_DLP_VERSION=2026.08.19 npm run binaries:prepare
```

Set `YT_DLP_VERSION=latest` to query GitHub for the newest release (requires `GITHUB_TOKEN` in CI).

Recommended layout:

- `bin/darwin-arm64/yt-dlp`
- `bin/darwin-arm64/ffmpeg`
- `bin/darwin-arm64/python-runtime/bin/python3`
- `bin/darwin-arm64/python/ytmusicapi`
- `bin/darwin-x64/yt-dlp`
- `bin/darwin-x64/ffmpeg`
- `bin/darwin-x64/python-runtime/bin/python3`
- `bin/darwin-x64/python/ytmusicapi`
- `bin/win32-x64/yt-dlp.exe`
- `bin/win32-x64/ffmpeg.exe`
- `bin/win32-x64/python-runtime/python.exe`
- `bin/win32-x64/python/ytmusicapi`

During development, the app also falls back to `yt-dlp` and `ffmpeg` on `PATH`.
For YouTube Music, the app runs the bundled `python-runtime` interpreter (falling
back to a system `python3`/`python` ≥ 3.10 only if the runtime is absent) and
prepends the bundled `python` directory to `PYTHONPATH` so `ytmusicapi` resolves
without any user setup.
