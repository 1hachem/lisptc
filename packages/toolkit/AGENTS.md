# @repo/toolkit

The bundled MCP toolkit: the servers `load-mcp` can start by name. The MCP
extension connects to them.

Turbo tag: `static`.

## Shape

`mcp.toolkit.json` is the manifest. `src/toolkit.ts` exports where it lives.
The connection fields are the MCP extension's to read, and the types that
describe them are in its `ports.ts`.

## Rules

This package is data. **A `static` package depends on a `foundation` package
at most**, and any package or app may depend on it. It reaches nothing at
runtime, so it loads in the browser.

**Do not move `mcp.toolkit.json` to another depth under the repository root.**
A relative path in an entry is written for where the manifest sits.
