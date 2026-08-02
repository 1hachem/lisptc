# OAuth 2.1 for remote MCP servers

Remote MCP servers (e.g. Linear) authenticate with OAuth 2.1 — PKCE, dynamic
client registration (DCR), and metadata discovery. The MCP SDK implements the
whole protocol; lisptc only supplies **token persistence** and **redirect
capture**. Code lives in `src/mcp-oauth.ts` (provider + storage + callback) and
`src/mcp-broker.ts` (`connect` / `authorize`).

## Marking a server as OAuth

In `mcp.toolkit.json`, an HTTP server opts in with `oauth` and optional `scopes`:

```json
{ "name": "linear", "url": "https://mcp.linear.app/mcp", "oauth": true, "scopes": ["read", "write"] }
```

`scopes` become the space-separated `scope` on the authorization request. No
`client_id`/secret is needed — DCR registers a client on the fly.

## Flow from the REPL

```lisp
(await (load-mcp "linear"))
;=> authorization required for "linear": open https://mcp.linear.app/authorize?…
;   — after approving it will be captured automatically — then run (load-mcp "linear") again
```

1. **connect** attaches a `StoredOAuthProvider` to the transport. A stored token
   connects directly (refreshed silently via the refresh token). With no usable
   token the SDK runs discovery + DCR + PKCE, saves the PKCE verifier, captures
   the authorization URL, and throws `UnauthorizedError`.
2. The broker surfaces the URL (a `NeedsAuthError` whose message carries it) and,
   in **local mode**, starts the loopback callback server.
3. The user approves in a browser and is redirected to the callback with `?code`.
4. The code is exchanged for tokens (`auth(provider, { authorizationCode })`),
   which are saved. A subsequent `(load-mcp "linear")` connects; `linear/*` tools
   bind.
5. **Later sessions** reconnect silently from the stored refresh token.

The code exchange is a **separate step** from the authorization request; they are
bridged by the persisted PKCE verifier + client registration, so no live
transport has to stay open. This is what lets the code arrive by loopback, manual
paste, or a cloud ingress.

## Callback strategies (`AuthCallback`)

Swappable, chosen by `createAuthCallback()`:

- **Loopback** (default, local): a transient HTTP server on `127.0.0.1:<port>`
  (fixed, default `8909`) that auto-captures the redirect. Only reachable from a
  browser on the same machine; shut down once the code arrives.
- **External** (cloud): set `LISPTC_OAUTH_REDIRECT_URL` to a real callback URL
  (your Kubernetes ingress). No local server; the ingress handler — or the user
  via `(mcp-authorize "server" "<code>")` — delivers the code.

### Manual fallback

`(mcp-authorize "server" "<code>")` completes the exchange with a code obtained
out-of-band. Used for headless/remote sessions and the external strategy.

## Storage (`OAuthStore`)

Persistence is behind the `OAuthStore` interface (async `load`/`save`/`clear`,
keyed by server origin) so the backing store is swappable.

- **`FileOAuthStore`** (default): one JSON file per server under
  `$LISPTC_OAUTH_DIR` → `$XDG_CONFIG_HOME/lisptc/oauth` → `~/.config/lisptc/oauth`
  (dir `0700`, files `0600`). E.g. `~/.config/lisptc/oauth/https___mcp.linear.app.json`,
  holding `clientInformation`, `codeVerifier`, and (after approval) `tokens`.
- **Database**: implement `OAuthStore` and change the single
  `const oauthStore = new FileOAuthStore()` line in `src/mcp-broker.ts`.

Reset a server's OAuth by deleting its file.

## Configuration

| Env var | Purpose | Default |
| --- | --- | --- |
| `LISPTC_OAUTH_REDIRECT_URL` | Public callback URL → external (cloud) mode | unset → loopback |
| `LISPTC_OAUTH_CALLBACK_PORT` | Loopback port (must match the registered redirect) | `8909` |
| `LISPTC_OAUTH_DIR` | Token store directory | XDG config dir |

## Notes & gotchas

- **Redirect URI must stay stable.** A DCR registration pins the redirect URI it
  was created with. If it changes (host/port), the authorization request is
  rejected with *"invalid redirect URI"*. `connect` self-heals by dropping a
  stored registration whose `redirect_uris` don't include the current one, so the
  SDK re-registers.
- **Callback page** is served as `text/html; charset=utf-8` (otherwise the em-dash
  renders as mojibake).
- **Loopback is same-machine only.** For SSH/remote, either port-forward the
  callback port or use the external strategy + `mcp-authorize`.
