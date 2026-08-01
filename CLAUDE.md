# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

this repo is a Lisp interpreter designed to be the deterministic "brain" of an AI agent in a neuro-symbolic architecture. 
The idea (see `README`): the LLM writes Lisp code into a REPL, and the REPL's state/output steers the LLM's context back. 
This is a **Turborepo** pnpm monorepo (`pnpm-workspace.yaml` + `turbo.json`, workspaces = `packages/*` + `apps/*`) shipping three workspaces:

1. `packages/interpreter` (`@repo/interpreter`) — the standalone interpreter (`src/`) plus its tests (`test/`). Pure TypeScript, **no `pi` dependency**. Exposes its `.ts` sources directly via the `exports` map (no build step), e.g. `@repo/interpreter/repl.ts`, `@repo/interpreter/grammar.ts`.
2. `apps/pi` (`@lisptc/extension`) — a `pi` coding-agent extension (`extension/lisp-repl.ts`) that wires the interpreter into a pi session. Depends on `@repo/interpreter` (`workspace:*`) and runs it **in-process** via the `AgentRepl` binding (imported from `@repo/interpreter/repl.ts`) — no subprocess, no stdout scraping.
3. `apps/lsp` (`@lisptc/lsp`) — a stdio language server (`src/server.ts`) for the lisptc dialect (completion/diagnostics via the interpreter's `checkSyntax`); analysis only, it never evaluates the buffer.

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

**The interpreter is fully synchronous by design.** This is the central constraint that shapes the MCP integration.

### MCP integration (`src/mcp.ts` + `src/mcp-broker.ts`)
Because the interpreter is synchronous but MCP is async, async work is offloaded to a `worker_threads` **broker** (`mcp-broker.ts`). 
The synchronous main thread posts a request and blocks on a `SharedArrayBuffer` via `Atomics.wait`; the worker performs the SDK call and writes the reply back into shared memory, then `Atomics.notify` wakes the main thread. Large replies "spill" to a temp file (STATE_SPILL) instead of the 1 MiB inline buffer.

- The reply protocol constants (`STATE_PENDING/DONE/ERROR/SPILL`, byte sizes) are duplicated in **both** files and **must stay in sync**.
- `src/mcp.ts` installs the Lisp built-ins: `load-mcp`, `unload-mcp`, `list-mcps`, `list-toolkit`, `list-tools`, `mcp-doc`, `search-tools`, `search-mcps`, `mcp-shutdown`, plus the async-job built-ins `await`, `await-all`, `await-any`, `job-status`, `jobs`, `cancel`.
- **Async jobs:** lifecycle ops are async-by-default — `load-mcp` returns a `Job` handle immediately (the connect runs as a background job in the broker) and does *not* block. Results are applied by a **finalizer** on the main thread (e.g. installing the server's `<server>/<tool>` bindings) via two paths: (1) **push** — when a job settles the broker `postMessage`s a `job-settled` event that a persistent `worker.on("message")` listener applies as soon as the main thread's event loop next turns, so a loaded server's tools appear **automatically between evals, without an explicit await**; (2) **`(await job)`** — blocks on the `Atomics.wait` bridge and applies the finalizer synchronously, returning the tool list (use when you need the result *now*, in one program). The two are idempotent via `Job.finalized`. `job-status`/`jobs` poll without blocking; `await-all`/`await-any` collect multiple jobs via the platform combinators (`Promise.allSettled` / `Promise.race`) in the broker. Note the push is delivered by the event loop, so a purely synchronous embedder that never yields between evals must use `await`. The broker holds each job as a native `Promise` plus a per-job `AbortController` (the standard cancellation primitive), and exposes `start`/`await`/`job-status`/`cancel`/`await-all`/`await-any` ops that reuse the same SAB reply protocol (no new constants). `(cancel job)` calls `AbortController.abort()`, wired into the SDK's `RequestOptions.signal`, so it aborts the in-flight request rather than just forgetting it. A connect that exposes **zero tools** is treated as a load failure (`:error`), not a misleading `:loaded`. `load-mcp`/`unload-mcp` timeouts: a per-request `DEFAULT_TIMEOUT_MS` (30s) and an `AWAIT_TIMEOUT_MS` (50s) for `(await …)`. **Tool calls themselves stay synchronous** — the job infra is generic so they could opt in later.
- Loaded MCP tools become ordinary global bindings named `<server>/<tool>` called with keyword syntax, e.g. `(linear/list-issues :query "auth bug")`.
- Predefined servers come exclusively from the bundled `mcp.toolkit.json` (stdio `command`/`args` servers and HTTP `url`/`headers` servers) — a curated, ready-to-use set loaded at `registerMcp` time. Each is callable by bare name, e.g. `(await (load-mcp "playwright"))`. There is no env-var config; edit `mcp.toolkit.json` to add servers.

### pi extension (`apps/pi/extension/lisp-repl.ts`)
Runs the interpreter **in-process** via the `AgentRepl` binding (`@repo/interpreter/repl.ts`) and mediates between it and a pi session:
- Replaces the agent's system prompt (`apps/pi/extension/system-prompt.ts`) with a lisp-only policy plus the full interpreter source (so the LLM knows the exact language it's programming).
- The agent has **no tools**: assistant text is sent verbatim to the REPL, evaluated, and the result injected back as a custom message. A `!`-prefixed user line (via `LispEditor`) is sent straight to the REPL.
- Constrains every model reply to valid lisptc source via Fireworks grammar-based structured output (`before_provider_request` + `LISP_GRAMMAR`).

## Testing

Tests live in `test/`, grouped by language feature (`reader`, `numbers`, `lists`, `macros`, `recursion`, `control-flow`, `errors`, `printing`, `mcp`). Use the helpers in `test/helpers.ts`:
- `freshInterp()` — new `Interp` with `prelude` loaded.
- `ev(code, interp?)` — eval program, return `str` of last value.
- `evWithOutput(code)` — eval while capturing printed output; returns `{ value, output }`.

MCP tests exercise the real `worker_threads` broker (no SDK mock), driving stdio fixtures spawned as `node` subprocesses: `test/fixture-mcp-server.ts` (a one-tool `echo` server, with an optional `LISPTC_FIXTURE_DELAY_MS` startup delay so async-job tests can observe `:pending`) and `test/fixture-empty-mcp-server.ts` (handshakes but exposes zero tools, to test that a tool-less connect is a load failure).
