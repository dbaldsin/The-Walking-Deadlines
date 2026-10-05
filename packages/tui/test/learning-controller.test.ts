import { expect, test } from "bun:test"
import path from "node:path"
import { createOpencodeClient } from "@opencode-ai/sdk/v2"
import type { AssistantMessage, Event, Message, Part, Session, UserMessage } from "@opencode-ai/sdk/v2"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { createCompanion } from "../src/feature-plugins/learning/controller"
import { Learning } from "../src/feature-plugins/learning/data"
import { unwrap } from "solid-js/store"
import { tmpdir } from "./fixture/fixture"
import { json } from "./fixture/tui-sdk"

type Row = { info: Message; parts: Part[] }
type Prompt = Parameters<ReturnType<typeof createOpencodeClient>["session"]["prompt"]>[0]

function source(id: string, directory: string): Session {
  return {
    id,
    slug: id,
    projectID: "project",
    directory,
    title: id,
    version: "1",
    time: { created: 1, updated: 1 },
    model: { id: "old-model", providerID: "old-provider", variant: "old-variant" },
  }
}

function user(sessionID: string, id: string, text: string): Row {
  return {
    info: {
      id,
      sessionID,
      role: "user",
      time: { created: 1 },
      agent: "build",
      model: { providerID: "provider", modelID: "model", variant: "high" },
      system: "Source system",
      tools: { bash: true },
    },
    parts: [{ id: id + "-text", sessionID, messageID: id, type: "text", text }],
  }
}

function assistant(sessionID: string, parentID: string, directory: string, structured: unknown): AssistantMessage {
  return {
    id: parentID + "-answer",
    sessionID,
    parentID,
    role: "assistant",
    time: { created: 1, completed: 2 },
    agent: "learning-companion",
    modelID: "model",
    providerID: "provider",
    mode: "build",
    path: { cwd: directory, root: directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    finish: "stop",
    structured,
  }
}

function fixture(directory: string) {
  const sessions = new Map(["source-a", "source-b"].map((id) => [id, source(id, directory)]))
  const history = new Map<string, Row[]>([
    ["source-a", [user("source-a", "source-user-a", "Explain schema validation")]],
    ["source-b", [user("source-b", "source-user-b", "Fix tests")]],
  ])
  const cache = new Map([...history].map(([id, rows]) => [id, structuredClone(rows)]))
  const prompts: Prompt[] = []
  const sends: Prompt[] = []
  const aborts: string[] = []
  const requests: string[] = []
  const handlers = new Map<string, ((event: Event) => void)[]>()
  const disposals: (() => void | Promise<void>)[] = []
  const lifetime = new AbortController()
  const options: {
    read: boolean
    accept: boolean
    sendError: boolean
    pending?: (request: Request, prompt: Prompt, answer: Row) => Promise<Response>
  } = { read: true, accept: false, sendError: false }
  const transport = (async (input: RequestInfo | URL) => {
    if (!(input instanceof Request)) throw new Error("Expected SDK Request")
    const url = new URL(input.url)
    const parts = url.pathname.split("/").filter(Boolean)
    requests.push(input.method + " " + url.pathname)
    const sessionID = parts[1]
    if (url.pathname === "/project/current") return json({ id: "project", worktree: directory })
    if (parts[0] !== "session") throw new Error("Unexpected request " + url.pathname)
    if (input.method === "POST" && parts.length === 1) {
      const body = (await input.json()) as Partial<Session>
      const child = { ...source("child-" + sessions.size, directory), ...body } as Session
      sessions.set(child.id, child)
      history.set(child.id, [])
      return json(child)
    }
    if (input.method === "GET" && parts.length === 2) return json(sessions.get(sessionID))
    if (parts[2] === "children") return json([...sessions.values()].filter((item) => item.parentID === sessionID))
    if (parts[2] === "abort") {
      aborts.push(sessionID)
      return json(true)
    }
    if (input.method === "PATCH" && parts[4] === "part") {
      const part = (await input.json()) as Part
      const row = history.get(sessionID)!.find((row) => row.info.id === parts[3])!
      row.parts = row.parts.map((item) => (item.id === parts[5] ? part : item))
      return json(part)
    }
    if (input.method === "GET" && parts[2] === "message") {
      const rows = history.get(sessionID) ?? []
      if (parts[3]) {
        const row = rows.find((item) => item.info.id === parts[3])
        return row ? json(row) : json({ name: "NotFoundError", data: { message: "Not promoted" } }, { status: 404 })
      }
      const limit = Number(url.searchParams.get("limit"))
      const end = url.searchParams.has("before") ? Number(url.searchParams.get("before")) : rows.length
      const start = limit ? Math.max(0, end - limit) : 0
      return json(rows.slice(start, end), { headers: start ? { "X-Next-Cursor": String(start) } : {} })
    }
    if (input.method === "POST" && (parts[2] === "message" || parts[2] === "prompt_async")) {
      const prompt = { ...(await input.json()), sessionID } as Prompt
      const row: Row = {
        info: {
          ...user(sessionID, prompt.messageID!, "").info,
          agent: prompt.agent ?? "build",
          model: { ...prompt.model!, variant: prompt.variant },
          system: prompt.system,
          tools: prompt.tools,
        } as UserMessage,
        parts: prompt.parts!.map((part, index) => ({
          ...part,
          id: prompt.messageID + "-part-" + index,
          sessionID,
          messageID: prompt.messageID!,
        })) as Part[],
      }
      if (parts[2] === "prompt_async") {
        sends.push(prompt)
        if (options.accept) history.get(sessionID)!.push(row)
        if (options.sendError) throw new Error("Connection lost after admission")
        return new Response(null, { status: 204 })
      }
      prompts.push(prompt)
      const context = prompt.parts!.find((part) => part.type === "text")?.metadata?.[
        "learning.context"
      ] as Learning.Turn
      const info = assistant(sessionID, prompt.messageID!, directory, {
        explanation:
          sessions.get(sessionID)?.metadata?.["learning.role"] === "topics"
            ? "Why does schema validation help here?"
            : "Observed: the source requests schema validation.",
        evidence: context.evidence.map((item) => item.id),
        notes: context.notes.map((item) => item.id),
        instruction: "Add one validation example.",
      })
      const read: Part = {
        id: prompt.messageID + "-read",
        sessionID,
        messageID: info.id,
        type: "tool",
        callID: "read-call",
        tool: "read",
        state: {
          status: "completed",
          input: { filePath: "src/schema.ts" },
          title: "Read schema",
          output: "export const schema = true",
          metadata: {},
          time: { start: 1, end: 2 },
        },
      }
      const answer = { info, parts: options.read && prompt.tools?.read !== false ? [read] : [] }
      history.get(sessionID)!.push(row, answer)
      if (options.pending) return options.pending(input, prompt, answer)
      return json(answer)
    }
    throw new Error("Unexpected request " + input.method + " " + url.pathname)
  }) as typeof fetch
  const preferences = new Map<string, unknown>()
  const api = {
    kv: {
      ready: true,
      get: (key: string, fallback?: unknown) => preferences.get(key) ?? fallback,
      set: (key: string, value: unknown) => {
        preferences.set(key, value)
      },
    },
    client: createOpencodeClient({ baseUrl: "http://companion.test", fetch: transport }),
    state: {
      path: { state: path.join(directory, "state") },
      session: {
        get: (id: string) => sessions.get(id),
        messages: (id: string) => (cache.get(id) ?? []).map((row) => row.info),
      },
      part: (id: string) => [...cache.values()].flat().find((row) => row.info.id === id)?.parts ?? [],
    },
    event: {
      on(type: string, handler: (event: Event) => void) {
        handlers.set(type, [...(handlers.get(type) ?? []), handler])
        return () => undefined
      },
    },
    lifecycle: {
      signal: lifetime.signal,
      onDispose(fn: () => void | Promise<void>) {
        disposals.push(fn)
        return () => undefined
      },
    },
  } as unknown as TuiPluginApi
  return {
    api,
    sessions,
    history,
    cache,
    prompts,
    sends,
    aborts,
    options,
    requests,
    companion: createCompanion(api),
    create: () => createCompanion(api),
    emit(event: Event) {
      for (const handler of handlers.get(event.type) ?? []) handler(event)
    },
    async [Symbol.asyncDispose]() {
      lifetime.abort()
      await Promise.all(disposals.splice(0).map((fn) => fn()))
    },
  }
}

test("answers use isolated children, current evidence and stable follow-up snapshots", async () => {
  await using tmp = await tmpdir()
  await using f = fixture(tmp.path)
  const c = f.companion
  await c.add("source-a", "goal", "Learn schema validation")
  await c.ask("source-a", "Explain schema validation")
  const first = structuredClone(unwrap(c.records["source-a"].turns[0]))
  expect(c.records["source-a"].busy).toBe(false)
  expect(f.prompts[0]).toMatchObject({
    agent: "learning-companion",
    model: { providerID: "provider", modelID: "model" },
    variant: "high",
    format: Learning.format,
  })
  expect(f.sessions.get(f.prompts[0].sessionID)?.metadata).toEqual({
    "learning.role": "chat",
    "learning.source": "source-a",
  })
  expect(first.evidence.map((item) => item.kind)).toEqual(["observed", "current"])
  expect(first.reply.notes).toHaveLength(1)
  const read = first.evidence[1]
  const stored = f.history.get(f.prompts[0].sessionID)![0].parts[0]
  expect(stored.type === "text" && stored.metadata?.["learning.context"]).toMatchObject({ evidence: first.evidence })
  f.cache.get("source-a")![0].parts[0] = {
    id: "new",
    sessionID: "source-a",
    messageID: "source-user-a",
    type: "text",
    text: "New project facts",
  }
  await c.ask("source-a", "Simpler", first)
  expect(unwrap(c.records["source-a"].turns[1])).toMatchObject({
    evidence: first.evidence,
    notes: first.notes,
    version: first.version,
  })
  expect(f.prompts[1].tools).toEqual({ read: false, glob: false, grep: false })
  await c.ask("source-a", "Read the current project facts")
  expect(f.prompts[2].tools).toEqual({ read: true, glob: true, grep: true })
  expect(c.records["source-a"].turns[2].evidence.some((item) => item.kind === "current")).toBe(true)
  await c.ask("source-b", "Explain tests")
  expect(f.prompts[3].sessionID).not.toBe(f.prompts[0].sessionID)
  await c.save("source-a", 0)
  expect(c.records["source-a"].entries.find((item) => item.kind === "answer")?.evidence?.[1]).toEqual(read)
  const restarted = f.create()
  await restarted.load("source-a")
  expect(restarted.records["source-a"].turns).toHaveLength(3)
  expect(unwrap(restarted.records["source-a"].turns[0])).toMatchObject(first)
  expect(f.requests.some((request) => request.startsWith("DELETE"))).toBe(false)
})

test("follow-up display labels survive restore without changing the model prompt or evidence", async () => {
  await using tmp = await tmpdir()
  await using f = fixture(tmp.path)
  await f.companion.ask("source-a", "Explain schema validation")
  const first = structuredClone(unwrap(f.companion.records["source-a"].turns[0]))
  const prompt = `Explain this in simpler language.\nOriginal question: ${first.question}\nPrevious explanation: ${first.reply.explanation}`
  await f.companion.ask("source-a", prompt, first, { kind: "simpler", label: "Simpler explanation" })
  const turn = f.companion.records["source-a"].turns[1]
  expect(turn.presentation).toEqual({ kind: "simpler", label: "Simpler explanation" })
  expect(turn.question).toBe(prompt)
  expect(turn.evidence).toEqual(first.evidence)
  expect(f.prompts[1].parts?.[0]).toMatchObject({ text: prompt })
  const restored = f.create()
  await restored.load("source-a")
  expect(restored.records["source-a"].turns[1].presentation).toEqual(turn.presentation)
  await restored.save("source-a", 1)
  expect(restored.records["source-a"].entries[0].text).toStartWith("Simpler explanation\n\n")
  expect(restored.records["source-a"].entries[0].text).not.toContain("Previous explanation:")
})

test("pending question is source scoped and disappears after cancelling only its companion", async () => {
  await using tmp = await tmpdir()
  await using f = fixture(tmp.path)
  const started = Promise.withResolvers<void>()
  f.options.pending = async (request) => {
    started.resolve()
    return new Promise<Response>((_resolve, reject) =>
      request.signal.addEventListener("abort", () => reject(new Error("Cancelled")), { once: true }),
    )
  }
  const answering = f.companion.ask("source-a", "Why did this fail?")
  await started.promise
  expect(f.companion.records["source-a"].pending).toEqual({ label: "Why did this fail?" })
  expect(f.companion.records["source-b"]?.pending).toBeUndefined()
  await f.companion.cancel("source-a")
  await answering
  expect(f.companion.records["source-a"].pending).toBeUndefined()
  expect(f.companion.records["source-a"].busy).toBe(false)
  expect(f.aborts).not.toContain("source-a")
})

test("topics cannot block questions; pause and disposal stop only companion children", async () => {
  await using tmp = await tmpdir()
  await using f = fixture(tmp.path)
  const started = Promise.withResolvers<void>()
  f.options.pending = async (request, prompt, answer) => {
    if (f.sessions.get(prompt.sessionID)?.metadata?.["learning.role"] !== "topics") return json(answer)
    started.resolve()
    return new Promise<Response>((_resolve, reject) =>
      request.signal.addEventListener("abort", () => reject(new Error("Cancelled")), { once: true }),
    )
  }
  f.companion.pause("source-a", false)
  const topic = f.companion.suggest("source-a")
  await started.promise
  expect(f.companion.records["source-a"].busy).toBe(false)
  await f.companion.ask("source-a", "A direct question")
  expect(f.companion.records["source-a"].turns).toHaveLength(1)
  expect(f.prompts).toHaveLength(2)
  expect(f.prompts[0].sessionID).not.toBe(f.prompts[1].sessionID)
  const topicFormat = f.prompts[0].format as typeof Learning.format
  const chatFormat = f.prompts[1].format as typeof Learning.format
  expect(topicFormat.schema.properties.explanation.description).toContain("single question")
  expect(topicFormat.schema.properties.explanation.description).not.toContain("The idea")
  expect(chatFormat.schema.properties.explanation.description).toContain("The idea")
  expect(chatFormat.schema.properties.explanation.description).toContain("labelled")
  f.companion.pause("source-a", true)
  await topic
  expect(f.companion.records["source-a"].topic).toBeUndefined()
  expect(f.aborts).toContain(f.prompts[0].sessionID)
  expect(f.aborts).not.toContain("source-a")
  f.companion.pause("source-a", false)
  await f.companion.suggest("source-a")
  expect(f.prompts).toHaveLength(2)
  await f[Symbol.asyncDispose]()
  expect(new Set(f.aborts)).toEqual(new Set(f.prompts.map((prompt) => prompt.sessionID)))
  expect(f.aborts).not.toContain("source-a")
})

test("a busy chat still receives one deduplicated proactive topic", async () => {
  await using tmp = await tmpdir()
  await using f = fixture(tmp.path)
  const started = Promise.withResolvers<void>()
  f.options.pending = async (request, prompt, answer) => {
    if (f.sessions.get(prompt.sessionID)?.metadata?.["learning.role"] !== "chat") return json(answer)
    started.resolve()
    return new Promise<Response>((_resolve, reject) =>
      request.signal.addEventListener("abort", () => reject(new Error("Cancelled")), { once: true }),
    )
  }
  f.companion.pause("source-a", false)
  const chat = f.companion.ask("source-a", "A longer question")
  await started.promise
  expect(f.companion.records["source-a"].busy).toBe(true)
  await Promise.all([f.companion.suggest("source-a"), f.companion.suggest("source-a")])
  expect(f.companion.records["source-a"].topic).toBe("Why does schema validation help here?")
  expect(f.companion.records["source-a"].busy).toBe(true)
  expect(
    f.prompts.filter((prompt) => f.sessions.get(prompt.sessionID)?.metadata?.["learning.role"] === "topics"),
  ).toHaveLength(1)
  await f.companion.cancel("source-a")
  await chat
})

test("cancelled questions do not create answers or affect a concurrent source session", async () => {
  await using tmp = await tmpdir()
  await using f = fixture(tmp.path)
  const started = Promise.withResolvers<void>()
  f.options.pending = async (request, prompt, answer) => {
    if (f.sessions.get(prompt.sessionID)?.parentID !== "source-a") return json(answer)
    started.resolve()
    return new Promise<Response>((_resolve, reject) =>
      request.signal.addEventListener("abort", () => reject(new Error("Cancelled")), { once: true }),
    )
  }
  const answer = f.companion.ask("source-a", "Pending answer")
  await started.promise
  await f.companion.ask("source-a", "Duplicate click")
  await f.companion.ask("source-b", "Other session question")
  await f.companion.cancel("source-a")
  await answer
  expect(f.prompts).toHaveLength(2)
  expect(unwrap(f.companion.records["source-a"])).toMatchObject({ turns: [], busy: false })
  expect(f.companion.records["source-b"].turns).toHaveLength(1)
  expect(f.aborts).toEqual([f.prompts[0].sessionID])
})

test("delivery uses fresh settings and a known ID; 204 stays uncertain and retries only check", async () => {
  await using tmp = await tmpdir()
  await using f = fixture(tmp.path)
  await f.companion.load("source-a")
  const latest = user("source-a", "fresh-user", "Latest source request")
  if (latest.info.role === "user") {
    latest.info.agent = "plan"
    latest.info.model = { providerID: "fresh-provider", modelID: "fresh-model" }
    latest.info.system = "Fresh system"
    latest.info.tools = { bash: false }
  }
  f.history.get("source-a")!.push(latest)
  await f.companion.send("source-a", "Add a schema example.", "proposal-1")
  const delivery = f.companion.records["source-a"].delivery!
  expect(delivery.status).toBe("uncertain")
  expect(f.sends[0]).toMatchObject({
    sessionID: "source-a",
    messageID: delivery.id,
    agent: "plan",
    model: { providerID: "fresh-provider", modelID: "fresh-model" },
    variant: "default",
    system: "Fresh system",
    tools: { bash: false },
  })
  expect(f.sends[0].parts).toEqual([
    { type: "text", text: delivery.text, metadata: { "learning.proposalID": "proposal-1" } },
  ])
  await f.companion.send("source-a", "A different retry body", "proposal-1")
  expect(f.sends).toHaveLength(1)
  const admitted = user("source-a", delivery.id, delivery.text)
  if (admitted.parts[0].type === "text") admitted.parts[0].metadata = { "learning.proposalID": "proposal-1" }
  f.history.get("source-a")!.push(admitted)
  f.emit({
    id: "delivery-confirmed",
    type: "message.updated",
    properties: { sessionID: "source-a", info: admitted.info },
  })
  await Bun.sleep(0)
  expect(f.companion.records["source-a"].delivery?.status).toBe("sent")
  expect(f.companion.records["source-a"].error).toBeUndefined()
  f.options.accept = true
  await f.companion.send("source-a", "Another approved instruction.", "proposal-2")
  await f.companion.send("source-a", delivery.text, "proposal-1")
  expect(f.sends).toHaveLength(2)
  f.history
    .get("source-a")!
    .push(...Array.from({ length: 60 }, (_, index) => user("source-a", "later-" + index, "Later coding question")))
  const restarted = f.create()
  await restarted.send("source-a", delivery.text, "proposal-1")
  expect(f.sends).toHaveLength(2)
  expect(restarted.records["source-a"].delivery?.id).toBe(delivery.id)
})

test("a lost response never resends an admitted instruction", async () => {
  await using tmp = await tmpdir()
  await using f = fixture(tmp.path)
  f.options.accept = true
  f.options.sendError = true
  await f.companion.send("source-a", "Use the validator.", "proposal")
  expect(f.companion.records["source-a"].delivery?.status).toBe("sent")
  await f.companion.send("source-a", "Use the validator.", "proposal")
  expect(f.sends).toHaveLength(1)
  expect(f.companion.records["source-a"].error).toBeUndefined()
})

test("delivery preserves every character of the approved instruction", async () => {
  await using tmp = await tmpdir()
  await using f = fixture(tmp.path)
  await f.companion.send("source-a", " \n\t ", "blank")
  expect(f.sends).toHaveLength(0)
  expect(f.companion.records["source-a"].delivery).toBeUndefined()
  f.options.accept = true
  const approved =
    "\n  Keep this leading indentation.\n" +
    "Full approved detail. ".repeat(500) +
    "\n  Keep this trailing indentation.  \n"
  expect(approved.length).toBeGreaterThan(8000)
  await f.companion.send("source-a", approved, "exact")
  expect(f.sends[0].parts).toEqual([{ type: "text", text: approved, metadata: { "learning.proposalID": "exact" } }])
  expect(f.companion.records["source-a"].delivery?.text).toBe(approved)
  expect(f.companion.records["source-a"].delivery?.status).toBe("sent")
})

test("restoration pages past tool-heavy history and preserves the latest 30 stable turn IDs", async () => {
  await using tmp = await tmpdir()
  await using f = fixture(tmp.path)
  for (let index = 0; index < 32; index++) await f.companion.ask("source-a", "Question " + index)
  const childID = f.prompts[0].sessionID
  f.history.set(
    childID,
    f.history.get(childID)!.flatMap((row, index) =>
      row.info.role === "user"
        ? [row]
        : [
            row,
            ...Array.from({ length: 8 }, (_, step) => ({
              info: assistant(childID, "tool-step-" + index + "-" + step, tmp.path, undefined),
              parts: [],
            })),
          ],
    ),
  )
  const restarted = f.create()
  await restarted.load("source-a")
  expect(restarted.records["source-a"].turns.map((turn) => turn.question)).toEqual(
    Array.from({ length: 30 }, (_, index) => "Question " + (index + 2)),
  )
  expect(restarted.records["source-a"].turns.map((turn) => turn.id)).toEqual(
    f.prompts.slice(-30).map((prompt) => prompt.messageID),
  )
  expect(f.requests.some((request) => request.startsWith("DELETE"))).toBe(false)
})

test("topic suggestions are opt-in and persist across controller recreation", async () => {
  await using tmp = await tmpdir()
  await using f = fixture(tmp.path)
  await f.companion.load("source-a")
  expect(f.companion.records["source-a"].paused).toBe(true)
  await f.companion.suggest("source-a")
  expect(f.prompts).toHaveLength(0)
  f.companion.pause("source-a", false)
  const restored = createCompanion(f.api)
  await restored.load("source-a")
  expect(restored.records["source-a"].paused).toBe(false)
  await restored.suggest("source-a")
  expect(f.prompts).toHaveLength(1)
  restored.pause("source-a", true)
  const paused = createCompanion(f.api)
  await paused.load("source-a")
  expect(paused.records["source-a"].paused).toBe(true)
  await paused.suggest("source-a")
  expect(f.prompts).toHaveLength(1)
})
