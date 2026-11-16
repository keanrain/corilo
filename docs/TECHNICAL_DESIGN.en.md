# Corilo technical overview

[简体中文](TECHNICAL_DESIGN.md) | **English**

2026-11-15. This document describes the current code. See the [product specification](PRODUCT-SPEC.en.md) for rules and the [development guide](DEVELOPMENT.en.md) for commands and validation. Original designs remain in the [v0.34 technical proposal (Chinese)](history/v0.34/TECHNICAL_DESIGN.md).

## Runtime and dependency boundaries

All three plugins target DSH 0.2.2-rc.3 and Node.js ≥24.9.0. Each has independent dependency locks and distribution artifacts. Root dependencies serve the legacy app, not a shared plugin runtime. There are no npm workspaces or root dependency hoisting.

`launcher/` composes notes + todos planner for new instances and supports existing configurations; it is not another distribution package. `packages/learn-anything/` supplies a plugin to existing DSH users without initializing a dedicated profile or changing host default presets, logging, or package-inventory settings.

## Notes

Pinned Files.md upstream resources live in `plugins/notes/vendor/filesmd/` and run in a persistent iframe. `workspace-api.mjs` adapts the host and provides authenticated file routes. `workspace-store.mjs` and `storage.mjs` handle files, versions, and write queues. UI and native Agent tools operate on the same disk data.

Handle upstream differences in adapters, without editing vendor code to hide failures or relaxing host-wide CSP. classic remains compatible; its tests do not replace Files.md acceptance.

## Tasks and calendars

`planner: true` selects v2 services and UI; omitting it retains v1. v2 uses native Node SQLite. `schedule-schema.mjs` defines records, receipts, reminders, and notifications. `schedule-service.mjs` and `task-service.mjs` implement transactions, validation, and business operations; `schedule-queries.mjs` handles filtering and pagination.

Records carry versions; mutations use request receipts for duplicate requests and unknown outcomes. Record content is still JSON. Startup does not migrate v1, change an existing database identity, or add new indexes automatically.

The frontend separates lists, calendars, details, reminders, and state management. Calendar views use pinned standard FullCalendar components; Temporal handles date boundaries with exclusive ends. Reminder facts persist in SQLite and are scanned at startup and every 30 seconds. A browser-notification claim ensures an attempt, not receipt.

## Learning tutor

The bundle registers tutor, examiner, and checker presets, with teaching tools mounted within presets. The host UI entry remains an anchor for Web client discovery; generated client assets ship with the package. Learning records live under the session workspace's `.learn/`. A new empty learner workspace creates `learner.sqlite` on its first learner-record write, using built-in `node:sqlite` without a native compilation dependency. The database stores courses, knowledge points and target maps, verifications, diagnoses, review schedules and reminder bindings. Original materials, parsed blocks and citation metadata remain files under `materials/`. Formal verification requires actual answers and examiner evidence.

In SQLite mode, one learner mutation commits verification records, mastery and review scheduling together, or rolls them back together. Tools and UI share the workspace write boundary. Changes are staged during asynchronous grading; commit checks the database revision, and a conflict rejects the write without automatically replaying examiner requests. DSH reminder tasks are external host state scheduled after the learner transaction commits. They are not part of a distributed transaction; reminder failure does not roll back committed grades.

Existing JSON/JSONL learner records retain the legacy backend until explicit migration. Preserved source files are not dual-written or synchronized automatically. `.learn/.backend.json` durably records the selected backend and database instance. Startup only opens recognized databases; missing, mismatched, corrupt or incompatible databases fail closed without reopening stale records or upgrading their schema. Interrupted first-initialization `.initialization.json` and migration `.migration.lock` markers require explicit recovery, with stopped-process, file-identity and snapshot-digest checks: a pending first database can be published, while a pending legacy import is aborted with staged artifacts preserved. Runtime commits use WAL and validate the main database and sidecars; stop related services before backup, export and restore. The storage API still loads a consistent learner snapshot into memory; business-history scans are not indexed SQL reads, and FTS5 retrieval is not implemented. See the [tutor guide](../packages/learn-anything/README.en.md) for migration, export and recovery.

## Storage and compatibility

Markdown files, the todos database, DSH sessions, and learning records have separate data boundaries. Existing notes/state backup tools do not back up a complete three-plugin instance. Do not copy only the main file of a running SQLite database and omit its WAL; recovery procedures require separate validation.

Preserve legacy `app/`, `android/`, `p0/`, and existing data in place; the Python prototype was removed. New features use public DSH extension points rather than a second model manager, authentication system, or Agent loop. Recurrence, external notifications, cross-plugin source links, and old-database upgrades remain unimplemented.
