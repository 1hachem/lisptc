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

A form here tells the user, never the model. It emits on a topic of this
package addressed to the user, and the session's annotate hook turns the last
value of a step into an annotation key from `@repo/interpreter/annotations`. A
question also ends the turn, by the `end` effect from
`@repo/interpreter/effects`.

## Tests

`test/`. A test installs this extension and no other.
