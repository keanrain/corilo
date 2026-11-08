# Corilo Notes for DeepSeek Harness

First host plugin for the personal self-hosted Corilo direction. It uses the published DeepSeek Harness tool API, pinned to `0.2.2-rc.1`, and Cordis `4.1.0`. Harness is a developer preview: do not upgrade the runtime independently of these dependencies and the integration tests.

This increment supplies Markdown storage and four model-facing tools. A dedicated notes page/editor and a direct **save original words without AI** UI action are not implemented yet. Harness supplies the conversation UI, model settings, default tools and permission/sandbox policy. No Pi runtime or second agent loop is mounted.

## Install and run

Requires Node.js >=24.9.0. From the Corilo checkout:

```sh
npm ci --prefix plugins/notes --ignore-scripts
npm --prefix plugins/notes test
```

Copy `notes.patch.example.yml` to a local configuration file. Replace `name` with the absolute path of this package's `index.mjs`, and `config.root` with the absolute Markdown knowledge directory. Keep Harness home/configuration outside the knowledge directory.

```sh
cd plugins/notes
./node_modules/.bin/dsh web --patch /absolute/path/to/notes.patch.yml --no-open
```

Use the authenticated URL printed by Harness. Configure the model through Harness's own settings and select the intended workspace. The plugin is personal-instance scoped: all sessions using this profile see its configured notes root. It is not a multi-user tenant boundary, and the notes root does not restrict Harness's other filesystem/shell tools. Keep their workspace and policy aligned with the intended personal deployment.

The package ships plain ESM and requires no plugin build step. It is an external Host plugin loaded by an absolute-path overlay. The pinned CLI is installed as a development dependency so the repository can reproduce the actual integration; no package has been published to npm. Existing `app/` and its Pi/cloud data are not migrated or modified by this package.

## Tools and storage

| Tool | Behavior |
|---|---|
| `corilo_notes_list` | Bounded recursive list of Markdown paths, byte sizes and content versions |
| `corilo_notes_read` | Read text and content version before editing |
| `corilo_notes_save` | Save with the read version; `expected: null` creates only when absent |
| `corilo_notes_capture` | Create a unique Markdown note containing the exact supplied text |

Paths are portable relative `.md`/`.markdown` paths. Hidden paths, traversal, links, hardlinks and special files are rejected. Read/save bounds are 1 MiB per note; listing is bounded to 2000 scanned entries and 8 MiB total file content. Exceeding a bound fails rather than silently truncating.

The storage service serializes its own operations and rejects stale content versions. It does not provide an atomic filesystem transaction against arbitrary independent editors or default shell tools. Cancellation is checked before queued writes and before commit; an already committed file is not rolled back. This is storage behavior, not a replacement for Harness's permission or sandbox policies.

The capture tool preserves the text passed to it, including BOM, CRLF and surrounding whitespace. Invoking it through an Agent still involves a model turn; the future direct capture UI must call the storage service without a model.

## Verification

`npm test` in this package runs real disk tests, a published Cordis/ToolsService + ToolExecutionPipeline integration, and a subprocess running the published `dsh web` profile with the external plugin overlay. The Web boot test uses a test-only observer inside the real host to call the registered tools through Harness's pipeline, checks the resulting Markdown, verifies the unauthenticated Web root remains protected, and terminates the host. It uses a fresh temporary `DSH_HOME` and fictional notes, and does not call a model.

These are Host/plugin integration checks. They do not establish dedicated notes UI, mobile usability, real DeepSeek calls, NAS backup or production self-hosting acceptance.
