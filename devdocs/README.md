# Developer docs

Design notes and setup guides for lisptc internals.

**The code carries no comments.** A reason — a hidden constraint, a subtle
invariant, a trap that cost a bug — belongs here, where it can be read whole and
kept in one place, rather than scattered across the lines it happens to touch.
When you fix something non-obvious, add it to the page for that area.

## Contents

### The interpreter

- [The interpreter core](./interpreter.md) — reader invariants (no comment
  syntax, `#<…>`, prose stripping), the hooks/channels extension vocabulary,
  the evaluator's traps, and the prose classifier.
- [Async jobs and MCP](./jobs.md) — why async work runs on a worker thread, the
  `SharedArrayBuffer` bridge, job lifecycle and cancellation, and what MCP adds
  on top.
- [Context compaction](./compaction.md) — naming every REPL result, the word cap
  on what gets printed, and the `echo`/`head`/`tail`/`grep` built-ins that read
  the rest.
- [Secret registry](./secrets.md) — the `REPL_*` secret store, taint-tracked
  redaction, and how secrets reach MCP calls.
- [OAuth 2.1 for remote MCP servers](./oauth.md) — how `load-mcp` authenticates
  OAuth servers (Linear): flow, callback strategies, token storage, cloud/ingress
  config.

### The drivers

- [The REPL front-ends](./repl.md) — `MemoryRepl`/`AgentRepl` (the finished
  signal, withheld prose feedback, what survives a `reset()`), the interactive
  CLI, and the shared session server's protocol and socket hygiene.
- [The agent loop](./agent-loop.md) — the model-output-to-eval loop, per-call
  accounting, per-thread REPL persistence, provider grammar spellings, KV
  warming, and what the system prompt has to say.
- [The lisptc LSP's static analysis](./lsp.md) — module layout, the shared
  tokenizer grammar vs. the interpreter's `Reader`, and how `load-mcp`'s args
  reach the LSP from the interpreter.

### The app

- [The web app](./web-app.md) — SSR boundaries, the first-party PostHog proxy,
  chat client traps, and the agent's face (avatar, favicon, poke lines).
- [Agent traces and feedback](./telemetry.md) — the PostHog event shape for a
  chat turn, the `▲`/`▼` vote on an assistant turn, the first-party proxy the
  browser half talks to, identity, and the privacy switch.

`packages/bloub` is a package apart, with its own
[CLAUDE.md](../packages/bloub/CLAUDE.md) and
[docs/](../packages/bloub/docs/): the engine, what was measured off the reference
video, and what a host may drive.
