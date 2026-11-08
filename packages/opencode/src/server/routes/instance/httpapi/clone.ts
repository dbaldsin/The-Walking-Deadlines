import path from "path"
import { Effect, Option, Schema } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
import { Git } from "@/git"

// Clones a public HTTPS git repository into ~/projects/<name> so the web UI can open it as a project.
// Raw route (outside the typed HttpApi) so it needs no SDK regeneration or exerciser scenario.
export const route = "/experimental/clone"

const Payload = Schema.Struct({ url: Schema.String })

type Services = {
  git: Pick<Git.Interface, "run">
  fs: Pick<FSUtil.Interface, "existsSafe" | "isDir" | "ensureDir">
}

// Destination folders with a clone or reuse check in flight. The deployment is shared, so two visitors can
// ask for the same folder at once; the second gets a conflict instead of a half-finished checkout.
const pending = new Set<string>()

export function handler(input: Services) {
  return Effect.gen(function* () {
    const body = yield* HttpServerRequest.schemaBodyJson(Payload).pipe(Effect.option)
    if (Option.isNone(body)) return error(400, 'Expected a JSON body like { "url": "https://..." }')
    return yield* clone(input, body.value.url.trim())
  }).pipe(Effect.catch((cause) => Effect.succeed(error(500, String(cause)))))
}

export function clone(input: Services, url: string) {
  return Effect.gen(function* () {
    const name = repoName(url)
    if (!name) return error(400, "Only public https:// git URLs are supported")

    const parent = path.join(Global.Path.home, "projects")
    const directory = path.join(parent, name)
    // Claim the folder before the first yield so the check and the claim cannot interleave with another request.
    if (pending.has(directory))
      return error(409, `A clone into ${directory} is already in progress. Try again shortly.`)
    pending.add(directory)

    return yield* Effect.gen(function* () {
      if (yield* input.fs.existsSafe(directory)) {
        if (yield* isCloneOf(input, directory, url)) return HttpServerResponse.jsonUnsafe({ directory, existing: true })
        // Never delete or overwrite the folder: it may be another visitor's clone or their work.
        return error(409, `${directory} already exists and is not a clone of ${url}`)
      }

      yield* input.fs.ensureDir(parent)
      // Disable credential prompts and helpers so private or missing repos fail fast instead of hanging.
      const result = yield* input.git.run(["-c", "credential.helper=", "clone", "--", url, directory], {
        cwd: parent,
        env: { GIT_TERMINAL_PROMPT: "0" },
      })
      const stderr = result.stderr.toString("utf8").trim()
      // With prompts disabled, git reports missing and private repos as an auth failure.
      if (stderr.includes("could not read Username")) return error(422, "Repository not found or not public")
      if (result.exitCode !== 0) return error(422, stderr || "git clone failed")
      return HttpServerResponse.jsonUnsafe({ directory, existing: false })
    }).pipe(Effect.ensuring(Effect.sync(() => pending.delete(directory))))
  })
}

export function repoName(url: string) {
  const parsed = URL.parse(url)
  if (!parsed || parsed.protocol !== "https:" || parsed.username || parsed.password) return
  const name = parsed.pathname
    .split("/")
    .filter(Boolean)
    .at(-1)
    ?.replace(/\.git$/, "")
  if (!name || name.startsWith(".") || !/^[\w.-]+$/.test(name)) return
  return name
}

function isCloneOf(input: Services, directory: string, url: string) {
  return Effect.gen(function* () {
    // Require the folder's own .git, so a plain folder inside some other repository is not mistaken for a clone.
    if (!(yield* input.fs.isDir(path.join(directory, ".git")))) return false
    const origin = yield* input.git.run(["remote", "get-url", "origin"], { cwd: directory })
    return origin.exitCode === 0 && sameRepository(origin.text().trim(), url)
  })
}

// Treats https://host/owner/repo, .../repo.git and .../repo/ as the same repository.
function sameRepository(a: string, b: string) {
  const key = (url: string) => {
    const parsed = URL.parse(url)
    if (!parsed) return
    return `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/+$/, "").replace(/\.git$/, "")}`
  }
  const left = key(a)
  return left !== undefined && left === key(b)
}

function error(status: number, message: string) {
  return HttpServerResponse.jsonUnsafe({ error: message }, { status })
}

export * as ProjectClone from "./clone"
