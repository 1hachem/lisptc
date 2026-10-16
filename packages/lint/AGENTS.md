# @repo/lint-extension

The static check. What is wrong with source before it runs.

Turbo tag: `extension`.

## Shape

`src/tokenize.ts` turns text into positioned atoms, forms and calls.
`src/calls.ts` checks each call against the arity and the required keyword
arguments its doc record declares, and owns the diagnostic shape every check
returns.

## Rules

Read the host-port and seam rules in `packages/interpreter/AGENTS.md`. They
govern this package.

A diagnostic names no consumer. It carries a range, a message, a severity and a
code, and the editor and the agent each map it to what they speak at their own
root. **Do not import an editor protocol type here.**

The tokens come from `@repo/shared/lisp-tokens`. **Do not write a second
tokenizer.** A checker that disagrees with the reader reports errors that are
not real.

What a form expects comes from the interpreter's doc records, handed in through
a resolver, never from a table kept here. The checker never evaluates anything
to find out.

## Tests

`test/`. A parser change needs a case in `test/tokenize.test.ts`.
