# OAuth 2.1 for remote MCP servers

Remote MCP servers (e.g. Linear) authenticate with OAuth 2.1 — PKCE, dynamic
client registration (DCR), and metadata discovery. The MCP SDK implements the
whole protocol; lisptc only supplies **token persistence** and **redirect
capture**. Code lives in `src/mcp-oauth.ts` (provider + storage + callback) and
`src/mcp-broker.ts` (`ensureAuthorized` + the `connect` / `login` / `authorize` /
`logout` ops), surfaced as the `login` / `logout` / `mcp-authorize` built-ins.

## Marking a server as OAuth

In `mcp.toolkit.json`, an HTTP server opts in with `oauth` and optional `scopes`:

```json
{ "name": "linear", "url": "https://mcp.linear.app/mcp", "oauth": true, "scopes": ["read", "write"] }
```

`scopes` become the space-separated `scope` on the authorization request. The
broker drives authorization itself (`auth(provider, { scope })`) so exactly these
scopes are requested — otherwise the SDK would request the server's entire
advertised `scopes_supported`, which some servers (PostHog) reject as
`invalid_scope`. Pick scopes the **authorization server** actually grants (which
may be a subset of what the resource advertises). No `client_id`/secret is needed
— DCR registers a client on the fly, and the provider sends an OAuth `state`
(required by some servers, e.g. PostHog).

Examples in `mcp.toolkit.json`: `linear` (`read`, `write`) and `posthog` (a
curated subset including `openid`, `insight:read/write`, …, `user:read`).

## Flow from the REPL

```lisp
(login "linear")               ; or: (await (load-mcp "linear"))
;=> "https://linear.app/oauth/authorize?…"   (or :logged-in if already authed)
;;  approve in the browser → the code is captured automatically
(await (load-mcp "linear"))    ;=> connects; linear/* tools bind
```

1. **`ensureAuthorized`** (used by both `connect` and `login`) creates a
   `StoredOAuthProvider`. A stored token means connect proceeds directly
   (refreshed silently via the refresh token). With no token it runs discovery +
   DCR + PKCE (`auth(provider, { scope })`), saves the PKCE verifier, and captures
   the authorization URL.
2. The URL is surfaced — as `login`'s return value, or as the `NeedsAuthError`
   message on the `load-mcp` job — and, on the needs-auth path, the callback
   server is started.
3. The user approves and is redirected to the callback with `?code`.
4. The code is exchanged for tokens (`auth(provider, { authorizationCode })`),
   saved to the store. A subsequent `(load-mcp "linear")` connects.
5. **Later sessions** reconnect silently from the stored refresh token; if a
   stored token is rejected (`UnauthorizedError`), `connect` drops it and
   re-authorizes.

The code exchange is a **separate step** from the authorization request; they are
bridged by the persisted PKCE verifier + client registration, so no live
transport has to stay open. This is what lets the code arrive by loopback, manual
paste, or a cloud ingress.

## Callback server (`CallbackServer`)

The **same** application serves the callback and saves the tokens in both modes;
only where it binds and the URL it advertises differ (`createAuthCallback(port)`):

- **Local** (default): binds `127.0.0.1:<port>` (default `8909`) and advertises
  `http://127.0.0.1:<port>/callback`. Reachable only from a browser on the same
  machine.
- **Ingress** (cloud): set `LISPTC_OAUTH_REDIRECT_URL` to your public callback
  (e.g. `https://mcp.example.com/oauth/callback`). The server then binds
  `0.0.0.0:<port>` (reachable via the ingress) and advertises the public URL.
  The ingress routes `https://…/oauth/callback` to the pod's `0.0.0.0:<port>`
  at the same path; the server captures the code and exchanges it, exactly as
  local mode does. The advertised redirect URL may differ from the bind
  `host:port` — the ingress bridges them.

On the needs-auth path the server auto-captures the code and exchanges it in the
background; then a subsequent `(load-mcp "server")` connects. A single long-lived
server (bound on first need) multiplexes every flow, routing each callback to the
authorization that owns its OAuth `state`. This is why several outstanding login
links — e.g. one per concurrent background `load-mcp` — each complete
independently: each flow's exchange runs against the **originating provider** (its
in-memory PKCE verifier), so a later login for the same server overwriting the
stored verifier doesn't break an earlier link.

The browser page reflects the **real** outcome: the token exchange runs *before*
the page is rendered, so a code that fails to exchange (or an `?error=` redirect,
or a callback for an unknown/expired `state`) shows an error page rather than a
misleading "Authorization complete".

### Manual fallback

`(mcp-authorize "server" "<code>")` completes the exchange with a code obtained
out-of-band — for headless sessions or if the callback port is busy. It accepts
either the bare code or the whole pasted callback link
(`…/callback?code=…&state=…`), pulling the `code` out of the URL. Unlike the
auto-capture path it rebuilds the provider from the store, so it uses the
**latest** stored PKCE verifier — paste the code from the most recent login link.

### Login / logout

`(login "server")` begins authorization and returns the login URL to open (or
`:logged-in` if already authenticated); after approving, `(load-mcp "server")`
connects. `(logout "server")` unloads the server (if loaded) and deletes its
saved session via `OAuthStore.clear`, so the next login re-authorizes from
scratch — e.g. after widening `scopes`. Both share `connect`'s auth kickoff
(`ensureAuthorized`).

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
  rejected with *"invalid redirect URI"*. `ensureAuthorized` self-heals by
  dropping a stored registration whose `redirect_uris` don't include the current
  one, so the SDK re-registers.
- **Insufficient scope (403).** If a server needs a scope you didn't request, a
  tool call returns `403 insufficient_scope` naming it (e.g. PostHog needs
  `user:read`). The SDK can't re-consent mid-connect — add the scope to the
  server's `scopes` in `mcp.toolkit.json`, then `(logout "server")` and
  `(login "server")` again.
- **Callback page** is served as `text/html; charset=utf-8` (otherwise the em-dash
  renders as mojibake).
- **Loopback is same-machine only.** For SSH/remote, either port-forward the
  callback port or use the external strategy + `mcp-authorize`.
