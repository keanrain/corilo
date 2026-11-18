# Corilo plugins

[简体中文](README.md) | **English**

The current source composition is notes + todos planner v2 on pinned DSH 0.2.2-rc.3. The [learning tutor](../packages/learn-anything/README.en.md) is another independently distributed plugin for existing DSH users and is not included by default.

| Directory | Package | Status |
|---|---|---|
| [notes/](notes/README.md) | `@corilo/dsh-notes` | Files.md workspace: notes, Markdown checklists, journals, and native Agent access |
| [todos/](todos/README.en.md) | `@corilo/dsh-todos` | SQLite tasks/calendar, time blocks, and reminders; new configurations use planner v2, with v1 compatibility retained |

The notes package owns its dependencies, build, client, file service, import commands, and licenses. It runs outside the checkout with production dependencies. Pinned native Files.md resources ship in the package; runtime file and Agent adapters do not depend on the legacy app/.

The [three-step source setup](../README.md#start-in-three-steps) installs/builds both packages and creates a dual-plugin planner instance. Existing single-plugin/v1 configurations retain their behavior without automatic migration, database deletion, or configuration rewrites. SQLite-to-Markdown remains an optional export, not the default retirement path: stop services, back up, and explicitly apply it. Planner requires a new empty data directory; there is no old-database upgrade tool. These are distinct operations.

Root dependencies still serve the legacy app. launcher/ is a source entry point, not another release package. Do not introduce npm workspaces or a separate Agent/sync service. Both packages remain private and unpublished on npm. Package from the selected package directory with npm pack, never publish the entire repository, and exclude tests, node_modules, screenshots, and real data.

See the [development guide](../docs/DEVELOPMENT.en.md) for checks. Older standalone installation/tests remain valid for their modes; old UI tests do not establish current Files.md acceptance.
