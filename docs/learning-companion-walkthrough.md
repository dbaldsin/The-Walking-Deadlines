# Learning companion terminal walkthrough

Recorded on October 1, 2026 from the `learning-companion` checkout, using macOS 15.7.3, Bun 1.3.11 and OpenAI GPT-5.6 Sol. The disposable calculator project contained only a tiny function and its test. The [text recording](learning-companion-walkthrough.txt) contains excerpts from actual terminal captures, not native screenshots. Local paths and the coding session identifier are redacted; omitted lines are marked.

To reproduce from this checkout, run `bun dev` in `packages/opencode`, open a coding session in a disposable project, and follow the [User Guide](../UserGuide.md#project-learning-companion--dion-29).

## Observed at 80×24

The coding agent fixed `double(value)` from addition to multiplication. Its transcript showed the original failing test, the passing rerun and the Learning Recap. While working with that completed evidence, the companion answered a question, produced **Simpler** and **Example** follow-ups, saved an answer and accepted a personal note. The recording includes the **Saved to notebook** confirmation; private notebook contents are excluded.

The approval preview showed the destination and exact instruction. The operator edited the instruction by adding `Please ` before approving. The companion subsequently displayed **Instruction: Sent**, and the delivery check found exactly one coding message with that edited text. The coding agent added `double handles zero` and reported `bun test calculator.test.ts`: **2 passed, 0 failed**. The recording also shows the preserved unsent coding draft and a quiet **Topic ready** indicator in the coding view. The draft frame predates repair of a structured-response error; its error badge is retained and labelled.

## Wider terminal

A fresh process started at **140×36**. Its captured overlay shows the wider layout, follow-up controls and visible question input. After restarting and reopening the same coding session, the previous companion chat and saved note returned. A new learning goal was saved successfully. The recording includes the restored note and new goal labels while excluding their private contents.

The earlier capture made after resizing an 80×24 process retained its original content width; only the fresh-process captures establish the wider layout.

## Verification scope

This record demonstrates the listed live interactions. The guide also describes separate project notebooks, pause/dismiss, cancellation, access restrictions and additional follow-ups; this record does not establish a live result for each of those cases. Their focused automated checks are listed in [UserGuide.md](../UserGuide.md#automated-verification-1), including the TUI controller/overlay tests and backend companion-tool/steering tests. Run them from their package directories as documented.

The [Sprint 2 checklist](../P2C-Sprint2-Checklist.md) treats feature CI, teammate review and merge into team `main` as remaining delivery gates. This local walkthrough supplies functional evidence; it does not assert those gates have completed.

## October 2 UI redesign verification

The redesigned overlay, sidebar, Notebook and approval preview use the current OpenCode theme, a static identity, collapsed evidence, and a fixed composer. Usage and sequential package commands are in the [User Guide](../UserGuide.md#project-learning-companion--dion-29).

### Automated rendering and interaction

The final local focused run passed **48 tests, 346 assertions** across the learning data, controller, overlay, redesign, fullscreen dialog, and notification suites. Real OpenTUI/Solid rendering checks cover **80×24, 140×24, and 140×36**, including long explanations and instructions, action wrapping, sources expanded without a model request, short follow-up labels, history paging, starter prefills, Notebook resizing and selection, errors, cancellation, session switching, and approval/draft isolation. Controller and persistence tests retain the existing storage and delivery coverage.

Independent static review caught and corrected notebook mode restoration, activation after focus moves to content, Tab traversal of clipped buttons, and overlapping Notebook control cleanup. Each interaction issue has a focused regression. TUI and plugin typechecks passed locally before the last small review corrections; exact final-head typechecking is delegated to CI to limit local load. CI found a final viewport array inference error at the first redesign commit; it was corrected by adding the actual typed viewport object. The subsequent verification result must be checked on the corrected commit.

### VS Code attempt and resource samples

One **Try the learning companion** VS Code task started this checkout against the tiny calculator demo with `--pure` and all four configured optional MCP integrations disabled locally. The resumed coding session visibly displayed its existing zero-input edit, **2 passed / 0 failed**, and the Learning Recap. Those are historical results, not a new test run during this attempt.

Two idle worker samples measured approximately **182 MiB at 0.4% CPU** and **166 MiB at 0.8% CPU** (`ps` RSS/CPU snapshots). These are point samples rather than a performance benchmark. The local typecheck briefly used about **1.15 GiB RSS**; it completed successfully, and broad suites were kept on CI. Initial disk space was critically low; an inactive npx cache and our generated renderer debug dump were cleared. Free space later recovered above 2 GiB after the check ended. The staged VS Code update cache was retained because its updater restarted.

Computer control repeatedly returned stale AX/screenshot state, a clipboard timeout and `noWindowsAvailable`. Resetting its session revealed the running terminal, but reliable companion input control remained unavailable. **The redesigned UI live walkthrough, native screenshots, and scrolling/answering CPU/RSS samples are still pending.** Automated render fixtures do not establish those live results. To finish: open `/learn` in the running task, capture Chat with collapsed/expanded sources, Notebook and the steering preview; exercise follow-ups, Save, Back and explicit approval while sampling that one worker. Do not start a second instance.

Passing CI and actual teammate approval remain required before merge. The requested Sangyoon review is not replaced by the independent static review above.
