# @repo/promises-extension

Asynchrony. The surface a model uses to hold a value that has not arrived yet,
and to combine several of them.

Turbo tag: `extension`.

## Shape

`src/promises.ts` is the extension: it declares `PromisesHost` and registers the
combinators. `src/promises-host.ts` holds the host a root passes in.
`src/promises.ptc` is the prompt.

`PromisesHost` declares one port, the prompt. This extension hooks no chain and
fills no slot: waiting is the interpreter's suspension, and everything here is
built on it rather than beside it.

## Rules

Read the host-port and seam rules in `packages/interpreter/AGENTS.md`. They
govern this package.

Nothing here blocks. A combinator that cannot be expressed through suspension is
a change to the interpreter's driver, not a timer smuggled into this package.

A rejection reaches the model as an error it can catch, the same as any other.
A new combinator is a combinator beside the others, and the test that pins its
behaviour under both drivers goes in with it.

## Tests

`test/async.test.ts` covers suspension in argument positions, inside closures and
loops, the tail call stack across a suspension, and rejection as a catchable
error. A test installs this extension and no other.
