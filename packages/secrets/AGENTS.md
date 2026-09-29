# @repo/secrets-extension

The secret registry. A secret is reachable as a value and never as plaintext in
anything the model reads back.

Turbo tag: `extension`.

## Shape

`src/secrets.ts` is the extension: it fills `secretsSlot` and registers the
surface, which includes the string operations that have to carry taint rather
than drop it. `src/ports.ts` declares `SecretsHost`, the store, and the taint a
secret value carries. `src/secrets-host.ts` holds the host a root passes in, and
the stores one can be built from. `src/secrets.ptc` is the prompt.

`SecretsHost` declares two ports, the store and the prompt. This extension
hooks no chain.

`src/secrets-host.ts` is the only file that reads a typed env module or a `.env`
file. The extension is handed a store and never looks one up.

## Rules

Read the host-port and seam rules in `packages/interpreter/AGENTS.md`. They
govern this package.

Taint propagates or the extension is broken. A string operation added to this
surface carries taint through, and the test that proves it goes in beside the
operation. An operation that would drop taint does not belong here at all.

Where a secret is written and who may read it is the host's decision, never
this package's. A consumer that wants the store reads `secretsSlot`.

## Tests

`test/secrets.test.ts` covers the surface, the redacted printing, taint through
every string operation, and seeding from the environment and a `.env` file.
`test/helpers.ts` builds the interpreter a test runs on. A test installs this
extension and no other.
