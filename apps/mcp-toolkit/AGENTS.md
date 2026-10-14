# @lisptc/mcp-toolkit

The MCP servers we write ourselves, pointing outward. Built on `fastmcp`.

Turbo tag: `product`.

## Shape

One directory per server, each the same two files: `server.ts` declares the
tools, `api.ts` talks to the service. `src/sheets/` is the Google Sheets server,
`src/ocr/` the document reader. `src/google-auth.ts` takes the Google access
token a request carries and calls Google with it.

**A server here runs no OAuth of its own.** The REPL's MCP client signs the
user in, Convex keeps the tokens, and every request arrives with the access
token as its bearer. A server reads it off the request and holds no client
secret, no token store and no public URL.

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
