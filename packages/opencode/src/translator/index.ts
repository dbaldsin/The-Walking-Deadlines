// Plain-language explanations for permission requests.
//
// `what` is derived deterministically from the command or diff so the model
// cannot misdescribe the action; `why` is the model-supplied `reason` tool
// parameter. Both are shown to the user in the permission prompt.

export type Explanation = {
  what: string
  why?: string
}

type Redirect = {
  stream: string
  append: boolean
  read: boolean
  target?: string
}

type Step = {
  words: string[]
  redirects: Redirect[]
}

const MAX_STEPS = 3

// Quoted strings stay one token; `&&`, `||`, `;`, `|` and `&` separate steps.
// File descriptor duplications such as `2>&1` are matched first so they can be
// dropped; every other redirection operator takes the next word as its target.
const TOKEN =
  /(\d*[<>]&(?:\d+|-))|(&>>?|>&|\d*>>|\d*>\|?|\d*<)|"((?:[^"\\]|\\.)*)"|'([^']*)'|(&&|\|\||[;|&\n])|([^\s"';|&<>]+)/g

// Command and process substitution, heredocs, and subshells can hide arbitrary
// side effects, so commands using them are not summarized step by step.
const UNSAFE = /\$\(|`|[<>]\(|<<|(^|[\s;&|])\(/

// Redirecting output to these does not change any file.
const SINKS = ["/dev/null", "/dev/stdout", "/dev/stderr"]

const UNSUMMARIZED = "Runs a shell command that is too complex to summarize safely. Review the full command before allowing it"

export function shell(command: string, reason?: string): Explanation | undefined {
  const parsed = parse(command)
  if (!parsed) return { what: UNSUMMARIZED, why: why(reason) }
  const steps = parsed.map(summarize).filter((item) => item.length > 0)
  if (steps.length === 0) return undefined
  const shown = steps.slice(0, MAX_STEPS).map((item, index) => (index === 0 ? item : lower(item)))
  const rest = steps.length - shown.length
  const what = shown.join(", then ") + (rest > 0 ? `, and ${rest} more ${rest === 1 ? "step" : "steps"}` : "")
  return { what, why: why(reason) }
}

export function edit(filepath: string, diff: string, reason?: string): Explanation {
  return { what: `Edits ${filepath} (${changes(diff)})`, why: why(reason) }
}

export function write(filepath: string, exists: boolean, diff: string, reason?: string): Explanation {
  if (!exists) return { what: `Creates the new file ${filepath} (${plural(count(diff, "+"), "line")})`, why: why(reason) }
  return { what: `Replaces the contents of ${filepath} (${changes(diff)})`, why: why(reason) }
}

function why(reason?: string) {
  const value = reason?.trim()
  return value ? value : undefined
}

function parse(command: string) {
  if (UNSAFE.test(command)) return undefined
  // Anything the tokenizer skips, such as an unmatched quote, means the parse cannot be trusted.
  if (command.replace(TOKEN, "").trim()) return undefined
  const steps = Array.from(command.matchAll(TOKEN)).reduce<Step[]>(
    (acc, match) => {
      const current = acc[acc.length - 1]
      if (match[1] !== undefined) return acc
      if (match[5] !== undefined) return [...acc, { words: [], redirects: [] }]
      if (match[2] !== undefined) {
        current.redirects.push(redirect(match[2]))
        return acc
      }
      const value = match[3] ?? match[4] ?? match[6] ?? ""
      const pending = current.redirects.find((item) => item.target === undefined)
      if (pending) pending.target = value
      else current.words.push(value)
      return acc
    },
    [{ words: [], redirects: [] }],
  )
  // A redirection with no target (`cat a >` or `cat a > ; ls`) is not something we can describe.
  if (steps.some((item) => item.redirects.some((entry) => entry.target === undefined))) return undefined
  return steps.filter((item) => item.words.length > 0 || item.redirects.length > 0)
}

function redirect(op: string): Redirect {
  const stream =
    op.startsWith("&") || op === ">&"
      ? "the output and error messages"
      : op.startsWith("2")
        ? "the error messages"
        : "the output"
  return { stream, append: op.includes(">>"), read: op.endsWith("<") }
}

function summarize(item: Step) {
  const action = describe(item.words)
  const writes = item.redirects.filter((entry) => !entry.read && !SINKS.includes(entry.target ?? ""))
  if (writes.length === 0) return action
  if (!action) {
    return writes
      .map((entry) => (entry.append ? `Creates ${entry.target} if it does not exist` : `Empties ${entry.target} (creating it if needed)`))
      .map((text, index) => (index === 0 ? text : lower(text)))
      .join(" and ")
  }
  const effects = writes.map((entry) =>
    entry.append
      ? `adds ${entry.stream} to the end of ${entry.target}`
      : `writes ${entry.stream} to ${entry.target} (creating or overwriting it)`,
  )
  return `${action} and ${effects.join(" and ")}`
}

function describe(input: string[]): string {
  const start = input.findIndex((word) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word))
  if (start === -1) return ""
  const words = input.slice(start)
  if (words[0] === "sudo") {
    const rest = words.slice(1)
    const inner = describe(rest.slice(Math.max(0, rest.findIndex((word) => !word.startsWith("-")))))
    return inner ? `${inner} (with administrator rights)` : "Runs a command with administrator rights"
  }
  const cmd = words[0]?.split("/").pop()?.toLowerCase()
  if (!cmd) return ""
  const flags = words.slice(1).filter((word) => word.startsWith("-"))
  const args = words.slice(1).filter((word) => !word.startsWith("-"))
  const list = args.join(" ")

  if (cmd === "git") return git(words.slice(1))
  if (["npm", "pnpm", "yarn", "bun"].includes(cmd)) return packages(cmd, words.slice(1))
  if (cmd === "npx" || cmd === "bunx") return `Downloads (if needed) and runs the tool ${args[0] ?? ""}`.trim()
  if (cmd === "rm") {
    const recursive = flags.some((flag) => flag === "--recursive" || (!flag.startsWith("--") && /[rR]/.test(flag)))
    return `Permanently deletes ${list}${recursive ? " and everything inside it" : ""}`
  }
  if (cmd === "rmdir") return `Deletes the empty folder ${list}`
  if (cmd === "mkdir") return `Creates the folder ${list}`
  if (cmd === "touch") return `Creates the empty file ${list} (or updates its timestamp)`
  if (cmd === "cp") return `Copies ${args.slice(0, -1).join(" ")} to ${args.at(-1) ?? ""}`
  if (cmd === "mv") return `Moves or renames ${args.slice(0, -1).join(" ")} to ${args.at(-1) ?? ""}`
  if (cmd === "chmod") return `Changes who can read, write, or run ${args.slice(1).join(" ")}`
  if (cmd === "chown") return `Changes the owner of ${args.slice(1).join(" ")}`
  if (cmd === "ls") return `Lists the files in ${list || "the current folder"}`
  if (cmd === "cat" || cmd === "head" || cmd === "tail" || cmd === "less") return `Shows the contents of ${list}`
  if (cmd === "cd") return `Moves into the folder ${list || "your home folder"}`
  if (cmd === "pwd") return "Shows the current folder"
  if (cmd === "echo" || cmd === "printf") return "Prints text"
  if (cmd === "tee") {
    if (flags.some((flag) => flag === "-a" || flag === "--append")) return `Adds its input to the end of ${list}`
    return `Writes its input to ${list} (creating or overwriting it)`
  }
  if (cmd === "grep" || cmd === "rg") return `Searches for "${args[0] ?? ""}" in ${args.slice(1).join(" ") || "files"}`
  if (cmd === "find") return `Searches for files in ${args[0] ?? "the current folder"}`
  if (cmd === "curl" || cmd === "wget") return `Downloads data from ${args.find((arg) => arg.includes("://")) ?? list}`
  if (cmd === "kill" || cmd === "pkill" || cmd === "killall") return `Stops the running process ${list}`
  if (cmd === "sh" || cmd === "bash" || cmd === "zsh") return args[0] ? `Runs the shell script ${args[0]}` : "Runs shell commands"
  if (cmd === "node" || cmd.startsWith("python") || cmd === "deno" || cmd === "tsx") {
    return args[0] ? `Runs the script ${args[0]}` : `Starts ${cmd}`
  }
  if (cmd === "pip" || cmd === "pip3") return pip(args)
  return `Runs the program \`${cmd}\``
}

function git(words: string[]) {
  const sub = words[0]?.toLowerCase()
  const flags = words.slice(1).filter((word) => word.startsWith("-"))
  const args = words.slice(1).filter((word) => !word.startsWith("-"))
  const has = (...names: string[]) => flags.some((flag) => names.includes(flag))
  const remote = args[0] ?? "the remote repository"

  if (!sub) return "Runs git"
  if (sub === "status") return "Shows which files have changed"
  if (sub === "diff") return "Shows the exact changes in your files"
  if (sub === "log" || sub === "show") return "Shows the commit history"
  if (sub === "add") {
    if (args.length === 0 || args.includes(".") || has("-A", "--all")) return "Stages all changed files for the next commit"
    return `Stages ${args.join(" ")} for the next commit`
  }
  if (sub === "commit") {
    if (has("--amend")) return "Rewrites the most recent commit"
    const index = words.findIndex((word) => word === "-m" || word === "--message" || word === "-am")
    const message = index === -1 ? undefined : words[index + 1]
    const scope = has("-a", "-am", "--all") ? "all changed files" : "the staged changes"
    return `Saves a snapshot (commit) of ${scope}${message ? ` with the message "${message}"` : ""}`
  }
  if (sub === "push") {
    if (has("-f", "--force", "--force-with-lease")) {
      return `Force-uploads your commits to ${remote}, overwriting its history (others may lose work)`
    }
    return `Uploads your commits to ${remote}`
  }
  if (sub === "pull") return `Downloads the latest changes from ${remote} and merges them into your branch`
  if (sub === "fetch") return `Downloads the latest changes from ${remote} without changing your files`
  if (sub === "clone") return `Downloads a copy of the repository ${args[0] ?? ""}`.trim()
  if (sub === "checkout" || sub === "switch") {
    if (words.includes("--")) return `Discards your uncommitted changes to ${words.slice(words.indexOf("--") + 1).join(" ")}`
    if (has("-b", "-c", "-B")) return `Creates and switches to the new branch ${args[0] ?? ""}`.trim()
    return `Switches to ${args[0] ?? "another branch"}`
  }
  if (sub === "branch") {
    if (has("-d", "-D", "--delete")) return `Deletes the branch ${args.join(" ")}`
    if (args[0]) return `Creates the branch ${args[0]}`
    return "Lists branches"
  }
  if (sub === "merge") return `Combines the branch ${args[0] ?? ""} into your current branch`
  if (sub === "rebase") return `Replays your commits on top of ${args[0] ?? "another branch"} (rewrites history)`
  if (sub === "reset") {
    if (has("--hard")) return `Resets to ${args[0] ?? "the last commit"} and throws away all uncommitted changes (cannot be undone)`
    return `Unstages changes${args[0] ? ` and moves the branch to ${args[0]}` : ""}`
  }
  if (sub === "restore") return `Discards your uncommitted changes to ${args.join(" ") || "files"}`
  if (sub === "clean") return "Permanently deletes files that git is not tracking"
  if (sub === "stash") {
    if (args[0] === "pop" || args[0] === "apply") return "Brings back changes you set aside earlier"
    return "Temporarily sets aside your uncommitted changes"
  }
  if (sub === "revert") return `Creates a new commit that undoes ${args[0] ?? "a previous commit"}`
  if (sub === "init") return "Turns this folder into a new git repository"
  return `Runs \`git ${sub}\``
}

function packages(manager: string, words: string[]) {
  const action = words[0]?.toLowerCase()
  const args = words.slice(1).filter((word) => !word.startsWith("-"))

  if (!action) return manager === "npm" ? "Runs npm" : "Installs the project's dependencies"
  if (["install", "i", "add"].includes(action)) {
    if (args.length === 0) return "Installs the project's dependencies"
    return `Installs the ${args.length === 1 ? "package" : "packages"} ${args.join(" ")}`
  }
  if (["remove", "uninstall", "rm"].includes(action)) {
    return `Removes the ${args.length === 1 ? "package" : "packages"} ${args.join(" ")}`
  }
  if (action === "run") return `Runs the project script "${args[0] ?? ""}"`
  if (action === "test") return "Runs the project's tests"
  if (action === "publish") return "Publishes this package to the public registry for anyone to download"
  if (action === "x" || action === "exec" || action === "dlx") return `Downloads (if needed) and runs the tool ${args[0] ?? ""}`.trim()
  if (/\.[cm]?[jt]sx?$/.test(action)) return `Runs the script ${words[0]}`
  return `Runs \`${manager} ${action}\``
}

function pip(args: string[]) {
  if (args[0] === "install") return `Installs the Python ${args.length === 2 ? "package" : "packages"} ${args.slice(1).join(" ")}`
  if (args[0] === "uninstall") return `Removes the Python ${args.length === 2 ? "package" : "packages"} ${args.slice(1).join(" ")}`
  return `Runs \`pip ${args[0] ?? ""}\``.trim()
}

function changes(diff: string) {
  const added = count(diff, "+")
  const removed = count(diff, "-")
  if (added === 0 && removed === 0) return "no line changes"
  return [added > 0 ? `adds ${plural(added, "line")}` : "", removed > 0 ? `removes ${plural(removed, "line")}` : ""]
    .filter(Boolean)
    .join(", ")
}

function count(diff: string, sign: "+" | "-") {
  return diff.split("\n").filter((line) => line.startsWith(sign) && !line.startsWith(sign.repeat(3))).length
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`
}

function lower(text: string) {
  return text.charAt(0).toLowerCase() + text.slice(1)
}

export * as Translator from "."
