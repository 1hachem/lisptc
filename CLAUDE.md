# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

this repo is a Lisp interpreter designed to be the deterministic "brain" of an AI agent in a neuro-symbolic architecture.
The idea (see `README`): the LLM writes Lisp code into a REPL, and the REPL's state/output steers the LLM's context back.
This is a **Turborepo** pnpm monorepo (`pnpm-workspace.yaml` + `turbo.json`) shipping three workspaces:

1. `packages/interpreter` (`@repo/interpreter`) — the standalone interpreter (`src/`) plus its tests (`test/`). Pure TypeScript, **no `pi` dependency**. Exposes its `.ts` sources directly via the `exports` map (no build step).
2. `apps/pi` (`@lisptc/extension`) — a `pi` coding-agent extension (`extensions/lisp-repl.ts`) that wires the interpreter into a pi session. Depends on `@repo/interpreter` (`workspace:*`) and resolves the interpreter's `src/` dir at runtime via `require.resolve("@repo/interpreter/package.json")`.
3. `apps/lsp` (`@lisptc/lsp`) — a stdio LSP server (`src/server.ts`, bin `lisptc-lsp`) for `.ptc` files, built on `vscode-languageserver` and the interpreter's `checkSyntax`/docs.

The repo root is itself the published `pi-package` (see the `pi` field in the root `package.json`) exposing `extensions` (pointing at `./apps/pi/extensions`) and `skills`.

## Commands

Root scripts delegate to Turbo, which fans out across workspaces:

```bash
pnpm test                    # turbo run test (vitest run in each package)
pnpm typecheck               # turbo run typecheck (tsc --noEmit per package)
pnpm lint                    # biome ci (lint + format check) — matches CI, run at root
pnpm format                  # biome check --write (auto-fix)
pnpm knip                    # dead-code / unused-dependency check (part of CI), run at root
pnpm test:watch              # turbo run test:watch
pnpm repl                    # run the interpreter REPL directly (src/main.ts)

# Single test file / by name — run inside the interpreter package:
pnpm --filter @repo/interpreter exec vitest run test/macros.test.ts
pnpm --filter @repo/interpreter exec vitest run -t "name of test"
```

Runtime requires **Node >= 22.6.0**; `.ts` files are executed directly via `--experimental-transform-types` (no build step). CI (`.github/workflows/ci.yml`) runs, in order: typecheck → lint → knip → test. `lint` and `knip` run once at the root; `typecheck` and `test` fan out through Turbo. Commits are linted by commitlint (conventional commits) via husky.

## Architecture

Paths below are relative to `packages/interpreter/` unless noted.

### Interpreter core (`src/`)
Derived from Nukata Lisp, split into modules; `src/lisp.ts` is the public barrel that re-exports the surface below (import from `@repo/interpreter` or `../src/lisp.ts` in tests):

- `sexpr.ts` — `Cell`, `Sym`, `Keyword`, `LispKeyword`, interning tables, symbol constants, `cdrCell`/`foldl`/`mapList`.
- `printer.ts` — `str(value)` printed representations.
- `exceptions.ts` — `EvalException`, `FormatException`, the `EndOfFile` sentinel.
- `schemas.ts` — zod argument schemas (`zList`, ...) + `parseArgs` for built-ins.
- `func.ts` — `Macro`/`Lambda`/`Closure`/`BuiltInFunc`/`Arg`.
- `compile.ts` — argument compilation and quasi-quotation expansion.
- `interp.ts` — the `Interp` evaluator (globals, doc table, eval loop).
- `builtins.ts` — native built-ins, registered in groups from the `Interp` constructor.
- `reader.ts` — tokenizer/parser (`Reader`). Note: `;` comments are rejected with a warning by design.
- `prelude.ptc` + `prelude.ts` — the Lisp prelude as real Lisp source, loaded at import time.
- `repl.ts` — `run(interp, code)`, `checkSyntax`, `createInterp()` (fresh interp + prelude), and `ReplSession` (in-process REPL for embedders).
- `main.ts` — the standalone Node REPL (`pnpm repl`); guarded so importing it never attaches to stdin.
- `io.ts` — `setWriter(fn)` redirects `prin1`/`princ`/`terpri` output (returns the previous writer).

Arithmetic lives separately in `src/arith.ts` (`Numeric` = number | bigint).

**The interpreter is fully synchronous by design.** This is the central constraint that shapes the MCP integration.

### MCP integration (`src/mcp/`)
Because the interpreter is synchronous but MCP is async, async work runs behind a **SyncBridge** (`mcp/bridge.ts`). The default runtime, `WorkerBridge` (`mcp/bridges/worker.ts`), posts requests to a `worker_threads` broker (`mcp/broker.ts`) and blocks via `Atomics.wait` on a per-request `SharedArrayBuffer` pair; the worker performs the SDK call and notifies back. Large replies "spill" to a temp file instead of the 1 MiB inline buffer. The wire protocol (states, buffer layout, `ConnConfig`, ops) lives in one place: `mcp/protocol.ts`, imported by both sides. Alternative runtimes implement `SyncBridge` and are injected via `registerMcp(interp, bridge)`.

- **Deployment adapters** (`mcp/adapter.ts` + `mcp/adapters/{stdio,http}.ts`) decide how a server is provisioned/reached (spawn a subprocess, HTTP endpoint; docker/k8s can be added as one file each). Selected per server via an optional `deploy:` key in the config, inferred stdio/http otherwise. Workload and connection lifecycles are separate: `provision(conf) → handle` acquires/locates the workload, `createTransport(conf, handle)` connects to it, and `deprovision(handle)` (called on disconnect and by `mcp-shutdown`) releases exactly what provision acquired.
- `mcp/index.ts` installs the Lisp built-ins: `load-mcp`, `unload-mcp`, `list-mcps`, `list-tools`, `mcp-doc`, `search-tools`, `await`, `await-all`, `poll`, `mcp-shutdown`.
- Loaded MCP tools become ordinary global bindings named `<server>/<tool>` called with keyword syntax, e.g. `(linear/list-issues :query "auth bug")`.
- **Async calls**: pass `:async t` to any tool call to get an `McpFuture` immediately instead of blocking; requests run concurrently in the broker. Resolve with `(await f [timeout-ms])` / `(await-all list)` or check with `(poll f)` → `:pending | :done | :error`. Each request has its own shared buffers, so any number can be in flight; only the waiting blocks.
- Server config comes from the `MCP_SERVERS` env var (JSON array); see `mcp.example.json` for the shape. `(load-mcp "linear")` loads by name.

### pi extension (`apps/pi/extensions/lisp-repl.ts`)
Runs the interpreter **in-process** via `ReplSession` (no subprocess, no stdout scraping) and mediates between it and a pi session:
- Replaces the agent's system prompt with a lisp-only policy plus the full interpreter source (all `src/**/*.ts` + `prelude.ptc`, enumerated dynamically so module splits can't silently drop docs).
- The agent has **no tools**: assistant text is sent verbatim to the REPL, evaluated, and the result injected back as a custom message. A `!`-prefixed user line (via the custom editor) is sent straight to the REPL.

### LSP (`apps/lsp/src/server.ts`)
A stdio language server for `.ptc` files: diagnostics from `checkSyntax`, completions/hover from the interpreter's doc table. Start with `pnpm --filter @lisptc/lsp start`.

## Testing

Tests live in `test/`, grouped by language feature (`reader`, `numbers`, `lists`, `macros`, `recursion`, `control-flow`, `errors`, `printing`, `mcp`, `docs`, `prelude`, `repl-session`). Use the helpers in `test/helpers.ts`:
- `freshInterp()` — new `Interp` with `prelude` loaded (alias of `createInterp`).
- `ev(code, interp?)` — eval program, return `str` of last value.
- `evWithOutput(code)` — eval while capturing printed output; returns `{ value, output }`.

MCP tests use `test/fixture-mcp-server.ts` (a real in-process `McpServer` fixture exposing `echo`, `slow-echo` and `fail`) rather than mocking the SDK.
