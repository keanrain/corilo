# Corilo Notes for DeepSeek Harness

**[中文快速开始](QUICKSTART.zh-CN.md)** — direct notes work without a model key or Corilo account.

Notes plugin for the personal self-hosted Corilo direction. It uses the published DeepSeek Harness tool API, pinned to `0.2.2-rc.1`, and Cordis `4.1.0`. Harness is a developer preview: do not upgrade the runtime independently of these dependencies and the integration tests.

This package supplies Markdown storage, model-facing tools and a **笔记** page inside the Harness Web shell. The page browses Markdown metadata in bounded pages, searches filenames and body text, reads and edits notes, and saves original words directly without AI. Harness supplies the conversation UI, model settings, default tools and permission/sandbox policy. No Pi runtime or second agent loop is mounted.

The desktop page is a note list beside a continuous document. Click **新笔记** to create a real empty Markdown note and start writing, or type directly into the initial page: auto-save creates a readable **未命名.md**, **未命名 2.md**, etc. with the initial text in one request. No filename form or first-submit step is required in the default flow. Click the document title to rename it inline; Enter or leaving the title confirms, Escape cancels.

The body uses **CodeMirror 6**, with styled Markdown headings/emphasis/inline code, delimiters revealed on the active line, list continuation, undo/redo, and a localized document search/replace panel. A compact format toolbar and Ctrl/Cmd+B, I and F work directly in the document. This is Markdown editing, not a private rich-text document format; tables, attachments and embedded blocks are not full WYSIWYG widgets. Save acknowledgements retain cursor and undo history; opening another document starts a separate history.

Save status lives quietly in the toolbar. The default workflow does not keep a separate save form or a browser-draft explanation above the body. Notes save after a 1-second typing pause, including after switching to another Harness panel, and newer typing survives in-flight replies. Failures, conflicts and unknown outcomes stay visible and stop automatic writes; restoring a draft alone never submits it. Normal note switching waits for the current edit to save before reading the target. Unedited recovered drafts and manual mode use protected draft retention instead. After a failed or uncertain write, selecting a file for verification asks to retain the current draft first, then only reads the selected file; it never resends creation automatically. Ctrl/Cmd+S still uses the same versioned service. **更多操作** offers a manual mode for explicit save / exact-word capture; the preference survives plugin switches while this Harness page stays open, and a full reload restores the default.

On phones, **查找笔记** switches to browsing/search and **返回正文** returns without losing input; opening a result or recovering a draft returns to the editor. The list, editor and preview are separate phone views. Recovery drafts live in the sidebar; history/trash and the manual setting live under **更多操作**. For both plugins from a source checkout, use the [root setup/init/start flow](https://github.com/keanrain/corilo/blob/feat/cloud-notes/README.md#一起使用笔记和待办); independent package commands remain supported.

视觉使用 [Astryx Neutral](https://github.com/meta/astryx) 0.7.11 的 62 个静态设计 token，局部适配原生控件；浅深色与字体继承 Harness，主次按钮、焦点、列表与反馈保持一致。每包 token 子集约 3.6 KB，不载全局 reset 或网络字体。固定 Harness 的 React 实测为 18.3.1，Astryx React 组件要求 >=19，因此本包**没有接入其 React 组件**或另带 React。MIT 与来源哈希随代码记录，原功能和保存保护不变。

Markdown preview uses pinned **markdown-it 15.0.3** and **DOMPurify 3.4.17**; raw HTML and active resources are disabled, images display only their alternative text, and links permit HTTP(S). Desktop shows source and preview together, phones switch views. Preview stops above 128×1024 UTF-16 code units with an explicit message; the full 1 MiB note remains editable and saveable.

Saved notes can be renamed directly in their title within the current directory after saving the body. Renaming checks the read version, never overwrites an existing destination and leaves earlier history discoverable by its anchored original path. It does not rewrite links or todo associations. A crash or partial failure can leave both names; the UI preserves the unresolved operation and offers explicit read-only verification, never automatic retry.

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

For an always-on Linux host, follow [the Linux guide](LINUX.zh-CN.md) and review the systemd user-service example. It pins native homes, working directory and listener port; no service is installed by this package. `check` reports the resolved Harness/shared-agent homes and cwd and rejects homes overlapping notes or recovery data. It creates neither home and reveals no credential values. Native environment resolution is reused from the pinned Harness package.

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
npm install --ignore-scripts /absolute/path/to/corilo-dsh-notes-0.5.0.tgz
npx --no-install corilo-notes init --directory /absolute/path/to/corilo-instance
npx --no-install corilo-notes check --config /absolute/path/to/corilo-instance/notes.patch.json
npx --no-install corilo-notes start --config /absolute/path/to/corilo-instance/notes.patch.json
```

npm installs the pinned Harness dependency; the tarball is not an offline all-dependencies installer. Keep the recipient's generated `package-lock.json` to reproduce that installation. Node.js, Git and an npm registry connection for the initial install are prerequisites. Building from a source checkout needs dev dependencies; using the tarball needs no esbuild, source checkout or repository access. The plugin's MIT license and bundled idb ISC / uuid MIT notices are included. Other installed dependencies retain their own licenses; system Git is not redistributed. Existing `app/` and Pi/cloud data are not changed.

## Upgrade and roll back

Keep the app installation separate from the instance data. Install each reviewed
Corilo tarball in a **new npm directory**, retaining the previous directory,
`package-lock.json`, tarball and original overlay. Do not run `npm update` on
Harness or replace the running installation in place. Review the release's
compatibility and migration notes first; this release keeps the existing notes
and recovery-state formats.

1. Save any browser drafts to files, stop this instance, and take a verified
   backup of its notes and state. A browser draft is not part of that backup.
2. In a new installation directory, run `npm init -y` and
   `npm install --ignore-scripts /absolute/path/to/corilo-dsh-notes-0.5.0.tgz`.
3. From that **new** directory, generate a new overlay referring to the new
   installed package while keeping the original data paths:

   ```sh
   npx --no-install corilo-notes rebind --config /absolute/corilo-instance/notes.patch.json --output /absolute/corilo-instance/notes.next.patch.json
   npx --no-install corilo-notes check --config /absolute/corilo-instance/notes.next.patch.json
   npx --no-install corilo-notes start --config /absolute/corilo-instance/notes.next.patch.json
   ```

4. Use the same Harness home/profile and listener port as before. Verify opening
   a known note, its history and trash before making new changes. Keep the old
   installation and overlay until the new version has been accepted.

`rebind` reads only the strict declarative single-plugin overlay; it never loads
code from the previous package. It checks the current runtime, paths and state
binding, then creates a private new overlay exclusively. It never overwrites a
config, changes root/state bindings, moves notes or starts a service. An arbitrary
multi-plugin Harness overlay must be maintained using Harness's own composition
workflow. Ordinary `check` and `start` still require an overlay for their own
installed package.

To roll back **this unchanged-format release**, stop the new process, return to
the old npm directory, and run its original `start --config` command with its old
overlay and the same Harness profile/port. Do not run both installations against
the same data simultaneously. Returning to the same canonical notes path
preserves the library identity; browser drafts also require the same browser
origin. Rollback across future data-format or Harness upgrades is only supported
when that release explicitly tests it; restoring a backup may then be necessary.
`rebind` itself does not prove cross-version data compatibility.

## Tools and storage

| Tool | Behavior |
|---|---|
| `corilo_notes_list` | Legacy bounded full-version list of Markdown paths, byte sizes and content versions |
| `corilo_notes_browse` | Browse a bounded metadata page without reading every note body; continue with the returned cursor |
| `corilo_notes_search` | Literal filename/body search with bounded snippets and an explicit truncation flag |
| `corilo_notes_read` | Read text and content version before editing |
| `corilo_notes_create` | Create an empty or exact-initial-text note under an unoccupied readable untitled name; never overwrite |
| `corilo_notes_save` | Save with the read version; `expected: null` creates only when absent |
| `corilo_notes_rename` | Rename within one directory using the read version, only to an absent target; preserve exact bytes and earlier history |
| `corilo_notes_capture` | Create a unique Markdown note containing the exact supplied non-empty text |
| `corilo_notes_history` / `corilo_notes_read_revision` | List/read this note's recovery checkpoints |
| `corilo_notes_restore_revision` | Restore a checkpoint using the current file's expected version |
| `corilo_notes_trash` / `corilo_notes_list_trash` | Version-check a deletion into recovery trash, or list deleted notes |
| `corilo_notes_restore_trash` | Restore a deleted note only to an absent Markdown path |

Paths are portable relative `.md`/`.markdown` paths. Hidden paths, traversal, links, hardlinks and special files are rejected. Read/save bounds are 1 MiB per note. The legacy full-version `list` remains bounded to 2000 scanned entries and 8 MiB total file content for existing callers. The page and `browse` tool use metadata pagination, so that legacy body-scan limit does not block navigation. A metadata page has at most 100 items, a stable path cursor and explicit `hasMore`/`nextCursor`; each request checks at most 20000 directory entries, 20 levels and a 10-second deadline. Exceeding a scan bound fails rather than silently calling a partial scan complete.

Filename/body search reuses pinned `@vscode/ripgrep`; npm supplies its platform binary through optional dependencies even with `--ignore-scripts` (do not omit optional dependencies). Queries are literal single-line UTF-8 text, at most 256 bytes. Safe storage reads scan at most 64 MiB, with a 10-second deadline and cancellation. ripgrep returns only the first match's line/column per matching line, so common characters do not expand into repeated match payloads; the position protocol is capped at 64 KiB. Results include at most 100 snippets around 240 characters and explicitly report truncation. There is no model call or second authoritative copy of note text.

The storage service serializes its own operations and rejects stale content versions. It does not provide an atomic filesystem transaction against arbitrary independent editors or default shell tools. Cancellation is checked before queued writes and before commit; an already committed file is not rolled back. This is storage behavior, not a replacement for Harness's permission or sandbox policies.

The capture tool preserves the text passed to it, including BOM, CRLF and surrounding whitespace. Invoking it through an Agent still involves a model turn. The page calls the same store directly through the Host and never requests a model. The editor maps logical changes back onto the original text, preserving untouched BOM, line endings and whitespace. Inserted newlines follow the document’s CRLF/CR/LF convention; edited or deleted ranges are intentional changes. This is not an arbitrary-encoding binary editor.

## Local history and trash

With `stateRoot` configured, the store uses system Git plumbing to maintain a separate bare `stateRoot/history.git`. The state directory is bound to the canonical notes root by a format/version marker. It never initializes or changes a `.git` directory in the user's notes, uses no GitHub remote, and rejects a state directory belonging to another root. It does not execute user Git hooks or use user Git configuration/object alternates.

Managed saves checkpoint the previous and new content. Revision restoration still checks the current file version; deletion likewise requires the version actually read. Deleted notes have a recovery record; restoring them creates a new absent path and refuses to overwrite another note. If deletion was interrupted after recording recovery data, the trash list can indicate that the original still exists. A failed acknowledgement may follow an already committed file operation, so read the actual file before retrying.

History returns at most 100 entries per page, with `hasMore`/`nextCursor`; pass the last returned revision as `cursor` to continue into older versions. The cursor must belong to this note's current history. Metadata is read in bounded Git batches rather than one process per version. Trash listing returns at most 100 records per page in stable ID order, with `hasMore`/`nextCursor`; pass `cursor` to continue. Known-ID restoration does not depend on enumerating the list. Recovery-state scanning is bounded to 20000 entries. Frequent automatic saves can grow this history faster; unchanged text is not resubmitted, and in-flight edits are coalesced.  There is no automatic expiry, historical-version deletion, remote backup, or disk-quota enforcement yet. After stopping the running instance, `corilo-notes maintain --config /absolute/notes.patch.json` uses Git compression and reference packing while preserving all object identities, versions and trash refs; it does not choose a retention period or delete notes. Run maintenance before reaching the 20000-entry state bound; it refuses a state directory that already fails validation. Changes made through external editors or Harness default tools are not continuously versioned; their current content can be checkpointed before the next Corilo-managed change, but intervening external versions may not be recoverable. Local Git history is not an independent backup; loss of the host/state disk still requires a separate backup strategy.

## Web page and Host boundary

`package.json` declares `dsh.client` and exports `./client`. The small esbuild script emits the pinned Harness lazy-CJS factory format (`window.__ModuleLoader__.load`); React and the draft-store engine resolve from the shell's shared module table. The client registers into the public `main` and `sidebar.panellist` slots, preserving Harness's existing UI and CSP. The same absolute-path overlay loads both halves in the pinned release. No upstream source modification is required.

The Host registers exact `/api/corilo-notes/*` POST routes for identity, paged browsing/body search, legacy list/read/save/capture, history/revision restore and trash recovery using `ctx.connection.fetch.register`. Harness's shared Connection carrier checks authentication, Host/Origin and owner identity before dispatch. The browser sends JSON over same-origin Fetch and cannot access the filesystem directly. No extra token, model settings, or approval system is introduced. The tools and routes close over the **same NotesStore instance**. Library-aware browser requests carry the root identity so an old page cannot silently save into a different configured root. These routes appear only in a Web composition providing Connection; tools also work in a host-only composition.

The editor shows unsaved/saving/saved/failed/conflict states. Failed saves preserve text and never retry automatically. A lost response can follow a committed write: inspect the file/list before retrying. Conflict preview preserves the draft; copying creates a separate note, while adopting the preview explicitly discards the draft and still uses that preview's version for the next save. Refreshing the list never replaces editor text. Drafts use IndexedDB through idb, partitioned by the Host's canonical knowledge-root identity and a separate per-page draft ID so tabs do not overwrite one another. After a reload, the page lists recoverable drafts and requires an explicit restore or discard. Restoring only populates the editor and preserves the original expected file version; it never silently writes over newer disk content. A successful file save clears that draft. Unsaved text and pending draft persistence trigger a browser leave warning even from another Harness panel. If browser storage fails, the page retains the in-memory text and shows a warning rather than claiming durable recovery. These are browser-local recovery copies, not independent backups: clearing site data, private browsing, losing a device, or a changed Host origin can make them unavailable. Search covers filenames and literal body text; it does not provide semantic search or a full-text index. The initial page copy is Chinese.

## Independent notes backup

Follow [the restic backup and restore guide](BACKUP.zh-CN.md) to stop writers, back up only `notes/` and `state/` into an encrypted independent repository, verify its data and restore into a new directory. `restore.mjs` validates the extracted library's original root binding and Git history before copying to a previously nonexistent target and rebinding only that new copy. It never restores configuration, runs tools or starts a model. The real local restic drill covers Markdown bytes, binary attachments, version history and trash. Harness conversations/configuration and browser drafts are outside this backup scope; physical NAS and full-instance recovery remain unverified.

## Verification

`npm test` in this package builds the bundle and runs real disk tests, CLI/config safety checks, standalone npm-tarball installation/boot checks, a published Cordis/ToolsService + ToolExecutionPipeline integration, and a subprocess running the published `dsh web` profile with the external plugin overlay. The Web boot test uses a test-only observer inside the real host to call the registered tools through Harness's pipeline, checks the resulting Markdown, verifies the unauthenticated Web root remains protected, and terminates the host. It uses a fresh temporary `DSH_HOME` and fictional notes, and does not call a model.

Run the separate real-browser acceptance from the checkout after building:

```sh
pip install -r requirements-dev.txt
python3 -m playwright install chromium
npm --prefix plugins/notes run test:browser
```

The restart flow launches the real Corilo CLI twice on the same loopback port and native homes, verifying cookie continuity, anonymous/expired-launch-token rejection, notes/history and explicit browser-draft recovery without duplicate capture. This is process-restart evidence, not systemd or machine-reboot acceptance.

The mobile flow uses Chromium Pixel/iPhone touch profiles with Chinese text, 320–700px layouts, landscape and reduced viewport space, plus failure/reload/draft recovery. This is not native keyboard or iOS WebKit evidence. Its isolated host uses Harness's public `documentsDirectory` setting to provide a synthetic workspace location.

The browser test command checks the actual insecure-origin runtime without crypto.randomUUID, then runs the existing page flow plus dedicated draft persistence/isolation/failure and history/trash recovery flows. Each Chromium test launches published `dsh web` with an external absolute-path overlay, accepts Harness's preview notice and closes its API-key onboarding without entering a key. It verifies the actual client bundle and real disk: list/search/read/edit, exact direct capture, pending state, conflict preview/copy, invalid-path and transport failures, draft retention across Plugins/notes navigation, two browser pages, reload, 390px viewport editing, authentication and Host/Origin rejection, and invalid payloads. It checks that no external/model requests occur. The existing old-app browser tests are separate regressions.

These checks do not establish physical Android/iPhone behavior, real DeepSeek calls, NAS backup or production self-hosting acceptance.

The notes backup tests include a real restic drill when the executable is available. Set `CORILO_REQUIRE_RESTIC=1` to require it (as CI does); `CORILO_TEST_RESTIC=/absolute/restic` optionally supplies its location. An absent tool otherwise skips only that drill, not the offline restore safety checks.

From the source checkout, `npm --prefix plugins/notes run benchmark` measures real file/Git operations against temporary synthetic data, comparing packed and loose recovery refs. It prints timings and command/check counts, then removes the fixture. It is an optional diagnostic, not a CI timing threshold or a hardware performance guarantee.
