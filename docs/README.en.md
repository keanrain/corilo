# Corilo documentation index

[简体中文](README.md) | **English**

The repository pins notes, todos, and the independent [learning tutor](../packages/learn-anything/README.en.md) to DSH 0.2.2-rc.3. The Python prototype was removed at the user's request; its implementation remains in Git history and local data is preserved.

Current source instances default to **notes 0.7.0 + todos 0.6.2 planner v2**. Files.md handles notes, materials, and journals; todos handles tasks, calendars, time blocks, and reminders. Agents use native Harness conversations and tools. The learning tutor is a separate plugin for existing DSH users, outside the default composition.

| Document | Purpose |
|---|---|
| [Handoff log (Chinese)](HANDOFF.md) | Versions, operation/migration evidence, and outstanding work; not the source of product rules |
| [Root README](../README.md) | Installation, current features, and upgrade boundaries |
| [Product](PRODUCT.en.md) | Positioning, scope, and tradeoffs |
| [Specification](PRODUCT-SPEC.en.md) | Current business scope and key constraints |
| [Interaction](DESIGN.en.md) | Notes, planner, and tutor interaction boundaries |
| [Architecture](TECHNICAL_DESIGN.en.md) | Runtime, dependencies, and storage compatibility |
| [Development](DEVELOPMENT.en.md) | Directories, commands, checks, and distribution |
| [Releases](RELEASING.en.md) | Independent versions, changelogs, and release preparation |
| [Plugin index](../plugins/README.en.md) | Notes and task/calendar packages |

New instances generate a dual-plugin planner configuration. Existing single-plugin/v1 dual-plugin configurations, SQLite databases, and legacy applications are preserved. Initialize planner in a new empty data directory; no old-database upgrade tool or automatic migration/deletion exists. `corilo-import-todos` previews by default; `--apply` exports records to Markdown without rewriting or deleting the source SQLite database. This optional one-way export is not a plugin retirement path. See package guides for full instructions.

Record real Harness, Chromium workflows, tool pipelines, out-of-repository production installations, and migration checks separately. They do not establish live DeepSeek, physical-phone, WebKit, target Linux deployment, or NAS acceptance. Personal self-hosting requires no Corilo account, Supabase, or GitHub binding.

Historical documentation remains in Chinese. The minimalist [v0.32 specification](history/PRODUCT-SPEC-v0.32.md), [technical record](history/TECHNICAL_DESIGN-v0.32.md), and [interaction design](history/DESIGN-v0.32.md) were superseded by the Files.md workspace direction. Earlier archives remain in history/. Legacy app/Android data and credentials are not migrated automatically, and old cloud submissions stay disabled.

The v0.34 direction restored independent tasks and calendars, replacing v0.33's Markdown-only task approach while retaining Files.md. [v0.33 product](history/PRODUCT-v0.33.md), [specification](history/PRODUCT-SPEC-v0.33.md), [architecture](history/TECHNICAL_DESIGN-v0.33.md), and [interaction](history/DESIGN-v0.33.md) are historical, not current requirements.

Original v0.34 documents are fully archived as [product](history/v0.34/PRODUCT.md), [specification](history/v0.34/PRODUCT-SPEC.md), [architecture](history/v0.34/TECHNICAL_DESIGN.md), and [interaction](history/v0.34/DESIGN.md). Current entry pages describe implemented behavior; historical phases are not the current outstanding-work list.
