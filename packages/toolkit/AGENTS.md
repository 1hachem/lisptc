# @repo/toolkit

The bundled MCP toolkit: the servers `load-mcp` can start by name. The MCP
extension connects to them; the chat input and the language server only list
them.

Turbo tag: `static`.

## Shape

`mcp.toolkit.json` is the manifest. `src/toolkit.ts` exports where it lives and
the name and description of each entry. The connection fields are the MCP
extension's to read, and the types that describe them are in its `ports.ts`.

## Rules

This package is data. **A `static` package depends on a `foundation` package
at most**: the tag denies every other tag in `pnpm boundaries`, and
`check:arch` finds every package carrying it and refuses any other dependency
in its manifest. Any package or app may depend on it. It reaches nothing at
runtime, so it loads in the browser.

A relative path in an entry's `args` resolves against the manifest's own
location, so the file keeps its depth under the repository root. The app copies
it beside its server bundle; `apps/app/runtime-assets.ts` names it.
