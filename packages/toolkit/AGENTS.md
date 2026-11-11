# @repo/toolkit

The bundled MCP toolkit: the servers `load-mcp` can start by name. The MCP
extension connects to them.

Turbo tag: `static`.

## Shape

Three manifests, one per place a server runs, each a typed module in `src/`.
`mcp.toolkit.ts` is the bundled one, `mcp.toolkit.dev.ts` the one a REPL on a
developer's machine runs, `mcp.toolkit.local.ts` the one the user's own machine
runs. `src/entry.ts` is the shape every entry takes, and each manifest is typed
by the narrowest one its place can run. The MCP extension reads the entries and
adds what only a running server carries.

## Rules

This package is data. **A `static` package depends on a `foundation` package
at most**, and any package or app may depend on it. It reaches nothing at
runtime, so it loads in the browser.

**A relative path in an entry is written for the package root**, the
`TOOLKIT_ROOT` `src/toolkit.ts` exports, so do not move the package to another
depth under the repository root.

**A rule about what an entry may hold is written as a type.** Narrow the
manifest's entry type, or add a case to the toolkit's test, rather than a line
here.
