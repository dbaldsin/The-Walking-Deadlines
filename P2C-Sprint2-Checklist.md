# Project 2C — Sprint 2 submission checklist

**Deadline:** Thursday, October 8, 2026, **11:59 pm**. Use the deadline time zone displayed by the course/Gradescope.

| Required component                 |  Points |
| ---------------------------------- | ------: |
| Individual Final Implementation    |      60 |
| Team Integration                   |      30 |
| Process & Team Reflection          |      10 |
| Individual Reflection              |      10 |
| **Total**                          | **110** |
| Optional team bonding extra credit |  **+2** |

Source: the supplied **Project 2C: Second Sprint** rubric. GitHub states below were verified on **October 6, 2026 (Qatar time)**.

## Repository and board

- Submit the [team repository](https://github.com/dbaldsin/The-Walking-Deadlines) and [GitHub Project board](https://github.com/users/dbaldsin/projects/2/views/1) links on Gradescope. Grading uses their deadline snapshots.
- Team board convention: **To Do = actively working**, **In Progress = in review**, **Done = completed**. Keep items consistent with actual implementation, review, and merge state.
- Merge into the team's **main** branch before the deadline; the rubric says to keep submissions in the team repository.

## Verified implementation and integration state

| Item                                                                                                    | Verified state                                                                                                           | Remaining work                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [PR #23 — recap schema](https://github.com/dbaldsin/The-Walking-Deadlines/pull/23)                      | Merged September 30. Original schema contribution is documented in [UserGuide.md](UserGuide.md).                         | Include this original assigned contribution and its acceptance criteria in Dion's evidence.                                                                                                                         |
| [PR #26 — error explanations](https://github.com/dbaldsin/The-Walking-Deadlines/pull/26)                | Merged into main October 1.                                                                                              | Re-check integration after subsequent merges.                                                                                                                                                                       |
| [PR #28 — recap display](https://github.com/dbaldsin/The-Walking-Deadlines/pull/28)                     | Merged into main October 1.                                                                                              | Re-check integration after subsequent merges.                                                                                                                                                                       |
| [PR #27 — plain language explanations](https://github.com/dbaldsin/The-Walking-Deadlines/pull/27)       | Open; **Changes requested**. Existing unit, smoke, and typecheck checks pass.                                            | Author must address the misleading shell-redirection summary and its regression test, remove the unrelated local settings file, and link issues #19/#20 in the PR description; obtain teammate re-review and merge. |
| [Issue #10 — key decisions](https://github.com/dbaldsin/The-Walking-Deadlines/issues/10)                | Open; assigned to **Jtthani**.                                                                                           | Explain actual implementation decisions with short user-facing rationale; verify the Key decisions section with tests/fixtures. Complete PR, CI, review, and merge.                                                 |
| [Issue #12 — recap integration tests/docs](https://github.com/dbaldsin/The-Walking-Deadlines/issues/12) | Open; assigned to **Rashidcmuq**.                                                                                        | Test that a completed coding task produces a recap containing changed files, decisions, and test results; add a user-guide example. Complete PR, CI, review, and merge.                                             |
| [Issue #29 — learning companion](https://github.com/dbaldsin/The-Walking-Deadlines/issues/29)           | Open; assigned to **dbaldsin**. [PR #30](https://github.com/dbaldsin/The-Walking-Deadlines/pull/30) is published; Sangyoon21 review requested. Additional story alongside original schema issue #7. | Focused verification and guide are complete on the feature branch. Native keyboard walkthrough and screenshots recorded; remaining native checks are listed in docs/learning-companion-walkthrough.md. Merge backend #33 after teammate approval, then TUI #30 after re-review and passing current-head CI. Board item belongs in In Progress while under review.                                 |

### Dion’s review stack

- [x] [PR #32 — steering race fix](https://github.com/dbaldsin/The-Walking-Deadlines/pull/32): Sangyoon approved; unit, typecheck and smoke checks passed; merged into main October 6 (Qatar time). The board automatically moved it to Done.
- [ ] [PR #33 — companion backend](https://github.com/dbaldsin/The-Walking-Deadlines/pull/33): now targets main; unit, typecheck and smoke checks have passed. Await teammate approval and verify current merge gates before merging.
- [ ] [PR #30 — companion TUI](https://github.com/dbaldsin/The-Walking-Deadlines/pull/30): review fixes implemented, but GitHub still shows Changes requested. Native VS Code walkthrough and current-head CI remain required. All existing head checks passed; the October 6 note-editor fix needs fresh CI.
- [ ] Merge the schema documentation currently on #30 into main. Original issue #7 / PR #23 remains Dion’s Sprint 1 contribution; #29 is additional work.
- [ ] [Saif’s PR #31](https://github.com/dbaldsin/The-Walking-Deadlines/pull/31): Dion’s review is complete and CI passes; the team can merge it after checking integration gates.

**Current main:** [`f041f222`](https://github.com/dbaldsin/The-Walking-Deadlines/commit/f041f2223befc8fa226b2450d21490c5c3a54ae4). Post-merge [test](https://github.com/dbaldsin/The-Walking-Deadlines/actions/runs/37373048984) and [typecheck](https://github.com/dbaldsin/The-Walking-Deadlines/actions/runs/37373049024) workflows both passed. The scheduled regression suite still has two failures also observed before #32; team integration must track those separately.

## Implementation and integration deliverables — 90 points

- [ ] Each student finishes their individually assigned Sprint 1 issue, with implementation matching its Project 2A acceptance criteria or documented replanning.
- [ ] Each feature has automated tests covering its acceptance criteria, passing feature-branch CI, coherent commits, and a functional walkthrough that follows UserGuide.md.
- [ ] Each PR explains what was tested and why that verification is sufficient. Each student contributes a UserGuide.md section with usage, user testing, test locations, coverage, and rationale.
- [ ] A teammate reviews each eligible PR; resolve integration conflicts and merge every individually assigned issue with passing CI into team main before the deadline. A branch failing CI is exempt from the team's merge responsibility, and its owner receives zero Team Integration points under the rubric.
- [ ] GitHub Actions remains enabled, latest main passes, and the Project board reflects final progress.
- [ ] Submit both repository and board links to Gradescope.

## Human reflection and process deliverables — 20 points

The rubric discourages generative AI for both reflections. Team members should write their own account using actual development evidence and contribute evenly to the shared document.

### Team reflection — 10 points

- [ ] Create or verify the Google Doc in the team Drive folder. Record the **actual** tasks each member performed and approximate time spent, using commits and other records; compare with the original planned schedule.
- [ ] Explain predicted and replanned milestones, unexpected or dropped work, causes of deviations, and whether better planning could have anticipated them.
- [ ] Compare the planned and actual development process; discuss effectiveness, skipped steps, and added techniques with concrete examples.
- [ ] Attach all actual meeting minutes, including agendas/topics, decisions, and work assignments. Use minutes, board items, PRs, and commits to support claims about communication, scheduling, responsibilities, and equitable contributions.
- [ ] Provide at least **three concrete future actions**, each labelled **Keep / Start / Stop**, with justification and supporting evidence. Proofread the reflection together.
- [ ] Update the teamwork contract based on those experiences; highlight changes in **yellow**, have the team **sign and date** it, and upload it.
- [ ] Submit final team answers on Gradescope and attach the Google Doc link.

### Individual reflection — 10 points

- [ ] Each student submits their own reflection on Gradescope: compare with previous collaborative projects; discuss their development process, successes, difficulties, surprises, and lessons about themselves, teamwork, and other people.
- [ ] Include concrete examples and at least **one specific action** to improve or keep in a future project, with justification and supporting evidence.

## Optional extra credit — 2 points

- [ ] Hold an actual team bonding activity outside a working session; the rubric suggests activities outside class, libraries, and campus.
- [ ] Save an actual team activity photo in shared Google Drive and submit it to **P2C EC** on Gradescope before the same deadline.
