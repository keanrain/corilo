# Corilo source launcher

[简体中文](README.md) | **English**

```sh
npm run setup:corilo
npm run init:corilo -- --directory /absolute/corilo-instance
npm run start:corilo -- --directory /absolute/corilo-instance
```

New instances load the @corilo/dsh-notes 0.7.0 Files.md workspace and @corilo/dsh-todos 0.6.2 planner v2. Setup installs and builds both packages. Notes use Markdown and attachments, while tasks/calendar use a separate SQLite database; they do not synchronize automatically. The instance directory contains notes/, todos/, runtime/, workspace/, and two configuration files. Keep it outside the repository and never share its authentication token.

The canonical entry is launcher/corilo.mjs; scripts/corilo.mjs remains a compatibility forwarder. Existing single-plugin and v1 dual-plugin configurations retain their behavior. Preflight checks do not rewrite configuration, migrate databases, or delete original files. Planner requires a new, empty data directory and cannot directly use a v1 database. Optional SQLite → Markdown export is only for users explicitly choosing Markdown to manage old tasks; it is not the default upgrade path.

Linux user-service examples in deploy/systemd/ are templates for manual review, not automatically installed or enabled. `npm run test:startup` validates the default planner combination and existing configuration compatibility. Root `npm start/test` still belongs to the legacy application.
