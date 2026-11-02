# Sangyoon — P3B Hadolint integration

## Tool and scope

Hadolint v2.15.1 statically checks the root `Dockerfile`, which `deploy-vm.yml` builds with `docker compose up --build` on every main deployment. It parses each instruction against Hadolint's DL rules and runs ShellCheck on every `RUN` command. The other eight Dockerfiles in the repository (`packages/opencode/Dockerfile`, `packages/containers/*`, `.devcontainer/Dockerfile` and others) come from upstream opencode and are never built for our VM, so they are out of scope.

## Installation evidence

- `.github/workflows/test.yml` adds the `dockerfile-lint` job. It uses `hadolint/hadolint-action` v3.5.0, pinned to commit `06be81baf89a55ffd0e24b8f04a4185738dd3387`; that action's image pins hadolint v2.15.1 by digest.
- `.github/workflows/test.yml` adds `dockerfile-lint` to `jobs.deploy.needs`, so a failing Dockerfile check skips deployment.
- `.hadolint.yaml` holds the configuration.
- `Dockerfile` pins both base images by digest and documents the DL3008 exception inline.

No package, lockfile or secret was added; the job only needs `contents: read`.

## Customization

- **Runs on** GitHub-hosted `ubuntu-latest` for every pull request, push and manual run of `test.yml`, including documentation-only changes, so the required status is never left pending. It never runs on the VM's self-hosted runner.
- **Timeout:** three minutes. The job takes about ten seconds.
- **Missing file:** a preceding step fails with an explicit error if the root `Dockerfile` is missing, instead of letting the action fail obscurely or skip.
- **Failure threshold:** `warning`. Errors and warnings fail the job; info and style findings are printed only. The action sets `HADOLINT_FAILURE_THRESHOLD=info` by default, and that environment variable takes precedence over the config file, so the workflow passes `failure-threshold: warning` explicitly as well.
- **Trusted registries:** `docker.io` only. A `FROM` line pulling from any other registry fails with DL3026, so the deployed image cannot silently switch to an unreviewed source.
- **Base images** are pinned by digest (`oven/bun:1.3.14@sha256:e105…`, `debian:bookworm-slim@sha256:99c0…`). The tags are kept next to the digests for readability.
- **DL3008 exception:** "pin versions in apt-get install" is ignored with `# hadolint ignore=DL3008` directly above each of the two `apt-get install` instructions, with the reason and a review date (base image bump, or 2027-01-31 at the latest). Debian removes superseded package versions from its mirrors, so exact apt pins would break future rebuilds; pinning the base image digest gives reproducibility instead.

Run locally from the repository root:

```sh
docker run --rm -v "$PWD:/repo" -w /repo hadolint/hadolint:v2.15.1 hadolint --failure-threshold warning Dockerfile
```

## Evidence and sensitivity check

- [Clean run on this PR](sangyoon-hadolint-pass.txt): no findings, job succeeded.
- [Deliberate violation](sangyoon-hadolint-fail.txt): throwaway PR #46 removed `-y` from the runtime stage's `apt-get install`. The job failed with `Dockerfile:37 DL3014 warning`, shown inline on the PR. The PR was closed without merging.

## False positives, false negatives, and plan changes

The only findings on the unchanged Dockerfile were the two expected DL3008 warnings from the P3A trial run. They are true findings, not false positives, but pinning apt versions is the wrong fix for this image, so they are documented exceptions. No other warnings, errors or ShellCheck problems were reported, and the Docker Hub-only registry rule did not flag our implicit Docker Hub images.

Hadolint cannot catch everything. It only checks how the Dockerfile is written. It cannot tell whether the image builds, whether `opencode web` starts, or whether the site works, which remain covered by the deploy readiness check. It does not inspect installed packages for vulnerabilities, and it does not flag the runtime stage running as root, because no `USER` instruction exists for DL3002 to check.

Changes from the P3A plan:

- The DL3008 exception is an inline ignore on the two affected instructions rather than an entry in `.hadolint.yaml`. A config-level ignore would also silence any new unpinned `apt-get install` added later; the inline form forces each new one to be reviewed.
- `.hadolint.yaml` also carries the failure threshold and the trusted-registry rule, not only exceptions, so local runs match CI.
- The throwaway PR used DL3014 (missing `-y`), as planned.
- Moving the runtime stage to a non-root user is still under review. It affects the mounted data volumes and needs a test on the VM first, so it is not part of this PR.
