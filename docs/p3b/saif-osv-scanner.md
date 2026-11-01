# Saif: Integration of P3B OSV-Scanner

## Tool and scope

OSV-Scanner (v2.7.0) reads root bun.lock and scans all resolved versions (including all transitive versions) directly and transitively against the OSV vulnerability database. It only reads the lockfile, it will not install or execute any dependency code. Each finding includes an advisory ID, the package version(s) affected and any new package version(s) that might resolve the issue. Only bun.lock is in scope, artifacts/glm52-rise-video/bun.lock is not in scope because it is not part of the app.

## Installation evidence

| File | Purpose |
| --- | --- |
| `.github/workflows/osv-scanner.yml` | The blocking check, a re-usable workflow called by test.yml. |
| `.github/workflows/osv-scanner-weekly.yml` | A full weekly report with no blocking. |
| `.github/scripts/osv-scan.sh` | Starts the scanner and returns error if it was not completed |
| `osv-scanner.toml` | Exception policy, read automatically next to bun.lock. |
| `.github/workflows/test.yml` | New dependency-scan job, added to deploy.needs |

The v2.7.0 release binary is the scanner, and before running it is checked against the SHA-256 published in the release's osv-scanner_SHA256SUMS. The comparison uses Google's osv-reporter-action, pinned to commit 0a65f82af05cd58cf587827b0bb0489548c18346 (v2.7.0). Other actions are based on the same pinned SHAs as other workflows.

## Customization

- Only fail on new advisories. The job compares bun.lock before and after the change, and only fails when there are more advisory IDs in the after version than in the before version. This is same as the official OSV-Scanner PR workflow. There are currently 344 known advisories on main, so a full scan would fail every PR, even for those that don't actually impact on dependencies.
- What "before" means. Pull request: the commit that the PR is based on. Push: The previous tip of the branch (github.event.before). Manual run: the parent commit. If it is a new branch, or the tip that formerly existed but was removed by a force push: the tip of main. Only bun.lock is swapped between the 2 scans, both scans are located in the same path and the same osv-scanner.toml is used.
- If the scan completes, osv-scanner exits with 0 (nothing found) or 1 (findings). In all other exit codes osv-scan.sh aborts the task. This is important because even if the scan fails, the results file can still look like the results of a clean scan (see the scan-failure sample evidence below).
- Exceptions. osv-scanner.toml contains one entry per advisory ID, each entry contains reason which specifies an owner, and ignoreUntil which specifies an expiry date. No blanket package or severity ignores. There were no exceptions.
- Limits. Never on the VM's self-hosted runner, hosted on GitHub, with contents: read only, with timeout of 5 minutes.

## Development-process integration

- test.yml always runs the check on all pull requests, all pushes (including main) and all manual runs, and even on documentation-only changes, which means that the status never becomes "pending".
- dependency-scan is added to jobs.deploy.needs, therefore deployment on the VM is waiting for the dependency-scan to succeed on the same main commit.
- The name of the status displayed is dependency-scan / osv-scanner. Once it has passed the green run on main, add the same name to the required status checks of main, along with the existing (unit, e2e (smoke), typecheck / typecheck, and dockerfile-lint once it is required) checks.
- If the check fails, the job adds annotations and a job summary which contains the new advisory IDs, and the before/after JSON result is uploaded as an artifact. The developer adds an exception with the date and a reason in the same PR, or simply upgrades to a fixed version.
- osv-scanner-weekly.yml runs weekly on Mondays at 06:00 UTC (and on-demand) and prints all advisories in the lockfile, even those made after a package is merged. It will not block anything and is green unless the scan fails.

Use the following command when running it locally, from the root of the repository:

```sh
osv-scanner scan source --lockfile=./bun.lock
```

## Evidence

- There are 344 advisories, 94 vulnerable package versions for 68 packages in [full scan: main](saif-osv-main-scan.txt).
- [This branch vs main, no dependency change](saif-osv-clean-run.txt): passes (344 before, 344 after).
- [Intentional problem](saif-osv-detection-run.txt): node-serialize@0.0.4 (GHSA-q4v7-4rhw-9hqm, code execution, no fixed version) is added to packages/opencode in a throwaway commit. That check failed, and it named the advisory. The commit was reverted and the check passed. The throwaway commit has been excluded from this PR.
- [Can't complete](saif-osv-scan-failure-run.txt): the scanner exits with value 127 if it cannot complete, and the job fails.

These runs performed the workflow's run: steps on a local machine that was unable to reach api.osv.dev, and instead used an offline OSV-format database generated from the GitHub Advisory Database (8,034 reviewed npm advisories). There are some non-GitHub sources in the live OSV database which means CI counts may be a bit higher. Link to the GitHub Actions run is mentioned in the PR description.

## The two types of errors: False positives and False negatives

Those that we reported, but were not actually a risk:

- There are lots of findings that aren't deployed, like the desktop app (electron) and the docs site (astro). It is a true Advisory, but cannot be reached from our server. If there already exists one in there, it never blocks; if there's not one there, adding one there would block, and the fix would be upgrade (or dated exception).
- An advisory can impact a function that we never call, e.g., ReDoS in a parser option we don't use. OSV-Scanner does not compare code paths, it compares versions.

There are false negative results (the test is negative, but there is a real risk):

- Published advisories are the only ones known. Problems that were not reported or newly discovered, are not caught.
- After a package is on main, the advisories that are published after it is there will not fail a PR; the "before" scan will have them. This is detailed in the weekly report.
- A short commit hash is used for the git dependency ghostty-web and is omitted, as well as 3 local/workspace packages are omitted.
- As the comparison includes advisory IDs, a PR that removes one vulnerable copy of a package and adds another, with the same advisory ID, is not flagged.
- Scope is root bun.lock only.

## Changes from the design document plan (Section 4)

1. Official PR inlined. It is stated in the plan to use the official OSV-Scanner PR workflow. It only works on pull_request events (as it checks out GITHUB_BASE_REF which is empty on pushes), but the rules for the integration need the job to run and pass on main pushes and gate deployment. I added base selection to pushes / manual runs and left its scan-compare-report steps in a local reusable workflow. It also uploads SARIF to code scanning, which requires security-events: write. I removed that so the job remains read-only.
2. Scanner run as a pinned binary. The plan stated that it is to bind the OSV-Scanner action to a commit SHA. The reporter is pinned like this. The scanner is executed as the v2.7.0 release binary, with a SHA-256 check, rather than using the Docker action, since the Docker action hides the exit code, and a failed scan results in an empty results file. When the job was tested, it was found to be green when the database was not loaded. The plan's "a failed scan is not a clean result" rule works because of the use of the exit code.
3. Deployed server findings not fixed in this PR. The plan was to move to a triage process for packages/opencode direct dependencies, and to either upgrade them or apply dated exceptions. As of October 29 these are @modelcontextprotocol/sdk 1.29.0 (6 advisories), minimatch 10.0.3 (3), zod 4.1.8 (1) and diff 8.0.2 (1; not in the design doc's list). ws 8.21.0 has none. Upgrading them could change the behavior of the server, which requires their own PR, tests, and the check doesn't need them fixed in order to pass, so this PR just adds the check. They were all listed on the weekly report and no exceptions were added.
4. Numbers changed. As of 26th Oct, the design doc had reported 328 advisories for 67 packages. For the same lockfile, there are 344, distributed across 68, on October 29, due to new advisories. This is the case for which the weekly report was made.
5. Verification. It was said I would open a throwaway PR containing a known vulnerable package. Instead, the workflow steps were run on a throwaway commit that added one and then reverted (as shown above) and no throwaway PR remained in the repository. This PR's green GitHub Actions run is linked in the PR description.
