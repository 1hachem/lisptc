# @lisptc/lsp

A language server for the lisptc dialect. Ships as the `lisptc-lsp` binary over
`vscode-languageserver`.

Turbo tag: `product`.

## Shape

`src/server.ts` is the binary: it registers the handlers and owns the document
lifecycle. `src/tokenize.ts` turns text into positioned atoms, forms and calls.
`src/symbols.ts` finds the symbol or the enclosing call head at a position and
renders the hover. `src/doc-args.ts` and `src/doc-cache.ts` build argument
completions from the interpreter's own doc records. `src/call-diagnostics.ts`
checks a call against the arity it should have. `src/load-mcp.ts` adds the
completions an MCP server contributes.

`src/extensions.ts` holds the two rosters this app composes: the one the local
`Interp` reads its docs from, and the one the shared session server runs on.
`src/session.ts` is the file that server is spawned as. `@repo/repl` names no
extension, so both lists are this app's to keep.

## Rules

The tokens come from `@repo/shared/lisp-tokens`. **Do not write a second
tokenizer.** A server that disagrees with the reader reports errors that are not
real.

What a form means comes from the interpreter's doc records, read at runtime, not
from a table kept here. A new form documented in the interpreter shows up in
completion and hover with no change to this app.

`@lisptc/cli` keeps a session roster of its own. The two are one surface, so an
extension added here is added there.

Resolution is cached per document. A handler stays cheap enough to run on every
keystroke, so work that can wait belongs behind the cache.

## Tests

`test/` covers the tokenizer, the symbol lookup, the doc arguments and the call
diagnostics. A parser change needs a case in `test/tokenize.test.ts`.
