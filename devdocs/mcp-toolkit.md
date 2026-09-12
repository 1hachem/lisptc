# The bundled MCP servers (`apps/mcp-toolkit`)

The servers in the toolkit that we write ourselves, listed in
`packages/interpreter/mcp.toolkit.json` alongside the third-party ones. Today:
`sheets` (Google Sheets) and `ocr` (Mistral OCR).

They live in an app rather than a package because each one is an executable, not
a library: nothing in the workspace imports them. That also keeps `fastmcp` out
of every package that merely talks *to* MCP.

`ocr` is stdio and the interpreter spawns it. `sheets` is HTTP, because it is an
OAuth resource server and MCP authorization is only defined for HTTP transports
(see below) — but the interpreter starts that one too, so both are one
`load-mcp` away.

## Keywords

Every entry in `mcp.toolkit.json` carries a `keywords` array, ours and the
third-party ones alike, and `search-mcps` scores against it: an exact name or
keyword hit is worth 3, a substring of either 2, a hit anywhere in the
description 1.

Keywords exist because an agent searches for the capability, not the product.
Nothing in `ocr`'s description says "vision", and nothing in `sheets`'s says
"csv" or "excel", so `(search-mcps "vision")` matched nothing before this, and an
empty result looks exactly like a toolkit with nothing for the job. The keyword
list is where the synonyms a model would reach for go, including the ones we would
never write in prose.

A term shorter than three characters only counts as an exact match. Without that
rule a natural-language query poisons the ranking: `(search-mcps "read a
receipt")` scored its `a` as a substring hit against `data-entry`, `linear`,
`analytics` and most of the rest, so all six servers came back and the score
stopped separating them. Short *names* still work, since an exact match is
checked first and `fs` is a name.

`search-mcps` rows deliberately do not include the keywords, while
`list-toolkit` rows do. A search result is read to pick one server, and the
description already answers that; twenty keywords per row would double what the
model pays to learn nothing new. `list-toolkit` is the browse command, where the
whole point is seeing what each server covers.

## Setup

Secrets come from **Infisical**, one folder per provider, fetched by the repo's
own `scripts/infisical-run.ts` through the Taskfile's `_infisical-run` — the same
wrapper `dev-app` and `dev-api` use, authenticating with the machine identity in
`INFISICAL_CLIENT_ID` / `INFISICAL_CLIENT_SECRET`. There is no `infisical` CLI
login to do.

| server | Infisical path | keys | start with |
| --- | --- | --- | --- |
| `sheets` | `/mcps/google` | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | the interpreter, or `task mcp:sheets` |
| `ocr` | `/mcps/mistral` | `MISTRAL_API_KEY` | the interpreter, or `task mcp:ocr` |

The `sheets` Google client must be of type **Web application** with
`http://localhost:8911/oauth/callback` as an authorized redirect URI.

From any REPL:

```
(load-mcp "sheets")
```

which starts the server if `http://localhost:8911` is not already answering, then
answers with an authorization link. Approve it in the browser and the
interpreter's own callback captures the code; `(load-mcp "sheets")` again
connects. Running `task mcp:sheets` yourself still works and is what you want
while editing the server: an already-reachable origin is reused rather than
started again. `(login "sheets")` asks for the link without attempting a connect, and
`(logout "sheets")` forgets the account. `ocr` needs no authorization and the
interpreter starts it for you:

```
(await (load-mcp "ocr"))
```

`ENV=prod task mcp:sheets` reads another Infisical environment, as with the other
tasks.

## How the interpreter finds a bundled server

A toolkit entry's `args` are expanded twice before the server is spawned
(`registerConfigs`, `src/mcp.ts`): `${VAR}` from `process.env`, then any argument
starting with `./` or `../` is resolved **against the toolkit file's own
directory**, not the process cwd. Without that second step a bundled server is
unreachable, because there is no cwd that all of its callers share: `pnpm repl`
runs from `packages/repl`, the LSP from the editor's project root, the agent from
`apps/api`, a test from its own package. Relative paths in the toolkit therefore
mean "relative to `mcp.toolkit.json`", which is the only fixed point.

Third-party servers keep using a bare command (`npx`, `node`) with no leading
`./`, so they are untouched by the rule.

## Where the secrets come from

The Infisical wrapper lives in the Taskfile, never in this app's `package.json`
and never in the toolkit entry. The app's own scripts are plain `node`:

```json
"sheets": "node --no-warnings --experimental-transform-types src/sheets/server.ts",
"ocr":    "node --no-warnings --experimental-transform-types src/ocr/server.ts"
```

and the tasks wrap them exactly the way `dev-api` wraps the API:

```yaml
  mcp:ocr:
    cmds:
      - task: _infisical-run
        vars: { ENV: '…', PATHS: "/mcps/mistral", CMD: "pnpm --silent --filter @lisptc/mcp-toolkit run ocr" }
```

Both toolkit entries name the task rather than repeating any of this:

```json
{ "name": "ocr",    "command": "task", "args": ["--dir", "../..", "mcp:ocr"] }
{ "name": "sheets", "command": "task", "args": ["--dir", "../..", "mcp:sheets"],
  "url": "http://localhost:8911/mcp", "oauth": true }
```

Three details there are each load bearing, and two of them exist only because
`ocr` speaks **JSON-RPC over stdout**, where one stray line of prose breaks the
handshake:

- **`--dir ../..`.** A relative path in a toolkit entry is resolved against
  `mcp.toolkit.json` (see above), so this is the repo root no matter which
  front-end spawned the server. Task needs it to find `Taskfile.yml` at all, and
  the front-ends do not agree on a cwd.
- **`--silent` on the inner `pnpm`.** Without it pnpm writes its
  `> @lisptc/mcp-toolkit@0.0.0 ocr` banner to stdout. The Taskfile's own
  `silent: true` covers task's echoing but not pnpm's.
- **`infisical-run.ts` reports on stderr.** Its two progress lines
  ("requesting secrets from …", "N secrets loaded") were `console.info`, which is
  stdout, and they landed in the JSON-RPC stream. They are `console.error` now:
  progress belongs on stderr anyway, and it is what makes that script safe to
  wrap around any protocol server. Do not move them back.

## Starting a url server (the local runtime)

A toolkit entry with a `url` may also carry `command`/`args`, meaning "we run
this server; start it if it is not up". Starting it is the runtime's job, not the
client's: `localRuntime()` (`src/mcp-runtime.ts`) is what `registerMcp` uses
unless a host passes another, and its `start` runs before both the connect and
the `login` paths — `login` needs it too, or asking for the authorization link of
a server that is not running fails with a bare `fetch failed`. See
[mcp-runtime.md](./mcp-runtime.md) for the port itself.

- **Reachability decides, not bookkeeping.** A `HEAD` on the url's origin (2s
  timeout) is the only test. A server you started with `task mcp:sheets` is
  therefore reused, and two REPLs do not fight over port 8911.
- **The child's stderr is captured, never inherited.** The first version passed
  `stdio: [.., .., "inherit"]`, and because the child is also `detached` it went on
  holding the parent's stderr after the parent had finished — a REPL process that
  looked hung forever. The last 4KB is buffered instead, and the tail of it is
  appended to the error when the server dies before the port answers, so
  `(load-mcp "sheets")` can say *why*:

  ```
  sheets: its server exited with code 1 before http://localhost:8911 answered.
  Error: the sheets MCP server cannot start: GOOGLE_CLIENT_ID … are not set.
  ```

  That is the one diagnostic a spawned MCP server otherwise never gets: a stdio
  server that dies at startup surfaces only `MCP error -32000: Connection closed`.
- **`detached: true` is kept** so `stopAll` can `kill(-pid)` the whole
  `task` → `infisical-run` → `pnpm` → `node` tree; killing just the `task` pid
  would orphan the server. It runs from `mcp-shutdown` and from the `dispose`
  hook, so a `reset()` does not leave a server behind.
- Readiness is polled for 60s, above what `infisical-run` plus `pnpm` plus a
  fastmcp boot needs from cold.

## Env validation

Each server has its own env module in `@repo/env`, and it is the only thing that
reads the keys:

- `@repo/env/mcps/google/sheets` → `googleSheetsEnv`
- `@repo/env/mcps/mistral/api` → `mistralApiEnv`

They are **not** re-exported from `@repo/env`'s barrel, and that is deliberate:
`createEnv` validates at module evaluation, so a barrel export would make
importing `@repo/env` anywhere in the monorepo demand a Mistral key and a Google
client. Each module is imported only by the server that needs it.

The credentials are required rather than optional, so a server whose Infisical
folder is empty fails at startup with a sentence naming the missing keys, the
path they should have come from and the task that fetches them, instead of
starting and answering every tool call with a 401:

```
the sheets MCP server cannot start: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET are
not set. They come from Infisical at /mcps/google, so start it with
"task mcp:sheets".
```

That message is `missing()` in `packages/env/src/mcps/errors.ts`, wired in as
t3-env's `onValidationError`.

Nothing reads a `.env` file: Infisical injects the keys into the process through
the Taskfile's `_infisical-run`, and a server started outside that wrapper is
meant to fail loudly rather than pick up a stale local file. The env module is
also the only reader of these variables, `LISPTC_MCP_STATE_DIR` included, so
every key a server needs is validated once at import instead of being read back
off `process.env` deeper in.

## Why the tools return JSON strings

`fastmcp`'s `execute` may return an object, but these servers return
`JSON.stringify(...)` instead. That is deliberate, and it is the whole reason
these servers are pleasant to use from Lisp: the MCP client parses an all-text
result that is a JSON **object or array** and hands Lisp the data
(`asJsonDocument`, `src/mcp-client.ts`), so `(sheets/get-sheet-data …)` yields an
alist the agent can `assoc` and compaction reports by its keys rather than by a
word count. A tool that returned prose ("📋 Data in range …") would give the
agent a string to re-parse, and the REPL would describe it as text.

The same reasoning drives `:as-objects` on `get-sheet-data`. Off, it returns the
API's own `values` (a list of lists). On, it uses the first row of the range as a
header and returns a list of alists, which is the shape you can `mapcar` over and
the shape the compaction reporter describes best.

## Why tool and parameter names are kebab-case

The interpreter passes keyword arguments through verbatim (`keyName`,
`src/plist.ts`): no case conversion, no dash-to-camel. Whatever a tool calls its
parameters is what the agent has to type. So a tool named `get_sheet_data` with a
`spreadsheetId` parameter forces `(sheets/get_sheet_data :spreadsheetId …)` into
a language where every other name is hyphenated. Since we own these servers, the
schemas use `get-sheet-data` and `:spreadsheet-id` and the Lisp reads like Lisp.
This is a choice available only for our own servers; a third-party server's
spelling is its own.

## Google credentials go through MCP's own OAuth flow

`(load-mcp "sheets")` returns an authorization link, exactly the way `linear` and
`posthog` do, and for the same reason: the sheets server is an **OAuth 2.1
resource server** and the interpreter is an ordinary MCP client against it. That
is why this server is HTTP rather than stdio. `mcp-client.ts` takes the OAuth
path only for `"url" in conf && conf.oauth`, and an stdio server has no request
headers to carry a bearer at all.

What the server does *not* do is speak to Google as the client. It sits in the
middle as a **proxying authorization server**, which is what makes a Google
account reachable through a flow the MCP client already knows:

```
interpreter ──DCR /oauth/register──▶ sheets ─────────────────────▶ Google
            ──▶ /oauth/authorize ──▶ (302, access_type=offline) ──▶ consent
            ◀── 127.0.0.1:8909 ◀──── /oauth/callback ◀────────────── code
            ──▶ /oauth/token ─────▶ swaps for a short JWT; the Google
                                    tokens stay on the server
```

`fastmcp`'s `GoogleProvider` supplies all of it: the two discovery documents
(`/.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server`),
dynamic client registration, `/oauth/authorize`, `/oauth/callback` and
`/oauth/token`. `AuthProvider.authenticate` then resolves the bearer on each
request back to the stored Google token set, so a tool body reads
`session.accessToken` and the Google access token is all it ever sees. That is
the same shape as the hyko server this was modelled on, where a platform did the
proxying instead.

Four settings are ours rather than the provider's defaults, and each one is load
bearing:

- **`extraAuthorizationParams: { access_type: "offline", prompt: "consent" }`.**
  `GoogleProvider` does not send these, and without them Google issues no refresh
  token: the server works for an hour and fails overnight. `prompt=consent` is
  needed as well as `access_type=offline`, because a user who has approved the app
  before otherwise gets an access token and nothing else. `AuthProviderConfig`
  has no field for it, which is the reason `createProxy()` is overridden at all.
- **`tokenStorage: DiskStore`** under `~/.lisptc/sheets/tokens`, so restarting the
  server does not force everyone to authorize again. The default is in-memory.
- **A persisted `jwtSigningKey` and `encryptionKey`**, written once to
  `~/.lisptc/sheets/keys.json` (mode `0600`). They are auto-generated per process
  otherwise, which would make `DiskStore` pointless: after a restart the stored
  token set could not be decrypted and no previously issued JWT would verify.
  `LISPTC_MCP_STATE_DIR` moves the whole directory.
- **`allowPlainPkce: false` and `consentRequired: false`.** `plain` PKCE is
  refused because OAuth 2.1 and the MCP authorization spec both require S256, and
  the interpreter sends S256 anyway. The proxy's own consent screen is off because
  Google is already showing one; two consecutive approval pages for a local dev
  server is friction with nothing behind it.

Only the first and `allowPlainPkce` need the subclass. `tokenStorage`, the two
keys, `consentRequired` and `scopes` are ordinary `AuthProviderConfig` fields and
are passed to the constructor in `googleProvider()`, so the override sets only
what the config cannot reach and otherwise mirrors `GoogleProvider.createProxy()`
field for field, `allowedRedirectUriPatterns` included.

`allowedRedirectUriPatterns` is deliberately left unset: `fastmcp`'s default is
`["http://localhost:*", "http://127.0.0.1:*"]`, which is exactly the loopback
allowance the interpreter's callback (`http://127.0.0.1:8909/callback`) needs, and
widening it past loopback is the CWE-601 open-redirect the library warns about.

The port is **8911** (`LISPTC_SHEETS_PORT`, or `LISPTC_SHEETS_URL` for the whole
base URL). 8909 belongs to the interpreter's OAuth callback and 8910 is left
clear between them.

**Scopes**: `spreadsheets` (read and write the user's spreadsheets), `drive.file`
(only to move a spreadsheet we created into a folder), `drive.metadata.readonly`
(only for `list-spreadsheets`), plus `openid`/`email`. Full `drive` is not
requested.

**One thing the proxy does not do**: `loadUpstreamTokens` returns the stored
Google token set without checking its age, since the MCP client is expected to
refresh its own JWT at `/oauth/token` and that is what refreshes upstream. A
session that outlives Google's hour would otherwise present a dead token, so
`googleJson` retries once on a `401` using the session's own refresh token. Only
on `401`: a `403` from Google is a permission or quota answer, and refreshing to
retry it would buy the same `403`.

## OCR

One tool, `ocr-document`, over `MISTRAL_OCR_MODEL` (default
`mistral-ocr-latest`). It takes a public `url` or a local `path`; a path is
uploaded to `/v1/files` with `purpose=ocr` and then read through a one-hour signed
URL, because `/v1/ocr` only accepts a URL. Whether the document is sent as
`document_url` or `image_url` is decided from the file extension, so a `.png` is
not offered to the API as a PDF.

`include_image_base64` is off. The embedded images are megabytes of base64 that
would land in the model's context describing a picture it cannot see, and the
markdown text is what the extraction step needs. The tool timeout is 180s, above
the promise layer's own default, since a long scanned PDF genuinely takes minutes.
