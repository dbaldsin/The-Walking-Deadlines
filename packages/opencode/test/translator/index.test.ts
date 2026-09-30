import { describe, expect, test } from "bun:test"
import { Translator } from "../../src/translator"

describe("Translator.shell", () => {
  test("keeps quoted commit messages intact", () => {
    expect(Translator.shell("git commit -m 'Fix bug'")?.what).toBe(
      'Saves a snapshot (commit) of the staged changes with the message "Fix bug"',
    )
  })

  test("describes package installs", () => {
    expect(Translator.shell("npm install react")?.what).toBe("Installs the package react")
    expect(Translator.shell("bun add react react-dom")?.what).toBe("Installs the packages react react-dom")
    expect(Translator.shell("bun install")?.what).toBe("Installs the project's dependencies")
    expect(Translator.shell("bun run build")?.what).toBe('Runs the project script "build"')
  })

  test("warns about recursive deletes", () => {
    expect(Translator.shell("rm -rf dist")?.what).toBe("Permanently deletes dist and everything inside it")
    expect(Translator.shell("rm notes.txt")?.what).toBe("Permanently deletes notes.txt")
  })

  test("warns about history-destroying git commands", () => {
    expect(Translator.shell("git push --force origin main")?.what).toContain("overwriting its history")
    expect(Translator.shell("git reset --hard HEAD~1")?.what).toContain("cannot be undone")
    expect(Translator.shell("git checkout -- src/app.ts")?.what).toBe(
      "Discards your uncommitted changes to src/app.ts",
    )
  })

  test("describes each step of chained commands", () => {
    expect(Translator.shell("rm -rf dist && bun run build")?.what).toBe(
      'Permanently deletes dist and everything inside it, then runs the project script "build"',
    )
    expect(Translator.shell("ls; pwd; git status; git diff; git log")?.what).toBe(
      "Lists the files in the current folder, then shows the current folder, then shows which files have changed, and 2 more steps",
    )
  })

  test("ignores redirections and environment assignments", () => {
    expect(Translator.shell("NODE_ENV=test bun test 2>&1")?.what).toBe("Runs the project's tests")
    expect(Translator.shell("cat package.json > copy.json")?.what).toBe("Shows the contents of package.json")
  })

  test("flags sudo", () => {
    expect(Translator.shell("sudo rm -r /opt/app")?.what).toBe(
      "Permanently deletes /opt/app and everything inside it (with administrator rights)",
    )
  })

  test("falls back to naming the program", () => {
    expect(Translator.shell("make all")?.what).toBe("Runs the program `make`")
  })

  test("passes through the agent's reason", () => {
    expect(Translator.shell("git status", "  Check what changed before committing ")).toEqual({
      what: "Shows which files have changed",
      why: "Check what changed before committing",
    })
    expect(Translator.shell("git status", "   ")?.why).toBeUndefined()
  })

  test("returns undefined for empty commands", () => {
    expect(Translator.shell("   ")).toBeUndefined()
  })
})

const diff = ["--- a.ts", "+++ a.ts", "@@ -1,2 +1,3 @@", " keep", "-old", "+new", "+extra"].join("\n")

describe("Translator.edit", () => {
  test("summarizes line changes", () => {
    expect(Translator.edit("src/a.ts", diff, "Fix the typo")).toEqual({
      what: "Edits src/a.ts (adds 2 lines, removes 1 line)",
      why: "Fix the typo",
    })
  })
})

describe("Translator.write", () => {
  test("distinguishes creating from overwriting", () => {
    expect(Translator.write("src/a.ts", false, diff).what).toBe("Creates the new file src/a.ts (2 lines)")
    expect(Translator.write("src/a.ts", true, diff).what).toBe(
      "Replaces the contents of src/a.ts (adds 2 lines, removes 1 line)",
    )
  })
})
