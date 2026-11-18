# Development and repository guide

[简体中文](DEVELOPMENT.md) | **English**

This page describes current code and development commands. Product rules are in [Product specification](PRODUCT-SPEC.en.md); architecture boundaries are in [Architecture](TECHNICAL_DESIGN.en.md). This guide maintains directories, commands, and distribution conventions. Commands run from the repository root unless stated otherwise.

## Directory responsibilities

| Location | Current purpose |
|---|---|
| [plugins/](../plugins/README.en.md) | Notes and task/calendar packages, each with host services, client, build, and tests; notes also has a standalone CLI |
| [launcher/corilo.mjs](../launcher/corilo.mjs), `launcher/test/` | Default dual-plugin planner startup from source and existing single-plugin/v1 compatibility checks |
| [deploy/systemd/](../deploy/systemd/corilo.service.example) | Manual deployment reference, not automatically installed by initialization |
| [scripts/](../scripts/README.en.md) | Design-asset generation and historical development tools; `scripts/corilo.mjs` only forwards to the canonical launcher |
| `docs/`, `docs/history/` | Current design/development documents and separately identified historical records |
| `app/host/`, `app/cloud/`, `app/vendor/` | Retained local Pi/cloud services and pinned vendor code; root npm dependencies serve this application |
| `android/`, `p0/` | Paused projects and historical validation evidence |
| `packages/learn-anything/` | Independent tutor plugin for existing DSH users; root setup/test/build/pack:learn-anything convenience commands |

Instance directories must be outside the repository. Do not commit user notes, SQLite, runtime homes, tokens, model keys, or real test material. Preserve existing legacy-app data without automatic migration.

## Runtime and lockfiles

Current plugins and the source launcher require **Node.js ≥24.9.0**; todos v1/v2 and migration tools use Node's native SQLite. Root `package.json` retains `engines >=22.19.0` for the legacy application; it does not permit starting current plugins with Node 22. Root commands are convenience entries, not a promise of identical runtime requirements.

The repository retains four npm lockfiles:

- `packages/learn-anything/package-lock.json` pins the independent tutor, outside the default two-plugin composition.
- Root `package-lock.json` pins legacy Pi/cloud dependencies and is not used to publish current plugins.
- `plugins/notes/package-lock.json` pins notes runtime/build/test dependencies.
- `plugins/todos/package-lock.json` pins task runtime/build/test dependencies.

Each subproject keeps its independent lock. notes/todos must run outside the repository with production dependencies only, while the tutor installs into existing DSH. Do not introduce npm workspaces or rely on root hoisting. Install, build, and upgrade per package. Do not independently upgrade Harness or guess compatibility from `latest`; Harness is fixed to `0.2.2-rc.3`.

## Current commands

| Purpose | Command | Boundary |
|---|---|---|
| Install and build the workspace | `npm run setup:corilo` | Uses package locks, ignores install scripts, then builds explicitly; does not start services or require root dependencies |
| Initialize a combined instance | `npm run init:corilo -- --directory /absolute/corilo-instance` | Exclusively creates notes + todos planner configuration; no overwrites or migration |
| Read-only preflight | `npm run check:corilo -- --directory /absolute/corilo-instance` | Creates no data, native home, or database; does not replace startup schema checks |
| Start the combined instance | `npm run start:corilo -- --directory /absolute/corilo-instance` | Delegates to native Harness; default loopback port `3000`, optional `--port` |
| Notes service/host/distribution tests | `npm run test:notes` | Package `npm test` builds automatically |
| Tasks service/host/distribution tests | `npm run test:todos` | Package `npm test` builds automatically |
| Source composition startup tests | `npm run test:startup` | Runs `launcher/test/cli.test.mjs`, requiring both packages; checks default planner and legacy configurations |

The combined instance does not take over existing independent plugin instances. Configuration uses absolute entry paths; retain configuration and installed packages before moving a checkout. See the [notes guide](../plugins/notes/QUICKSTART.en.md) and [todos README](../plugins/todos/README.en.md) for switching package paths or rolling back. The launcher accepts the current planner combination and existing single-plugin/v1 dual-plugin configurations; it does not execute arbitrary overlays or automatically migrate them.

## Browser and distribution checks

The default notes browser test is `plugins/notes/test/workspace_browser.py`; the old `core_browser.py` protects only `interface: classic`. For todos planner use `npm --prefix plugins/todos run test:planner:browser`; `test:browser` includes three v1 regression suites and real DSH language-switching checks. The tutor's real DSH boot check is `npm run test:boot:learn-anything`, using a mock model; it does not replace Web UI validation. Validate new pages inside the actual supported Harness release, not only legacy-app browser scripts. Install Python browser dependencies from `requirements-dev.txt` and prepare Playwright Chromium. Exact commands are in [notes](../plugins/notes/README.md), [todos](../plugins/todos/README.en.md), and the corresponding plugin CI. Use isolated homes and synthetic temporary data without live model calls; record actual passes and untested devices.

CI includes notes Files.md/classic/language-switching tests and todos v1/language-switching/planner tests. Tutor CI installs compatible DSH into a temporary directory, runs a mock-model boot check, then uploads the built package. These checks do not validate live models or the tutor's complete Web flow.

Shared-launcher changes require `test:startup`. Plugin changes require relevant Node/host/browser checks. File-interface or UI changes must also protect the legacy app with its three browser suites as required by AGENTS. Ordinary documentation changes need local-link and command-path checks; do not claim checks that were not run.

Both packages support independent `npm pack`; do not publish the whole repository or launcher. From the repository root, after installing/building as above:

```sh
(cd plugins/notes && npm pack --dry-run)
(cd plugins/todos && npm pack --dry-run)
```

`prepack` builds the client. Packages include pinned runtime dependencies, licenses, and guides, not test data, node_modules, or credentials. Package distribution tests cover production installation/startup outside the repository. notes/todos are currently `private`, and no public `npm publish` has been performed; changing private status or publishing is outside repository cleanup. For the tutor, run `npm run build:learn-anything` followed by `npm run pack:learn-anything`; installation is described in the [tutor guide](../packages/learn-anything/README.en.md).

## Independent DSH installation and upgrade rehearsal

With two different builds of the Files.md workspace package, run:

```sh
npm_config_cache=/workspace/work/npm-cache node plugins/notes/test/upgrade.mjs /absolute/previous.tgz /absolute/next.tgz
```

The script first installs only exact DSH 0.2.2-rc.3 with --save-exact in a temporary directory and boots it. It then installs the old package, writes synthetic data through authenticated APIs, stops the service, installs the new package, and restarts. It checks unchanged overlay bytes, retained data, served host.js matching the new installed file with a changed hash, unauthenticated 401 responses, and clean SIGTERM shutdown. It uses DSH's native entry, not the source launcher. Both packages must contain built assets. Different local builds may have the same version for this rehearsal; do not describe that as an upgrade between publicly published npm versions.

The rehearsal uses a disposable instance and cleans up afterward. Output includes only versions, hashes, and check results; it never upgrades a user's live instance. Target DSH paths, overlays, and deployment environments still require separate checks. `workspace_browser.py` continues to validate browser behavior; HTTP asset checks do not establish browser validation of a second instance.

## Retained legacy application commands

These commands maintain the existing application and are not current plugin entry points. Install its dependencies first with root `npm ci --ignore-scripts`.

| Purpose | Command | Boundary |
|---|---|---|
| Legacy local app | `npm start` | `app/host/cli.mjs`; Node ≥22.19.0; no current plugins |
| Legacy Node regression | `npm test` | `app/tests/*.test.mjs`, excluding plugin tests |
| Legacy browser regression | `python3 app/tests/browser_smoke.py`, `python3 app/tests/browser_review.py`, `python3 app/tests/browser_sync.py` | Validates only the legacy app |
| Legacy cloud file service | `npm run start:cloud` | Read [cloud README](../app/cloud/README.md) first; cloud AI submission remains disabled |
| Legacy controller | `npm run start:controller` | Recovers existing tasks only; does not enable new execution |
| Legacy cloud/worker checks | `npm run test:cloud`, `npm run test:worker` | Disposable `CORILO_TEST_DATABASE_URL` only; worker also requires a real image |

Complete old startup, GitHub synchronization, prototype, and export instructions are in the [legacy-app archive](history/LEGACY-APP.md). Historical architecture/database evidence is in the [v0.16 technical archive](history/TECHNICAL-DESIGN-v0.16.md). Do not expand current scope based on historical next steps.

## Version checks and independent release preparation

`npm run check:dsh` checks the three packages' DSH pins, independent locks, registered CLI/test references, and current tutor market entry. The reference is the tutor's `engines.dsh`. Register new fixed source references in the checker; historical documentation and old market versions are excluded from current consistency checks. This command is read-only and does not unify or rewrite independent locks.

`npm run test:tooling` exercises checker and release-preparation failure cases without installing root application dependencies. `repository-checks.yml` runs both commands on relevant changes.

Install the selected package's locked dependencies, then use `npm run prepare:release -- notes`, `todos`, or `learn-anything` to produce its tgz, SHA-256, version metadata, and release notes. Alternatively, run **Prepare independent package** manually, choose one product, and download its artifacts. Neither route publishes to npm, changes package private status, or automatically upgrades instances. See the [distribution guide](RELEASING.en.md) for the full process and verification boundaries.

## UI language regression checks

The notes and todos `test:browser` commands include real DSH Chinese/English switching checks alongside their existing browser suites. Run `python3 packages/learn-anything/test/browser/locale_browser.py` for tutor card language switching, draft preservation, and unchanged answer protocols. It starts and cleans up its fixture server automatically and runs in tutor CI. This uses actual card components with simulated host locale/transport, not full DSH Web end-to-end coverage.
