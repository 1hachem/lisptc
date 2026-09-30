# @repo/secrets-extension

The secret registry. A secret is a value here, and plaintext nowhere.

Turbo tag: `extension`.

## Shape

`src/secrets.ts` is the extension, `src/ports.ts` the contracts a host
satisfies, `src/secrets-host.ts` the host a root passes in, `src/secrets.ptc`
the prompt.

## Rules

Read the host-port and seam rules in `packages/interpreter/AGENTS.md`. They
govern this package.

Taint propagates or the extension is broken. An operation added to this surface
carries taint through, and the test that proves it goes in beside it. One that
would drop taint does not belong here.

Where a secret is kept and who may read it is the host's decision, never this
package's.

A consumer takes the store from the seam and never imports this package.

## Tests

`test/`. A test installs this extension and no other.
