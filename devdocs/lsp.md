# The lisptc LSP's static analysis

`apps/lsp` never evaluates the buffer — diagnostics, completion, and hover are
all derived statically, falling back to a local prelude-only interpreter when
no shared session is reachable (see `packages/repl`'s session-server for what
"shared" means). `src/server.ts` is now just the connection wiring; the actual
analysis lives in a handful of standalone modules so it can be unit-tested
without spinning up a real LSP connection:

- `src/tokenize.ts` — tokenizer, tree parser, and call-site collector.
- `src/call-diagnostics.ts` — required-`:arg` / arity diagnostics built on top
  of `tokenize.ts`.
- `src/symbols.ts` — `enclosingCallHead` / `symbolAt` / `markdownFor`, the
  cursor-position helpers completion and hover share.
- `src/doc-args.ts` — renders a `DocArg[]` as `:key` completion items.
- `src/load-mcp.ts` — completions for `load-mcp`'s bare toolkit-name string
  argument (the only part of `load-mcp` that's genuinely LSP-specific; see
  below for its `:key` plist form).

`server.ts` has top-level side effects (`createConnection`, `documents.listen`)
the moment it's imported, so it stays a thin `connection.on*` wiring layer with
no logic worth testing directly — the modules above take real text/positions
in and plain data out, and are exercised in `test/*.test.ts` (vitest).

## Tokenizing: shared grammar, separate parsers

The LSP's tokenizer and the interpreter's `Reader` (`packages/interpreter/src/lisp.ts`)
both read via the same token grammar — `tokenPattern()`, a factory (not a
shared `RegExp`, since `.exec()` mutates `lastIndex` and two interleaved scans
on one instance would corrupt each other). That's the only thing they share;
each builds a different structure on top of it, for a different consumer:

| | `Reader` (interpreter) | `tokenizeWithPositions`/`parseForms` (LSP) |
| --- | --- | --- |
| Output | Real Lisp values (`Cell`, `Sym`, numbers, strings) ready to `eval()` | A lightweight `Atom \| ListForm` tree of strings |
| Positions | A running `lineNo` (line-level, for error messages) | Full `(line, char)` per token, for diagnostic ranges |
| Quote sugar (`'`/`` ` ``/`,`/`,@`) | Expanded into real `(quote x)`/`(quasiquote x)` cons structure | Collapsed away — just avoids inflating an arg count |
| Malformed input | Throws (`EvalException`/`EndOfFile`) — about to be evaluated | Best-effort — a buffer mid-edit is routinely unbalanced |

One thing they deliberately don't share is prose handling. The interpreter
blanks everything outside the top-level forms (`stripProse`) before tokenizing;
the LSP tokenizes the raw buffer. A prose word out there is just an atom no
analysis looks at, while prose that *does* contain parentheses is real code the
interpreter will run — so the call diagnostics should keep checking it.
`checkSyntax` strips internally, which is what makes prose (and a smiley) never
a syntax error in the editor.

Fully merging them would mean either bloating `Reader` with position-tracking
and error-tolerance it doesn't need for evaluation, or making the LSP build
real `Cell`/`Sym` values and throw on every incomplete buffer a user is
mid-typing. Keeping the grammar shared and the parsers separate is the level
of sharing that's actually correct here.

## `load-mcp`'s two calling conventions

`(load-mcp "name")` takes a bare predefined toolkit-server name (completed from
`mcp.toolkit.json` — `src/load-mcp.ts`'s `toolkitCompletions`). The ad-hoc
`:key` plist form — `(load-mcp :name "x" :url "…"|:command "…" …)`, parsed by
`connConfigFromArgs` in `packages/interpreter/src/mcp.ts` — needs **no**
LSP-specific handling: its `DocArg[]` (`LOAD_MCP_ARGS`, defined in `mcp.ts`
right next to `connConfigFromArgs`) is attached to `load-mcp`'s own doc entry
via `Interp.def`'s optional `args` parameter, the same mechanism
`defineGlobal` already used for MCP tools' `toolArgs`. Once it's in the doc
table, `Interp.docs()`, the session-server's `doc` RPC, and the LSP's generic
`keywordCompletions`/`callDiagnostics` path all pick it up automatically — no
separate code path needed for a built-in vs. an MCP tool.

`required` on `LOAD_MCP_ARGS` only marks `:name`. The url/command choice is a
branch (`:url` + optional `:headers`/`:oauth`/`:scopes`, or `:command` +
optional `:args`/`:env`), and a flat `DocArg[]` can't express "one of" — marking
both `:url` and `:command` required would flag every valid call as missing
whichever branch it didn't use. So the required-arg diagnostic under-flags
(misses "neither `:url` nor `:command`") rather than over-flagging every valid
call; `connConfigFromArgs`'s own runtime check still catches that case at
`(load-mcp …)` call time.

## Testing

`apps/lsp` has its own `vitest.config.ts` and `test/` directory (same pattern
as `packages/interpreter`/`packages/repl`), run via `pnpm --filter @lisptc/lsp test`
or as part of the root `pnpm test`. Tests construct a `TextDocument` directly
(`TextDocument.create(uri, languageId, version, content)`) or call the pure
tokenizer/diagnostic functions with plain strings — no real LSP connection, no
live session, no interpreter process.
