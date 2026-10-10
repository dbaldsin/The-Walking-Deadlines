# User Guide

This guide explains the features this team added to opencode and how to try each one yourself. Each section below is written by whoever implemented that feature — add your own section rather than editing someone else's.

## Learning Recap — Sangyoon (#9, #11, #35, #36)

After opencode finishes a task that changed files or ran tests, it adds a **Learning Recap** to the end of its final response. The recap shows what changed and how the tests went, so a student can review the task without scrolling back through the conversation.

| Issue | PR | What I added |
| --- | --- | --- |
| #9 Record test commands and results | [#24](https://github.com/dbaldsin/The-Walking-Deadlines/pull/24) | Recognizes test commands and records each run as passed, failed, or not-run, with a summary |
| #11 Display learning recap in final response | [#28](https://github.com/dbaldsin/The-Walking-Deadlines/pull/28) | Builds the recap from the task's changes and test runs and appends it to the final response |
| #36 Detect more test runners | [#37](https://github.com/dbaldsin/The-Walking-Deadlines/pull/37) | Recognizes test runners from other languages, wrapped commands, and build tools |
| #35 Show failing test names | [#38](https://github.com/dbaldsin/The-Walking-Deadlines/pull/38) | Lists the names of the failing tests under a failed run |

The recap also uses Dion's schema (#7, see [below](#shared-learning-recap-schema--dion-7-pr-23)) and Saif's changed-files collector (#8, see [Changed Files in the Learning Recap](#changed-files-in-the-learning-recap-8)).

### What the recap shows

- **Files changed:** every file the task added, modified, or deleted, with line counts.
- **Tests:** every test command that ran, whether it passed, failed, or didn't finish, a short summary, and, for failed runs, the names of the failing tests.

If a category is empty, it says so ("No files were changed during this task." / "No tests were run during this task."). A recap covers the whole task, including work done before a message you sent while opencode was busy.

**When there is no recap:** plain replies, read-only tasks, and tasks that end in an error, a denied permission, or a cancellation.

```
## Learning Recap

### Files changed
- packages/opencode/README.md (modified, +1/-0)

### Tests
- bun test test/session/learning-recap-render.test.ts: passed (11 pass, 0 fail)
```

### How to try it

1. From `packages/opencode`, start this checkout with `bun dev`.
2. Ask: _"Append `<!-- learning recap demo -->` to `packages/opencode/README.md`, then run `bun test test/session/learning-recap-render.test.ts` from `packages/opencode`."_ (Tests must run from the package directory; this repository disables tests from its root.)
3. The final response ends with a **Learning Recap** listing the README change and the passing test run.
4. Ask _"Explain your previous answer without using tools."_, then _"List the repository files without making changes or running tests."_ Neither response should have a recap.
5. Revert the README change when you're done.

### Supported test runners (#36)

The Tests section recognizes test runs in many languages, not just JavaScript:

| Ecosystem | Recognized commands |
| --- | --- |
| JavaScript / TypeScript | `bun test`, `npm test` / `npm t`, `pnpm test`, `yarn test`, `jest`, `vitest`, `mocha`, `playwright test`, `deno test`, `node --test` |
| Python | `pytest`, `python -m pytest`, `python -m unittest`, `tox` |
| Go / Rust / Swift / C++ | `go test`, `cargo test`, `cargo nextest run`, `swift test`, `ctest` |
| Java / Kotlin / .NET | `mvn test`, `./mvnw test`, `gradle test`, `./gradlew test`, `dotnet test` |
| Ruby / PHP | `rspec`, `rails test`, `phpunit`, `php artisan test` |
| Other | `make test`, `make check` |

**Also recognized:**

- **Other tasks first:** `mvn clean test`, `./gradlew clean test`, `gradle :app:test`
- **Wrappers:** `npx`, `bunx`, `yarn`, `pnpm exec` / `dlx`, `yarn dlx`, `uv run`, `poetry run`, `pipenv run`, `bundle exec`, `timeout <seconds>`. For example, `uv run pytest -q` and `npx --yes jest`.
- **After a directory change or environment variables:** `cd packages/app && bun test`, `CI=1 npm test`

**Not counted as test runs:**

- `cargo build`, `mvn clean package`, `node script.js --test`, `echo pytest`, `git commit -m "bun test"`
- Gradle commands that skip tests with `-x test` or `--exclude-task test`, even if `test` is also requested (for example `gradle test -x test`)

For Maven/JUnit and dotnet, the summary uses the runner's totals line, for example `Tests run: 3, Failures: 1, Errors: 0, Skipped: 0`.

**How to try it:** in a project that uses one of these runners, ask opencode to run its tests through a wrapper, for example _"Run `uv run pytest -q`"_ or _"Run `./gradlew clean test`"_. The recap lists the command under **Tests** with its status. Then ask _"Add a comment to one file and run `cargo build`"_. The recap lists the edited file, and its Tests section says "No tests were run during this task."

### Failing test names (#35)

When a test run fails, the recap lists the names of the tests that failed underneath it, so you can see what broke without searching the shell output:

```
### Tests
- bun test ./test/demo.test.ts: failed (1 pass, 2 fail)
  - math > adds
  - top level fails
```

Names are read from the failure lines each runner prints:

| Runner | Failure line it reads | Name shown |
| --- | --- | --- |
| `bun test` | `(fail) math > adds [0.12ms]` | `math > adds` |
| jest | `● math › adds` | `math › adds` |
| vitest | `FAIL  src/math.test.ts > math > adds` | `src/math.test.ts > math > adds` |
| pytest | `FAILED tests/test_math.py::test_adds - assert 2 == 3` | `tests/test_math.py::test_adds` |
| `go test` | `--- FAIL: TestAdds (0.00s)` | `TestAdds` |
| `cargo test` | `test tests::adds ... FAILED` (or `tests::adds --- FAILED` with `-q`) | `tests::adds` |

- If jest or vitest print only per-test marks (`✕ adds (5 ms)` / `× adds 3ms`), those are used instead.
- Each failing test is listed once, even if the runner prints it twice.
- At most five names are shown; the rest are summarized as "…and N more".
- Passed and not-run results never list names.
- If no names can be found (for example from `make test`), the entry shows only the summary line.

**How to try it:**

1. Create `packages/opencode/test/demo.test.ts`:
   ```ts
   import { describe, expect, test } from "bun:test"

   describe("math", () => {
     test("adds", () => expect(1 + 1).toBe(3))
     test("ok", () => expect(1).toBe(1))
   })
   test("top level fails", () => expect(true).toBe(false))
   ```
2. In a new opencode session, ask: _"In packages/opencode, run `bun test ./test/demo.test.ts`. Don't create or change any files."_ Keep the `./`. Without it, Bun treats the path as a name filter and finds no tests.
3. The recap shows `failed (1 pass, 2 fail)` with `math > adds` and `top level fails` listed underneath.
4. Delete `demo.test.ts` when you're done.

### Automated tests

All of these run from `packages/opencode`:

```sh
bun test test/session/learning-recap*.test.ts
bun test test/session/prompt.test.ts -t "learning recap"
```

| Test file | What it covers |
| --- | --- |
| `test/session/learning-recap-tests.test.ts` | **#9, #35, #36.** Test-command detection for every runner, wrapper, and build-tool form above, plus commands that must not count (including the Gradle exclusions). Passed/failed/not-run status, summaries (including Maven/dotnet totals), truncation, and the "no tests" message. Failing-name parsing using real bun and cargo output plus jest, vitest, pytest, and go output, with de-duplication, the five-name limit, the fallbacks, and schema validity. |
| `test/session/learning-recap-render.test.ts` | **#11, #35.** Building the recap from a task's tool calls and file changes, rendering the markdown (including the empty cases and nested failing names), and returning nothing when the task did nothing. |
| `test/session/prompt.test.ts` (`learning recap`) | **#11, end to end.** Real edits and passing/failing test runs across several provider turns and busy steering. Exactly one recap on the final response; none after provider errors, permission denials, or cancellation, or on later read-only tasks. |
| `test/session/learning-recap.test.ts` | The shared schema (Dion, #7). The optional failing-names field added for #35 is checked against it in `learning-recap-tests.test.ts`. |

### Why these tests are enough

- **Every acceptance criterion has a test.** For #9, #11, #35, and #36, each criterion maps to a named test case. [#37](https://github.com/dbaldsin/The-Walking-Deadlines/pull/37) and [#38](https://github.com/dbaldsin/The-Walking-Deadlines/pull/38) list the mapping as a table; [#24](https://github.com/dbaldsin/The-Walking-Deadlines/pull/24) and [#28](https://github.com/dbaldsin/The-Walking-Deadlines/pull/28) describe what each test covers.
- **Detection and parsing only look at text.** Whether a command is a test run depends only on the command, and failing names depend only on the output. So testing many real command and output examples directly is reliable, and no real toolchain needs to be installed in CI.
- **The full path is tested with real tasks.** `prompt.test.ts` runs whole tasks with real file edits and test commands, so the wiring from tool calls to the final response is covered, not just the helpers.
- **Negative cases are tested as carefully as positive ones.** Commands that only mention tests, skipped Gradle tests, and tasks that shouldn't get a recap all have their own tests. The Gradle case came from teammate review on #37 and is now a regression test.
- **Checked in the real app.** The walkthroughs above were run in `bun dev` and match the automated expectations. PR #38 has a screenshot.

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

Automatic topic suggestions are **off by default**. **Options → Enable topic suggestions** explicitly enables background requests on the coding session's model; these may incur model usage/cost. The choice is saved per coding session across restarts. **Disable topic suggestions** stops scheduled and active topic requests; interactive chat remains available.

### Open and ask

Start this checkout with `bun dev` in `packages/opencode`, then open a coding session. For a demo with external plugins disabled, use `bun dev <project> --pure`; disable optional MCP servers in that project's configuration. Select **Learning companion** in the sidebar or enter `/learn`. At 80×24 a compact **Learn** indicator is available beside the coding input.

**Shift+Tab keeps ordinary coding-agent navigation by default.** To include Learn, explicitly select **Options → Include Learn in Shift+Tab**. This saved local preference enables **Build → Plan → Learn → Build** with the default agents. From Learn's Chat question input, enabled Shift+Tab returns to the first coding agent and preserves the split pane/drafts. Otherwise Shift+Tab moves to the previous visible companion control. `/learn` and the sidebar are always available. Tab moves forward; Enter activates a button or submits the question; Shift+Enter adds a line.

At terminal widths of **128 columns or more**, Learn opens in **split view**: the live coding conversation stays on the left and the companion opens on the right. Open **Options → Fullscreen / Split view**, or press **Alt+W**, to switch. Narrower terminals use fullscreen with a one-cell outside margin. Resizing adapts the layout and preserves both drafts. The **Chat / Notebook** tabs stay above the conversation; the three-row question input and action buttons stay below it. Page Up / Page Down scroll the conversation.

Opening Learn keeps coding active. **Options** contains the **Coding** status: **Working, Idle, Retrying, Waiting for permission, Waiting for your answer**, or **Status unavailable**. A permission or question can make coding wait for your response. In split view, **Options → Focus coding** or clicking the coding pane transfers keyboard control while keeping Learn and its draft visible. Scrolling coding also leaves the panel open. Click the companion input or use `/learn` to resume learning chat. The header uses a filled dot when Learn owns keyboard focus and an outline dot when coding owns it. **Close** dismisses the panel; Escape dismisses an open menu first, then closes Learn. Clicking coding dismisses menus and preserves Learn and both drafts. In fullscreen, **Options → Return to coding** closes Learn. **Options → Shortcut help** lists the keyboard controls. Companion typing remains separate from the coding draft.

Ask “What changed in the last task, and why?” while the coding agent works. The companion uses its own conversation and the coding session's model. New answers start with **The idea**, followed by two or three short labelled points such as **What changed**, **Why it matters**, and **Verified**. They default to three to five short sentences; labels adapt to the question. **You** and **Companion**, spacing and a subtle divider separate exchanges. Explanations wrap within roughly 72 columns. Stored answers keep their original wording. Proposed coding instructions appear in a distinct **Suggested improvement** section labelled **Needs your approval**. **Sources · N** and **Notes used · N** start collapsed; select a source to reveal its preserved reference and details. Expanding these sections makes no model request. Current file reads are labelled separately from historical changes. Missing evidence is acknowledged.

**Simpler** (ctrl+1) and **Example** (ctrl+2) remain visible. **Actions** contains **Go deeper** (ctrl+3), **Save to notebook** (ctrl+s), and **Update explanation** (ctrl+u) when newer coding changes exist. This fixed row operates on the latest completed answer and is disabled while it is thinking. Follow-ups use the original evidence and display short labels such as “Simpler explanation,” keeping the full original question and explanation in the model context. Example and Go deeper can include code or longer detail. The last ten exchanges appear initially; **Show earlier answers** reveals ten more, up to the existing 30-turn limit. An empty chat offers three starter questions that fill the input for you to edit before submitting. **Newer changes available** points you to **Actions → Update**, which asks with fresh evidence.

A submitted question and a static **Thinking** state appear while an answer is being generated. The input's **Ask** button becomes **Cancel** while answering; selecting it or pressing ctrl+k stops only the companion. Enter in the question input leaves a running answer and the next question draft untouched. The header labels **Following, Thinking, Topic ready, Paused**, or **Error** alongside its colour; errors and delivery notices remain outside the scrolling conversation. Automatic suggestions use a separate conversation so they do not delay questions. A meaningful edit, failed test, or finished task can produce one quiet question in a separated **Learning topic** section; topics are deduplicated and at least 60 seconds apart. **Explore topic** fills the question input for you to edit and submit. Dismiss a topic or choose **Options → Disable topic suggestions** (ctrl+p); **Resume topics** turns them back on. Pausing topics keeps chat and coding available.

### Layout examples

These images come from the actual TUI test renderer with controlled calculator data. They are layout examples, not a live VS Code walkthrough.

![Minimal Chat at 80×24](docs/images/learning-minimal-chat.png)

![Split view at 140×24](docs/images/learning-minimal-split.png)

![Notebook at 140×36](docs/images/learning-minimal-notebook.png)

### Notebook

Choose **Notebook** (ctrl+n) to open the **Project notebook** command center. **All / Answers / Notes / Goals** filters show entry counts and an obvious selected filter. Each entry is one selectable row with a short title, saved date and a distinct theme-coloured dot labelled **Answer**, **Note** or **Goal**. The selected row stays highlighted. Use alt+↑ / alt+↓ to move through the filtered entries.

Layout follows the **companion pane's width**: at 100 or more usable columns, the list sits beside the selected detail; otherwise, the selected Markdown appears directly below its row. Split view uses the narrower layout, even on a wide terminal; switch to fullscreen for a wider Notebook. Only the selected entry's Markdown is rendered. Its detail identifies a **Saved answer**, **Personal note** or **Learning goal**, and offers sources when available. Its **Actions → Remove entry** (ctrl+d) removes the selected entry.

**Actions → Save to notebook** (ctrl+s) keeps the latest answer and its evidence unchanged. Notebook browsing hides the editor. Choose **Add → Note** (alt+n) or **Add → Goal** (alt+g) to reveal it, then press Enter or **Save**. **Cancel** returns to browsing; returning to Chat restores your question draft. “Saved to notebook” appears only after storage succeeds. Relevant saved notes are available in later answers and their influence is shown. Notes are stored privately in local OpenCode data, separate between unrelated projects. Reopening a coding session restores its companion chat; a new session starts a fresh chat with the project notebook available.

### Approve a coding improvement

Choose **Review improvement** inside an answer's **Suggested improvement** to preview that exact answer's instruction, including an older answer. Ctrl+g previews the latest completed answer's proposal. The dedicated preview shows the complete destination title and session ID. Edit the exact instruction in its scrollable editor; Page Up / Page Down page through its wrapped lines. Shift+Enter adds a line without sending. Choose **Approve and send**, or press Enter while the editor is focused, to approve. **Back** returns to your question draft without sending. Entering and leaving the preview preserves that draft. **Sending, Sent, Failed**, and **Uncertain** remain visible as appropriate. This sends an ordinary steering message immediately. A running tool finishes before the coding agent handles it at its next available turn. The main input draft, agent, model and settings are preserved. **Sent** appears only after the instruction is confirmed in that conversation. If delivery is uncertain, **Check delivery** checks for the same message; it does not automatically send another copy.

### Manual walkthrough

1. At 140×24 or 140×36, start a small coding task and open `/learn`. Confirm coding updates remain visible on the left while you ask about a completed change on the right. Try Shift+Tab's **Build → Plan → Learn → Build** cycle. Switch layouts with Alt+W, then resize to 80×24 and check the fullscreen fallback.
2. Scroll both conversations and type a companion question. Click coding or choose **Focus coding**: Learn should stay visible and both drafts should survive. Click back into Learn's input. If coding requests permission or asks a question, check the **Coding** status and focus coding to respond; use **Return to coding** in fullscreen. Cancel a companion answer; coding should continue. **Close** should dismiss the panel.
3. Try **Simpler**, **Example**, **More**, **Save**, a note and a goal. In Notebook, try all four filters, select entries and compare fullscreen list/detail with narrow inline detail. Restart OpenCode and reopen the coding session: its chat and notebook should return. Open another project: the notebook should be separate.
4. Finish another meaningful task and wait for a proactive question. Confirm it stays in the card, does not open the overlay, and can be dismissed or paused. Chat should still work while paused.
5. Ask for one possible improvement. Inspect and edit its preview, approve it during active coding, and confirm one instruction appears in the correct coding conversation. Repeat near the transition to idle. Cancel a task: pending work must not unexpectedly restart.
6. Ask the companion to edit a file, run a command, or read outside the project. It should explain its limitation. Repeat the recap walkthrough above to verify integration.

### Automated verification

Run focused checks from their package directories:

```sh
# packages/tui
bun test test/learning-companion.test.ts test/learning-controller.test.ts test/learning-overlay.test.tsx test/learning-redesign.test.tsx test/learning-split.test.tsx test/learning-activity.test.ts test/learning-background-question.test.tsx test/learning-pane-focus.test.tsx test/learning-agent-cycle.test.tsx test/learning-notebook.test.tsx test/learning-minimal.test.tsx test/cli/tui/dialog-layout.test.tsx test/cli/cmd/tui/notifications.test.ts --timeout 30000
bun typecheck

# packages/opencode
bun test test/session/learning-companion-tools.test.ts
bun test test/session/prompt.test.ts -t "learning companion answers and cancellation do not interrupt active source coding" --timeout 30000
bun test test/session/prompt.test.ts test/session/run-state.test.ts --timeout 30000
bun test test/session/learning-recap*.test.ts --timeout 30000
bun test test/server/httpapi-session.test.ts -t "round-trips HTTP output formats" --timeout 30000
bun typecheck
```

The October 3 minimal-interface run passed **93 focused tests, 704 assertions across 13 files** in **18.26 seconds**, with sequential low-priority execution. It adds compact-menu, busy Cancel, hidden Notebook editor/navigation, focus restoration, shortcut-menu clipping and readable Markdown coverage. Broad tests and typechecks run on GitHub. The new native VS Code walkthrough remains pending because terminal control returned `noWindowsAvailable`.

The primary October 3 focused TUI run passed **80 tests, 563 assertions across 12 files** in approximately **12.99 seconds**, including the agent-cycle, focus and Notebook changes. The tests cover bounded completed evidence, valid references, quiet topic rules, locked atomic notebook saves, storage errors, continuity and delivery confirmation, and keyboard/scroll isolation at **80×24, 140×24, and 140×36**. Render tests cover long answers and instructions, collapsed/local source expansion, latest-answer actions, pending/disabled/cancel controls, paging, starter prefills, incremental history, light-theme errors, selected-only Notebook rendering and resize, ownership-safe button registration, clipped-button Tab navigation, exact approval, question/coding draft isolation, and session switching. Additive dialog tests preserve older size geometry and Escape focus restoration. `learning-split.test.tsx` covers visible coding updates, layout switches, resizing, coding waits and distinct content sections; `learning-activity.test.ts` covers source/subagent status selection. `learning-background-question.test.tsx` mounts the real coding question prompt after Learn opens and checks that shortcuts cannot consume learning input or submit a coding answer; ordinary coding question controls work after returning. Its held-click regression checks that wrapped coding options stay in place between mouse-down and mouse-up and select the intended answer once. Additional focused coverage is in `learning-agent-cycle.test.tsx`, `learning-pane-focus.test.tsx` and `learning-notebook.test.tsx`, including configured shortcuts, pane switching, late focus timers, saving while coding has focus, filters, stable selection and distinct type dots. A final save-lifecycle check then passed **7 focus tests, 41 assertions** in approximately **3.72 seconds**, including two new cases for closing Learn or switching sessions before a save finishes; these prevent a false destroyed-input error. **Passing current-head CI and a native VS Code walkthrough are required before merge; current CI results are recorded in PR #30.**

Legacy follow-up recognition and optional presentation metadata restore older conversations without a migration. Backend tests exercise the real trusted tool selection, canonical/symlink boundaries, admission restrictions and steering completion/cancellation races. The focused held-source test above passed locally: **1 test, 11 assertions**. It completes a real learning answer while coding stays busy, cancels another learning answer without cancelling coding, then releases the coding response and verifies normal completion. A provider-input regression excludes old notebook injections while preserving chat history; an actual HTTP test verifies persisted structured-response formats. Recap tests retain the original feature coverage. CI and a teammate review are required before merging this feature.

### Review split and evidence privacy

The session race fix and backend are separate PRs; the UI PR depends on both. Review and merge in order: session race fix, restricted backend, then companion UI. Each has its own CI and review gate.

New historical tool evidence excludes complete payloads for `.env*` paths referenced by tool input/metadata. This prevents those direct reads from entering new answers and saved evidence. It is not a general secret detector: arbitrary shell output or text copied by the user/model can still contain secrets. Existing saved explanations are not rewritten.

### Latest native verification (October 6)

A live VS Code keyboard walkthrough verified explanations, Simpler, Example, restored notebook entries, saving an answer and note, local source expansion, pane focus, exact steering preview, Back preserving the draft, and confirmed delivery followed by 13 passing calculator tests and the existing recap. Native screenshots and the remaining manual checks are recorded in [the walkthrough](docs/learning-companion-walkthrough.md#october-6-native-keyboard-walkthrough-and-notebook-correction). The note editor's clipped Save control was corrected with a focused regression. The full native gate remains open for mouse and the additional scenarios listed there; passing CI and teammate approval are still required.
## Changed Files in the Learning Recap (#8)

**What it does:** the "Files changed" part of the Learning Recap lists every file opencode added, modified, or deleted during a task. The status comes from git, which compares a snapshot of the project before and after the task, so it is never guessed from line counts. This matters for edits that only add or only remove lines: a file that only gained lines is still listed as `modified`, not `added`. Each file is listed once with its final line counts, even if it was edited several times. If the task changed no files, the section says "No files were changed during this task."

### How to try it

1. From the repository root, create a scratch folder with two files:

   ```sh
   mkdir -p recap-demo && printf 'one\n' > recap-demo/grew.txt && printf 'gone\n' > recap-demo/old.txt
   ```

2. Start opencode with `bun dev` from `packages/opencode`.
3. Ask: *"In `recap-demo` at the repository root, create `new.txt` containing `hello`, add a second line `two` to `grew.txt`, and delete `old.txt`. Don't run any tests."*
4. When it finishes, the final response ends with a Learning Recap like this. `grew.txt` only gained a line but is still shown as `modified`:

   ```
   ## Learning Recap

   ### Files changed
   - recap-demo/grew.txt (modified, +1/-0)
   - recap-demo/new.txt (added, +1/-0)
   - recap-demo/old.txt (deleted, +0/-1)

   ### Tests
   - No tests were run during this task.
   ```

5. To see the empty case, ask: *"From `packages/opencode`, run `bun test test/session/learning-recap-files.test.ts` without changing any files."* The recap now shows `- No files were changed during this task.` under "Files changed", and the test run as passed.
6. Clean up with `rm -rf recap-demo` from the repository root.

### Automated tests

- `packages/opencode/test/session/learning-recap-files.test.ts` (unit tests for `collect` and `format` in `packages/opencode/src/session/learning-recap-files.ts`):
  - keeps the status git reports for added, deleted, and modified files;
  - keeps one-sided edits (only additions or only deletions) to existing files as `modified`;
  - never invents a status from line counts when the diff has none;
  - keeps only the latest diff when a file appears more than once, and drops entries with no path;
  - returns an empty list for a task with no changes, and `format` shows "No files were changed during this task.";
  - checks that the collected files match the `LearningRecap.Info` schema from #7.
- `packages/opencode/test/session/prompt.test.ts`, tests named `learning recap lists added, modified, and deleted files with the status git reports` and `learning recap says no files changed when a task only runs tests`. These run a whole task end to end: a scripted model makes real edits in a temporary git repository, opencode takes real snapshots, and the tests check the recap text in the final response. This covers the full path from git (`Snapshot.diffFull`) through `collect` to the rendered recap.

**Why these tests are enough:** the unit tests cover every branch of `collect` and `format`, including the one-sided-edit case that caused a bug in the first version (#25 review). The end-to-end tests check each acceptance criterion of #8 against real files and real git: changed files are listed, added, modified, and deleted are labeled correctly, and a task with no file changes shows the clear empty message. If the status were guessed from line counts again, the end-to-end test fails, because it would show `grew.txt` as `added`.

Run them from `packages/opencode`:

```sh
bun test test/session/learning-recap-files.test.ts
bun test test/session/prompt.test.ts -t "learning recap"
```

### Reported mouse-input limitation (#34)

A teammate reported that clicking the companion question input in a native VS Code split view did not allow typing while topics were paused. This is tracked in #34; a reliable workaround is not yet confirmed. The keyboard walkthrough verified chat, but it did not verify this mouse path. The reviewer recommended tracking this separately and Dion authorized integration with this known limitation. Additional native topic, source-session-switch and steering timing checks remain unverified.

## Explain errors before fixing them — Rashid (#21)

OpenCode now explains an error before attempting to fix it.

When a command, test, build, or other tool action fails, OpenCode should:

- explain the error in clear, student-friendly language
- state the most likely cause based on the visible error
- explain the error before making code or file changes
- continue normally when no error occurs

### How to try it

1. Start OpenCode from `packages/opencode` using `bun dev`.
2. Give OpenCode a task that causes a command or test to fail.
3. After the failure, check that OpenCode explains what the error means and gives a likely cause before attempting to change the code.
4. Give OpenCode a normal successful task and verify that it does not add an unnecessary error explanation.

### Automated tests

The automated test for this feature is located in:

`packages/opencode/test/provider/transform.test.ts`

The test named:

`adds error explanation guidance to the final system prompt`

verifies that the error explanation instructions are included in the final system prompt while preserving the existing custom agent instructions.

The provider recording fixtures in:

`packages/opencode/test/fixtures/recordings/session/`

also verify that the updated system instructions are correctly included in provider requests.

To run the relevant test:

```sh
cd packages/opencode
bun test test/provider/transform.test.ts -t "adds error explanation guidance to the final system prompt"
```

### Why these tests are enough:

The automated test checks the final assembled system prompt, which is the exact place where this feature is added. It verifies that the new error-explanation guidance is present while existing agent instructions are preserved. The provider recording fixtures also check that the updated prompt is correctly sent through supported provider request formats. Together, these tests cover both the prompt-building logic and its integration with provider requests.
