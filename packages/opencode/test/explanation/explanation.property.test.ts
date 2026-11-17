// Property-based tests for the plain-language permission explanations: the
// explanation itself (src/translator), the shell tool's permission request
// (src/tool/shell.ts) and how the permission service answers it
// (src/permission/index.ts). Each property names the requirement it checks;
// see traceability/jtthani.md. Drafted with Claude Code (Claude Opus 5.5) and
// reviewed against the P4A interview notes, as recorded in that file.
//
// To replay a failure, copy the `seed` and `path` fast-check prints into that
// property's options (e.g. `{ ...options, seed: 42, path: "7:1:0" }`), rerun it
// alone with `-t "R4"`, and remove them once it is fixed.
import { describe, expect, test } from "bun:test"
import fc from "fast-check"
import fs from "fs/promises"
import path from "path"
import { Effect, Exit, Fiber, Layer, Scope } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { Config } from "@/config/config"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Tool } from "@/tool/tool"
import { Truncate } from "@/tool/truncate"
import { Agent } from "../../src/agent/agent"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { Permission } from "../../src/permission"
import { Plugin } from "../../src/plugin"
import { InstanceBootstrap } from "../../src/project/bootstrap"
import { InstanceStore } from "../../src/project/instance-store"
import { MessageID, SessionID } from "../../src/session/schema"
import { ShellTool } from "../../src/tool/shell"
import { Translator } from "../../src/translator"
import { Danger } from "../../src/translator/danger"
import { Flags } from "../../src/translator/flags"
import { TestInstance, withTmpdirInstance } from "../fixture/fixture"
import { pollWithTimeout, testEffect } from "../lib/effect"

const options = { numRuns: 200 }

// ---------------------------------------------------------------------------
// Shared generators
// ---------------------------------------------------------------------------

// Package names: the ones from the interviews (express, lodash, morgan,
// debug), scoped names, and generated names ending in a digit, so a name
// never collides with a word of the sentence around it.
const pkg = fc.oneof(
  fc.constantFrom("express", "lodash", "morgan", "debug", "react-dom", "@types/node", "zod"),
  fc.stringMatching(/^[a-z][a-z-]{1,8}[0-9]$/),
  fc.stringMatching(/^@[a-z]{2,6}\/[a-z]{2,6}[0-9]$/),
)

// Paths an agent creates or deletes: folders with and without a trailing
// slash and plain files (build/ vs build.log, from the acceptance criteria),
// nested paths, and generated ones.
const target = fc.oneof(
  fc.constantFrom("build/", "build.log", "src/", "src/app.js", "dist", "node_modules", "notes.txt"),
  fc.stringMatching(/^[a-z]{2,6}[0-9](\/[a-z]{2,6}[0-9]){0,2}\/?$/),
)

const branch = fc.stringMatching(/^[a-z]{2,6}[0-9]$/)

// Reasons the agent might give, including the "harmless cleanup" from the R4
// acceptance criteria, reassurances, and arbitrary text (blank included).
const reason = fc.option(
  fc.oneof(
    fc.constantFrom(
      "harmless cleanup",
      "This is safe, nothing important is deleted",
      "The user asked for a web server",
    ),
    fc.string({ maxLength: 40 }),
  ),
  { nil: undefined },
)

// ---------------------------------------------------------------------------
// R2: the explanation names the package or target and explains each flag.
// ---------------------------------------------------------------------------

// Commands whose explanation must name what they act on, each with two
// different targets of the right kind: packages for installs and removals,
// paths for file commands, branch names for git.
const named = fc.oneof(
  fc.tuple(
    fc.constantFrom(
      "npm install",
      "npm i",
      "npm add",
      "bun add",
      "pnpm add",
      "yarn add",
      "npm uninstall",
      "bun remove",
      "pip install",
      "pip uninstall",
    ),
    pkg,
    pkg,
  ),
  fc.tuple(
    fc.constantFrom("rm", "rm -rf", "rm -r", "rmdir", "mkdir", "mkdir -p", "touch", "cat", "ls", "git add"),
    target,
    target,
  ),
  fc.tuple(
    fc.constantFrom(
      "git checkout -b",
      "git switch -c",
      "git branch",
      "git branch -D",
      "git merge",
      "git push origin",
      "git push --force origin",
      "git pull origin",
      "git fetch origin",
    ),
    branch,
    branch,
  ),
)

// Flags the revised R2 requires to be explained, by command. Each inner list
// is one flag's spellings (short first, then long). Flags that take a value,
// such as -m or -n, are left out so the words after the flags stay the target.
const FLAGGED = [
  {
    command: "rm",
    args: "build/",
    flags: [["-r", "-R", "--recursive"], ["-f", "--force"], ["-i"], ["-v", "--verbose"], ["-d", "--dir"]],
  },
  {
    command: "cp",
    args: "src/ backup/",
    flags: [
      ["-r", "-R", "--recursive"],
      ["-f", "--force"],
      ["-i", "--interactive"],
      ["-v", "--verbose"],
    ],
  },
  {
    command: "mv",
    args: "a.txt b.txt",
    flags: [
      ["-f", "--force"],
      ["-i", "--interactive"],
      ["-n", "--no-clobber"],
      ["-v", "--verbose"],
    ],
  },
  {
    command: "mkdir",
    args: "src/lib",
    flags: [
      ["-p", "--parents"],
      ["-v", "--verbose"],
    ],
  },
  {
    command: "ls",
    args: "src",
    flags: [["-l"], ["-a", "--all"], ["-h", "--human-readable"], ["-R", "--recursive"], ["-t"]],
  },
  {
    command: "grep",
    args: "TODO src",
    flags: [
      ["-r", "-R", "--recursive"],
      ["-i", "--ignore-case"],
      ["-n", "--line-number"],
      ["-v", "--invert-match"],
      ["-l"],
    ],
  },
  {
    command: "git push",
    args: "origin main",
    flags: [["-f", "--force"], ["-u", "--set-upstream"], ["--tags"], ["--no-verify"]],
  },
  { command: "git clean", args: "", flags: [["-f", "--force"], ["-d"], ["-x"], ["-n", "--dry-run"]] },
  { command: "git reset", args: "HEAD~1", flags: [["--hard"], ["--soft"], ["-q", "--quiet"]] },
  {
    command: "git add",
    args: "src",
    flags: [
      ["-A", "--all"],
      ["-u", "--update"],
      ["-f", "--force"],
    ],
  },
  {
    command: "npm install",
    args: "express",
    flags: [
      ["-D", "--save-dev"],
      ["-g", "--global"],
      ["-E", "--save-exact"],
    ],
  },
  {
    command: "bun add",
    args: "zod",
    flags: [
      ["-d", "--dev"],
      ["-g", "--global"],
      ["-E", "--exact"],
    ],
  },
  { command: "docker system prune", args: "", flags: [["-a", "--all"], ["-f", "--force"], ["--volumes"]] },
]

// One command with a random subset of its flags, each in a random spelling,
// in a random order, and with single-letter flags sometimes combined into one
// word (-r -f -> -rf), the way the interviewees' examples were written.
const flagged = fc.constantFrom(...FLAGGED).chain((item) =>
  fc.record({
    item: fc.constant(item),
    chosen: fc.shuffledSubarray(item.flags),
    spelling: fc.array(fc.nat(), { minLength: item.flags.length, maxLength: item.flags.length }),
    cluster: fc.boolean(),
    // A made-up flag no table can know.
    unknown: fc.stringMatching(/^--zz-[a-z]{2,8}$/),
  }),
)

// Writes flags in their order, combining the single-letter ones into one word.
function combine(flags: string[]) {
  const letters = flags.filter((flag) => /^-[A-Za-z]$/.test(flag))
  if (letters.length < 2) return flags
  return [`-${letters.map((flag) => flag[1]).join("")}`, ...flags.filter((flag) => !letters.includes(flag))]
}

describe("R2", () => {
  // R2 (revised): The explanation names the package or target of each step.
  // For supported commands, every flag used is explained from a fixed table,
  // with combined short flags such as -rf explained one by one; a flag that is
  // not in the table is still listed and marked as not explained, pointing to
  // the documentation link. What a package is for comes from the agent's reason.
  // Kind: metamorphic (swapping the target in the command swaps it in the
  // explanation and changes nothing else).
  test("R2: swapping the package or target in the command swaps it in the explanation", () => {
    fc.assert(
      fc.property(named, ([prefix, from, to]) => {
        fc.pre(from !== to)
        const before = Translator.shell(`${prefix} ${from}`)?.what ?? ""
        const after = Translator.shell(`${prefix} ${to}`)?.what ?? ""
        expect(before).toContain(from)
        expect(after).toContain(to)
        expect(after).not.toBe(before)
        // Apart from the target, it is the same sentence.
        if (before.split(from).length === 2) expect(after).toBe(before.split(from).join(to))
      }),
      options,
    )
  })

  // R2 (revised), as above.
  // Kind: metamorphic (respelling, reordering or combining the same flags gives
  // the same flag explanations, and adding an unknown flag adds exactly one
  // "not explained" entry).
  test("R2: every flag is explained however it is written, and unknown flags are listed", () => {
    fc.assert(
      fc.property(flagged, ({ item, chosen, spelling, cluster, unknown }) => {
        const line = (flags: string[]) => [item.command, ...flags, item.args].filter(Boolean).join(" ")
        const plain = item.flags.filter((group) => chosen.includes(group)).map((group) => group[0])
        const spelled = chosen.map((group, index) => group[spelling[index] % group.length])
        const written = cluster ? combine(spelled) : spelled

        const base = Translator.shell(line(plain))?.flags ?? []
        // No flags, no flag explanation (rm build/ like rm build.log).
        if (plain.length === 0) expect(Translator.shell(line(plain))?.flags).toBeUndefined()
        // One explained entry per flag, in the order written.
        expect(base.map((entry) => entry.flag)).toEqual(plain)
        for (const entry of base) expect(entry.meaning).not.toBe(Flags.UNEXPLAINED)

        // The same flags written another way are explained the same way, one by one.
        const variant = Translator.shell(line(written))?.flags ?? []
        expect(variant.map((entry) => entry.meaning).sort()).toEqual(base.map((entry) => entry.meaning).sort())
        for (const entry of variant) expect(entry.flag).not.toMatch(/^-[A-Za-z]{2,}$/)

        // An unknown flag is listed, not skipped.
        expect(Translator.shell(line([...plain, unknown]))?.flags).toEqual([
          ...base,
          { flag: unknown, meaning: Flags.UNEXPLAINED },
        ])
      }),
      options,
    )
  })
})

// ---------------------------------------------------------------------------
// R4: dangerous commands come from a fixed, user-editable list of patterns.
// ---------------------------------------------------------------------------

type Core = { words: string[]; dangerous: boolean }

// Writes flags in a random order and sometimes combines the single-letter ones.
const spell = (flags: string[]) =>
  fc
    .tuple(fc.shuffledSubarray(flags, { minLength: flags.length }), fc.boolean())
    .map(([order, cluster]) => (cluster ? combine(order) : order))

const folder = fc.constantFrom("build/", "src/", "dist", "node_modules", "out", ".", "*")
const file = fc.constantFrom("build.log", "notes.txt", "a.out")
const rev = fc.constantFrom("HEAD~1", "HEAD", "origin/main")

// Dangerous by construction under the built-in list, from the interviews:
// deleting a folder tree in any flag spelling, git reset --hard, force-pushing,
// git clean -f, and find -delete.
const dangerousCore: fc.Arbitrary<Core> = fc.oneof(
  fc
    .tuple(
      fc.constantFrom("-r", "-R", "--recursive"),
      fc.constantFrom([], ["-f"], ["--force"], ["-v"], ["-f", "-v"]),
      folder,
    )
    .chain(([recursive, more, where]) =>
      spell([recursive, ...more]).map((flags) => ({ words: ["rm", ...flags, where], dangerous: true })),
    ),
  fc
    .option(rev, { nil: undefined })
    .map((to) => ({ words: ["git", "reset", "--hard", ...(to ? [to] : [])], dangerous: true })),
  fc.tuple(fc.constantFrom("-f", "--force", "--force-with-lease"), fc.boolean()).map(([flag, last]) => ({
    words: last ? ["git", "push", "origin", "main", flag] : ["git", "push", flag, "origin", "main"],
    dangerous: true,
  })),
  fc
    .tuple(fc.constantFrom("-f", "--force"), fc.subarray(["-d", "-x"]))
    .chain(([force, more]) =>
      spell([force, ...more]).map((flags) => ({ words: ["git", "clean", ...flags], dangerous: true })),
    ),
  fc
    .option(fc.constantFrom("*.log", "*.tmp"), { nil: undefined })
    .map((name) => ({ words: ["find", ".", ...(name ? ["-name", name] : []), "-delete"], dangerous: true })),
)

// Safe by construction: the near misses of each dangerous command (rm without
// -r, git reset without --hard, git push without force, git clean as a dry
// run, find without -delete) and everyday commands such as ls -la from the
// acceptance criteria. docker system prune is only dangerous once a user adds
// it, so it is safe under the built-in list.
const safeCore: fc.Arbitrary<Core> = fc.oneof(
  fc
    .tuple(fc.subarray(["-f", "-v", "-i"]), file)
    .chain(([flags, name]) => spell(flags).map((written) => ({ words: ["rm", ...written, name], dangerous: false }))),
  fc
    .tuple(fc.option(fc.constantFrom("--soft", "--mixed"), { nil: undefined }), rev)
    .map(([mode, to]) => ({ words: ["git", "reset", ...(mode ? [mode] : []), to], dangerous: false })),
  fc.subarray(["-u"]).map((flags) => ({ words: ["git", "push", ...flags, "origin", "main"], dangerous: false })),
  fc
    .tuple(fc.constantFrom("-n", "--dry-run"), fc.subarray(["-d"]))
    .chain(([dry, more]) =>
      spell([dry, ...more]).map((flags) => ({ words: ["git", "clean", ...flags], dangerous: false })),
    ),
  fc
    .constantFrom(
      ["find", ".", "-name", "*.log"],
      ["find", "src", "-type", "f"],
      ["ls", "-la"],
      ["git", "status"],
      ["echo", "hello"],
      ["npm", "install", "express"],
      ["cat", "README.md"],
      ["pwd"],
      ["mkdir", "-p", "build"],
      ["git", "checkout", "main"],
      ["docker", "system", "prune", "-a"],
    )
    .map((words) => ({ words: [...words], dangerous: false })),
)

// The same command dressed up the way agents write commands: an absolute
// program path, environment variables, sudo, git's own -C/-c options, quoted
// paths, sh -c / bash -c / eval, a subshell or $(...), and chained with an
// everyday command. None of this changes whether the command is dangerous,
// so the oracle is simply the label of the core command.
const dressed = (core: fc.Arbitrary<Core>) =>
  fc
    .record({
      core,
      absolute: fc.boolean(),
      prefix: fc.constantFrom("", "sudo ", "sudo -u root ", "FOO=1 ", "env FOO=1 ", "time ", "nohup "),
      git: fc.constantFrom("", "-C repo", "-c color.ui=false", "--no-pager"),
      quote: fc.constantFrom("", '"', "'"),
      wrap: fc.constantFrom("none", "sh", "bash", "eval", "subshell", "substitution"),
      chain: fc.constantFrom("none", "and", "semicolon", "pipe", "or", "cd"),
      other: safeCore,
    })
    .map((input) => {
      const [program, ...rest] = input.core.words
      const glob = input.quote || '"'
      const words = rest.map((word, index) => {
        if (word.includes("*") && word !== "*") return `${glob}${word}${glob}`
        if (input.quote && index === rest.length - 1 && !word.startsWith("-") && word !== "*") {
          return `${input.quote}${word}${input.quote}`
        }
        return word
      })
      const name = input.absolute ? `/usr/bin/${program}` : program
      const head = program === "git" && input.git ? [name, input.git] : [name]
      const command = input.prefix + [...head, ...words].join(" ")
      // The wrapper's quotes differ from any quote used inside.
      const outer = glob === "'" ? '"' : "'"
      const wrapped = {
        none: command,
        sh: `sh -c ${outer}${command}${outer}`,
        bash: `bash -c ${outer}${command}${outer}`,
        eval: `eval ${outer}${command}${outer}`,
        subshell: `(${command})`,
        substitution: `echo $(${command})`,
      }[input.wrap]
      const other = input.other.words.join(" ")
      const chained = {
        none: wrapped,
        and: `${other} && ${wrapped}`,
        semicolon: `${wrapped}; ${other}`,
        pipe: `${other} | ${wrapped}`,
        or: `${wrapped} || ${other}`,
        cd: `cd build && ${wrapped}`,
      }[input.chain]
      return { command: chained, dangerous: input.core.dangerous }
    })

// Patterns a user might add, each with a command that runs it and extra
// words that may follow: the interviewees' docker example and other
// destructive tools, one of them with a flag in the pattern.
const CUSTOM = [
  { pattern: "docker system prune *", words: ["docker", "system", "prune"], more: ["-a", "-f", "--volumes"] },
  { pattern: "kubectl delete *", words: ["kubectl", "delete", "pod", "web"], more: ["--force", "--now"] },
  { pattern: "terraform destroy *", words: ["terraform", "destroy"], more: ["-auto-approve"] },
  { pattern: "git branch -D *", words: ["git", "branch", "-D", "feature1"], more: ["--quiet"] },
  { pattern: "dropdb *", words: ["dropdb", "app_db"], more: ["--if-exists"] },
]

describe("R4", () => {
  // R4 (revised): Dangerous commands are identified by a fixed, user-editable
  // list of patterns, not by the model's judgment. A command is dangerous when
  // any part of it matches a listed pattern, including commands chained with
  // &&, ;, | or ||, run through sudo, env, time or nohup, wrapped in sh -c,
  // bash -c, eval, a subshell or $(...), however its flags are ordered,
  // combined (-rf, -r -f) or spelled (-r, -R, --recursive). The agent's reason
  // is never consulted.
  // Kind: model / oracle (the expected answer is the label of the core command
  // the input was built from, not something parsed back out of it).
  test("R4: the built-in list flags dangerous commands however they are written, and nothing else", () => {
    fc.assert(
      fc.property(dressed(fc.oneof(dangerousCore, safeCore)), reason, ({ command, dangerous }, why) => {
        const danger = Translator.shell(command, why)?.danger
        expect({ command, flagged: danger !== undefined }).toEqual({ command, flagged: dangerous })
        if (danger) expect(Danger.DEFAULTS).toContain(danger.pattern)
        // The agent calling it "harmless cleanup" changes nothing.
        expect(Translator.shell(command)?.danger).toEqual(danger)
      }),
      options,
    )
  })

  // R4 (revised), as above: the list is the user's to edit.
  // Kind: metamorphic (adding a pattern flags the commands that match it and
  // leaves every other answer as it was; removing every pattern flags nothing).
  test("R4: patterns the user adds or removes change exactly the commands they match", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...CUSTOM).chain((custom) => fc.tuple(fc.constant(custom), fc.shuffledSubarray(custom.more))),
        dressed(fc.oneof(dangerousCore, safeCore)),
        ([custom, more], other) => {
          const command = [...custom.words, ...more].join(" ")
          const added = Danger.list({ [custom.pattern]: true })
          expect(Translator.shell(command)?.danger).toBeUndefined()
          expect(Translator.shell(command, undefined, added)?.danger).toEqual({ pattern: custom.pattern })
          // Any command flagged before is flagged by the same pattern after.
          const before = Translator.shell(other.command)?.danger
          if (before) expect(Translator.shell(other.command, undefined, added)?.danger).toEqual(before)
          // An empty list flags nothing.
          const none = Danger.list(Object.fromEntries(Danger.DEFAULTS.map((pattern) => [pattern, false])))
          expect(none).toEqual([])
          expect(Translator.shell(other.command, undefined, none)?.danger).toBeUndefined()
        },
      ),
      options,
    )
  })
})

// ---------------------------------------------------------------------------
// R7: each explanation links to the official documentation.
// ---------------------------------------------------------------------------

// The official site of each program R7 covers, from each project's own docs.
const OFFICIAL: Record<string, string> = {
  git: "git-scm.com",
  npm: "docs.npmjs.com",
  npx: "docs.npmjs.com",
  pnpm: "pnpm.io",
  yarn: "yarnpkg.com",
  bun: "bun.com",
  bunx: "bun.com",
  pip: "pip.pypa.io",
  pip3: "pip.pypa.io",
  rm: "www.gnu.org",
  ls: "www.gnu.org",
  cat: "www.gnu.org",
  mkdir: "www.gnu.org",
  cp: "www.gnu.org",
  mv: "www.gnu.org",
  touch: "www.gnu.org",
  chmod: "www.gnu.org",
  echo: "www.gnu.org",
  pwd: "www.gnu.org",
  grep: "www.gnu.org",
  find: "www.gnu.org",
  cd: "www.gnu.org",
  make: "www.gnu.org",
  curl: "curl.se",
  node: "nodejs.org",
  python3: "docs.python.org",
  docker: "docs.docker.com",
  kill: "man7.org",
}

const GIT_SUBS = [
  "status",
  "add",
  "commit",
  "push",
  "pull",
  "fetch",
  "reset",
  "checkout",
  "switch",
  "branch",
  "merge",
  "rebase",
  "log",
  "diff",
  "stash",
  "clean",
  "restore",
  "revert",
  "clone",
  "init",
]

// One step: a git subcommand with or without a flag (git reset --hard from the
// acceptance criteria), npm install in each spelling, another supported
// program, or a made-up program that has no official docs. Commands may
// contain URLs of their own (curl), which must not become documentation links.
const step = fc.oneof(
  fc
    .tuple(fc.constantFrom(...GIT_SUBS), fc.constantFrom("", " --hard", " -f", " --oneline", " -b x1"))
    .map(([sub, flag]) => ({ text: `git ${sub}${flag}`, program: "git", sub })),
  fc
    .tuple(fc.constantFrom("install", "i", "add"), fc.constantFrom("", " -D"), pkg)
    .map(([sub, flag, name]) => ({ text: `npm ${sub}${flag} ${name}`, program: "npm", sub: "install" })),
  fc
    .constantFrom(
      "npm test",
      "npm run build",
      "npm uninstall express",
      "pnpm add zod",
      "yarn add zod",
      "bun add zod",
      "bunx vitest",
      "npx vitest",
      "pip install requests",
      "pip3 install requests",
      "rm -rf build/",
      "ls -la",
      "cat README.md",
      "mkdir -p src",
      "cp a.txt b.txt",
      "mv a.txt b.txt",
      "touch a.txt",
      "chmod +x run.sh",
      "echo hi",
      "pwd",
      "grep -r TODO src",
      "find . -name x",
      "cd src",
      "make all",
      "curl https://example.com/install.sh",
      "node index.js",
      "python3 app.py",
      "docker ps",
      "kill 123",
    )
    .map((text) => ({ text, program: text.split(" ")[0], sub: "" })),
  fc
    .stringMatching(/^[a-z]{3,7}[0-9]$/)
    .filter((name) => !Object.hasOwn(OFFICIAL, name))
    .map((name) => ({ text: `${name} --verbose`, program: name, sub: "" })),
)

// Reasons that link to blogs and forums, which must never become the link.
const linky = fc.option(
  fc.constantFrom(
    "See https://stackoverflow.com/questions/1 for why",
    "As explained in https://medium.com/@dev/clean-builds",
    "https://www.reddit.com/r/git/ says this is fine",
    "Set up the web server",
  ),
  { nil: undefined },
)

describe("R7", () => {
  // R7 (revised): For every supported program (git, npm, pnpm, yarn, bun, pip,
  // the common file and text commands, ...), the explanation links to that
  // program's official documentation on the project's own site; git links go
  // to the subcommand's page and npm links to its command's page on
  // docs.npmjs.com. A program opencode does not know gets no link rather than
  // a guessed one, and links never come from the agent.
  // Kind: invariant
  test("R7: every supported program links to its official documentation, and only there", () => {
    fc.assert(
      fc.property(fc.array(step, { minLength: 1, maxLength: 3 }), linky, (steps, why) => {
        const command = steps.map((item) => item.text).join(" && ")
        const docs = Translator.shell(command, why)?.docs ?? []
        const urls = docs.map((link) => new URL(link))
        for (const url of urls) {
          expect(url.protocol).toBe("https:")
          expect(Object.values(OFFICIAL)).toContain(url.hostname)
        }
        for (const item of steps.filter((item) => Object.hasOwn(OFFICIAL, item.program))) {
          expect(urls.map((url) => url.hostname)).toContain(OFFICIAL[item.program])
        }
        for (const item of steps.filter((item) => item.program === "git")) {
          expect(docs).toContain(`https://git-scm.com/docs/git-${item.sub}`)
        }
        if (steps.some((item) => item.program === "npm" && item.sub === "install")) {
          expect(docs).toContain("https://docs.npmjs.com/cli/commands/npm-install")
        }
        if (steps.every((item) => !Object.hasOwn(OFFICIAL, item.program))) expect(docs).toEqual([])
        // The agent's reason, links and all, never changes the links.
        expect(Translator.shell(command)?.docs).toEqual(Translator.shell(command, why)?.docs)
      }),
      options,
    )
  })
})

// ---------------------------------------------------------------------------
// R1 and R6 run the real shell tool in a temporary project. R6 also answers
// prompts through the real permission service, the way the user would.
// ---------------------------------------------------------------------------

const noopBootstrap = Layer.succeed(InstanceBootstrap.Service, InstanceBootstrap.Service.of({ run: Effect.void }))
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Permission.node,
      EventV2Bridge.node,
      CrossSpawnSpawner.node,
      InstanceStore.node,
      FSUtil.node,
      Plugin.node,
      Truncate.node,
      Config.node,
      Agent.node,
      RuntimeFlags.node,
    ]),
    [[InstanceStore.bootstrapNode, noopBootstrap]],
  ),
)

// Each run starts real processes, so fewer runs than the pure properties.
const slow = { numRuns: 25 }

const context: Tool.Context = {
  sessionID: SessionID.make("ses_explanation"),
  messageID: MessageID.make("msg_explanation"),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

// Runs an Effect property body with the test's services. Each run gets its own
// temporary project, so "Allow always" answers (kept per project until restart)
// never leak from one run into the next and a counterexample stands on its own.
const property = <Ts extends [unknown, ...unknown[]]>(
  arbitraries: { [K in keyof Ts]: fc.Arbitrary<Ts[K]> },
  body: (...args: Ts) => Effect.Effect<void, unknown, Permission.Service | TestInstance | Scope.Scope>,
) =>
  Effect.gen(function* () {
    const run = Effect.runPromiseWith(yield* Effect.context<Permission.Service>())
    yield* Effect.promise(() =>
      fc.assert(
        fc.asyncProperty(...arbitraries, (...args: Ts) => run(Effect.scoped(body(...args).pipe(withTmpdirInstance())))),
        slow,
      ),
    )
  })

// A file's contents, "(folder)" for a folder, or undefined if it is missing.
async function read(file: string) {
  const stat = await fs.stat(file).catch(() => undefined)
  if (!stat) return undefined
  if (stat.isDirectory()) return "(folder)"
  return Bun.file(file).text()
}

let counter = 0

describe("R1", () => {
  // R1 (revised): Before any shell command runs, the permission prompt shows
  // the command, a plain-English description of what it does (or, for a
  // command too complex to summarize safely, a warning that says so), and the
  // agent's stated reason when it gives one. The command does not run until
  // the user approves it; a rejected command never runs.
  // Kind: invariant
  // Generators: commands whose effect the test can observe (creating a file or
  // folder, writing a file, and overwriting package.json for the acceptance
  // criteria's "package.json is unchanged"), any reason including none or a
  // blank one, and either answer.
  it.instance(
    "R1: the prompt explains the command before it runs, and a rejected command never runs",
    () =>
      Effect.gen(function* () {
        const shell = yield* ShellTool
        const tool = yield* shell.init()
        yield* property(
          [fc.constantFrom("touch", "mkdir", "write", "package"), reason, fc.boolean()],
          (kind, why, approve) =>
            Effect.gen(function* () {
              const test = yield* TestInstance
              counter++
              const name = `r1-${counter}`
              const run = {
                touch: { command: `touch ${name}.txt`, file: `${name}.txt` },
                mkdir: { command: `mkdir -p ${name}/lib`, file: name },
                write: { command: `echo hello > ${name}.txt`, file: `${name}.txt` },
                package: {
                  command: `echo '{"dependencies":{"express":"^4.21.2"}}' > package.json`,
                  file: "package.json",
                },
              }[kind]
              const file = path.join(test.directory, run.file)
              if (kind === "package") yield* Effect.promise(() => Bun.write(file, '{"name":"demo"}\n'))
              const before = yield* Effect.promise(() => read(file))

              const requests: Parameters<Tool.Context["ask"]>[0][] = []
              const early: boolean[] = []
              const exit = yield* tool
                .execute(
                  { command: run.command, reason: why },
                  {
                    ...context,
                    ask: (request) =>
                      Effect.promise(async () => {
                        requests.push(request)
                        early.push((await read(file)) !== before)
                        if (!approve) throw new PermissionV1.RejectedError()
                      }),
                  },
                )
                .pipe(Effect.exit)
              const after = yield* Effect.promise(() => read(file))

              // Exactly one prompt, showing the command, what it does and why.
              expect(requests.map((request) => request.permission)).toEqual(["bash"])
              const request = requests[0]
              expect(request.metadata.command).toBe(run.command)
              const explanation = request.metadata.explanation as Translator.Explanation | undefined
              expect(explanation?.what).toContain(run.file)
              expect(explanation?.why).toBe(why?.trim() || undefined)
              // Nothing ran before the answer, and only an approved command runs.
              expect(early).toEqual([false])
              expect({ approve, ran: Exit.isSuccess(exit), changed: after !== before }).toEqual({
                approve,
                ran: approve,
                changed: approve,
              })
            }),
        )
      }),
    120_000,
  )
})

// Dangerous commands the test can safely run in a temporary folder that is
// not a git repository, each with an ordinary command whose "Allow always"
// pattern also covers it (rm build.log offers `rm *`, which matches
// rm -rf build/; git reset HEAD offers `git reset *`).
const RISKY = [
  { command: "rm -rf build/", cover: "rm build.log" },
  { command: "rm -r -f dist", cover: "rm -f notes.txt" },
  { command: "git reset --hard HEAD~1", cover: "git reset HEAD notes.txt" },
  { command: "git push --force origin main", cover: "git push origin main" },
  { command: "git clean -fd", cover: "git clean -n" },
]

// What happens before the last run: the same dangerous command answered with
// once, always or reject; the covering ordinary command approved with "Allow
// always"; or both waiting at the same time, with "Allow always" given to the
// ordinary one first.
const history = fc.array(
  fc.oneof(
    fc
      .constantFrom("once" as const, "always" as const, "reject" as const)
      .map((reply) => ({ kind: "repeat" as const, reply })),
    fc.constant({ kind: "cover" as const }),
    fc.constant({ kind: "together" as const }),
  ),
  { maxLength: 4 },
)

// Sends a tool's permission request to the real permission service the way a
// session does, with bash set to "ask" as in the acceptance criteria.
const ASK: PermissionV1.Ruleset = [{ permission: "bash", pattern: "*", action: "ask" }]

describe("R6", () => {
  // R6 (revised): Dangerous commands never offer "Allow always", so each run
  // needs its own approval: no earlier answer, including "Allow always" given
  // to an ordinary command whose pattern also covers the dangerous one, lets a
  // dangerous command run without asking. Rules the user writes in the config
  // still apply.
  // Kind: invariant
  it.instance(
    "R6: a dangerous command never offers Allow always and asks again on every run",
    () =>
      Effect.gen(function* () {
        const shell = yield* ShellTool
        const tool = yield* shell.init()
        yield* property([fc.constantFrom(...RISKY), history], (risky, steps) =>
          Effect.gen(function* () {
            const permission = yield* Permission.Service
            counter++
            const sessionID = SessionID.make(`ses_r6_${counter}`)
            const ask: Tool.Context["ask"] = (request) =>
              permission.ask({ ...request, sessionID, ruleset: ASK }).pipe(Effect.orDie)
            const start = (command: string) =>
              tool.execute({ command }, { ...context, sessionID, ask }).pipe(Effect.exit, Effect.forkScoped)
            // Waits until the command asks for permission or finishes without asking.
            const prompt = (fiber: Fiber.Fiber<unknown>, command: string) =>
              pollWithTimeout(
                Effect.gen(function* () {
                  const asked = (yield* permission.list()).find(
                    (item) => item.sessionID === sessionID && item.metadata.command === command,
                  )
                  if (asked) return { asked }
                  if (fiber.pollUnsafe()) return { asked: undefined }
                  return undefined
                }),
                `${command} neither asked for permission nor finished`,
              )
            const run = (command: string, reply: PermissionV1.Reply) =>
              Effect.gen(function* () {
                const fiber = yield* start(command)
                const { asked } = yield* prompt(fiber, command)
                if (asked) yield* permission.reply({ requestID: asked.id, reply })
                yield* Fiber.join(fiber)
                return asked
              })
            // Asked, with nothing to approve "always", and flagged as dangerous.
            const fresh = (asked: PermissionV1.Request | undefined) => {
              expect({ command: risky.command, asked: asked !== undefined }).toEqual({
                command: risky.command,
                asked: true,
              })
              expect(asked?.always).toEqual([])
              expect((asked?.metadata.explanation as Translator.Explanation | undefined)?.danger).toBeDefined()
            }

            for (const step of steps) {
              if (step.kind === "repeat") fresh(yield* run(risky.command, step.reply))
              if (step.kind === "cover") yield* run(risky.cover, "always")
              if (step.kind === "together") {
                const ordinary = yield* start(risky.cover)
                const first = yield* prompt(ordinary, risky.cover)
                const dangerous = yield* start(risky.command)
                const second = yield* prompt(dangerous, risky.command)
                fresh(second.asked)
                if (first.asked) yield* permission.reply({ requestID: first.asked.id, reply: "always" })
                yield* Fiber.join(ordinary)
                // "Allow always" on the ordinary command did not answer the dangerous one.
                expect((yield* permission.list()).some((item) => item.id === second.asked?.id)).toBe(true)
                if (second.asked) yield* permission.reply({ requestID: second.asked.id, reply: "once" })
                yield* Fiber.join(dangerous)
              }
            }
            // However it was answered before, the next run asks again.
            fresh(yield* run(risky.command, "reject"))
          }),
        )
      }),
    120_000,
  )
})
