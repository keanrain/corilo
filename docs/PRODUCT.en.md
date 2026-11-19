# Corilo product overview

[简体中文](PRODUCT.md) | **English**

Corilo consists of three DSH plugins with independent maintenance, installation, and distribution. See the [product specification](PRODUCT-SPEC.en.md) for rules and the [development guide](DEVELOPMENT.en.md) for commands.

| Product | Purpose |
|---|---|
| notes | Files.md notes, files, journals, and Markdown checklists |
| todos | Tasks, dates and deadlines, calendars, task time blocks, and persistent in-app reminders |
| Learning tutor | Learning routes, diagnosis, interactive practice, examiner verification, and spaced review |

The source launcher configures notes + todos planner for new instances. The learning tutor is installed separately by existing DSH users and is not included in the default composition. Users choose a workspace and teaching preset after installation. All three plugins reuse DSH authentication, sessions, models, and permissions.

## Current experience

Everyday note and task operations require no model. Notes and attachments are ordinary files on the host; tasks and calendars live in the todos SQLite database. Markdown checkboxes remain document content and are not synchronized automatically with the task database.

Planner provides six task views, search and pagination, planned dates, deadlines, priorities, and lists. The calendar offers month/week/day/agenda views, independent events, all-day events, and task time blocks. In-app reminders are persistent. Browser notifications require explicit permission and do not deliver when the page is closed.

The learning tutor stores records in `.learn/` in the session workspace and uses native DSH conversations and interactive UI. See the [tutor guide](../packages/learn-anything/README.en.md).

## Support and unimplemented scope

The runtime is pinned to DSH 0.2.2-rc.3 and requires Node.js ≥24.9.0. The initial deployment target is an always-on Linux host with browser access. Local tests do not establish acceptance on physical phones, NAS hardware, or the target deployment.

Existing notes-only and todos v1 configurations remain supported. Planner v2 requires a new directory; there is no v1 upgrade tool or automatic configuration/database migration.

Recurring tasks, note-source links, CalDAV/ICS, email, and other external notifications are not implemented. A notes backup is not a whole-instance backup; todos and tutor data need separate inclusion.

Original v0.34 long-term plans remain in the [historical product proposal (Chinese)](history/v0.34/PRODUCT.md), not as current delivery promises. Executed checks and limitations are recorded in the [handoff log (Chinese)](HANDOFF.md).
