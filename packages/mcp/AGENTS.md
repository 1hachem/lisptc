# @repo/mcp

The MCP extension. It carries `@modelcontextprotocol/sdk` so the interpreter
never has to, which is a rule `pnpm check:arch` enforces on the interpreter's
manifest.

Turbo tag: `extension`.

## Shape

`src/mcp.ts` is the extension. It declares `McpExtensionHost` and exports
`mcpExtension`, which takes that host and contributes a `prompt`.
`src/mcp-host.ts` holds the implementations and the host value a root passes in.
`src/mcp.ptc` is the prompt, written in the dialect.

`src/ports.ts` is the contract layer: the client, host, registry and store
interfaces, and the tool and connection shapes that cross them. A consumer
imports it without pulling in the extension. `src/mcp-client.ts`,
`src/local-host.ts`, `src/docker-host.ts` and `src/mcp-oauth.ts` implement
against it. `src/toolkit.ts` and `mcp.toolkit.json` hold the bundled server
registry.

**Never give a client a callback server of its own.** The OAuth callback server
is one per port for the whole process, shared by every REPL in it, and reached
through `sharedAuthCallback`. A client that binds its own loses the flows the
shared one is holding.

`DockerHost` is the one strategy the extension is handed, and it covers every
modality a toolkit entry can have. Read the modalities off the entry shapes in
`src/toolkit.ts`, not from prose.

**An entry that names an `image` carries a `port` and never a `url`.** The
`port` is the one its server listens on inside the container, because where it
is reachable from outside is the host's to decide, not the manifest's. A `url`
is an address a client dials as written, so only a remote server, or one a
`command` starts on a fixed local port, carries one.

An image built here lives in a Dockerfile under `docker/`;
`task mcp:browser:build` builds the browser one.

`mcpHostFor` defaults to `LocalProcessHost`, so this package needs no daemon to
be used or tested. `DockerHost` is chosen at a composition root instead:
`@repo/backend`'s `agent-repl.ts` and the CLI both pass it. A test that wants
containers has to ask for them.

**`task mcp:reap` clears the containers a dead process left behind.** No host
instance reaps another's, so nothing else will.

`check:arch` treats `src/mcp.ts` and `src/ports.ts` as extension modules. They
import no `node:` builtin, no typed env module, no SDK and no `process.env`.
Everything that touches the world lives in the other files, and `mcp-host.ts`
is where a new outward reach goes.

## Rules

Read the host-port and seam rules in `packages/interpreter/AGENTS.md`. They
govern this package, and the interpreter owns them.

A new MCP capability is a new field on `McpExtensionHost`, or a new interface in
`ports.ts` when something outside the extension has to consume it. Never a
direct import of the SDK into `mcp.ts`.

## Tests

`test/` holds fixture servers beside the tests (`fixture-*.ts`). A test that
needs a server should use one rather than reaching for a real process.

**A test here installs this extension and no other.** A load is asynchronous
without the promises extension installed, so reach for the evaluator's own
async surface rather than that extension's forms. What those forms make of a
load is two extensions at once, and belongs in
`@repo/backend/test/extensions`.
