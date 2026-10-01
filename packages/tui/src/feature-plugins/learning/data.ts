import { createHash } from "node:crypto"
import { chmod, mkdir, realpath } from "node:fs/promises"
import path from "node:path"
import { Flock } from "@opencode-ai/core/util/flock"
import { readJson, writeJsonAtomic } from "../../util/persistence"

export namespace Learning {
  export type Evidence = { id: string; kind: "observed" | "current"; label: string; text: string }
  export type Reply = { explanation: string; evidence: string[]; notes: string[]; instruction?: string }
  export type Entry = {
    id: string
    kind: "answer" | "note" | "goal"
    text: string
    created: number
    evidence?: Evidence[]
  }
  export type Turn = {
    id?: string
    question: string
    reply: Reply
    evidence: Evidence[]
    notes: Entry[]
    version: string
  }

  export const format = {
    type: "json_schema" as const,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        explanation: {
          type: "string",
          description:
            "3–5 short plain-language sentences. Label observed facts, possible explanations and suggestions. Acknowledge missing evidence.",
        },
        evidence: { type: "array", items: { type: "string" }, description: "IDs of supplied evidence actually used." },
        notes: {
          type: "array",
          items: { type: "string" },
          description: "IDs of saved notes that influenced the explanation.",
        },
        instruction: {
          type: "string",
          description:
            "Optional specific proposed improvement for the coding agent. Never send it yourself. Empty if none.",
        },
      },
      required: ["explanation", "evidence", "notes", "instruction"],
    },
  }

  function record(value: unknown): Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Invalid learning data")
    return value as Record<string, unknown>
  }

  export function reply(value: unknown, evidence: string[], notes: string[]): Reply {
    const data = record(value)
    if (typeof data.explanation !== "string" || !data.explanation.trim())
      throw new Error("The companion returned no explanation. Try again.")
    return {
      explanation: data.explanation.slice(0, 16000),
      evidence: Array.isArray(data.evidence)
        ? data.evidence.filter((id): id is string => typeof id === "string" && evidence.includes(id))
        : [],
      notes: Array.isArray(data.notes)
        ? data.notes.filter((id): id is string => typeof id === "string" && notes.includes(id))
        : [],
      ...(typeof data.instruction === "string" && data.instruction.trim()
        ? { instruction: data.instruction.trim().slice(0, 8000) }
        : {}),
    }
  }

  // Accept SDK-shaped data without coupling the pure selection logic to generated API types.
  export function context(messages: readonly { info: unknown; parts: readonly unknown[] }[], limit = 18000) {
    const evidence: Evidence[] = []
    for (const message of messages.slice(-48)) {
      const info = record(message.info)
      const completed = info.role === "user" || (!info.error && !!record(info.time ?? {}).completed)
      for (const [index, item] of message.parts.entries()) {
        const part = record(item)
        const state = record(part.state ?? {})
        if (part.type === "tool" && state.status === "completed") {
          const input = record(state.input ?? {})
          const reference =
            typeof input.filePath === "string"
              ? input.filePath.split(/[\\/]/).slice(-3).join("/")
              : typeof input.command === "string"
                ? input.command.slice(0, 160)
                : typeof input.patchText === "string"
                  ? [...input.patchText.matchAll(/\*\*\* (?:Update|Add|Delete) File: (.+)/g)]
                      .map((match) => match[1].split(/[\\/]/).slice(-3).join("/"))
                      .join(", ")
                      .slice(0, 160)
                  : typeof input.pattern === "string"
                    ? `${input.pattern}${typeof input.path === "string" ? ` in ${input.path}` : ""}`
                    : String(info.id)
          evidence.push({
            id: String(part.id ?? `${info.id}:${index}`),
            kind: "observed",
            label: `Completed ${part.tool} · ${reference}`,
            text: JSON.stringify({
              tool: part.tool,
              input: state.input,
              output: String(state.output ?? "").slice(-4000),
              metadata: state.metadata,
            }).slice(0, 5500),
          })
        }
        if (part.type === "text" && completed && typeof part.text === "string" && !part.ignored) {
          evidence.push({
            id: String(part.id ?? `${info.id}:${index}`),
            kind: "observed",
            label: `${info.role === "user" ? "User request" : "Completed answer / recap"} · ${String(info.id)}`,
            text: part.text.slice(0, 6000),
          })
        }
      }
      if (info.role === "assistant" && info.error) {
        evidence.push({
          id: `${info.id}:error`,
          kind: "observed",
          label: "Task error / cancellation",
          text: JSON.stringify(info.error).slice(0, 2000),
        })
      }
    }
    const selected: Evidence[] = []
    let text = ""
    for (const item of evidence.toReversed()) {
      const prefix = `[${item.id}] ${item.label}\n`
      const remaining = limit - text.length - prefix.length - 2
      if (remaining <= 0) break
      const next = { ...item, text: item.text.slice(0, remaining) }
      selected.unshift(next)
      text = `${prefix}${next.text}\n\n${text}`
    }
    return { evidence: selected, text, version: createHash("sha256").update(text).digest("hex") }
  }

  export function notes(entries: Entry[], question: string) {
    const words = new Set(question.toLowerCase().match(/[a-z0-9_]{3,}/g) ?? [])
    return entries
      .map((entry) => ({
        entry,
        score: (entry.text.toLowerCase().match(/[a-z0-9_]{3,}/g) ?? []).filter((word) => words.has(word)).length,
      }))
      .filter((item) => item.score > 0 || item.entry.kind === "goal")
      .sort((a, b) => b.score - a.score || b.entry.created - a.entry.created)
      .slice(0, 4)
      .map((item) => item.entry)
  }

  export function canSuggest(input: {
    key: string
    now: number
    last: number
    paused: boolean
    unread: boolean
    busy: boolean
    seen: Set<string>
  }) {
    return (
      !input.paused && !input.unread && !input.busy && !input.seen.has(input.key) && input.now - input.last >= 60000
    )
  }

  export async function notebook(state: string, directory: string) {
    const canonical = await realpath(directory)
    const folder = path.join(state, "learning-notebook")
    const file = path.join(folder, `${createHash("sha256").update(canonical).digest("hex")}.json`)
    const read = async (): Promise<Entry[]> => {
      const data: unknown = await readJson(file).catch((error: unknown) => {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return []
        throw error
      })
      if (!Array.isArray(data)) throw new Error("Invalid notebook; existing notes were preserved")
      return data.map((value) => {
        const entry = record(value)
        if (
          typeof entry.id !== "string" ||
          typeof entry.text !== "string" ||
          typeof entry.created !== "number" ||
          !["answer", "note", "goal"].includes(String(entry.kind))
        )
          throw new Error("Invalid notebook; existing notes were preserved")
        if (
          entry.evidence !== undefined &&
          (!Array.isArray(entry.evidence) ||
            entry.evidence.some((item) => {
              const e = record(item)
              return (
                typeof e.id !== "string" ||
                typeof e.label !== "string" ||
                typeof e.text !== "string" ||
                !["observed", "current"].includes(String(e.kind))
              )
            }))
        )
          throw new Error("Invalid notebook evidence")
        return entry as Entry
      })
    }
    const update = (change: (entries: Entry[]) => Entry[]) =>
      Flock.withLock(
        `learning:${file}`,
        async () => {
          const entries = change(await read())
          await mkdir(folder, { recursive: true, mode: 0o700 })
          await chmod(folder, 0o700)
          await writeJsonAtomic(file, entries)
          await chmod(file, 0o600)
          return entries
        },
        { dir: path.join(state, "learning-locks"), timeoutMs: 10000 },
      )
    return {
      list: () =>
        Flock.withLock(`learning:${file}`, read, { dir: path.join(state, "learning-locks"), timeoutMs: 10000 }),
      add: (entry: Omit<Entry, "id" | "created">) => {
        if (!entry.text.trim()) return Promise.reject(new Error("Enter a note first"))
        const saved = structuredClone({ ...entry, id: crypto.randomUUID(), created: Date.now() })
        return update((entries) => [...entries, saved])
      },
      remove: (id: string) => update((entries) => entries.filter((entry) => entry.id !== id)),
    }
  }
}
