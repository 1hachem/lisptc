# @repo/language-service

What an editor knows about lisptc text: completions, hover docs, errors, and the
arguments a call still needs. The language server and the chat input both run
on it, so they agree.

Turbo tag: `language`.

## Shape

`src/service.ts` is the entry: built from a symbol table, it answers for a
`TextDocument` at a `Position` in the vscode language server types.
`src/symbol-table.ts` reads the table off anything shaped like an `Interp`,
and the table is plain data so it crosses a wire. `src/syntax.ts` runs the
interpreter's reader over the text. `src/tokenize.ts` turns text into
positioned atoms, forms and calls, and `src/call-diagnostics.ts` checks each
call against the arity, the required keyword arguments and the literal types
its doc record declares. `src/forms.ts` blanks the prose of a chat
message in place, so a position in the message is the same position in the
document.

## Rules

It runs in the browser. It imports no node builtin, nothing from
`vscode-languageserver` itself (that package is node-only), and from the
interpreter only modules that load without the filesystem. A value it needs
from the world comes in as an argument.

It builds no interpreter and names no extension. What a symbol means arrives in
the table its caller read off a live `Interp`.

The tokens come from `@repo/shared/lisp-tokens`. **Do not write a second
tokenizer.** A checker that disagrees with the reader reports errors that are
not real.

The agent checks each step with the same tokenizer and call checks, so the
editor and the agent never disagree about a call. **Only `src/service.ts`
speaks the editor protocol.**

## Tests

`test/` covers each module, and `test/service.test.ts` pins the service through
its public entry.
