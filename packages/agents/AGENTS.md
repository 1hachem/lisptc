# @repo/agents-extension

Agents. The surface through which the language drives the harness that runs
it: what reaches the agent, and when.

Turbo tag: `extension`.

## Shape

`src/agents.ts` is the extension, `src/agents-host.ts` the host a root passes
in, `src/agents.ptc` the prompt.

## Rules

Read the host-port and seam rules in `packages/interpreter/AGENTS.md`. They
govern this package.

A form here asks the harness for something by emitting an effect from
`@repo/interpreter/effects`. The harness decides what an effect does. A form
never reaches the loop, the REPL or the transport itself, and a new kind of
request is a new variant of the effect union, not a key of this package's own.

## Tests

`test/`. A test installs this extension and no other, and asserts on the
effects a form emits.
