# User Guide

This guide explains the features this team added to opencode and how to try each one yourself. Each section below is written by whoever implemented that feature — add your own section rather than editing someone else's.

## Learning Recap (#5, #7–#11)

**What it does:** after opencode finishes a coding task that used any tools (edited files, ran commands, etc.), it appends a short "Learning Recap" to the end of its final response, listing:

- **Files changed** — every file touched during the task, with its status (added/modified/deleted) and line counts.
- **Tests** — every test command that ran (`bun test`, `npm test`, `pytest`, `go test`, and similar), whether it passed, failed, or didn't finish, plus a short summary line.

A section always shows a clear message ("No files were changed during this task." / "No tests were run during this task.") rather than staying silently blank, so the recap teaches you something even when nothing happened in that category. The recap is skipped entirely for plain conversational replies that never touched a tool — it only appears after an actual coding task.

### How to try it

1. Run opencode on this repo (`bun dev` from `packages/opencode`, or `opencode` from your install).
2. Ask it to make a small code change and run the tests, for example: *"Add a comment to `README.md` and run `bun test`."*
3. Once it finishes, the final response ends with a `## Learning Recap` section showing the file you changed and the test run's pass/fail status.
4. Ask it something that needs no tools, for example *"What does this function do?"* with no edits — no recap should appear, since nothing happened to report.

### Example output

```
## Learning Recap

### Files changed
- README.md (modified, +1/-0)

### Tests
- bun test: passed (14 pass, 0 fail)
```

### Automated tests

- `packages/opencode/test/session/learning-recap.test.ts` — the shared `LearningRecap.Info` schema: accepts complete, partial, and empty recaps; rejects invalid test-result data.
- `packages/opencode/test/session/learning-recap-tests.test.ts` — detecting test commands (`bun test`, `npm test`, `pytest`, `go test`, compound commands like `cd x && bun test`) and turning a finished shell call into a passed/failed/not-run result with a summary.
- `packages/opencode/test/session/learning-recap-files.test.ts` — collecting and formatting the files changed during a task, including one-sided edits to existing files (an edit with only additions or only deletions, which line counts alone can't tell apart from a new/deleted file).
- `packages/opencode/test/session/learning-recap-render.test.ts` — building the full recap from a turn's tool-call parts and file diffs, and rendering it to the markdown shown above, including the "nothing to report" and "no tests ran" cases.

**Why this is enough:** each data source (test detection, file collection, rendering) is tested in isolation against its acceptance criteria, covering the success case, the "nothing happened" case, and malformed/edge-case input (missing exit codes, one-sided diffs, non-test commands that just mention "test"). The full opencode session test suite (`bun test test/session`, 400+ tests) also runs unaffected, confirming the recap doesn't change any existing turn behavior for tasks that use no tools.
