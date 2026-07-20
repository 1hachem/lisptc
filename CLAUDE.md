# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

this repo is a Lisp interpreter designed to be the deterministic "brain" of an AI agent in a neuro-symbolic architecture. 
The idea (see `README`): the LLM writes Lisp code into a REPL, and the REPL's state/output steers the LLM's context back. 
The repo ships two things:

1. The standalone interpreter (`src/`) — pure TypeScript, **no `pi` dependency**.
2. A `pi` coding-agent extension (`extensions/lisp-repl.ts`) that wires the interpreter into a pi session.

It is also a `pi-package` (see the `pi` field in `package.json`) exposing `extensions` and `skills`.

## Commands

```bash
pnpm test                    # run all tests (vitest run)
pnpm test:watch              # vitest watch mode
pnpm exec vitest run test/macros.test.ts          # single test file
pnpm exec vitest run -t "name of test"            # single test by name
pnpm typecheck               # tsc --noEmit
pnpm lint                    # biome ci (lint + format check) — matches CI
pnpm format                  # biome check --write (auto-fix)
pnpm knip                    # dead-code / unused-dependency check (part of CI)
pnpm repl                    # run the interpreter REPL directly
```

Runtime requires **Node >= 22.6.0**; `.ts` files are executed directly via `--experimental-transform-types` (no build step). CI (`.forgejo/workflows/ci.yml`) runs, in order: typecheck → lint → knip → test. Commits are linted by commitlint (conventional commits) via husky.

## Architecture

### Interpreter core (`src/lisp.ts`, ~1600 lines)
Derived from Nukata Lisp. Key exports used across the codebase: `Interp` (the interpreter/environment), `prelude` (Lisp source string of standard defs), `run(interp, code)` (eval a program, returns last value), `str(value)` (printed representation), `setWriter(fn)` (redirect `prin1`/`princ`/`terpri` output — returns previous writer). Core types: `Cell` (cons cell), `Sym`, `LispKeyword`, `EvalException`. 
Arithmetic lives separately in `src/arith.ts` (`Numeric` = number | bigint, with `add`/`subtract`/`compare`/`tryToParse`, etc.).

**The interpreter is fully synchronous by design.** This is the central constraint that shapes the MCP integration.

### MCP integration (`src/mcp.ts` + `src/mcp-broker.ts`)
Because the interpreter is synchronous but MCP is async, async work is offloaded to a `worker_threads` **broker** (`mcp-broker.ts`). 
The synchronous main thread posts a request and blocks on a `SharedArrayBuffer` via `Atomics.wait`; the worker performs the SDK call and writes the reply back into shared memory, then `Atomics.notify` wakes the main thread. Large replies "spill" to a temp file (STATE_SPILL) instead of the 1 MiB inline buffer.

- The reply protocol constants (`STATE_PENDING/DONE/ERROR/SPILL`, byte sizes) are duplicated in **both** files and **must stay in sync**.
- `src/mcp.ts` installs the Lisp built-ins: `load-mcp`, `unload-mcp`, `list-mcps`, `list-tools`, `mcp-doc`, `search-tools`, `mcp-shutdown`.
- Loaded MCP tools become ordinary global bindings named `<server>/<tool>` called with keyword syntax, e.g. `(linear/list-issues :query "auth bug")`.
- Server config comes from an MCP config file; see `mcp.example.json` for the shape (stdio `command`/`args` servers and HTTP `url`/`headers` servers). `(load-mcp "linear")` loads by name.

### pi extension (`extensions/lisp-repl.ts`)
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
