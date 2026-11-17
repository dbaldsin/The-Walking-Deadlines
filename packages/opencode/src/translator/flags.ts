// Plain-language meanings of common command-line flags, shown in the permission
// prompt next to the command. The same table tells the dangerous-command
// matcher that `-rf`, `-fr`, `-r -f` and `--recursive --force` are the same
// flags, so a pattern matches however the agent spelled them.

export type Entry = {
  // Every spelling of the flag. The first one is the canonical spelling.
  names: readonly string[]
  meaning: string
}

export type Flag = {
  flag: string
  meaning: string
}

// Shown for a flag the table does not know, so it is never silently skipped.
export const UNEXPLAINED = "not explained here; check the documentation link"

const TABLE = new Map<string, readonly Entry[]>([
  [
    "rm",
    [
      { names: ["-r", "-R", "--recursive"], meaning: "deletes folders and everything inside them" },
      {
        names: ["-f", "--force"],
        meaning: "deletes without asking, even write-protected files, and ignores missing ones",
      },
      { names: ["-i"], meaning: "asks before deleting each file" },
      { names: ["-I"], meaning: "asks once before deleting more than three files or any folder" },
      { names: ["-d", "--dir"], meaning: "also deletes empty folders" },
      { names: ["-v", "--verbose"], meaning: "lists each file as it is deleted" },
      { names: ["-P"], meaning: "overwrites files before deleting them (macOS)" },
      { names: ["-W"], meaning: "tries to bring back deleted files instead (macOS)" },
      { names: ["-x"], meaning: "stays on the current disk (macOS)" },
      { names: ["--one-file-system"], meaning: "stays on the current disk" },
      { names: ["--no-preserve-root"], meaning: "allows deleting the whole system, starting at /" },
    ],
  ],
  [
    "rmdir",
    [
      { names: ["-p", "--parents"], meaning: "also deletes the parent folders if they become empty" },
      { names: ["-v", "--verbose"], meaning: "lists each folder as it is deleted" },
    ],
  ],
  [
    "mkdir",
    [
      {
        names: ["-p", "--parents"],
        meaning: "also creates missing parent folders, and does nothing if the folder exists",
      },
      { names: ["-v", "--verbose"], meaning: "lists each folder as it is created" },
    ],
  ],
  [
    "touch",
    [
      { names: ["-a"], meaning: "only changes the last-opened time" },
      { names: ["-m"], meaning: "only changes the last-modified time" },
      { names: ["-c", "--no-create"], meaning: "does not create the file if it is missing" },
    ],
  ],
  [
    "cp",
    [
      { names: ["-r", "-R", "--recursive"], meaning: "copies folders and everything inside them" },
      { names: ["-f", "--force"], meaning: "overwrites existing files without asking" },
      { names: ["-i", "--interactive"], meaning: "asks before overwriting a file" },
      { names: ["-n", "--no-clobber"], meaning: "never overwrites an existing file" },
      { names: ["-v", "--verbose"], meaning: "lists each file as it is copied" },
      { names: ["-p"], meaning: "keeps the files' timestamps and permissions" },
      { names: ["-a", "--archive"], meaning: "copies folders exactly, keeping links, timestamps and permissions" },
    ],
  ],
  [
    "mv",
    [
      { names: ["-f", "--force"], meaning: "overwrites existing files without asking" },
      { names: ["-i", "--interactive"], meaning: "asks before overwriting a file" },
      { names: ["-n", "--no-clobber"], meaning: "never overwrites an existing file" },
      { names: ["-v", "--verbose"], meaning: "lists each file as it is moved" },
    ],
  ],
  [
    "ls",
    [
      { names: ["-l"], meaning: "shows details such as size, owner, permissions and date" },
      { names: ["-a", "--all"], meaning: "includes hidden files (names starting with a dot)" },
      { names: ["-A", "--almost-all"], meaning: "includes hidden files, except . and .." },
      { names: ["-h", "--human-readable"], meaning: "shows sizes in KB, MB and GB" },
      { names: ["-R", "--recursive"], meaning: "also lists everything inside subfolders" },
      { names: ["-t"], meaning: "sorts by last-modified time, newest first" },
      { names: ["-r", "--reverse"], meaning: "reverses the sort order" },
      { names: ["-S"], meaning: "sorts by size, largest first" },
      { names: ["-1"], meaning: "shows one name per line" },
      { names: ["-d", "--directory"], meaning: "lists folders themselves, not what is inside them" },
      { names: ["-F", "--classify"], meaning: "marks folders with / and programs with *" },
    ],
  ],
  [
    "chmod",
    [
      { names: ["-R", "--recursive"], meaning: "also changes everything inside folders" },
      { names: ["-v", "--verbose"], meaning: "lists every file it changes" },
      { names: ["-c", "--changes"], meaning: "lists only the files it actually changes" },
    ],
  ],
  [
    "chown",
    [
      { names: ["-R", "--recursive"], meaning: "also changes everything inside folders" },
      { names: ["-v", "--verbose"], meaning: "lists every file it changes" },
      { names: ["-h", "--no-dereference"], meaning: "changes links themselves, not the files they point to" },
    ],
  ],
  ["cat", [{ names: ["-n", "--number"], meaning: "numbers every line" }]],
  [
    "head",
    [
      { names: ["-n", "--lines"], meaning: "sets how many lines to show" },
      { names: ["-c", "--bytes"], meaning: "sets how many bytes to show" },
    ],
  ],
  [
    "tail",
    [
      { names: ["-n", "--lines"], meaning: "sets how many lines to show" },
      { names: ["-c", "--bytes"], meaning: "sets how many bytes to show" },
      { names: ["-f", "--follow"], meaning: "keeps running and shows new lines as they are added" },
    ],
  ],
  [
    "echo",
    [
      { names: ["-n"], meaning: "does not add a line break at the end" },
      { names: ["-e"], meaning: "turns escapes such as \\n into real line breaks" },
    ],
  ],
  ["tee", [{ names: ["-a", "--append"], meaning: "adds to the end of the file instead of replacing it" }]],
  [
    "grep",
    [
      { names: ["-r", "-R", "--recursive"], meaning: "searches every file inside folders" },
      { names: ["-i", "--ignore-case"], meaning: "ignores upper and lower case" },
      { names: ["-n", "--line-number"], meaning: "shows line numbers" },
      { names: ["-v", "--invert-match"], meaning: "shows the lines that do not match" },
      { names: ["-l", "--files-with-matches"], meaning: "only lists the names of matching files" },
      { names: ["-c", "--count"], meaning: "only counts the matching lines" },
      { names: ["-w", "--word-regexp"], meaning: "only matches whole words" },
      { names: ["-E", "--extended-regexp"], meaning: "treats the search text as an extended regular expression" },
      { names: ["-F", "--fixed-strings"], meaning: "treats the search text as plain text, not a pattern" },
      { names: ["-o", "--only-matching"], meaning: "shows only the matching part of each line" },
      { names: ["-q", "--quiet"], meaning: "prints nothing and only reports whether anything matched" },
    ],
  ],
  [
    "find",
    [
      { names: ["-name"], meaning: "matches file names against the next word" },
      { names: ["-iname"], meaning: "matches file names, ignoring upper and lower case" },
      { names: ["-type"], meaning: "only matches files (f) or folders (d)" },
      { names: ["-delete"], meaning: "permanently deletes every match" },
      { names: ["-exec"], meaning: "runs the following command on every match" },
      { names: ["-maxdepth"], meaning: "limits how many folders deep it looks" },
      { names: ["-mtime"], meaning: "matches by how many days ago files were changed" },
      { names: ["-size"], meaning: "matches by file size" },
      { names: ["-path"], meaning: "matches the whole path against the next word" },
      { names: ["-print"], meaning: "prints each match" },
      { names: ["-empty"], meaning: "only matches empty files and folders" },
    ],
  ],
  [
    "curl",
    [
      { names: ["-L", "--location"], meaning: "follows redirects to the final address" },
      { names: ["-o", "--output"], meaning: "saves the download to the named file" },
      { names: ["-O", "--remote-name"], meaning: "saves the download under its original file name" },
      { names: ["-s", "--silent"], meaning: "hides progress and error messages" },
      { names: ["-S", "--show-error"], meaning: "still shows errors when silent" },
      { names: ["-f", "--fail"], meaning: "fails on HTTP errors instead of saving the error page" },
      { names: ["-X", "--request"], meaning: "uses the given request method, such as POST" },
      { names: ["-H", "--header"], meaning: "sends an extra header" },
      { names: ["-d", "--data"], meaning: "sends data in the request body" },
      { names: ["-k", "--insecure"], meaning: "skips checking the site's security certificate" },
      { names: ["-I", "--head"], meaning: "only fetches the response headers" },
      { names: ["-v", "--verbose"], meaning: "shows the full request and response" },
    ],
  ],
  [
    "wget",
    [
      { names: ["-O", "--output-document"], meaning: "saves the download to the named file" },
      { names: ["-q", "--quiet"], meaning: "prints nothing while downloading" },
      { names: ["-r", "--recursive"], meaning: "also downloads the pages it links to" },
    ],
  ],
  [
    "kill",
    [
      { names: ["-9", "-KILL"], meaning: "forces the process to stop immediately, without cleaning up" },
      { names: ["-15", "-TERM"], meaning: "asks the process to stop (the default)" },
    ],
  ],
  [
    "pkill",
    [
      { names: ["-f", "--full"], meaning: "matches the whole command line, not just the program name" },
      { names: ["-9"], meaning: "forces the processes to stop immediately" },
    ],
  ],
  ["killall", [{ names: ["-9"], meaning: "forces the processes to stop immediately" }]],
  [
    "git",
    [
      { names: ["-C"], meaning: "runs git as if it was started in the given folder" },
      { names: ["-c"], meaning: "changes a git setting for this run only" },
      { names: ["--no-pager"], meaning: "prints the output directly instead of in a scrollable view" },
    ],
  ],
  [
    "git add",
    [
      { names: ["-A", "--all"], meaning: "stages every change, including deleted files" },
      { names: ["-u", "--update"], meaning: "only stages changes to files git already tracks" },
      { names: ["-p", "--patch"], meaning: "lets you choose which changes to stage" },
      { names: ["-f", "--force"], meaning: "also stages files git is told to ignore" },
      { names: ["-n", "--dry-run"], meaning: "only shows what would be staged" },
    ],
  ],
  [
    "git commit",
    [
      { names: ["-m", "--message"], meaning: "uses the next words as the commit message" },
      { names: ["-a", "--all"], meaning: "includes every change to files git already tracks" },
      { names: ["--amend"], meaning: "replaces the most recent commit" },
      { names: ["--no-verify", "-n"], meaning: "skips the project's pre-commit checks" },
      { names: ["-s", "--signoff"], meaning: "adds a Signed-off-by line" },
      { names: ["-v", "--verbose"], meaning: "shows the changes while you write the message" },
    ],
  ],
  [
    "git push",
    [
      { names: ["--force", "-f"], meaning: "overwrites the remote branch's history, even if others pushed to it" },
      {
        names: ["--force-with-lease"],
        meaning: "overwrites the remote history, but only if nobody else pushed since you last downloaded",
      },
      { names: ["-u", "--set-upstream"], meaning: "remembers this remote branch for future pushes and pulls" },
      { names: ["--tags"], meaning: "also uploads your tags" },
      { names: ["--all"], meaning: "uploads every branch" },
      { names: ["-d", "--delete"], meaning: "deletes the branch on the remote" },
      { names: ["-n", "--dry-run"], meaning: "only shows what would be uploaded" },
      { names: ["--no-verify"], meaning: "skips the project's pre-push checks" },
    ],
  ],
  [
    "git pull",
    [
      { names: ["--rebase", "-r"], meaning: "replays your commits on top of the downloaded ones instead of merging" },
      { names: ["--ff-only"], meaning: "only updates if no merge is needed" },
      { names: ["--no-rebase"], meaning: "merges the downloaded changes into your branch" },
    ],
  ],
  [
    "git fetch",
    [
      { names: ["--all"], meaning: "downloads from every remote" },
      { names: ["-p", "--prune"], meaning: "forgets remote branches that were deleted" },
      { names: ["--tags"], meaning: "also downloads tags" },
    ],
  ],
  [
    "git reset",
    [
      { names: ["--hard"], meaning: "throws away all uncommitted changes to tracked files" },
      { names: ["--soft"], meaning: "keeps your changes staged" },
      { names: ["--mixed"], meaning: "keeps your changes but unstages them (the default)" },
      { names: ["--keep"], meaning: "keeps uncommitted changes, and stops if they would be lost" },
      { names: ["-q", "--quiet"], meaning: "prints less" },
    ],
  ],
  [
    "git checkout",
    [
      { names: ["-b"], meaning: "creates a new branch with the next name" },
      { names: ["-B"], meaning: "creates the branch, or resets it if it already exists" },
      { names: ["-f", "--force"], meaning: "switches even if that throws away uncommitted changes" },
    ],
  ],
  [
    "git switch",
    [
      { names: ["-c", "--create"], meaning: "creates a new branch with the next name" },
      { names: ["-C", "--force-create"], meaning: "creates the branch, or resets it if it already exists" },
      { names: ["-d", "--detach"], meaning: "switches to a commit without a branch" },
      {
        names: ["-f", "--force", "--discard-changes"],
        meaning: "switches even if that throws away uncommitted changes",
      },
    ],
  ],
  [
    "git branch",
    [
      { names: ["-d", "--delete"], meaning: "deletes a branch that has been merged" },
      { names: ["-D"], meaning: "deletes a branch even if its work was never merged" },
      { names: ["-a", "--all"], meaning: "also lists remote branches" },
      { names: ["-r", "--remotes"], meaning: "lists remote branches" },
      { names: ["-m", "--move"], meaning: "renames a branch" },
      { names: ["-M"], meaning: "renames a branch, replacing any branch that already has the new name" },
      { names: ["-v", "--verbose"], meaning: "shows the latest commit on each branch" },
    ],
  ],
  [
    "git clean",
    [
      { names: ["-f", "--force"], meaning: "actually deletes the files (git refuses without it)" },
      { names: ["-d"], meaning: "also deletes untracked folders" },
      { names: ["-x"], meaning: "also deletes files git is told to ignore, such as build output and .env files" },
      { names: ["-X"], meaning: "only deletes files git is told to ignore" },
      { names: ["-n", "--dry-run"], meaning: "only shows what would be deleted" },
      { names: ["-i", "--interactive"], meaning: "asks what to delete" },
    ],
  ],
  [
    "git log",
    [
      { names: ["--oneline"], meaning: "shows one line per commit" },
      { names: ["--graph"], meaning: "draws the branch history" },
      { names: ["--all"], meaning: "includes every branch" },
      { names: ["-p", "--patch"], meaning: "shows the changes in each commit" },
      { names: ["--stat"], meaning: "shows how many lines changed in each file" },
      { names: ["-n"], meaning: "limits how many commits to show" },
    ],
  ],
  [
    "git diff",
    [
      { names: ["--staged", "--cached"], meaning: "shows the staged changes" },
      { names: ["--stat"], meaning: "shows how many lines changed in each file" },
      { names: ["--name-only"], meaning: "only lists the changed files" },
    ],
  ],
  [
    "git status",
    [
      { names: ["-s", "--short"], meaning: "shows a shorter summary" },
      { names: ["-b", "--branch"], meaning: "also shows the branch" },
      { names: ["--porcelain"], meaning: "prints a fixed format meant for scripts" },
    ],
  ],
  [
    "git stash",
    [
      { names: ["-u", "--include-untracked"], meaning: "also sets aside new files" },
      { names: ["-a", "--all"], meaning: "also sets aside ignored files" },
      { names: ["-m", "--message"], meaning: "labels the saved changes with the next words" },
    ],
  ],
  [
    "git rebase",
    [
      { names: ["-i", "--interactive"], meaning: "lets you edit, reorder or drop commits" },
      { names: ["--continue"], meaning: "continues after you fix a conflict" },
      { names: ["--abort"], meaning: "cancels the rebase and puts the branch back" },
      { names: ["--onto"], meaning: "moves the commits onto another starting point" },
    ],
  ],
  [
    "git merge",
    [
      { names: ["--no-ff"], meaning: "always creates a merge commit" },
      { names: ["--ff-only"], meaning: "only updates if no merge commit is needed" },
      { names: ["--squash"], meaning: "combines the branch's changes without keeping its history" },
      { names: ["--abort"], meaning: "cancels the merge and puts the branch back" },
    ],
  ],
  [
    "git clone",
    [
      { names: ["--depth"], meaning: "only downloads the most recent commits" },
      { names: ["-b", "--branch"], meaning: "checks out the named branch" },
      { names: ["--recursive", "--recurse-submodules"], meaning: "also downloads submodules" },
    ],
  ],
  [
    "git restore",
    [
      { names: ["--staged", "-S"], meaning: "unstages the files instead of discarding their changes" },
      { names: ["--source", "-s"], meaning: "restores the files from the given commit" },
    ],
  ],
  [
    "git revert",
    [
      { names: ["--no-edit"], meaning: "uses the default commit message" },
      { names: ["-n", "--no-commit"], meaning: "undoes the changes without committing" },
    ],
  ],
  [
    "npm install",
    [
      { names: ["-D", "--save-dev"], meaning: "adds it as a development-only dependency" },
      { names: ["-g", "--global"], meaning: "installs it for your whole computer, not just this project" },
      { names: ["-E", "--save-exact"], meaning: "pins the exact version instead of allowing updates" },
      { names: ["-O", "--save-optional"], meaning: "adds it as an optional dependency" },
      { names: ["-P", "--save-prod"], meaning: "adds it as a regular dependency" },
      { names: ["-S", "--save"], meaning: "adds it to package.json (the default)" },
      { names: ["--no-save"], meaning: "installs it without adding it to package.json" },
      { names: ["-f", "--force"], meaning: "installs even if it conflicts with what is already installed" },
      { names: ["--legacy-peer-deps"], meaning: "ignores conflicts between the packages' requirements" },
      { names: ["--dry-run"], meaning: "only shows what would be installed" },
    ],
  ],
  [
    "npm uninstall",
    [
      { names: ["-D", "--save-dev"], meaning: "removes it from the development-only dependencies" },
      { names: ["-g", "--global"], meaning: "removes it from your whole computer" },
      { names: ["--no-save"], meaning: "removes it without changing package.json" },
    ],
  ],
  [
    "bun add",
    [
      { names: ["-d", "-D", "--dev", "--development"], meaning: "adds it as a development-only dependency" },
      { names: ["-g", "--global"], meaning: "installs it for your whole computer, not just this project" },
      { names: ["-E", "--exact"], meaning: "pins the exact version instead of allowing updates" },
      { names: ["--optional"], meaning: "adds it as an optional dependency" },
      { names: ["--peer"], meaning: "adds it as a peer dependency" },
    ],
  ],
  [
    "bun install",
    [
      { names: ["--frozen-lockfile"], meaning: "fails instead of changing the lockfile" },
      { names: ["-p", "--production"], meaning: "skips development-only dependencies" },
      { names: ["-g", "--global"], meaning: "installs it for your whole computer, not just this project" },
    ],
  ],
  ["bun remove", [{ names: ["-g", "--global"], meaning: "removes it from your whole computer" }]],
  [
    "pnpm add",
    [
      { names: ["-D", "--save-dev"], meaning: "adds it as a development-only dependency" },
      { names: ["-g", "--global"], meaning: "installs it for your whole computer, not just this project" },
      { names: ["-E", "--save-exact"], meaning: "pins the exact version instead of allowing updates" },
      { names: ["-O", "--save-optional"], meaning: "adds it as an optional dependency" },
    ],
  ],
  ["pnpm install", [{ names: ["--frozen-lockfile"], meaning: "fails instead of changing the lockfile" }]],
  [
    "yarn add",
    [
      { names: ["-D", "--dev"], meaning: "adds it as a development-only dependency" },
      { names: ["-E", "--exact"], meaning: "pins the exact version instead of allowing updates" },
      { names: ["-O", "--optional"], meaning: "adds it as an optional dependency" },
      { names: ["-P", "--peer"], meaning: "adds it as a peer dependency" },
    ],
  ],
  [
    "pip install",
    [
      { names: ["-r", "--requirement"], meaning: "installs every package listed in the named file" },
      { names: ["-U", "--upgrade"], meaning: "upgrades packages that are already installed" },
      {
        names: ["-e", "--editable"],
        meaning: "installs the project so your code changes take effect without reinstalling",
      },
      { names: ["--user"], meaning: "installs into your user folder instead of for everyone" },
      { names: ["-q", "--quiet"], meaning: "prints less" },
    ],
  ],
  ["pip uninstall", [{ names: ["-y", "--yes"], meaning: "removes without asking for confirmation" }]],
  [
    "docker system prune",
    [
      { names: ["-a", "--all"], meaning: "also removes every image that no container uses" },
      { names: ["-f", "--force"], meaning: "does not ask for confirmation" },
      { names: ["--volumes"], meaning: "also removes unused volumes and the data in them" },
    ],
  ],
])

// Other spellings package managers accept for the same subcommand.
const ALIASES = new Map<string, Map<string, string>>([
  [
    "npm",
    new Map([
      ["i", "install"],
      ["in", "install"],
      ["add", "install"],
      ["un", "uninstall"],
      ["remove", "uninstall"],
      ["rm", "uninstall"],
      ["r", "uninstall"],
      ["unlink", "uninstall"],
      ["run-script", "run"],
      ["t", "test"],
      ["x", "exec"],
    ]),
  ],
  [
    "pnpm",
    new Map([
      ["i", "install"],
      ["rm", "remove"],
      ["un", "remove"],
      ["uninstall", "remove"],
      ["t", "test"],
      ["up", "update"],
    ]),
  ],
  [
    "bun",
    new Map([
      ["i", "install"],
      ["a", "add"],
      ["rm", "remove"],
    ]),
  ],
])

// git's own options come before its subcommand; these take the next word as their value.
const GIT_VALUES = ["-C", "-c", "--git-dir", "--work-tree", "--namespace"]

// Finds the program, its subcommand (with aliases resolved) and the flag table
// that applies, trying "program sub sub2", then "program sub", then "program".
// `words` are the command's own words, program first.
export function locate(words: readonly string[]) {
  const first = words[0]?.split("/").pop()?.toLowerCase() ?? ""
  const program = first === "pip3" ? "pip" : first
  const rest = program === "git" ? subcommand(words.slice(1)) : words.slice(1)
  const [sub, next] = rest.filter((word) => !word.startsWith("-"))
  const command = (sub && ALIASES.get(program)?.get(sub)) ?? sub
  const key = [`${program} ${command} ${next}`, `${program} ${command}`, program].find((item) => TABLE.has(item))
  const entries = key ? (TABLE.get(key) ?? []) : []
  // A subcommand also accepts the program's own flags (git's -C).
  return {
    program,
    sub: command,
    rest,
    entries: key === program ? entries : [...entries, ...(TABLE.get(program) ?? [])],
  }
}

// Explains each flag of one command. Combined short flags (`-rf`) are explained
// one by one; a flag the table does not know is still listed, as unexplained.
export function explain(words: readonly string[]): Flag[] {
  const entries = locate(words).entries
  const flags = options(words.slice(1)).flatMap((word) => split(word, entries))
  return flags
    .filter((flag, index) => flags.indexOf(flag) === index)
    .map((flag) => ({ flag, meaning: find(entries, flag)?.meaning ?? UNEXPLAINED }))
}

// The command's words and its flags in one canonical spelling, for matching
// dangerous-command patterns: `-fr`, `-r -f` and `--recursive --force` all give
// the flags {-r, -f}. git's own options (`-C repo`) are left out.
export function normalize(words: readonly string[]) {
  const located = locate(words)
  const end = located.rest.indexOf("--")
  const own = end === -1 ? located.rest : located.rest.slice(0, end)
  return {
    words: [
      located.program,
      ...own.filter((word) => !word.startsWith("-") || word === "-"),
      ...(end === -1 ? [] : located.rest.slice(end + 1)),
    ],
    flags: new Set(
      options(located.rest)
        .flatMap((word) => split(word, located.entries))
        .map((flag) => find(located.entries, flag)?.names[0] ?? flag),
    ),
  }
}

function subcommand(words: readonly string[]) {
  const index = words.findIndex((word, i) => !word.startsWith("-") && !GIT_VALUES.includes(words[i - 1] ?? ""))
  return index === -1 ? [] : words.slice(index)
}

// Words that are flags: everything starting with "-" before a bare "--".
function options(words: readonly string[]) {
  const end = words.indexOf("--")
  return (end === -1 ? words : words.slice(0, end)).filter((word) => word.startsWith("-") && word !== "-")
}

// `-rf` is two flags when the command knows both letters as flags. A word the
// table lists as a whole (find's `-delete`) or an unknown cluster stays as written.
function split(word: string, entries: readonly Entry[]) {
  const name = word.startsWith("--") ? word.split("=")[0] : word
  if (name.startsWith("--") || name.length <= 2 || find(entries, name)) return [name]
  const letters = Array.from(name.slice(1), (letter) => `-${letter}`)
  return letters.every((letter) => find(entries, letter)) ? letters : [name]
}

function find(entries: readonly Entry[], flag: string) {
  return entries.find((entry) => entry.names.includes(flag))
}

export * as Flags from "./flags"
