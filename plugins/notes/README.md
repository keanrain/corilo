# Corilo Notes for DeepSeek Harness

**[中文快速开始](QUICKSTART.zh-CN.md)** — direct notes work without a model key or Corilo account.

Notes plugin for the personal self-hosted Corilo direction. It uses the published DeepSeek Harness tool API, pinned to `0.2.2-rc.1`, and Cordis `4.1.0`. Harness is a developer preview: do not upgrade the runtime independently of these dependencies and the integration tests.

This package supplies Markdown storage, model-facing tools and a **笔记** page inside the Harness Web shell. The page browses Markdown metadata in bounded pages, searches filenames and body text, reads and edits notes, and saves original words directly without AI. Harness supplies the conversation UI, model settings, default tools and permission/sandbox policy. No Pi runtime or second agent loop is mounted.

## Install and run

Requires Node.js >=24.9.0 and system Git >=2.36 (available as `git` on PATH). Install Git using your OS package manager. The package includes the exact supported Harness runtime as an npm dependency; a global `dsh` installation is neither required nor used. The supported Host release is **0.2.2-rc.1**; future Harness versions require compatibility testing first.

From the Corilo source checkout:

```sh
npm ci --prefix plugins/notes --ignore-scripts
npm --prefix plugins/notes run build
node plugins/notes/cli.mjs init --directory /absolute/path/to/corilo-instance
node plugins/notes/cli.mjs check --config /absolute/path/to/corilo-instance/notes.patch.json
node plugins/notes/cli.mjs start --config /absolute/path/to/corilo-instance/notes.patch.json
```

`init --directory` chooses separate `notes/`, `state/` and `notes.patch.json` paths under one absolute instance directory. It creates only the instance directory and a private overlay, using exclusive creation; it never replaces an existing config, migrates notes or starts a service. Advanced `init --root /absolute/notes --state-root /absolute/state --config /absolute/notes.patch.json` keeps existing Markdown libraries in place; the explicit config parent must already exist. The JSON overlay is also valid YAML and can be inspected before `start`. Notes, recovery state and config must be separate non-overlapping locations. Link components are rejected. `check` is read-only: it checks the Node and pinned Harness versions, built client, writable paths, Git, and any existing recovery-state binding. The service creates its notes/state directories on first successful activation.

`start` launches the installed fixed-version `dsh web --patch ... --no-open` and forwards shutdown signals. It defaults to Harness's loopback listener; `--port 3000` optionally selects a port. It does not deploy, configure remote access, run a background daemon, open a browser, or change Harness security policy.

Use the authenticated URL printed by Harness. Accept its preview notice and close its API-key onboarding to use direct notes without a key. For Agent conversations, configure the model in Harness's own settings and select the intended workspace. Keep Harness home/configuration outside both the knowledge and Corilo recovery-state directories. All sessions using this profile share its configured root. This is a personal instance, not a multi-user boundary, and the notes root does not restrict Harness's default filesystem/shell tools.

For an existing Harness composition, `notes.patch.example.yml` remains an advanced overlay example. Replace all three absolute paths, then launch the fixed-version `dsh web --patch /absolute/notes.patch.yml --no-open`. The Corilo CLI accepts a single notes overlay pointing at **this installed package**; it does not validate arbitrary multi-plugin Harness compositions. Existing configs lacking `stateRoot` can still load tools, but history/recovery requires adding an external state directory.

## Share a standalone tarball

The package remains `private` and has not been uploaded to npm. To create a distributable file from the source checkout:

```sh
cd plugins/notes
npm pack --pack-destination /absolute/existing/output-directory
```

`prepack` builds the browser bundle. The tarball contains Host code, the CLI, built client, licenses, README and example overlay; source tests, user configs, credentials, notes and `node_modules` are excluded. The recipient can install it into an ordinary local npm directory:

```sh
mkdir corilo-install
cd corilo-install
npm init -y
npm install --ignore-scripts /absolute/path/to/corilo-dsh-notes-0.2.0.tgz
npx --no-install corilo-notes init --directory /absolute/path/to/corilo-instance
npx --no-install corilo-notes check --config /absolute/path/to/corilo-instance/notes.patch.json
npx --no-install corilo-notes start --config /absolute/path/to/corilo-instance/notes.patch.json
```

npm installs the pinned Harness dependency; the tarball is not an offline all-dependencies installer. Keep the recipient's generated `package-lock.json` to reproduce that installation. Node.js, Git and an npm registry connection for the initial install are prerequisites. Building from a source checkout needs dev dependencies; using the tarball needs no esbuild, source checkout or repository access. The plugin's MIT license and bundled idb ISC / uuid MIT notices are included. Other installed dependencies retain their own licenses; system Git is not redistributed. Existing `app/` and Pi/cloud data are not changed.

## Tools and storage

| Tool | Behavior |
|---|---|
| `corilo_notes_list` | Legacy bounded full-version list of Markdown paths, byte sizes and content versions |
| `corilo_notes_browse` | Browse a bounded metadata page without reading every note body; continue with the returned cursor |
| `corilo_notes_search` | Literal filename/body search with bounded snippets and an explicit truncation flag |
| `corilo_notes_read` | Read text and content version before editing |
| `corilo_notes_save` | Save with the read version; `expected: null` creates only when absent |
| `corilo_notes_capture` | Create a unique Markdown note containing the exact supplied non-empty text |
| `corilo_notes_history` / `corilo_notes_read_revision` | List/read this note's recovery checkpoints |
| `corilo_notes_restore_revision` | Restore a checkpoint using the current file's expected version |
| `corilo_notes_trash` / `corilo_notes_list_trash` | Version-check a deletion into recovery trash, or list deleted notes |
| `corilo_notes_restore_trash` | Restore a deleted note only to an absent Markdown path |

Paths are portable relative `.md`/`.markdown` paths. Hidden paths, traversal, links, hardlinks and special files are rejected. Read/save bounds are 1 MiB per note. The legacy full-version `list` remains bounded to 2000 scanned entries and 8 MiB total file content for existing callers. The page and `browse` tool use metadata pagination, so that legacy body-scan limit does not block navigation. A metadata page has at most 100 items, a stable path cursor and explicit `hasMore`/`nextCursor`; each request checks at most 20000 directory entries, 20 levels and a 10-second deadline. Exceeding a scan bound fails rather than silently calling a partial scan complete.

Filename/body search reuses pinned `@vscode/ripgrep`; npm supplies its platform binary through optional dependencies even with `--ignore-scripts` (do not omit optional dependencies). Queries are literal single-line UTF-8 text, at most 256 bytes. Safe storage reads scan at most 64 MiB, with a 10-second deadline and cancellation. ripgrep returns only the first match's line/column per matching line, so common characters do not expand into repeated match payloads; the position protocol is capped at 64 KiB. Results include at most 100 snippets around 240 characters and explicitly report truncation. There is no model call or second authoritative copy of note text.

The storage service serializes its own operations and rejects stale content versions. It does not provide an atomic filesystem transaction against arbitrary independent editors or default shell tools. Cancellation is checked before queued writes and before commit; an already committed file is not rolled back. This is storage behavior, not a replacement for Harness's permission or sandbox policies.

The capture tool preserves the text passed to it, including BOM, CRLF and surrounding whitespace. Invoking it through an Agent still involves a model turn. The page calls the same store directly through the Host and never requests a model. Browser textarea editing follows browser newline normalization; it is not a byte-preserving editor for arbitrary original file encodings.

## Local history and trash

With `stateRoot` configured, the store uses system Git plumbing to maintain a separate bare `stateRoot/history.git`. The state directory is bound to the canonical notes root by a format/version marker. It never initializes or changes a `.git` directory in the user's notes, uses no GitHub remote, and rejects a state directory belonging to another root. It does not execute user Git hooks or use user Git configuration/object alternates.

Managed saves checkpoint the previous and new content. Revision restoration still checks the current file version; deletion likewise requires the version actually read. Deleted notes have a recovery record; restoring them creates a new absent path and refuses to overwrite another note. If deletion was interrupted after recording recovery data, the trash list can indicate that the original still exists. A failed acknowledgement may follow an already committed file operation, so read the actual file before retrying.

History returns at most 100 entries per page, with `hasMore`/`nextCursor`; pass the last returned revision as `cursor` to continue into older versions. The cursor must belong to this note's current history. Metadata is read in bounded Git batches rather than one process per version. Trash listing returns at most 100 records per page in stable ID order, with `hasMore`/`nextCursor`; pass `cursor` to continue. Known-ID restoration does not depend on enumerating the list. Recovery-state scanning is bounded to 20000 entries. There is no automatic expiry, historical-version deletion, remote backup, or disk-quota enforcement yet. After stopping the running instance, `corilo-notes maintain --config /absolute/notes.patch.json` uses Git compression and reference packing while preserving all object identities, versions and trash refs; it does not choose a retention period or delete notes. Run maintenance before reaching the 20000-entry state bound; it refuses a state directory that already fails validation. Changes made through external editors or Harness default tools are not continuously versioned; their current content can be checkpointed before the next Corilo-managed change, but intervening external versions may not be recoverable. Local Git history is not an independent backup; loss of the host/state disk still requires a separate backup strategy.

## Web page and Host boundary

`package.json` declares `dsh.client` and exports `./client`. The small esbuild script emits the pinned Harness lazy-CJS factory format (`window.__ModuleLoader__.load`); React and the draft-store engine resolve from the shell's shared module table. The client registers into the public `main` and `sidebar.panellist` slots, preserving Harness's existing UI and CSP. The same absolute-path overlay loads both halves in the pinned release. No upstream source modification is required.

The Host registers exact `/api/corilo-notes/*` POST routes for identity, paged browsing/body search, legacy list/read/save/capture, history/revision restore and trash recovery using `ctx.connection.fetch.register`. Harness's shared Connection carrier checks authentication, Host/Origin and owner identity before dispatch. The browser sends JSON over same-origin Fetch and cannot access the filesystem directly. No extra token, model settings, or approval system is introduced. The tools and routes close over the **same NotesStore instance**. Library-aware browser requests carry the root identity so an old page cannot silently save into a different configured root. These routes appear only in a Web composition providing Connection; tools also work in a host-only composition.

The editor shows unsaved/saving/saved/failed/conflict states. Failed saves preserve text and never retry automatically. A lost response can follow a committed write: inspect the file/list before retrying. Conflict preview preserves the draft; copying creates a separate note, while adopting the preview explicitly discards the draft and still uses that preview's version for the next save. Refreshing the list never replaces editor text. Drafts use IndexedDB through idb, partitioned by the Host's canonical knowledge-root identity and a separate per-page draft ID so tabs do not overwrite one another. After a reload, the page lists recoverable drafts and requires an explicit restore or discard. Restoring only populates the editor and preserves the original expected file version; it never silently writes over newer disk content. A successful file save clears that draft. Unsaved text and pending draft persistence trigger a browser leave warning even from another Harness panel. If browser storage fails, the page retains the in-memory text and shows a warning rather than claiming durable recovery. These are browser-local recovery copies, not independent backups: clearing site data, private browsing, losing a device, or a changed Host origin can make them unavailable. Search covers filenames and literal body text; it does not provide semantic search or a full-text index. The initial page copy is Chinese.

## Verification

`npm test` in this package builds the bundle and runs real disk tests, CLI/config safety checks, standalone npm-tarball installation/boot checks, a published Cordis/ToolsService + ToolExecutionPipeline integration, and a subprocess running the published `dsh web` profile with the external plugin overlay. The Web boot test uses a test-only observer inside the real host to call the registered tools through Harness's pipeline, checks the resulting Markdown, verifies the unauthenticated Web root remains protected, and terminates the host. It uses a fresh temporary `DSH_HOME` and fictional notes, and does not call a model.

Run the separate real-browser acceptance from the checkout after building:

```sh
pip install -r requirements-dev.txt
python3 -m playwright install chromium
npm --prefix plugins/notes run test:browser
```

The browser test command checks the actual insecure-origin runtime without crypto.randomUUID, then runs the existing page flow plus dedicated draft persistence/isolation/failure and history/trash recovery flows. Each Chromium test launches published `dsh web` with an external absolute-path overlay, accepts Harness's preview notice and closes its API-key onboarding without entering a key. It verifies the actual client bundle and real disk: list/search/read/edit, exact direct capture, pending state, conflict preview/copy, invalid-path and transport failures, draft retention across Plugins/notes navigation, two browser pages, reload, 390px viewport editing, authentication and Host/Origin rejection, and invalid payloads. It checks that no external/model requests occur. The existing old-app browser tests are separate regressions.

These checks do not establish physical Android/iPhone behavior, real DeepSeek calls, NAS backup or production self-hosting acceptance.

From the source checkout, `npm --prefix plugins/notes run benchmark` measures real file/Git operations against temporary synthetic data, comparing packed and loose recovery refs. It prints timings and command/check counts, then removes the fixture. It is an optional diagnostic, not a CI timing threshold or a hardware performance guarantee.
