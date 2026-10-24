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

This package never runs an agent itself. Another agent is asked of the host
through a port, and a session whose host offers none refuses the forms that
need one.

Work a sub-agent does in the background is a job on the jobs port, and
whoever implements the port owns when it runs and what happens when it ends.
A job crosses the port as plain data, ids and payload alike, so a queue in
another process can carry it. The language holds a job's id, never the job.

## Tests

`test/`. A test installs this extension and no other, and asserts on the
effects a form emits or on what a fake runner was asked.
