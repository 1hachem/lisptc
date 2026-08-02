# Developer docs

Design notes and setup guides for lisptc internals. Kept out of the source so the
code comments stay short and point here for the detail.

## Contents

- [OAuth 2.1 for remote MCP servers](./oauth.md) — how `load-mcp` authenticates
  OAuth servers (Linear): flow, callback strategies, token storage, cloud/ingress
  config.
- [Secret registry](./secrets.md) — the `REPL_*` secret store, taint-tracked
  redaction, and how secrets reach MCP calls.
