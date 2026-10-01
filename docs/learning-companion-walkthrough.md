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
