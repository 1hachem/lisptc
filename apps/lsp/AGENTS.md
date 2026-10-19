# @lisptc/lsp

A language server for the lisptc dialect. Ships as the `lisptc-lsp` binary over
`vscode-languageserver`.

Turbo tag: `product`.

## Shape

`src/server.ts` is the binary: it owns the connection and the document
lifecycle, and answers every request through `@repo/language-service`. The
symbol table comes from the shared session server while one runs, and from a
local `Interp` otherwise. `src/table-cache.ts` holds the session's answer for a
moment so a burst of requests asks once.

`src/extensions.ts` holds the two rosters this app composes: the one the local
`Interp` reads its docs from, and the one the shared session server runs on.
`src/session.ts` is the file that server is spawned as. `@repo/repl` names no
extension, so both lists are this app's to keep.

## Rules

What the server says about the text belongs in `@repo/language-service`, so the
chat input says the same. This app adds transport and nothing else.

What a form means comes from the interpreter's doc records, read at runtime, not
from a table kept here. A new form documented in the interpreter shows up in
completion and hover with no change to this app.

`@lisptc/cli` keeps a session roster of its own. The two are one surface, so an
extension added here is added there.

A handler stays cheap enough to run on every keystroke, so work that can wait
belongs behind the cache.

## Tests

`test/` covers the cache. The language itself is tested in
`@repo/language-service`.
