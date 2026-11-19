# Corilo product specification

[简体中文](PRODUCT-SPEC.md) | **English**

## Current delivery scope

Ordinary content edits must preserve reminders that are already due but not yet processed. Cancellation, completion, and explicit reminder-time changes may invalidate them. Time blocks spanning days appear in every overlapping Today/Future date range, using half-open intervals. Calendar task selection must support loading more than 100 records.

The todos planner provides task dates, deadlines, priorities, lists and states; six task views with pagination; overdue/today/previously-planned groups; FullCalendar month/week/day/agenda views with forms and drag-based scheduling; independent/all-day events and task time blocks; persistent in-app reminders and explicitly authorized browser notifications. Reopening tasks schedules future reminders again. Reminders more than 24 hours overdue remain in the in-app history without a burst of browser notifications. Claiming a browser notification means one delivery attempt, with no retry after a crash and no delivery when the page is closed.

New instances default to notes + todos planner. Existing single-plugin and v1 dual-plugin configurations retain their format. Planner uses a v2 database in a new directory and rejects v1 databases. Upgrade tooling, recurrence, CalDAV/ICS, note-source links, email, and other external notifications are not implemented.

## Data and interaction constraints

Disk files are authoritative for notes and attachments; todos SQLite is authoritative for tasks and calendars. Markdown checklists are not copied automatically into tasks, and Agent execution plans are not personal todos. Ordinary editing and scheduling do not require a model.

The notes panel is for reading and editing notes: retain Files.md file trees, editing, search, renaming, moving, archiving, random opening, split panes, links, journals, and checklists. There is no capture page and no Agent button inside the workspace (Agent is reached from the host sidebar). Existing files such as `Chat.md` stay on disk untouched; the roles of `Later.md`, `journal/`, `media/`, and `config.json` are preserved; classic mode remains compatible.

Existing file limits remain: 1 MiB for text/settings, 16 MiB per attachment, 64 MiB cumulative reads per directory, and scans bounded by 20,000 entries, 20 levels, and 10 seconds. Reject traversal, hidden paths, symbolic/hard links, and special files. Updates check the SHA-256 of the content actually read. Moves/deletes check versions and never overwrite an existing destination. Do not integrate Go sync, Telegram, or automatic external media requests, or relax host-wide CSP.

Saving acknowledges only the submitted snapshot. Pause submission during IME composition. New input during a save blocks navigation that depends on saving. Preserve input after conflicts or unknown results; reconcile uncertain writes through reads without automatic overwrite or resubmission. Preserve iframe/editor state when switching to Agent or other panels. Warn when leaving unsaved input; crash recovery of drafts is not promised.

Tasks contain a title, details, status, optional planned date, deadline, priority, and list. Titles have 1–200 characters, details up to 20,000, and list names up to 100. States are open/done/cancelled; priorities are normal/high/urgent. Completion and cancellation are distinct, and reopening is explicit. A planned date does not create a deadline or reminder. Date deadlines become overdue at the start of the following day in their time zone; instant deadlines use the specified instant. Tasks without deadlines are not overdue. Time blocks reference tasks; independent events need not. Both timed and all-day event ends are exclusive.

Timed boundaries use explicit UTC/offset instants and an IANA time zone; the end must be later than the start. Do not guess nonexistent or ambiguous local times: require an explicit offset.

Agents only write tasks/events on explicit user requests and read versions before writing. Clarify missing dates, durations, or time zones. Final tool arguments must use explicit dates/instants and IANA zones, not unresolved natural-language guesses. Check receipts after unknown outcomes and do not claim success prematurely.

Reminder facts are persistent and scanned at startup and every 30 seconds. Reminders over 24 hours overdue remain in-app without mass browser delivery. Notifications require permission; claiming is an attempt, not guaranteed delivery or external push.

Mutations use version checks and request receipts: replaying the same requestId cannot duplicate a write; the same ID with a different payload is rejected. Reconcile unknown outcomes through reads first.

Planner uses v2 and rejects v1 databases. Existing configurations and data are not migrated or cleaned up automatically. Backups must explicitly include notes, todos, and any DSH/tutor data to retain; do not describe a notes backup as a whole-instance backup.

## Learning tutor boundaries

The tutor is independently distributed for existing DSH users only. Users select their workspace and teaching preset. It does not change host default presets or logging settings, or join the default notes + todos composition.

Learning records live in the session workspace's `.learn/`. Formal scores require actual questions, learner answers, and examiner evidence; tutor self-reporting cannot raise mastery. See the [tutor guide](../packages/learn-anything/README.en.md) for detailed rules and interactions.

## Specification and history

This document maintains current scope and key constraints. Configuration and interfaces are documented in the [notes guide](../plugins/notes/README.md), [todos guide](../plugins/todos/README.en.md), and [technical overview](TECHNICAL_DESIGN.en.md). Actual validation evidence is in the [handoff log (Chinese)](HANDOFF.md).

The complete v0.34 rules and phased acceptance tables remain in the [historical specification (Chinese)](history/v0.34/PRODUCT-SPEC.md). Recurrence, source links, upgrades, and external notifications described there are unimplemented plans, not current promises. Expanding scope requires renewed requirements and acceptance criteria.
