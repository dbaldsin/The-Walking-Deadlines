# Session steering completion race

Part 1 of the review stack. This fix affects ordinary coding sessions independently of Learn. User message admission and history selection share a per-session lock so the model cannot see a user row without its parts. Partial failed admissions are removed. The loop reports normal completion separately from failed, blocked or cancelled execution; a pending steer is resumed only after normal completion, without another prompt row.

Stop during the first idle prompt admission is intentional: finish storing the complete question, but start no provider turn. The returned value is that stored user message when no assistant yet exists. It remains unanswered until an explicit new prompt; Stop is never implicitly undone.

Admission locks are reference-counted and removed when all readers/writers settle. Completion results are shared only by live prompt/runner callers; the final caller releases the complete assistant payload. Removing it in the runner's idle callback would be too early because concurrent waiters still need the settlement result to prevent duplicate continuation.

Verification from `packages/opencode`:

```sh
bun test test/session/run-state.test.ts test/session/prompt.test.ts
bun typecheck
```

Regression tests cover concurrent completion-boundary steers, structured completion, failed/blocked/cancelled turns, active Stop and idle settlement, atomic/failed/interrupted admission, first idle prompt Stop, shell handoff and independent sessions. This PR contains no learning agent or TUI changes.
