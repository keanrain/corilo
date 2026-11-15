# Corilo personal tasks for DeepSeek Harness

[简体中文](README.md) | **English**

Corilo-owned UI follows the DSH language setting (Chinese/English) without changing user content or drafts.

## 0.6.1 fixes and cleanup

Ordinary edits no longer lose reminders that are already due but not yet scanned: the pending job is retained, with its version and snapshot updated in the transaction. Completing/cancelling a task or changing its reminder time still explicitly invalidates old jobs. Time blocks spanning multiple days enter Today/Future by overlap with the local date range. All-day and timed ends are exclusive, and Temporal handles daylight-saving transitions.

Calendar task selection supports additional pages and polling retains expanded pages. The UI is split into task list, calendar, details, reminders, requests, and editor-state modules. Queries preserve the v2 schema and existing data: ordinary lists filter, count, and use keyset pagination in SQL; date views read necessary metadata, group events once, and fetch only the current page's bodies; calendar queries limit results by range in SQL. SQLite still stores JSON records; no indexes are automatically added, data migrated, or database identity changed.

`node test/query_benchmark.mjs` runs a disposable benchmark with 10,000 tasks and 500 time blocks; results describe that execution environment only. Regression tests are in `test/planner-quality.test.mjs`; real browser coverage includes scheduling tasks beyond the first 100.

## 0.6.0 reconstruction

This version was rebuilt from the user's feature description, not recovered from the original 36ea6e9 code. Planner provides task dates, lists, priorities, six task views and Today groups; FullCalendar month/week/day/agenda views; independent events and task time blocks; persistent reminders and opt-in browser notifications.

To enable it in an independent DSH overlay, set `planner: true` and use a **new, empty root directory**. Omitting planner retains the original v1 tasks and page. Do not enable planner on the old database; there is no automatic migration. From source, `npm run setup:corilo` and `npm run init:corilo -- --directory /absolute/new-instance` create a dual-plugin instance.

A date deadline is `{kind:"date",date:"2026-11-20",timeZone:"Asia/Taipei"}`; an exact deadline is `{kind:"instant",at:"2026-11-20T09:00:00+08:00",timeZone:"Asia/Taipei"}`. All-day ends are exclusive. Exact-time form fields accept ISO timestamps with offsets. Reminders take a separate exact instant; null disables them. A valid start-time change preserves duration; 30/60-minute buttons set it directly. Dragging/resizing first restores the calendar position and opens an unsaved form; confirmation commits it. Unknown results are checked read-only through receipts, with the original request retryable if no receipt is found.

Reminder facts persist in SQLite. The service catches up at startup and every 30 seconds. Browser notifications require permission; atomic claiming prevents duplicate attempts across tabs but records only an attempt, and a crashed tab does not trigger retransmission. In-app records remain. More than 100 items are processed in batches. Closing the page disables browser delivery. Cancelling/completing a task disables reminders for future time blocks; reopening recreates reminders still in the future.

`npm test` checks old/new storage and tools; `npm run test:planner:browser` checks the new real Harness page; `npm run test:browser` protects the legacy page. Recurrence, note-source associations, CalDAV/ICS, old-database upgrades, and external notifications are not implemented.

## v1 compatibility mode

The page, storage, and tool descriptions below apply only to **existing instances that omit `planner`**, retaining the original 0.5.2 mode. New instances default to planner v2 above. Install and distribute the current 0.6.1 package; it does not upgrade old databases automatically. The handwritten overlay below deliberately omits `planner` to continue running v1.

This independent personal-task plugin supports pinned Harness **0.2.2-rc.3** and Node.js **>=24.9.0**. It uses Node's built-in `node:sqlite`, with no separate database service, ORM, or second Agent loop. Node's SQLite API still emits an experimental notice; keep the tested runtime compatible. Package version 0.6.1 has not been published to npm.

The page creates, reads, edits, completes, and reopens tasks without a model key. Agent tools share the same persistence service. Personal tasks are separate from Harness Agent execution plans. v1 has no dates, calendar, reminder scheduling, or notifications; creating a task does not schedule a notification.

The main v1 flow is repeated Enter-to-add, direct completion/reopening in the list, and editing by clicking a title. Stored details save on leaving the editor, switching tasks, or returning to the list; the first click saves changes before continuing the requested operation. New tasks primarily use inline title entry, without a duplicate detailed creation form.

The list/details split draws on [Vikunja](https://github.com/go-vikunja/vikunja) and [Super Productivity](https://github.com/super-productivity/super-productivity): titles wrap, descriptions grow to fit, and export uses a lightweight header button. Adding from the completed list returns to open tasks; successful creation clears search so the new item is visible. When the list has focus, N opens quick entry, / searches, arrow keys move task focus, and Enter opens a task. Esc in details saves and returns. Typing and IME composition do not navigate; errors and unknown results retain the original request.

Icons use **Lucide React 1.70.0** and text fields use **react-textarea-autosize 8.5.9**. Both are build dependencies bundled into the client, using the host's React. A peer override fixes React to the host-compatible 18.3.1; React itself is always external. Independent production installs do not need build dependencies. Licenses are included.

The visual layer uses 62 static tokens from [Astryx Neutral](https://github.com/meta/astryx) 0.7.11, locally adapting native controls. Light/dark colors and fonts inherit Harness; buttons, focus, lists, and feedback share the same treatment. Each token subset is about 3.6 KB, without a global reset or network fonts. Tested Harness React is 18.3.1, while Astryx React components require >=19, so this package **does not use Astryx React components** or bundle another React. MIT notices and source hashes are recorded; existing behavior and save protection remain.

## Installation and startup

To use both plugins from source, prefer the [root quick start](../../README.md#start-in-three-steps): setup/init/start with one instance directory. The independent-plugin route remains below.

From the Corilo repository root:

```sh
npm --prefix plugins/todos ci --ignore-scripts
npm --prefix plugins/todos run build
```

Create a local overlay from `todos.patch.example.yml`, replacing entry and data locations with absolute paths. SQLite needs a dedicated directory, such as `/absolute/corilo-instance/todos`; do not put it in Markdown, note-history, or Harness credentials/session directories. `notesRoot` can identify an existing knowledge library to reject nested database/library directories; it does not grant additional file access.

```sh
cd plugins/todos
./node_modules/.bin/dsh web --patch /absolute/todos.patch.yml --no-open --port 3000
```

Use the authenticated URL printed by Harness and never share its token. Dismiss model-key setup to use the task sidebar entry directly. Harness still provides model settings and default tool permissions; root is not a sandbox for the default bash or file tools.

To combine it with notes, insert both packages' absolute entry paths into the Harness overlay:

```yaml
- insert:
    - id: corilo-notes
      name: /absolute/corilo-install/node_modules/@corilo/dsh-notes/index.mjs
      config:
        root: /absolute/corilo-instance/notes
    - id: corilo-todos
      name: /absolute/corilo-install/node_modules/@corilo/dsh-todos/index.mjs
      config:
        root: /absolute/corilo-instance/todos
        notesRoot: /absolute/corilo-instance/notes
```

Load this combination with the pinned Harness native launcher. The source launcher `launcher/corilo.mjs` generates the combination already; `scripts/corilo.mjs` remains a compatibility forwarder, so manual configuration is unnecessary. The notes package's `corilo-notes` CLI accepts only a single-notes overlay, not a multi-plugin composition. The old Linux user-service example's notes-only command does not automatically load tasks. Do not silently replace a running instance's configuration. For a persistent service, keep `DSH_HOME`, `DSH_AGENTS_HOME`, working directory, and port stable; see the notes Linux guide.

## Page behavior and reliability

- Enter only a title in the list and press Enter repeatedly to add tasks. Success clears the input and retains focus. Direct completion/reopening does not overwrite another task's unsaved input.
- Open, completed, all, and search are directly available, with 100 items per page and more-page loading. Search covers title/body, matches Chinese literally, and ignores ASCII English case.
- Click a title to edit in a desktop side panel or a separate mobile view. Details contain title and body. Leaving, switching tasks, or returning to the list first saves changes and proceeds only on success; blur does not consume the first click. Ctrl/⌘S saves immediately; Esc saves and returns; IME composition does not submit.
- Failure/conflict retains input; unknown results retain the same UUID request and resend only on an explicit retry. Edits, completion, and reopening check the version actually read. After a detail-toggle conflict, users can view and explicitly adopt the latest record before proceeding; stale versions are not retried automatically. SQLite commits changes and idempotency receipts together, so retries after lost responses do not duplicate creation. Old pages pause writes if the library identity changes.
- There is no draft library, restore/discard mode, manual mode, note association, or cancellation UI, and no access to task IndexedDB. Input lives only in the current plugin session. Leaving with unsaved/unknown requests warns, but refresh/crash recovery is not promised.
- Old SQLite and browser drafts are neither migrated nor deleted. Old cancelled records are excluded from current lists, and associations are not shown in current details/tools; full JSON export still preserves them.

## Storage and taking data with you

The dedicated directory contains `todos.sqlite`, potentially accompanied by `-wal` and `-shm` while running. SQLite WAL, FULL synchronization, and transactions provide local persistence/concurrency, with up to two seconds waiting for a write lock. Use a local filesystem on the same host; unverified network shares are not supported working databases. Unknown schemas, unsafe links, special files, and unrelated directory contents are rejected. Existing databases are not automatically migrated or overwritten.

Current records use `id`, `title`, `body`, `status`, `version`, `createdAt`, and `updatedAt`; status is open/done. Trimmed titles contain 1–200 characters, bodies at most 20000. The raw v1 format retains old `notePath` and cancelled compatibility, but current plugin operations do not expose them. `./store` is the raw-format compatibility interface; page and Agent tools share current business rules in `core.mjs`. Request receipts persist with the database; there is no automatic cleanup or disk quota yet.

Page export first saves current detail edits. A failed save, conflict, unknown result, or ongoing composition prevents download. Unsubmitted quick entry is not created automatically.

The page and `corilo_todos_export` export public `corilo-todos-v1` JSON containing all business statuses, limited to 10000 records/8 MiB. Exceeding the limit fails rather than claiming a partial export is complete. JSON excludes credentials, Harness sessions, and idempotency receipts. There is no JSON import in this version, and JSON export is not equivalent database disaster recovery.

For backup, stop all Harness instances and external writers using the directory, back up the **entire task data directory** with restic, restore to a new empty directory, verify, and reopen with a matching version. Do not copy only the live main database and omit WAL. Existing notes backup selects only notes/state and **does not automatically include tasks**. Notes `restore.mjs` accepts only notes/state and cannot restore a three-directory combination. Task storage is an additional backup boundary; NAS and consistent full-instance recovery require separate validation.

## Agent tools

| Tool | Purpose |
|---|---|
| `corilo_todos_list` | Filter, literally search, and page through personal tasks |
| `corilo_todos_read` | Read content and the current version |
| `corilo_todos_create` | Create a task with a request UUID |
| `corilo_todos_update` | Edit, complete, or reopen after a version check |
| `corilo_todos_export` | Export versioned JSON |

Agent conversation tools involve model turns; direct page operations do not. Use these tools only when the user explicitly asks to record/change personal tasks, not to turn ordinary discussion or Agent execution steps automatically into tasks.

## Independent distribution and validation

```sh
cd plugins/todos
npm pack --pack-destination /absolute/existing/output-directory
```

Recipients run `npm init -y` in their installation directory, then `npm install --ignore-scripts /absolute/corilo-dsh-todos-0.6.1.tgz`. Configure from the example and launch using that directory's `./node_modules/.bin/dsh`. The first installation still downloads pinned production dependencies; retain its lockfile. A packaged installation needs neither source nor esbuild.

Source validation:

```sh
npm run test:todos
npm --prefix plugins/todos run test:browser
```

Style coexistence checks also need `plugins/notes` installed and built. Browser dependencies use root `requirements-dev.txt` and Chromium. Tests use temporary data and synthetic credentials, never models. Evidence for live models, physical phones, NAS, and target-device deployment is tracked separately in the main technical documentation; tool/Chromium tests do not substitute for it.

## Updating the package in v1 mode

Save current input, stop the service, and back up the entire task directory before upgrading. Install package 0.6.1, retain the v1 configuration that omits `planner`, reuse the existing data directory, and restart Harness; reload the browser client. No database migration or cleanup occurs. Old browser drafts are readable only by the old version; recovery is not promised by the new version. Do not clear site data and then expect to find old drafts. Cancelled records and associations remain in JSON exports.
