# P3B team integration and final submission

## Shared setup

`test.yml` is the entry point for pull requests, pushes and manual runs. It runs the existing unit suite (including Dion's fast-check properties), browser smoke/user-story tests, generated-client consistency, and reusable typecheck workflow. Only a successful main push or main manual run can call the reusable VM deployment workflow. Deployment checks out the same `github.sha` that was validated. A failure or skipped prerequisite prevents deployment. PRs and other branches never run the VM job.

To retry deployment, manually run **test** on main; validation runs again first. **deploy-vm** can no longer be dispatched independently. Main runs are not cancelled by a newer push; deployment remains serialized. Existing scheduled browser regression coverage remains separate.

The two historical browser scenarios now set their date before the September 14, 2026 old-interface retirement. Both failures were reproduced before the fix; six tests in the affected files pass afterward. The production retirement behavior is unchanged.

## Every remaining owner

| Owner | New check |
| --- | --- |
| Jassim | actionlint for workflows |
| Rashid | Gitleaks for committed credentials |
| Saif | OSV-Scanner for root bun.lock |
| Sangyoon | Hadolint for root deployment Dockerfile |

- Implement the planned check in your own branch and PR to main.
- Add your blocking job to `test.yml` (a local reusable workflow is fine). Keep it on hosted runners with no deployment credentials; run it on all PRs and main pushes, including documentation-only changes.
- Add its **job ID** to `jobs.deploy.needs` in `test.yml`. Do not merge a new blocking check without connecting it to deployment.
- Confirm green execution and deliberate failure detection, then remove the temporary bad fixture.
- Include installation/configuration files, run evidence, customization/process/false-positive discussion, and plan changes in your PR. Update your design section.
- After a real green status exists, add its **exact check-run name** to main's required status checks, preserving the existing required checks. Job IDs in `needs` and displayed status names are different fields.
- Merge, then individually submit your merged PR URL to Gradescope's **P3B - Tool Analysis (Individual)**.

Dion's contribution is already merged in PR #42 and submitted individually.

## Final group verification

1. Confirm all five additions are on main, all blocking jobs are dependencies of deployment, and their exact statuses are required on main.
2. Finalize the design document to describe the configuration actually merged, including any accepted exceptions.
3. Get one green **test** run on main showing all five tools plus the completed deployment. If no new push is needed, dispatch **test** on main.
4. Submit https://github.com/dbaldsin/The-Walking-Deadlines as Q1 and that final run URL as Q2 in **P3B - Tool Integration (Group)** on Gradescope.
5. Include all five teammates in the Gradescope group and verify each individual submission separately.

Do not submit an earlier baseline run as proof of the four checks that are still unimplemented. Deadline: November 2, 2026, 11:59 PM Qatar time.
