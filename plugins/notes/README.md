# Corilo Files.md Workspace for DeepSeek Harness

**Version 0.7.0** · [中文快速开始](QUICKSTART.zh-CN.md) · MIT · Not published to npm.

One plugin supplies the Files.md workspace inside Harness: files, Markdown notes,
checklists, capture, journals, split editing and media. The complete pinned upstream
web tree and menus are retained. Harness supplies authentication, native Agent
conversations, model configuration and permissions. No Go sync server, Pi loop,
Telegram service or separate model UI is started.

## Install and run

Node.js **>=24.9.0**, Harness **0.2.2-rc.1**, fixed dependencies. From this checkout:

```sh
npm --prefix plugins/notes ci --ignore-scripts
npm --prefix plugins/notes run build
node plugins/notes/cli.mjs init --directory /absolute/corilo-instance
node plugins/notes/cli.mjs start --config /absolute/corilo-instance/notes.patch.json
```

For a received tarball, in a new installation directory:

```sh
npm init -y
npm install --ignore-scripts /absolute/corilo-dsh-notes-0.7.0.tgz
npx --no-install corilo-notes init --directory /absolute/corilo-instance
npx --no-install corilo-notes start --config /absolute/corilo-instance/notes.patch.json
```

The package includes the built client, pinned Files.md assets and notices; source
checkout, esbuild and the legacy app are unnecessary for production installation.
Use the private authenticated URL printed by Harness; never share its token.
Dismiss the model-key introduction to edit without a model. Existing DSH installs
can use `notes.patch.example.yml`, with absolute entry and root paths.

## Workspace and Agent

The native Files.md interface runs in a persistent iframe document. File access
uses authenticated Harness routes and the host disk as the sole authority; no
browser directory grant, local mirror or external sync is required. Native menus,
new files/folders, search, title rename, move/archive, links, split panes, capture,
journals and checklists remain. The host status/Agent bar reserves space above the
workspace. External embedded media are not fetched automatically; local media
remain available. The folder chooser explains that the directory is configured on
the host. External bot/API actions explain that those services are not connected.

`Chat.md` is deterministic capture, `Later.md` is a Markdown checklist, `journal/`
contains journals and `media/` holds attachments. These are separate from Harness
model conversations. The Agent button flushes pending edits and selects the native
conversation; returning retains the same iframe and editing session. Agent tools
read and version-save the same files and share the same queue as the workspace.
No model is invoked by direct editing, capture, journals or checkbox operations.

Writes check the version actually read; stale writes fail and retain input.
Unknown writes stop further writes to that file until a read verifies the result.
Capture replies lost after committing cannot be blindly sent again. Errors allow
file verification, explicit adoption or saving a separate note. Filename changes
must not overwrite existing targets. A service queue does not provide transactions
against arbitrary external editors/default shell tools. Beforeunload warns about
unsaved input; browser refresh/crash recovery is not promised.

Text/settings limit: 1 MiB. Attachment limit: 16 MiB. Directory list: at most
20000 entries, 64 MiB aggregate reads; recursive version scans have a 20-level /
20000-entry / 10-second budget. Hidden paths, traversal, symlinks, hard links and
special files are refused. Operations involving unsafe descendants fail clearly.
The root is an instance configuration, not a sandbox for all Harness tools.

## Existing installations and SQLite todos

Old configs still load, with Files.md as the default interface. To keep the prior
React/CodeMirror 6 notes page explicitly set `interface: classic` in its plugin
config. Old `stateRoot` is accepted but not used by the current plugin. Old history,
IndexedDB, SQLite, credentials and conversations are never automatically migrated
or deleted. Classic recovery helpers remain for pre-existing data only.

New source-launcher configs load only this workspace package. Old two-plugin
configs remain supported. The v0.34 design restores the separate tasks/calendar
plugin; its new features are not implemented yet. Keep the existing todo package
and database when using that workflow. The following is an optional one-way
export for users who explicitly choose Markdown task management. Stop both source
and destination services and back up their directories before importing:

```sh
# Read-only preview: does not create the notes directory.
corilo-import-todos --source /absolute/old/todos/todos.sqlite --root /absolute/notes
# Explicit import after reviewing the counts and paths.
corilo-import-todos --source /absolute/old/todos/todos.sqlite --root /absolute/notes --apply
```

Source checkouts use `node plugins/notes/import-todos.mjs` instead of the installed
command. The source must be a regular, unlinked v1 Corilo SQLite file in a directory
separate from notes. It is opened read-only. Existing `Later.md` is preserved and
new items appended: open → `- [ ]`, done → `- [x]`; cancelled records are never
reopened. Body and association remain readable; all original business fields,
including cancellation, timestamps and versions, are preserved exactly in the
public JSON inside `archive/Todo import <identity>.md`.

The import journal is written before the target and records planned/complete
state and before/after versions. A retry after a crash does not append twice.
Subsequent changes to the source or conflicting target edits require review.
Both the target and journal must fit 1 MiB; oversize imports fail before writing.
The old database, receipts and package remain. Removing the `corilo-todos` entry
is only appropriate after explicitly choosing to manage those tasks in Markdown;
it is no longer the recommended default. There is no automatic synchronization
between the exported checklist and the database. Do not delete either source.

## Tools, provenance and verification

The eight `corilo_notes_*` tools retain their identifiers: list, browse, search,
read, create, save, rename and capture. Agent saves personal checklists and journals
as ordinary versioned Markdown; its execution-plan todo is a separate concept.
Actual DeepSeek interaction requires its own validation and is not claimed by
synthetic tool-pipeline tests.

Upstream: https://github.com/zakirullin/files.md at
`9e948ba6071e320c41c866f92817cf96f9bb7ba6`. `vendor/filesmd/SOURCE.json` records hashes;
vendored web files are unchanged. `workspace-api.mjs` applies checked runtime
patches for filename safety, lifecycle, read-error propagation and local-only media.
`workspace/` adapts file handles and native Agent navigation. Original MIT and
bundled third-party notices are distributed. Classic CodeMirror 6/Astryx code and
its notices remain only for explicit compatibility.

```sh
npm --prefix plugins/notes test
npm --prefix plugins/notes run test:browser
# Independent tarball; run inside this package directory.
npm pack --pack-destination /absolute/existing/output-directory
```

`test/workspace_browser.py` covers the current real Harness workspace;
`test/core_browser.py` covers the optional classic page. Node tests cover storage,
Agent pipeline, host boot, isolated production installation, source hashes and
SQLite migration. All use synthetic data and no models/external services. Physical
phones, native IME/WebKit, microphone, real models, remote deployments, Linux
service/autostart, NAS and full-instance recovery remain separately unverified.
[Linux guide](LINUX.zh-CN.md). [Old recovery guide](BACKUP.zh-CN.md) is only for old
notes/state backups, not a complete Harness-instance backup.
