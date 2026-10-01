# @repo/memory-extension

The memory extension. What the agent remembers is this package's surface. Where
it is kept is not.

Turbo tag: `extension`.

## Shape

`src/memory.ts` is the extension, `src/ports.ts` the contracts a host satisfies,
`src/memory-host.ts` the host a root passes in, `src/memory.ptc` the prompt.

## Rules

Read the host-port and seam rules in `packages/interpreter/AGENTS.md`. They
govern this package.

Time is a port here, like the store. Nothing reads a real clock, so that decay
stays testable.

An alias is kept beside the memories and not among them. It has its own store
port, because what it holds is a pair of names rather than a body that can fire,
decay or be revised. A name is bound late: the book keeps what it could not bind
and tries again each step, so an alias to a tool lands when its server does. It
never overwrites a name that is already taken.

A store may answer with a promise, so nothing built on one may block, and it has
to hold under both drivers.

A new trigger is a trigger, never a branch in what dispatches them.

A consumer takes the bank from the seam and never imports this package.

## Tests

`test/`. A test installs this extension and no other.
