# @lisptc/cli

The interactive terminal REPL. Ships as the `lisptc` binary, and is what
`pnpm repl`, `pnpm repl:attach` and `pnpm repl:kill` run.

Turbo tag: `product`.

## Shape

`src/cli.ts` is the binary: it parses the arguments, owns the readline loop and
the prompt, and runs .ptc files given on the command line.

It has two modes. Local, where it drives an `Interp` through the session hooks.
Attached, where it forwards each complete form to the shared session server and
prints what comes back.

`src/extensions.ts` holds both rosters: the one the local mode runs on, which
reaches the world through the hosts a terminal should have, and the one the
shared session runs on. `src/session.ts` is the file the spawned session server
runs, and it exists so that the roster belongs to this app rather than to
`@repo/repl`.

`isComplete` decides when a buffer holds a whole form. Both modes read line by
line, so the loop needs it before it can evaluate.

## Rules

This app names extensions because it is a composition root: it decides what a
terminal REPL can do. `@repo/repl` names none, so adding an extension to the
terminal REPL means adding it in `src/extensions.ts`, to the roster that should
have it, and there is no registry that would do it for you.

`@lisptc/lsp` spawns the same kind of session with a roster of its own, and
whichever runs first for a working directory is the one that serves it. Keep the
session roster here in step with that one.

`USAGE` is the only documentation a user of the binary gets. An argument or an
option that changes belongs in it, in the same change.

## Tests

`test/cli-is-complete.test.ts` covers the buffering, which is the part with
behaviour worth pinning. Everything else here is readline and process wiring.

`test/discovery.test.ts` runs a REPL on the roster this app composes. A case
that needs several extensions to be in the same REPL belongs here, because this
is where they are in one.
