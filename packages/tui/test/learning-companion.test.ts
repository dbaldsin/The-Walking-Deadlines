import { expect, test } from "bun:test"
import { mkdir, symlink } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "./fixture/fixture"
import { Learning } from "../src/feature-plugins/learning/data"

test("known legacy follow-ups show a short label while ordinary questions stay intact", () => {
  const question =
    "Explain this in simpler language.\nOriginal question: Explain tests\nPrevious explanation: Old answer"
  const turn = { question } as Learning.Turn
  expect(Learning.question(turn)).toBe("Simpler explanation")
  expect(turn.question).toBe(question)
  expect(
    Learning.question({
      question: "Original question: explain tests\nPrevious explanation: my own notes",
    } as Learning.Turn),
  ).toBe("Original question: explain tests\nPrevious explanation: my own notes")
  expect(Learning.question({ question: "Explain this in simpler language." } as Learning.Turn)).toBe(
    "Explain this in simpler language.",
  )
})

test("readable source labels keep historical and current lookups distinct", () => {
  const historical = {
    id: "secret-internal-id",
    kind: "observed",
    label: "Completed read · src/calculator.ts",
    text: "old evidence",
  } as Learning.Evidence
  expect(Learning.sourceLabel(historical)).toBe("Historical file read · src/calculator.ts")
  expect(Learning.sourceLabel({ ...historical, kind: "current", label: "read: src/calculator.ts" })).toBe(
    "Current file lookup · src/calculator.ts",
  )
  expect(Learning.sourceLabel({ ...historical, label: "Completed apply_patch · msg_1234" })).toBe("Completed edit")
  expect(historical.id).toBe("secret-internal-id")
  expect(historical.text).toBe("old evidence")
})

test("bounded context includes completed evidence, not running tools", () => {
  const context = Learning.context(
    [
      { info: { id: "u1", role: "user" }, parts: [{ type: "text", text: "fix test" }] },
      {
        info: { id: "a1", role: "assistant", time: { completed: 2 } },
        parts: [
          {
            id: "t1",
            type: "tool",
            tool: "bash",
            state: { status: "completed", input: { command: "bun test" }, output: "1 fail", metadata: { exit: 1 } },
          },
          { id: "t2", type: "tool", tool: "edit", state: { status: "running", input: { filePath: "unfinished.ts" } } },
          { id: "r1", type: "text", text: "## Learning Recap\nUpdated answer.ts" },
        ],
      },
    ],
    300,
  )
  expect(context.evidence.map((item) => item.id)).toEqual(["u1:0", "t1", "r1"])
  expect(JSON.stringify(context)).not.toContain("unfinished.ts")
  expect(context.evidence.some((item) => item.text.includes("1 fail"))).toBe(true)
  expect(context.evidence.find((item) => item.id === "t1")?.label).toContain("bun test")
  expect(
    Learning.context([
      {
        info: { id: "a", role: "assistant", time: { completed: 1 } },
        parts: [{ type: "text", text: "x".repeat(40000) }],
      },
    ]).text.length,
  ).toBeLessThanOrEqual(18000)
})

test("cancelled or failed answers preserve completed tools and error status, not partial answers", () => {
  const context = Learning.context([
    {
      info: {
        id: "a",
        role: "assistant",
        time: { completed: 2 },
        error: { name: "MessageAbortedError", data: { message: "Cancelled" } },
      },
      parts: [
        {
          id: "t",
          type: "tool",
          tool: "read",
          state: { status: "completed", input: { filePath: "/project/src/schema.ts" }, output: "completed read" },
        },
        { id: "partial", type: "text", text: "I finished everything" },
      ],
    },
  ])
  expect(context.evidence.map((item) => item.id)).toEqual(["t", "a:error"])
  expect(context.evidence[0].label).toContain("src/schema.ts")
  expect(context.text).toContain("Cancelled")
  expect(context.text).not.toContain("I finished everything")
})

test("reply references must match supplied evidence and notes", () => {
  expect(
    Learning.reply(
      {
        explanation: "Observed change.",
        evidence: ["t1", "invented"],
        notes: ["n1", "unknown"],
        instruction: "Add a regression test.",
      },
      ["t1"],
      ["n1"],
    ),
  ).toEqual({ explanation: "Observed change.", evidence: ["t1"], notes: ["n1"], instruction: "Add a regression test." })
  expect(() => Learning.reply({ explanation: "", evidence: [] }, [], [])).toThrow()
})

test("suggestions are quiet, deduplicated and at least 60 seconds apart", () => {
  const input = {
    key: "edit1",
    now: 60000,
    last: 0,
    paused: false,
    unread: false,
    busy: false,
    seen: new Set<string>(),
  }
  expect(Learning.canSuggest(input)).toBe(true)
  expect(Learning.canSuggest({ ...input, now: 59999 })).toBe(false)
  for (const flag of ["paused", "unread", "busy"] as const)
    expect(Learning.canSuggest({ ...input, [flag]: true })).toBe(false)
  expect(Learning.canSuggest({ ...input, seen: new Set(["edit1"]) })).toBe(false)
})

test("notebook survives reload, preserves evidence, isolates projects and concurrent writers", async () => {
  await using tmp = await tmpdir()
  const state = path.join(tmp.path, "state")
  const a = path.join(tmp.path, "project-a")
  const b = path.join(tmp.path, "project-b")
  await mkdir(a)
  await mkdir(b)
  await symlink(a, path.join(tmp.path, "alias"))
  const book = await Learning.notebook(state, a)
  const alias = await Learning.notebook(state, path.join(tmp.path, "alias"))
  const evidence = [{ id: "e", kind: "observed" as const, label: "edit answer.ts", text: "old change" }]
  await Promise.all([
    book.add({ kind: "answer", text: "Saved answer", evidence }),
    alias.add({ kind: "goal", text: "Understand tests" }),
  ])
  evidence[0].text = "new change"
  const restarted = await Learning.notebook(state, a)
  expect((await restarted.list()).length).toBe(2)
  expect((await restarted.list()).find((item) => item.kind === "answer")?.evidence?.[0].text).toBe("old change")
  expect(await (await Learning.notebook(state, b)).list()).toEqual([])
  const entry = (await restarted.list())[0]
  await restarted.remove(entry.id)
  expect((await book.list()).length).toBe(1)
})

test("notebook storage errors propagate instead of claiming Saved", async () => {
  await using tmp = await tmpdir()
  await Bun.write(path.join(tmp.path, "blocked"), "file")
  const book = await Learning.notebook(path.join(tmp.path, "blocked"), tmp.path)
  await expect(book.add({ kind: "note", text: "important" })).rejects.toThrow()
})

test("relevant notes identify their influence and exclude unrelated answers", () => {
  const entries: Learning.Entry[] = [
    { id: "n1", kind: "note", text: "Explain schema validation simply", created: 1 },
    { id: "n2", kind: "answer", text: "The CSS background is blue", created: 2 },
    { id: "g", kind: "goal", text: "Learn testing", created: 3 },
  ]
  expect(Learning.notes(entries, "schema validation").map((x) => x.id)).toEqual(["n1", "g"])
})

test("historical env-file contents never enter explanation or notebook evidence", () => {
  const context = Learning.context([
    {
      info: { id: "msg_secret", role: "assistant", time: { completed: 1 } },
      parts: [
        {
          id: "secret",
          type: "tool",
          tool: "read",
          state: { status: "completed", input: { filePath: "/project/.env.local" }, output: "API_KEY=private-value" },
        },
        {
          id: "safe",
          type: "tool",
          tool: "read",
          state: { status: "completed", input: { filePath: "/project/app.ts" }, output: "const answer = 42" },
        },
      ],
    },
  ])
  expect(context.text).not.toContain("private-value")
  expect(context.evidence.map((item) => item.id)).toEqual(["safe"])
})
