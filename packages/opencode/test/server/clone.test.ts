import path from "path"
import { describe, expect, test } from "bun:test"
import { Deferred, Effect, Fiber } from "effect"
import { Global } from "@opencode-ai/core/global"
import { ProjectClone } from "../../src/server/routes/instance/httpapi/clone"

describe("ProjectClone.repoName", () => {
  test("derives the folder name from public https URLs", () => {
    expect(ProjectClone.repoName("https://github.com/octocat/Hello-World.git")).toBe("Hello-World")
    expect(ProjectClone.repoName("https://github.com/octocat/Hello-World")).toBe("Hello-World")
    expect(ProjectClone.repoName("https://gitlab.com/group/sub/my_repo.git/")).toBe("my_repo")
  })

  test("rejects non-https, credentialed, and unsafe URLs", () => {
    expect(ProjectClone.repoName("git@github.com:octocat/Hello-World.git")).toBeUndefined()
    expect(ProjectClone.repoName("http://github.com/octocat/Hello-World")).toBeUndefined()
    expect(ProjectClone.repoName("file:///etc/passwd")).toBeUndefined()
    expect(ProjectClone.repoName("https://user:token@github.com/octocat/Hello-World")).toBeUndefined()
    expect(ProjectClone.repoName("https://github.com/octocat/..")).toBeUndefined()
    expect(ProjectClone.repoName("https://github.com/")).toBeUndefined()
    expect(ProjectClone.repoName("not a url")).toBeUndefined()
  })
})

// The handler runs against a controlled ~/projects: `dirs` and `files` stand in for the server's filesystem,
// `origins` for each clone's `remote.origin.url`, and `cloneGate`, when set, holds `git clone` open.
function server(state: { dirs?: string[]; files?: string[]; origins?: Record<string, string> } = {}) {
  const dirs = new Set(state.dirs)
  const files = new Set(state.files)
  const origins = new Map(Object.entries(state.origins ?? {}))
  const clones: string[] = []
  const world = {
    clones,
    cloneGate: undefined as Deferred.Deferred<void> | undefined,
    cloneStarted: undefined as Deferred.Deferred<void> | undefined,
    cloneExitCode: 0,
  }
  const result = (exitCode: number, stdout = "") => ({
    exitCode,
    text: () => stdout,
    stdout: Buffer.from(stdout),
    stderr: Buffer.from(exitCode === 0 ? "" : "fatal: clone failed"),
    truncated: false,
  })
  const services = {
    fs: {
      existsSafe: (target: string) => Effect.succeed(dirs.has(target) || files.has(target)),
      isDir: (target: string) => Effect.succeed(dirs.has(target)),
      ensureDir: (target: string) => Effect.sync(() => void dirs.add(target)),
    },
    git: {
      run: (args: string[], opts: { cwd: string }) =>
        Effect.gen(function* () {
          if (args.includes("remote")) {
            const origin = origins.get(opts.cwd)
            return origin ? result(0, `${origin}\n`) : result(2)
          }
          const [url, directory] = args.slice(-2)
          clones.push(url)
          if (world.cloneStarted) yield* Deferred.succeed(world.cloneStarted, undefined)
          if (world.cloneGate) yield* Deferred.await(world.cloneGate)
          if (world.cloneExitCode !== 0) return result(world.cloneExitCode)
          dirs.add(directory)
          dirs.add(path.join(directory, ".git"))
          origins.set(directory, url)
          return result(0)
        }),
    },
  }
  return { services, world }
}

const projects = path.join(Global.Path.home, "projects")

function call(services: ReturnType<typeof server>["services"], url: string) {
  return ProjectClone.clone(services, url).pipe(
    Effect.map((response) => ({
      status: response.status,
      body: JSON.parse(
        response.body._tag === "Uint8Array" ? new TextDecoder().decode(response.body.body) : "{}",
      ) as Record<string, unknown>,
    })),
  )
}

describe("ProjectClone.clone", () => {
  test("clones into ~/projects/<name> and reuses that clone for the same repository", async () => {
    const { services, world } = server()
    const first = await Effect.runPromise(call(services, "https://github.com/team-a/demo.git"))
    const again = await Effect.runPromise(call(services, "https://github.com/team-a/demo/"))
    expect(first).toEqual({ status: 200, body: { directory: path.join(projects, "demo"), existing: false } })
    expect(again).toEqual({ status: 200, body: { directory: path.join(projects, "demo"), existing: true } })
    expect(world.clones).toEqual(["https://github.com/team-a/demo.git"])
  })

  test("rejects a different repository whose folder name is already taken", async () => {
    const directory = path.join(projects, "demo")
    const { services, world } = server({
      dirs: [directory, path.join(directory, ".git")],
      origins: { [directory]: "https://github.com/team-a/demo.git" },
    })
    const response = await Effect.runPromise(call(services, "https://github.com/team-b/demo.git"))
    expect(response.status).toBe(409)
    expect(String(response.body.error)).toContain("not a clone of https://github.com/team-b/demo.git")
    expect(response.body.directory).toBeUndefined()
    expect(world.clones).toEqual([])
  })

  test("rejects a destination that is a plain file or a folder without its own .git", async () => {
    const file = server({ files: [path.join(projects, "demo")] })
    const folder = server({ dirs: [path.join(projects, "demo")] })
    const fromFile = await Effect.runPromise(call(file.services, "https://github.com/team-a/demo.git"))
    const fromFolder = await Effect.runPromise(call(folder.services, "https://github.com/team-a/demo.git"))
    expect(fromFile.status).toBe(409)
    expect(fromFolder.status).toBe(409)
    expect(file.world.clones).toEqual([])
    expect(folder.world.clones).toEqual([])
  })

  test("rejects a concurrent request while a clone into the same folder is still running", async () => {
    const { services, world } = server()
    await Effect.runPromise(
      Effect.gen(function* () {
        world.cloneGate = yield* Deferred.make<void>()
        world.cloneStarted = yield* Deferred.make<void>()
        const first = yield* call(services, "https://github.com/team-a/demo.git").pipe(Effect.forkChild)
        yield* Deferred.await(world.cloneStarted)

        const sameRepo = yield* call(services, "https://github.com/team-a/demo.git")
        const otherRepo = yield* call(services, "https://github.com/team-b/demo.git")
        expect(sameRepo.status).toBe(409)
        expect(String(sameRepo.body.error)).toContain("already in progress")
        expect(otherRepo.status).toBe(409)
        expect(sameRepo.body.directory).toBeUndefined()

        world.cloneStarted = undefined
        yield* Deferred.succeed(world.cloneGate, undefined)
        expect((yield* Fiber.join(first)).body.existing).toBe(false)
        expect((yield* call(services, "https://github.com/team-a/demo.git")).body.existing).toBe(true)
        expect(world.clones).toEqual(["https://github.com/team-a/demo.git"])
      }),
    )
  })

  test("releases the folder after a failed clone so it can be retried", async () => {
    const { services, world } = server()
    world.cloneExitCode = 128
    const failed = await Effect.runPromise(call(services, "https://github.com/team-a/demo.git"))
    world.cloneExitCode = 0
    const retried = await Effect.runPromise(call(services, "https://github.com/team-a/demo.git"))
    expect(failed.status).toBe(422)
    expect(retried).toEqual({ status: 200, body: { directory: path.join(projects, "demo"), existing: false } })
  })
})
