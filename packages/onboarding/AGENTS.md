# @repo/onboarding-extension

Onboarding. The scripts a workspace keeps to walk its user through the app,
and whether that user has been through each one.

Turbo tag: `extension`.

## Shape

`src/onboarding.ts` is the extension, `src/ports.ts` the contracts,
`src/onboarding-host.ts` the host a root passes in, `src/onboarding.ptc` the
prompt.

## Rules

Read the host-port and seam rules in `packages/interpreter/AGENTS.md`. They
govern this package.

A script is a form, stored as it reads back and run in the agent's own
interpreter. What it calls belongs to other extensions, and this package names
none of them.

The store a root hands in reads and writes as the person in the chat, and this
package never learns who that is.

## Tests

`test/`. A test installs this extension and no other.
