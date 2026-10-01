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
