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

The OAuth callback server is bound once per port for the whole process, not
once per client, and it is reached through `sharedAuthCallback`. Every REPL in
the process shares it and registers its own `state` on it, so a link one REPL
handed out is still answered after another has started. It is keyed on
`globalThis`, so a dev-server module reload rebinds nothing and loses no
pending flow. Never give a client a callback server of its own. Its links
would reach the one that won the port, which has never heard of their `state`.

`DockerHost` is the one strategy the extension is handed, and it covers every
modality a toolkit entry can have. An entry naming an `image` runs as that
image. An entry with a `command` and no `url` is a stdio server, and runs
inside a `supergateway` container that turns its stdio into streamable HTTP.
An entry that already speaks HTTP goes to the `McpHost` it composes over,
which is `LocalProcessHost` by default.

`ensure` takes any `ConnConfig` and returns a handle, or `undefined` when the
client should open stdio itself. A container's port is published on a free
loopback port and the real address comes back on the `ServerHandle`, so a `url`
in the manifest names the port the server listens on inside its own container,
never the one a client dials.

An image built here lives in a Dockerfile under `docker/`;
`task mcp:browser:build` builds the browser one.

`mcpHostFor` defaults to `LocalProcessHost`, so this package needs no daemon to
be used or tested. `DockerHost` is chosen at a composition root instead:
`@repo/backend`'s `agent-repl.ts` and the CLI both pass it. A test that wants
containers has to ask for them.

Every container it starts carries a `lisptc.mcp.host` label naming the host
instance, and `stopAll` reaps that instance's own. A process that dies without
reaching shutdown leaves its containers behind, because no instance may reap
another's; `task mcp:reap` clears whatever is left.

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
