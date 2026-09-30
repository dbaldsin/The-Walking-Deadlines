import { FileDiff } from "@opencode-ai/schema/file-diff"
import { Schema } from "effect"
import { optional } from "@opencode-ai/core/schema"

export const TestStatus = Schema.Literals(["passed", "failed", "not-run"])
export type TestStatus = typeof TestStatus.Type

export const TestResult = Schema.Struct({
  command: Schema.String,
  status: TestStatus,
  summary: optional(Schema.String),
}).annotate({ identifier: "LearningRecapTestResult" })
export interface TestResult extends Schema.Schema.Type<typeof TestResult> {}

export const Info = Schema.Struct({
  changedFiles: optional(Schema.Array(FileDiff.Info)),
  decisions: optional(Schema.Array(Schema.String)),
  tests: optional(Schema.Array(TestResult)),
}).annotate({ identifier: "LearningRecap" })
export interface Info extends Schema.Schema.Type<typeof Info> {}

export * as LearningRecap from "./learning-recap"
