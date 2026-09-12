# Where an MCP server runs (`McpRuntime`)

Connecting to an MCP server and *running* one are two jobs. Until this seam
existed they were one function: `openClient` read a `ConnConfig`, and if the
entry carried both a `url` and a `command` it spawned the child itself, on this
machine, before dialling. A toolkit entry therefore said two things at once —
what the server is, and where it lives — and there was no way to answer the
second differently.

`src/mcp-runtime.ts` splits them.

```
ServerSpec   what the server is        (from mcp.toolkit.json, or load-mcp's keywords)
McpRuntime   where it runs             (the port: start / stop / stopAll)
Endpoint     how to reach it once up   (what the transport layer consumes)
```

`registerMcp` takes a `runtime` and defaults to `localRuntime()`, so nothing
changes for a terminal REPL. A host that runs servers elsewhere — a cluster, a
sandbox, a pool of pre-warmed containers — passes its own implementation and
touches nothing else:

```ts
mcpExtension({ runtime: kubernetesRuntime(cfg), sessionId: threadId })
```

## The three types, and the invariant between them

A `ServerSpec` has two origins. `remote` is a server already running somewhere
(`linear`, `notion`): there is nothing to start. `program` is a server we are
responsible for running (`playwright`, `fs`, `sheets`, `ocr`), and it may carry a
`url`, which means "it speaks HTTP at this address once it is up" rather than
stdio.

An `Endpoint` has two transports, `stdio` and `http`, and the invariant is:

> **Only a local runtime may return a `stdio` endpoint.**

Nothing about stdio survives a network hop. A runtime that places servers
anywhere but this machine has to expose them over HTTP, which for a `program`
spec means wrapping the command in a gateway process (supergateway is the
obvious one: `--stdio "<command args>" --baseUrl http://0.0.0.0:<port>`). That
translation belongs to the runtime, which is what lets the toolkit's stdio
entries deploy unchanged.

`openClient` now branches on `endpoint.transport` and never sees a spec. That is
the whole point: the transport layer stopped knowing how servers get started.

## Identity, not handles

`start` takes an `Instance` — `{ sessionId, server }` — beside the spec, and
`stop`/`stopAll` take nothing else. The local runtime uses it as a map key; a
remote runtime should derive every resource name it creates from it, so that:

- starting the same instance twice is idempotent (the second call finds the
  existing workload instead of making a second one),
- an endpoint can be *computed* rather than looked up, which is what makes the
  runtime survive a process restart — the map of children in `localRuntime` is
  exactly the state a remote adapter must not need,
- one session's servers can be torn down together (`stopAll`), which is what
  `mcp-shutdown` and the `dispose` hook call.

`sessionId` defaults to `DEFAULT_SESSION`. `packages/ai` keeps one `AgentRepl`
per chat `thread_id`, so that is the id to pass when a host wants a chat's
servers isolated from another chat's.

## What stayed in the local runtime

All of it is behaviour worth keeping, and none of it is transport:

- **Reachability decides, not bookkeeping.** A `HEAD` on the url's origin (2s) is
  the only test before spawning, so a server already started by hand (`task
  mcp:sheets`) is reused and two REPLs do not fight over port 8911.
- **The child's stderr is captured, never inherited**, and its tail is appended
  to the error when the server dies before its port answers. A detached child
  holding the parent's stderr looks like a hung REPL; and without the tail, a
  server that dies at startup surfaces only `MCP error -32000: Connection
  closed`.
- **`detached: true`** so the whole `task` → `infisical-run` → `pnpm` → `node`
  tree dies with one `kill(-pid)`.
- **60s to answer**, which is what a cold `infisical-run` plus `pnpm` plus a
  fastmcp boot needs.

`localRuntime()` returns a **process-wide singleton**. `MemoryRepl.reset()`
builds a fresh extension roster, so a per-extension runtime would orphan the
children the previous interp started; the singleton keeps `reset()` reusing (and
able to kill) the same servers, which is what the old module-scoped `started` map
did. `createLocalRuntime()` makes an isolated one, which is what the tests use.

## What a remote adapter still has to solve

These are the four things the local path gets for free and a cluster does not.
None is fixed here; all of them are load-bearing.

- **`(await load-mcp-1)` will time out on a cold start.** `AWAIT_TIMEOUT_MS` is
  50s (`src/promises.ts`), while the local start deadline alone is 60s, and an
  image pull plus a scale-from-zero exceeds both. Either the runtime keeps
  instances warm, or that budget needs raising for a connect.
- **Secrets must not travel as arguments.** `expandEnv` substitutes `${VAR}` into
  a toolkit entry's `args` at parse time (`src/mcp.ts`). In a pod spec those args
  are readable by anyone who can read the manifest, so a remote runtime has to
  move them into the spec's `env` and project them as a secret object.
- **`resolveBundled` is local by construction.** A toolkit `args` entry beginning
  `./` resolves against `mcp.toolkit.json`'s own directory, which no remote
  machine shares. `ocr` either ships as an image or its spec must be rejected by
  a runtime that cannot reach the file.
- **The OAuth callback binds a loopback port.** `redirectUri()` defaults to
  `http://127.0.0.1:<port>/callback`, captured by one shared callback server in
  this process. A hosted deployment has to point `LISPTC_OAUTH_REDIRECT_URL` at
  an address the provider can actually redirect to (see [oauth.md](./oauth.md)).

## The seam below this one

`options.dispatch` is still there and still the *mocking* seam: it replaces the
whole `McpOp` surface, which is what `packages/evals` uses to answer a connect
with a canned tool list. The runtime sits one layer below it, inside the real
dispatch. Injecting a runtime gives you a real MCP client against a server you
placed; injecting a dispatch gives you no client at all.

One consequence of `createMcpDispatch`: the `clients` map is now per-dispatch,
so each interp owns the SDK clients it opened rather than sharing one process map
(the OAuth callback server and the token store are still process-wide, since a
port and a file are). Nothing exchanged `serverId`s across interps, so this only
tightens isolation.
