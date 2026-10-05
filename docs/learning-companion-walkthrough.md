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

## October 3 split-view update

This section records the first split-view revision. The later focus and Notebook update below supersedes its click-to-close behavior.

Learn now defaults to a right-hand pane at terminal widths of **128 columns or more**, with the live coding conversation on the left. **Fullscreen / Split view** and **Alt+W** switch layouts; narrower terminals use fullscreen. Drafts survive layout changes. Notebook layout follows the companion pane's usable width, so split view shows the selected detail below its row; fullscreen can place list and detail beside each other.

The separate **Coding** status exposes work, idle, retries, permission waits and question waits. Opening Learn does not stop coding; an agent can independently wait for a permission or question response. **Return to coding**, Close or Escape returns control; clicking the coding pane in split view also closes Learn, while scrolling it keeps Learn open. **Pause topics** affects automatic learning questions only.

Bordered **Explanation**, **Suggested improvement** and **Learning topic** sections separate the content. **Review proposal** belongs to its specific answer and opens that answer's exact instruction; the fixed **Send to coding agent** action still belongs to the latest completed answer. Approval remains required to send.

### Automated evidence and remaining walkthrough

The real-provider concurrency regression in `packages/opencode/test/session/prompt.test.ts`, **“learning companion answers and cancellation do not interrupt active source coding,”** passed locally: **1 test, 11 assertions, approximately 3.13 seconds**. A held source coding response stays busy while its learning child answers. Cancelling a second child answer leaves the source active, and releasing the source response completes coding normally. Readiness uses provider signals and bounded waits.

The final updated focused TUI run passed **58 tests, 0 failures, 428 assertions across 9 files**, in approximately **7.89 seconds**. New coverage is in `packages/tui/test/learning-split.test.tsx`, `learning-activity.test.ts` and `learning-background-question.test.tsx`. It covers layout/resize/draft behavior, coding attention states, visually separate sections, exact-answer proposal review, and a real `QuestionPrompt` arriving while Learn is open. The question tests use the actual SDK client at a controlled HTTP boundary to detect unintended replies or rejects. A held mouse click renders between press and release: wrapped options stay in place, the intended answer is selected once, and Learn closes on release to restore coding control. The October 2 counts above describe that earlier run. Current-head CI will run remotely after push.

The fresh VS Code app lookup, Raise and screenshot succeeded, showing the earlier runtime. Focusing the terminal then failed with `noWindowsAvailable`, so the existing demo was not restarted. **The new split-view native walkthrough and screenshots remain pending.** Complete it with one demo instance and optional integrations disabled: check coding updates beside Learn, switch to fullscreen and back, respond to a coding question, expand sources, use Notebook and inspect a proposal. Capture the resulting views and sample that worker's CPU/RSS during idle, scrolling and answering. Passing current-head CI and teammate approval remain merge gates.

## October 3 focus and Notebook update

**Shift+Tab** includes Learn at the wrap point in the coding agent cycle: **Build → Plan → Learn → Build** for the default agents. Opening Learn leaves the selected coding agent unchanged. Shift+Tab from Learn's Chat question input returns to the first coding agent. On buttons, Notebook and other editors, it retains reverse control navigation.

Clicking coding or choosing **Focus coding** now keeps the split companion mounted and preserves both drafts. Clicking back into Learn restores its keyboard control. The active pane has a filled dot and active divider; the companion also labels **Typing here** versus **Visible**. **Close** still dismisses the pane. Narrow/fullscreen layouts remain modal and use **Return to coding** to close.

Notebook now has command-center-style **All / Answers / Notes / Goals** filters with counts, compact rows with different coloured and labelled dots, saved dates and a full-row selection. Only the selected Markdown renders. At 100 usable columns it appears beside the list with a divider; smaller panes show the detail below its selected row. Switching from a long chat resets Notebook to its heading and first selected entry.

### Agent exercise and verification

An independent agent exercised the actual OpenTUI render and mouse/keyboard controls with controlled fixture data. Other agents reviewed the Notebook design and focus/shortcut code. Findings incorporated here include clearer type filters, a selected-entry divider, the clipped Notebook heading, delayed focus restoration after changing panes or resizing, and focus theft when an atomic notebook save finishes after the user returns to coding. Search, undo removal and independently scrolling wide list/detail panes were suggested as possible future improvements; they are not implemented in this revision.

The final sequential focused run passed **80 tests, 0 failures, 563 assertions across 12 files**, in approximately **12.99 seconds**. New regressions use actual rendered controls at **80×24, 140×24 and 140×36**, and the actual keymap command implementation. They cover configured coding shortcuts, disabled/missing/child sessions, pane switching, unchanged drafts, late focus timers, saving while coding has focus, filtered stable selection, type-dot colours and dates, local saved-source expansion, one selected Markdown detail and responsive layouts. Held coding clicks still keep geometry stable and submit the intended answer once; Learn now remains visible afterward.

No additional OpenCode instance or broad local typecheck was started. A resource snapshot of the user's existing worker was **165 MiB RSS** and approximately **10.1% CPU** as reported by `ps`; free disk space was approximately **334 MiB**. This snapshot does not measure the new UI during idle, scrolling or answering. Full checks run on GitHub. **The new native VS Code walkthrough and screenshots remain pending**, as does actual teammate approval before merge.

### Later resource cleanup and launch preparation

A later sample showed **3.4 GiB** free disk space and **4.1 GiB** swap in use. The transient VS Code updater was stopped, its **1.4 GiB** staged update cache was cleared, and one inactive **147 MiB** npx cache was removed. The active Playwright cache was retained. Free disk space subsequently measured **5.2 GiB**, and `memory_pressure -Q` reported **35% system-wide memory free**. These snapshots do not establish the cause of the user's freezes or guarantee future stability.

The existing demo's **Try the learning companion** VS Code task now runs through `nice -n 10`, with its one-instance limit, `--pure` and optional MCP integrations disabled. Lower scheduling priority reduces CPU competition; it does not impose a memory limit. No OpenCode process was started for this attempt. Native control could raise VS Code and capture its shell terminal, but focusing that terminal returned `noWindowsAvailable` again. The user can start the prepared task manually; the new live walkthrough remains pending.

A follow-up resource sample while OpenCode was stopped showed approximately **7.5 GiB swap used**, **2.0 GiB free disk** and **31% system-wide memory free**. The reclaimed cache sizes above remain valid; available disk space changes as the system's swap use changes. No claim is made that cache cleanup eliminated the system-wide pressure.

The final lifecycle review also found that a notebook save completing after Learn closed or its source session changed could read the destroyed composer and show a false **EditBuffer is destroyed** error after **Saved**. A live-input guard fixes that JavaScript exception. Both new regression cases failed before the guard and passed afterward; the focused pane suite passed **7 tests, 41 assertions**, approximately **3.72 seconds**. This is a UI error fix, not evidence about the cause of the Mac's freezes. The full remote CI suite must pass on the final commit.

## October 3 minimal controls and readable answers

The header now combines identity and labelled status with **Options** and **Close**, followed by Chat/Notebook tabs. **Options** groups layout, pause/resume, coding status/focus and shortcut help. The latest-answer row keeps **Simpler / Example / Actions**; **Actions** contains Go deeper, Save and conditional Update. Menus are local disclosures: opening them makes no model request, Escape dismisses them before Learn, and clicking coding closes menus while preserving the split pane and both drafts.

New interactive answers request **The idea**, followed by two or three short labelled points. The default is three to five short sentences, with uncertainty and unavailable evidence identified. Examples and deeper answers may include code. The Markdown reply shape is unchanged, historical explanations and notes are preserved, and automatic topics use their own single-question formatting instruction. Conversation reading width is capped at 72 columns. Notebook browsing hides the composer, uses **Add → Note / Goal**, and places removal in the selected entry's **Actions**.

Independent review identified the hidden composer button remaining in Tab navigation and focus restoration. Regression tests reproduced both failures, then passed after hidden ancestors were excluded and hidden composer activation guarded. A separate regression reproduced shortcut help focusing a button below its scroll viewport; opening help now focuses the visible menu viewport. Existing late-save disposal, cancellation, immutable sources, session-switching and exact steering-delivery tests remain covered.

### Rendered screenshots

These are captures of the actual OpenTUI component with controlled calculator fixture data, converted from its cell colours and text to PNG. They demonstrate layout; they are **not native VS Code screenshots or live model responses**.

![Chat at 80×24](images/learning-minimal-chat.png)

![Coding and learning split view at 140×24](images/learning-minimal-split.png)

![Fullscreen Notebook at 140×36](images/learning-minimal-notebook.png)

### Resource sampling and native walkthrough status

The 8GB Mac reported **26% system-wide free memory** before work and **27%** during and after the sequential focused checks. One sampled test process used **281 MiB RSS** and **144% CPU** as reported by `ps` (multiple cores); it ran through `nice -n 10`. No broad local typecheck, concurrent test suite or additional OpenCode instance was launched. These samples do not establish idle, scrolling or answering costs for the new companion.

VS Code's existing demo was stopped before restart. Native control could inspect the window and send exit keys, but restarting in its terminal failed with **`noWindowsAvailable`**. Its accessibility/screenshot observations also remained stale between actions. No Bun demo process remained in the final process check. **The new native VS Code walkthrough and idle/scrolling/answering samples remain pending.** Start the existing **Try the learning companion** task manually, with its low priority, single-instance limit, `--pure` and optional integrations disabled. Verify a new structured answer, Example, Save, Notebook editing, sources, split focus, Escape menus and approved steering; capture native screenshots. Current-head CI and actual teammate approval remain merge gates.

## October 5 review revisions

Topic suggestions now default off and persist per source session. Learn's Shift+Tab integration requires a saved explicit opt-in in Options. Historical `.env*` tool payloads are excluded from new evidence. Missing lookup targets retain Read's normal suggestions without allowing missing paths behind escaping symlinks. Stored unexpected formats no longer break message listing. Session admissions and completion payloads are released after the last live caller settles, including the idle settlement race. A new test covers Stop during the very first idle admission.

Sequential low-priority backend checks: **90 pass, 1 existing skip, 0 fail** across run-state, prompt and tool tests. New malformed-format HTTP regression: **1 pass**. TUI: **95 pass / 1 fail** on the first full revision run; the failing opted-in pane fixture was corrected, and the focused menu/pane/cycle rerun passed **30 tests**. Final isolated-stack CI remains the authority for typechecks and broad verification.

The native VS Code demo started with `--pure`, optional MCP integrations disabled, and `nice -n 10`. One runtime sample was **1.6% CPU / 426800 KiB RSS** while idle, and system free memory before the demo was **49%**. These are snapshots, not performance guarantees. The native AX window title changed from zsh to bun, but screenshot observations continued showing the pre-launch shell while the process was running. Because the new UI could not be visually verified, the walkthrough gate remains **pending**. The owned demo was exited; no extra demo instance was left running.
