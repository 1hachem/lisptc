# @repo/agents-extension

Agents. The surface through which the language drives the harness that runs
it: what reaches the agent, and when, and the sub-agents it starts.

Turbo tag: `extension`.

## Shape

`src/agents.ts` is the extension, `src/agents-host.ts` the host a root passes
in, `src/agents.ptc` the prompt, `src/ports.ts` the port a root implements and
`src/definition.ts` the definition file.

## Rules

Read the host-port and seam rules in `packages/interpreter/AGENTS.md`. They
govern this package.

A form here asks the harness for something by emitting an effect from
`@repo/interpreter/effects`. The harness decides what an effect does. A form
never reaches the loop, the REPL or the transport itself, and a new kind of
request is a new variant of the effect union, not a key of this package's own.

This package never runs an agent itself. Another agent is asked of the host
through a port, and a session whose host offers none refuses the forms that
need one.

A definition lives in the workspace's sub-agents folder as name.ptc,
read and written through the source folder port. This package owns its format
and parses it; no root does. Every form that writes one is listed in the
extension's asks, so a definition is saved only once the user consents unless
their rules allow it. A sub-agent spawned with a prompt is temporary and writes
nothing until it is kept.

A sub-agent runs on a thread the runtime owns. Spawning, sending, waiting and
cancelling go through the agent threads port, and the runtime owns the jobs,
when they run and what happens when they end. This package keeps no job table.
The language holds a spawned agent's handle in a sealed state global, so it is
saved in the image and Lisp code cannot set it, and a job's id, never the job.

## Tests

`test/`. A test installs this extension and no other, and asserts on the
effects a form emits or on what a fake runner was asked.
