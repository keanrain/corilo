# Corilo Notes for DeepSeek Harness

Notes plugin for the personal self-hosted Corilo direction. It uses the published DeepSeek Harness tool API, pinned to `0.2.2-rc.1`, and Cordis `4.1.0`. Harness is a developer preview: do not upgrade the runtime independently of these dependencies and the integration tests.

This package supplies Markdown storage, four model-facing tools and a **笔记** page inside the Harness Web shell. The page lists/searches filenames, reads and edits notes, and saves original words directly without AI. Harness supplies the conversation UI, model settings, default tools and permission/sandbox policy. No Pi runtime or second agent loop is mounted.

## Install and run

Requires Node.js >=24.9.0. From the Corilo checkout:

```sh
npm ci --prefix plugins/notes --ignore-scripts
npm --prefix plugins/notes run build
npm --prefix plugins/notes test
```

Copy `notes.patch.example.yml` to a local configuration file. Replace `name` with the absolute path of this package's `index.mjs`, and `config.root` with the absolute Markdown knowledge directory. Keep Harness home/configuration outside the knowledge directory.

```sh
cd plugins/notes
./node_modules/.bin/dsh web --patch /absolute/path/to/notes.patch.yml --no-open
```

Use the authenticated URL printed by Harness. Accept its preview notice and close its API-key onboarding to use notes without a key. For Agent conversations, configure the model through Harness's own settings and select the intended workspace. The plugin is personal-instance scoped: all sessions using this profile see its configured notes root. It is not a multi-user tenant boundary, and the notes root does not restrict Harness's other filesystem/shell tools. Keep their workspace and policy aligned with the intended personal deployment.

The Host ships plain ESM. The browser half requires `npm run build` before launch; `npm test` and `npm pack` build it automatically. It is an external Host plugin loaded by an absolute-path overlay. The pinned CLI is installed as a development dependency so the repository can reproduce the actual integration; no package has been published to npm. Existing `app/` and its Pi/cloud data are not migrated or modified by this package.

## Tools and storage

| Tool | Behavior |
|---|---|
| `corilo_notes_list` | Bounded recursive list of Markdown paths, byte sizes and content versions |
| `corilo_notes_read` | Read text and content version before editing |
| `corilo_notes_save` | Save with the read version; `expected: null` creates only when absent |
| `corilo_notes_capture` | Create a unique Markdown note containing the exact supplied text |

Paths are portable relative `.md`/`.markdown` paths. Hidden paths, traversal, links, hardlinks and special files are rejected. Read/save bounds are 1 MiB per note; listing is bounded to 2000 scanned entries and 8 MiB total file content. Exceeding a bound fails rather than silently truncating.

The storage service serializes its own operations and rejects stale content versions. It does not provide an atomic filesystem transaction against arbitrary independent editors or default shell tools. Cancellation is checked before queued writes and before commit; an already committed file is not rolled back. This is storage behavior, not a replacement for Harness's permission or sandbox policies.

The capture tool preserves the text passed to it, including BOM, CRLF and surrounding whitespace. Invoking it through an Agent still involves a model turn. The page calls the same store directly through the Host and never requests a model. Browser textarea editing follows browser newline normalization; it is not a byte-preserving editor for arbitrary original file encodings.

## Web page and Host boundary

`package.json` declares `dsh.client` and exports `./client`. The small esbuild script emits the pinned Harness lazy-CJS factory format (`window.__ModuleLoader__.load`); React and the draft-store engine resolve from the shell's shared module table. The client registers into the public `main` and `sidebar.panellist` slots, preserving Harness's existing UI and CSP. The same absolute-path overlay loads both halves in the pinned release. No upstream source modification is required.

The Host registers four exact `/api/corilo-notes/{list,read,save,capture}` POST routes using `ctx.connection.fetch.register`. Harness's shared Connection carrier checks authentication, Host/Origin and owner identity before dispatch. The browser sends JSON over same-origin Fetch and cannot access the filesystem directly. No extra token, model settings, or approval system is introduced. The tools and routes close over the **same NotesStore instance**. These routes appear only in a Web composition providing Connection; tools also work in a host-only composition.

The editor shows unsaved/saving/saved/failed/conflict states. Failed saves preserve text and never retry automatically. A lost response can follow a committed write: inspect the file/list before retrying. Conflict preview preserves the draft; copying creates a separate note, while adopting the preview explicitly discards the draft and still uses that preview's version for the next save. Refreshing the list never replaces editor text. Drafts survive panel switches in this browser page's memory; while editing notes a reload/close with unsaved changes triggers the browser's leave warning. Drafts are not crash-persistent backups; reloading from another Harness panel or closing the process may lose unsaved text. Filename search is not full-text search. The initial page copy is Chinese.

## Verification

`npm test` in this package runs real disk tests, a published Cordis/ToolsService + ToolExecutionPipeline integration, and a subprocess running the published `dsh web` profile with the external plugin overlay. The Web boot test uses a test-only observer inside the real host to call the registered tools through Harness's pipeline, checks the resulting Markdown, verifies the unauthenticated Web root remains protected, and terminates the host. It uses a fresh temporary `DSH_HOME` and fictional notes, and does not call a model.

Run the separate real-browser acceptance from the checkout after building:

```sh
pip install -r requirements-dev.txt
python3 -m playwright install chromium
npm --prefix plugins/notes run test:browser
```

The Chromium test launches published `dsh web` with an external absolute-path overlay, accepts Harness's preview notice and closes its API-key onboarding without entering a key. It verifies the actual client bundle and real disk: list/search/read/edit, exact direct capture, pending state, conflict preview/copy, invalid-path and transport failures, draft retention across Plugins/notes navigation, two browser pages, reload, 390px viewport editing, authentication and Host/Origin rejection, and invalid payloads. It checks that no external/model requests occur. The existing old-app browser tests are separate regressions.

These checks do not establish physical Android/iPhone behavior, real DeepSeek calls, NAS backup or production self-hosting acceptance.
