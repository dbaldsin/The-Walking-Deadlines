import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { InstanceState } from "@/effect/instance-state"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Runner } from "@/effect/runner"
import { BackgroundJob } from "@/background/job"
import { Effect, Exit, Latch, Layer, Scope, Context, Semaphore } from "effect"
import { Session } from "./session"
import { SessionID } from "./schema"
import { SessionStatus } from "./status"

export type RunResult =
  | { readonly message: SessionV1.WithParts; readonly reason: "normal"; readonly handledUser: SessionV1.User }
  | { readonly message: SessionV1.WithParts; readonly reason: "stopped" | "cancelled" }

export interface Interface {
  readonly withAdmission: <A, E, R>(sessionID: SessionID, work: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
  readonly withPrompt: <A, E, R>(
    sessionID: SessionID,
    work: (epoch: number) => Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>
  readonly isCancelled: (sessionID: SessionID, epoch: number) => Effect.Effect<boolean>
  readonly assertNotBusy: (sessionID: SessionID) => Effect.Effect<void, Session.BusyError>
  readonly cancel: (sessionID: SessionID) => Effect.Effect<void>
  readonly ensureRunning: (
    sessionID: SessionID,
    onInterrupt: Effect.Effect<SessionV1.WithParts>,
    work: Effect.Effect<RunResult>,
    hasPendingInput: (handledUser: SessionV1.User) => Effect.Effect<boolean>,
    expectedEpoch?: number,
  ) => Effect.Effect<SessionV1.WithParts>
  readonly startShell: (
    sessionID: SessionID,
    onInterrupt: Effect.Effect<SessionV1.WithParts>,
    work: Effect.Effect<SessionV1.WithParts>,
    ready?: Latch.Latch,
  ) => Effect.Effect<SessionV1.WithParts, Session.BusyError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionRunState") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const background = yield* BackgroundJob.Service
    const status = yield* SessionStatus.Service

    const state = yield* InstanceState.make(
      Effect.fn("SessionRunState.state")(function* () {
        const scope = yield* Scope.Scope
        const runners = new Map<SessionID, Runner.Runner<RunResult>>()
        const completions = new Map<SessionID, { epoch: number; callers: number; exit?: Exit.Exit<RunResult> }>()
        const admissions = new Map<SessionID, { permit: Semaphore.Semaphore; callers: number }>()
        yield* Effect.addFinalizer(
          Effect.fnUntraced(function* () {
            yield* Effect.forEach(runners.values(), (runner) => runner.cancel, {
              concurrency: "unbounded",
              discard: true,
            })
            runners.clear()
            completions.clear()
            admissions.clear()
          }),
        )
        return { runners, completions, admissions, scope }
      }),
    )

    const withAdmission: Interface["withAdmission"] = Effect.fn("SessionRunState.withAdmission")(function* <A, E, R>(
      sessionID: SessionID,
      work: Effect.Effect<A, E, R>,
    ) {
      const data = yield* InstanceState.get(state)
      const admission = data.admissions.get(sessionID) ?? { permit: Semaphore.makeUnsafe(1), callers: 0 }
      admission.callers++
      data.admissions.set(sessionID, admission)
      return yield* admission.permit.withPermit(work).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            admission.callers--
            if (!admission.callers) data.admissions.delete(sessionID)
          }),
        ),
      )
    })

    const runner = Effect.fn("SessionRunState.runner")(function* (
      sessionID: SessionID,
      onInterrupt: Effect.Effect<SessionV1.WithParts>,
    ) {
      const data = yield* InstanceState.get(state)
      const existing = data.runners.get(sessionID)
      if (existing) return existing
      const next: Runner.Runner<RunResult> = Runner.make<RunResult>(data.scope, {
        onIdle: Effect.gen(function* () {
          if (data.runners.get(sessionID) !== next) return
          data.runners.delete(sessionID)
          yield* status.set(sessionID, { type: "idle" })
        }),
        onBusy: status.set(sessionID, { type: "busy" }),
        onInterrupt: onInterrupt.pipe(Effect.map((message) => ({ message, reason: "cancelled" as const }))),
      })
      data.runners.set(sessionID, next)
      return next
    })

    const assertNotBusy = Effect.fn("SessionRunState.assertNotBusy")(function* (sessionID: SessionID) {
      const data = yield* InstanceState.get(state)
      const existing = data.runners.get(sessionID)
      if (existing?.busy) yield* busyError(sessionID)
    })

    // A completion is shared only by live callers. Keep it through the idle settlement gap,
    // then release its assistant payload once the final waiter/prompt admission has settled.
    const withCompletion = Effect.fn("SessionRunState.withCompletion")(function* <A, E, R>(
      sessionID: SessionID,
      work: (completion: { epoch: number; callers: number; exit?: Exit.Exit<RunResult> }) => Effect.Effect<A, E, R>,
    ) {
      const data = yield* InstanceState.get(state)
      const completion = data.completions.get(sessionID) ?? { epoch: 0, callers: 0 }
      completion.callers++
      data.completions.set(sessionID, completion)
      return yield* work(completion).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            completion.callers--
            if (!completion.callers) data.completions.delete(sessionID)
          }),
        ),
      )
    })

    const withPrompt: Interface["withPrompt"] = (sessionID, work) =>
      withCompletion(sessionID, (completion) => work(completion.epoch))

    const isCancelled = Effect.fn("SessionRunState.isCancelled")(function* (sessionID: SessionID, epoch: number) {
      const data = yield* InstanceState.get(state)
      return data.completions.get(sessionID)?.epoch !== epoch
    })

    const cancel = Effect.fn("SessionRunState.cancel")(function* (sessionID: SessionID) {
      const data = yield* InstanceState.get(state)
      // Stop also invalidates prompts still persisting their user row while idle.
      // Admission finishes atomically, but execution waits for an explicit fresh prompt.
      const completion = data.completions.get(sessionID)
      if (completion) {
        completion.epoch++
        completion.exit = undefined
      }
      yield* cancelBackgroundJobs(background, sessionID)
      const existing = data.runners.get(sessionID)
      if (!existing) {
        yield* status.set(sessionID, { type: "idle" })
        return
      }
      yield* existing.cancel
    })

    const ensureRunning = Effect.fn("SessionRunState.ensureRunning")(function* (
      sessionID: SessionID,
      onInterrupt: Effect.Effect<SessionV1.WithParts>,
      work: Effect.Effect<RunResult>,
      hasPendingInput: (handledUser: SessionV1.User) => Effect.Effect<boolean>,
      expectedEpoch?: number,
    ) {
      const data = yield* InstanceState.get(state)
      return yield* withCompletion(sessionID, (completion) =>
        Effect.gen(function* () {
          const epoch = expectedEpoch ?? completion.epoch
          if (completion.epoch !== epoch) return yield* onInterrupt
          const guarded = (expected: Exit.Exit<RunResult> | undefined) =>
            Effect.gen(function* () {
              if (completion.epoch !== epoch) {
                return { message: yield* onInterrupt, reason: "cancelled" as const }
              }
              if (completion.exit !== expected && completion.exit) return yield* completion.exit
              return yield* work
            }).pipe(
              Effect.onExit((exit) =>
                Effect.sync(() => {
                  if (completion.epoch === epoch) completion.exit = exit
                }),
              ),
            )
          const initial = yield* runner(sessionID, onInterrupt)
          let result = yield* initial.ensureRunning(guarded(completion.exit))
          while (true) {
            if (completion.epoch !== epoch) return result.message
            if (result.reason === "cancelled") return result.message
            // Another waiter may already have finished the successor while this caller resumed.
            const observed = completion.exit
            const latest = observed ? yield* observed : result
            if (latest.reason !== "normal" || !(yield* hasPendingInput(latest.handledUser))) return latest.message
            if (completion.epoch !== epoch) return yield* onInterrupt
            if (completion.exit !== observed) continue
            const next = yield* runner(sessionID, onInterrupt)
            result = yield* next.ensureRunning(guarded(observed))
          }
        }),
      )
    })

    const startShell = Effect.fn("SessionRunState.startShell")(function* (
      sessionID: SessionID,
      onInterrupt: Effect.Effect<SessionV1.WithParts>,
      work: Effect.Effect<SessionV1.WithParts>,
      ready?: Latch.Latch,
    ) {
      const next = yield* runner(sessionID, onInterrupt)
      return yield* next
        .startShell(work.pipe(Effect.map((message) => ({ message, reason: "stopped" as const }))), ready)
        .pipe(
          Effect.map((result) => result.message),
          Effect.catchTag("RunnerBusy", () => Effect.fail(busyError(sessionID))),
        )
    })

    return Service.of({ withAdmission, withPrompt, isCancelled, assertNotBusy, cancel, ensureRunning, startShell })
  }),
)

const cancelBackgroundJobs = Effect.fn("SessionRunState.cancelBackgroundJobs")(function* (
  background: BackgroundJob.Interface,
  sessionID: SessionID,
) {
  const jobs = yield* background.list()
  const pending = new Set<string>([sessionID])
  const cancelled = new Set<string>()
  const matches = (job: BackgroundJob.Info) => {
    if (job.status !== "running") return false
    if (cancelled.has(job.id)) return false
    if (pending.has(job.id)) return true
    if (typeof job.metadata?.sessionId === "string" && pending.has(job.metadata.sessionId)) return true
    return typeof job.metadata?.parentSessionId === "string" && pending.has(job.metadata.parentSessionId)
  }
  let batch = jobs.filter(matches)
  while (batch.length > 0) {
    yield* Effect.forEach(
      batch,
      (job) =>
        background.cancel(job.id).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              cancelled.add(job.id)
              pending.add(job.id)
              if (typeof job.metadata?.sessionId === "string") pending.add(job.metadata.sessionId)
            }),
          ),
        ),
      { concurrency: "unbounded", discard: true },
    )
    batch = jobs.filter(matches)
  }
})

function busyError(sessionID: SessionID) {
  return new Session.BusyError({ sessionID })
}

export const node = LayerNode.make({ service: Service, layer: layer, deps: [BackgroundJob.node, SessionStatus.node] })

export * as SessionRunState from "./run-state"
