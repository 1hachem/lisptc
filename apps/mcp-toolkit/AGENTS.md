# @lisptc/mcp-toolkit

The MCP servers we write ourselves, pointing outward. Built on `fastmcp`.

Turbo tag: `product`.

## Shape

One directory per server, each the same two files: `server.ts` declares the
tools, `api.ts` talks to the service. `src/sheets/` is the Google Sheets server,
`src/ocr/` the document reader. `src/google-auth.ts` holds the Google
credentials both a server and a script need.

Each server has its own script in `package.json`. There is no shared binary.

## Rules

A server here points outward, at somebody else's API. The tool names are the
interface a model sees, so they read as actions and stay stable once used.

Credentials and endpoints come from `@repo/env/mcps/*`, declared per server.
Nothing here reads `process.env`.

A tool validates its arguments with a schema at the boundary and returns a
failure the model can act on. A stack trace is not an answer.

Adding a server means adding a directory, its env module, and a script. It does
not mean adding a branch to an existing server.
