# Restricted learning companion backend

Part 2 of the review stack. Depends on the independently reviewed session race fix. The reserved `learning-companion` agent cannot be overridden by config, executes only trusted built-in read/glob/grep tools, and accepts only text prompts. It cannot execute commands, change agents, or edit files. Lookups are checked against the canonical project boundary after hooks. Missing files resolve existing ancestors before delegating to Read's ordinary missing-file suggestions; escaping symlinks remain denied. Companion children do not produce ordinary coding recaps.

Persisted HTTP output formats are hydrated tolerantly: valid formats keep schema prototypes, unsupported formats are omitted (nullable on the wire) without breaking the session's messages.

Verification from `packages/opencode`:

```sh
bun test test/session/learning-companion-tools.test.ts
bun test test/session/prompt.test.ts -t "learning companion"
bun test test/server/httpapi-session.test.ts -t "output formats|unexpected stored"
bun typecheck
```

Tool tests execute real built-ins, deny canonical/symlink escapes and sensitive reads, reject pre/post-hook agent switches and attachments, preserve useful missing-file errors, and check prompts/commands before admission. A scripted-provider concurrency test holds source coding open while its child answers and cancels independently. HTTP regressions verify both valid format round trips and an unexpected stored format. The tests use temporary projects and do not call an external model. User-facing chat, notebook, preferences and screenshots belong to the following TUI PR.
