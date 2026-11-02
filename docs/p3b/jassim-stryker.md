# Jassim — P3B Stryker mutation testing

## Tool and scope

Stryker Mutator 10.1.1 measures how well tests catch bugs. It makes many small changes ("mutants") to the source, such as flipping `===` to `!==`, emptying a string, or replacing a condition with `true`, and runs the tests against each one. A mutant is **killed** if a test fails and **survives** if every test still passes. The mutation score is the share of mutants killed.

The target is the permission translator, `packages/opencode/src/translator/index.ts`. It writes the plain-language **What** shown in every shell, edit and write permission prompt, so a wrong summary could lead a student to approve a destructive command. It is pure and deterministic (text in, text out), so every mutant gives a stable result. Its tests are `packages/opencode/test/translator/index.test.ts`.

The whole repository is out of scope. The main packages hold about 229,000 lines of TypeScript. This 275-line file alone produces 926 mutants, so the whole project would produce hundreds of thousands, and each one needs its own test run. Stryker has no Bun test runner that can skip unrelated tests, so every mutant would rerun the full suite, which takes minutes. This matches the rest of the team's scoping: fast-check targets one module, OSV-Scanner the root `bun.lock`, Hadolint the root `Dockerfile`.

## Installation evidence

- `packages/opencode/package.json` pins `@stryker-mutator/core` `10.1.1` as a dev dependency and adds the `test:mutation` script (`stryker run`). Root `bun.lock` records the resolved packages and integrity hashes; `bun install --frozen-lockfile` passes.
- `packages/opencode/stryker.config.json` holds the configuration.
- `.github/workflows/test.yml` adds the `mutation-test` job and adds it to `jobs.deploy.needs`, so a failing mutation score skips deployment.
- `packages/opencode/.gitignore` ignores the generated HTML report (`/reports/mutation`).

No secret was added. The job only needs `contents: read`.

## Customization

- **Runs on** GitHub-hosted `ubuntu-latest` for every pull request, push and manual run of `test.yml`, including documentation-only changes, so the required status is never left pending. It never runs on the VM's self-hosted runner. Checkout uses `persist-credentials: false`.
- **Timeout:** ten minutes for the job, five for the Stryker step. A run takes about 5 seconds locally.
- **Runtime:** the job uses the shared `setup-bun` action, which also installs Node 24; Stryker requires Node 22 or later. In the dev container `node` is a link to Bun, so local runs use Bun.
- **Test runner:** `command`, running `bun --config=/dev/null test test/translator` once per mutant. Stryker has no Bun runner. `coverageAnalysis` is `off` because the command runner cannot report per-test coverage.
- **Skipping the shared test preload:** `--config=/dev/null` stops Bun loading `bunfig.toml`, whose test preload sets up and tears down the whole app runtime. The translator and its tests import nothing but each other and `bun:test`, so they don't need it. This cut a full run from about 9 minutes to seconds. The slow run also reported 474 killed instead of 465 (51.19% instead of 50.22%). The extra nine were most likely test processes failing under load rather than real catches; the fast run gives the same 465 every time.
- **Sandbox location:** `tempDirName` is `/tmp/opencode-stryker`. The default `.stryker-tmp` inside the package sits on the dev container's virtiofs mount shared with macOS. After an interrupted run that folder got stuck, and every later run failed with `EDEADLK` (resource deadlock avoided) before testing. The container's own `/tmp` avoids that and is faster.
- **Thresholds:** `break: 50`, `low: 60`, `high: 80`. The job fails below 50%. The current score is 50.22%, so the threshold is set as a ratchet at the existing baseline: any change that lowers test effectiveness, or adds translator code without tests, fails the job. Raise `break` as tests improve.
- **Reports:** `clear-text` prints every surviving mutant in the job log; the `html` report is uploaded as the `mutation-report-<attempt>` artifact for seven days, including when the job fails.

Run locally from `packages/opencode`:

```sh
bun run test:mutation
```

## Evidence and sensitivity check

- [Clean run](jassim-stryker-pass.txt): 926 mutants, 465 killed, 461 survived, score 50.22%, exit 0. **TODO:** add the `mutation-test` job URL from this PR.
- [Deliberate failure](jassim-stryker-fail.txt): the `Translator.shell` tests were skipped by changing `describe` to `describe.skip`. The score fell to 4.97% (46 killed) and Stryker exited 1 with `Final mutation score 4.97 under breaking threshold 50`. The test file was restored and the change was not committed. **TODO:** add the job URL from throwaway PR #NN (closed without merging).
- Initial-run guard: if the translator tests already fail before mutation, Stryker stops with `There were failed tests in the initial test run` and exits 1, so a broken suite cannot report a misleading score.
- The score is deterministic: three consecutive runs gave exactly 50.22%.

## False positives, false negatives, and plan changes

A false positive here is an **equivalent mutant**: a change that cannot alter behaviour, so no test could ever kill it. Two examples from this run:

- `src/translator/index.ts:79`: `match[3] ?? match[4] ?? match[6] ?? ""` → `"Stryker was here!"`. The tokenizer regex always matches one of its groups, and groups 1, 2 and 5 are handled earlier, so the final fallback is unreachable.
- `src/translator/index.ts:104`: `entry.target ?? ""` → `"Stryker was here!"`. `parse()` rejects any redirection without a target, so `target` is always set there.

Most survivors are true findings, not false positives. They are the plain-language sentences for commands the tests never exercise, such as `chmod`, `chown`, `rmdir` and `touch`, and most `git` subcommands. By area: about 174 survivors in general command descriptions, 159 in `git`, 58 in package managers, 29 in `pip`, 20 in edit/write line counts and 21 in parsing and redirections. The safety-critical parsing (command splitting, redirections, the "too complex to summarize safely" fallback) is the best covered. A table-driven test with the expected **What** for each command would kill most of the rest.

Stryker cannot catch everything. A killed mutant only shows that some test failed, not that the test checks the right thing. It only measures the translator unit tests: it does not run the shell, edit and write tool tests that check the explanation reaches the permission request, or the TUI and app that display it. Its mutation operators are fixed patterns, so bugs they cannot express, such as a wrong regular expression that still compiles, may go unmeasured. The score covers the whole file, so a new untested function can hide behind well-tested ones until it pulls the total under 50%.

Changes from the P3A plan:

- The planned tool was actionlint. We were told late that it does not meet the assignment criteria, so it was replaced with Stryker, which does not overlap with the team's Gitleaks, OSV-Scanner, Hadolint or fast-check checks.
- The scope is the translator rather than the whole repository, for the run-time reasons above.
- The shared test preload is skipped and sandboxes live in `/tmp`; both were found during the trial runs described above.
