// Dangerous-command detection. A command is dangerous when part of it matches
// a pattern on a fixed list the user can edit (`dangerous_commands` in
// opencode.json). Only the command text is checked: the agent's reason for
// running it plays no part, so the agent cannot talk a command out of the list.

import { Wildcard } from "@opencode-ai/core/util/wildcard"
import { Flags } from "./flags"

// Built in, from the interviews: deleting folders, throwing away uncommitted
// work, overwriting shared history, and deleting untracked or matching files.
export const DEFAULTS: readonly string[] = [
  "rm -rf *",
  "rm -r *",
  "git reset --hard *",
  "git push --force *",
  "git push --force-with-lease *",
  "git clean -f *",
  "find * -delete",
]

export type Match = {
  // The list entry the command matched, shown in the prompt.
  pattern: string
}

// The built-in list with the user's changes applied: `true` adds a pattern and
// `false` removes one, built in or not.
export function list(config?: Readonly<Record<string, boolean>>) {
  const added = Object.entries(config ?? {}).flatMap(([pattern, on]) => (on ? [pattern] : []))
  return [...DEFAULTS, ...added].filter(
    (pattern, index, all) => all.indexOf(pattern) === index && config?.[pattern] !== false,
  )
}

// The first listed pattern that any part of the command matches. A pattern is
// plain words with `*` wildcards; its flags must all be present, however they
// are spelled or ordered (`rm -rf *` matches `rm -r -f src` and `rm -fr src`).
export function match(command: string, patterns: readonly string[]): Match | undefined {
  const rules = patterns.flatMap((pattern) => {
    const words = pattern.trim().split(/\s+/).filter(Boolean)
    return words.length > 0 ? [{ pattern, ...Flags.normalize(words) }] : []
  })
  const programs = rules.map((rule) => rule.words[0])
  // Any word can start a command (`sudo rm`, `time rm`, `xargs rm`), so every
  // word naming a listed program is checked together with the words after it.
  const parts = steps(command, 0).flatMap((step) =>
    step.flatMap((word, index) => {
      const program = Flags.locate([word]).program
      return programs.some((item) => Wildcard.match(program, item)) ? [Flags.normalize(step.slice(index))] : []
    }),
  )
  const rule = rules.find((rule) =>
    parts.some(
      (part) =>
        [...rule.flags].every((flag) => part.flags.has(flag)) &&
        Wildcard.match(part.words.join(" "), rule.words.join(" ")),
    ),
  )
  return rule ? { pattern: rule.pattern } : undefined
}

// Splits a command into the words of each step, roughly the way a shell would,
// but erring towards seeing more: every operator (&&, ;, |, &, parentheses, $(
// and backticks, braces, redirections) ends a step, an unclosed quote runs to
// the end, and quoted text is also split as a command of its own, so both
// `sh -c "rm -rf src"` and `echo $(rm -rf src)` are seen.
function steps(command: string, depth: number): string[][] {
  const out: string[][] = [[]]
  const nested: string[] = []
  let word: string | undefined
  const finish = () => {
    if (word !== undefined) out[out.length - 1].push(word)
    word = undefined
  }
  const next = () => {
    finish()
    out.push([])
  }
  for (let i = 0; i < command.length; i++) {
    const char = command[i]
    if (char === "\\") {
      word = (word ?? "") + (command[i + 1] ?? "")
      i++
      continue
    }
    if (char === "'" || char === '"') {
      const [text, end] = quoted(command, i)
      word = (word ?? "") + text
      if (/\s/.test(text)) nested.push(text)
      i = end
      continue
    }
    if (char === "$" && command[i + 1] === "{") {
      const end = command.indexOf("}", i)
      word = (word ?? "") + command.slice(i, end === -1 ? undefined : end + 1)
      i = end === -1 ? command.length : end
      continue
    }
    if (char === "\n" || ";&|()`{}<>".includes(char)) {
      next()
      continue
    }
    if (char === "$" && command[i + 1] === "(") {
      next()
      i++
      continue
    }
    if (/\s/.test(char)) {
      finish()
      continue
    }
    word = (word ?? "") + char
  }
  finish()
  const own = out.filter((step) => step.length > 0)
  // Three levels covers `bash -c "sudo sh -c '…'"`; deeper nesting is not worth the cost.
  if (depth >= 3) return own
  return [...own, ...nested.flatMap((text) => steps(text, depth + 1))]
}

// The text of the quoted string starting at `start`, and the index of its
// closing quote (or the end, if it is never closed).
function quoted(command: string, start: number): [string, number] {
  const quote = command[start]
  if (quote === "'") {
    const end = command.indexOf("'", start + 1)
    return end === -1 ? [command.slice(start + 1), command.length] : [command.slice(start + 1, end), end]
  }
  let text = ""
  for (let i = start + 1; i < command.length; i++) {
    if (command[i] === '"') return [text, i]
    if (command[i] === "\\" && i + 1 < command.length) {
      text += command[i + 1]
      i++
      continue
    }
    text += command[i]
  }
  return [text, command.length]
}

export * as Danger from "./danger"
