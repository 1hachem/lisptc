# The async jobs runtime, and MCP on top of it

The evaluator suspends rather than blocks (see
[interpreter.md](./interpreter.md)), so async work runs on Node's own event
loop. This layer is how the language (a) makes a call into async work that reads
as ordinary and (b) starts background jobs it can await, poll or cancel. It is
deliberately domain-agnostic: `jobs.ts` knows nothing about MCP. MCP is a
*consumer*.

```
src/jobs.ts        JobsRuntime (interface) + LocalJobsRuntime + Job + Jobs
src/mcp.ts         the built-ins, and the finalizer that installs tool bindings
src/mcp-client.ts  the domain dispatch: connect, call-tool, login, ...
```

## Why there is no worker any more

There used to be one, because a synchronous `Interp.eval` had to *return* a
value, and a thread cannot block on its own event loop without deadlocking. So
the work went to a second thread with its own loop, and the main thread waited
on `Atomics.wait` over a `SharedArrayBuffer`, with a 1 MiB inline reply buffer,
a spill-to-tempfile path for anything larger, JSON on the wire, timeouts as
deadlock guards, and a broker file that had to sit beside its importer under
whichever extension the importer had.

All of it existed to serve that one signature. `evalGen` yields a promise
instead, so the MCP SDK's own clients now run on the main thread and their
promises reach Lisp directly. Nothing is serialized, nothing spills, and a
result stays a live JS value instead of a JSON round-trip.

## A promise is a suspension, not a value

The rule lives in the evaluator: a `Promise` returned from a builtin body is not
a Lisp value, so `evalGen` yields it and resumes with its result. Lisp code
cannot construct one, which is what makes the rule unambiguous.

That is why `mcp.ts` reads as it does. A tool binding returns
`runtime.call("call-tool", …).then(jsonToLisp)`, and `(linear/list-issues …)`
still looks synchronous in Lisp while blocking nothing. `login`, `logout` and
`mcp-authorize` are the same shape.

A rejection surfaces as an `EvalException` whose **value is the error text**, so
`(try … (catch (e) …))` binds something the agent can act on rather than an
internal op code. `BuiltInFunc.settle` is where that happens.

## Job lifecycle

A producer starts a job with `runtime.start(op, payload)` and gets back a `Job`
handle (tracked via `jobs.track`). Results apply through a **finalizer**, by two
paths:

1. **push** — the runtime's `promise.then` fires when the job settles and `Jobs`
   applies the finalizer. So an effect appears **automatically between evals,
   with no explicit await**, and now also mid-eval at any suspension point.
2. **`(await job)`** — the built-in returns the job's promise, so the evaluator
   suspends and the finalizer runs on the way back.

The two are idempotent via `Job.finalized`. `Jobs.live` holds only jobs still
running: a settled job is reaped when collected.

`(cancel job)` calls `AbortController.abort()`, wired into the op's `signal`, so
it aborts the in-flight request rather than merely forgetting about it.

## Timeouts are policy now, not a deadlock guard

`DEFAULT_TIMEOUT_MS` (30s) and `AWAIT_TIMEOUT_MS` (50s) used to exist because
`Atomics.wait` with no bound would hang the thread forever. Nothing hangs any
more: they stay only so one agent turn cannot wait on a dead server without end,
and `(await job ms)` lets the agent choose. A non-finite timeout is rejected.

`withTimeout` unrefs its timer, so a pending deadline cannot hold the process
open by itself.

## `JobsRuntime` is still the swappable transport

`LocalJobsRuntime` is the only implementation, and it is deliberately not the
interface: a different backend (a Redis-backed queue, say) can implement the same
shape without touching the built-ins or the domain layer. It takes a
`Dispatch`, which is what keeps `jobs.ts` free of MCP.

`mcp.ts` does the single cast from the wire string to `McpOp` at the boundary, so
`mcpDispatch` keeps a typed, exhaustively-checked switch and an unknown op still
reaches its `default` and throws.

## MCP specifics

### A tool-less connect is a load failure

A server that handshakes but exposes zero tools is useless to lisptc, whose MCP
integration is tools-only — and that is the common shape of a degraded,
unauthenticated or wrong-URL connection, which returns an empty list rather than
erroring. It is reported as `:error`, not a misleading `:loaded` server with no
tools.

### A tool result reaches Lisp as data

`mcp-client.ts` prefers `structuredContent`, but most servers put their JSON in a
text block instead. `asJsonDocument` parses an all-text result **only when it is
a JSON object or array**: an object becomes an alist the agent can `assoc`, and
the REPL reports its keys rather than a word count.

Only objects and arrays. A tool that answered `42`, `null` or `"ok"` meant text,
and parsing those would replace its answer with a number, nil or a re-quoted
string.

### `load-mcp` is a job, tool calls are not

`load-mcp` returns a `Job` immediately and does not block, so two loads run
concurrently; `(await job)` installs the server's `<server>/<tool>` bindings and
returns the tool list. A tool call is an ordinary suspending call instead, since
there is nothing to overlap it with.

### The client module is process-wide

`clients`, the shared OAuth callback server and the token store live in
`mcp-client.ts` module scope, so **every interp in a process shares them**. Under
the worker each interp got its own copy, one per broker. Two interps loading the
same server now share nothing but that map, keyed by `serverId`, so they do not
collide; but a test that expects isolation between interps will not get it.

### `LOAD_MCP_ARGS` marks only `:name` required

The url/command choice is a branch (either `:url` plus optional
`:headers`/`:oauth`/`:scopes`, or `:command` plus optional `:args`/`:env`), and a
flat `DocArg` list cannot express "one of" — marking both required would make
every valid call look like it was missing the other.

### Shutdown is reachable two ways, so it is idempotent

The agent can release its own servers with `(mcp-shutdown)`, and a host dropping
the interp releases them through the `dispose` hook. Both may fire. Every
installed `<server>/<tool>` global is undefined on the way out, so no stale
binding lingers with a closure capturing a dead `serverId`.

`dispose` is a synchronous broadcast, but disconnecting is async, so teardown
aborts and lets the disconnect finish on its own. `(mcp-shutdown)` is the path
that can be awaited.

### `${VAR}` in the toolkit expands against `process.env`

So the bundled config can point at environment-provided paths (the Nix-built
browser, say) without hardcoding machine-specific store paths. Unset vars expand
to the empty string, and a malformed config entry is ignored rather than crashing
interpreter startup.

`mcp.toolkit.json` still sits at the package root next to `src/` and is emitted
beside the code in a build (see `apps/api/vite.config.ts`, which copies it). It
no longer has a broker entry point to keep it company.

## Test fixtures

`test/fixture-mcp-server.ts` and its siblings all install
`process.stdout.on("error", () => {})`. A cancelled `load-mcp` job kills the
fixture mid-write — the parent tears down the stdio pipe while a response is in
flight — and without the handler the resulting EPIPE is an unhandled `error`
event that crashes the process and dumps a stack trace onto inherited stderr.

`LISPTC_FIXTURE_DELAY_MS` adds a startup delay so async-job tests can
deterministically observe a `load-mcp` job in `:pending`.

`fixture-empty-mcp-server.ts` uses the low-level `Server` rather than
`McpServer`, because the high-level one only advertises the tools capability once
at least one tool is registered — and the whole point of that fixture is to
advertise it with none.

The concurrency test asserts on the two jobs' **states** rather than on elapsed
time. An earlier wall-clock version compared a two-load run against a single-load
baseline and flaked whenever CPU contention made two simultaneous node spawns
cost more than the one the baseline measured.

Tests that touch MCP drive the interpreter with `runAsync` (or `evAsync` from
`test/helpers.ts`); `runSync` raises `cannot suspend` the moment a tool call
needs the loop.
