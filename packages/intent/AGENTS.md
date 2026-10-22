# @repo/intent-extension

Intent. What the agent shows the user of its intent: what it does now, its
todo, the question it asks.

Turbo tag: `extension`.

## Shape

`src/intent.ts` is the extension, `src/intent-host.ts` the host a root passes
in, `src/intent.ptc` the prompt.

## Rules

Read the host-port and seam rules in `packages/interpreter/AGENTS.md`. They
govern this package.

A form here tells the user, never the model. A question ends the turn.

## Tests

`test/`. A test installs this extension and no other.
