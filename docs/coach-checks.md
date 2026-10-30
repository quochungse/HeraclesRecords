# Coach checks

Run from the repository root after installing dependencies and rebuilding the
SQLite module for Electron:

```sh
npm ci
npm run rebuild
npm run check:coach
```

The command builds Electron, the production renderer and the renderer harness
once each, then runs the checks directly. It stops at the first failed step,
returns a nonzero exit code and keeps each step's output in
`.work/check-coach/`. These logs are replaced at the start of the next check.
A step still running after five minutes is killed with everything it started
and counts as failed, so a window that never loads names itself rather than
running into the CI job's limit.

The checks cover:

- CSS tokens, design vocabulary, sync policy, IPC contracts and translations.
- Provider catalogs and requests, reasoning effort, conversation settings,
  context compaction, analyses and plan generation.
- The production import graph: provider management stays out of the initial
  application, Coach and conversation AI sheet chunks. The check also prints
  the total size of initial JavaScript and its gzip size.
- Real Electron renderer behaviour: login/logout, refresh, model and effort
  selection, deferred loading, loading placeholders, contained chunk failures,
  unsaved drafts and responsive layouts in both themes.

The provider tests use stubs and temporary data. No real sign-in or API key is
needed. Production builds made by this check include a Vite manifest for the
import-graph check; ordinary builds keep their existing output settings.

On a Linux machine without a display, run under Xvfb with a 24-bit screen
(xvfb-run's default is 640x480 at 8 bits):

```sh
xvfb-run --auto-servernum --server-args="-screen 0 1920x1200x24" npm run check:coach
```

On Ubuntu 23.10 and later, Chromium's sandbox needs unprivileged user
namespaces, which AppArmor denies to Electron by default; the workflow lifts
that with `sysctl kernel.apparmor_restrict_unprivileged_userns=0`.

`.github/workflows/check-coach.yml` runs the same command for pull requests,
pushes to `main` and manual dispatches. The job uses read-only repository
permissions and uploads only this command's logs when a step fails. A failed
step's last 60 lines also become an annotation on the run's summary, which
GitHub shows without signing in, unlike the log and the artifact. Its stable
status name is **Coach checks**, suitable for a required branch protection
check. Enabling that requirement is a repository setting.
