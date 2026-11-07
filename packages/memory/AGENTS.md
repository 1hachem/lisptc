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

A store may answer with a promise, so nothing built on one may block, and it has
to hold under both drivers.

A new trigger is a trigger, never a branch in what dispatches them.

**The store is the only source of truth for remembered memories.** Built-ins
come from the shipped `.memories.ptc` text, merged in when read, and are never
copied.

**The session's bookkeeping lives in the Lisp image**, as interpreter state,
never in a field of the bank: what was heard, what fired, what is loaded. The
image also holds the one cache the root rule allows: the remembered memories,
read from the store once. Every listing, recognition and event trigger answers
from it, and every remember, revise, reinforce or forget empties it.

**Recognition reads its candidates through a form in the REPL**, never from the
store. Built-in and remembered :when memories are one list there, treated
alike.

A consumer takes the bank from the seam and never imports this package.

## Tests

`test/`. A test installs this extension and no other.
