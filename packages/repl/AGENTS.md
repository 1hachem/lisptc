# @repo/repl

The REPL front-ends over the interpreter. It names no extension: a REPL is
built from the list it is handed, and what is on that list is decided above.

Turbo tag: `runtime`.

## Shape

`src/repl.ts` is the in-memory REPL. It takes its extension list through
options. The agent-facing REPL beside it adds the turn lifecycle.

`src/session-server.ts` is the long-lived REPL behind a socket, with the client
that speaks to it and the protocol version they agree on. `serve` takes the
extension list. **The server is not an entry point here.** The caller names the
file to spawn, so the process that serves a session is the one that decides
what is in it.

The interactive terminal REPL is not here. It is `@lisptc/cli`, which builds on
this package's exports.

## Rules

**No file here names an extension**, the tests included, and `check:arch` holds
the `src/` tree to it with `src/repl.ts` as the single listed exception. The
manifest carries none either: the `runtime` tag denies `extension` in the root
`turbo.json`, so `pnpm boundaries` fails on a dependency as well as on an
import. Adding an extension is an edit at a composition root: `@lisptc/cli`,
`@lisptc/lsp` or `@repo/backend`. There is no registry that would do it for you,
and a test that wants a roster builds one.

`src/repl.ts` is a driver, and `check:arch` pins what it may carry across the
seam by name. If a new value from an extension has to reach it, that list is the
thing to extend deliberately, in the script, and the failure names it.

Everything else here runs the chains without knowing who is on them. Give a new
chain a base case that is correct when no extension hooks it, because a REPL
built without that extension takes the base.

## Tests

`test/helpers.ts` holds the shared setup, and the roster it builds is the
test's own, not a list this package ships. It reaches for no extension package:
what a REPL does with a capability is pinned here with a stub that fills the
slot or hooks the chain, and what an extension does with it is pinned in that
extension's own tests. A case that needs a real extension belongs where that
extension is composed, which is why the discovery-call cases live in
`@lisptc/cli` and the model-facing REPL cases in `@repo/backend`.

A REPL with nothing installed writes to the human's lane and to the error lane,
and to nothing else, so a case here reads `evalOutput().user` rather than what
`eval()` returns. Asserting on the model's copy means asserting on an
extension.

`test/session-hooks.test.ts` is where a change to the lifecycle shows up first.
`test/session-server.test.ts` spawns `test/fixture-session.ts`, which stands in
for the entry an app would pass.
