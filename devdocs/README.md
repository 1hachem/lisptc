# Developer docs

Design notes and setup guides for lisptc internals. Kept out of the source so the
code comments stay short and point here for the detail.

## Contents

- [OAuth 2.1 for remote MCP servers](./oauth.md) — how `load-mcp` authenticates
  OAuth servers (Linear): flow, callback strategies, token storage, cloud/ingress
  config.
- [Secret registry](./secrets.md) — the `REPL_*` secret store, taint-tracked
  redaction, and how secrets reach MCP calls.
- [Agent traces and feedback](./telemetry.md) — the PostHog event shape for a
  chat turn, the `▲`/`▼` vote on an assistant turn, the first-party proxy the
  browser half talks to, identity, and the privacy switch.
- [Context compression](./compression.md) — naming every REPL result, the word
  cap on what gets printed, and the `view`/`head`/`tail`/`grep` built-ins that
  read the rest.
- [Generative UI](./generative-ui.md) — `ui/render`, why a handler is an opaque
  id rather than code, the three ways a widget acts, and what was deliberately
  left out (charts, self-refreshing queries, full reactive state).
- [The lisptc LSP's static analysis](./lsp.md) — module layout, the shared
  tokenizer grammar vs. the interpreter's `Reader`, and how `load-mcp`'s args
  reach the LSP from the interpreter.
