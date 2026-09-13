# Async work: the core, the promises extension, and MCP

The evaluator suspends rather than blocks (see
[interpreter.md](./interpreter.md)), so async work runs on Node's own event
loop. This layer is how the language (a) makes a call into async work that reads
as ordinary and (b) hands back a value standing for work still running.

Four files in two packages, and they come apart cleanly:

```
@repo/interpreter src/async.ts       AsyncWork: what a promise cannot say, and withTimeout (core, always on)
@repo/interpreter src/promises.ts    promisesExtension(): await, the combinators, promise-state, promises, cancel
@repo/mcp         src/mcp.ts         the MCP built-ins, and the finalizer that installs tool bindings
@repo/mcp         src/mcp-client.ts  McpClient: connect, call-tool, login, ...
```

`mcp.ts` imports the client and `withTimeout`, and nothing at all from
`promises.ts`. It starts its connect with `interp.async.start` and declares
`load-mcp` with `interp.defPromise`, the same two things any other extension
would use. Nothing in MCP knows whether `await` exists.

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

That is not just tidiness. Three behaviours come free with the runtime's own
type: a promise settles **once** and keeps its result, so awaiting twice returns
the same value with no result cache to keep; a finalizer attached with `.then`
runs **exactly once** whether or not anyone awaits, which is what installs a
server's tool bindings in the background; and awaiting a settled promise costs a
microtask rather than a lookup through an id map. Any wrapper would have to
reimplement all three, and it would only be worth it to carry a promise across a
thread boundary. There is none: the evaluator waits on this thread.

## The bookkeeping is the core's, because it cannot be optional

`Interp.async` is an `AsyncWork`, and it exists on every interp whether or not a
single extension is installed. Two of the three things it does are obligations
rather than features:

- **Absorbing rejections.** Node kills the process on an unhandled rejection, and
  a promise the agent starts and never awaits is the normal case here. That is
  the whole point of `load-mcp` returning immediately. An extension that could
  take the host down when the language it shipped with is composed differently is
  not an extension.
- **Releasing work on the way out.** `interp.dispose()` aborts everything still
  pending, so a host dropping an interp does not strand a connect. That is the
  base of the `dispose` hook chain, under whatever the extensions register.

The third is `stateOf`, which the extension reads. `AsyncWork` keeps a `WeakMap`
from promise to `{ state, controller }` and a `live` `Set` beside it holding only
what is still pending, so a promise the agent drops is collectable.

A builtin reaches it two ways. `interp.async.start(run)` mints an
`AbortController`, hands the signal to `run` and tracks the promise it returns.
That is what makes the work cancellable, so MCP wraps its whole
`connect().then(install)` chain in one `start` and the controller belongs to the
promise the agent holds. Everything else is tracked where it is returned: the
evaluator watches any promise a `defPromise` builtin hands back, so the
combinators, and a builtin written by someone who never read this page, are
absorbed and observable for free.

## The extension is the language, not the plumbing

`promisesExtension()` installs `await`, `promise-all`, `promise-all-settled`,
`promise-any`, `promise-race`, `promise-state`, `promises` and `cancel`, each a
thin reading of `interp.async` or of the host combinator of the same name. It
holds no state of its own.

An interp without it still runs async work. `(load-mcp "acme")` starts the
connect, installs the bindings when it lands, and a synchronous host can drive it
with `runSync`; what the agent loses is any way to *talk* about a promise.
Every model-facing host lists it, so each of them has the full language, and
`test/mcp.test.ts` pins the other half: MCP alone is enough to load a server and
call its tools.

## A feature brings its own port

There is no shared async entry point to route a call through. A feature that
wants async work defines its own built-ins and talks to the world through a port
of its own shape: MCP's is `McpClient` (`connect`, `callTool`, `disconnect`,
`login`, `logout`, `authorize`), whose arguments are the real types rather than
an op name and an `unknown` payload.

That is what a host swaps to replace the world: `mcpExtension({ client })`.
`packages/evals` does it twice over, a mock client wrapped by a recording one.
A generic `(op, payload, signal)` seam would buy a `switch` and a cast at both
ends, and would tempt the next async feature into sharing one set of promise
built-ins with MCP.

## What a promise cannot tell you

Two things, and they are the only state `AsyncWork` keeps.

**State.** A JS promise cannot be asked synchronously whether it has settled, and
`(promise-state p)` must not block, since an agent polls it precisely to avoid
waiting. So the same `.then` that tracks settling records `pending` →
`fulfilled` / `rejected`. The keyword names are the spec's, not ours.

**Cancellation.** A promise is not cancellable; an `AbortController` is what the
host offers, and `interp.async.start` is what ties one to a promise. `(cancel p)`
aborts it and the promise then **rejects**, which is the honest outcome: the work
stopped, and anyone awaiting it hears so. A promise built by `promise-all` and
friends is only watched, never started, so it has no controller of its own and
`cancel` returns nil there rather than pretending.

`(mcp-shutdown)` cancels the loads MCP itself started, which is why `mcp.ts`
keeps the set of them: aborting *everything* pending would reach work that was
never its own.

## Two kinds of builtin, because a promise is a value

The evaluator's rule (see [interpreter.md](./interpreter.md)) is that a `Promise`
returned from a builtin is yielded, not returned. That makes an MCP tool call
read as ordinary code. But it cannot hold for a builtin whose promise **is** the
answer, so the kind is declared at definition:

- `interp.def` is plain: a returned promise suspends the evaluator. Tool
  bindings, `login`, `logout`, `mcp-authorize`, and `await` itself, which just
  returns the promise it was handed, timeout applied.
- `interp.defPromise` means the returned promise is the value, and the evaluator
  watches it on the way out. `load-mcp` and the four combinators.
- `interp.defGen` means the body is a generator and yields for itself.

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

Nothing blocks the thread, so no timeout here is a deadlock guard.
`CALL_TIMEOUT_MS` (30s, `mcp.ts`) and `AWAIT_TIMEOUT_MS` (50s, `promises.ts`)
exist only so one agent turn cannot wait on a dead server without end, and
`(await p ms)` lets the agent choose. Each sits with the feature whose policy it
is: a tool call's deadline is MCP's business, an `await`'s is the promise
language's. A non-finite timeout is rejected.
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

### The client module is process-wide

`clients`, the shared OAuth callback server and the token store live in
`mcp-client.ts` module scope, so **every interp in a process shares them**. Two
interps loading the same server share nothing but that map, keyed by `serverId`,
so they do not collide; but a test that expects isolation between interps will
not get it.

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

**Shutdown has to close the clients by hand.** There is no thread to kill that
would take the SDK clients and their stdio children with it, and aborting a
controller does nothing to a client that already connected. So `shutdown()`
disconnects each of *this interp's* servers itself, and `connect` closes its
client if anything after `new Client` throws (an abort included), which is what
releases a child spawned by a connect that was cancelled.

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

`mcp.toolkit.json` sits at `@repo/mcp`'s package root next to `src/` and is
emitted beside the code in a build (see `apps/api/vite.config.ts`, which copies
it). The copier resolves each asset through a subpath the package actually
exports — `@repo/interpreter/source` for the two files beside it, and
`@repo/mcp/mcp.toolkit.json` for this one — because neither exports map
publishes `package.json`.

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

The concurrency test asserts on the two promises' **states**, never on elapsed
time. A wall-clock version of it compares a two-load run against a single-load
baseline and flakes whenever CPU contention makes two simultaneous node spawns
cost more than the one the baseline measured.

Tests that touch MCP drive the interpreter with `runAsync` (or `evAsync` from
`test/helpers.ts`); `runSync` raises `cannot suspend` the moment a tool call
needs the loop. Starting a load is the exception, since it does not suspend.
