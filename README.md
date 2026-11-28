# Corilo 可里

**English** | [简体中文](README.zh-CN.md)

> Runtime: notes, todos, and the independent learning tutor are pinned to DSH **0.2.2-rc.5**. Install from each package's lockfile rather than relying on npm tags.

## Independent products in one repository

| Directory | Product | Development commands |
|---|---|---|
| `plugins/notes` | Notes workspace — `@corilo/dsh-notes` | `npm run test:notes` |
| `plugins/todos` | Tasks and calendar — `@corilo/dsh-todos` | `npm run test:todos` |
| [`packages/learn-anything`](packages/learn-anything/README.en.md) | Independent learning tutor — `@corilo/learn-anything` | `npm run setup:learn-anything`, `npm run test:learn-anything` |

Each package has its own lockfile, installation, and distribution. The learning tutor is a plugin for existing DSH users: build it with `npm run build:learn-anything` and package it with `npm run pack:learn-anything`. It is not enabled in the default notes + todos setup. `app/` and `p0/` retain legacy implementations and research (the Android project was removed on 2026-11-27; mobile currently means the DSH web page in a phone browser); root `npm start/test` commands still serve the legacy application.

New instances created from this checkout enable notes + todos planner v2. Existing single-plugin and older dual-plugin configurations keep their original behavior; databases are not migrated automatically.

Notes uses the Files.md workspace, with its file tree, Markdown, checklists, journals, attachments, and split editing. The task plugin provides task dates, lists, priorities, calendars, time blocks, persistent reminders, and browser notifications with explicit permission. Ordinary UI operations do not require a model; Harness manages models, sessions, authentication, and permissions.

Corilo-owned UI follows the DSH language setting and supports Chinese and English. Switching languages does not change notes, task content, or tutor answers. Upstream Files.md UI and tutor teaching materials retain their original content.

## Start in three steps

Requires Node.js ≥24.9.0. Run from the repository root and use an absolute instance path outside the checkout:

```sh
npm run setup:corilo
npm run init:corilo -- --directory /absolute/corilo-instance
npm run start:corilo -- --directory /absolute/corilo-instance
```

`setup` installs and builds notes and todos. `init` creates configuration without overwriting or migrating an existing instance; subsequent launches only need `start`. Open the authenticated URL printed by Harness, dismiss the model setup prompt, and use the notes and task/calendar entries in the sidebar. The default address is loopback on port 3000; stop with Ctrl+C. Run the preflight check with `npm run check:corilo -- --directory /absolute/corilo-instance`.

## Existing instances and tasks

Todo configurations that omit `planner` keep v1 mode. Planner v2 requires a new, empty data directory. To export old tasks to Markdown checklists, stop the services and back up their data, then follow the preview and explicit import steps in the package guide. The original SQLite database is preserved, and Markdown checklists remain separate. [Todos guide](plugins/todos/README.en.md) · [Export steps](plugins/notes/README.md#existing-installations-and-sqlite-todos)

## Distribution and limits

All three plugins have separate local build commands and GitHub prereleases. See the [release guide](docs/RELEASING.en.md) and [GitHub Releases](https://github.com/keanrain/corilo/releases) for versions, checksums, and installation.

Reminders persist, and closing the page ends browser delivery. Recurrence, CalDAV/ICS, external notifications, and automatic memory are outside the current implementation. See the [product overview](docs/PRODUCT.en.md) and [handoff](docs/HANDOFF.md) for deployment and test evidence.

Further documentation: [Documentation index](docs/README.en.md) · [Product rules](docs/PRODUCT-SPEC.en.md) · [Architecture](docs/TECHNICAL_DESIGN.en.md) · [Development guide](docs/DEVELOPMENT.en.md) · [Plugin index](plugins/README.en.md).
