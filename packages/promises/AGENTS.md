# @repo/promises-extension

Asynchrony. The surface for a value that has not arrived yet.

Turbo tag: `extension`.

## Shape

`src/promises.ts` is the extension, `src/promises-host.ts` the host a root
passes in, `src/promises.ptc` the prompt.

## Rules

Read the host-port and seam rules in `packages/interpreter/AGENTS.md`. They
govern this package.

Nothing here blocks. Waiting belongs to the interpreter, so a combinator that
cannot be expressed through it is a change to the interpreter and never a timer
smuggled in here.

A rejection reaches the model as an error it can catch, like any other.

A new combinator goes in with the test that pins it under both drivers.

## Tests

`test/`. A test installs this extension and no other.
