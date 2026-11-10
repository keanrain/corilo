# Corilo Notes for DeepSeek Harness

**[中文快速开始](QUICKSTART.zh-CN.md)** · Version **0.6.0**, not published to npm.

A small notes plugin: create, find, read, edit, rename, and auto-save ordinary Markdown. No model key is needed for direct editing. Harness supplies conversations, models, authentication, permissions and default tools. The runtime is fixed to **0.2.2-rc.1**, with **Node.js >=24.9.0**.

The editor reuses CodeMirror 6 and Lezer, with Markdown styles, basic formatting, list continuation, search and undo/redo. Optional reading preview uses markdown-it and DOMPurify without raw HTML, active images or external resources. React comes from Harness.

## One save workflow

Click **新笔记** and write, or type into the initial page. Markdown auto-saves after a one-second pause; Ctrl/Cmd+S saves immediately. Click the title to rename within its directory. Opening another note first saves the current edit. Save responses retain later typing; rename and initial creation retain undo history, while another document gets its own editing session.

Failures retain current input in the active plugin session. Conflicts and unknown outcomes stop automatic writes. Read the file to verify or explicitly save a copy; uncertain creation is never retried automatically. Closing an unsaved page prompts before leaving.

**No notes draft library, recovery UI, history, trash, delete page, or manual-save mode.** There is no notes IndexedDB persistence and no promise of recovering unsaved input after a reload, crash or browser closure. Switching Harness panels retains the active plugin session and its save pipeline.

## Install from source

From the repository root:

```sh
npm --prefix plugins/notes ci --ignore-scripts
npm --prefix plugins/notes run build
node plugins/notes/cli.mjs init --directory /absolute/corilo-instance
node plugins/notes/cli.mjs start --config /absolute/corilo-instance/notes.patch.json
```

For notes and todos together, use the repository's `setup:corilo`, `init:corilo` and `start:corilo` commands. Root `npm start` remains the legacy application.

A received `corilo-dsh-notes-0.6.0.tgz` includes the built client. In a new installation directory, run `npm init -y` and `npm install --ignore-scripts /absolute/corilo-dsh-notes-0.6.0.tgz`. Use `npx --no-install corilo-notes` for init/check/start. npm still downloads the fixed production dependencies; no esbuild or source checkout is needed.

For an existing DSH installation, load the package's `index.mjs` with an absolute Markdown root as shown in `notes.patch.example.yml`. The browser client is supplied through `dsh.client` and `./client`; restart DSH after updating the package.

## Data and compatibility

New configuration only needs `root`; **Git and stateRoot are not required**. The current plugin never creates history or writes to legacy recovery directories. Old `stateRoot` settings are accepted for existing installations. Existing Markdown, history directories and browser draft databases are not migrated or deleted.

Before upgrading, save any unsaved input using the old version. Old browser recovery data remains readable only by the old version at the same origin; the new version does not open that database. Retain the old installation and config for rollback. `rebind --config /old.patch.json --output /new.patch.json` creates a new installation overlay without overwriting the old one or moving data.

Legacy Git/history helpers and offline restore code remain solely for existing data compatibility. [The old backup guide](BACKUP.zh-CN.md) describes that older format, not features of this plugin. Ordinary Markdown can be backed up with tools the user already uses; the plugin does not create a backup service.

## Storage contract

UI and Agent tools share NotesStore. New files require expected:null; updates require the read SHA-256 version. Stale writes fail. Paths reject traversal, hidden components, links and special files. Notes are limited to 1 MiB; metadata browse and literal ripgrep search are bounded. These checks coordinate this service, not arbitrary external editors or Harness bash/file tools.

The tools are `corilo_notes_list`, `browse`, `search`, `read`, `create`, `save`, `rename`, and compatibility `capture` under the same prefix. History/restore/trash tools and HTTP routes are not registered.

## Verify

```sh
npm --prefix plugins/notes test
npm --prefix plugins/notes run test:browser
```

The browser acceptance runs the actual published Harness with synthetic files, no model calls and no external requests. File/CLI tests also protect legacy compatibility. Physical phones, native IMEs, WebKit, real DeepSeek, remote deployment and NAS remain separately unverified. Licenses for bundled dependencies are in THIRD_PARTY_NOTICES.md.
