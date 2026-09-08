# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

this repo is a Lisp interpreter designed to be the deterministic "brain" of an AI agent in a neuro-symbolic architecture. 
The idea (see `README`): the LLM writes Lisp code into a REPL, and the REPL's state/output steers the LLM's context back. 
This is a **Turborepo** pnpm monorepo (`pnpm-workspace.yaml` + `turbo.json`, workspaces = `packages/*` + `apps/*`):

1. `packages/interpreter` (`@repo/interpreter`) — the standalone interpreter (`src/`) plus its tests (`test/`). Pure TypeScript. Exposes its `.ts` sources directly via the `exports` map (no build step), e.g. `@repo/interpreter/lisp.ts`, `@repo/interpreter/grammar.ts` (`LISP_GRAMMAR`, the `lisptc.gbnf` structured-output grammar), `@repo/interpreter/source.ts` (`LANGUAGE_REFERENCE`, distilled from `src/SKILL.md`). **The MCP integration lives here** (`src/mcp*.ts`), so it carries the `@modelcontextprotocol/sdk` dependency.
2. `packages/repl` (`@repo/repl`) — REPL front-ends *on top of* the interpreter: `repl.ts` (`MemoryRepl`/`AgentRepl`, the embeddable string-in/string-out REPLs), `cli.ts` (the interactive stdin/stdout REPL, `pnpm repl` / `repl:attach` / `repl:kill`), and `session-server.ts` (a shared-session server over a unix socket so the editor's LSP and a terminal REPL share ONE interpreter). Depends on `@repo/interpreter`. Consumers import `@repo/repl/repl.ts` / `@repo/repl/session-server.ts`.
3. `packages/ai` (`@repo/ai`) — the agent loop: `stream.ts` (the "model output → eval via `AgentRepl` → feed the JSON tool-result back" SSE loop), `repl.ts`/`repl-store.ts` (conversation snapshots injected as read-only globals; per-thread `AgentRepl` LRU so interpreter state survives a chat's turns), `prompts/lisp.ts` (the lisp-only POLICY system prompt, embedding `LANGUAGE_REFERENCE` and pinning the compaction contract), `provider/` (Fireworks/OpenRouter/llama.cpp/DigitalOcean — grammar-based structured output via `LISP_GRAMMAR`), `telemetry.ts` (PostHog `$ai_generation` tracing). Depends on `@repo/interpreter`, `@repo/repl`.
4. `apps/lsp` (`@lisptc/lsp`) — a stdio language server (`src/server.ts`) for the lisptc dialect. Diagnostics via the interpreter's `checkSyntax` (analysis only, never evaluates the buffer); completion/hover query the live shared session (`@repo/repl/session-server.ts`) when one is reachable, falling back to a local prelude-only interpreter.
5. `apps/mcp` (`@lisptc/mcp-repl`) — a stdio MCP server (`src/server.ts`) exposing the REPL to an MCP client via one persistent `MemoryRepl` (`@repo/repl/repl.ts`).
6. `apps/api` (`api`) — a Hono HTTP server: `POST /api/chat` streams the agent loop from `@repo/ai` over SSE, keyed by `thread_id` so the REPL persists per chat; `GET /health`. Model/provider config comes from `@repo/env`.
7. `apps/app` (`app`) — the React/Vite web frontend (`@tanstack/react-query`, `@langchain/langgraph-sdk` for the chat stream, `@repo/ui` components).

Support packages: `packages/env` (typed env via t3-env/zod), `packages/ui`, `packages/bloub`, `packages/tsconfigs` (shared tsconfig bases).

## Commands

Root scripts delegate to Turbo, which fans out across workspaces:

```bash
pnpm test                    # turbo run test (vitest run in each package)
pnpm typecheck               # turbo run typecheck (tsc --noEmit per package)
pnpm lint                    # biome ci (lint + format check) — matches CI, run at root
pnpm format                  # biome check --write (auto-fix)
pnpm knip                    # dead-code / unused-dependency check (part of CI), run at root
pnpm check:comments          # fails on any non-directive comment (part of CI), run at root
pnpm fix:comments            # strip them; follow with `pnpm format`
pnpm test:watch              # turbo run test:watch
pnpm repl                    # turbo run repl (run the interpreter REPL directly)

# Single test file / by name — run inside the interpreter package:
pnpm --filter @repo/interpreter exec vitest run test/macros.test.ts
pnpm --filter @repo/interpreter exec vitest run -t "name of test"
```

Runtime requires **Node >= 22.6.0**; `.ts` files are executed directly via `--experimental-transform-types` (no build step). CI (`.github/workflows/ci.yml`) runs, in order: typecheck → lint → check:comments → knip → test. `lint`, `check:comments` and `knip` run once at the root; `typecheck` and `test` fan out through Turbo. Husky runs commitlint (conventional commits) on `commit-msg` and `pnpm check:comments` on `pre-push`.

## Comments

**The code carries no comments**, enforced twice: a husky `pre-push` hook, and
`check:comments` in CI as the backstop. The only ones allowed are directives a
tool reads — `biome-ignore`, `/// <reference>`, `// @vitest-environment`,
`// @ts-expect-error` — and those are not prose.

So: **do not write explanatory comments.** Not a header block, not a JSDoc on an
exported function, not a `// why` above a tricky line. The types say what a thing
is; the name says what it does; if neither is enough, the code is what to fix
first.

**When something genuinely needs a reason** — a hidden constraint, a subtle
invariant, a trap that cost a bug, a number that was measured rather than chosen —
that reason goes in `devdocs/`, on the page for that area, and the code stays
plain. `devdocs/README.md` is the index; add to the page you'd have commented in,
and start a new page only for an area that has none. This is not optional
bookkeeping: it is the only place that knowledge now lives, so a change that
invalidates a devdocs claim has to update it in the same commit.

`packages/bloub` is a package apart and keeps its own `docs/` — same rule, different
directory (see its `CLAUDE.md`).

`pnpm check:comments` lists offenders; `pnpm fix:comments` strips them (then run
`pnpm format`). Prefer moving a real reason to `devdocs/` over stripping it.

## Architecture

Paths below are relative to `packages/interpreter/` unless noted.

### Interpreter core (`src/lisp.ts`, ~1600 lines)
Derived from Nukata Lisp. Key exports used across the codebase: `Interp` (the interpreter/environment), `prelude` (Lisp source string of standard defs), `runSync(interp, code)` / `runAsync(interp, code)` (eval a program, returns last value), `str(value)` (printed representation), `setWriter(fn)` (redirect `echo` output — returns previous writer), `writeOut(s)` (write through it), `echoText(args)` (the text `echo` renders — shared with the compaction extension so word offsets agree). Core types: `Cell` (cons cell), `Sym`, `LispKeyword`, `EvalException`. 
Arithmetic lives separately in `src/arith.ts` (`Numeric` = number | bigint, with `add`/`subtract`/`compare`/`tryToParse`, etc.).

**The evaluator suspends rather than blocks.** `Interp.evalGen` is a generator that yields a `Promise`; `runSync` pumps it and raises `cannot suspend` if it ever yields, `runAsync` pumps it with `await`. One evaluator, two drivers. That is what lets async work run on Node's own event loop, on this thread, with no worker.

**Prose around forms.** Only the parenthesised top-level forms are program text: `stripProse(text)` (same file) blanks everything else — keeping newlines so error line numbers still line up — and both `runGen` and `checkSyntax` push the stripped text into the `Reader`. So an LLM (or a `.ptc` file) can write freely around its code, a bare top-level atom is prose rather than an expression, and there is **no comment syntax** at all: `;` is an ordinary symbol character and prose is what a comment used to be. The `lisptc.gbnf` grammar mirrors this — prose may not contain a parenthesis, which is what stops the model emitting an unbalanced one (`:)`). That grammar only binds providers that support grammars, though, so tolerance is an opt-in **extension** rather than a mode: an interp built with `proseExtension()` reads its input the way a model writes, and one built without it treats everything as program text — an unclosed paren is a truncated program, an unknown head is an error, which is right for a `.ptc` script, the prelude, and `checkSyntax`'s editor diagnostics. There is no per-call flag, because whose text an interp is for does not change between one eval and the next; a host needing both keeps two interps. `checkSyntax` takes no interp at all, so it is strict by construction. `MemoryRepl` installs the extension, since what it evaluates was written by a model: an unclosed `(` is prose from that paren on (so a real form after it still runs, instead of being swallowed), and a top-level form whose head symbol is unbound — `(see below)`, `(one, two, three)` — is prose too. A balanced paren counts too when what it holds is not an expression: markdown's backticks are quasiquote sugar, so ``(a deprecated `read_file`)`` hands the reader a quasiquote whose operand is the closing paren, and the sentence died as `unexpected ")"` before any classifier could see it — `unreadable` now reads it as prose. All three questions — the unclosed paren, the unreadable one, and which *parsed* forms are sentences — are `proseExtension()`'s, filled as the core's `unclosedForm` / `unreadableForm` / `skipForm` hooks (see below). Tolerance stops where the form could not be a sentence: a keyword argument, a string literal, an argument that is itself a call to a bound name, or a namespaced head (`server/tool`, `browser_close`) with no word after it all mark a call, so an MCP tool whose server was never loaded raises `undefined: …` instead of vanishing into a skip note. What no reader can settle — `(lenght lst)` against `(step 2)` — stays prose with a note naming the symbol. Both are reported as `skipped …` lines appended to the output, so a misspelled function is still distinguishable from a turn of phrase. `AgentRepl` raises its finished signal for any reply that ran nothing — bare prose, or nothing but asides — since that is how an agent answers; such a reply's `skipped …` notes are **withheld** from the output rather than fed back, because feeding a result to a model that is done costs the user an extra agent turn. They are held for `takeProseFeedback()`, which the host delivers with the NEXT user message (in `packages/ai` as a `tool` transcript entry), so the model still learns not to write the aside again. Truncation is the exception: a reply cut off mid-form also runs nothing, but `isTruncated` (an *open* paren, not any syntax error — a finished aside that will not parse is still an answer) keeps the loop going instead of mistaking it for one.

### Extensions (`InterpOptions.extensions`)
`new Interp({ extensions: [...] })` runs each extension against the fresh interp — last in the constructor, so an extension may also **override** a core built-in (`interp.def` overwrites the global, docs included): `secretsExtension` does that to make the string primitives taint-aware, `compactionExtension` overrides `echo`. Four extensions ship: `mcpExtension()` (`src/mcp.ts`), `secretsExtension()` (`src/secrets.ts`), `compactionExtension()` (`src/compaction.ts`) and `proseExtension()` (`src/prose.ts`). They stay independent of each other — no cross-imports — and the REPL front-ends compose all four.

Beyond `def`, an extension attaches through **two mechanisms the core owns and that name no extension**, so the core never imports one:

- **Hooks** (`src/hooks.ts`) — for *deciding*. One `Chain<Args, R>` combinator that a veto, a wrapping and a broadcast all fall out of; registration order is outermost-first, matching how `extensions: [...]` reads, and an empty chain runs its base, which is the language's own behaviour. `Interp.hooks` holds them: `unclosedForm` / `unreadableForm` / `skipForm` (the reader's tolerance — `proseExtension`'s), `evalForm` (a wrapping chain around one **top-level** form; `compactionExtension` uses it to report each result, and it deliberately does not wrap the recursive `Interp.evalGen`, which runs per subexpression; its middlewares are generator functions that `yield*` their `next`), and `dispose` (a broadcast — `Interp.dispose()` gives a host the teardown `(mcp-shutdown)` already gives the agent, so a REPL `reset()` no longer strands a live MCP client).
- **Channels** (`src/channels.ts`) — for *reporting*. `Interp.channels.emit`/`on` over a `Diagnostic { channel, severity?, text, value?, line? }`. The **channel is the audience** (`user` the human, `model` the LLM's next context, `debug`, plus `"*"` for everything) and the **severity is the consequence** (`critical` thrown as well as emitted, `warning`, `note`) — separate axes on purpose. `echo` output goes to `user`, a prose skip is a `warning` on `model`, an `EvalException` a `critical` there. `setWriter` remains the process-wide default sink for `user`, so a host that never learns about channels still works; a host that does subscribes to its own interp instead. A channel is not registered, only emitted on, so an extension can add one for nothing.

### Secret registry (`src/secrets.ts`)
An opt-in extension installing the `secret` / `secrets` built-ins over a `SecretsStore` interface (`get`/`list`/`set`). The default `EnvSecretsStore` is an in-memory registry seeded from `REPL_*` env vars; swap the store to source secrets elsewhere. **The extension owns all secret loading** — env vars (via `EnvSecretsStore`) and, with `secretsExtension({ envFile })`, a `.env` file (`loadSecretsFromEnvFile`, resolving `$LISPTC_SECRETS_FILE` or the nearest `.env` searched **upward** from the launch dir — so `pnpm repl`, whose cwd is `packages/repl`, still finds the project-root `.env`). `secretsExtension({ store?, envFile? })` is the single entry point: a host passes a persistent `store` (held for the life of the process so injected/loaded secrets survive `reset()`) and, for the CLI, `envFile: true`; the host contains no secret-loading logic of its own. The embeddable REPLs already do this for you: `MemoryRepl`/`AgentRepl` hold one `EnvSecretsStore` for their lifetime, expose it as `repl.secrets` (a host pushes secrets with `repl.secrets.set(...)`), and accept a custom store via the `secretsStore` option — so injected secrets survive `reset()`. Only `REPL_`-prefixed keys become secrets (namespacing what the LLM can see). This module also owns the `Secret` **taint type**: a tainted string whose `toString()` renders redacted (`str` duck-types on it) and whose `toJSON()` reveals the value (`lispToJson` duck-types on it — that is the only reveal path, and the sole "contract" between the extensions). It overrides the string primitives via `interp.def` so taint propagates; without the extension no `Secret` value can exist and the core plain-string primitives are exactly right. See `devdocs/secrets.md`.

### Context compaction (`src/compaction.ts`)
An opt-in extension bounding what the REPL prints, since everything it prints is spent LLM context — and stopping the model from retyping data it was shown. **The REPL prints nothing on its own**: every top-level result is bound to a global named `<function>-<n>` and reported as one line, `name: shape` (`acme/list-issues-1: list of 27 alists, keys "id" "title" …`), describing the value rather than showing it; a value under `INLINE_WORDS` reports as itself. `echo` is the only command that writes — it **overrides** the core `echo` with `:offset`/`:length` windowing and `:match` searching — while `head`/`tail`/`grep` **return** a value (element-wise on a list, word/substring-wise on text) which is then named like any other result. That split is the point: extract into a name, then echo a rendering of it. The one exception is a **bare slice**: `result` prints the value of a top-level `head`/`tail` form instead of describing it and mints no name, because a slice is asked for in order to be read — describing it back cost the agent a second step on the `(echo head-1)` it meant all along. The decision is made from the form (`isSliceForm`), not inside the built-in, so a slice nested in another form stays a silent ordinary value. Each `echo` yields a `Bounded` pair — `user` uncapped, `model` capped against a **per-step** word budget (`beginStep`/`endStep`), the capping done where the source value's name is still known. A **promise** is the one value never shown at all: its report names it and says what the name does (`(await load-mcp-1)`, `(promise-state …)`, `(cancel …)`) and that nothing is owed, since a promise applies its own result when it settles — an agent shown the printed form types it back, which was four negative survey reports in two days. The reader now refuses any `#<…>` form for the same reason (`src/lisp.ts`, `readToken`): every value that prints that way is one that cannot be read back, so typing one is always a retyped printout, and the error says to use the reported name. `Compactor` holds no values (a named result is an ordinary global) and is created **per interpreter** by the host — the opposite of `secretsExtension`'s store — so `reset()` restarts the numbering. `MemoryRepl.evalOutput` is the choke point: `eval` returns the model's copy, so `apps/mcp` inherits the cap for free, while `packages/ai` sends the uncapped copy to the UI in `additional_kwargs.display`. See `devdocs/compaction.md`.

### Prose classifier (`src/prose.ts`)
An opt-in extension holding the guess that separates an LLM's sentences from its code. It installs no built-in: it fills `Interp.prose`, a `ProseClassifier` that `run` consults once per top-level form under `prose: "tolerant"`, returning the note to report the skip with (or `undefined` to evaluate the form). The bundled `readsAsProse` is the heuristic described under **Prose around forms** — unbound head, minus the marks of code; a host that reads its model differently passes its own to `proseExtension(classify)` instead. It lives outside the core because it is a claim about how a writer writes, not a rule of the language: `checkSyntax`, a `.ptc` script and the LSP never consult it, and neither does an interp that was never handed it.

### Promises (`src/promises.ts`)
The **async capability**, factored out of MCP so any feature can offload async work. It is deliberately domain-agnostic (knows nothing about MCP), and it keeps **no value type of its own**: a Lisp promise IS the host runtime's `Promise`.
- `Promises` installs the built-ins over a `Dispatch` (`(op, payload, signal) => Promise<unknown>`), which is the whole extension point — a different backend (a Redis-backed queue, say) is a different `Dispatch`, not a different class. `promise.then(finalize)` is what applies a result once, so there is no id map, no `collect`, no cached-result flag: a promise settles once and keeps its value natively. Built-ins: `await`, `promise-all`, `promise-all-settled`, `promise-any`, `promise-race` (each delegating to the host `Promise` combinator of the same name), plus `promise-state`, `promises` and `cancel`.
- **A builtin declares whether its promise is a suspension or a value.** `interp.def` is plain: a returned promise is yielded by the evaluator and resumed with its result (`BuiltInFunc.settle`), which is what makes an MCP tool call read as ordinary code; a rejection becomes an `EvalException` whose *value* is the error text, so a `catch` binds something actionable. `interp.defPromise` means the promise IS the value (`load-mcp` and the combinators), so it does not suspend. `interp.defGen` bodies are generators that yield for themselves. `runAsync` therefore returns a **boxed** `Outcome`, since an `async` function awaits a promise it returns and would otherwise wait for a step ending in `(load-mcp …)`.
- **Two things a promise cannot say**, and the only state the module keeps (a `WeakMap`): whether it has settled (`(promise-state p)` must not block, so the settling `.then` records `:pending`/`:fulfilled`/`:rejected`), and how to stop it (`AbortController`, wired into the op's `signal`; `(cancel p)` aborts it and the promise then rejects). That same `.then` absorbs rejections, so a promise the agent never awaits cannot kill the process. A `live` set holds only what is pending, for `(promises)` and shutdown. Timeouts (`DEFAULT_TIMEOUT_MS` 30s, `AWAIT_TIMEOUT_MS` 50s) are policy, not deadlock guards: nothing blocks the thread any more.

### MCP integration (`src/mcp.ts` + `src/mcp-client.ts`)
MCP is a **consumer of the promises layer**: `registerMcp` builds a `Promises` over a `Dispatch` (default: `mcpDispatch`), installs the generic promise built-ins through it, and adds the MCP built-ins on top. `src/mcp-client.ts` is MCP-only: it defines the domain `dispatch` (`connect`, `call-tool`, `disconnect`, `login`, `logout`, `authorize`, `list-tools`, `search`) and runs the SDK's clients on this thread. Its `clients` map, OAuth callback server and token store are module-scoped, so every interp in a process shares them.

- `src/mcp.ts` installs the Lisp built-ins: `load-mcp`, `unload-mcp`, `list-mcps`, `list-toolkit`, `list-tools`, `search-tools`, `search-mcps`, `mcp-shutdown` (the promise built-ins `await`/`promise-all`/`promise-all-settled`/`promise-any`/`promise-race`/`promise-state`/`promises`/`cancel` come from the promises layer). Tool docs don't get their own command — `load-mcp` registers each `<server>/<tool>` binding's signature/description/args via `Interp.defineGlobal`'s `doc` param, so the generic `doc` built-in (`src/lisp.ts`) renders MCP tool docs the same way it renders any other binding's.
- **Async by default:** `load-mcp` returns a promise immediately (the connect runs in the background) and does *not* block; `(await p)` installs the server's `<server>/<tool>` bindings and returns the tool list. A connect that exposes **zero tools** is treated as a load failure (the promise rejects), not a misleading `:loaded`. A tool call is an ordinary suspending call instead (`runtime.call("call-tool", …)` returns a promise the evaluator yields on), since there is nothing to overlap it with.
- Loaded MCP tools become ordinary global bindings named `<server>/<tool>` called with keyword syntax, e.g. `(linear/list-issues :query "auth bug")`.
- **A tool result reaches Lisp as data.** The client prefers `structuredContent`, but most servers put their JSON in a text block instead, so an all-text result that parses as a JSON **object or array** is parsed too (`asJsonDocument`, `src/mcp-client.ts`) before `jsonToLisp` converts it — an object becomes an alist the agent can `assoc`, and the REPL reports its keys rather than a word count. Only objects and arrays: a tool that answered `42`, `null` or `"ok"` meant text, and parsing those would replace its answer with a number, nil or a re-quoted string.
- Predefined servers come exclusively from the bundled `mcp.toolkit.json` (stdio `command`/`args` servers and HTTP `url`/`headers` servers) — a curated, ready-to-use set loaded at `registerMcp` time. Each is callable by bare name, e.g. `(await (load-mcp "playwright"))`. There is no env-var config; edit `mcp.toolkit.json` to add servers.

### AI agent loop (`packages/ai`)
`stream.ts` drives the loop: the model's reply is stripped of markdown fences and sent verbatim to the thread's `AgentRepl`, and the REPL's capped output is fed back as a JSON tool-result object (`{"type":"tool_result","source":"lisp-repl","error":…,"output":…}`), with the uncapped copy riding alongside in `additional_kwargs.display` for the UI — the agent has **no tools**; a form-less (pure prose) reply is the loop's end signal (`AgentRepl.takeFinished`). `repl-store.ts` keeps one `AgentRepl` per chat `thread_id` (bounded LRU, eviction TODO: release MCP clients) so interpreter state survives a chat's turns; `repl.ts` injects the conversation snapshot as read-only globals (`conversation`, `user-messages`, `assistant-messages`) before every eval. `prompts/lisp.ts` is the lisp-only POLICY system prompt: it embeds `LANGUAGE_REFERENCE`, teaches the silent-REPL contract (rule 2), the naming and extract-then-echo pattern (rules 10–11a), the fact that the user *does* read echoed output (rule 4c), and forbids Lisp in thinking — all pinned by `test/prompt.test.ts`. Providers (`provider/`: Fireworks, OpenRouter, llama.cpp, DigitalOcean) constrain every reply to valid lisptc source via grammar-based structured output (`LISP_GRAMMAR`). `telemetry.ts` traces each generation to PostHog as `$ai_generation`.

## Testing

Tests live in `test/`, grouped by language feature (`reader`, `numbers`, `lists`, `macros`, `recursion`, `control-flow`, `errors`, `printing`, `mcp`). Use the helpers in `test/helpers.ts`:
- `freshInterp()` — new `Interp` with `prelude` loaded.
- `ev(code, interp?)` — eval program with `runSync`, return `str` of last value.
- `evAsync(code, interp?)` — the same through `runAsync`; anything touching MCP needs it, since `runSync` raises `cannot suspend` the moment a tool call needs the loop.
- `evWithOutput(code)` — eval while capturing printed output; returns `{ value, output }`.

MCP tests exercise the real MCP SDK clients (no mock), driving stdio fixtures spawned as `node` subprocesses: `test/fixture-mcp-server.ts` (a one-tool `echo` server, with an optional `LISPTC_FIXTURE_DELAY_MS` startup delay so promise tests can observe `:pending`) and `test/fixture-empty-mcp-server.ts` (handshakes but exposes zero tools, to test that a tool-less connect is a load failure).

Other workspaces have their own suites: `packages/repl/test` (front-ends, compaction at the REPL boundary, session server, secret handling), `packages/ai/test` (prompt/policy surface, telemetry redaction), `apps/lsp/test` (diagnostics, doc cache).


## Writing Style

When writing any prose, documentation, commit messages, or code comments:

- Do not use "It's not that X, it's that Y" constructions. Rewrite as a direct statement.
- Do not open responses with affirmations ("Certainly!", "Of course!", "Absolutely!").
- Do not use "It's worth noting", "it's important to mention", or similar throat-clearing.
- Do not narrate your process ("Let me walk you through..."). Just do the thing.
- Prefer active voice over passive voice.
- Prefer short sentences. Break compound thoughts into separate sentences.
- No em dashes. Use a comma, colon, or separate sentence instead.
