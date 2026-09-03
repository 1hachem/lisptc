# Secret registry

A host-supplied key→value store of secrets. Keys (and descriptions) are listable
by the LLM; values are usable as ordinary strings but never printed.

The registry is an **opt-in extension** (like MCP), and the extension owns **all
secret loading** — env vars, `.env` files, and programmatic injection — so a host
(a REPL) never resolves paths itself; it just holds a store and passes the
extension. There is one addon, `secretsExtension`; everything lives in
`src/secrets.ts`:

- `SecretsStore` — the `get` / `list` / `set` seam behind the built-ins.
- `EnvSecretsStore` — the default store, seeded from `REPL_*` env vars.
- `loadSecretsFromFile(store, path)` / `loadSecretsFromEnvFile(store, path?)` — the
  `.env` loaders. `loadSecretsFromEnvFile` resolves, in order: an explicit path,
  `$LISPTC_SECRETS_FILE`, else the nearest `.env` searched **upward** from the
  launch directory (`INIT_CWD` under a package-manager script, else cwd) — so
  `pnpm repl`, whose cwd is `packages/repl`, still finds the project-root `.env`.
  It warns only on an explicitly-named missing file.
- `secretsExtension({ store?, envFile? })` / `registerSecrets(interp, store)` —
  the extension: installs `(secret)` / `(secrets)` over a store and, when
  `envFile` is set, seeds that store from a `.env` file. This IS the addon.

The taint story lives here too: the `Secret` type, and overrides of the core
string primitives (`interp.def` overwrites the global) that make every string
function taint-aware. The extension is fully independent of MCP: the value is
revealed only through the `toJSON` wire form, which `lispToJson` duck-types on —
the mirror of the `toString` display form that `str` duck-types on.

## Consuming from a host (a REPL)

A host holds one persistent `SecretsStore` for the life of the process and passes
`secretsExtension({ store })` to every interp it (re-)creates, so secrets survive
a `reset()`:

```ts
const store = new EnvSecretsStore();  // seeded from REPL_* env vars

// Standalone CLI: auto-load the .env file too (the extension does the loading).
new Interp({ extensions: [secretsExtension({ store, envFile: true }), mcpExtension()] });

// Embedded REPL: no .env auto-load; inject explicitly into the held store.
new Interp({ extensions: [secretsExtension({ store }), mcpExtension()] });
store.set({ REPL_API_KEY: "…" });
loadSecretsFromFile(store, "/path/to/.env");
```

To source secrets from somewhere other than the environment (a vault client, a
remote fetch, …), pass a custom `SecretsStore` via `secretsExtension({ store })` —
no change to the language.

## Lisp API

```lisp
(secrets)                       ; => (("REPL_LINEAR_API_KEY" . "Linear API key") …)
(secret "REPL_LINEAR_API_KEY")  ; => #<secret:REPL_LINEAR_API_KEY>  (redacted)
```

`(secrets)` returns an alist of `(key . description)`. `(secret key)` returns the
value as a **tainted string** — every text function works on it, but it prints
redacted and errors if the key is unknown.

## The `REPL_` prefix

Only keys starting with `REPL_` become secrets, and the prefix is kept (read a
secret back by its full name). This applies to every source: env vars, `.env`
files, and host-supplied records.

## Sources

| Source | How | Description? |
| --- | --- | --- |
| Env vars | `REPL_*` seeded when `EnvSecretsStore` is constructed | none |
| `.env` file | `secretsExtension({ envFile })` / `loadSecretsFromEnvFile` | none |
| Host (programmatic) | `store.set({ KEY: value \| { value, description } })` | optional |

`.env` auto-loading is **CLI-only** (via `secretsExtension({ envFile: true })`,
resolving `$LISPTC_SECRETS_FILE` or the nearest `.env` up-tree); the embedded
`AgentRepl` (pi) does **not** auto-load — a host injects secrets explicitly via
the REPL's `setSecrets` / `loadSecretsFromFile` (which write into the held store),
so they survive `reset()`.

## Redaction via taint tracking

A secret is a `Secret` (value + source keys). `str()` renders it redacted as
`#<secret:KEY>` (via its `toString`), covering every print path (return value,
`princ`, errors, nested lists) from one place. The value is revealed only by the
`toJSON` wire form, honored by `lispToJson` when serializing an outgoing MCP call
(tool args, `:headers`, `:env`).

Taint **propagates**: the extension overrides the string primitives (`concat`,
`char`, `string-upcase`/`downcase`, plus `length`/`stringp`/`eql`) so they accept
a `Secret`, unwrap it for the operation, and re-taint the result. Because the
Lisp string library is built on those primitives, transforms (`substring`, etc.)
stay redacted for free — so an agent cannot upcase/slice its way around the
redaction. Predicates still work (`eql` compares by value). Without the
extension no `Secret` value can exist, and the core plain-string primitives are
exactly right.

Combining secrets unions the taint: `(concat (secret "REPL_A") (secret "REPL_B"))`
→ `#<secret:REPL_A+REPL_B>`.

## Limits (by design)

- Taint follows data **inside the interpreter only** — it does not cross the MCP
  boundary. A tool that echoes a secret returns a fresh, untainted string. So
  redaction stops *accidental* display, not *deliberate* exfiltration by an agent
  with tool access.
- `eql` compares tainted strings by value — a weak equality oracle.
- Value use in an MCP call is the intended path; controlling *which* servers/tools
  a secret may reach is a separate concern from redaction.
