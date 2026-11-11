# @lisptc/mcp-toolkit

The MCP servers we write ourselves, pointing outward. Built on `fastmcp`.

Turbo tag: `product`.

## Shape

One directory per server, each the same two files: `server.ts` declares the
tools, `api.ts` talks to the service. `src/sheets/` is the Google Sheets server,
`src/ocr/` the document reader. `src/google-auth.ts` takes the Google access
token a request carries and calls Google with it.

**A server here runs no OAuth of its own.** Signing a user in is the client's
job, so a server takes the token it is handed and keeps no client secret, no
token store and no public URL.

Each server has its own script in `package.json`. There is no shared binary.

## Rules

A server here points outward, at somebody else's API. The tool names are the
interface a model sees, so they read as actions and stay stable once used.

Credentials and endpoints come from `@repo/env/mcps/*`, declared per server.
Nothing here reads `process.env`.

A tool validates its arguments with a schema at the boundary and returns a
failure the model can act on. A stack trace is not an answer.

Adding a server means adding a directory, its env module, a script, and its
image at `docker/mcp/<name>.Dockerfile`. It does
not mean adding a branch to an existing server.
