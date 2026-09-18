# @lisptc/mcp-repl

An MCP server exposing the REPL to an MCP client. Ships as the
`lisptc-mcp-repl` binary.

Turbo tag: `product`.

## Shape

Two files. `src/server.ts` declares the tools and speaks the protocol.
`src/repl.ts` builds the REPL they run against.

The tools are the whole surface: evaluate source in a REPL that persists across
calls, reset that REPL to a fresh prelude, and check source for syntax errors
without evaluating it. Read their exact names in `src/server.ts`.

## Rules

The REPL is persistent, so state a client left behind is still there on the next
call. Reset is a tool for that reason, and a change that makes evaluation
stateless breaks the point of this server.

A tool's description is what a model reads before calling it. Treat it as part
of the interface, and change it with the same care as a signature.

This app names extensions because it builds a REPL, which is what the REPL layer
is allowed to do. Nothing above a REPL may.
