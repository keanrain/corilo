# Corilo 可里

**English** | [简体中文](README.zh-CN.md)

> Runtime: notes, todos, and the independent learning tutor are pinned to DSH **0.2.2-rc.3**. Install from each package's lockfile rather than relying on npm tags. The Python prototype, its launcher, and its dedicated CI have been removed; local data is preserved.

## Independent products in one repository

| Directory | Product | Development commands |
|---|---|---|
| `plugins/notes` | Notes workspace — `@corilo/dsh-notes` | `npm run test:notes` |
| `plugins/todos` | Tasks and calendar — `@corilo/dsh-todos` | `npm run test:todos` |
| [`packages/learn-anything`](packages/learn-anything/README.en.md) | Independent learning tutor — `@corilo/learn-anything` | `npm run setup:learn-anything`, `npm run test:learn-anything` |

Each package has its own lockfile, installation, and distribution. The learning tutor is a plugin for existing DSH users: build it with `npm run build:learn-anything` and package it with `npm run pack:learn-anything`. It is not enabled in the default notes + todos setup. `app/`, `android/`, and `p0/` retain legacy implementations and research; root `npm start/test` commands still serve the legacy application.

Current versions are **notes 0.7.0 and todos 0.6.2**. New instances created from this checkout enable notes + todos planner v2. Existing single-plugin and older dual-plugin configurations keep their original behavior; databases are not migrated automatically.

Notes uses the Files.md workspace, with its file tree, Markdown, checklists, capture, journals, attachments, and split editing. The task plugin provides task dates, lists, priorities, calendars, time blocks, persistent reminders, and browser notifications with explicit permission. Ordinary UI operations do not require a model; Harness manages models, sessions, authentication, and permissions.

Corilo-owned UI follows the DSH language setting and supports Chinese and English. Switching languages does not change notes, task content, or tutor answers. Upstream Files.md UI and tutor teaching materials retain their original content.

## Start in three steps

Requires Node.js ≥24.9.0. Run from the repository root and use an absolute instance path outside the checkout:

```sh
npm run setup:corilo
npm run init:corilo -- --directory /absolute/corilo-instance
npm run start:corilo -- --directory /absolute/corilo-instance
```

`setup` installs and builds notes and todos. `init` creates configuration without overwriting or migrating an existing instance; subsequent launches only need `start`. Open the authenticated URL printed by Harness, dismiss the model setup prompt, and use the notes and task/calendar entries in the sidebar. The default address is loopback on port 3000; stop with Ctrl+C. Run the preflight check with `npm run check:corilo -- --directory /absolute/corilo-instance`.

The interface retains the native Files.md file tree, creation, search, inline title renaming, moving/archiving, split editing, capture, journals, and Markdown checklists. The Agent button saves current input before switching to a Harness conversation; returning preserves the editor. Files live on the host, and other computers or phones connect through a browser without selecting a local folder on each device.

## Existing instances and tasks

Existing single-plugin and dual-plugin configurations remain supported. In todos 0.6.2, omitting `planner` retains v1 mode. Enabling planner requires a new, empty data directory; it cannot open a v1 database. Files.md still supports Markdown checklists. The following is an optional one-way export, not the default upgrade or retirement path:

```sh
# Stop both source and destination services and back up first; preview by default.
node plugins/notes/import-todos.mjs --source /absolute/old/todos/todos.sqlite --root /absolute/corilo-instance/notes
# Apply after reviewing the preview.
node plugins/notes/import-todos.mjs --source /absolute/old/todos/todos.sqlite --root /absolute/corilo-instance/notes --apply
```

Import preserves the source SQLite database. Completed and open tasks become checklist items; cancelled records and original fields are retained in migration records under `archive/`. Retrying does not append duplicates. Only consider removing the old task entry after explicitly choosing Markdown to manage those tasks going forward. Users keeping independent task management should retain their SQLite database and plugin. Markdown checklists and the database do not synchronize automatically. See the [full guide](plugins/notes/README.md).

## Distribution and limits

notes and todos can each be packaged with `npm pack` from their own directories, without the legacy `app/`. Recipients install production dependencies and configuration according to the package guides. Both packages remain private and have not been publicly published to npm. See the [quick start](plugins/notes/QUICKSTART.en.md).

For full release preparation, use `npm run prepare:release -- notes`, `todos`, or `learn-anything`. First install dependencies from the selected package's lockfile, then run the command to build, test, and check a tarball, with checksums and release notes. This process does not publish to npm. See the [distribution guide](docs/RELEASING.en.md).

Files.md is pinned to the version recorded in source, and Harness to `0.2.2-rc.3`. Existing Harness/Chromium and migration checks do not establish validation of live DeepSeek calls, physical phones, native input methods/WebKit, microphones, the target Linux deployment, or NAS hardware. todos persists reminders, but closing the page disables browser delivery. Recurrence, CalDAV/ICS, external notifications, and automatic memory are not implemented. Use a NAS as a backup destination first; unverified SMB/NFS mounts are not supported working directories.

The directory layout remains: `plugins/notes` for the current workspace package, `plugins/todos` for tasks and calendar, `launcher/` for the source launcher, and `docs/` for current documentation and archives. Legacy `app/`, Android code, and user data are preserved; root `npm start/test` still runs the legacy application.

Further documentation: [Documentation index](docs/README.en.md) · [Product rules](docs/PRODUCT-SPEC.en.md) · [Architecture](docs/TECHNICAL_DESIGN.en.md) · [Development guide](docs/DEVELOPMENT.en.md) · [Plugin index](plugins/README.en.md).
