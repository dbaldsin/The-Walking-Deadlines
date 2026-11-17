// Links to each program's official documentation, shown in the permission
// prompt so the user can check the explanation. Links only ever point at the
// program's own site; a program missing from this table gets no link rather
// than a guessed one, and nothing the agent writes can add a link.

import { Flags } from "./flags"

const GIT = new Set([
  "add",
  "am",
  "apply",
  "bisect",
  "blame",
  "branch",
  "checkout",
  "cherry-pick",
  "clean",
  "clone",
  "commit",
  "config",
  "diff",
  "fetch",
  "grep",
  "init",
  "log",
  "merge",
  "mv",
  "pull",
  "push",
  "rebase",
  "reflog",
  "remote",
  "reset",
  "restore",
  "revert",
  "rm",
  "show",
  "stash",
  "status",
  "submodule",
  "switch",
  "tag",
  "worktree",
])

// npm subcommand (aliases already resolved) -> its page on docs.npmjs.com.
const NPM = new Map([
  ["install", "npm-install"],
  ["uninstall", "npm-uninstall"],
  ["run", "npm-run-script"],
  ["test", "npm-test"],
  ["start", "npm-start"],
  ["exec", "npm-exec"],
  ["ci", "npm-ci"],
  ["update", "npm-update"],
  ["publish", "npm-publish"],
  ["init", "npm-init"],
  ["audit", "npm-audit"],
  ["outdated", "npm-outdated"],
  ["ls", "npm-ls"],
  ["link", "npm-link"],
  ["pkg", "npm-pkg"],
  ["version", "npm-version"],
])

const PNPM = new Set(["add", "install", "remove", "update", "run", "test", "exec", "dlx", "publish"])
const YARN = new Set(["add", "install", "remove", "run", "dlx", "up", "init"])
const PIP = new Set(["install", "uninstall", "list", "show", "freeze", "download"])

const COREUTILS = [
  "rm",
  "rmdir",
  "mkdir",
  "touch",
  "cp",
  "mv",
  "chmod",
  "chown",
  "ls",
  "cat",
  "head",
  "tail",
  "pwd",
  "echo",
  "printf",
  "tee",
]

// Programs documented by one page.
const PAGES = new Map<string, string>([
  ...COREUTILS.map((name): [string, string] => [
    name,
    `https://www.gnu.org/software/coreutils/manual/html_node/${name}-invocation.html`,
  ]),
  ["grep", "https://www.gnu.org/software/grep/manual/grep.html"],
  ["find", "https://www.gnu.org/software/findutils/manual/html_mono/find.html"],
  ["wget", "https://www.gnu.org/software/wget/manual/wget.html"],
  ["make", "https://www.gnu.org/software/make/manual/make.html"],
  ["tar", "https://www.gnu.org/software/tar/manual/tar.html"],
  ["bash", "https://www.gnu.org/software/bash/manual/bash.html"],
  ["cd", "https://www.gnu.org/software/bash/manual/html_node/Bourne-Shell-Builtins.html"],
  ["sh", "https://pubs.opengroup.org/onlinepubs/9699919799/utilities/sh.html"],
  ["zsh", "https://zsh.sourceforge.io/Doc/"],
  ["less", "https://www.greenwoodsoftware.com/less/"],
  ["curl", "https://curl.se/docs/manpage.html"],
  ["kill", "https://man7.org/linux/man-pages/man1/kill.1.html"],
  ["pkill", "https://man7.org/linux/man-pages/man1/pkill.1.html"],
  ["killall", "https://man7.org/linux/man-pages/man1/killall.1.html"],
  ["npx", "https://docs.npmjs.com/cli/commands/npx"],
  ["bun", "https://bun.com/docs"],
  ["bunx", "https://bun.com/docs"],
  ["node", "https://nodejs.org/api/cli.html"],
  ["python", "https://docs.python.org/3/using/cmdline.html"],
  ["python3", "https://docs.python.org/3/using/cmdline.html"],
  ["deno", "https://docs.deno.com/runtime/reference/cli/"],
  ["tsx", "https://tsx.is/"],
  ["docker", "https://docs.docker.com/reference/cli/docker/"],
  ["rg", "https://github.com/BurntSushi/ripgrep/blob/master/GUIDE.md"],
])

// The official documentation for one command, given its own words (program first).
export function link(words: readonly string[]): string | undefined {
  const located = Flags.locate(words)
  const sub = located.sub ?? ""
  if (located.program === "git")
    return GIT.has(sub) ? `https://git-scm.com/docs/git-${sub}` : "https://git-scm.com/docs/git"
  if (located.program === "npm") return `https://docs.npmjs.com/cli/commands/${NPM.get(sub) ?? "npm"}`
  if (located.program === "pnpm") return PNPM.has(sub) ? `https://pnpm.io/cli/${sub}` : "https://pnpm.io/pnpm-cli"
  if (located.program === "yarn") return YARN.has(sub) ? `https://yarnpkg.com/cli/${sub}` : "https://yarnpkg.com/"
  if (located.program === "pip") {
    return PIP.has(sub) ? `https://pip.pypa.io/en/stable/cli/pip_${sub}/` : "https://pip.pypa.io/en/stable/cli/"
  }
  return PAGES.get(located.program)
}

export * as Docs from "./docs"
