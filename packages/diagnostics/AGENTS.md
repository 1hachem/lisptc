# @repo/diagnostics-extension

What a failed call says.

Turbo tag: `extension`.

## Shape

`src/diagnostics.ts` is the extension, `src/ports.ts` the host contract and the
name matcher, `src/diagnostics-host.ts` the host a root passes in,
`src/diagnostics.ptc` the prompt.

## Rules

Read the host-port and seam rules in `packages/interpreter/AGENTS.md`. They
govern this package.

It reports and never repairs. A form that failed still fails, and its value is
unchanged.

It claims no failure another extension can explain, so it is listed last at a
composition root.

It declares no port but its prompt. What it needs to answer a failure, it is
handed.

A suggestion never crosses a qualifier, so a wrong guess stays inside the server
the call named.

## Tests

`test/`. A test installs this extension and no other.
