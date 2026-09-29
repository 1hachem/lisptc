# @repo/memory-extension

The memory extension: what the agent remembers, what fires a memory, and what
decays.

Turbo tag: `extension`.

## Shape

`src/memory.ts` is the extension: it fills `memorySlot`, hooks `beginTurn`,
`evalStep` and `annotate` on the session and `evalForm` on the interpreter, and
registers the surface. `src/ports.ts` declares `MemoryHost` and the store the
extension is handed. `src/memory-host.ts` holds the host a root passes in, and
the store implementations one can be built from. `src/memory.ptc` is the prompt.

`MemoryHost` declares three ports: the store, the clock and the prompt. Time is
a port here for the reason the filesystem is one: a memory that decays cannot be
tested against a real clock.

`src/memory-host.ts` is the only file that reads a typed env module. The
extension is handed a value and never looks one up.

## Rules

Read the host-port and seam rules in `packages/interpreter/AGENTS.md`. They
govern this package.

A store may answer with a promise. Everything built on one waits through the
interpreter's suspension rather than blocking, and it has to hold under both
drivers.

A new trigger is a trigger, not a branch in the hook that dispatches. A consumer
that wants the bank reads `memorySlot` and never imports this package.

## Tests

`test/memory.test.ts` covers the surface, the triggers, decay and the stores.
`test/async-hosts.test.ts` pins a promise-returning store against both drivers.
`test/setup-env.ts` points the file store at a temp directory. A test installs
this extension and no other.
