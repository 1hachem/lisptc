# @lisptc/cli

The interactive terminal REPL. Ships as the `lisptc` binary, and is what
`pnpm repl`, `pnpm repl:attach` and `pnpm repl:kill` run.

Turbo tag: `product`.

## Shape

One file. `src/cli.ts` is the binary: it parses the arguments, owns the readline
loop and the prompt, and runs .ptc files given on the command line.

It has two modes. Local, where it builds its own extension list and drives an
`Interp` through the session hooks. Attached, where it forwards each complete
form to the shared session server and prints what comes back.

`isComplete` decides when a buffer holds a whole form. Both modes read line by
line, so the loop needs it before it can evaluate.

## Rules

This app names extensions because it builds a REPL, which is what the REPL layer
is allowed to do. Nothing above a REPL may.

It is one of three places that build an extension list, beside the options a
caller passes and the session server. Adding an extension to the terminal REPL
means adding it here, and there is no registry that would do it for you.

`USAGE` is the only documentation a user of the binary gets. An argument or an
option that changes belongs in it, in the same change.

## Tests

`test/cli-is-complete.test.ts` covers the buffering, which is the part with
behaviour worth pinning. Everything else here is readline and process wiring.
