# Corilo Workspace quick start

[简体中文](QUICKSTART.zh-CN.md) | **English**

Version 0.7.0 integrates the complete Files.md frontend with Harness. One plugin handles notes, Markdown checklists, capture, and journals while retaining native menus and features. Files live in an ordinary host directory; Git, a Corilo account, and a model key are not required.

## Three steps from source

Install Node.js ≥24.9.0. From the repository root:

```sh
npm run setup:corilo
npm run init:corilo -- --directory /absolute/corilo-instance
npm run start:corilo -- --directory /absolute/corilo-instance
```

Replace the directory with an absolute path outside the checkout. Initialization creates configuration without overwriting an existing instance. Open the authenticated URL printed by Harness and never share its token. Dismiss model setup and select Notes. New repository-launcher instances load notes plus todos planner; the standalone notes CLI below creates a notes-only instance.

## Installing a standalone package

In a new installation directory:

```sh
npm init -y
npm install --ignore-scripts /absolute/corilo-dsh-notes-0.7.0.tgz
npx --no-install corilo-notes init --directory /absolute/corilo-instance
npx --no-install corilo-notes start --config /absolute/corilo-instance/notes.patch.json
```

Existing DSH installations can load the entry using the included `notes.patch.example.yml`, with the host root configured. Restart the service and refresh the browser after package upgrades. Keep Harness pinned to 0.2.2-rc.3 rather than upgrading the host independently and guessing compatibility.

If an instance manages DSH through its own package.json, declare `"@deepseek-ai/dsh": "0.2.2-rc.3"`, not npm's default `^0.2.2-rc.3`. Later plugin installation may resolve that range again and upgrade the host. Check the installed version with `npm ls @deepseek-ai/dsh` both before and after installation. For a new isolated installation use `npm install --save-exact --ignore-scripts @deepseek-ai/dsh@0.2.2-rc.3`. Back up instances using a different version and validate a separate installation first; do not directly downgrade or rewrite a live instance.

## Use and upgrades

Use the native file tree, creation, search, title rename, split panes, and checklists as in Files.md. The top save status reports Saved only after host confirmation. Chat captures directly into Chat.md; the Agent button switches to a native Harness conversation and preserves the workspace on return. Ordinary recording does not call a model.

Conflicts and unknown save results retain input. Verify the file or explicitly save a separate copy; do not automatically resend. Leaving an unsaved page prompts a warning; refresh/crash recovery is not promised.

Existing dual-plugin instances do not automatically change configuration or migrate SQLite. Keep the independent task plugin and its original database. Only after explicitly choosing Markdown to manage those tasks should you follow the [optional import guide](README.md#existing-installations-and-sqlite-todos): stop services, back up, preview, then explicitly import. Removing the old entry is not the default recommendation. The old notes page can be selected with `interface: classic`.

For a persistent Linux service, see the [Linux guide (Chinese)](LINUX.zh-CN.md). Target devices, remote access, autostart, and NAS still require actual validation; examples do not install a service automatically.
