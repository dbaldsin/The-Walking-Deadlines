/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { BoxRenderable, MarkdownRenderable, ScrollBoxRenderable, type Renderable } from "@opentui/core"
import type { Learning } from "../src/feature-plugins/learning/data"
import { tmpdir } from "./fixture/fixture"
import { learningTurn, learningView } from "./fixture/learning-view"

const entries: Learning.Entry[] = [
  {
    id: "answer",
    kind: "answer",
    text: "# Why `zero` matters\n\nANSWER BODY ONLY: zero catches the old addition bug.",
    created: new Date(2026, 9, 1, 12).getTime(),
    evidence: [
      { id: "saved-test", kind: "observed", label: "Completed bash · bun test", text: "SAVED EVIDENCE: 2 passes" },
    ],
  },
  {
    id: "note",
    kind: "note",
    text: "# Boundary inputs\n\nNOTE BODY ONLY: inspect zero and negative inputs.",
    created: new Date(2026, 9, 2, 12).getTime(),
  },
  {
    id: "goal",
    kind: "goal",
    text: "# Understand regression tests\n\nGOAL BODY ONLY: explain why this test prevents a repeated mistake.",
    created: new Date(2026, 9, 3, 12).getTime(),
  },
]

function descendants(root: Renderable): Renderable[] {
  return [root, ...root.getChildren().flatMap(descendants)]
}

function detail(view: Awaited<ReturnType<typeof learningView>>) {
  return descendants(view.find("notebook-detail")!).filter((node) => node instanceof MarkdownRenderable)
}

test("Notebook filters show counts and select entries from the chosen kind", async () => {
  await using tmp = await tmpdir()
  await using view = await learningView(tmp.path, 140, 36, { entries })
  await view.click("learning-notebook")
  const frame = view.app.captureCharFrame()
  for (const label of ["All · 3", "Answers · 1", "Notes · 1", "Goals · 1"]) expect(frame).toContain(label)
  await view.click("notebook-filter-note")
  expect(view.find("notebook-row-answer")).toBeUndefined()
  expect(view.find("notebook-row-goal")).toBeUndefined()
  expect(detail(view).map((node) => node.content)).toEqual([entries[1].text])
  await view.click("notebook-filter-goal")
  expect(detail(view).map((node) => node.content)).toEqual([entries[2].text])
  await view.click("notebook-filter-answer")
  expect(detail(view).map((node) => node.content)).toEqual([entries[0].text])
  await view.click("notebook-filter-all")
  expect(view.find("notebook-row-note")).toBeDefined()
  expect(detail(view).map((node) => node.content)).toEqual([entries[0].text])
  expect(view.records.source.entries).toEqual(entries)
})

test("Notebook command-center rows show distinct dots, readable titles, dates and a full-row selection", async () => {
  await using tmp = await tmpdir()
  await using view = await learningView(tmp.path, 140, 36, { entries })
  await view.click("learning-notebook")
  await view.click("learning-layout")
  const list = view.find("notebook-list")!
  const selected = view.find("notebook-entry-answer") as BoxRenderable
  expect(selected.width).toBe(list.width)
  expect(selected.height).toBe(1)
  const rendered = view.app.captureSpans()
  const markers = entries.map((entry) => {
    const row = view.find(`notebook-entry-${entry.id}`)!
    const spans = rendered.lines[row.y].spans
    expect(spans.map((span) => span.text).join("")).toContain("●")
    expect(spans.map((span) => span.text).join("")).toContain(new Date(entry.created).toLocaleDateString())
    return spans.find((span) => span.text.includes("●"))!.fg
  })
  expect(markers[0].equals(markers[1])).toBe(false)
  expect(markers[1].equals(markers[2])).toBe(false)
  const frame = view.app.captureCharFrame()
  expect(frame).toContain("Why zero matters")
  expect(frame).toContain("Boundary inputs")
  expect(frame).toContain("Understand regression")
  expect(frame).toContain("Answer")
  expect(frame).toContain("Note")
  expect(frame).toContain("Goal")
  expect(selected.backgroundColor.equals((view.find("notebook-entry-note") as BoxRenderable).backgroundColor)).toBe(
    false,
  )
})

test("Notebook renders only the selected Markdown and expands saved sources locally", async () => {
  await using tmp = await tmpdir()
  await using view = await learningView(tmp.path, 140, 36, { entries })
  await view.click("learning-notebook")
  expect(descendants(view.find("learning-body")!).filter((node) => node instanceof MarkdownRenderable)).toHaveLength(1)
  expect(view.app.captureCharFrame()).not.toContain("SAVED EVIDENCE: 2 passes")
  await view.click("notebook-sources")
  await view.click("evidence-answer-saved-test")
  expect(view.app.captureCharFrame()).toContain("SAVED EVIDENCE: 2 passes")
  expect(view.asked).toHaveLength(0)
  expect(view.records.source.entries[0]).toEqual(entries[0])
  const body = view.find("learning-body") as ScrollBoxRenderable
  body.scrollChildIntoView("notebook-entry-note")
  await view.flush()
  expect(view.find("notebook-entry-note")!.y).toBeGreaterThanOrEqual(body.viewport.y)
  await view.click("notebook-entry-note")
  expect(detail(view).map((node) => node.content)).toEqual([entries[1].text])
  expect(view.find("notebook-sources")).toBeUndefined()
  expect(view.main().plainText).toBe("unsent coding draft")
})

test("Notebook selection follows stable entry IDs through filters, reordering and removal", async () => {
  await using tmp = await tmpdir()
  const other: Learning.Entry = { id: "other-note", kind: "note", text: "Another note\n\nOTHER NOTE BODY", created: 1 }
  await using view = await learningView(tmp.path, 140, 36, { entries: [...entries, other] })
  await view.click("learning-notebook")
  await view.click("notebook-filter-note")
  await view.click("notebook-entry-other-note")
  view.set("source", "entries", [other, entries[2], entries[0], entries[1]])
  await view.flush()
  expect(detail(view).map((node) => node.content)).toEqual([other.text])
  await view.click("notebook-filter-all")
  expect(detail(view).map((node) => node.content)).toEqual([other.text])
  await view.click("notebook-filter-note")
  view.app.mockInput.pressArrow("down", { meta: true })
  await view.flush()
  expect(detail(view).map((node) => node.content)).toEqual([entries[1].text])
  view.app.mockInput.pressKey("d", { ctrl: true })
  await view.flush()
  expect(view.removed).toEqual(["note"])
  // The controller publishes the new entry list only after atomic storage succeeds.
  view.set("source", "entries", [other, entries[2], entries[0]])
  await view.flush()
  expect(detail(view).map((node) => node.content)).toEqual([other.text])
  expect(view.app.captureCharFrame()).toContain("Notes · 1")
  await view.click("notebook-filter-goal")
  view.set("source", "entries", [other, entries[0]])
  await view.flush()
  expect(view.app.captureCharFrame()).toContain("No goals yet")
  expect(view.find("notebook-detail")).toBeUndefined()
  expect(view.find("learning-add-goal")).toBeDefined()
})

test("Notebook adapts from 80×24 inline detail to a divided fullscreen list and detail", async () => {
  await using tmp = await tmpdir()
  await using view = await learningView(tmp.path, 80, 24, { entries })
  await view.click("learning-notebook")
  expect(view.find("notebook-detail")!.parent?.id).toBe("notebook-row-answer")
  for (const id of ["learning-input", "learning-add-note", "learning-add-goal"]) {
    const control = view.find(id)!
    expect(control.y + control.height).toBeLessThanOrEqual(23)
  }
  expect(view.input().height).toBe(3)
  view.app.renderer.resize(140, 36)
  await view.flush()
  expect(view.find("notebook-detail")!.parent?.id).toBe("notebook-row-answer")
  await view.click("learning-layout")
  const list = view.find("notebook-list")!
  const selected = view.find("notebook-detail")!
  expect(selected.parent?.id).not.toBe("notebook-row-answer")
  expect(selected.x).toBeGreaterThanOrEqual(list.x + list.width + 1)
  expect(view.app.captureCharFrame()).toContain("│")
  expect(detail(view).map((node) => node.content)).toEqual([entries[0].text])
})

test("opening Notebook from a long scrolled chat reveals its heading, filters and first entry", async () => {
  await using tmp = await tmpdir()
  const turn = learningTurn()
  turn.reply.explanation = Array.from({ length: 50 }, (_, i) => `Paragraph ${i}: completed test evidence.`).join("\n\n")
  await using view = await learningView(tmp.path, 140, 24, { entries, turns: [turn] })
  const body = view.find("learning-body") as ScrollBoxRenderable
  body.scrollTo(body.scrollHeight)
  await view.flush()
  expect(body.scrollTop).toBeGreaterThan(0)
  await view.click("learning-notebook")
  expect(body.scrollTop).toBe(0)
  const frame = view.app.captureCharFrame()
  expect(frame).toContain("Project notebook")
  expect(frame).toContain("Answers · 1")
  expect(frame).toContain("Why zero matters")
  expect(view.find("notebook-entry-answer")!.y).toBeGreaterThanOrEqual(body.viewport.y)
})
