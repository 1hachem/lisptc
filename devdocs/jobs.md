# The async jobs runtime, and MCP on top of it

The interpreter is fully synchronous. This layer is how it (a) makes a blocking
call into async work and (b) starts background jobs it can await, poll or cancel.
It is deliberately domain-agnostic: `jobs.ts` and `jobs-broker.ts` know nothing
about MCP. MCP is a *consumer*.

```
main thread                          worker thread
src/jobs.ts      ── SharedArrayBuffer ──  src/jobs-broker.ts   (generic scheduler)
src/mcp.ts       ── postMessage      ──  src/mcp-broker.ts    (domain dispatch)
                    src/jobs-protocol.ts  (shared wire constants)
```

## Why a worker at all

A single Node thread cannot block on its own event loop without deadlocking. So
all async work happens on a separate thread with its own event loop; the main
thread posts a request and blocks on `Atomics.wait`, and the worker writes the
reply back into shared memory and calls `Atomics.notify`.

`jobs-protocol.ts` is the single source of truth for reply states, buffer sizes,
timeouts and message shapes, and is kept **import-free** so the worker can use it
without dragging in the interpreter.

A reply too large for the 1 MiB inline buffer **spills** to a temp file
(`STATE_SPILL`); the length field is repurposed as the path's byte length.

Timeouts: `DEFAULT_TIMEOUT_MS` (30s) per blocking call, `AWAIT_TIMEOUT_MS` (50s)
for `(await …)`. A non-finite `await` timeout is rejected, because it would make
`Atomics.wait` block forever.

## Job lifecycle

A producer starts a job with `runtime.start(op, payload)` and gets back a `Job`
handle (tracked via `jobs.track`). Results apply through a **finalizer**, by two
paths:

1. **push** — when a job settles the worker `postMessage`s a `job-settled` event
   that `Jobs` applies as soon as the main thread's event loop next turns. So an
   effect appears **automatically between evals, with no explicit await**.
2. **`(await job)`** — blocks on the `Atomics.wait` bridge and applies the
   finalizer synchronously.

The two are idempotent via `Job.finalized`. Because the push is delivered by the
event loop, a purely synchronous embedder that never yields between evals must
use `await`.

`Jobs.live` holds only jobs still running: a settled job is reaped when collected.

`(cancel job)` calls `AbortController.abort()`, wired into the op's `signal`, so
it aborts the in-flight request rather than merely forgetting about it.

## Two error-message traps, same shape

Both `request()`'s error path and `collectSettled` bind the handler variable to
the **actual error text**, so `(try … (catch (e) …))` gets something meaningful —
not `op` (an internal op-code like `"call-tool"`) and not `job.label`, neither of
which a `catch` could act on. `await-all` matches, collecting a failure as
`(:error "message")` in place so it never discards its succeeded siblings.

In the worker, a job's promise is tagged as a **never-rejecting** `Settled`
outcome, so a failing job cannot reject a combinator (`await-all` /
`await-any`), and `.then` absorbs rejections so a never-awaited failure never
becomes an `unhandledRejection`.

## `JobsRuntime` is the swappable transport

The bundled `WorkerJobsRuntime` offloads to a `worker_threads` worker. A
different backend — a Redis-backed queue, say — can implement the same interface
without touching the built-ins or the domain layer. The worker is `unref`'d so it
cannot hold the process open on its own.

A concrete worker supplies a `dispatch(op, payload, signal)` and calls
`runWorker(dispatch)`. The scheduler handles the meta-ops
(`start`/`await`/`await-all`/`await-any`/`job-status`/`cancel`) and forwards
everything else. `Op` is the domain's own union so its dispatch keeps a typed,
exhaustively-checked switch; the scheduler does the single cast from the raw wire
string at the boundary, and an unknown op still reaches the `default` and throws.

## MCP specifics

### The broker is a sibling file, always

`src/mcp.ts` finds it by `new URL("./mcp-broker.<ext>", import.meta.url)`. A
worker is a second entry point by definition, so it can never be folded into a
bundle — it is always a sibling, under whichever extension `mcp.ts` itself has
(`.ts` when node runs the source, `.js` after a build). The same is true of
`mcp.toolkit.json`, which sits at the package root next to `src/` and is emitted
beside the code in a build. See `apps/api/vite.config.ts`, which copies both.

### A tool-less connect is a load failure

A server that handshakes but exposes zero tools is useless to lisptc, whose MCP
integration is tools-only — and that is the common shape of a degraded,
unauthenticated or wrong-URL connection, which returns an empty list rather than
erroring. It is reported as `:error`, not a misleading `:loaded` server with no
tools.

### A tool result reaches Lisp as data

The broker prefers `structuredContent`, but most servers put their JSON in a text
block instead. `asJsonDocument` parses an all-text result **only when it is a
JSON object or array**: an object becomes an alist the agent can `assoc`, and the
REPL reports its keys rather than a word count.

Only objects and arrays. A tool that answered `42`, `null` or `"ok"` meant text,
and parsing those would replace its answer with a number, nil or a re-quoted
string.

### `load-mcp` is async, tool calls are not

`load-mcp` returns a `Job` immediately and does not block; `(await job)` installs
the server's `<server>/<tool>` bindings and returns the tool list. Tool calls
themselves stay synchronous `runtime.call`s — the job infrastructure is generic,
so they could opt in later.

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

Without the `dispose` hook, a REPL `reset()` stranded the broker worker it had
spun up — one leaked per reset.

### `${VAR}` in the toolkit expands against `process.env`

So the bundled config can point at environment-provided paths (the Nix-built
browser, say) without hardcoding machine-specific store paths. Unset vars expand
to the empty string, and a malformed config entry is ignored rather than crashing
interpreter startup.

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
