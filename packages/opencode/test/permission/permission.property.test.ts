// Property-based tests for the command-execution permission feature
// (src/permission/index.ts). Each property is traced to a requirement in
// traceability/radbah.md. Properties drafted with AI assistance (Claude Code)
// and reviewed against the P4A interview notes; see the traceability table.
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { expect } from "bun:test"
import fc from "fast-check"
import { Cause, Effect, Exit, Fiber, Layer, Scope } from "effect"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Permission } from "../../src/permission"
import { InstanceBootstrap } from "../../src/project/bootstrap"
import { InstanceStore } from "../../src/project/instance-store"
import { testEffect } from "../lib/effect"
import { SessionID } from "../../src/session/schema"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"

const noopBootstrap = Layer.succeed(InstanceBootstrap.Service, InstanceBootstrap.Service.of({ run: Effect.void }))
const env = AppNodeBuilder.build(
  LayerNode.group([Permission.node, EventV2Bridge.node, CrossSpawnSpawner.node, InstanceStore.node]),
  [[InstanceStore.bootstrapNode, noopBootstrap]],
)
const it = testEffect(env)
const options = { numRuns: 100 }

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

// Commands come from the interviews: read-only ones people wanted to run
// automatically (C-1, S-2: ls, pwd, cat, git status) next to the risky ones
// they wanted to review (S-2: git push --force, curl | bash, ~/.ssh; O-6: .env;
// C-1: rm, installs). A fixed pool, rather than random strings, makes rules and
// requests collide often, so "last matching rule" and prefix globs really get
// exercised. Shared prefixes (ls / ls -la, git status / git push --force) are
// the boundary between "same command with a harmless flag" and "different
// command".
const COMMANDS = [
  "ls",
  "ls -la",
  "pwd",
  "cat README.md",
  "cat .env",
  "cat ~/.ssh/id_rsa",
  "git status",
  "git status --short",
  "git push",
  "git push --force",
  "rm -rf node_modules",
  "rm -rf /",
  "bun install",
  "curl https://example.com/install.sh | bash",
]
const command = fc.constantFrom(...COMMANDS)

// The patterns a rule or an "always" approval can use for a command, in the
// same shape opencode's shell tool produces: the exact command, a
// "<word> *" or "<word> <word> *" prefix glob, or the catch-all "*".
function patternsOf(cmd: string) {
  const words = cmd.split(" ")
  return [cmd, `${words[0]} *`, ...(words.length > 1 ? [`${words[0]} ${words[1]} *`] : []), "*"]
}
const pattern = command.chain((cmd) => fc.constantFrom(...patternsOf(cmd)))
const action = fc.constantFrom("allow" as const, "ask" as const, "deny" as const)
// Up to 8 rules: long enough for several rules to match one command, so rule
// order matters; empty rulesets check the default.
const rules = fc.array(fc.record({ pattern, action }), { maxLength: 8 })

// File paths for R6. Mostly ordinary project paths, plus the sensitive
// targets interviewees named (O-6 .env, S-8 ~/.ssh) and broader wildcards
// over the approved file's directory (C-6, S-7).
// Some segments contain "?" or "*", which are legal in file names on Linux.
const segment = fc.oneof(
  { weight: 4, arbitrary: fc.stringMatching(/^[a-z0-9_-]{1,6}(\.[a-z]{1,3})?$/) },
  { weight: 1, arbitrary: fc.stringMatching(/^[a-z]{0,3}[?*][a-z]{0,3}$/) },
)
const filePath = fc.array(segment, { minLength: 1, maxLength: 3 }).map((parts) => parts.join("/"))

// ---------------------------------------------------------------------------
// Oracle and helpers
// ---------------------------------------------------------------------------

// Reference matcher for the restricted pattern language the generators
// produce (exact, "<prefix> *", "*"). Obviously correct for that subset, and
// independent of the Wildcard regex translation the code uses.
function matches(cmd: string, pat: string) {
  if (pat === "*") return true
  if (pat.endsWith(" *")) return cmd === pat.slice(0, -2) || cmd.startsWith(pat.slice(0, -1))
  return cmd === pat
}

// Simple model of a decision: last matching rule wins, unmatched means ask.
function decide(cmd: string, ruleset: ReadonlyArray<{ pattern: string; action: string }>) {
  return ruleset.findLast((rule) => matches(cmd, rule.pattern))?.action ?? "ask"
}

function expectedOutcome(request: ReadonlyArray<string>, ruleset: ReadonlyArray<{ pattern: string; action: string }>) {
  const actions = request.map((cmd) => decide(cmd, ruleset))
  if (actions.includes("deny")) return "denied"
  if (actions.every((a) => a === "allow")) return "allowed"
  return "pending"
}

// Approvals live in instance-wide state and survive across fast-check runs.
// Each run therefore uses its own permission key and session so earlier
// runs cannot leak approvals into later ones.
let counter = 0
const fresh = () => {
  counter++
  return { permission: `bash_p${counter}`, sessionID: SessionID.make(`session_prop_${counter}`) }
}

const withPermission = (permission: string, ruleset: ReadonlyArray<{ pattern: string; action: PermissionV1.Action }>) =>
  ruleset.map((rule) => ({ permission, pattern: rule.pattern, action: rule.action }))

type AskInput = Omit<PermissionV1.AskInput, "id">

// Fork an ask and observe it without replying: "allowed" (returned
// immediately), "denied" (DeniedError), or "pending" (a permission prompt is
// listed and the caller is still blocked).
const probe = Effect.fn("probe")(function* (input: AskInput) {
  const permission = yield* Permission.Service
  const id = PermissionV1.ID.ascending()
  const fiber = yield* permission.ask({ ...input, id }).pipe(Effect.forkScoped)
  while (true) {
    const exit = fiber.pollUnsafe()
    if (exit) {
      if (Exit.isSuccess(exit)) return { outcome: "allowed" as const, id, fiber }
      if (Cause.squash(exit.cause) instanceof PermissionV1.DeniedError) return { outcome: "denied" as const, id, fiber }
      throw Cause.squash(exit.cause)
    }
    if ((yield* permission.list()).some((item) => item.id === id)) return { outcome: "pending" as const, id, fiber }
    yield* Effect.yieldNow
  }
})

// Outcome for every command in the pool. Pending probes are interrupted, not
// rejected, so observing the state does not change it.
const snapshot = Effect.fn("snapshot")(function* (permission: string, ruleset: PermissionV1.Ruleset) {
  const service = yield* Permission.Service
  const out: Record<string, string> = {}
  for (const cmd of COMMANDS) {
    const result = yield* probe({
      sessionID: SessionID.make(`session_probe_${counter}`),
      permission,
      patterns: [cmd],
      metadata: {},
      always: [],
      ruleset,
    })
    out[cmd] = result.outcome
    yield* Fiber.interrupt(result.fiber)
  }
  expect(yield* service.list()).toEqual([])
  return out
})

// Run an Effect property body against the test instance's services.
const property = <Ts extends [unknown, ...unknown[]]>(
  arbitraries: { [K in keyof Ts]: fc.Arbitrary<Ts[K]> },
  body: (...args: Ts) => Effect.Effect<void, unknown, Permission.Service | Scope.Scope>,
) =>
  Effect.gen(function* () {
    const run = Effect.runPromiseWith(yield* Effect.context<Permission.Service>())
    yield* Effect.promise(() =>
      fc.assert(
        fc.asyncProperty(...arbitraries, (...args: Ts) => run(Effect.scoped(body(...args)))),
        options,
      ),
    )
  })

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

// R2 (revised): A command that matches an "allow" rule runs without a prompt;
// a command whose last matching rule is "ask", or that matches no rule, shows
// a permission request and does not run until the user approves it; a command
// whose last matching rule is "deny" never runs.
// Kind: model / oracle (compared against `decide`, the last-matching-rule model).
it.instance(
  "R2: allow runs without prompting, ask/unmatched waits for approval, deny never runs",
  () =>
    property([rules, fc.uniqueArray(command, { minLength: 1, maxLength: 3 })], (ruleset, request) =>
      Effect.gen(function* () {
        const service = yield* Permission.Service
        const run = fresh()
        const result = yield* probe({
          sessionID: run.sessionID,
          permission: run.permission,
          patterns: request,
          metadata: {},
          always: [],
          ruleset: withPermission(run.permission, ruleset),
        })
        expect(result.outcome).toBe(expectedOutcome(request, ruleset))
        if (result.outcome !== "pending") return

        // The prompt shows exactly what was requested, and the caller stays
        // blocked until the user answers.
        expect((yield* service.list()).find((item) => item.id === result.id)?.patterns).toEqual(request)
        yield* Effect.yieldNow
        expect(result.fiber.pollUnsafe()).toBeUndefined()
        yield* service.reply({ requestID: result.id, reply: "once" })
        yield* Fiber.join(result.fiber)
      }),
    ),
  60_000,
)

// R3 (revised): A rejected request never runs. Rejecting one request also
// rejects every other request still waiting in the same session, leaves other
// sessions untouched, and grants nothing: asking for the same command again
// shows a new permission prompt.
// Kind: invariant.
it.instance(
  "R3: rejected requests never run and leave no authorization behind",
  () =>
    property(
      [
        fc.array(command, { minLength: 1, maxLength: 4 }),
        fc.nat(),
        fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: undefined }),
      ],
      (request, pick, message) =>
        Effect.gen(function* () {
          const service = yield* Permission.Service
          const run = fresh()
          const input = (cmd: string, sessionID = run.sessionID) => ({
            sessionID,
            permission: run.permission,
            patterns: [cmd],
            metadata: {},
            always: patternsOf(cmd),
            ruleset: [],
          })
          const asked = yield* Effect.forEach(request, (cmd) => probe(input(cmd)))
          const bystander = yield* probe(input(request[0], SessionID.make(`${run.sessionID}_other`)))
          expect([...asked, bystander].every((item) => item.outcome === "pending")).toBe(true)

          const rejected = asked[pick % asked.length]
          yield* service.reply({ requestID: rejected.id, reply: "reject", message })

          const rejectedError = Cause.squash(
            ((yield* Fiber.await(rejected.fiber)) as Exit.Failure<void, unknown>).cause,
          )
          expect(rejectedError).toBeInstanceOf(message ? PermissionV1.CorrectedError : PermissionV1.RejectedError)
          for (const item of asked) {
            const exit = yield* Fiber.await(item.fiber)
            expect(Exit.isFailure(exit)).toBe(true)
          }
          expect(bystander.fiber.pollUnsafe()).toBeUndefined()

          // No authorization was created: every command must be asked again.
          for (const cmd of request) expect((yield* probe(input(cmd))).outcome).toBe("pending")
        }),
    ),
  60_000,
)

// R4: An "allow once" response authorizes only the current request. When the
// same command is requested again without a standing allow rule, a new
// permission prompt appears.
// Kind: round-trip (ask -> approve once -> the permission state for every
// command is the same as before the approval).
it.instance(
  "R4: allow once leaves the permission state unchanged",
  () =>
    property([rules, command], (ruleset, cmd) =>
      Effect.gen(function* () {
        const service = yield* Permission.Service
        const run = fresh()
        const rs = withPermission(run.permission, ruleset)
        const before = yield* snapshot(run.permission, rs)
        fc.pre(before[cmd] === "pending")

        const asked = yield* probe({
          sessionID: run.sessionID,
          permission: run.permission,
          patterns: [cmd],
          metadata: {},
          // The tool offers standing patterns, but "once" must ignore them.
          always: patternsOf(cmd),
          ruleset: rs,
        })
        yield* service.reply({ requestID: asked.id, reply: "once" })
        yield* Fiber.join(asked.fiber)

        expect(yield* snapshot(run.permission, rs)).toEqual(before)
      }),
    ),
  60_000,
)

// R5 (revised): "Always allow" creates a standing approval: later requests
// that match an approved pattern run without prompting, unless a configured
// deny rule matches them (deny always wins); requests that do not match are
// evaluated exactly as before.
// Kind: metamorphic (adding a standing approval for patterns A changes only
// the decisions of commands that match A, and only towards "allowed").
it.instance(
  "R5: always-allow approves exactly the matching future requests",
  () =>
    property(
      [rules, command.chain((cmd) => fc.tuple(fc.constant(cmd), fc.subarray(patternsOf(cmd), { minLength: 1 })))],
      (ruleset, [cmd, always]) =>
        Effect.gen(function* () {
          const service = yield* Permission.Service
          const run = fresh()
          const rs = withPermission(run.permission, ruleset)
          const before = yield* snapshot(run.permission, rs)
          fc.pre(before[cmd] === "pending")

          const asked = yield* probe({
            sessionID: run.sessionID,
            permission: run.permission,
            patterns: [cmd],
            metadata: {},
            always,
            ruleset: rs,
          })
          yield* service.reply({ requestID: asked.id, reply: "always" })
          yield* Fiber.join(asked.fiber)

          const after = yield* snapshot(run.permission, rs)
          for (const q of COMMANDS) {
            if (before[q] === "denied") expect({ q, outcome: after[q] }).toEqual({ q, outcome: "denied" })
            else if (always.some((a) => matches(q, a)))
              expect({ q, outcome: after[q] }).toEqual({ q, outcome: "allowed" })
            else expect({ q, outcome: after[q] }).toEqual({ q, outcome: before[q] })
          }
        }),
    ),
  60_000,
)

// R6 (revised): An approval to read one file does not authorize reading a
// different file or a broader wildcard. Without a matching standing rule,
// such a request needs a new permission decision before it runs. This holds
// for every path approved "once", and for "always" approvals of paths
// without glob metacharacters ("*", "?").
// Kind: metamorphic (changing only the request's target from the approved
// file to any other target flips the outcome from allowed to pending).
it.instance(
  "R6: approving one file never authorizes a different or broader target",
  () =>
    property(
      [
        filePath,
        fc.constantFrom("once" as const, "always" as const),
        fc.oneof(
          filePath,
          fc.constantFrom(".env", "~/.ssh/id_rsa", "*", "**"),
          filePath.map((p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) + "/*" : "*")),
        ),
        fc.boolean(),
      ],
      (file, reply, other, sibling) =>
        Effect.gen(function* () {
          // A sibling differs from the approved file only where its name has
          // "?" or "*", the hardest "different file" to tell apart.
          const target = sibling ? file.replace(/[?*]/g, "x") : other
          fc.pre(target !== file)
          // Revised R6: standing approvals are glob patterns, so a standing
          // approval for a path that itself contains "?" or "*" covers more
          // than one file. "Once" approvals still cover every path.
          fc.pre(reply === "once" || !/[?*]/.test(file))
          const service = yield* Permission.Service
          const run = fresh()
          const read = (path: string) => ({
            sessionID: run.sessionID,
            permission: `read_${run.permission}`,
            patterns: [path],
            metadata: {},
            always: [path],
            ruleset: [],
          })
          const asked = yield* probe(read(file))
          expect(asked.outcome).toBe("pending")
          yield* service.reply({ requestID: asked.id, reply })
          yield* Fiber.join(asked.fiber)

          // Same target: allowed again only if the approval was standing.
          const same = yield* probe(read(file))
          expect(same.outcome).toBe(reply === "always" ? "allowed" : "pending")
          yield* Fiber.interrupt(same.fiber)

          // Different or broader target: always a fresh decision.
          expect((yield* probe(read(target))).outcome).toBe("pending")
        }),
    ),
  60_000,
)
