# @repo/repl

The REPL front-ends over the interpreter. This is the layer that decides which
extensions a REPL is built with, and the last layer allowed to know their names.

Turbo tag: `runtime`.

## Shape

`src/repl.ts` is the in-memory REPL. It takes its extension list through
options, builds an `Interp` with them, and serialises evaluation through the
session hooks. The agent-facing REPL extends it with the turn lifecycle the
agent loop drives.

`src/session-server.ts` is the long-lived REPL behind a socket, with the client
that speaks to it and the protocol version they agree on. It assembles its own
extension list.

The interactive terminal REPL is not here. It is `@lisptc/cli`, which builds on
this package's exports.

## Rules

Three places build an extension list: the options a caller passes, the session
server, and `@lisptc/cli`. Adding an extension to the REPL means adding it to
the ones that should have it, and there is no registry that would do it for you.

`src/repl.ts` is a driver, and `check:arch` pins what it may carry across the
seam by name. If a new value from an extension has to reach it, that list is the
thing to extend deliberately, in the script, and the failure names it.

Everything else here runs the chains without knowing who is on them. Give a new
chain a base case that is correct when no extension hooks it, because a REPL
built without that extension takes the base.

## Tests

`test/helpers.ts` holds the shared setup. `test/extensions.test.ts` and
`test/session-hooks.test.ts` are where a change to the extension set or the
lifecycle shows up first.
