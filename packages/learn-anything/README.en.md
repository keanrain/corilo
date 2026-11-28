# learn-anything

[简体中文](README.md) | **English**

Corilo-owned UI follows the DSH language setting (Chinese/English) without changing user content or drafts. Teaching materials, prompts, and answer protocols retain their original language.

A personal learning-tutor plugin for DeepSeek Harness (dsh), using the 渐构 (incremental construction) method for route planning, diagnosis, learning materials, verification in new situations, and spaced review.

This project lives at `packages/learn-anything/` in the [Corilo monorepo](../../README.md), distributed independently as `@corilo/learn-anything`, with versions maintained separately from notes/todos.

For source development, run `npm run setup:learn-anything` at the repository root. The package keeps its own dependency lock, separate from notes/todos. Then run `npm test`, `npm run build`, `npm run test:boot`, and evaluation commands from this directory, or root `npm run test:learn-anything`, `npm run build:learn-anything`, and `npm run pack:learn-anything`. The root pack command writes the `.tgz` to the repository root; `npm pack` here writes it to this directory. Release only this subproject, never the monorepo root package.

The original source, tests, prompts, skills, research, and market index were migrated together. `PROMPT.md` and `research/` retain design history. The market index is now at `packages/learn-anything/market/index.json`. The tutor runs as an independent DSH plugin; see the repository overview for other product status.

## Installation

Supports **existing DSH users only**. Requires Node.js ≥24.9, DSH `0.2.2-rc.5`, and pnpm for DSH plugin management.

Build a distribution package from the repository root:

```sh
npm run setup:learn-anything
npm run build:learn-anything
npm run pack:learn-anything
```

Install the resulting `.tgz` into an existing Web profile, replacing `web` with the profile you actually use:

```sh
dsh plugin --profile web add /absolute/path/corilo-learn-anything-0.1.1.tgz
```

Restart that DSH instance, create a session in an existing workspace, and select the Learning Tutor (学习导师) preset. Learning records live in `.learn/` under the session workspace.

The plugin adds teaching presets, tools, and UI only. It does not create a dedicated profile, switch workspaces automatically, or change the host's default preset, session-log, or plugin-inventory settings. Use normal DSH startup, model configuration, and plugin-update workflows.

The DSH plugin market index is in `market/index.json`. GitHub prereleases provide the `.tgz` archive used above. Standalone-launcher plans in `PROMPT.md` and `research/` are historical only.

## Interactive exercises

The host verifies formal results: `verification_record` obtains the displayed question and actual learner response from the session and calls an independent examiner internally. Answers or verdicts asserted by the tutor cannot increase mastery. The same response is recorded only once; missing evidence or failed grading writes nothing. Historical records remain, but old results without session/examiner provenance no longer count toward mastery and may need re-verification after upgrading. Saving the learner's own words also requires readable history and complete statements; help requests cannot stand in for a rule statement.

Route selection prioritizes `prerequisites` and rejects dependency cycles. Explicit skip/restore requests use `kp_skip`; skipping does not imply mastery. Difficulty 1 still requires a substantively new situation. Questions without examiner-confirmed novelty do not count as independent mastery.

Cards (route, target map, progress, and grading feedback) appear in reading order alongside text in the **final response**. The grading feedback card is the exception: it also shows on the `verification_record` tool row as soon as grading returns, so the learner does not wait for the next question; the final-response reference keeps it once the turn folds. The tutor places the display tool's `[title](learn-card:...)` reference unchanged on its own paragraph, with blank lines around it. References correspond to actual tool results from that turn, not copied card JSON or private tutor references. Questions and flip cards remain in the native right-hand Learning workspace, with an opening link in the response. The Learning workspace also keeps a learning overview: with no exercise it shows the goal and mastered progress, the current knowledge point and step, what is left before the next level, and today's due reviews with a one-click start; during an exercise it shows a one-line expandable summary above the card. It reads the existing stats projection, with no extra tool calls and no `.learn/` change. Drafts survive collapsing or asking for help; old exercises can be revisited. Narrow layouts use the native fullscreen presentation.

Diagnosis, explanation, and induction also favor cards for case judgments, comparisons, predictions, and ordering. `quiz_show(purpose="practice")` is a comprehension exercise; submission continues feedback and follow-up without writing verification records or raising mastery. Formal verification uses the default flow. Short checks and complete learner-written generalizations still happen in prose.

Verification questions default to interactive cards in the Learning workspace, choosing components for scenarios/Boss transfer tasks, impostor detection, matching/sorting, slider predictions, choices, rewriting bubbles, example workshops, reason fields, and the four formats below. The examiner also renders the question as an [OpenUI Lang](https://github.com/thesysdev/openui) program. The tutor validates and displays it with `quiz_show`; the learner answers in the card. The response is sent back using the unchanged `【作答】…` protocol and graded by the examiner. Cards contain no reference answer; failed rendering falls back to text.

### Four formats in the standalone Exercise

`questionType` is unchanged; these are additional answer formats. `src/quiz/examples.js` exports `PLAY_EXAMPLES`, four complete examples spanning programming and everyday contexts. Each `view` is a complete OpenUI Lang program independent of DSH, renderable by a host with the same component library. Card and text content agree and contain no reference answers.

| Format | What it tests | Learner action | Component | Question type |
|---|---|---|---|---|
| Counterexample | Concept boundaries | Select a case that disproves the claim and identify the missing condition | `Counterexample` | `discriminate-neg` |
| Minimal change | Input → output | Change one condition and explain, preserving all others | `MinimalChange` | `scenario` / `contrast` |
| Dual prediction | Effect of one variable | Make two predictions from the same choices and explain the difference | `DualPredict` | `predict` |
| Transfer task | A substantively unfamiliar situation | Write a practical plan and explain why the original rule applies | `TransferTask` | `transfer` |

Transfer tasks must specify the decision objective and actual constraints. Economic cases also specify revenue/cost conventions, such as whether breaking even is sufficient or subsidies apply. All four formats include reasoning already, so do not add another `Reason`. Reference answers, correct cases, missing conditions, and recommended changes stay private to the examiner, never inside the card. One correct choice does not establish mastery: it still requires consecutive, unhinted, non-guessed verification in new situations. Minimal change receives structural validation only, not automatic semantic grading.

The standalone `Exercise` in `src/client/exercise.js` distinguishes `status.readOnly` (the card cannot be edited/answered, e.g. archived/read-only display) from `status.canSend` (the current host/session can transmit, e.g. not sending or blocked by composer input). `canSend: false` does not disable editing; `readOnly: true` disallows submission even if `canSend` is true. Pass these separately, not as a single `disabled`. `status.sending: true` temporarily locks answers during actual sending; unconfirmed/failed `status.pending` alone does not lock editing.

Pure rules are in `src/quiz/program.js` (parsing, answerability validation, text fallback) and `src/quiz/play.js` (answer completeness/readable formatting). `src/client/exercise.js` exports controlled React `Exercise` and `QUIZ_CSS`. Callers provide `view`, `answers`, `onChange`, `confidence`, `onConfidenceChange`, `status`, and `onAction`. Actions are `submit`, `hint`, `help`, `easier`, `harder`, and `break`; submission carries `{title, answers: [{prompt, value}], confidence}`. After confirmed submission, pass `status.closed: 'answered'` and readable `status.answerText`. On failure retain answers and supply `status.error` / `status.pending`. DSH history, cache, and message sending are isolated in `src/client/quiz.js`; new formats do not require changes to course storage or mastery algorithms.

The help choices “I don't understand this term” / “I don't know where to start” emit `{type: 'help', kind: 'term' | 'approach', title}`. The tutor supplies one needed concept or starting example, then returns to the same question. Drafts remain, and asking for help is not graded. Additional explanation counts as assistance for that question without consuming the two-level hint sequence; later a fresh situation checks independent application. Typed requests to explain unfamiliar concepts or start from basics can also trigger explanation.

While the host has accepted a response for the same question but it remains queued, the card blocks duplicate submission while keeping the draft editable. Cancelling the queued message allows resubmission. Answer state follows actual session messages. Review reminders use DSH's native task management: pausing or deleting one prevents the next answer from automatically recreating it; only an explicit request to set a reminder time restores or creates it. If final streamed-card validation fails, the preview is hidden while the tool error and text fallback remain; the conversation view is not rebuilt.

Questions distinguishing execution from waiting can explicitly call `quiz_show({ui, question, helpDemo: 'execution-waiting'})`. This adds a hands-on help entry. The first use confirms the assistance request before displaying the demo. Returning to the question preserves answers; old questions without this field remain unchanged.

`TaskDemo({config, disabled, onAction})` in `src/client/task-demo.js` depends only on React. It accepts scene text and emits `mode / place / inspect / reset / return` events; it sends no messages, saves no records, and does not grade. Its two execution slots and waiting area illustrate only “running / not yet started.” Expansion, rejection, and handoff follow the actual question. Standalone use injects `TASK_DEMO_CSS`. When mounted in `Exercise`, pass `helpDemo: TASK_DEMO_SCENE`; after confirming assistance, the caller sets `status.demoReady: true`, and actions arrive as `{type:'demo', title, event}`.

Verification is a continuous practice sequence based on flow theory:

- **Difficulty follows ability:** each model has levels 1–5. Two consecutive unhinted correct responses move up a level; an incorrect answer moves down; otherwise the level stays. This two-up/one-down staircase tends toward roughly 70% accuracy. The tutor passes level requirements to the examiner, and the card title shows difficulty dots.
- **Immediate, informative feedback:** the grading card appears as soon as grading returns, while the tutor has the examiner pre-generate the next question in parallel (discarded after a wrong answer or a difficulty change); it shows correctness, confidence calibration, a difficulty × my-level plot, whether the question was just right/too hard/too easy, the next difficulty and reason, and requirements for the next mastery level. Wrong answers show whether the rule, the examples or the basics broke. The interface uses everyday wording ("My understanding", "Fails when reworded", "Difficulty N/5"); methodology terms stay in the tutor prompts. Private examiner guidance to the tutor is not shown to the learner.
- **Continuity:** correct or partially correct answers remain in verification and the tutor presents the next question in the same turn. A wrong answer lowers the difficulty and breaks the streak but stays in verification: the tutor uses one counterexample or follow-up, then continues. Only two consecutive wrong answers with the same attribution (including none), a confident ("sure") wrong answer, or a wrong answer outside a verification run return to diagnosis. The mastery gate is unchanged.
- **Control:** learners select confidence (sure/somewhat sure/guessing; lucky guesses do not advance mastery), request two prewritten directional hints, ask for an easier/harder question, or take a break.

Learners can also request:

- **The four formats:** counterexample, minimal change, dual prediction, or transfer task, as listed above.
- **Flip cards:** information knowledge points ask for recall confidence before revealing a fact answer. “Practice again” schedules a later reappearance. Self-assessment alone does not raise mastery; formal recall is verified separately.
- **Spot and repair:** identify a problematic line and write a correction, useful for misconceptions and code defects.
- **Step ordering:** select shuffled steps in sequence, with undo/reordering, to reason through execution.
- **Mistake rematches:** choose a weakness from still-relevant mistakes, generate a new situation for the same learning objective, and compare both responses in feedback. Correct rematches stop recommending the corresponding old question.

Spot/repair and ordering reuse submission, retry, history restoration, and source citations. Cards contain only the question; the examiner independently determines correctness. Flip cards reveal known fact answers for self-testing and remain separate from formal verification.

The composer status chip shows the learning streak 🔥. Evaluations report rendering success, answer leakage, the fraction of verifications with recorded difficulty, and the fraction of responses in the flow zone (`quizParseRate`, `quizLeaks`, `difficultyRecordedRate`, `flowZoneShare`). Disable interactive cards by setting `interactiveQuiz: false` for `@corilo/learn-anything/tools` in the tutor preset.

## Editable notes and route

Target-map cards support direct editing of learner statements, personal examples and annotations through DSH's authenticated connection. Chat duplication is unnecessary. Failed saves and version conflicts retain drafts. Personal edits cannot assign verified-example tags or change grades/mastery; formal verification records remain historical evidence.

Planning outlines support direct add/edit/delete, skipping, drag ordering and confirmation to active. The host checks revisions, structure and prerequisites; skipping does not grant mastery.

Concept-confusion diagnoses require extension relations, a feature matrix and contrast examples, displayed as a comparison card. Failed knowledge reviews can return previously correct, evidence-backed examples as practice/variant references; old examples do not establish novel generalization.

Examiner context focuses on the current knowledge point/model while global exact replay checks remain. Relevant history exceeding the budget prevents independent novelty credit. History explicitly scoped to other knowledge points is excluded from examiner semantic-similarity assessment. This reduces payload size but still scans session evidence.

`quiz_show.helpDemo` accepts validated variable/state/transition configurations alongside the compatible `execution-waiting` preset. It executes no arbitrary scripts. Demos count as assistance, preserve the original answer draft and never grant mastery.

## Material retrieval and citations

Local repository ingestion extracts directories, documentation and line-linked JS/TS, Python, Rust and Go declaration summaries. This bounded heuristic is not full semantic analysis. Credential-free HTTPS Git URLs support default-branch shallow snapshots with actual commit provenance; no recursive submodules or repository-code execution. Downloads have a 60-second timeout and a monitored 64 MiB limit (polling can briefly overshoot). Branch/subdirectory selection is not implemented.

`material_search` segments Chinese and mixed-language queries with `Intl.Segmenter`, filters stop words, and ranks titles and body text with BM25. The tutor reads real chunks before citing their IDs; `checker` verifies key claims against the source, and question generation/grading retain those sources.

Target maps show references and example sources, and grading cards show evidence. Card submissions carry material citations; evidence links are not exposed before answering. Saving citations verifies chunk existence, while `checker` / `examiner` decide whether the content supports a claim. Teaching also works without imported materials.

Reimporting the same path reuses material IDs for identical content. Changed content receives a new ID while old chunks remain, preserving existing citations. Material lists and default searches show only the latest imported content for that path.

## Learner storage and migration

A new empty workspace creates `.learn/learner.sqlite` on its first learner-record write, using built-in `node:sqlite` on Node ≥24.9.0 without a native compilation dependency. The database stores courses, knowledge points and target maps, verifications, diagnoses, review schedules and reminder bindings. Original materials, blocks and citation metadata remain under `.learn/materials/`. SQLite does not replace DSH's own sessions, credentials or scheduled-task storage. The storage API still loads a consistent learner-state snapshot into memory, and business logic still scans historical verifications and diagnoses in that snapshot. SQL has target indexes and a duplicate-answer constraint, but reads have not been converted to an indexed-query API. Cross-course analytics and FTS5 retrieval are not added; Chinese BM25 still runs in memory.

Existing JSON/JSONL learner records retain the legacy backend without startup migration. After explicit migration, SQLite is authoritative: preserved source files stop receiving learner updates and are not synchronized with the database. `.learn/.backend.json` durably selects SQLite and its database instance. Missing, mismatched, corrupt or incompatible databases fail closed instead of falling back to old files or upgrading their schema automatically.

In SQLite mode, learner records, mastery and review schedules changed by one tool/UI operation commit in one transaction. Changes are staged while asynchronous grading runs; commit checks the database revision without holding a write lock during model requests. Concurrent changes reject the commit without automatically rerunning the examiner or overwriting newer data. The legacy JSON/JSONL backend retains its single-host workspace queue and per-file atomic replacement; it does not gain SQLite's multi-record transaction guarantees.

DSH external reminder creation runs after the learner transaction commits. The reminder service and learner database are not a distributed transaction: reminder failure does not undo committed grades, and a saved grade does not establish reminder delivery.

### Explicit migration

**Stop every DSH service using the workspace and back up the complete workspace and any DSH data you need first.** Run these commands from the tutor package directory. After installing through DSH, run the equivalent `pnpm exec corilo-learn-store` from the installation profile directory.

```sh
# Preview: read legacy records and report counts and consistency summaries.
npm run store -- migrate --workspace /absolute/learning-workspace
# Explicit apply: preserve source records, validate a staged database, then publish it.
npm run store -- migrate --workspace /absolute/learning-workspace --apply
```

Migration includes only courses, knowledge points, verifications, diagnoses, reviews and reminder bindings. Original JSON/JSONL files remain byte-identical. Backups live under `.learn/migrations/<timestamp-random-id>/legacy/`; sibling `manifest.json` records file SHA-256 values, record counts and a snapshot digest, and `receipt.json` records completed publication. Materials remain in place and are excluded from this learner-only backup. Database integrity and import/export equivalence are checked before publication; an existing database is never overwritten.

### Export, first-initialization and migration recovery

`recover --apply` takes an exclusive cross-process lease and revalidates state under it; another running recovery causes rejection. Process exit or termination releases the lease, allowing a retry. `.learn/.recovery-lock.sqlite` is a persistent empty coordinator with no learner records; never delete or replace it while recovery runs. Preview does not create it.

```sh
# Export current SQLite learner records to a new separate directory.
npm run store -- export --workspace /absolute/learning-workspace --output /absolute/new-export
# Preview interrupted first initialization or migration, then explicitly recover it.
npm run store -- recover --workspace /absolute/learning-workspace
npm run store -- recover --workspace /absolute/learning-workspace --apply
```

The export contains a `.learn/` JSON/JSONL tree and a root `learner-export.json` manifest, without material files. The default `recover` command is a read-only preview and distinguishes first initialization from legacy migration by its marker:

- First initialization uses `.learn/.initialization.json`. After the initializer stops, `--apply` requires a matching manifest and snapshot digest: it publishes a complete pending database, or accepts the published database and removes its owned staging alias. If neither database nor candidate exists, it only releases the marker. A pending first initialization is not discarded as an aborted migration. If legacy learner records have since appeared or been restored, preview and apply both refuse to proceed, preserving all states for inspection rather than shadowing newer data.
- Legacy migration uses `.learn/.migration.lock`. For an unpublished migration, `--apply` aborts the import and releases its lock while archiving the staged database and its sidecars. A published database is accepted only when integrity, imported snapshot digest and original JSON/JSONL file digests all match.

A live process, overlapping markers, unknown file aliases or changed database/source files block automatic recovery. Preserve the artifacts for manual inspection.

Stop related services before export, recovery and restore too. Do not delete the database as a rollback: post-migration learning is not written back to legacy JSON/JSONL. To retain current records, export first and verify a restore in a separate workspace; preserve original `.learn/materials/` separately for citations. Restoring the pre-migration backup requires retaining the current database first and explicitly accepting that newer changes are absent from the old snapshot.

Exports and migration backups are not whole-instance backups: they exclude original materials, DSH sessions, credentials and external reminder tasks. Normal commits use WAL. The store validates the database and its `-wal`/`-shm`/`-journal` sidecars, rejecting links and special files; those checks do not make arbitrary copying or deleting of journals safe. Back up the database and `.backend.json` together after all services using them have stopped, preserving any remaining sidecars. Do not copy only the main file of a live database.

## Development

`src/client/index.js` (Web client) and `src/vendor/openui-lang-core.js` (host OpenUI parser) are generated by `npm run build` and committed. Users need not build or install OpenUI packages. Rebuild after modifying `src/client/` or `src/quiz/`; `npm test` checks generated files are current.

- `npm test`: tool, material, card-state, and package regression checks.
- `npm run test:boot`: real DSH composition in an isolated profile with a mock model; one-second tasks also check native scheduled delivery, paused non-delivery, and a single receipt.
- `npm run eval:mock -- --only materials --until verified`: three material scenarios check citations across question generation, answers, and grading. Scenario errors, answer substitution/leakage, invalid stored citations, or broken provenance fail with a nonzero exit. Mock checks the pipeline; real-model semantic judgment needs separate evaluation.
- `npm run eval:mock -- --quality`: offline checks for eight fixed question-quality cases and failure decisions. `npm run eval -- --quality` uses `DEEPSEEK_API_KEY` with a real examiner; add `--anthropic` to reuse a gateway or `--only alternative-solution` for one case. Cases cover missing card conditions, unjustified deadline deductions, missing text choices, valid alternatives, equivalent wording, correct choices with wrong reasons, over-attributed feedback, and ordinary correct answers. Wrong verdicts, ungrounded attribution, known over-attribution, API failures, and truncation all return nonzero. Reports separate quality failures from request errors and retain actual prompts/replies. These cases target known defects, not every newly generated question; mock passes do not establish real-model correctness.
- `npm run eval -- --only repair --until verified --no-judge --keep`: injects a question card missing a rule into a temporary course, then uses the real tutor, examiner, and tools to verify deferred grading after a challenge, question repair, resubmission, and exactly one recorded result. Any verification/mastery/review change before resubmission fails. Explicit-only, no mock; checks host/persistence, not browser draft retention.
- `npm run eval -- --only learning-loop --until verified --no-judge --keep`: sends one fixed help request after a temporary course's first real card; remaining questions, responses, and grading use live models. Checks that explanation preserves the original question, assisted answers do not count toward independent mastery, and only a new unassisted correct answer adds a consecutive success. Failure is nonzero. Explicit-only, no mock.
- `npm run eval -- --only prerequisite-recovery --no-judge --keep`: reproduces a request for foundational help in an isolated camera course, then confirms learning the basics first. The real tutor runs two turns; automatic checks require reordered prerequisites, preserved statements/mastery, and no continued question generation/grading during the help request. Also read `recovery.replies` manually to ensure the tutor actually starts teaching basics rather than just promising changes. No mock. Add `--local-auth` to use existing local API credentials through DSH's credential service; course/session remain temporary. Both learner turns and selection confirmation use fixed text, without an extra learner model. This mode supports this scenario with `--no-judge`, and cannot combine with `--anthropic`.
- `npm run eval -- --local-auth --only trust --until verified --turns 3 --no-judge --keep`: uses DSH's stored credentials with an isolated course, real tutor questions, fixed learner responses, and independent host grading. Checks stored verbatim text exactly matches session messages with examiner provenance. `--local-auth` supports this scenario too. One sample verifies the provenance chain, not general examiner accuracy.
- `npm run test:browser`: `http://127.0.0.1:3092/playground` runs the four standalone Exercise formats with structured events and read-only, streaming-lock, and failure-retry checks. `http://127.0.0.1:3092/` retains plugin-adapter regression checks for drafts, history restoration, and new questions closing old ones. Uses isolated data without models or learning-record changes; `Ctrl-C` removes the temporary build.
- `http://127.0.0.1:3092/demo`: runs the standalone execution/waiting demo, exposing both states, area explanations, and action events. The root regression page also checks help requests, assistance counting, and return to the original question.

Evaluation reports include time to the first question, submission-to-feedback latency, same-turn feedback-to-next-question latency (`nextQuizMs`), and tutor model steps for generating/grading each question. Next-question latency excludes learner thinking and later turns, and is null when the final question has no successor. Timing follows host events, not completed browser painting; subagent costs are counted separately.

`performance.models` and `performance.tools` correlate tutor/subagent timings by session, turn, step, and call ID. Model entries show step-to-response, first-token wait, and decoding time; tool entries show call-to-return time. Missing evidence is null. Retry waits are excluded from decoding, while step duration includes request preparation and is not pure API latency. Use DSH Developer Tools → Statistics to distinguish tutor preparation, examiner generation, and tool execution delays.

The examiner keeps reasoning enabled, using `low` effort for ordinary generation/grading. Ordering, multistep calculation, and other complex tasks can request `examiner.reasoningEffort: "high"`. Model selection and tutor/checker settings retain existing configuration; material and card validation retain their flow.

To measure examiner question latency independently, set `DEEPSEEK_API_KEY` and run `node eval/question-latency.mjs --case order --runs 3` (or `--case spot`). Default effort matches the examiner; compare with `--reasoning high`. It uses current examiner prompts/components without reading or writing learning records; reports go to `eval/results/`. For comparison with an old version, use `--system-file` pointing to a saved complete system prompt. Automated checks cover output completeness and card syntax only; humans must verify conditions, reference answers, and unique order. Timing excludes tutor preparation/card display. `--self-check` validates the evaluation script offline.

Within one host process, learning-data writes for the same workspace are queued. Changing an already-answered model definition requires a new ID. Information knowledge points track mastery per memory card; every card must meet the threshold before the entire knowledge point is mastered.

Run focused browser regressions with `python3 test/browser/target_editor_browser.py`, `outline_browser.py`, `demo_browser.py` and `locale_browser.py` (all under `test/browser/`). Native API coverage uses `python3 test/browser/target_api_browser.py` with the pinned DSH installed; `LEARN_ANYTHING_DSH` can specify its `lib/bin.js`. The native API test creates synthetic sessions without model calls.

Full-flow regression: `python3 test/browser/tutor_flow_browser.py`, with the same runtime requirements as the native API test. A local deterministic mock model exercises the real UI, question/grading tools, evidence, default proficiency gate and due review. Review time advances only in a disposable fixture; this does not establish live-model teaching quality.
