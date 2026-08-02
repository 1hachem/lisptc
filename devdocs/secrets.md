# Secret registry

A host-supplied key→value store of secrets. Keys (and descriptions) are listable
by the LLM; values are usable as ordinary strings but never printed. Code lives
in `src/lisp.ts` (registry + `Secret` + string primitives) and `src/repl.ts`
(host injection).

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
| Env vars | `REPL_*` seeded at `Interp` construction | none |
| `.env` file | `Interp.loadSecretsFromFile(path)` / CLI auto-load | none |
| Host (programmatic) | `setSecrets({ KEY: value \| { value, description } })` | optional |

`.env` auto-loading is **CLI-only** (`$LISPTC_SECRETS_FILE` or `./.env`); the
embedded `AgentRepl` (pi) does **not** auto-load — a host injects secrets
explicitly via `setSecrets` / `loadSecretsFromFile`, re-applied on `reset()`.

## Redaction via taint tracking

A secret is a `Secret` (value + source keys). `str()` renders it redacted as
`#<secret:KEY>`, covering every print path (return value, `princ`, errors, nested
lists) from one place. The value is revealed only by `lispToJson` when serialized
into an outgoing MCP call (tool args, `:headers`, `:env`).

Taint **propagates**: the JS string primitives (`concat`, `char`,
`string-upcase`/`downcase`) accept a `Secret`, and a result derived from one is
itself a `Secret`. Because the Lisp string library is built on those primitives,
transforms (`substring`, etc.) stay redacted for free — so an agent cannot
upcase/slice its way around the redaction. `length`/`stringp`/`eql` treat a
secret as its string, so predicates still work.

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
