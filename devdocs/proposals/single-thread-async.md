# Await without workers: a suspendable evaluator

**Status: proposal.** Nothing here is built yet. Everything under `devdocs/`
outside this directory describes code that exists; this page describes code we
intend to write, and it is either implemented and folded into
[`../jobs.md`](../jobs.md), or deleted.

## The constraint

[`../jobs.md`](../jobs.md) states it in its second heading:

> A single Node thread cannot block on its own event loop without deadlocking.

That is true only because `Interp.eval` is a plain synchronous JS function that
has to *return* a value. Everything downstream serves that one signature: the
worker thread, the `SharedArrayBuffer`, `Atomics.wait`, the 1 MiB reply buffer,
the spill-to-tempfile path, the 30s and 50s timeouts, and the rule that a broker
must always sit beside its importer as a sibling file.

So the work is not "add promises". It is **make `eval` suspendable**. Once it
can suspend, every async concern collapses back onto the main loop and the
worker has nothing left to do.

## Mechanism: one generator evaluator, two drivers

The evaluator becomes a generator that yields a `Promise` when it needs to wait:

```ts
*evalGen(x: unknown, env: List): Generator<Promise<unknown>, unknown, unknown>
```

The `for(;;)` trampoline stays exactly as it is, so tail calls still do not grow
the stack. Every internal re-entry becomes `yield*`.

### Every re-entry point into eval

The complete set, verified against the source. Nothing in `packages/repl`,
`packages/ai` or `apps/lsp` calls `interp.eval` directly.

| site | location |
| --- | --- |
| `Func.evalFrame` (argument evaluation) | `lisp.ts:222`, `:227` |
| `Macro.expandWith` | `lisp.ts:263` |
| `Closure.makeEnv` | `lisp.ts:303` |
| `BuiltInFunc.evalWith` | `lisp.ts:327` |
| the `fn` position of a call | `lisp.ts:1120` |
| `evalProgN` / `evalCond` / `evalSetQ` / `evalTry` | `lisp.ts:1148`-`1242` |
| `apply` builtin | `lisp.ts:905` |
| `_run-loop-body` builtin | `lisp.ts:1009` |
| `import` builtin (re-enters `run`) | `lisp.ts:1228` |

`mapcar`, `while`, `dolist`, `dotimes`, `case` and `let` are prelude Lisp, so
they suspend for free through the evaluator. The three builtins that re-enter
`eval` need a second builtin flavour whose body is itself a generator, so
`BuiltInFuncBody` widens to `((frame) => unknown) | ((frame) => Generator<...>)`
and `evalWith` delegates.

### Two drivers, one evaluator

The evaluator is written once and pumped two ways. No duplicated interpreter.

- `runSync(interp, text)` pumps the generator and throws if it ever yields. The
  prelude, `apps/lsp`, `.ptc` imports and most of the test suite keep using it.
  This is a guarantee, not a fallback: a host that never turns the loop cannot
  silently half-run a program.
- `runAsync(interp, text)` pumps with `await` and feeds rejections back in
  through `gen.throw(err)`, so Lisp `try`/`catch` and `LoopSignal` cross a
  suspension point unchanged.

## The Lisp surface does not change

`Job`, `(await j)`, `await-all`, `await-any`, `job-status`, `jobs` and `cancel`
all stay. The system prompt, `SKILL.md`, the GBNF grammar, compaction's
job-reporting line and the `#<…>` reader refusal remain valid, and no agent
behaviour has to be re-taught. One internal rule is added instead:

> **A `Promise` returned from a builtin body is not a Lisp value.** The evaluator
> yields it and resumes with its result.

Lisp code has no way to construct a Promise, so the rule is unambiguous. It buys
two things at once. `(await job)` is `yield job.promise`. And everything that
goes through `runtime.call(...)` today (tool calls, `login`, `authorize`,
`logout`, `disconnect`) just returns its promise, still reading as synchronous
in Lisp, with nothing blocking anywhere.

`load-mcp` keeps returning a `Job` and still does not suspend, so two loads still
run concurrently. Concurrency comes from where it comes from now: `start` before
`await`.

## `LocalJobsRuntime` replaces the worker

`JobsRuntime` survives as the interface, which is what makes this a transport
swap rather than a rewrite. `LocalJobsRuntime` holds native promises in a map:

- `start` calls dispatch, stores the promise plus an `AbortController`, returns
  an id.
- `awaitJob` hands back that promise for the driver to await.
- `awaitAll` / `awaitAny` become `Promise.all` / `Promise.race` over the
  never-rejecting `Settled` wrappers `jobs-broker.ts` already uses.
- `onSettled` becomes `promise.then(...)`, preserving the current guarantee that
  a finalizer applies when the loop turns with no explicit await. The loop now
  turns mid-eval too, so it applies sooner.
- `cancelJob` aborts, unchanged in behaviour. `shutdown` aborts everything in
  flight.

`mcp-broker.ts`'s dispatch, with `asJsonDocument` and `ensureAuthorized`, is
already plain async code with no worker awareness. It moves to a main-thread
`mcp-client.ts` essentially verbatim.

Deleted outright: `jobs-broker.ts`, `jobs-protocol.ts`, `WorkerJobsRuntime`, the
SAB request/reply codec, the spill file, and the `mcp-broker` rollup input in
`apps/api/vite.config.ts` (the `mcp.toolkit.json` copy stays). With them go the
worker-URL sibling rule, the `execArgv: --experimental-transform-types`
coupling, and the EPIPE handlers the test fixtures carry.

Timeouts survive but change meaning. They were deadlock guards for
`Atomics.wait`; they become policy, so one agent turn cannot hang forever. Say so
where the constants live, or the next reader will take them for load-bearing.

## The ripple

`MemoryRepl.evaluate` / `evalOutput` / `eval` become async. Every consumer
already sits in an async context.

| consumer | location | change |
| --- | --- | --- |
| session server | `session-server.ts:50` | await |
| MCP server tool handler | `apps/mcp/src/server.ts:33` | await |
| agent loop | `packages/ai/src/repl.ts:61` | await |
| interactive CLI | `packages/repl/src/cli.ts` | await |
| language server | `apps/lsp/src/server.ts:39` | unchanged |
| test helper `ev()` | `test/helpers.ts` | stays sync |

`apps/lsp` only ever runs the prelude and `checkSyntax`. `ev()` stays synchronous
on `runSync`, so only the async tests get a new `evAsync`, which holds the test
diff to the MCP files instead of all thirty.

## Four things that were structurally impossible

The loop now turns *during* an eval. This is the part that needs writing down.

**Re-entrancy.** A second `repl.eval()` can start while one is in flight.
`MemoryRepl` must serialize to one in-flight eval and queue the rest. Otherwise
`compactor.beginStep()` / `endStep()` and the channel subscriptions in
`evaluate()` interleave and cross-contaminate two turns' output.

**The global writer.** `setWriter` is process-wide and gets swapped around a run
in `evWithOutput`. That is safe only while a run is atomic. Rule: nothing may
swap the global writer across a suspension point, hosts subscribe to the interp's
`user` channel instead. The test helper needs the same fix.

**Sync dispose, async disconnect.** `dispose` is a synchronous broadcast hook,
but disconnect now happens on the main thread and is async. Teardown becomes
fire-and-forget with an abort; `mcp-shutdown` stays the awaitable path.

**Finalizers land mid-eval**, not only between evals. They install
`<server>/<tool>` globals, which is benign in practice, but it contradicts what
`../jobs.md` promises today.

## Staging

Five commits, each green on its own.

1. Generator evaluator and `runSync`. No async anything: a pure refactor, whole
   suite passes unchanged. Performance is measured here.
2. `runAsync`, the suspension rule, async `MemoryRepl` with its serialization
   queue. The four consumers updated alongside.
3. `LocalJobsRuntime` behind the existing `JobsRuntime` interface, `mcp.ts`
   defaulting to it, MCP dispatch moved to the main thread. The MCP tests still
   drive the real stdio fixtures.
4. Delete the worker path, protocol and vite input. `knip` confirms nothing
   dangles, which is the check this commit exists to pass.
5. Rewrite the docs the change invalidates: `../jobs.md` is wrong from its first
   paragraph, then the touched claims in `../interpreter.md`, `../repl.md`,
   `../agent-loop.md`, and the two architecture sections of `CLAUDE.md`. This
   page goes away in the same commit.

## The performance gate

Baseline measured before any of this was written, on one dev machine:

| measurement | value |
| --- | --- |
| 300k tail-recursive iterations | 361 ms |
| 300k `dotimes` iterations | 674 ms |
| per iteration | ~1.2 µs |

Isolated `yield*` delegation costs about 30ns against 3ns for a plain call, which
looks alarming on its own. An iteration passes through roughly 10 to 15 eval
nodes at 1.2 µs of real work, so the expected slowdown is 20 to 40 percent, not
the 10x the microbenchmark suggests.

Commit 1 carries that benchmark and the real number. If it lands past 2x, the
fallback is a hybrid keeping the synchronous evaluator for closed subtrees where
no async builtin is reachable. That is more machinery, and it is not worth paying
for unmeasured.

## After

Free once the evaluator suspends: a real `(sleep ms)`; interrupting a running
eval at the next suspension point (the agent loop currently cannot stop a turn
mid-eval); per-eval deadlines.

Deferred deliberately: `(spawn thunk)`, meaning concurrent evaluation of *Lisp*
on one loop. Generators make it easy to build, and it introduces interleaved
mutation of Lisp globals. That is a language-semantics decision, not a transport
one, and it should not ride along with this change.
