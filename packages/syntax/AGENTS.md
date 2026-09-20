# @repo/syntax

The lisptc language for the highlighter, tokenized with the reader's own tokens.

Turbo tag: `foundation`.

## Shape

`src/lisptc.ts` holds the language definition, the highlighter built from it,
and the split between forms and prose in a block of text. `src/index.ts` is the
entrypoint, and it re-exports the form helper from `@repo/shared` beside them so
a consumer takes one import.

## Rules

The tokens come from `@repo/shared/lisp-tokens` and the form boundaries from
`@repo/shared/lisp-forms`. **Do not write a second tokenizer here.** A
highlighter that disagrees with the reader is a bug, and the way to keep them
in step is to share the definition rather than to copy it.

A change to what the dialect accepts belongs in the interpreter's reader and in
the shared tokens. This package follows.
