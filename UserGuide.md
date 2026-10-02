# User Guide

This guide explains the features this team added to opencode and how to try each one yourself. Each section below is written by whoever implemented that feature — add your own section rather than editing someone else's.

## Learning Recap (#5, #7–#11)

**What it does:** after opencode successfully finishes a task that changed files or ran tests, it appends one "Learning Recap" to the end of its final response, listing:

- **Files changed** — every file touched during the task, with its status (added/modified/deleted) and line counts.
- **Tests** — every test command that ran (`bun test`, `npm test`, `pytest`, `go test`, and similar), whether it passed, failed, or didn't finish, plus a short summary line.

Each recap covers all provider turns in the task, including work before instructions sent while opencode is busy. An empty category shows "No files were changed during this task." or "No tests were run during this task." Plain replies, read-only tasks, and tasks that end in an error, denied permission, or cancellation receive no recap.

### How to try it

1. Start this checkout with `bun dev` from `packages/opencode`.
2. Ask: _"Append `<!-- learning recap demo -->` to `packages/opencode/README.md` and run `bun test test/session/learning-recap-render.test.ts` from `packages/opencode`."_ Resolve the README path from the repository root. Tests must run from the package directory; this repository disables tests from its root.
3. Once it finishes, the final response ends with a `## Learning Recap` section showing the file you changed and the test run's pass/fail status.
4. Ask _"Explain your previous answer without using tools."_ Then ask _"List the repository files without making changes or running tests."_ Neither response should have a recap.

### Example output

```
## Learning Recap

### Files changed
- packages/opencode/README.md (modified, +1/-0)

### Tests
- bun test test/session/learning-recap-render.test.ts: passed (10 pass, 0 fail)
```

### Automated tests

- `packages/opencode/test/session/learning-recap.test.ts` — the shared `LearningRecap.Info` schema: accepts complete, partial, and empty recaps; rejects invalid test-result data.
- `packages/opencode/test/session/learning-recap-tests.test.ts` — detecting test commands (`bun test`, `npm test`, `pytest`, `go test`, compound commands like `cd x && bun test`) and turning a finished shell call into a passed/failed/not-run result with a summary.
- `packages/opencode/test/session/learning-recap-files.test.ts` — collecting and formatting the files changed during a task, including one-sided edits to existing files (an edit with only additions or only deletions, which line counts alone can't tell apart from a new/deleted file).
- `packages/opencode/test/session/learning-recap-render.test.ts` — building the full recap from a turn's tool-call parts and file diffs, and rendering it to the markdown shown above, including the "nothing to report" and "no tests ran" cases.
- `packages/opencode/test/session/prompt.test.ts` — real edits and failing/passing test runs across provider turns and busy steering; one recap on the final response; repeated loops and later read-only tasks; no recaps after provider errors, permission denials, or cancellation.

Run the recap checks from `packages/opencode`:

```sh
bun test test/session/learning-recap*.test.ts
bun test test/session/prompt.test.ts -t "learning recap"
```

## Shared learning recap schema — Dion (#7, PR #23)

The schema gives the team's file collector, decision explanation, test collector, and display one consistent data format. It does not generate explanations or run tests itself. `changedFiles`, `decisions`, and `tests` are optional when information is unavailable. Test results require a command and one of `passed`, `failed`, or `not-run`; a short summary is optional.

### Manual verification

From `packages/opencode`, validate a partial recap:

```sh
bun -e 'import { Schema } from "effect"; import { LearningRecap } from "./src/session/learning-recap"; console.log(Schema.decodeUnknownSync(LearningRecap.Info)({tests: [{command: "bun test", status: "passed"}]}))'
```

This prints the valid recap. Replace `passed` with `unknown` and repeat: validation must reject that status. The final recap instructions above demonstrate how teammates use this contract in the running application.

### Automated verification

`packages/opencode/test/session/learning-recap.test.ts` checks complete, empty, and partial recaps and rejects invalid statuses and missing commands. Run `bun test test/session/learning-recap.test.ts` from `packages/opencode`. These checks cover the schema's data contract; the collector, rendering, and multi-turn tests above cover its integration. The new companion story does not replace this original Sprint 1 contribution.

## Project learning companion — Dion (#29)

### Open and ask

Start this checkout with `bun dev` in `packages/opencode`, then open a coding session. For a demo with external plugins disabled, use `bun dev <project> --pure`; disable optional MCP servers in that project's configuration. Select **Learning companion** in the sidebar or enter `/learn`. At 80×24 a compact **Learn** indicator is available beside the coding input. The overlay fills the terminal with a one-cell outside margin. Its labelled header and **Chat / Notebook** tabs stay above the conversation; its three-row question input and action buttons stay below it. Page Up / Page Down scroll the conversation. Tab / Shift+Tab focus visible buttons or the input; Enter activates the focused button or submits the question. Shift+Enter adds a line. Escape or **Close** returns focus to coding.

Ask “What changed in the last task, and why?” while the coding agent works. The companion uses its own conversation and the coding session's model. Answers start short and refer to completed work. **You** and **Companion** blocks separate the conversation. **Sources · N** and **Notes used · N** start collapsed; select a source to reveal its preserved reference and details. Expanding these sections makes no model request. Current file reads are labelled separately from historical changes. Missing evidence is acknowledged. **Simpler** (ctrl+1), **Example** (ctrl+2), and **More** (ctrl+3) create follow-up answers using the original evidence. The fixed **Latest answer** bar acts on the latest completed answer and is disabled while it is thinking. Follow-ups display short labels such as “Simpler explanation,” keeping the full original question and explanation in the model context. The last ten exchanges appear initially; **Show earlier answers** reveals ten more, up to the existing 30-turn limit. An empty chat offers three starter questions that fill the input for you to edit before submitting. Old answers stay unchanged; **Newer changes available / Update** (ctrl+u) asks with fresh evidence.

A submitted question and a static **Thinking** state appear while an answer is being generated. **Cancel answer** (ctrl+k) stops the companion's answer. The header labels **Following, Thinking, Topic ready, Paused**, or **Error** alongside its colour; errors and delivery notices remain outside the scrolling conversation. Suggestions use a separate conversation so they do not delay questions. A meaningful edit, failed test, or finished task can produce one quiet learning question; topics are deduplicated and at least 60 seconds apart. Dismiss a topic or **Pause** (ctrl+p) suggestions. Questions remain available when paused.

### Notebook

Choose **Notebook** (ctrl+n). Entries show **Answer, Note**, or **Goal**, a date, and a selected state. At 100 or more usable columns, the list sits beside the selected detail; at narrower widths, the selected detail appears below its row. Only the selected entry's Markdown is rendered. **Save** (ctrl+s) keeps an answer and its evidence unchanged. Choose **Add note** (alt+n) or **Add goal** (alt+g), then press Enter or **Save**. “Saved to notebook” appears only after storage succeeds. Select entries with alt+↑ / alt+↓ and remove one with ctrl+d or **Remove**. Relevant saved notes are available in later answers and their influence is shown. Notes are stored privately in local OpenCode data, separate between unrelated projects. Reopening a coding session restores its companion chat; a new session starts a fresh chat with the project notebook available.

### Approve a coding improvement

When an answer proposes an improvement, choose **Send to coding agent** (ctrl+g). The dedicated preview shows the complete destination title and session ID. Edit the exact instruction in its scrollable editor. Choose **Approve and send**, or press Enter while the editor is focused, to approve. **Back** returns to your question draft without sending. Entering and leaving the preview preserves that draft. **Sending, Sent, Failed**, and **Uncertain** remain visible as appropriate. This sends an ordinary steering message immediately. A running tool finishes before the coding agent handles it at its next available turn. The main input draft, agent, model and settings are preserved. **Sent** appears only after the instruction is confirmed in that conversation. If delivery is uncertain, **Check delivery** checks for the same message; it does not automatically send another copy.

### Manual walkthrough

1. At 80×24, start a task that edits a small file and runs a focused test. Open `/learn` while coding is still active and ask about that change.
2. Scroll the answer, type a question, and close the overlay. Confirm the coding transcript and unsent coding draft were not changed by companion typing or scrolling.
3. Try **Simpler**, **Example**, **More**, **Save**, a note and a goal. Restart OpenCode and reopen the coding session: its chat and notebook should return. Open another project: the notebook should be separate.
4. Finish another meaningful task and wait for a proactive question. Confirm it stays in the card, does not open the overlay, and can be dismissed or paused. Chat should still work while paused.
5. Ask for one possible improvement. Inspect and edit its preview, approve it during active coding, and confirm one instruction appears in the correct coding conversation. Repeat near the transition to idle. Cancel a task: pending work must not unexpectedly restart.
6. Ask the companion to edit a file, run a command, or read outside the project. It should explain its limitation. Repeat the recap walkthrough above to verify integration.

### Automated verification

Run focused checks from their package directories:

```sh
# packages/tui
bun test test/learning-companion.test.ts test/learning-controller.test.ts test/learning-overlay.test.tsx test/learning-redesign.test.tsx test/cli/tui/dialog-layout.test.tsx test/cli/cmd/tui/notifications.test.ts --timeout 30000
bun typecheck

# packages/opencode
bun test test/session/learning-companion-tools.test.ts
bun test test/session/prompt.test.ts test/session/run-state.test.ts --timeout 30000
bun test test/session/learning-recap*.test.ts --timeout 30000
bun test test/server/httpapi-session.test.ts -t "round-trips HTTP output formats" --timeout 30000
bun typecheck
```

The TUI tests cover bounded completed evidence, valid references, quiet topic rules, locked atomic notebook saves, storage errors, continuity and delivery confirmation, and keyboard/scroll isolation at **80×24, 140×24, and 140×36**. Render tests cover long answers and instructions, collapsed/local source expansion, latest-answer actions, pending/disabled/cancel controls, paging, starter prefills, incremental history, light-theme errors, selected-only Notebook rendering and resize, ownership-safe button registration, clipped-button Tab navigation, exact approval, question/coding draft isolation, and session switching. Additive fullscreen dialog tests preserve older size geometry and Escape focus restoration. Legacy follow-up recognition and optional presentation metadata restore older conversations without a migration. Backend tests exercise the real trusted tool selection, canonical/symlink boundaries, admission restrictions and steering completion/cancellation races. A provider-input regression excludes old notebook injections while preserving chat history; an actual HTTP test verifies persisted structured-response formats. Recap tests retain the original feature coverage. CI and a teammate review are required before merging this feature.
