# @repo/lint-extension

The static check. What is wrong with source before it runs.

Turbo tag: `extension`.

## Shape

`src/lint.ts` is the extension: it hooks the `admit` chain and rejects a step
whose code would fail before it ran. `src/check.ts` decides which calls in a
step are evaluated and writes the rejection the model reads. `src/tokenize.ts`
turns text into positioned atoms, forms and calls. `src/calls.ts` checks each
call against the arity and the required keyword arguments its doc record
declares, and owns the diagnostic shape every check returns.

It has no prompt and no port yet. The rejection explains itself, so the model
pays for it only on the step that needs it.

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

A rejection stops code from running, so the agent check stays conservative: a
false error costs a step, a missed one costs nothing the evaluator would not
report anyway. It reads source through the `readSource` chain, so it sees only
what evaluation will. It never flags a head nothing defines, which the session
reads as prose. It never reads quoted data, a parameter list or a macro's
arguments as calls, and it trusts a name the same code defines over the arity
the session holds.

## Tests

`test/`. A parser change needs a case in `test/tokenize.test.ts`.
