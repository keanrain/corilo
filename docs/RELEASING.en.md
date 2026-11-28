# Independent package distribution and release preparation

[简体中文](RELEASING.md) | **English**

The three products have independent versions, lockfiles, and packages. The root package and launcher are not release packages. Preparation does not run `npm publish`, change private status, bump versions, or migrate instances.

| Product selector | Package directory | Current version | Current channel |
|---|---|---|---|
| `notes` | `plugins/notes` | 0.10.2 | GitHub prerelease and local archives |
| `todos` | `plugins/todos` | 0.8.2 | GitHub prerelease and local archives |
| `learn-anything` | `packages/learn-anything` | 0.1.2 | GitHub prerelease and local archives for existing DSH users |

[Download published archives](https://github.com/keanrain/corilo/releases).

## Prepare one product

Use Node.js ≥24.9.0. From the repository root, first install dependencies using the selected package's independent lockfile, then prepare it. For example:

```sh
npm --prefix plugins/todos ci --ignore-scripts
npm run prepare:release -- todos
```

For notes, use `npm --prefix plugins/notes ci --ignore-scripts`; for the tutor, use `npm run setup:learn-anything`. The script does not install dependencies automatically. Full notes backup testing requires restic; if absent, a package test may report a skip, which must not be reported as successful backup validation.

The default output is `dist/releases/<product>/<version>/`. An existing directory is never overwritten. You can specify a new output directory:

```sh
npm run prepare:release -- learn-anything --output /absolute/new-release-directory
```

The script validates package/lock names and versions, the current CHANGELOG section, and an exact compatible DSH version. It builds and runs the selected package's Node tests, then creates that package with `npm pack`. Packaging disables lifecycle scripts because the build was already explicit. The script verifies package identity, public entry files, and inventory exclusions for tests, node_modules, runtime data, and common credential filenames. This is not a general secret-content scanner.

Output contains the `.tgz`, `SHA256SUMS`, `release.json`, and the version's `RELEASE_NOTES.md`. Metadata records package version, DSH/Node requirements, file count, checksum, and checks actually performed; it is never marked as published. Failure does not retain an unverified output package, and existing artifacts remain untouched.

## Maintain each version

1. Change only the target package's version and use npm to update its own lockfile. The three products need not release in lockstep.
2. Add `## <exact-version>` to that package's `CHANGELOG.md`, recording actual changes and data/compatibility boundaries. Use a new version when already-distributed content changes; avoid different packages with the same version.
3. DSH upgrades must also satisfy the repository version-consistency check. Do not infer compatibility from npm's latest tag.
4. Run preparation, plus real-host, browser, and upgrade/recovery checks appropriate to the change. The preparation script's Node tests do not replace these checks.
5. Provide recipients with the tarball, checksum, and release notes. Retain the previous artifact for rollback. Before instance upgrades, save input, stop services, and back up relevant data.

Tutor releases also require corresponding version, compatibility, and publication-time updates in `market/index.json`. If the index points to npm, the matching package must actually be published first. The current local tgz installs into existing DSH; the presence of a market index does not establish market installability. Any future public npm release requires a separate decision about permissions and channels; this workflow does not perform it.

For installation and data boundaries, see [notes](../plugins/notes/README.md), [todos](../plugins/todos/README.en.md), and [the tutor](../packages/learn-anything/README.en.md). For current CI and runtime limits, see the [development guide](DEVELOPMENT.en.md).

## GitHub Releases

After publication is authorized, push a `packages-YYYYMMDD` tag pointing to a commit already merged into main. A numeric suffix such as `.1` supports another release on the same day. This triggers `Publish package prerelease`; ordinary branch pushes and PRs do not publish.

The workflow installs each independent lockfile, rebuilds, tests, and validates all three packages. Notes must pass a real restic recovery drill. Only after all products succeed does it assemble assets, create a draft Release, and upload three `.tgz` files, per-product change logs, installation instructions, SHA256 checksums, and a source/package manifest. It downloads and verifies every asset before publishing as a prerelease, without setting latest, publishing to npm, or migrating user instances.

Only the publishing job has `contents: write`; builds are read-only. An existing release is never overwritten. If failure leaves a draft, inspect the cause rather than automatically deleting or replacing assets. Preparation metadata's `published: false` describes the preparation step; the public manifest separately records `github-prerelease` and `npmPublished: false`.
