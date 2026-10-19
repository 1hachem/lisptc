# @repo/agents-extension

Agents. The surface through which the language drives the harness that runs
it: what reaches the agent, and when, and the sub-agents it starts.

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

A sub-agent is run through the ports in `src/ports.ts`, never by this package.
The runner builds the sub-agent's REPL and drives its turns, and the
definitions store keeps what `defagent` saves. A session handed no runner runs
no sub-agents. A running sub-agent is a cache behind the name a form returns,
so a restore loses it and a send to it is refused until it is spawned again.

## Tests

`test/`. A test installs this extension and no other, and asserts on the
effects a form emits or on what a fake runner was asked.
