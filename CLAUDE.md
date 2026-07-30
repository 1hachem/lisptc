# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

this repo is a Lisp interpreter designed to be the deterministic "brain" of an AI agent in a neuro-symbolic architecture. 
The idea (see `README`): the LLM writes Lisp code into a REPL, and the REPL's state/output steers the LLM's context back. 
This is a **Turborepo** pnpm monorepo (`pnpm-workspace.yaml` + `turbo.json`) shipping two workspaces:

1. `packages/interpreter` (`@lisptc/interpreter`) — the standalone interpreter (`src/`) plus its tests (`test/`). Pure TypeScript, **no `pi` dependency**. Exposes its `.ts` sources directly via the `exports` map (no build step).
2. `apps/extension` (`@lisptc/extension`) — a `pi` coding-agent extension (`extensions/lisp-repl.ts`) that wires the interpreter into a pi session. Depends on `@lisptc/interpreter` (`workspace:*`) and resolves the interpreter's `src/` dir at runtime via `require.resolve("@lisptc/interpreter/package.json")`.

The repo root is itself the published `pi-package` (see the `pi` field in the root `package.json`) exposing `extensions` (pointing at `./apps/extension/extensions`) and `skills`.

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
pnpm --filter @lisptc/interpreter exec vitest run test/macros.test.ts
pnpm --filter @lisptc/interpreter exec vitest run -t "name of test"
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
- `src/mcp.ts` installs the Lisp built-ins: `load-mcp`, `unload-mcp`, `list-mcps`, `list-toolkit`, `list-tools`, `mcp-doc`, `search-tools`, `search-mcps`, `mcp-shutdown`.
- Loaded MCP tools become ordinary global bindings named `<server>/<tool>` called with keyword syntax, e.g. `(linear/list-issues :query "auth bug")`.
- Predefined servers come exclusively from the bundled `mcp.toolkit.json` (stdio `command`/`args` servers and HTTP `url`/`headers` servers) — a curated, ready-to-use set loaded at `registerMcp` time. Each is callable by bare name, e.g. `(load-mcp "playwright")`. There is no env-var config; edit `mcp.toolkit.json` to add servers.

### pi extension (`apps/extension/extensions/lisp-repl.ts`)
Spawns the standalone REPL (`src/lisp.ts`) as a **subprocess** and mediates between it and a pi session:
- Replaces the agent's system prompt with a lisp-only policy plus the full interpreter source (so the LLM knows the exact language it's programming).
- The agent has **no tools**: assistant text is sent verbatim to the REPL, evaluated, and the result injected back as a custom message. A `!`-prefixed user line (via `LispEditor`) is sent straight to the REPL.
- `EVAL_TIMEOUT_MS` (60s) is deliberately kept above `src/mcp.ts`'s 30s MCP-call timeout so a slow tool surfaces as a Lisp error rather than a REPL restart.

## Testing

Tests live in `test/`, grouped by language feature (`reader`, `numbers`, `lists`, `macros`, `recursion`, `control-flow`, `errors`, `printing`, `mcp`). Use the helpers in `test/helpers.ts`:
- `freshInterp()` — new `Interp` with `prelude` loaded.
- `ev(code, interp?)` — eval program, return `str` of last value.
- `evWithOutput(code)` — eval while capturing printed output; returns `{ value, output }`.

MCP tests use `test/fixture-mcp-server.ts` (a real in-process `McpServer` fixture) rather than mocking the SDK.
