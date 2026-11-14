import { expect, test } from "bun:test"
import { mkdir, symlink } from "node:fs/promises"
import path from "node:path"
import { MarkdownRenderable, type ScrollBoxRenderable } from "@opentui/core"
import fc from "fast-check"
import { Learning } from "../src/feature-plugins/learning/data"
import { tmpdir } from "./fixture/fixture"
import { learningTurn, learningView } from "./fixture/learning-view"

// Include indentation, quotes, line breaks and non-ASCII file names from real questions and instructions.
const text = fc
  .tuple(
    fc.string({ minLength: 1, maxLength: 40 }),
    fc.constantFrom("src/算数.ts", '"with spaces"', "calculator.test.ts"),
  )
  .map(([detail, file]) => `  Review ${file}\n    ${detail}\n`)
const wideWidth = fc.integer({ min: 128, max: 160 })
const narrowWidth = fc.integer({ min: 80, max: 127 })
const renderRuns = { numRuns: 30 }

// R1: Send the exact previewed instruction to the coding agent only after explicit approval.
// Kind: invariant. Edits range from short inputs to multiline instructions with significant whitespace.
test("R1 · only approval sends the exact text and destination once", async () => {
  await fc.assert(
    fc.asyncProperty(narrowWidth, text, text, async (width, proposed, edited) => {
      await using tmp = await tmpdir()
      const turn = learningTurn()
      turn.reply.instruction = proposed
      await using view = await learningView(tmp.path, width, 30, { turns: [turn] })
      view.app.mockInput.pressKey("g", { ctrl: true })
      await view.flush()
      expect(view.find("learning-destination")).toBeDefined()
      expect(view.input().plainText).toBe(proposed)
      expect(view.sent).toEqual([])

      view.input().setText(edited)
      view.find("learning-approve")!.focus()
      view.app.mockInput.pressEnter()
      await view.flush()
      expect(view.deliveries).toEqual([{ sourceID: "source", text: edited, proposalID: "turn-0" }])
      expect(view.find("learning-approve")).toBeUndefined()
    }),
    renderRuns,
  )
}, 60_000)

// R2: Back must restore the Chat draft and position and leave the coding conversation unchanged.
// Kind: round-trip. Several turns and an interior scroll offset distinguish restoration from jumping to either end.
test("R2 · opening a preview and going Back restores the Chat draft and scroll position", async () => {
  await fc.assert(
    fc.asyncProperty(
      wideWidth,
      text,
      fc.integer({ min: 3, max: 9 }),
      fc.integer({ min: 1, max: 4 }),
      async (width, draft, count, offset) => {
        await using tmp = await tmpdir()
        const turns = Array.from({ length: count }, (_, index) => learningTurn(index))
        await using view = await learningView(tmp.path, width, 24, { turns })
        view.input().setText(draft)
        const body = view.find("learning-body") as ScrollBoxRenderable
        body.scrollTo(offset)
        await view.flush()
        expect(body.scrollTop).toBe(offset)

        view.input().focus()
        view.app.mockInput.pressKey("g", { ctrl: true })
        await view.flush()
        expect(view.find("learning-destination")).toBeDefined()
        view.input().setText("Do something else")
        view.find("learning-back")!.focus()
        view.app.mockInput.pressEnter()
        await view.flush()

        expect(view.input().plainText).toBe(draft)
        expect((view.find("learning-body") as ScrollBoxRenderable).scrollTop).toBe(offset)
        expect(view.records.source.turns).toEqual(turns)
        expect(view.main().plainText).toBe("unsent coding draft")
        expect(view.app.captureCharFrame()).toContain("CODING TASK STARTED")
        expect(view.asked).toEqual([])
        expect(view.sent).toEqual([])
      },
    ),
    renderRuns,
  )
}, 60_000)

// R3: Keep saved notebook entries and their sources scoped to the project across restarts and new sessions.
// Kind: round-trip. Both projects share the state directory and basename; project A also has a symlink alias.
test("R3 · saved answers and sources survive reopening and stay in their project", async () => {
  const sources = fc.array(
    fc.record({ id: fc.uuid(), kind: fc.constantFrom("observed" as const, "current" as const), label: text, text }),
    { minLength: 1, maxLength: 4 },
  )
  await fc.assert(
    fc.asyncProperty(text, text, sources, async (answer, otherAnswer, evidence) => {
      await using tmp = await tmpdir()
      const state = path.join(tmp.path, "state")
      const projectA = path.join(tmp.path, "a", "calculator")
      const projectB = path.join(tmp.path, "b", "calculator")
      const alias = path.join(tmp.path, "other-path-to-a")
      await mkdir(projectA, { recursive: true })
      await mkdir(projectB, { recursive: true })
      await symlink(projectA, alias)
      const first = await Learning.notebook(state, projectA)
      const entry = { kind: "answer" as const, text: answer, evidence }
      const saved = await first.add(entry)
      expect(saved).toEqual([{ ...entry, id: expect.any(String), created: expect.any(Number) }])

      expect(await (await Learning.notebook(state, projectA)).list()).toEqual(saved)
      const other = await Learning.notebook(state, projectB)
      expect(await other.list()).toEqual([])
      await other.add({ kind: "answer", text: otherAnswer })
      expect(await other.list()).toEqual([
        { kind: "answer", text: otherAnswer, id: expect.any(String), created: expect.any(Number) },
      ])
      expect(await (await Learning.notebook(state, alias)).list()).toEqual(saved)
    }),
    { numRuns: 100 },
  )
}, 60_000)

// R4: Preserve the draft, chat history, and notebook entries and selection when switching layouts.
// Kind: metamorphic. Resize across the split threshold with each tab active and a non-default note selected.
test("R4 · resizing between split and fullscreen preserves Chat and Notebook state", async () => {
  await fc.assert(
    fc.asyncProperty(
      wideWidth,
      narrowWidth,
      text,
      fc.integer({ min: 1, max: 3 }),
      async (wide, narrow, draft, selected) => {
        await using tmp = await tmpdir()
        const turns = [learningTurn(0), learningTurn(1)]
        const entries = Array.from({ length: 4 }, (_, index) => ({
          id: `note-${index}`,
          kind: "note" as const,
          text: `Calculation note ${index}`,
          created: index,
        }))
        await using view = await learningView(tmp.path, wide, 36, { turns, entries })
        const splitWidth = view.find("learning-overlay")!.width
        expect(splitWidth).toBeLessThan(wide - 2)
        view.input().setText(draft)
        view.app.renderer.resize(narrow, 36)
        await view.flush()
        expect(view.find("learning-overlay")!.width).toBe(narrow - 2)
        expect(view.input().plainText).toBe(draft)
        expect(view.records.source.turns).toEqual(turns)
        expect(view.find("answer-turn-0")).toBeDefined()

        await view.click("learning-notebook")
        view.find(`notebook-entry-note-${selected}`)!.focus()
        view.app.mockInput.pressEnter()
        await view.flush()
        const selectedText = () =>
          view
            .find("notebook-detail")!
            .getChildren()
            .find((node) => node instanceof MarkdownRenderable)?.content
        expect(selectedText()).toBe(entries[selected].text)
        view.app.renderer.resize(wide, 36)
        await view.flush()
        expect(view.find("learning-overlay")!.width).toBe(splitWidth)
        expect(selectedText()).toBe(entries[selected].text)
        expect(view.records.source.entries).toEqual(entries)
        for (const entry of entries) expect(view.find(`notebook-entry-${entry.id}`)).toBeDefined()
        await view.click("learning-chat")
        expect(view.input().plainText).toBe(draft)
        expect(view.records.source.turns).toEqual(turns)
        expect(view.find("answer-turn-1")).toBeDefined()
      },
    ),
    renderRuns,
  )
}, 60_000)
