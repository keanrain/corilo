# Corilo product specification

[简体中文](PRODUCT-SPEC.md) | **English**

## Current delivery scope

Ordinary content edits must preserve reminders that are already due but not yet processed. Cancellation, completion, and explicit reminder-time changes may invalidate them. Time blocks spanning days appear in every overlapping Today/Future date range, using half-open intervals. Calendar task selection must support loading more than 100 records.

The todos planner provides task dates, deadlines, priorities, lists and states; six task views with pagination; overdue/today/previously-planned groups; FullCalendar month/week/day/agenda views with forms and drag-based scheduling; independent/all-day events and task time blocks; persistent in-app reminders and explicitly authorized browser notifications. Reopening tasks schedules future reminders again. Reminders more than 24 hours overdue remain in the in-app history without a burst of browser notifications. Claiming a browser notification means one delivery attempt, with no retry after a crash and no delivery when the page is closed.

New instances default to notes + todos planner. Existing single-plugin and v1 dual-plugin configurations retain their format. Planner uses a v2 database in a new directory and rejects v1 databases. Upgrade tooling, recurrence, CalDAV/ICS, note-source links, email, and other external notifications are not implemented.

## Data and interaction constraints

Disk files are authoritative for notes and attachments; todos SQLite is authoritative for tasks and calendars. Markdown checklists are not copied automatically into tasks, and Agent execution plans are not personal todos. Ordinary editing and scheduling do not require a model.

The notes panel is for reading and editing notes: retain Files.md file trees, editing, search, renaming, moving, archiving, random opening, split panes, links, journals, and checklists. There is no capture page (the inbox is fed through conversation; see the 2026-11-27 direction below) and no Agent button inside the workspace (Agent is reached from the host sidebar). Existing files such as `Chat.md` stay on disk untouched; the roles of `Later.md`, `journal/`, `media/`, and `config.json` are preserved; classic mode remains compatible.

Existing file limits remain: 1 MiB for text/settings, 16 MiB per attachment, 64 MiB cumulative reads per directory, and scans bounded by 20,000 entries, 20 levels, and 10 seconds. Reject traversal, hidden paths, symbolic/hard links, and special files. Updates check the SHA-256 of the content actually read. Moves/deletes check versions and never overwrite an existing destination. Do not integrate Go sync, Telegram, or automatic external media requests, or relax host-wide CSP.

Saving acknowledges only the submitted snapshot. Pause submission during IME composition. New input during a save blocks navigation that depends on saving. Preserve input after conflicts or unknown results; reconcile uncertain writes through reads without automatic overwrite or resubmission. Preserve iframe/editor state when switching to Agent or other panels. Warn when leaving unsaved input; crash recovery of drafts is not promised.

Tasks contain a title, details, status, optional planned date, deadline, priority, and list. Titles have 1–200 characters, details up to 20,000, and list names up to 100. States are open/done/cancelled; priorities are normal/high/urgent. Completion and cancellation are distinct, and reopening is explicit. A planned date does not create a deadline or reminder. Date deadlines become overdue at the start of the following day in their time zone; instant deadlines use the specified instant. Tasks without deadlines are not overdue. Time blocks reference tasks; independent events need not. Both timed and all-day event ends are exclusive.

Timed boundaries use explicit UTC/offset instants and an IANA time zone; the end must be later than the start. Do not guess nonexistent or ambiguous local times: require an explicit offset.

Agents only write tasks/events on explicit user requests and read versions before writing. Clarify missing dates, durations, or time zones. Final tool arguments must use explicit dates/instants and IANA zones, not unresolved natural-language guesses. Check receipts after unknown outcomes and do not claim success prematurely.

Reminder facts are persistent and scanned at startup and every 30 seconds. Reminders over 24 hours overdue remain in-app without mass browser delivery. Notifications require permission; claiming is an attempt, not guaranteed delivery or external push.

Mutations use version checks and request receipts: replaying the same requestId cannot duplicate a write; the same ID with a different payload is rejected. Reconcile unknown outcomes through reads first.

Planner uses v2 and rejects v1 databases. Existing configurations and data are not migrated or cleaned up automatically. Backups must explicitly include notes, todos, and any DSH/tutor data to retain; do not describe a notes backup as a whole-instance backup.

## Product direction (2026-11-27)

The root need is an "external brain" that remembers the user continuously: the user only talks and drops things in; it remembers, organises, and reminds.

Three principles:
1. One entry: the user talks to the Agent; the notes and planner pages are the manual mode for viewing and small edits.
2. Memory lives in files: the notes root is the single personal space and source of truth; conversations are disposable; important conclusions are written to files the same day.
3. Restraint: the Agent reaches out only at the morning brief, the evening review, and due reminders; changes to notes the user wrote need explicit approval.

One rhythm: each morning a scheduled DSH task opens a new main conversation with the brief (today's events, tasks, overdue items, inbox count); each evening a review (done/not done, rescheduling, sorting the inbox into `wiki/` or the journal, one line on what was learned) archives the day into files. The main conversation stays light: heavy work goes to subagents that return short cards, which avoids context rot (inspired by dsh-superagent-prototype, which keeps its main session to compact cards with state outside the conversation).

In the notes root the Agent may write `wiki/`, `收件箱/` (inbox), and `journal/`; everything else is read-only unless approved. The `AGENTS.md` file in the notes root guides the Agent. DSH currently provides no per-subdirectory write permissions. Version checks in the notes tools protect against overwriting changed content. Personal todos (planner SQLite) and the Agent's own work items stay strictly separate; the todo database stays where it is, outside the notes root.

Implemented this round: the notes plugin registers its root as a DSH Workspace automatically; an `AGENTS.md` template ships in `plugins/notes/templates/` for the user to review and copy; planner fixes (success notices auto-dismiss, the all-day toggle keeps the chosen date, the form shows an inclusive all-day end date, simplified forms with a "More" section, "New event" only in the Today and Calendar views); the Android project was removed, and mobile currently means the DSH web page in a phone browser.

Next: a 1-2 week trial using built-in DSH features (agent presets, subagents, scheduled tasks, the karpathy-llm-wiki skill) without new plugin code; afterwards judge by whether the user opens it daily, whether they still need to re-explain context, and whether reminders were missed. Deferred: code-repository management, a file watcher, a Ticket plugin, a phone app/push, and learning-plugin changes.

None of this changes existing rules: no Markdown-to-task sync, no data migration, no vendor edits, no CSP relaxation, and Agent plans are not personal todos.

## Learning tutor boundaries

The tutor is independently distributed for existing DSH users only. Users select their workspace and teaching preset. It does not change host default presets or logging settings, or join the default notes + todos composition.

Learning records live in the session workspace's `.learn/`. Formal scores require actual questions, learner answers, and examiner evidence; tutor self-reporting cannot raise mastery. See the [tutor guide](../packages/learn-anything/README.en.md) for detailed rules and interactions.

## Specification and history

This document maintains current scope and key constraints. Configuration and interfaces are documented in the [notes guide](../plugins/notes/README.md), [todos guide](../plugins/todos/README.en.md), and [technical overview](TECHNICAL_DESIGN.en.md). Actual validation evidence is in the [handoff log (Chinese)](HANDOFF.md).

The complete v0.34 rules and phased acceptance tables remain in the [historical specification (Chinese)](history/v0.34/PRODUCT-SPEC.md). Recurrence, source links, upgrades, and external notifications described there are unimplemented plans, not current promises. Expanding scope requires renewed requirements and acceptance criteria.
