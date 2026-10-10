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

  test("ignores environment assignments and redirections that do not touch files", () => {
    expect(Translator.shell("NODE_ENV=test bun test 2>&1")?.what).toBe("Runs the project's tests")
    expect(Translator.shell("bun test > /dev/null 2>&1")?.what).toBe("Runs the project's tests")
    expect(Translator.shell("sort < names.txt")?.what).toBe("Runs the program `sort`")
  })

  test("describes files written by output redirection", () => {
    expect(Translator.shell("cat package.json > copy.json")?.what).toBe(
      "Shows the contents of package.json and writes the output to copy.json (creating or overwriting it)",
    )
    expect(Translator.shell("cat package.json >copy.json")?.what).toBe(
      "Shows the contents of package.json and writes the output to copy.json (creating or overwriting it)",
    )
    expect(Translator.shell("echo done >> log.txt")?.what).toBe("Prints text and adds the output to the end of log.txt")
    expect(Translator.shell("make 2> errors.log")?.what).toBe(
      "Runs the program `make` and writes the error messages to errors.log (creating or overwriting it)",
    )
    expect(Translator.shell('bun run build &> "build output.log"')?.what).toBe(
      'Runs the project script "build" and writes the output and error messages to build output.log (creating or overwriting it)',
    )
    expect(Translator.shell("> notes.txt")?.what).toBe("Empties notes.txt (creating it if needed)")
    expect(Translator.shell("echo hi | tee out.txt")?.what).toBe(
      "Prints text, then writes its input to out.txt (creating or overwriting it)",
    )
  })

  test("falls back to a warning when the shell syntax cannot be summarized safely", () => {
    const fallback = "Runs a shell command that is too complex to summarize safely. Review the full command before allowing it"
    expect(Translator.shell("echo $(rm -rf dist)")?.what).toBe(fallback)
    expect(Translator.shell("echo `whoami`")?.what).toBe(fallback)
    expect(Translator.shell("cat > out.txt <<EOF\nhello\nEOF")?.what).toBe(fallback)
    expect(Translator.shell("diff <(ls a) <(ls b)")?.what).toBe(fallback)
    expect(Translator.shell("(cd dist && rm -rf assets)")?.what).toBe(fallback)
    expect(Translator.shell('echo "unterminated > out.txt')?.what).toBe(fallback)
    expect(Translator.shell("cat package.json >")?.what).toBe(fallback)
    expect(Translator.shell("echo $(ls)", "List files")?.why).toBe("List files")
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
