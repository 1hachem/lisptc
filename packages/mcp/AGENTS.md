# @repo/mcp

The MCP extension. It carries `@modelcontextprotocol/sdk` so the interpreter
never has to, which is a rule `pnpm check:arch` enforces on the interpreter's
manifest.

Turbo tag: `extension`.

## Shape

`src/mcp.ts` is the extension. It declares `McpExtensionHost` and exports
`mcpExtension`, which takes that host as a default argument and contributes a
`prompt`. `src/mcp-host.ts` holds the implementations and the default value.
`src/mcp.ptc` is the prompt, written in the dialect.

`src/ports.ts` is the contract layer: the client, host, registry and store
interfaces, and the tool and connection shapes that cross them. A consumer
imports it without pulling in the extension. `src/mcp-client.ts`,
`src/local-host.ts`, `src/docker-host.ts` and `src/mcp-oauth.ts` implement
against it. `src/toolkit.ts` and `mcp.toolkit.json` hold the bundled server
registry.

`src/mcp-oauth.ts` holds the OAuth flow. Never give a client a callback server
of its own: `sharedAuthCallback` hands every caller on a port the one server
that bound it, and `test/mcp-oauth.test.ts` fails if it stops doing that.

`launchFor` in `src/docker-host.ts` decides what a toolkit entry runs as, and
`test/docker-host.test.ts` covers each modality one can have.

`ensure` takes any `ConnConfig` and returns a handle, or `undefined` when the
client should open stdio itself. The `ConnConfig` union in `src/ports.ts` says
which fields an entry may carry, so a container entry cannot name a `url`:
where it is reachable comes back on the `ServerHandle` instead.

An image built here lives in a Dockerfile under `docker/`;
`task mcp:browser:build` builds the browser one.

`mcpHostFor` defaults to `LocalProcessHost`, so this package needs no daemon to
be used or tested. `DockerHost` is chosen at a composition root instead:
`@repo/backend`'s `agent-repl.ts` and the CLI both pass it. A test that wants
containers has to ask for them.

No host instance may reap another's containers, which `hostLabel` and
`strayArgs` in `src/docker-host.ts` hold it to and `test/docker-host.test.ts`
pins. A process that dies without reaching shutdown therefore leaves its
containers behind, and `task mcp:reap` clears whatever is left.

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
