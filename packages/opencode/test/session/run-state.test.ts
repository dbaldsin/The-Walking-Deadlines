import { expect } from "bun:test"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Context, Deferred, Effect, Exit, Fiber, Layer } from "effect"
import { SessionRunState } from "@/session/run-state"
import { SessionStatus } from "@/session/status"
import { MessageID, SessionID } from "@/session/schema"
import { InstanceStore } from "@/project/instance-store"
import { InstanceBootstrap } from "@/project/bootstrap"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { testEffect } from "../lib/effect"

class IdleBoundary extends Context.Service<
  IdleBoundary,
  {
    pause: boolean
    reached: Deferred.Deferred<void>
    release: Deferred.Deferred<void>
  }
>()("test/IdleBoundary") {}

const boundary = Layer.effect(
  IdleBoundary,
  Effect.gen(function* () {
    return { pause: false, reached: yield* Deferred.make<void>(), release: yield* Deferred.make<void>() }
  }),
)
const boundaryNode = LayerNode.make({ service: IdleBoundary, layer: boundary, deps: [] })
const status = Layer.effect(
  SessionStatus.Service,
  Effect.gen(function* () {
    const gate = yield* IdleBoundary
    return SessionStatus.Service.of({
      get: () => Effect.succeed({ type: "idle" }),
      list: () => Effect.succeed(new Map()),
      set: (_, info) =>
        Effect.gen(function* () {
          if (info.type !== "idle" || !gate.pause) return
          gate.pause = false
          yield* Deferred.succeed(gate.reached, undefined)
          yield* Deferred.await(gate.release)
        }),
    })
  }),
).pipe(Layer.provide(boundary))

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([SessionRunState.node, InstanceStore.node, boundaryNode]), [
    [SessionStatus.node, status],
    [
      InstanceBootstrap.node,
      Layer.succeed(InstanceBootstrap.Service, InstanceBootstrap.Service.of({ run: Effect.void })),
    ],
  ]),
)

function messages(sessionID: SessionID) {
  const user: SessionV1.User = {
    id: MessageID.ascending(),
    sessionID,
    role: "user",
    agent: "build",
    time: { created: 1 },
    model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("model") },
  }
  const next = { ...user, id: MessageID.ascending(), time: { created: 2 } }
  const assistant: SessionV1.Assistant = {
    id: MessageID.ascending(),
    sessionID,
    parentID: user.id,
    role: "assistant",
    agent: "build",
    mode: "build",
    modelID: user.model.modelID,
    providerID: user.model.providerID,
    cost: 0,
    finish: "stop",
    time: { created: 3, completed: 3 },
    path: { cwd: "/tmp", root: "/tmp" },
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  }
  const message: SessionV1.WithParts = { info: assistant, parts: [] }
  const second: SessionV1.WithParts = {
    info: { ...assistant, id: MessageID.ascending(), parentID: next.id, time: { created: 4, completed: 4 } },
    parts: [],
  }
  return { user, next, message, second }
}

it.instance("admission serializes a session's readers and writers without blocking another session", () =>
  Effect.gen(function* () {
    const state = yield* SessionRunState.Service
    const id = SessionID.make("session-admission")
    const ready = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const order: string[] = []
    const writer = yield* state
      .withAdmission(
        id,
        Effect.gen(function* () {
          order.push("writing")
          yield* Deferred.succeed(ready, undefined)
          yield* Deferred.await(release)
          order.push("complete")
        }),
      )
      .pipe(Effect.forkChild({ startImmediately: true }))
    yield* Deferred.await(ready)
    const reader = yield* state
      .withAdmission(
        id,
        Effect.sync(() => order.push("read")),
      )
      .pipe(Effect.forkChild({ startImmediately: true }))
    yield* state.withAdmission(
      SessionID.make("session-other"),
      Effect.sync(() => order.push("independent")),
    )
    expect(order).toEqual(["writing", "independent"])
    yield* Deferred.succeed(release, undefined)
    yield* Effect.all([Fiber.join(writer), Fiber.join(reader)], { concurrency: "unbounded" })
    expect(order).toEqual(["writing", "independent", "complete", "read"])
  }),
)

for (const reason of ["stopped", "cancelled"] as const) {
  it.instance(`does not restart ${reason} work despite pending input`, () =>
    Effect.gen(function* () {
      const state = yield* SessionRunState.Service
      const id = SessionID.make("session-run-state")
      const { message } = messages(id)
      let calls = 0
      let checks = 0
      const result = yield* state.ensureRunning(
        id,
        Effect.succeed(message),
        Effect.sync(() => {
          calls++
          return { message, reason }
        }),
        () =>
          Effect.sync(() => {
            checks++
            return true
          }),
      )
      expect(result).toBe(message)
      expect(calls).toBe(1)
      expect(checks).toBe(0)
    }),
  )
}

it.instance("does not restart failed work despite pending input", () =>
  Effect.gen(function* () {
    const state = yield* SessionRunState.Service
    const id = SessionID.make("session-run-state")
    const { message } = messages(id)
    let calls = 0
    let checks = 0
    const exit = yield* state
      .ensureRunning(
        id,
        Effect.succeed(message),
        Effect.sync(() => {
          calls++
          throw new Error("provider failed")
        }),
        () =>
          Effect.sync(() => {
            checks++
            return true
          }),
      )
      .pipe(Effect.exit)
    expect(Exit.isFailure(exit)).toBe(true)
    expect(calls).toBe(1)
    expect(checks).toBe(0)
  }),
)

it.instance("Stop in the idle settlement gap prevents stale continuation and permits a fresh prompt", () =>
  Effect.gen(function* () {
    const state = yield* SessionRunState.Service
    const gate = yield* IdleBoundary
    const id = SessionID.make("session-run-state")
    const { user, next, message, second } = messages(id)
    let calls = 0
    let checks = 0
    gate.pause = true
    const run = yield* state
      .ensureRunning(
        id,
        Effect.succeed(message),
        Effect.sync(() => {
          calls++
          return { message, reason: "normal" as const, handledUser: user }
        }),
        () =>
          Effect.sync(() => {
            checks++
            return true
          }),
      )
      .pipe(Effect.forkChild)
    yield* Deferred.await(gate.reached)
    // The old Runner has removed itself from the session map but has not delivered its result.
    yield* state.cancel(id)
    yield* Deferred.succeed(gate.release, undefined)
    expect(yield* Fiber.join(run)).toBe(message)
    expect(calls).toBe(1)
    expect(checks).toBe(0)
    const fresh = yield* state.ensureRunning(
      id,
      Effect.succeed(message),
      Effect.succeed({
        message: second,
        reason: "normal" as const,
        handledUser: next,
      }),
      () => Effect.succeed(false),
    )
    expect(fresh).toBe(second)
  }),
)

it.instance("Stop between pending-input check and reentry prevents a successor", () =>
  Effect.gen(function* () {
    const state = yield* SessionRunState.Service
    const id = SessionID.make("session-run-state")
    const { user, message } = messages(id)
    const reached = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    let calls = 0
    const run = yield* state
      .ensureRunning(
        id,
        Effect.succeed(message),
        Effect.sync(() => {
          calls++
          return { message, reason: "normal" as const, handledUser: user }
        }),
        () =>
          Effect.gen(function* () {
            yield* Deferred.succeed(reached, undefined)
            yield* Deferred.await(release)
            return true
          }),
      )
      .pipe(Effect.forkChild)
    yield* Deferred.await(reached)
    yield* state.cancel(id)
    yield* Deferred.succeed(release, undefined)
    expect(yield* Fiber.join(run)).toBe(message)
    expect(calls).toBe(1)
  }),
)

it.instance("active cancellation cannot reuse an older successful fallback to restart", () =>
  Effect.gen(function* () {
    const state = yield* SessionRunState.Service
    const id = SessionID.make("session-run-state")
    const { user, message } = messages(id)
    const reached = yield* Deferred.make<void>()
    let calls = 0
    let checks = 0
    const run = yield* state
      .ensureRunning(
        id,
        Effect.succeed(message),
        Effect.gen(function* () {
          calls++
          yield* Deferred.succeed(reached, undefined)
          yield* Effect.never
          return { message, reason: "normal" as const, handledUser: user }
        }),
        () =>
          Effect.sync(() => {
            checks++
            return true
          }),
      )
      .pipe(Effect.forkChild)
    yield* Deferred.await(reached)
    yield* state.cancel(id)
    expect(yield* Fiber.join(run)).toBe(message)
    expect(calls).toBe(1)
    expect(checks).toBe(0)
  }),
)

it.instance("a delayed waiter observes a stopped successor instead of starting another run", () =>
  Effect.gen(function* () {
    const state = yield* SessionRunState.Service
    const id = SessionID.make("session-run-state")
    const { user, message, second } = messages(id)
    const completed = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const delayed = yield* Deferred.make<void>()
    const resume = yield* Deferred.make<void>()
    let calls = 0
    let checks = 0
    const work = Effect.gen(function* () {
      calls++
      if (calls > 1) return { message: second, reason: "stopped" as const }
      yield* Deferred.succeed(completed, undefined)
      yield* Deferred.await(release)
      return { message, reason: "normal" as const, handledUser: user }
    })
    const pending = () =>
      Effect.gen(function* () {
        if (++checks === 1) {
          yield* Deferred.succeed(delayed, undefined)
          yield* Deferred.await(resume)
        }
        return true
      })
    const first = yield* state.ensureRunning(id, Effect.succeed(message), work, pending).pipe(Effect.forkChild)
    yield* Deferred.await(completed)
    const other = yield* state.ensureRunning(id, Effect.succeed(message), work, pending).pipe(Effect.forkChild)
    yield* Effect.yieldNow
    yield* Deferred.succeed(release, undefined)
    yield* Deferred.await(delayed)
    yield* Effect.gen(function* () {
      while (calls < 2) yield* Effect.yieldNow
    }).pipe(Effect.timeout("2 seconds"))
    yield* Deferred.succeed(resume, undefined)
    const results = yield* Effect.all([Fiber.join(first), Fiber.join(other)], { concurrency: "unbounded" })
    expect(results).toEqual([second, second])
    expect(calls).toBe(2)
  }),
)
