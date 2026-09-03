# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

this repo is a Lisp interpreter designed to be the deterministic "brain" of an AI agent in a neuro-symbolic architecture. 
The idea (see `README`): the LLM writes Lisp code into a REPL, and the REPL's state/output steers the LLM's context back. 
This is a **Turborepo** pnpm monorepo (`pnpm-workspace.yaml` + `turbo.json`, workspaces = `packages/*` + `apps/*`):

1. `packages/interpreter` (`@repo/interpreter`) — the standalone interpreter (`src/`) plus its tests (`test/`). Pure TypeScript, **no `pi` dependency**. Exposes its `.ts` sources directly via the `exports` map (no build step), e.g. `@repo/interpreter/lisp.ts`, `@repo/interpreter/grammar.ts`, `@repo/interpreter/source.ts`. **The MCP integration lives here** (`src/mcp*.ts`), so it carries the `@modelcontextprotocol/sdk` dependency.
2. `packages/repl` (`@repo/repl`) — REPL front-ends *on top of* the interpreter: `repl.ts` (`MemoryRepl`/`AgentRepl`, the embeddable string-in/string-out REPLs), `cli.ts` (the interactive stdin/stdout REPL, `pnpm repl` / `repl:attach`), and `session-server.ts` (a shared-session server over a unix socket so the editor's LSP and a terminal REPL share ONE interpreter). Depends on `@repo/interpreter`. Consumers import `@repo/repl/repl.ts` / `@repo/repl/session-server.ts`.
3. `apps/pi` (`@lisptc/extension`) — a `pi` coding-agent extension (`extension/lisp-repl.ts`) that wires the interpreter into a pi session. Runs it **in-process** via the `AgentRepl` binding (imported from `@repo/repl/repl.ts`) — no subprocess, no stdout scraping. Also uses `@repo/interpreter/source.ts` (system prompt) and `@repo/interpreter/grammar.ts` (structured output).
4. `apps/lsp` (`@lisptc/lsp`) — a stdio language server (`src/server.ts`) for the lisptc dialect. Diagnostics via the interpreter's `checkSyntax` (analysis only, never evaluates the buffer); completion/hover query the live shared session (`@repo/repl/session-server.ts`) when one is reachable, falling back to a local prelude-only interpreter.
5. `apps/mcp` (`@lisptc/mcp-repl`) — a stdio MCP server (`src/server.ts`) exposing the REPL to an MCP client via one persistent `MemoryRepl` (`@repo/repl/repl.ts`).

The repo root is itself the published `pi-package` (see the `pi` field in the root `package.json`) exposing `extensions` (pointing at `./apps/pi/extension/lisp-repl.ts`) and `skills` (`./apps/pi/skills`).

## Commands

Root scripts delegate to Turbo, which fans out across workspaces:

```bash
pnpm test                    # turbo run test (vitest run in each package)
pnpm typecheck               # turbo run typecheck (tsc --noEmit per package)
pnpm lint                    # biome ci (lint + format check) — matches CI, run at root
pnpm format                  # biome check --write (auto-fix)
pnpm knip                    # dead-code / unused-dependency check (part of CI), run at root
pnpm test:watch              # turbo run test:watch
pnpm repl                    # turbo run repl (run the interpreter REPL directly)

# Single test file / by name — run inside the interpreter package:
pnpm --filter @repo/interpreter exec vitest run test/macros.test.ts
pnpm --filter @repo/interpreter exec vitest run -t "name of test"
```

Runtime requires **Node >= 22.6.0**; `.ts` files are executed directly via `--experimental-transform-types` (no build step). CI (`.forgejo/workflows/ci.yml`) runs, in order: typecheck → lint → knip → test. `lint` and `knip` run once at the root; `typecheck` and `test` fan out through Turbo. Commits are linted by commitlint (conventional commits) via husky.

## Architecture

Paths below are relative to `packages/interpreter/` unless noted.

### Interpreter core (`src/lisp.ts`, ~1600 lines)
Derived from Nukata Lisp. Key exports used across the codebase: `Interp` (the interpreter/environment), `prelude` (Lisp source string of standard defs), `run(interp, code)` (eval a program, returns last value), `str(value)` (printed representation), `setWriter(fn)` (redirect `prin1`/`princ`/`terpri` output — returns previous writer). Core types: `Cell` (cons cell), `Sym`, `LispKeyword`, `EvalException`. 
Arithmetic lives separately in `src/arith.ts` (`Numeric` = number | bigint, with `add`/`subtract`/`compare`/`tryToParse`, etc.).

**The interpreter is fully synchronous by design.** This is the central constraint that shapes the jobs runtime and MCP integration.

**Prose around forms.** Only the parenthesised top-level forms are program text: `stripProse(text)` (same file) blanks everything else — keeping newlines so error line numbers still line up — and both `run` and `checkSyntax` push the stripped text into the `Reader`. So an LLM (or a `.ptc` file) can write freely around its code, a bare top-level atom is prose rather than an expression, and there is **no comment syntax** at all: `;` is an ordinary symbol character and prose is what a comment used to be. The `lisptc.gbnf` grammar mirrors this — prose may not contain a parenthesis, which is what stops the model emitting an unbalanced one (`:)`). That grammar only binds providers that support grammars, though, so `stripProse`/`run` take a **`ProseMode`**: `strict` (the default — an unclosed paren is a truncated program, an unknown head is an error; right for a `.ptc` script and for `checkSyntax`'s editor diagnostics) or `tolerant`, which reads parenthesised text that cannot be a program as prose. `MemoryRepl.eval` is tolerant, since what it evaluates was written by a model: an unclosed `(` is prose from that paren on (so a real form after it still runs, instead of being swallowed), and a top-level form whose head symbol is unbound — `(see below)`, `(one, two, three)` — is prose too. Both are reported as `skipped …` lines appended to the output, so a misspelled function is still distinguishable from a turn of phrase. `AgentRepl`'s finished signal keeps asking the STRICT question, so a reply truncated mid-form is not mistaken for a final prose answer.

### Extensions (`InterpOptions.extensions`)
`new Interp({ extensions: [...] })` runs each extension against the fresh interp to install optional built-ins — the interpreter core stays minimal and opt-in features layer on top. An extension may also **override** core built-ins (`interp.def` overwrites the global, docs included): `secretsExtension` does exactly that to make the string primitives taint-aware. Two extensions ship: `mcpExtension()` (`src/mcp.ts`) and `secretsExtension()` (`src/secrets.ts`). They stay independent of each other — no cross-imports. The REPL front-ends compose both.

### Secret registry (`src/secrets.ts`)
An opt-in extension installing the `secret` / `secrets` built-ins over a `SecretsStore` interface (`get`/`list`/`set`). The default `EnvSecretsStore` is an in-memory registry seeded from `REPL_*` env vars; swap the store to source secrets elsewhere. **The extension owns all secret loading** — env vars (via `EnvSecretsStore`) and, with `secretsExtension({ envFile })`, a `.env` file (`loadSecretsFromEnvFile`, resolving `$LISPTC_SECRETS_FILE` or the nearest `.env` searched **upward** from the launch dir — so `pnpm repl`, whose cwd is `packages/repl`, still finds the project-root `.env`). `secretsExtension({ store?, envFile? })` is the single entry point: a host passes a persistent `store` (held for the life of the process so injected/loaded secrets survive `reset()`) and, for the CLI, `envFile: true`; the host contains no secret-loading logic of its own. Only `REPL_`-prefixed keys become secrets (namespacing what the LLM can see). This module also owns the `Secret` **taint type**: a tainted string whose `toString()` renders redacted (`str` duck-types on it) and whose `toJSON()` reveals the value (`lispToJson` duck-types on it — that is the only reveal path, and the sole "contract" between the extensions). It overrides the string primitives via `interp.def` so taint propagates; without the extension no `Secret` value can exist and the core plain-string primitives are exactly right. See `devdocs/secrets.md`.

### Async jobs runtime (`src/jobs.ts` + `src/jobs-broker.ts` + `src/jobs-protocol.ts`)
The **async capability**, factored out of MCP so any feature can offload async work. It is deliberately domain-agnostic (knows nothing about MCP).
- `src/jobs.ts` (main thread) — the `JobsRuntime` **interface** (`call`/`start`/`awaitJob`/`awaitAll`/`awaitAny`/`jobStatus`/`cancelJob`/`onSettled`/`shutdown`) is the swappable transport; the bundled `WorkerJobsRuntime` offloads to a `worker_threads` worker over a `SharedArrayBuffer` + `Atomics.wait` bridge (a different backend, e.g. a Redis-backed worker queue, can implement the same interface without touching consumers). The `Job` handle (jobId + optional main-thread finalizer), and the `Jobs` manager which owns the runtime + the in-flight-job set, does `collect` (run a job's finalizer once, idempotent, reaping settled jobs), wires `onSettled` push events, and installs the generic job built-ins (`await`, `await-all`, `await-any`, `job-status`, `jobs`, `cancel`) via `installBuiltins`.
- `src/jobs-broker.ts` (worker thread) — `runWorker(dispatch)`: the generic scheduler. Owns the SAB reply writer (large replies "spill" to a temp file, STATE_SPILL, instead of the 1 MiB inline buffer) and the job meta-ops (`start`/`await`/`await-all`/`await-any`/`job-status`/`cancel`) over a native `Promise` + per-job `AbortController`; every non-meta op is forwarded to the domain `dispatch`. A concrete worker (e.g. `mcp-broker.ts`) supplies `dispatch` and calls `runWorker`.
- `src/jobs-protocol.ts` — the single source of truth for the reply-protocol constants (`STATE_PENDING/DONE/ERROR/SPILL`, byte sizes, timeouts) and wire types, imported by both sides (no more duplicated constants).
- **Job lifecycle:** a producer starts a background job via `runtime.start(op, payload)` and hands back a `Job` (tracked with `jobs.track`); results apply via a **finalizer** through two paths: (1) **push** — when a job settles the worker `postMessage`s a `job-settled` event that `Jobs` applies as soon as the main thread's event loop next turns, so effects appear **automatically between evals, without an explicit await**; (2) **`(await job)`** — blocks on the `Atomics.wait` bridge and applies the finalizer synchronously. The two are idempotent via `Job.finalized`. `(cancel job)` calls `AbortController.abort()`, wired into the op's `signal`, so it aborts the in-flight request. Timeouts: `DEFAULT_TIMEOUT_MS` (30s) per blocking call, `AWAIT_TIMEOUT_MS` (50s) for `(await …)`. Note the push is delivered by the event loop, so a purely synchronous embedder that never yields between evals must use `await`.

### MCP integration (`src/mcp.ts` + `src/mcp-broker.ts`)
MCP is a **consumer of the jobs runtime**: `registerMcp` builds a `Jobs` over a `JobsRuntime` (default: a `WorkerJobsRuntime` pointed at `mcp-broker.ts`), installs the generic job built-ins via that `Jobs`, and adds the MCP built-ins on top. `src/mcp-broker.ts` is now MCP-only: it defines the domain `dispatch` (`connect`, `call-tool`, `disconnect`, `login`, `logout`, `authorize`, `list-tools`, `search`) and hands it to `runWorker` from `jobs-broker.ts` — no job scheduler or SAB code of its own.

- `src/mcp.ts` installs the Lisp built-ins: `load-mcp`, `unload-mcp`, `list-mcps`, `list-toolkit`, `list-tools`, `search-tools`, `search-mcps`, `mcp-shutdown` (the async-job built-ins `await`/`await-all`/`await-any`/`job-status`/`jobs`/`cancel` come from the jobs layer). Tool docs don't get their own command — `load-mcp` registers each `<server>/<tool>` binding's signature/description/args via `Interp.defineGlobal`'s `doc` param, so the generic `doc` built-in (`src/lisp.ts`) renders MCP tool docs the same way it renders any other binding's.
- **Async by default:** `load-mcp` returns a `Job` immediately (the connect runs as a background job) and does *not* block; `(await job)` installs the server's `<server>/<tool>` bindings and returns the tool list. A connect that exposes **zero tools** is treated as a load failure (`:error`), not a misleading `:loaded`. **Tool calls themselves stay synchronous** (`runtime.call("call-tool", …)`) — the job infra is generic so they could opt in later.
- Loaded MCP tools become ordinary global bindings named `<server>/<tool>` called with keyword syntax, e.g. `(linear/list-issues :query "auth bug")`.
- Predefined servers come exclusively from the bundled `mcp.toolkit.json` (stdio `command`/`args` servers and HTTP `url`/`headers` servers) — a curated, ready-to-use set loaded at `registerMcp` time. Each is callable by bare name, e.g. `(await (load-mcp "playwright"))`. There is no env-var config; edit `mcp.toolkit.json` to add servers.

### pi extension (`apps/pi/extension/lisp-repl.ts`)
Runs the interpreter **in-process** via the `AgentRepl` binding (`@repo/repl/repl.ts`) and mediates between it and a pi session:
- Replaces the agent's system prompt (`apps/pi/extension/system-prompt.ts`) with a lisp-only policy plus the full interpreter source (so the LLM knows the exact language it's programming).
- The agent has **no tools**: assistant text is sent verbatim to the REPL, evaluated, and the result injected back as a custom message. A `!`-prefixed user line (via `LispEditor`) is sent straight to the REPL.
- Constrains every model reply to valid lisptc source via Fireworks grammar-based structured output (`before_provider_request` + `LISP_GRAMMAR`).

## Testing

Tests live in `test/`, grouped by language feature (`reader`, `numbers`, `lists`, `macros`, `recursion`, `control-flow`, `errors`, `printing`, `mcp`). Use the helpers in `test/helpers.ts`:
- `freshInterp()` — new `Interp` with `prelude` loaded.
- `ev(code, interp?)` — eval program, return `str` of last value.
- `evWithOutput(code)` — eval while capturing printed output; returns `{ value, output }`.

MCP tests exercise the real `worker_threads` broker (no SDK mock), driving stdio fixtures spawned as `node` subprocesses: `test/fixture-mcp-server.ts` (a one-tool `echo` server, with an optional `LISPTC_FIXTURE_DELAY_MS` startup delay so async-job tests can observe `:pending`) and `test/fixture-empty-mcp-server.ts` (handshakes but exposes zero tools, to test that a tool-less connect is a load failure).
