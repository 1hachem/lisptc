# Promises, and MCP on top of them

The evaluator suspends rather than blocks (see
[interpreter.md](./interpreter.md)), so async work runs on Node's own event
loop. This layer is how the language (a) makes a call into async work that reads
as ordinary and (b) hands back a value standing for work still running. It is
deliberately domain-agnostic: `promises.ts` knows nothing about MCP. MCP is a
*consumer*.

```
src/promises.ts    Dispatch + Promises (the built-ins, and what a promise cannot say)
src/mcp.ts         the MCP built-ins, and the finalizer that installs tool bindings
src/mcp-client.ts  the domain dispatch: connect, call-tool, login, ...
src/mcp-runtime.ts where a server runs: the McpRuntime port and the local one
```

## The value is the host's promise

There is no wrapper. `(load-mcp "acme")` returns the same `Promise` object the
MCP client produced, and everything the agent can do to it is what the host
runtime already does:

| Lisp | host |
| --- | --- |
| `(await p)` | `await p` |
| `(promise-all ps)` | `Promise.all` |
| `(promise-all-settled ps)` | `Promise.allSettled` |
| `(promise-any ps)` | `Promise.any` |
| `(promise-race ps)` | `Promise.race` |

That is not just tidiness. Three behaviours the old job layer implemented by hand
are now the runtime's own: a promise settles **once** and keeps its result, so
awaiting twice returns the same value with no `finalized` flag or result cache; a
finalizer attached with `.then` runs **exactly once** whether or not anyone
awaits, which is what installs a server's tool bindings in the background; and
awaiting a settled promise costs a microtask rather than a lookup through an id
map. The map, the `jobId`, the `collect`/`track` bookkeeping and the
`JobsRuntime` indirection all existed to carry a promise across a worker
boundary that no longer exists.

`Dispatch` is what remains of that indirection, and it is the extension point: a
different backend (a Redis-backed queue, say) is a different `Dispatch`, not a
different runtime class.

## What a promise cannot tell you

Two things, and they are the only state this module keeps: a `WeakMap` from
promise to `{ state, controller }`.

**State.** A JS promise cannot be asked synchronously whether it has settled, and
`(promise-state p)` must not block — an agent polls it precisely to avoid
waiting. So the same `.then` that tracks settling records `pending` →
`fulfilled` / `rejected`. The keyword names are the spec's, not ours.

**Cancellation.** A promise is not cancellable; an `AbortController` is what the
host offers, and the signal is already wired into every dispatch op. `(cancel p)`
aborts that, and the promise then **rejects** — which is the honest outcome, and
better than the old `no such job` that came from deleting a map entry. A promise
built by `promise-all` and friends has no controller of its own, so `cancel`
returns nil there rather than pretending.

The `WeakMap` also means a promise the agent drops is collectable; the `live`
`Set` beside it holds only what is still pending, so `(promises)` can list it and
`shutdown` can abort it, and the settling `.then` removes it.

## Absorbing rejections is not optional

Node kills the process on an unhandled rejection. A promise the agent starts and
never awaits is the normal case here — that is the whole point of `load-mcp`
returning immediately — so the state-tracking `.then` doubles as the absorber: it
attaches an `onRejected` at creation, which is why a load that fails while the
agent is doing something else marks itself `:rejected` instead of taking the host
down.

## Two kinds of builtin, because a promise is a value now

The evaluator's rule (see [interpreter.md](./interpreter.md)) is that a `Promise`
returned from a builtin is yielded, not returned. That makes an MCP tool call
read as ordinary code. But it cannot hold for a builtin whose promise **is** the
answer, so the kind is declared at definition:

- `interp.def` — plain. A returned promise suspends the evaluator. Tool bindings,
  `login`, `logout`, `mcp-authorize`, and `await` itself (which just returns the
  promise it was handed, timeout applied).
- `interp.defPromise` — the returned promise is the value. `load-mcp` and the
  four combinators.
- `interp.defGen` — the body is a generator and yields for itself.

So `(load-mcp …)` does not suspend at all, and a synchronous host can start
background work with `runSync` and read `(promise-state …)` on it.

### An async driver flattens the value it returns

`runAsync` returns `Promise<Outcome>`, a box, and not the value itself. This is
not defensive style: `async function f() { return p }` **awaits** `p`, because a
promise cannot be resolved with a promise. With a bare `Promise<unknown>` return
type, a step ending in `(load-mcp "acme")` waited for the connect before the
REPL returned, silently breaking the one contract `load-mcp` has. The box is the
only way an async driver can hand back a promise as a value.

## Timeouts are policy, not a deadlock guard

`DEFAULT_TIMEOUT_MS` (30s) and `AWAIT_TIMEOUT_MS` (50s) used to exist because
`Atomics.wait` with no bound would hang a thread forever. Nothing hangs now: they
stay only so one agent turn cannot wait on a dead server without end, and
`(await p ms)` lets the agent choose. A non-finite timeout is rejected.
`withTimeout` races against a timer it unrefs, so a pending deadline cannot hold
the process open by itself, and a timeout leaves the promise itself pending and
awaitable — as racing does.

## MCP specifics

### A tool-less connect is a load failure

A server that handshakes but exposes zero tools is useless to lisptc, whose MCP
integration is tools-only — and that is the common shape of a degraded,
unauthenticated or wrong-URL connection, which returns an empty list rather than
erroring. It is reported as a rejection, not a misleading loaded server with no
tools.

### A tool result reaches Lisp as data

`mcp-client.ts` prefers `structuredContent`, but most servers put their JSON in a
text block instead. `asJsonDocument` parses an all-text result **only when it is
a JSON object or array**: an object becomes an alist the agent can `assoc`, and
the REPL reports its keys rather than a word count.

Only objects and arrays. A tool that answered `42`, `null` or `"ok"` meant text,
and parsing those would replace its answer with a number, nil or a re-quoted
string.

### What the client module shares between interps

The shared OAuth callback server and the token store live in `mcp-client.ts`
module scope, so **every interp in a process shares them** — a port and a file
can only be held once. The `clients` map is not shared: `createMcpDispatch`
closes over its own, so an interp owns the SDK clients it opened and releases
them on `dispose`. Nothing passes a `serverId` between interps, so that map was
never a channel between them.

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

**Shutdown has to close the clients, and it did not used to.** Under the worker,
shutting the runtime down was `worker.terminate()`, and killing the thread took
every SDK client and every stdio child process with it. On the main thread there
is no thread to kill: aborting a controller does nothing to a client that already
connected. So `shutdown()` disconnects each of *this interp's* servers by hand,
and `connect` closes its client if anything after `new Client` throws (an abort
included), which is what releases a child spawned by a connect that was
cancelled.

It closes this interp's servers, never the whole `clients` map, because that map
is process-wide: clearing it would kill another interp's servers.

The symptom is worth recognising, because nothing fails: every test passes, and
the host process simply never exits. `test/shutdown-exit.test.ts` is the guard,
spawning a host that loads a server and asserting it exits on its own.

### `${VAR}` in the toolkit expands against `process.env`

So the bundled config can point at environment-provided paths (the Nix-built
browser, say) without hardcoding machine-specific store paths. Unset vars expand
to the empty string, and a malformed config entry is ignored rather than crashing
interpreter startup.

`mcp.toolkit.json` still sits at the package root next to `src/` and is emitted
beside the code in a build (see `apps/api/vite.config.ts`, which copies it).

## Test fixtures

`test/fixture-mcp-server.ts` and its siblings all install
`process.stdout.on("error", () => {})`. A cancelled load kills the fixture
mid-write — the parent tears down the stdio pipe while a response is in flight —
and without the handler the resulting EPIPE is an unhandled `error` event that
crashes the process and dumps a stack trace onto inherited stderr.

`LISPTC_FIXTURE_DELAY_MS` adds a startup delay so tests can deterministically
observe a load in `:pending`.

`fixture-empty-mcp-server.ts` uses the low-level `Server` rather than
`McpServer`, because the high-level one only advertises the tools capability once
at least one tool is registered — and the whole point of that fixture is to
advertise it with none.

The concurrency test asserts on the two promises' **states** rather than on
elapsed time. An earlier wall-clock version compared a two-load run against a
single-load baseline and flaked whenever CPU contention made two simultaneous
node spawns cost more than the one the baseline measured.

Tests that touch MCP drive the interpreter with `runAsync` (or `evAsync` from
`test/helpers.ts`); `runSync` raises `cannot suspend` the moment a tool call
needs the loop. Starting a load is the exception, since it does not suspend.
