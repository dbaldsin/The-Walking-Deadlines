# User Guide

This guide explains the features this team added to opencode and how to try each one yourself. Each section below is written by whoever implemented that feature — add your own section rather than editing someone else's.

## Learning Recap (#5, #7–#11)

**What it does:** after opencode successfully finishes a task that changed files or ran tests, it appends one "Learning Recap" to the end of its final response, listing:

- **Files changed** — every file touched during the task, with its status (added/modified/deleted) and line counts.
- **Tests** — every test command that ran (`bun test`, `npm test`, `pytest`, `go test`, and similar), whether it passed, failed, or didn't finish, plus a short summary line.

Each recap covers all provider turns in the task, including work before instructions sent while opencode is busy. An empty category shows "No files were changed during this task." or "No tests were run during this task." Plain replies, read-only tasks, and tasks that end in an error, denied permission, or cancellation receive no recap.

### How to try it

1. Start this checkout with `bun dev` from `packages/opencode`.
2. Ask: *"Append `<!-- learning recap demo -->` to `packages/opencode/README.md` and run `bun test test/session/learning-recap-render.test.ts` from `packages/opencode`."* Resolve the README path from the repository root. Tests must run from the package directory; this repository disables tests from its root.
3. Once it finishes, the final response ends with a `## Learning Recap` section showing the file you changed and the test run's pass/fail status.
4. Ask *"Explain your previous answer without using tools."* Then ask *"List the repository files without making changes or running tests."* Neither response should have a recap.

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
