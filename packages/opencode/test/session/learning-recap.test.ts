import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { LearningRecap } from "@/session/learning-recap"

const decode = Schema.decodeUnknownSync(LearningRecap.Info)

describe("LearningRecap.Info", () => {
  test("accepts complete recap information", () => {
    const input = {
      changedFiles: [{ file: "src/session/learning-recap.ts", additions: 24, deletions: 0, status: "added" as const }],
      decisions: ["Keep the first-sprint recap contract independent of storage and UI."],
      tests: [
        {
          command: "bun test test/session/learning-recap.test.ts",
          status: "passed" as const,
          summary: "4 tests passed",
        },
      ],
    }

    expect(decode(input)).toEqual(input)
  })

  test("accepts an empty recap when information is unavailable", () => {
    expect(decode({})).toEqual({})
  })

  test("accepts partial recap information", () => {
    const input = {
      tests: [
        { command: "bun test", status: "failed" as const, summary: "One test failed" },
        { command: "bun typecheck", status: "not-run" as const },
      ],
    }

    expect(decode(input)).toEqual(input)
  })

  test("rejects invalid test result data", () => {
    expect(() => decode({ tests: [{ command: "bun test", status: "unknown" }] })).toThrow()
    expect(() => decode({ tests: [{ status: "passed" }] })).toThrow()
  })
})
