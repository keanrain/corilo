# External-brain trial: daily rhythm setup (step 2)

[中文](README.md)

This guide uses the Corilo source launcher with Notes 0.10.1 or later and the built-in DSH tools. Restart the instance with the usual command, for example `npm run start:corilo -- --directory <instance>`. The notes directory appears in the DSH workspace list. Replace `<instance>` in the commands with the launcher's instance directory.

## 1. Add the steward rules

Review and edit [`plugins/notes/templates/AGENTS.en.md`](../../plugins/notes/templates/AGENTS.en.md) (or the Chinese `AGENTS.md`), then copy it to `<instance>/notes/AGENTS.md`. DSH loads it for sessions in that workspace. To change the Agent's behaviour later, edit that file in your notes.

## 2. Install the wiki skill

```bash
git clone https://github.com/Astro-Han/karpathy-llm-wiki "<instance>/runtime/harness/skills/karpathy-llm-wiki"
git -C "<instance>/runtime/harness/skills/karpathy-llm-wiki" checkout --detach eafcc77001e496cc43499e4923b663aec722c813
```

The launcher sets `DSH_HOME` to `<instance>/runtime/harness`; DSH scans its `skills/` without a restart. The checkout pins an MIT-licensed revision. Review its `SKILL.md` before using or upgrading the skill. It uses `raw/` (source copies, add-only) and `wiki/` in the notes root.

## 3. Create two scheduled tasks

In the DSH web page, select the notes workspace, start a new session and send the Agent the text below. **Replace the timezone with your own IANA zone first.** With target `new`, every delivery creates a session that inherits this session's working directory and preset, so create the tasks from the notes workspace.

```text
Use schedule_create to create two scheduled tasks, both with target new, timezone Asia/Shanghai:

1. Title "Morning brief", daily at 08:00. Prompt:
Morning brief. Follow the daily rhythm in AGENTS.md: read the last 3 days of the journal, today's events and tasks, overdue tasks and the inbox count, and give me a brief I can read in one minute. This conversation is today's main conversation.

2. Title "Evening review", daily at 21:30. Prompt:
Evening review. Follow AGENTS.md: read today's journal, today's events and tasks and the inbox, and use session search on today's main conversation if needed; then walk me through what is done, which day unfinished items move to, what to do with each inbox item, and what I learned today. Wait for my confirmation before each write, then write the day's record to the journal.

Afterwards, list them with schedule_list so I can check.
```

The "Automations" page works too; make sure the target creates a new session each time and the working directory is the notes root.

## 4. Daily use

- Daytime: talk and drop links in that day's "Morning brief" session. Let it hand heavy work, such as long articles, to subagents.
- Evening: open the "Evening review" session and go through it.
- Phone: open the DSH web page in a browser.

## 5. After one to two weeks, check three things

1. Did you open it every day?
2. Did you still have to re-explain context?
3. Did you miss any reminder?

Decide the next step from that: a Ticket plugin, a file watcher, code repositories and phone push all wait until then.

## Known limits

- The host must be running at delivery time; after a restart a recurring task delivers only the most recent missed occurrence.
- Web reminders only appear while the page is open.
- `AGENTS.md` guides the Agent’s writes. DSH has no per-subdirectory write permissions. Notes tools check versions when saving existing notes.
