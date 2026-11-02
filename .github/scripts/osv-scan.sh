#!/usr/bin/env bash
# Scan the root bun.lock with OSV-Scanner and write JSON results to $1.
#
# osv-scanner exits 0 (no vulnerabilities) or 1 (vulnerabilities found) when a
# scan completes. Any other code (127 = general error, 128 = no packages,
# 130 = invalid config) means it did not complete. It can still write a
# results file in that case, which looks like a clean scan, so the exit code is
# what this script checks.
set -uo pipefail

out="${1:?usage: osv-scan.sh <results.json>}"
scanner="${OSV_SCANNER:-osv-scanner}"

"$scanner" scan source --format=json --output-file="$out" --lockfile=./bun.lock
rc=$?

case "$rc" in
  0) echo "OSV-Scanner finished: no known vulnerabilities." ;;
  1) echo "OSV-Scanner finished: known vulnerabilities found (compared in a later step)." ;;
  *)
    echo "::error::OSV-Scanner did not complete (exit code ${rc}). Not treating this as a clean result."
    rm -f "$out"
    exit 1
    ;;
esac
